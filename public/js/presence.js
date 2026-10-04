// Shared polling for the lobby badge and the read-only player-count page.
export async function fetchPresence(signal) {
  const response = await fetch('/healthz', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('在线人数暂时不可用');
  const health = await response.json();
  const p = health.presence;
  if (!p || !['online', 'lobby', 'waiting', 'playing'].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0))
    throw new Error('在线人数暂时不可用');
  return { ...p, rooms: health.rooms, matches: health.matches };
}

export function watchPresence(onChange) {
  let stopped = false;
  let pending = false;
  let controller = null;
  let timer = null;
  const refresh = async () => {
    if (stopped || pending || document.visibilityState === 'hidden') return;
    pending = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 5000);
    try {
      const data = await fetchPresence(controller.signal);
      if (!stopped) onChange(data);
    } catch {
      if (!stopped) onChange(null);
    } finally {
      clearTimeout(timeout);
      pending = false;
      controller = null;
    }
  };
  const visible = () => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', visible);
  timer = setInterval(refresh, 5000);
  refresh();
  return {
    refresh,
    stop() {
      stopped = true;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
