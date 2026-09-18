/**
 * In-page game player.
 *
 * Games run in a same-origin iframe inside a full-screen overlay, so launching
 * one never leaves the platform and never opens a tab. The overlay owns the
 * chrome (title, live score, best score, exit) and the iframe owns the game.
 *
 * The player also drives assessment sessions. A baseline or test session is a
 * fixed number of runs played back to back under identical conditions; the
 * overlay counts them down, remounts a clean frame between runs, and shows the
 * session verdict at the end.
 *
 * The frame is created on open and destroyed on close: every one of these games
 * runs an unbounded requestAnimationFrame loop, so keeping a hidden frame alive
 * would keep burning CPU in the background.
 */
import { esc, fmtNumber, lockScroll, trapFocus } from './dom.js';
import { toast } from './toast.js';
import { GAME_BY_ID } from '../games.js';
import { getGame, recordResult } from '../progress.js';
import * as assess from '../assessment.js';
import { track } from '../analytics.js';

const root = () => document.getElementById('player');

let current = null;      // the open game definition
let frame = null;
let mode = 'practice';   // 'practice' | 'baseline' | 'test'
let liveScore = 0;
let unlock = null;
let releaseFocus = null;
let lastFocused = null;
const prefetched = new Set();

const inSession = () => mode !== 'practice';

/** Warms the HTTP cache so the click-to-playable gap is near zero. */
export function prefetchGame(gameId) {
  const game = GAME_BY_ID[gameId];
  if (!game || prefetched.has(gameId)) return;
  prefetched.add(gameId);
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = game.file;
  document.head.appendChild(link);
}

function sessionChip() {
  if (!inSession()) return '';
  const done = assess.getAssessment(current.id).active?.runs.length || 0;
  return `<span class="pstat session ${mode}">
    ${mode === 'baseline' ? 'Baseline' : 'Test'} &middot; run <b>${done + 1}</b> of ${assess.RUNS_PER_SESSION}
  </span>`;
}

function chrome(game) {
  const best = getGame(game.id);
  return `
    <div class="player-bar">
      <button class="btn btn-ghost btn-sm" data-act="exit" title="${inSession() ? 'Abandon this session' : 'Back to the library (Esc)'}">
        &larr; ${inSession() ? 'Abandon' : 'Library'}
      </button>
      <div class="player-title">
        <i class="swatch" style="background:${esc(game.accent)}"></i>
        <span>${esc(game.title)}</span>
      </div>
      <div class="player-stats" id="p-stats">
        ${sessionChip()}
        <span class="pstat">${esc(game.progressKind === 'match' ? 'Goals' : 'Score')} <b id="p-live">0</b></span>
        ${inSession() ? '' : `<span class="pstat opt">Best <b id="p-best">${fmtNumber(best.bestScore)}</b></span>
        <button class="btn btn-ghost btn-sm" data-act="restart" title="Restart this game">Restart</button>`}
      </div>
    </div>
    <div class="player-stage">
      <div class="player-loading" id="p-loading"><div><div class="spinner"></div><p>Loading ${esc(game.title)}</p></div></div>
      <div class="result" id="p-result"></div>
    </div>`;
}

function refreshChrome() {
  const stats = document.getElementById('p-stats');
  if (!stats) return;
  const chip = stats.querySelector('.session');
  if (chip && inSession()) {
    const done = assess.getAssessment(current.id).active?.runs.length || 0;
    chip.innerHTML = `${mode === 'baseline' ? 'Baseline' : 'Test'} &middot; run <b>${Math.min(done + 1, assess.RUNS_PER_SESSION)}</b> of ${assess.RUNS_PER_SESSION}`;
  }
}

/**
 * @param {string} gameId
 * @param {'practice'|'baseline'|'test'} nextMode
 */
export function openGame(gameId, nextMode = 'practice') {
  const game = GAME_BY_ID[gameId];
  if (!game) return;

  current = game;
  mode = nextMode;
  liveScore = 0;
  lastFocused = document.activeElement;

  if (inSession()) assess.startSession(game.id, mode);

  const el = root();
  el.hidden = false;
  el.innerHTML = chrome(game);
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));

  mountFrame();

  requestAnimationFrame(() => el.classList.add('open'));
  unlock = lockScroll();
  releaseFocus = trapFocus(el);
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKey);

  track('game_open', { game_id: game.id, game_name: game.title, mode });
  if (inSession()) track('session_start', { game_id: game.id, phase: mode });
}

function mountFrame() {
  const stage = root().querySelector('.player-stage');
  if (frame) frame.remove();

  frame = document.createElement('iframe');
  frame.title = `${current.title} game`;
  frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
  // Same-origin is required: the SDK bridge and the parent exchange messages.
  frame.src = current.file;
  stage.appendChild(frame);

  const loading = document.getElementById('p-loading');
  loading?.classList.remove('hide');
  // Fallback in case a game never calls EZ.ready() (e.g. opened standalone).
  frame.addEventListener('load', () => setTimeout(hideLoading, 400));
}

function hideLoading() {
  document.getElementById('p-loading')?.classList.add('hide');
}

function onAction(e) {
  const act = e.currentTarget.dataset.act;
  if (act === 'exit') return requestExit();
  if (act === 'restart') return restart();
  if (act === 'again') { hideResult(); restart(); return; }
  if (act === 'next') { hideResult(); refreshChrome(); mountFrame(); return; }
  if (act === 'report') {
    closeGame();
    setTimeout(() => document.getElementById('assessment')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 320);
    return;
  }
  if (act === 'practice') { mode = 'practice'; hideResult(); rebuildChrome(); mountFrame(); return; }
  if (act === 'starttest') {
    mode = 'test';
    assess.startSession(current.id, 'test');
    hideResult();
    rebuildChrome();
    mountFrame();
    track('session_start', { game_id: current.id, phase: 'test' });
    return;
  }
}

/** Repaints the bar after the mode changes (session chip appears/disappears). */
function rebuildChrome() {
  const el = root();
  if (frame) { frame.remove(); frame = null; }
  el.innerHTML = chrome(current);
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
}

function restart() {
  liveScore = 0;
  setLive(0);
  hideResult();
  mountFrame();
  track('game_restart', { game_id: current.id });
}

function setLive(n) {
  const el = document.getElementById('p-live');
  if (el) el.textContent = fmtNumber(n);
}

function onKey(e) {
  if (e.key === 'Escape') requestExit();
}

/** Escape/Abandon during a session discards it rather than half-recording it. */
function requestExit() {
  if (inSession()) {
    const done = assess.getAssessment(current.id).active?.runs.length || 0;
    const label = mode === 'baseline' ? 'baseline' : 'test';
    if (done > 0 && !window.confirm(
      `Abandon this ${label} session?\n\n${done} of ${assess.RUNS_PER_SESSION} runs are done. ` +
      `They will be discarded — a ${label} only counts as a complete session.`
    )) return;
    assess.abortSession(current.id);
    track('session_abort', { game_id: current.id, phase: mode, runs_done: done });
  }
  closeGame();
}

function onMessage(e) {
  // Only trust our own frame, on our own origin.
  if (e.origin !== window.location.origin) return;
  if (!frame || e.source !== frame.contentWindow) return;
  const msg = e.data;
  if (!msg || msg.source !== 'ez-games') return;

  const payload = msg.payload || {};
  switch (msg.type) {
    case 'ready': {
      hideLoading();
      // Hand the game its persisted best score, and pin any setting the game
      // needs held constant while a session is being measured.
      frame.contentWindow.postMessage({
        source: 'ez-shell',
        type: 'init',
        payload: {
          bestScore: getGame(current.id).bestScore,
          mode,
          lockLevel: inSession() ? current.lockLevel || null : null,
        },
      }, window.location.origin);
      break;
    }
    case 'start':
      liveScore = 0;
      setLive(0);
      track('game_start', { game_id: current.id, mode });
      break;
    case 'score':
      liveScore = payload.score || 0;
      setLive(liveScore);
      break;
    case 'level':
      break; // recorded with the run result
    case 'over':
      finishRun(payload);
      break;
    case 'exit':
      requestExit();
      break;
  }
}

function finishRun(payload) {
  // Every run counts towards ordinary progress, session or not.
  const { record, isBest } = recordResult(current.id, payload);
  const bestEl = document.getElementById('p-best');
  if (bestEl) bestEl.textContent = fmtNumber(record.bestScore);

  const outcome = assess.recordRun(current.id, payload);

  track('game_complete', {
    game_id: current.id,
    score: payload.score || 0,
    won: !!payload.won,
    duration_sec: payload.durationSec || 0,
    new_best: isBest,
    mode,
  });

  if (inSession() && outcome) {
    refreshChrome();
    if (outcome.done) {
      mode = 'practice'; // the session is over; the overlay is free play again
      track('session_complete', {
        game_id: current.id,
        phase: outcome.phase,
        mean: outcome.summary.mean,
        delta_pct: outcome.comparison?.deltaPct ?? null,
      });
      showSessionSummary(outcome);
    } else {
      showRunStep(outcome);
    }
    return;
  }

  showResult(payload, record, isBest, outcome);
}

// --- result screens ---------------------------------------------------------

function paint(html) {
  const box = document.getElementById('p-result');
  if (!box) return;
  box.innerHTML = html;
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => box.querySelector('.result-actions .btn:last-child')?.focus(), 320);
}

/** Between runs of a session. */
function showRunStep(outcome) {
  const dots = Array.from({ length: assess.RUNS_PER_SESSION }, (_, i) =>
    `<i class="run-dot ${i < outcome.runIndex ? 'done' : ''}"></i>`).join('');

  paint(`
    <div class="result-card">
      <div class="result-kicker">${outcome.phase === 'baseline' ? 'Baseline' : 'Test'} &middot; run ${outcome.runIndex} of ${outcome.total}</div>
      <div class="result-score">${esc(assess.formatMetric(current, outcome.value))}</div>
      <div class="result-unit">${esc(current.metric.label)}</div>
      <div class="run-dots">${dots}</div>
      <p class="result-note">${outcome.total - outcome.runIndex} more ${outcome.total - outcome.runIndex === 1 ? 'run' : 'runs'} to go. We average them so one unlucky round does not decide your ${outcome.phase}.</p>
      <div class="result-actions">
        <button class="btn btn-primary" data-act="next">Next run</button>
      </div>
    </div>`);
}

/** End of a baseline or test session. */
function showSessionSummary(outcome) {
  const s = outcome.summary;
  const runs = s.runs.map((v) => `<span class="run-pill">${esc(assess.formatMetric(current, v))}</span>`).join('');

  if (outcome.phase === 'baseline') {
    paint(`
      <div class="result-card wide">
        <div class="result-kicker">Baseline set</div>
        <div class="result-score">${esc(assess.formatMetric(current, s.mean))}</div>
        <div class="result-unit">average ${esc(current.metric.label)}</div>
        <div class="run-row">${runs}</div>
        <p class="result-note">
          This is your starting point for <b>${esc(current.title)}</b>. Practise
          ${assess.PRACTICE_REQUIRED} runs to unlock the test, then we measure the same thing again
          and show you the difference.
        </p>
        <div class="result-actions">
          <button class="btn btn-ghost" data-act="exit">Library</button>
          <button class="btn btn-primary" data-act="practice">Start practising</button>
        </div>
      </div>`);
    toast(`Baseline set for ${current.title}: ${assess.formatMetric(current, s.mean)}`, 'good');
    return;
  }

  const c = outcome.comparison;
  const base = assess.getAssessment(current.id).baseline;
  const delta = c.deltaPct != null
    ? `${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%`
    : `${c.deltaAbs > 0 ? '+' : ''}${c.deltaAbs}`;

  paint(`
    <div class="result-card wide">
      <div class="result-kicker">Test complete</div>
      <div class="result-score ${c.improved ? 'up' : 'down'}">${esc(delta)}</div>
      <div class="result-unit">${c.improved ? 'better than' : 'versus'} your baseline</div>
      <div class="compare">
        <div><span>Baseline</span><b>${esc(assess.formatMetric(current, base.mean))}</b></div>
        <div class="compare-arrow">&rarr;</div>
        <div><span>Today</span><b>${esc(assess.formatMetric(current, s.mean))}</b></div>
      </div>
      <div class="run-row">${runs}</div>
      <p class="result-note">
        ${c.improved
          ? 'Measured on the same task under the same conditions as your baseline.'
          : 'No gain this time. Scores bounce around, so one test is a snapshot rather than a verdict.'}
      </p>
      <div class="result-actions">
        <button class="btn btn-ghost" data-act="exit">Library</button>
        <button class="btn btn-primary" data-act="report">See full report</button>
      </div>
    </div>`);
  toast(`${current.title} test: ${delta} vs baseline`, c.improved ? 'good' : '');
}

/** Ordinary free-play run. */
function showResult(payload, record, isBest, outcome) {
  const won = !!payload.won;
  const kicker = current.progressKind === 'match'
    ? (won ? 'Match won' : 'Match lost')
    : current.progressKind === 'levels'
      ? `${esc(payload.level || 'Level')} cleared`
      : 'Run complete';

  const unit = current.progressKind === 'levels' ? 'difficulty tier' : current.scoreUnit;

  // Practice runs move the player towards unlocking their test.
  let practice = '';
  if (outcome?.phase === 'practice') {
    practice = outcome.remaining > 0
      ? `<p class="result-note">Practice run ${outcome.practiceRuns} of ${assess.PRACTICE_REQUIRED} &middot;
         <b>${outcome.remaining}</b> more to unlock your test.</p>`
      : `<p class="result-note unlocked">&#10003; Your test is unlocked — see how far you have come.</p>`;
  } else if (!assess.getAssessment(current.id).baseline) {
    practice = `<p class="result-note">Set a baseline for this game to start tracking whether you improve.</p>`;
  }

  const testReady = outcome?.unlockedTest || assess.canTest(current.id);

  paint(`
    <div class="result-card">
      <div class="result-kicker">${kicker}</div>
      <div class="result-score">${fmtNumber(payload.score || 0)}</div>
      <div class="result-unit">${esc(unit)}</div>
      <div class="result-best ${isBest ? 'new' : ''}">
        ${isBest ? '&#9733; New personal best!' : `Your best: ${fmtNumber(record.bestScore)}`}
      </div>
      ${practice}
      <div class="result-actions">
        <button class="btn btn-ghost" data-act="exit">Library</button>
        ${testReady
          ? '<button class="btn btn-primary" data-act="starttest">Take the test</button>'
          : '<button class="btn btn-primary" data-act="again">Play again</button>'}
      </div>
    </div>`);

  if (outcome?.unlockedTest) toast(`Test unlocked for ${current.title}.`, 'good');
  else if (isBest && (payload.score || 0) > 0) toast(`New best in ${current.title}: ${fmtNumber(payload.score)}`, 'good');
}

function hideResult() {
  const box = document.getElementById('p-result');
  if (!box) return;
  box.classList.remove('show');
  setTimeout(() => { if (box) box.innerHTML = ''; }, 260);
}

export function closeGame() {
  const el = root();
  if (el.hidden) return;

  track('game_close', { game_id: current?.id });

  el.classList.remove('open');
  window.removeEventListener('message', onMessage);
  document.removeEventListener('keydown', onKey);
  releaseFocus?.();
  unlock?.();
  releaseFocus = unlock = null;

  setTimeout(() => {
    // Tearing the frame down stops the game's animation loop for good.
    if (frame) { frame.src = 'about:blank'; frame.remove(); frame = null; }
    el.hidden = true;
    el.innerHTML = '';
    current = null;
    mode = 'practice';
  }, 280);

  lastFocused?.focus?.();
}

export const isPlayerOpen = () => !root().hidden;
