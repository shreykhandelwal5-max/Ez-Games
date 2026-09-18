/**
 * The improvement report: "did playing this actually help?"
 *
 * Form follows the data's job. The headline (mean change across measured games)
 * is a single number, so it is a stat tile rather than a chart. The per-game
 * figure is polarity -- better or worse than baseline -- so it is a diverging
 * bar chart anchored to a zero line, with a neutral midpoint.
 *
 * The blue/orange pair is deliberate: the obvious green/red fails CVD
 * separation for deuteranopia (delta-E 4.6). This pair clears every check in the
 * palette validator, and every bar is direct-labelled with a signed value and
 * restated in the table below, so polarity never rests on colour alone.
 */
import { esc, fmtRelative } from './dom.js';
import { GAMES } from '../games.js';
import * as assess from '../assessment.js';
import { onAssessment } from '../assessment.js';
import { openGame } from './player.js';

/** Diverging pair, validated against the dark chart surface. */
const UP = '#3b82f6';
const DOWN = '#ea580c';

/** The value plotted for a game: percent change where meaningful, else absolute. */
function deltaFor(game) {
  const rec = assess.getAssessment(game.id);
  const test = assess.latestTest(game.id);
  if (!rec.baseline || !test) return null;
  return {
    game,
    rec,
    test,
    pct: test.deltaPct,
    abs: test.deltaAbs,
    improved: test.improved,
    // Percent where it means something, absolute change otherwise (goal
    // difference has no meaningful zero to divide by).
    plot: test.deltaPct != null ? test.deltaPct : test.deltaAbs * 10,
    label: test.deltaPct != null
      ? `${test.deltaPct > 0 ? '+' : ''}${test.deltaPct}%`
      : `${test.deltaAbs > 0 ? '+' : ''}${test.deltaAbs}`,
  };
}

function heroTile(rows) {
  const o = assess.overall();

  if (!rows.length) {
    return `
      <div class="report-hero empty-hero">
        <div>
          <div class="hero-kicker">No measurements yet</div>
          <p class="hero-copy">
            Set a baseline on any game, practise ${assess.PRACTICE_REQUIRED} runs, then take the test.
            Your before-and-after shows up here.
          </p>
        </div>
      </div>`;
  }

  const value = o.meanPct != null
    ? `${o.meanPct > 0 ? '+' : ''}${o.meanPct}%`
    : `${o.improved}/${o.measured}`;
  const positive = o.meanPct != null ? o.meanPct > 0 : o.improved > o.measured / 2;

  return `
    <div class="report-hero">
      <div class="hero-main">
        <div class="hero-kicker">Average change since baseline</div>
        <div class="hero-number" style="color:${positive ? UP : DOWN}">${esc(value)}</div>
        <div class="hero-sub">across ${o.measured} measured ${o.measured === 1 ? 'game' : 'games'}</div>
      </div>
      <div class="hero-side">
        <div class="hero-stat"><b>${o.improved}</b><span>improved</span></div>
        <div class="hero-stat"><b>${o.measured - o.improved}</b><span>did not</span></div>
        <div class="hero-stat"><b>${o.baselines}/${o.total}</b><span>baselined</span></div>
      </div>
    </div>`;
}

function chart(rows) {
  if (!rows.length) return '';

  // Symmetric scale so a +20% bar and a -20% bar are the same length.
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.plot)));

  const bars = rows.map((r) => {
    const width = (Math.abs(r.plot) / max) * 50; // % of full track, half each side
    const color = r.improved ? UP : DOWN;
    return `
      <div class="chart-row" data-game="${esc(r.game.id)}"
           data-tip="${esc(`${r.game.title} · baseline ${assess.formatMetric(r.game, r.rec.baseline.mean)} → today ${assess.formatMetric(r.game, r.test.mean)}`)}">
        <div class="chart-name">${esc(r.game.title)}</div>
        <div class="chart-track">
          <i class="chart-zero"></i>
          <i class="chart-bar ${r.improved ? 'up' : 'down'}"
             style="${r.improved ? 'left:50%' : `right:50%`};width:${width}%;background:${color}"></i>
        </div>
        <div class="chart-value" style="color:${color}">${esc(r.label)}</div>
      </div>`;
  }).join('');

  return `
    <div class="chart-card">
      <div class="chart-head">
        <h3>Change versus baseline</h3>
        <p>Bars right of the line are improvements. Percent change where it applies,
           otherwise absolute change in the game&rsquo;s own unit.</p>
      </div>
      <div class="chart" id="delta-chart">${bars}</div>
      <div class="chart-axis"><span>worse</span><span>baseline</span><span>better</span></div>
      <div class="chart-tip" id="chart-tip" hidden></div>
    </div>`;
}

/** The same numbers as text -- the chart's table view. */
function table() {
  const rows = GAMES.map((game) => {
    const rec = assess.getAssessment(game.id);
    const test = assess.latestTest(game.id);
    const phase = assess.phaseOf(game.id);

    // Status reports what was measured if anything was; otherwise what is next.
    let status;
    if (test) {
      status = `<span class="tag ${test.improved ? 'up' : 'down'}">${test.improved ? 'Improved' : 'No gain'}</span>`;
    } else if (!rec.baseline) {
      status = '<span class="tag">No baseline</span>';
    } else if (phase === 'practice') {
      const left = assess.practiceRemaining(game.id);
      status = `<span class="tag practice">${assess.PRACTICE_REQUIRED - left}/${assess.PRACTICE_REQUIRED} practice</span>`;
    } else {
      status = '<span class="tag ready">Test unlocked</span>';
    }

    // The action is always the next step in the cycle.
    let action;
    if (!rec.baseline) {
      action = `<button class="btn btn-sm btn-primary" data-start="${esc(game.id)}" data-mode="baseline">Set baseline</button>`;
    } else if (phase === 'practice') {
      action = `<button class="btn btn-sm btn-ghost" data-start="${esc(game.id)}" data-mode="practice">Practise ${assess.practiceRemaining(game.id)}</button>`;
    } else {
      action = `<button class="btn btn-sm btn-primary" data-start="${esc(game.id)}" data-mode="test">${test ? 'Retest' : 'Take test'}</button>`;
    }

    return `
      <tr>
        <th scope="row">
          <i class="prow-swatch" style="background:${esc(game.accent)}"></i>
          <span>${esc(game.title)}<small>${esc(game.skill)}</small></span>
        </th>
        <td class="num">${rec.baseline ? esc(assess.formatMetric(game, rec.baseline.mean)) : '—'}</td>
        <td class="num">${test ? esc(assess.formatMetric(game, test.mean)) : '—'}</td>
        <td class="num">${test
          ? `<b style="color:${test.improved ? UP : DOWN}">${test.deltaPct != null
              ? `${test.deltaPct > 0 ? '+' : ''}${test.deltaPct}%`
              : `${test.deltaAbs > 0 ? '+' : ''}${test.deltaAbs}`}</b>`
          : '—'}</td>
        <td>${status}</td>
        <td class="right">${action}</td>
      </tr>`;
  }).join('');

  return `
    <div class="panel table-panel">
      <table class="report-table">
        <caption class="sr-only">Baseline, latest test and change for every game</caption>
        <thead>
          <tr>
            <th scope="col">Game</th>
            <th scope="col" class="num">Baseline</th>
            <th scope="col" class="num">Latest test</th>
            <th scope="col" class="num">Change</th>
            <th scope="col">Status</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="measure-note">
        Every game is measured one fixed way:
        ${GAMES.map((g) => `<b>${esc(g.title)}</b> ${esc(g.metric.label.toLowerCase())}`).join(' &middot; ')}.
      </p>
    </div>`;
}

/** History of repeat tests, once there is more than one. */
function history() {
  const withHistory = GAMES
    .map((g) => ({ game: g, rec: assess.getAssessment(g.id) }))
    .filter(({ rec }) => rec.tests.length > 1);

  if (!withHistory.length) return '';

  return `
    <div class="panel">
      <h3 class="panel-title">Test history</h3>
      ${withHistory.map(({ game, rec }) => `
        <div class="hist-row">
          <div class="hist-name"><i class="prow-swatch" style="background:${esc(game.accent)}"></i>${esc(game.title)}</div>
          <div class="hist-pills">
            <span class="run-pill base">${esc(assess.formatMetric(game, rec.baseline.mean))}</span>
            <span class="hist-arrow">&rarr;</span>
            ${rec.tests.map((t) => `
              <span class="run-pill ${t.improved ? 'up' : 'down'}" title="${esc(fmtRelative(t.at))}">
                ${esc(assess.formatMetric(game, t.mean))}
              </span>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function caveat() {
  return `
    <p class="caveat">
      <b>How to read this.</b> Each figure is the average of ${assess.RUNS_PER_SESSION} runs measured under
      identical conditions, which smooths out luck but does not eliminate it. A gain shows you got better
      <i>at this game</i> — that is a real result, but it is not evidence of a general improvement in
      attention or reaction time, and these are not clinical assessments. Retest after more practice to see
      whether a change holds up.
    </p>`;
}

function attachChartTips() {
  const chartEl = document.getElementById('delta-chart');
  const tip = document.getElementById('chart-tip');
  if (!chartEl || !tip) return;

  chartEl.addEventListener('pointermove', (e) => {
    const row = e.target.closest('.chart-row');
    if (!row) { tip.hidden = true; return; }
    const box = chartEl.getBoundingClientRect();
    tip.textContent = row.dataset.tip;
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(e.clientX - box.left, 8), box.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${row.getBoundingClientRect().top - box.top - 38}px`;
  });
  chartEl.addEventListener('pointerleave', () => { tip.hidden = true; });
}

export function renderAssessmentView() {
  const host = document.getElementById('assessment-body');

  const paint = () => {
    const rows = GAMES.map(deltaFor).filter(Boolean);
    host.innerHTML = `
      ${heroTile(rows)}
      ${chart(rows)}
      ${table()}
      ${history()}
      ${caveat()}`;
    attachChartTips();
  };

  onAssessment(paint);

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-start]');
    if (btn) openGame(btn.dataset.start, btn.dataset.mode || 'practice');
  });
}
