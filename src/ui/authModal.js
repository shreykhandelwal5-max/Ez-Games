/**
 * Sign-in / sign-up / password-reset modal.
 *
 * One element, three modes. When a guest is already playing, the sign-up mode
 * links the new credentials onto the anonymous account so their scores survive.
 */
import { esc, trapFocus, lockScroll } from './dom.js';
import { toast } from './toast.js';
import * as auth from '../auth.js';
import { features, isFirebaseConfigured } from '../config.js';
import { track } from '../analytics.js';

const root = () => document.getElementById('auth-modal');

let mode = 'signin';       // 'signin' | 'signup' | 'reset'
let releaseFocus = null;
let unlockScroll = null;
let lastFocused = null;
let busy = false;

const COPY = {
  signin: { title: 'Welcome back', sub: 'Sign in to sync your scores across devices.', action: 'Sign in' },
  signup: { title: 'Create your account', sub: 'Keep every score, streak and level you clear.', action: 'Create account' },
  reset: { title: 'Reset your password', sub: 'We will email you a link to set a new one.', action: 'Send reset link' },
};

function render() {
  const c = COPY[mode];
  const upgrading = auth.isGuest();
  const el = root();

  el.innerHTML = `
    <div class="modal-wrap">
      <button class="modal-close" data-act="close" aria-label="Close">&times;</button>
      <div class="modal">
        <h2 id="auth-title">${esc(upgrading && mode === 'signup' ? 'Save your progress' : c.title)}</h2>
        <p class="sub">${esc(upgrading && mode === 'signup'
          ? 'Create an account and the scores you just earned come with you.'
          : c.sub)}</p>

        <div id="auth-msg"></div>

        <form id="auth-form" novalidate>
          ${mode === 'signup' ? `
            <div class="field">
              <label for="au-name">Display name</label>
              <input id="au-name" name="name" type="text" autocomplete="nickname" placeholder="Player One" maxlength="40" />
            </div>` : ''}

          <div class="field">
            <label for="au-email">Email</label>
            <input id="au-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" />
          </div>

          ${mode !== 'reset' ? `
            <div class="field">
              <label for="au-pass">Password</label>
              <input id="au-pass" name="password" type="password" required minlength="6"
                     autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
                     placeholder="At least 6 characters" />
            </div>` : ''}

          <button class="btn btn-primary btn-block" type="submit" id="auth-submit">${esc(c.action)}</button>
        </form>

        ${mode !== 'reset' && (features.google || features.guest) ? `
          <div class="divider">or</div>
          ${features.google ? `<button class="btn btn-block" data-act="google" style="margin-bottom:10px">
            <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-3.9H24v7.1h12c-.2 1.9-1.5 4.7-4.4 6.6l6.7 5.2C42.2 35.5 45 30.3 45 24z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 40.8 15.4 46 24 46z"/><path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.8-2.8-.8-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z"/><path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8 7.2 4.4 14.1l7.1 5.5C13.3 14.4 18.2 10.6 24 10.6z"/></svg>
            Continue with Google</button>` : ''}
          ${features.guest && !upgrading ? `<button class="btn btn-ghost btn-block" data-act="guest">Play as guest</button>` : ''}
        ` : ''}

        <div class="modal-foot">
          ${mode === 'signin'
            ? `<button class="link-btn" data-act="mode" data-mode="reset">Forgot password?</button>
               <div style="margin-top:6px">New here? <button class="link-btn" data-act="mode" data-mode="signup">Create an account</button></div>`
            : mode === 'signup'
              ? `Already have an account? <button class="link-btn" data-act="mode" data-mode="signin">Sign in</button>`
              : `<button class="link-btn" data-act="mode" data-mode="signin">Back to sign in</button>`}
        </div>
      </div>
    </div>`;

  el.querySelector('#auth-form').addEventListener('submit', onSubmit);
  el.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', onAction));
  setTimeout(() => el.querySelector('input')?.focus(), 60);
}

function message(text, kind = 'error') {
  const box = document.getElementById('auth-msg');
  if (box) box.innerHTML = text ? `<div class="${kind === 'error' ? 'form-error' : 'form-note'}">${esc(text)}</div>` : '';
}

function setBusy(on, label) {
  busy = on;
  const btn = document.getElementById('auth-submit');
  if (btn) {
    btn.disabled = on;
    btn.textContent = on ? (label || 'Working…') : COPY[mode].action;
  }
}

function onAction(e) {
  const act = e.currentTarget.dataset.act;
  if (act === 'close') return close();
  if (act === 'mode') { mode = e.currentTarget.dataset.mode; render(); return; }
  if (act === 'google') return run(() => auth.signInWithGoogle(), 'Signed in.');
  if (act === 'guest') return run(() => auth.playAsGuest(), 'Playing as a guest — your scores save on this device.');
}

async function run(fn, successMessage) {
  if (busy) return;
  setBusy(true);
  message('');
  try {
    await fn();
    close();
    toast(successMessage, 'good');
  } catch (err) {
    message(auth.friendlyError(err));
  } finally {
    setBusy(false);
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (busy) return;
  const data = new FormData(e.target);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const name = String(data.get('name') || '').trim();

  if (!email) return message('Please enter your email address.');
  if (mode !== 'reset' && password.length < 6) return message('Passwords need to be at least 6 characters.');

  if (mode === 'reset') {
    setBusy(true, 'Sending…');
    try {
      await auth.resetPassword(email);
      message('Check your inbox for the reset link.', 'note');
    } catch (err) {
      message(auth.friendlyError(err));
    } finally {
      setBusy(false);
    }
    return;
  }

  if (mode === 'signup') {
    // A guest upgrading keeps the same uid, so their progress carries over.
    return run(
      () => (auth.isGuest() ? auth.upgradeGuest(email, password, name) : auth.signUp(email, password, name)),
      'Account created — your progress is saved.'
    );
  }
  return run(() => auth.signIn(email, password), 'Welcome back.');
}

export function openAuth(nextMode = 'signin') {
  if (!isFirebaseConfigured) {
    toast('Add your Firebase keys to .env to enable accounts. Progress is saving locally for now.', '', 5200);
    return;
  }
  mode = nextMode;
  lastFocused = document.activeElement;
  const el = root();
  el.hidden = false;
  render();
  requestAnimationFrame(() => el.classList.add('open'));
  unlockScroll = lockScroll();
  releaseFocus = trapFocus(el);
  el.addEventListener('mousedown', onBackdrop);
  document.addEventListener('keydown', onEsc);
  track('auth_modal_open', { mode: nextMode });
}

function onBackdrop(e) { if (e.target === root()) close(); }
function onEsc(e) { if (e.key === 'Escape') close(); }

export function close() {
  const el = root();
  if (el.hidden) return;
  el.classList.remove('open');
  el.removeEventListener('mousedown', onBackdrop);
  document.removeEventListener('keydown', onEsc);
  releaseFocus?.();
  unlockScroll?.();
  releaseFocus = unlockScroll = null;
  setTimeout(() => { el.hidden = true; el.innerHTML = ''; }, 240);
  lastFocused?.focus?.();
}
