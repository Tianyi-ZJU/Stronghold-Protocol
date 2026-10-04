import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { watchPresence } from '../presence.js';

export function OnlinePill() {
  const [presence, setPresence] = useState(null);
  useEffect(() => {
    const watcher = watchPresence(setPresence);
    return () => watcher.stop();
  }, []);
  return html`<a class="online-pill" href="./online/" target="_blank" rel="noopener"
    title=${presence ? '查看在线人数 · 每 5 秒更新' : '正在获取在线人数'}>
    <${Icon} name="users" />
    <span>在线 <b class="num">${presence?.online ?? '—'}</b> 人</span>
  </a>`;
}
