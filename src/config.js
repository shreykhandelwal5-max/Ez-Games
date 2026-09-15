/**
 * Reads configuration out of the Vite env (`.env`) and reports whether the
 * platform has enough of it to talk to Firebase.
 *
 * The whole app is designed to stay usable when Firebase is not configured:
 * in that case we fall back to local-only progress so the arcade still works
 * for a visitor (see `progress.js`).
 */
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

export const missingKeys = REQUIRED.filter((k) => !firebaseConfig[k]);
export const isFirebaseConfigured = missingKeys.length === 0;
export const analyticsEnabled = isFirebaseConfigured && !!firebaseConfig.measurementId;

const flag = (v, fallback) => (v === undefined ? fallback : String(v) !== 'false');
export const features = {
  guest: flag(env.VITE_ENABLE_GUEST, true),
  google: flag(env.VITE_ENABLE_GOOGLE, true),
};
