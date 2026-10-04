/** Split an absolute request URL into raw path + query (also accepts absolute-form URLs). */
export function splitUrl(url) {
  let u = url || '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try { const parsed = new URL(u); u = parsed.pathname + parsed.search; } catch { return null; }
  }
  const q = u.indexOf('?');
  const hashless = (s) => { const h = s.indexOf('#'); return h >= 0 ? s.slice(0, h) : s; };
  return q >= 0 ? { rawPath: hashless(u.slice(0, q)), query: hashless(u.slice(q + 1)) } : { rawPath: hashless(u), query: '' };
}
