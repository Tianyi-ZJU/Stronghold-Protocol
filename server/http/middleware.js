import { SECURITY_HEADERS, errorResponse } from './response.js';
import { splitUrl } from './url.js';

const MAX_URL_LENGTH = 4096;

export async function securityHeaders(context, next) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    context.env?.outgoing?.setHeader(name, value);
  }
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
}

export async function requestPolicy(context, next) {
  const url = context.env?.incoming?.url ?? context.req.url;
  if (url.length > MAX_URL_LENGTH) return errorResponse(414, '请求地址过长 · URI too long');
  const parts = splitUrl(url);
  if (!parts) return errorResponse(400, '请求地址无效 · Bad request');
  context.set('urlParts', parts);
  const method = context.env?.incoming?.method ?? context.req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const response = errorResponse(405, '不支持的请求方法 · Method not allowed');
    response.headers.set('Allow', 'GET, HEAD');
    return response;
  }
  await next();
}

export function requestLogging(log) {
  return async (context, next) => {
    const startedAt = Date.now();
    await next();
    const outgoing = context.env?.outgoing;
    log.debug?.('[http]', {
      method: context.req.method,
      path: context.get('urlParts')?.rawPath ?? context.req.path,
      status: outgoing?.headersSent ? outgoing.statusCode : context.res.status,
      durationMs: Date.now() - startedAt,
    });
  };
}
