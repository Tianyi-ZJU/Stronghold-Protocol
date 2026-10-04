import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getRequestListener, RequestError } from '@hono/node-server';
import { securityHeaders, requestPolicy, requestLogging } from './middleware.js';
import { alreadySentResponse, errorResponse } from './response.js';
import { healthRoute } from './routes/health.js';
import { splitUrl } from './url.js';

const noopLog = { error() {}, debug() {} };

export function createHttpApp({ serveStatic, getHealth, log = noopLog }) {
  const app = new Hono({
    getPath: (request, { env }) => splitUrl(env?.incoming?.url ?? request.url)?.rawPath || '/',
  });
  app.use('*', securityHeaders);
  app.use('*', requestLogging(log));
  app.use('*', requestPolicy);
  app.get('/healthz', healthRoute(getHealth));
  app.all('*', async context => {
    const { incoming, outgoing } = context.env;
    const { rawPath, query } = context.get('urlParts');
    await serveStatic(incoming, outgoing, rawPath, query);
    return alreadySentResponse(outgoing);
  });
  app.onError((error, context) => {
    const outgoing = context.env?.outgoing;
    if (outgoing?.headersSent) {
      log.error('[http] request failed', error);
      outgoing.destroy();
      return alreadySentResponse(outgoing);
    }
    if (error instanceof HTTPException) return error.getResponse();
    log.error('[http] request failed', error);
    return errorResponse(500, '服务器内部错误 · Internal error');
  });
  return app;
}

export function createHttpListener(app, { log = noopLog } = {}) {
  return getRequestListener(app.fetch, {
    hostname: 'localhost',
    overrideGlobalObjects: false,
    errorHandler(error) {
      if (error instanceof RequestError) return errorResponse(400, '请求地址无效 · Bad request');
      log.error('[http] adapter failed', error);
      return errorResponse(500, '服务器内部错误 · Internal error');
    },
  });
}
