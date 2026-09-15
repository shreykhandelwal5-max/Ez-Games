/**
 * "My progress" — per-game bests plus a recent-activity feed, and the summary
 * strip under the hero. Both re-render whenever progress or auth changes.
 */
import { esc, fmtNumber, fmtDuration, fmtRelative } from './dom.js';
import { GAMES, GAME_BY_ID } from '../games.js';
import { onProgress, getAll, getRecent, totals } from '../progress.js';
import { onAuth, isGuest, isSignedIn } from '../auth.js';
import { isFirebaseConfigured } from '../config.js';
import { openGame } from './player.js';

/** The headline number for a game depends on what "doing well" means in it. */
function headline(game, rec) {
  if (game.progressKind === 'match') return { value: rec.wins, label: 'wins' };
  if (game.progressKind === 'levels') return { value: rec.levelsCleared.length, label: `of ${game.levels.length} tiers` };
  return { value: rec.bestScore, label: 'best' };
}

/** 0..1 completion used for the thin bar under each row. */
function fillRatio(game, rec, all) {
  if (game.progressKind === 'levels') return rec.levelsCleared.length / game.levels.length;
  if (game.progressKind === 'match') return rec.plays ? rec.wins / rec.plays : 0;
  const best = Math.max(...GAMES.map((g) => (g.progressKind ? 0 : all[g.id].bestScore)), 1);
  return rec.bestScore / best;
}

function renderStrip() {
  const t = totals();
  const host = document.getElementById('stat-strip');
  if (!t.plays) { host.innerHTML = ''; host.className = ''; return; }
  host.className = 'stat-strip';
  host.innerHTML = `
    <div class="stat"><div class="stat-val">${fmtNumber(t.plays)}</div><div class="stat-lbl">Runs played</div></div>
    <div class="stat"><div class="stat-val">${t.played}<span style="color:var(--faint);font-size:18px">/${GAMES.length}</span></div><div class="stat-lbl">Games tried</div></div>
    <div class="stat"><div class="stat-val">${esc(fmtDuration(t.timeSec))}</div><div class="stat-lbl">Time played</div></div>
    <div class="stat"><div class="stat-val">${fmtNumber(t.wins + t.levels)}</div><div class="stat-lbl">Wins &amp; tiers</div></div>`;
}

function renderBody() {
  const all = getAll();
  const recent = getRecent();
  const host = document.getElementById('progress-body');
  const anyPlays = Object.values(all).some((r) => r.plays > 0);

  if (!anyPlays) {
    host.innerHTML = `
      <div class="panel empty">
        <h3>No runs yet</h3>
        <p>Play any game above and your scores show up here automatically.</p>
      </div>`;
    return;
  }

  const rows = GAMES.map((game) => {
    const rec = all[game.id];
    const h = headline(game, rec);
    const pct = Math.min(100, Math.round(fillRatio(game, rec, all) * 100));
    const sub = rec.plays
      ? `${fmtNumber(rec.plays)} ${rec.plays === 1 ? 'run' : 'runs'} &middot; ${esc(fmtDuration(rec.timeSec))} played &middot; ${esc(fmtRelative(rec.lastPlayedAt))}`
      : 'Not played yet';

    return `
      <div class="prow">
        <div>
          <div class="prow-name"><i class="prow-swatch" style="background:${esc(game.accent)}"></i>${esc(game.title)}</div>
          <div class="prow-sub">${sub}</div>
          <div class="bar"><i style="width:${pct}%;background:linear-gradient(90deg,${esc(game.accent)},${esc(game.accent2)})"></i></div>
        </div>
        <div class="prow-score">
          <b>${fmtNumber(h.value)}</b>
          <span>${esc(h.label)}</span>
        </div>
      </div>`;
  }).join('');

  const feed = recent.length
    ? recent.slice(0, 10).map((s) => {
        const game = GAME_BY_ID[s.gameId];
        if (!game) return '';
        const when = s.at?.toMillis ? s.at.toMillis() : (s.atMs || s.at);
        return `
          <div class="feed-item">
            <div>${esc(game.title)}<small>${esc(fmtRelative(when))}${s.level ? ` &middot; ${esc(s.level)}` : ''}</small></div>
            <div class="feed-score ${s.won ? 'win' : ''}">${s.won && game.progressKind === 'match' ? 'WIN' : fmtNumber(s.score)}</div>
          </div>`;
      }).join('')
    : `<p style="color:var(--faint);font-size:13px">Your last runs will appear here.</p>`;

  host.innerHTML = `
    <div class="progress-layout">
      <div class="panel">${rows}</div>
      <div class="panel">
        <h3 style="font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:14px">Recent runs</h3>
        <div class="feed">${feed}</div>
      </div>
    </div>`;
}

function renderSub() {
  const el = document.getElementById('progress-sub');
  const mode = document.getElementById('storage-mode');
  if (!isFirebaseConfigured) {
    el.textContent = 'Saved on this device. Add Firebase keys to .env to sync across devices.';
    mode.textContent = 'Local storage mode';
  } else if (!isSignedIn()) {
    el.textContent = 'Saved on this device. Sign in to sync your scores everywhere.';
    mode.textContent = 'Local storage mode';
  } else if (isGuest()) {
    el.textContent = 'Playing as a guest — create an account to keep this progress for good.';
    mode.textContent = 'Guest session · synced';
  } else {
    el.textContent = 'Synced to your account across every device you sign in on.';
    mode.textContent = 'Synced to your account';
  }
}

export function renderProgressView() {
  const paint = () => { renderStrip(); renderBody(); renderSub(); };
  onProgress(paint);
  onAuth(paint);
  document.getElementById('progress-body').addEventListener('click', (e) => {
    const row = e.target.closest('[data-open]');
    if (row) openGame(row.dataset.open);
  });
}
