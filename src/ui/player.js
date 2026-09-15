/**
 * In-page game player.
 *
 * Games run in a same-origin iframe inside a full-screen overlay, so launching
 * one never leaves the platform and never opens a tab. The overlay owns the
 * chrome (title, live score, best score, exit) and the iframe owns the game.
 *
 * The frame is created on open and destroyed on close: every one of these games
 * runs an unbounded requestAnimationFrame loop, so keeping a hidden frame alive
 * would keep burning CPU in the background.
 */
import { esc, fmtNumber, lockScroll, trapFocus } from './dom.js';
import { toast } from './toast.js';
import { GAME_BY_ID } from '../games.js';
import { getGame, recordResult } from '../progress.js';
import { track } from '../analytics.js';

const root = () => document.getElementById('player');

let current = null;      // the open game definition
let frame = null;
let liveScore = 0;
let unlock = null;
let releaseFocus = null;
let lastFocused = null;
const prefetched = new Set();

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

function chrome(game) {
  const best = getGame(game.id);
  return `
    <div class="player-bar">
      <button class="btn btn-ghost btn-sm" data-act="exit" title="Back to the library (Esc)">&larr; Library</button>
      <div class="player-title">
        <i class="swatch" style="background:${esc(game.accent)}"></i>
        <span>${esc(game.title)}</span>
      </div>
      <div class="player-stats">
        <span class="pstat">${esc(game.progressKind === 'match' ? 'Goals' : 'Score')} <b id="p-live">0</b></span>
        <span class="pstat opt">Best <b id="p-best">${fmtNumber(best.bestScore)}</b></span>
        <button class="btn btn-ghost btn-sm" data-act="restart" title="Restart this game">Restart</button>
      </div>
    </div>
    <div class="player-stage">
      <div class="player-loading" id="p-loading"><div><div class="spinner"></div><p>Loading ${esc(game.title)}</p></div></div>
      <div class="result" id="p-result"></div>
    </div>`;
}

export function openGame(gameId) {
  const game = GAME_BY_ID[gameId];
  if (!game) return;

  current = game;
  liveScore = 0;
  lastFocused = document.activeElement;

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

  track('game_open', { game_id: game.id, game_name: game.title });
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
  if (act === 'exit') closeGame();
  if (act === 'restart') restart();
  if (act === 'again') { hideResult(); restart(); }
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
  if (e.key === 'Escape') closeGame();
}

function onMessage(e) {
  // Only trust our own frame, on our own origin.
  if (e.origin !== window.location.origin) return;
  if (!frame || e.source !== frame.contentWindow) return;
  const msg = e.data;
  if (!msg || msg.source !== 'ez-games') return;

  const payload = msg.payload || {};
  switch (msg.type) {
    case 'ready':
      hideLoading();
      // Hand the game its persisted best score so its own HUD is accurate.
      frame.contentWindow.postMessage(
        { source: 'ez-shell', type: 'init', payload: { bestScore: getGame(current.id).bestScore } },
        window.location.origin
      );
      break;
    case 'start':
      liveScore = 0;
      setLive(0);
      track('game_start', { game_id: current.id });
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
      closeGame();
      break;
  }
}

function finishRun(payload) {
  const { record, isBest } = recordResult(current.id, payload);
  const bestEl = document.getElementById('p-best');
  if (bestEl) bestEl.textContent = fmtNumber(record.bestScore);

  track('game_complete', {
    game_id: current.id,
    score: payload.score || 0,
    won: !!payload.won,
    duration_sec: payload.durationSec || 0,
    new_best: isBest,
  });

  showResult(payload, record, isBest);
}

function showResult(payload, record, isBest) {
  const box = document.getElementById('p-result');
  if (!box) return;

  const won = !!payload.won;
  const kicker = current.progressKind === 'match'
    ? (won ? 'Match won' : 'Match lost')
    : current.progressKind === 'levels'
      ? `${esc(payload.level || 'Level')} cleared`
      : 'Run complete';

  const unit = current.progressKind === 'levels' ? 'difficulty tier' : current.scoreUnit;

  box.innerHTML = `
    <div class="result-card">
      <div class="result-kicker">${kicker}</div>
      <div class="result-score">${fmtNumber(payload.score || 0)}</div>
      <div class="result-unit">${esc(unit)}</div>
      <div class="result-best ${isBest ? 'new' : ''}">
        ${isBest ? '&#9733; New personal best!' : `Your best: ${fmtNumber(record.bestScore)}`}
      </div>
      <div class="result-actions">
        <button class="btn btn-ghost" data-act="exit">Library</button>
        <button class="btn btn-primary" data-act="again">Play again</button>
      </div>
    </div>`;
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
  requestAnimationFrame(() => box.classList.add('show'));
  setTimeout(() => box.querySelector('[data-act="again"]')?.focus(), 320);

  if (isBest && (payload.score || 0) > 0) toast(`New best in ${current.title}: ${fmtNumber(payload.score)}`, 'good');
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
  }, 280);

  lastFocused?.focus?.();
}

export const isPlayerOpen = () => !root().hidden;
