/** The nav account chip: sign-in button when signed out, menu when signed in. */
import { esc, initials } from './dom.js';
import { toast } from './toast.js';
import * as auth from '../auth.js';
import { isFirebaseConfigured } from '../config.js';
import { openAuth } from './authModal.js';

const root = () => document.getElementById('account');
let menuOpen = false;

function render() {
  const el = root();
  const user = auth.state.user;

  if (!auth.state.ready) { el.innerHTML = ''; return; }

  if (!user) {
    el.innerHTML = `
      <button class="btn btn-primary btn-sm" data-act="signin">
        ${isFirebaseConfigured ? 'Sign in' : 'Accounts off'}
      </button>`;
    el.querySelector('[data-act="signin"]').addEventListener('click', () => openAuth('signin'));
    return;
  }

  const name = auth.displayName(user);
  const guest = user.isAnonymous;
  const photo = user.photoURL;

  el.innerHTML = `
    <button class="account-btn" data-act="menu" aria-haspopup="true" aria-expanded="false">
      <span class="avatar">${photo ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" />` : esc(initials(name))}</span>
      <span class="account-name">${esc(name)}</span>
      ${guest ? '<span class="badge">Guest</span>' : ''}
    </button>
    <div class="menu" id="account-menu">
      <div class="menu-head">
        <strong>${esc(name)}</strong>
        <span>${esc(user.email || (guest ? 'Not saved to an account' : ''))}</span>
      </div>
      ${guest ? '<button class="menu-item" data-act="upgrade">Save my progress</button>' : ''}
      <button class="menu-item" data-act="progress">My progress</button>
      <button class="menu-item danger" data-act="signout">Sign out</button>
    </div>`;

  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
}

function onAction(e) {
  const act = e.currentTarget.dataset.act;
  if (act === 'menu') return toggleMenu();
  closeMenu();
  if (act === 'upgrade') return openAuth('signup');
  if (act === 'progress') {
    return document.getElementById('progress').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (act === 'signout') {
    auth.signOutUser().then(() => toast('Signed out.')).catch(() => toast('Could not sign out.', 'bad'));
  }
}

function toggleMenu() { menuOpen ? closeMenu() : openMenu(); }

function openMenu() {
  document.getElementById('account-menu')?.classList.add('open');
  root().querySelector('[data-act="menu"]')?.setAttribute('aria-expanded', 'true');
  menuOpen = true;
  setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
  document.addEventListener('keydown', onEsc);
}

function closeMenu() {
  document.getElementById('account-menu')?.classList.remove('open');
  root().querySelector('[data-act="menu"]')?.setAttribute('aria-expanded', 'false');
  menuOpen = false;
  document.removeEventListener('mousedown', onOutside);
  document.removeEventListener('keydown', onEsc);
}

function onOutside(e) { if (!root().contains(e.target)) closeMenu(); }
function onEsc(e) { if (e.key === 'Escape') closeMenu(); }

export function renderAccount() {
  auth.onAuth(render);
  render();
}
