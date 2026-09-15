/**
 * Auth store. Exposes a tiny observable over the current user plus the small
 * set of sign-in flows the arcade needs. Guests (anonymous auth) are first
 * class: they can play and accumulate progress immediately, and later upgrade
 * to a permanent account without losing any of it (see `upgradeGuest`).
 */
import { getAuthSdk } from './firebase.js';
import { isFirebaseConfigured, features } from './config.js';
import { identify, track } from './analytics.js';

const listeners = new Set();

export const state = {
  ready: false,     // has the first auth callback landed yet?
  user: null,       // firebase user, or null when signed out
};

function emit() {
  listeners.forEach((fn) => {
    try { fn(state); } catch { /* a bad subscriber must not break the rest */ }
  });
}

export function onAuth(fn) {
  listeners.add(fn);
  if (state.ready) fn(state);
  return () => listeners.delete(fn);
}

export const isGuest = () => !!state.user?.isAnonymous;
export const isSignedIn = () => !!state.user;

export function displayName(user = state.user) {
  if (!user) return 'Guest';
  if (user.isAnonymous) return 'Guest Player';
  return user.displayName || (user.email ? user.email.split('@')[0] : 'Player');
}

export async function initAuth() {
  if (!isFirebaseConfigured) {
    // Local-only mode: no accounts, but the arcade and local progress still work.
    state.ready = true;
    emit();
    return;
  }
  const a = await getAuthSdk();
  a.sdk.onAuthStateChanged(a.auth, (user) => {
    state.ready = true;
    state.user = user;
    if (user) {
      identify(user.uid, { account_type: user.isAnonymous ? 'guest' : 'registered' });
    }
    emit();
  });
}

/** Maps Firebase's error codes onto messages a player can actually act on. */
export function friendlyError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/missing-password': 'Please enter your password.',
    'auth/weak-password': 'Passwords need to be at least 6 characters.',
    'auth/email-already-in-use': 'That email already has an account — try signing in.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'No account found for that email.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/popup-closed-by-user': 'Sign-in window was closed before finishing.',
    'auth/popup-blocked': 'Your browser blocked the sign-in popup. Allow popups and retry.',
    'auth/network-request-failed': 'Network problem — check your connection and retry.',
    'auth/operation-not-allowed': 'That sign-in method is not enabled for this project yet.',
    'auth/admin-restricted-operation': 'Guest play is not enabled for this project yet.',
    'auth/credential-already-in-use': 'That account already exists — sign in with it instead.',
  };
  return map[code] || err?.message?.replace('Firebase: ', '') || 'Something went wrong. Please try again.';
}

export async function signUp(email, password, name) {
  const { sdk, auth } = await getAuthSdk();
  const cred = await sdk.createUserWithEmailAndPassword(auth, email, password);
  if (name) await sdk.updateProfile(cred.user, { displayName: name });
  track('sign_up', { method: 'password' });
  return cred.user;
}

export async function signIn(email, password) {
  const { sdk, auth } = await getAuthSdk();
  const cred = await sdk.signInWithEmailAndPassword(auth, email, password);
  track('login', { method: 'password' });
  return cred.user;
}

export async function signInWithGoogle() {
  if (!features.google) throw new Error('Google sign-in is disabled.');
  const { sdk, auth } = await getAuthSdk();
  const provider = new sdk.GoogleAuthProvider();
  const current = auth.currentUser;
  // A guest who signs in with Google keeps their progress via account linking.
  if (current?.isAnonymous) {
    try {
      const cred = await sdk.linkWithPopup(current, provider);
      track('login', { method: 'google', upgraded_guest: true });
      return cred.user;
    } catch (err) {
      if (err?.code !== 'auth/credential-already-in-use') throw err;
    }
  }
  const cred = await sdk.signInWithPopup(auth, provider);
  track('login', { method: 'google' });
  return cred.user;
}

export async function playAsGuest() {
  if (!features.guest) throw new Error('Guest play is disabled.');
  const { sdk, auth } = await getAuthSdk();
  const cred = await sdk.signInAnonymously(auth);
  track('login', { method: 'anonymous' });
  return cred.user;
}

/** Converts the signed-in anonymous user into a permanent email account. */
export async function upgradeGuest(email, password, name) {
  const { sdk, auth } = await getAuthSdk();
  const current = auth.currentUser;
  if (!current?.isAnonymous) return signUp(email, password, name);
  const credential = sdk.EmailAuthProvider.credential(email, password);
  const result = await sdk.linkWithCredential(current, credential);
  if (name) await sdk.updateProfile(result.user, { displayName: name });
  track('sign_up', { method: 'password', upgraded_guest: true });
  return result.user;
}

export async function resetPassword(email) {
  const { sdk, auth } = await getAuthSdk();
  await sdk.sendPasswordResetEmail(auth, email);
  track('password_reset_request');
}

export async function signOutUser() {
  const { sdk, auth } = await getAuthSdk();
  await sdk.signOut(auth);
  track('logout');
}
