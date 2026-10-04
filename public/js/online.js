import { watchPresence } from './presence.js';

const status = document.getElementById('status');
const watcher = watchPresence(data => {
  document.querySelectorAll('[data-stat]').forEach(el => {
    el.textContent = data?.[el.dataset.stat] ?? '—';
  });
  status.classList.toggle('is-error', !data);
  status.textContent = data
    ? `每 5 秒更新 · 最近更新 ${new Date().toLocaleTimeString('zh-CN')}`
    : '暂时无法获取人数，正在自动重试…';
});
document.getElementById('refresh').addEventListener('click', () => watcher.refresh());
window.addEventListener('pagehide', () => watcher.stop(), { once: true });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
