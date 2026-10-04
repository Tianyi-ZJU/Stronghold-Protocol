import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';

export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
});

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function errorPage(status, title, detail = '') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · 卫戍协议：盟约</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111614;color:#d8e3de;font:16px/1.6 "Noto Sans SC",system-ui,sans-serif}
main{border:1px solid #2c3a35;padding:32px 40px;max-width:520px;text-align:center}h1{margin:0;color:#4ed8af;font-size:56px;letter-spacing:4px}
p{margin:8px 0}a{color:#4ed8af}</style></head><body><main><h1>${status}</h1><p>${escapeHtml(title)}</p>
${detail ? `<p style="opacity:.6">${escapeHtml(detail)}</p>` : ''}<p><a href="/">返回首页 · Back to home</a></p></main></body></html>`;
}

function errorContent(status, title, detail) {
  const body = Buffer.from(errorPage(status, title, detail));
  return {
    body,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    },
  };
}

export function errorResponse(status, title, detail) {
  const { body, headers } = errorContent(status, title, detail);
  return new Response(body, { status, headers });
}

export function sendError(req, res, status, title, detail) {
  if (res.headersSent) { res.destroy(); return; }
  const { body, headers } = errorContent(status, title, detail);
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function alreadySentResponse(outgoing) {
  return new Response(null, { status: outgoing.statusCode, headers: RESPONSE_ALREADY_SENT.headers });
}
