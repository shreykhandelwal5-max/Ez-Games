/**
 * Thin analytics facade. Calls are fire-and-forget and never throw, so a
 * blocked tracker or a missing measurement id can't break gameplay.
 */
import { getAnalyticsSdk } from './firebase.js';

export function track(event, params = {}) {
  getAnalyticsSdk()
    .then((a) => a && a.sdk.logEvent(a.analytics, event, params))
    .catch(() => {});
}

export function identify(uid, props = {}) {
  getAnalyticsSdk()
    .then((a) => {
      if (!a) return;
      if (uid) a.sdk.setUserId(a.analytics, uid);
      if (Object.keys(props).length) a.sdk.setUserProperties(a.analytics, props);
    })
    .catch(() => {});
}

export function trackPage(name) {
  track('page_view', { page_title: name, page_location: location.href });
}
