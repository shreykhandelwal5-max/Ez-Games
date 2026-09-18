/**
 * The game grid.
 *
 * Cards are built once and then patched in place when progress or assessment
 * state changes -- a full re-render would collapse any "How to play" panel the
 * player has open and throw away their scroll position.
 *
 * Each card carries the game's position in the measure-practise-measure cycle,
 * so the next useful action is always the primary button.
 */
import { esc, fmtNumber, fmtRelative } from './dom.js';
import { GAMES } from '../games.js';
import { onProgress, getGame } from '../progress.js';
import * as assess from '../assessment.js';
import { onAssessment } from '../assessment.js';
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
        <div class="card-phase" data-role="phase"></div>
      </div>
      <div class="card-body">
        <div>
          <div class="card-title">${esc(game.title)}</div>
          <div class="card-tagline">${esc(game.tagline)}</div>
          <div class="card-skill">${esc(game.skill)}</div>
        </div>

        <div class="card-track" data-role="track"></div>

        <div class="card-meta" data-role="meta"></div>

        <details class="rules">
          <summary>How to play</summary>
          <div class="rules-body">
            <p class="rules-goal"><b>Goal.</b> ${esc(game.goal)}</p>
            <dl class="ctrl-list">${controls}</dl>
            <ul class="tip-list">${tips}</ul>
            <p class="rules-measure"><b>Measured as.</b> ${esc(game.metric.label)} &mdash; ${esc(game.testNote)}</p>
          </div>
        </details>

        <div class="card-actions" data-role="actions"></div>
      </div>
    </article>`;
}

/**
 * The status pill over the artwork.
 *
 * Once a test has been taken, the measured result is the most valuable thing on
 * the card, so it outranks the "what next" state -- which the tracker and the
 * buttons underneath already spell out.
 */
function phaseChip(game) {
  const latest = assess.latestTest(game.id);
  if (latest) {
    const d = latest.deltaPct != null
      ? `${latest.deltaPct > 0 ? '+' : ''}${latest.deltaPct}%`
      : `${latest.deltaAbs > 0 ? '+' : ''}${latest.deltaAbs}`;
    return { cls: latest.improved ? 'up' : 'down', text: `${d} vs baseline` };
  }

  const phase = assess.phaseOf(game.id);
  if (phase === 'baseline') return { cls: 'new', text: 'Baseline needed' };
  if (phase === 'practice') {
    const left = assess.practiceRemaining(game.id);
    return { cls: 'practice', text: `Practice &middot; ${assess.PRACTICE_REQUIRED - left}/${assess.PRACTICE_REQUIRED}` };
  }
  if (phase === 'test-ready') return { cls: 'ready', text: 'Test unlocked' };
  return { cls: '', text: '' };
}

/** The little three-step tracker under the title. */
function trackMarkup(game) {
  const rec = assess.getAssessment(game.id);
  const phase = assess.phaseOf(game.id);
  const steps = [
    { key: 'baseline', label: 'Baseline', done: !!rec.baseline, active: phase === 'baseline' },
    {
      key: 'practice',
      label: 'Practice',
      done: !!rec.baseline && rec.practiceRuns >= assess.PRACTICE_REQUIRED,
      active: phase === 'practice',
    },
    { key: 'test', label: rec.tests.length ? 'Retest' : 'Test', done: rec.tests.length > 0, active: phase === 'test-ready' },
  ];

  const pct = rec.baseline ? Math.min(100, (rec.practiceRuns / assess.PRACTICE_REQUIRED) * 100) : 0;

  return `
    <div class="track">
      ${steps.map((s) => `
        <div class="track-step ${s.done ? 'done' : ''} ${s.active ? 'active' : ''}">
          <i>${s.done ? '&#10003;' : ''}</i><span>${s.label}</span>
        </div>`).join('<div class="track-line"></div>')}
    </div>
    ${phase === 'practice'
      ? `<div class="track-bar"><i style="width:${pct}%;background:linear-gradient(90deg,${esc(game.accent)},${esc(game.accent2)})"></i></div>`
      : ''}`;
}

function actionsMarkup(game) {
  const phase = assess.phaseOf(game.id);
  const retest = assess.hasResult(game.id);
  const play = `<button class="btn btn-ghost" data-play="${esc(game.id)}" data-mode="practice">Play</button>`;

  if (phase === 'baseline') {
    return `<button class="btn btn-primary" data-play="${esc(game.id)}" data-mode="baseline">Set baseline</button>${play}`;
  }
  if (phase === 'practice') {
    const left = assess.practiceRemaining(game.id);
    return `<button class="btn btn-primary" data-play="${esc(game.id)}" data-mode="practice">Practise</button>
            <button class="btn btn-ghost" disabled title="Practise ${left} more ${left === 1 ? 'run' : 'runs'} to unlock">
              ${retest ? 'Retest' : 'Test'} in ${left}
            </button>`;
  }
  return `<button class="btn btn-primary" data-play="${esc(game.id)}" data-mode="test">
            ${retest ? 'Take the retest' : 'Take the test'}
          </button>${play}`;
}

function patchCard(game) {
  const ref = refs.get(game.id);
  if (!ref) return;
  const rec = getGame(game.id);
  const a = assess.getAssessment(game.id);
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

  const chip = phaseChip(game);
  ref.phase.className = `card-phase ${chip.cls}`;
  ref.phase.innerHTML = chip.text;
  ref.phase.hidden = !chip.text;

  ref.track.innerHTML = trackMarkup(game);
  ref.actions.innerHTML = actionsMarkup(game);

  const baselineBit = a.baseline
    ? `<span>Baseline <b>${esc(assess.formatMetric(game, a.baseline.mean))}</b></span>`
    : '';

  ref.meta.innerHTML = played
    ? `<span><b>${fmtNumber(rec.plays)}</b> ${rec.plays === 1 ? 'run' : 'runs'}</span>
       ${baselineBit}
       <span>${esc(fmtRelative(rec.lastPlayedAt))}</span>`
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
      phase: card.querySelector('[data-role="phase"]'),
      track: card.querySelector('[data-role="track"]'),
      meta: card.querySelector('[data-role="meta"]'),
      actions: card.querySelector('[data-role="actions"]'),
    });

    // Start fetching the game the moment intent is shown, so the click itself
    // usually hits a warm cache.
    const warm = () => prefetchGame(game.id);
    card.addEventListener('pointerenter', warm, { once: true });
    card.addEventListener('focusin', warm, { once: true });
  });

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-play]');
    if (btn && !btn.disabled) openGame(btn.dataset.play, btn.dataset.mode || 'practice');
  });

  document.getElementById('library-count').textContent = `${GAMES.length} games`;

  const repaint = () => GAMES.forEach(patchCard);
  onProgress(repaint);
  onAssessment(repaint);
}
