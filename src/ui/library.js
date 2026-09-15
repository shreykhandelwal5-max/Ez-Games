/**
 * The game grid.
 *
 * Cards are built once and then patched in place when progress changes --
 * a full re-render would collapse any "How to play" panel the player has open
 * and throw away their scroll position.
 */
import { esc, fmtNumber, fmtRelative } from './dom.js';
import { GAMES } from '../games.js';
import { onProgress, getGame } from '../progress.js';
import { openGame, prefetchGame } from './player.js';

const refs = new Map();

function cardMarkup(game) {
  const controls = game.controls
    .map(([k, v]) => `<div class="ctrl"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  const tips = game.tips.map((t) => `<li>${esc(t)}</li>`).join('');

  return `
    <article class="card" data-game="${esc(game.id)}">
      <div class="card-art">
        <svg viewBox="0 0 400 230" role="img" aria-label="${esc(game.title)} cover art" preserveAspectRatio="xMidYMid slice">${game.art}</svg>
        <div class="card-best" data-role="best" hidden></div>
      </div>
      <div class="card-body">
        <div>
          <div class="card-title">${esc(game.title)}</div>
          <div class="card-tagline">${esc(game.tagline)}</div>
        </div>

        <div class="card-meta" data-role="meta"></div>

        <details class="rules">
          <summary>How to play</summary>
          <div class="rules-body">
            <p class="rules-goal"><b>Goal.</b> ${esc(game.goal)}</p>
            <dl class="ctrl-list">${controls}</dl>
            <ul class="tip-list">${tips}</ul>
          </div>
        </details>

        <div class="card-actions">
          <button class="btn btn-primary" data-play="${esc(game.id)}">Play now</button>
        </div>
      </div>
    </article>`;
}

function patchCard(game) {
  const ref = refs.get(game.id);
  if (!ref) return;
  const rec = getGame(game.id);
  const played = rec.plays > 0;

  const bestValue = game.progressKind === 'match'
    ? rec.wins
    : game.progressKind === 'levels'
      ? rec.levelsCleared.length
      : rec.bestScore;

  ref.best.hidden = !played;
  if (played) {
    ref.best.innerHTML = `<span class="k">${esc(game.scoreLabel)}</span> ${fmtNumber(bestValue)}`;
  }

  ref.meta.innerHTML = played
    ? `<span><b>${fmtNumber(rec.plays)}</b> ${rec.plays === 1 ? 'play' : 'plays'}</span>
       <span>Last played <b>${esc(fmtRelative(rec.lastPlayedAt))}</b></span>`
    : `<span>Not played yet</span>`;
}

export function renderLibrary() {
  const grid = document.getElementById('game-grid');
  grid.innerHTML = GAMES.map(cardMarkup).join('');

  GAMES.forEach((game) => {
    const card = grid.querySelector(`[data-game="${game.id}"]`);
    refs.set(game.id, {
      card,
      best: card.querySelector('[data-role="best"]'),
      meta: card.querySelector('[data-role="meta"]'),
    });

    // Start fetching the game the moment intent is shown, so the click itself
    // usually hits a warm cache.
    const warm = () => prefetchGame(game.id);
    card.addEventListener('pointerenter', warm, { once: true });
    card.addEventListener('focusin', warm, { once: true });
  });

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-play]');
    if (btn) openGame(btn.dataset.play);
  });

  document.getElementById('library-count').textContent = `${GAMES.length} games`;

  onProgress(() => GAMES.forEach(patchCard));
}
