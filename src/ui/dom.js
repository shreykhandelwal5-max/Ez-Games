/** Minimal DOM helpers shared by the UI modules. */

export const $ = (sel, root = document) => root.querySelector(sel);

/** Escapes untrusted text before it goes into an innerHTML template. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function fmtNumber(n) {
  return new Intl.NumberFormat().format(Math.round(n || 0));
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtRelative(ms) {
  if (!ms) return 'never';
  const diff = Date.now() - ms;
  if (diff < 60e3) return 'just now';
  const mins = Math.floor(diff / 60e3);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

export const initials = (name) => (String(name || 'P').trim()[0] || 'P').toUpperCase();

/**
 * Locks page scroll without shifting layout, and returns the undo function.
 * `scrollbar-gutter: stable` on <html> keeps the gutter reserved, so there is
 * no horizontal jump when the scrollbar disappears.
 */
export function lockScroll() {
  const y = window.scrollY;
  document.body.classList.add('is-locked');
  return () => {
    document.body.classList.remove('is-locked');
    window.scrollTo({ top: y, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  };
}

/** Keeps Tab focus inside `container` while it is open. */
export function trapFocus(container) {
  const SELECTOR = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(SELECTOR)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  container.addEventListener('keydown', onKey);
  return () => container.removeEventListener('keydown', onKey);
}
