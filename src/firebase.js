/**
 * Lazy Firebase bootstrap.
 *
 * Nothing here is imported at module-evaluation time: every getter dynamically
 * imports only the SDK surface it needs, the first time it is needed. That
 * keeps the initial paint free of ~150KB of Firebase JS -- the arcade grid is
 * interactive before auth has finished loading.
 */
import { firebaseConfig, isFirebaseConfigured, analyticsEnabled } from './config.js';

let appPromise = null;
let authPromise = null;
let dbPromise = null;
let analyticsPromise = null;

function getApp() {
  if (!isFirebaseConfigured) return null;
  if (!appPromise) {
    appPromise = import('firebase/app').then(({ initializeApp, getApps, getApp: get }) =>
      getApps().length ? get() : initializeApp(firebaseConfig)
    );
  }
  return appPromise;
}

export async function getAuthSdk() {
  const app = getApp();
  if (!app) return null;
  if (!authPromise) {
    authPromise = (async () => {
      const [sdk, resolvedApp] = await Promise.all([import('firebase/auth'), app]);
      return { sdk, auth: sdk.getAuth(resolvedApp) };
    })();
  }
  return authPromise;
}

export async function getDb() {
  const app = getApp();
  if (!app) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const [sdk, resolvedApp] = await Promise.all([import('firebase/firestore'), app]);
      let db;
      try {
        // Multi-tab offline cache: progress written while offline syncs later,
        // and repeat visits read from disk instead of the network.
        db = sdk.initializeFirestore(resolvedApp, {
          localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }),
        });
      } catch {
        db = sdk.getFirestore(resolvedApp);
      }
      return { sdk, db };
    })();
  }
  return dbPromise;
}

export async function getAnalyticsSdk() {
  if (!analyticsEnabled) return null;
  const app = getApp();
  if (!app) return null;
  if (!analyticsPromise) {
    analyticsPromise = (async () => {
      try {
        const [sdk, resolvedApp] = await Promise.all([import('firebase/analytics'), app]);
        if (!(await sdk.isSupported())) return null;
        return { sdk, analytics: sdk.getAnalytics(resolvedApp) };
      } catch {
        return null;
      }
    })();
  }
  return analyticsPromise;
}

export { isFirebaseConfigured };
