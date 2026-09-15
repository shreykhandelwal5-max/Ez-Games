/**
 * Progress tracking.
 *
 * Two backing stores, one API:
 *   - localStorage, always. Instant reads (the grid never waits on the network)
 *     and the only store when Firebase is unconfigured or the player is offline.
 *   - Firestore, when signed in. Authoritative across devices.
 *
 * Writes go to local first and to Firestore in the background, so a finished
 * game never blocks on a round trip. On sign-in, local progress earned as a
 * visitor is merged upward instead of being thrown away.
 */
import { getDb } from './firebase.js';
import { state as authState } from './auth.js';
import { GAMES } from './games.js';

const LS_KEY = 'ezgames:progress:v1';
const listeners = new Set();

/** gameId -> record. The single source of truth the UI renders from. */
let cache = emptyCache();
let recent = [];
let syncedUid = null;

function emptyCache() {
  return Object.fromEntries(GAMES.map((g) => [g.id, blank(g.id)]));
}

function blank(gameId) {
  return {
    gameId,
    bestScore: 0,
    lastScore: 0,
    plays: 0,
    wins: 0,
    timeSec: 0,
    levelsCleared: [],
    lastPlayedAt: null,
  };
}

function emit() {
  listeners.forEach((fn) => {
    try { fn(cache, recent); } catch { /* never let one subscriber break others */ }
  });
}

export function onProgress(fn) {
  listeners.add(fn);
  fn(cache, recent);
  return () => listeners.delete(fn);
}

export const getAll = () => cache;
export const getGame = (gameId) => cache[gameId] || blank(gameId);
export const getRecent = () => recent;

export function totals() {
  const list = Object.values(cache);
  return {
    plays: list.reduce((n, r) => n + r.plays, 0),
    timeSec: list.reduce((n, r) => n + r.timeSec, 0),
    wins: list.reduce((n, r) => n + r.wins, 0),
    played: list.filter((r) => r.plays > 0).length,
    levels: list.reduce((n, r) => n + r.levelsCleared.length, 0),
  };
}

// --- local store -----------------------------------------------------------

function lsKey(uid) {
  return `${LS_KEY}:${uid || 'anon'}`;
}

function readLocal(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(uid) {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify({ progress: cache, recent: recent.slice(0, 20) }));
  } catch { /* quota or private mode: cloud sync still covers signed-in users */ }
}

/** Combines two records, keeping the best of each metric. */
function mergeRecord(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    gameId: a.gameId || b.gameId,
    bestScore: Math.max(a.bestScore || 0, b.bestScore || 0),
    lastScore: (a.lastPlayedAt || 0) >= (b.lastPlayedAt || 0) ? a.lastScore || 0 : b.lastScore || 0,
    plays: (a.plays || 0) + (b.plays || 0),
    wins: (a.wins || 0) + (b.wins || 0),
    timeSec: (a.timeSec || 0) + (b.timeSec || 0),
    levelsCleared: [...new Set([...(a.levelsCleared || []), ...(b.levelsCleared || [])])],
    lastPlayedAt: Math.max(a.lastPlayedAt || 0, b.lastPlayedAt || 0) || null,
  };
}

function hydrate(stored) {
  const next = emptyCache();
  if (stored?.progress) {
    for (const [id, rec] of Object.entries(stored.progress)) {
      if (next[id]) next[id] = { ...next[id], ...rec, gameId: id };
    }
  }
  cache = next;
  recent = Array.isArray(stored?.recent) ? stored.recent : [];
}

// --- cloud sync ------------------------------------------------------------

/**
 * Called whenever the auth state settles. Pulls the cloud copy, merges any
 * progress earned before signing in, and pushes the result back up.
 */
export async function syncForUser(user) {
  const uid = user?.uid || null;

  // Progress earned while signed out lives under the 'anon' key.
  const localAnon = readLocal(null);

  if (!uid) {
    hydrate(localAnon);
    syncedUid = null;
    emit();
    return;
  }

  hydrate(readLocal(uid) || localAnon);
  emit();

  const conn = await getDb();
  if (!conn) { syncedUid = uid; writeLocal(uid); return; }
  const { sdk, db } = conn;

  try {
    const snap = await sdk.getDocs(sdk.collection(db, 'users', uid, 'progress'));
    const cloud = {};
    snap.forEach((d) => { cloud[d.id] = { ...blank(d.id), ...d.data() }; });

    const localHasProgress = Object.values(cache).some((r) => r.plays > 0);
    const merged = emptyCache();
    for (const g of GAMES) {
      merged[g.id] = cloud[g.id]
        ? (localHasProgress && !readLocal(uid) ? mergeRecord(cloud[g.id], cache[g.id]) : { ...blank(g.id), ...cloud[g.id] })
        : cache[g.id];
    }
    cache = merged;

    // Pull the recent-activity feed.
    const sessSnap = await sdk.getDocs(
      sdk.query(sdk.collection(db, 'users', uid, 'sessions'), sdk.orderBy('at', 'desc'), sdk.limit(20))
    );
    const cloudRecent = [];
    sessSnap.forEach((d) => cloudRecent.push(d.data()));
    if (cloudRecent.length) recent = cloudRecent;

    syncedUid = uid;
    writeLocal(uid);
    emit();

    // Push the merged state back up, and clear the pre-sign-in local copy so
    // the same guest progress can't be merged in twice.
    await Promise.all(
      GAMES.filter((g) => cache[g.id].plays > 0).map((g) =>
        sdk.setDoc(sdk.doc(db, 'users', uid, 'progress', g.id), cache[g.id], { merge: true })
      )
    );
    try { localStorage.removeItem(lsKey(null)); } catch { /* ignore */ }

    await sdk.setDoc(
      sdk.doc(db, 'users', uid),
      {
        uid,
        displayName: user.displayName || null,
        email: user.email || null,
        isAnonymous: !!user.isAnonymous,
        lastSeenAt: sdk.serverTimestamp(),
        createdAt: sdk.serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    // Offline or rules not deployed yet: local progress carries the session.
    syncedUid = uid;
    writeLocal(uid);
  }
}

// --- recording -------------------------------------------------------------

/**
 * Records one finished run.
 * @param {string} gameId
 * @param {{score?:number, durationSec?:number, won?:boolean, level?:string}} result
 * @returns {{record:object, isBest:boolean}}
 */
export function recordResult(gameId, result = {}) {
  const rec = { ...getGame(gameId) };
  const score = Number.isFinite(result.score) ? Math.max(0, Math.round(result.score)) : 0;
  const duration = Number.isFinite(result.durationSec) ? Math.max(0, Math.round(result.durationSec)) : 0;

  const isBest = score > rec.bestScore;
  rec.plays += 1;
  rec.lastScore = score;
  rec.bestScore = Math.max(rec.bestScore, score);
  rec.timeSec += duration;
  rec.lastPlayedAt = Date.now();
  if (result.won) rec.wins += 1;
  if (result.level && !rec.levelsCleared.includes(result.level)) rec.levelsCleared.push(result.level);

  cache[gameId] = rec;

  const session = {
    gameId,
    score,
    durationSec: duration,
    won: !!result.won,
    level: result.level || null,
    at: Date.now(),
  };
  recent = [session, ...recent].slice(0, 20);

  const uid = authState.user?.uid || null;
  writeLocal(uid);
  emit();

  if (uid) pushToCloud(uid, gameId, rec, session);
  return { record: rec, isBest };
}

async function pushToCloud(uid, gameId, rec, session) {
  try {
    const conn = await getDb();
    if (!conn) return;
    const { sdk, db } = conn;
    // Firestore's offline cache queues these when the player has no network.
    await Promise.all([
      sdk.setDoc(sdk.doc(db, 'users', uid, 'progress', gameId), { ...rec, updatedAt: sdk.serverTimestamp() }, { merge: true }),
      sdk.addDoc(sdk.collection(db, 'users', uid, 'sessions'), { ...session, at: sdk.serverTimestamp(), atMs: session.at }),
    ]);
  } catch { /* local copy already holds the result */ }
}

export function resetLocal() {
  cache = emptyCache();
  recent = [];
  writeLocal(authState.user?.uid || null);
  emit();
}
