import { esc } from './dom.js';

const host = () => document.getElementById('toasts');

export function toast(message, kind = '', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.innerHTML = esc(message);
  host().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}
