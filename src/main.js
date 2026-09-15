/**
 * App entry point.
 *
 * Order matters for perceived speed: the library grid renders from the local
 * manifest and localStorage synchronously, so the arcade is interactive on the
 * first frame. Firebase (auth, Firestore, analytics) is imported lazily and
 * folds its results in afterwards.
 */
import './styles.css';

import { renderLibrary } from './ui/library.js';
import { renderProgressView } from './ui/progressView.js';
import { renderAccount } from './ui/account.js';
import { openAuth } from './ui/authModal.js';
import { openGame } from './ui/player.js';
import { onAuth, initAuth, isSignedIn, state as authState } from './auth.js';
import { syncForUser } from './progress.js';
import { isFirebaseConfigured, missingKeys } from './config.js';
import { trackPage, identify } from './analytics.js';
import { GAME_BY_ID } from './games.js';
import { esc } from './ui/dom.js';

// --- 1. Paint immediately, from local data only -----------------------------

renderLibrary();
renderProgressView();
renderAccount();
wireNav();
showConfigBanner();

// --- 2. Bring Firebase online in the background -----------------------------

onAuth(({ user }) => {
  syncForUser(user);
  updateHeroCta();
  if (user) identify(user.uid, { account_type: user.isAnonymous ? 'guest' : 'registered' });
});

initAuth();
trackPage('Arcade home');

// --- helpers ----------------------------------------------------------------

function wireNav() {
  // Smooth in-page navigation; nothing here ever changes documents.
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-scroll]');
    if (!target) return;
    document.getElementById(target.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.getElementById('hero-cta').addEventListener('click', () => {
    if (isSignedIn() && !authState.user?.isAnonymous) {
      document.getElementById('progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      openAuth(authState.user?.isAnonymous ? 'signup' : 'signin');
    }
  });

  // Highlight the nav link for whichever section is in view.
  const links = [...document.querySelectorAll('.nav-link')];
  const sections = links
    .map((l) => document.getElementById(l.dataset.scroll))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          links.forEach((l) => l.classList.toggle('active', l.dataset.scroll === entry.target.id));
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach((s) => observer.observe(s));
  }

  // Deep links: /#play=zen-snake opens straight into a game.
  const match = /(?:^|[#&])play=([\w-]+)/.exec(location.hash);
  if (match && GAME_BY_ID[match[1]]) {
    // Let the first paint land before mounting a game frame.
    requestAnimationFrame(() => openGame(match[1]));
  }
}

function updateHeroCta() {
  const btn = document.getElementById('hero-cta');
  if (!btn) return;
  if (!isFirebaseConfigured) { btn.hidden = true; return; }
  if (!isSignedIn()) { btn.textContent = 'Sign in to save progress'; return; }
  btn.textContent = authState.user?.isAnonymous ? 'Save my guest progress' : 'View my progress';
}

function showConfigBanner() {
  if (isFirebaseConfigured) return;
  document.getElementById('config-banner').innerHTML = `
    <div class="banner">
      <span>&#9888;</span>
      <div>
        <b>Running without Firebase.</b> Scores save to this browser only, and accounts are disabled.
        Copy <code>.env.example</code> to <code>.env</code> and fill in
        ${missingKeys.map((k) => `<code>VITE_FIREBASE_${esc(k.replace(/([A-Z])/g, '_$1').toUpperCase())}</code>`).join(', ')}
        to turn on sign-in, cross-device sync and analytics.
      </div>
    </div>`;
}
