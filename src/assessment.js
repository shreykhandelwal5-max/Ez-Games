/**
 * Capability assessment: baseline -> practice -> test.
 *
 * The point of the platform is to answer one question honestly: "did playing
 * this actually make me better?" To answer it we need two measurements taken
 * under identical conditions, separated by practice.
 *
 *   1. BASELINE  a short session of scored runs before any real practice.
 *   2. PRACTICE  free play. Runs are counted but never scored against you.
 *   3. TEST      the same session again, compared against the baseline.
 *
 * Two design rules keep the comparison meaningful:
 *   - A session is several runs averaged, not one. A single run of any of these
 *     games is far too noisy to read a trend from.
 *   - Baseline and test run under identical conditions (same difficulty, same
 *     time limit), which is why some games get locked settings in this mode.
 */
import { getDb } from './firebase.js';
import { state as authState } from './auth.js';
import { GAMES, GAME_BY_ID } from './games.js';

/** Runs in a baseline or test session. Three balances noise against patience. */
export const RUNS_PER_SESSION = 3;
/** Practice runs required after a baseline before the test unlocks. */
export const PRACTICE_REQUIRED = 5;

const LS_KEY = 'ezgames:assessment:v1';
const listeners = new Set();

let cache = emptyCache();

function blank(gameId) {
  return {
    gameId,
    baseline: null,     // { runs:[], mean, best, at }
    practiceRuns: 0,
    tests: [],          // [{ runs:[], mean, best, at, deltaPct, deltaAbs }]
    active: null,       // { phase:'baseline'|'test', runs:[], startedAt }
  };
}

function emptyCache() {
  return Object.fromEntries(GAMES.map((g) => [g.id, blank(g.id)]));
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(cache); } catch { /* one bad subscriber must not break the rest */ }
  });
}

export function onAssessment(fn) {
  listeners.add(fn);
  fn(cache);
  return () => listeners.delete(fn);
}

export const getAssessment = (gameId) => cache[gameId] || blank(gameId);
export const getAllAssessments = () => cache;

// --- the measured metric ----------------------------------------------------

/**
 * Pulls the comparable number out of a finished run.
 *
 * Most games measure score under a fixed condition. Star Connect measures how
 * long a locked difficulty takes (lower is better), because its "score" is the
 * difficulty the player chose rather than how well they did. Neon Striker
 * measures goal difference, because first-to-five saturates a raw goal count.
 */
export function metricValue(game, payload) {
  const metric = game.metric || { key: 'score', direction: 'higher' };
  if (metric.key === 'duration') return Math.max(0, payload.durationSec || 0);
  if (metric.key === 'goalDiff') return (payload.score || 0) - (payload.detail?.cpu || 0);
  return payload.score || 0;
}

export const metricOf = (game) => game.metric || { key: 'score', direction: 'higher' };

/** True when a bigger number means a better player. */
export const higherIsBetter = (game) => metricOf(game).direction !== 'lower';

export function formatMetric(game, value) {
  const metric = metricOf(game);
  if (value == null || Number.isNaN(value)) return '—';
  if (metric.key === 'duration') {
    const s = Math.round(value * 10) / 10;
    return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s}s`;
  }
  const rounded = Math.round(value * 10) / 10;
  return metric.key === 'goalDiff' && rounded > 0 ? `+${rounded}` : String(rounded);
}

// --- phases -----------------------------------------------------------------

/**
 * Where the player is in the cycle for one game.
 * 'baseline' | 'baseline-active' | 'practice' | 'test-ready' | 'test-active'
 *
 * Finishing a test opens a fresh practice cycle, so the phase is always the
 * next thing to do. Whether a result already exists is a separate question --
 * ask `latestTest()` for that -- because a measured result stays worth showing
 * while the player is practising towards their next one.
 */
export function phaseOf(gameId) {
  const rec = getAssessment(gameId);
  if (rec.active) return rec.active.phase === 'baseline' ? 'baseline-active' : 'test-active';
  if (!rec.baseline) return 'baseline';
  if (rec.practiceRuns < PRACTICE_REQUIRED) return 'practice';
  return 'test-ready';
}

/** True once at least one test has been completed for this game. */
export const hasResult = (gameId) => getAssessment(gameId).tests.length > 0;

/** Practice runs still owed before the next test unlocks. */
export function practiceRemaining(gameId) {
  const rec = getAssessment(gameId);
  return Math.max(0, PRACTICE_REQUIRED - rec.practiceRuns);
}

export const canTest = (gameId) => {
  const rec = getAssessment(gameId);
  return !!rec.baseline && rec.practiceRuns >= PRACTICE_REQUIRED && !rec.active;
};

/** The most recent test result, or null. */
export const latestTest = (gameId) => {
  const t = getAssessment(gameId).tests;
  return t.length ? t[t.length - 1] : null;
};

// --- sessions ---------------------------------------------------------------

export function startSession(gameId, phase) {
  const rec = { ...getAssessment(gameId) };
  rec.active = { phase, runs: [], startedAt: Date.now() };
  cache[gameId] = rec;
  persist();
  emit();
  return rec.active;
}

export function abortSession(gameId) {
  const rec = { ...getAssessment(gameId) };
  rec.active = null;
  cache[gameId] = rec;
  persist();
  emit();
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((n, v) => n + v, 0) / (values.length || 1);
  return {
    runs: values,
    mean: Math.round(mean * 100) / 100,
    best: Math.max(...values),
    worst: Math.min(...values),
    median: sorted[Math.floor(sorted.length / 2)],
  };
}

/**
 * Improvement of `test` over `base`, respecting the metric's direction.
 * Percentages are only meaningful for a positive baseline, so a metric that can
 * sit at or below zero (goal difference) reports an absolute change instead.
 */
export function compare(game, base, test) {
  const higher = higherIsBetter(game);
  const deltaAbs = Math.round((higher ? test - base : base - test) * 100) / 100;
  const usePct = base > 0 && metricOf(game).key !== 'goalDiff';
  const deltaPct = usePct ? Math.round((deltaAbs / Math.abs(base)) * 1000) / 10 : null;
  return { deltaAbs, deltaPct, improved: deltaAbs > 0 };
}

/**
 * Records one finished run.
 * @returns {null | {phase, runIndex, total, done, summary, comparison}}
 *          null when the run was plain practice (nothing to show).
 */
export function recordRun(gameId, payload) {
  const game = GAME_BY_ID[gameId];
  if (!game) return null;
  const rec = { ...getAssessment(gameId) };

  // Not in a session: this is practice, which only counts once a baseline exists.
  if (!rec.active) {
    if (rec.baseline) {
      rec.practiceRuns += 1;
      cache[gameId] = rec;
      persist();
      emit();
      const remaining = practiceRemaining(gameId);
      return { phase: 'practice', practiceRuns: rec.practiceRuns, remaining, unlockedTest: remaining === 0 };
    }
    return null;
  }

  const value = metricValue(game, payload);
  const active = { ...rec.active, runs: [...rec.active.runs, value] };
  rec.active = active;

  const runIndex = active.runs.length;
  const done = runIndex >= RUNS_PER_SESSION;

  let summary = null;
  let comparison = null;

  if (done) {
    summary = { ...summarise(active.runs), at: Date.now() };
    if (active.phase === 'baseline') {
      rec.baseline = summary;
      rec.practiceRuns = 0;
    } else {
      comparison = compare(game, rec.baseline.mean, summary.mean);
      rec.tests = [...rec.tests, { ...summary, ...comparison }];
      // A finished test opens a fresh practice cycle for the next one.
      rec.practiceRuns = 0;
    }
    rec.active = null;
  }

  cache[gameId] = rec;
  persist();
  emit();

  return { phase: active.phase, runIndex, total: RUNS_PER_SESSION, done, value, summary, comparison };
}

// --- overall report ---------------------------------------------------------

/** Cross-game roll-up for the report header. */
export function overall() {
  const withTests = GAMES
    .map((g) => ({ game: g, rec: cache[g.id] }))
    .filter(({ rec }) => rec.baseline && rec.tests.length);

  const deltas = withTests
    .map(({ game, rec }) => compare(game, rec.baseline.mean, rec.tests[rec.tests.length - 1].mean))
    .filter((d) => d.deltaPct != null);

  const meanPct = deltas.length
    ? Math.round((deltas.reduce((n, d) => n + d.deltaPct, 0) / deltas.length) * 10) / 10
    : null;

  return {
    measured: withTests.length,
    improved: withTests.filter(({ game, rec }) =>
      compare(game, rec.baseline.mean, rec.tests[rec.tests.length - 1].mean).improved).length,
    baselines: GAMES.filter((g) => cache[g.id].baseline).length,
    meanPct,
    total: GAMES.length,
  };
}

// --- persistence ------------------------------------------------------------

const lsKey = (uid) => `${LS_KEY}:${uid || 'anon'}`;

function persist() {
  const uid = authState.user?.uid || null;
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(cache));
  } catch { /* quota or private mode */ }
  if (uid) pushToCloud(uid);
}

function readLocal(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hydrate(stored) {
  const next = emptyCache();
  if (stored) {
    for (const [id, rec] of Object.entries(stored)) {
      if (next[id]) next[id] = { ...next[id], ...rec, gameId: id };
    }
  }
  cache = next;
}

/** Keeps the earliest baseline and the union of test history. */
function mergeRecord(a, b) {
  if (!a?.baseline && !b?.baseline) {
    return { ...blank(a?.gameId || b?.gameId), practiceRuns: Math.max(a?.practiceRuns || 0, b?.practiceRuns || 0) };
  }
  const baseline = !a?.baseline ? b.baseline
    : !b?.baseline ? a.baseline
    : (a.baseline.at <= b.baseline.at ? a.baseline : b.baseline);

  const seen = new Set();
  const tests = [...(a?.tests || []), ...(b?.tests || [])]
    .filter((t) => (seen.has(t.at) ? false : seen.add(t.at)))
    .sort((x, y) => x.at - y.at);

  return {
    gameId: a?.gameId || b?.gameId,
    baseline,
    practiceRuns: Math.max(a?.practiceRuns || 0, b?.practiceRuns || 0),
    tests,
    active: a?.active || b?.active || null,
  };
}

/** Called when auth settles, mirroring `progress.syncForUser`. */
export async function syncForUser(user) {
  const uid = user?.uid || null;
  const localAnon = readLocal(null);

  if (!uid) {
    hydrate(localAnon);
    emit();
    return;
  }

  const hadDeviceCopy = !!readLocal(uid);
  hydrate(readLocal(uid) || localAnon);
  emit();

  const conn = await getDb();
  if (!conn) return;
  const { sdk, db } = conn;

  try {
    const snap = await sdk.getDocs(sdk.collection(db, 'users', uid, 'assessments'));
    const cloud = {};
    snap.forEach((d) => { cloud[d.id] = { ...blank(d.id), ...d.data() }; });

    const merged = emptyCache();
    for (const g of GAMES) {
      // A device that has signed in before is already reconciled, so the cloud
      // copy wins; otherwise fold in whatever was earned as a guest.
      merged[g.id] = cloud[g.id]
        ? (hadDeviceCopy ? cloud[g.id] : mergeRecord(cloud[g.id], cache[g.id]))
        : cache[g.id];
    }
    cache = merged;
    emit();

    try { localStorage.setItem(lsKey(uid), JSON.stringify(cache)); } catch { /* ignore */ }
    await Promise.all(
      GAMES.filter((g) => cache[g.id].baseline || cache[g.id].practiceRuns)
        .map((g) => sdk.setDoc(sdk.doc(db, 'users', uid, 'assessments', g.id), cache[g.id], { merge: true }))
    );
    try { localStorage.removeItem(lsKey(null)); } catch { /* ignore */ }
  } catch { /* offline or rules not deployed: local copy carries the session */ }
}

async function pushToCloud(uid) {
  try {
    const conn = await getDb();
    if (!conn) return;
    const { sdk, db } = conn;
    await Promise.all(
      GAMES.filter((g) => cache[g.id].baseline || cache[g.id].practiceRuns || cache[g.id].active)
        .map((g) => sdk.setDoc(
          sdk.doc(db, 'users', uid, 'assessments', g.id),
          { ...cache[g.id], updatedAt: sdk.serverTimestamp() },
          { merge: true }
        ))
    );
  } catch { /* the local copy already holds it */ }
}

/** Clears the whole cycle for one game so it can be measured from scratch. */
export function resetGame(gameId) {
  cache[gameId] = blank(gameId);
  persist();
  emit();
}
