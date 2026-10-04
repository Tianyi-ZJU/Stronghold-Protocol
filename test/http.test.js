import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { HTTPException } from 'hono/http-exception';
import { createHttpApp, createHttpListener } from '../server/http/app.js';

async function fixture(context, options = {}) {
  const errors = [];
  const requests = [];
  const log = {
    error: (...args) => errors.push(args),
    debug: (...args) => requests.push(args),
  };
  const app = createHttpApp({
    getHealth: () => ({ ok: true, presence: { online: 2 } }),
    serveStatic: async (incoming, outgoing) => {
      outgoing.writeHead(404, { 'Content-Type': 'text/plain' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : 'missing');
    },
    ...options,
    log,
  });
  const server = http.createServer(createHttpListener(app, { log }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  });
  return { server, port: server.address().port, errors, requests };
}

function request(port, path, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const clientRequest = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, clientResponse => {
      const chunks = [];
      clientResponse.on('data', chunk => chunks.push(chunk));
      clientResponse.on('error', () => {});
      clientResponse.on('close', () => resolve({
        status: clientResponse.statusCode,
        headers: clientResponse.headers,
        body: Buffer.concat(chunks).toString(),
        complete: clientResponse.complete,
      }));
    });
    clientRequest.on('error', reject);
    clientRequest.end();
  });
}

function assertSecurity(response) {
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'same-origin');
  assert.equal(response.headers['x-hono-already-sent'], undefined);
}

test('health GET/HEAD preserve headers and body length without replacing global Fetch constructors', async context => {
  const originalRequest = globalThis.Request;
  const originalResponse = globalThis.Response;
  const fixtureServer = await fixture(context);
  const response = await request(fixtureServer.port, '/healthz?refresh=1');
  assert.equal(response.status, 200);
  assertSecurity(response);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(response.body));
  assert.deepEqual(JSON.parse(response.body), { ok: true, presence: { online: 2 } });
  const head = await request(fixtureServer.port, '/healthz', 'HEAD');
  assertSecurity(head);
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-length'], response.headers['content-length']);
  assert.equal(globalThis.Request, originalRequest);
  assert.equal(globalThis.Response, originalResponse);
  assert.deepEqual(fixtureServer.errors, []);
});

test('method and URL limits apply to HTTP routes and static requests', async context => {
  const fixtureServer = await fixture(context);
  for (const path of ['/healthz', '/assets/model.skel']) {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']) {
      const response = await request(fixtureServer.port, path, method);
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(response.headers.allow, 'GET, HEAD');
      assert.equal(response.headers['cache-control'], 'no-store');
      assertSecurity(response);
    }
  }
  for (const path of ['/' + 'x'.repeat(4096), '/healthz?q=' + 'x'.repeat(4096)]) {
    const response = await request(fixtureServer.port, path);
    assert.equal(response.status, 414);
    assertSecurity(response);
  }
  assert.deepEqual(fixtureServer.errors, []);
});

test('routing preserves undecoded paths before static traversal checks and omits queries from logs', async context => {
  const paths = [];
  const fixtureServer = await fixture(context, {
    serveStatic: async (incoming, outgoing, rawPath, query) => {
      paths.push({ rawPath, query });
      outgoing.writeHead(403);
      outgoing.end('blocked');
    },
  });
  for (const path of ['/health%7a', '/healthz/', '/other/../healthz', '/%2e%2e/healthz', '//healthz', '/..%2fhealthz']) {
    const response = await request(fixtureServer.port, path + '?token=private');
    assert.equal(response.status, 403, path);
    assertSecurity(response);
    assert.deepEqual(paths.at(-1), { rawPath: path, query: 'token=private' });
    assert.deepEqual(fixtureServer.requests.at(-1).slice(0, 1), ['[http]']);
    assert.equal(fixtureServer.requests.at(-1)[1].path, path);
    assert.equal(fixtureServer.requests.at(-1)[1].status, 403);
    assert.ok(!JSON.stringify(fixtureServer.requests.at(-1)).includes('private'));
  }
  assert.equal((await request(fixtureServer.port, 'http://example.test/healthz?refresh=1')).status, 200);
  assert.deepEqual(fixtureServer.errors, []);
});

test('HTTP/1.0 without a Host header still reaches the application', async context => {
  const fixtureServer = await fixture(context);
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: fixtureServer.port });
    let body = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('GET /healthz HTTP/1.0\r\n\r\n'));
    socket.on('data', chunk => { body += chunk; });
    socket.on('error', reject);
    socket.on('end', () => resolve(body));
  });
  assert.match(response, /^HTTP\/1\.1 200/);
  assert.match(response, /"online":2/);
});

test('invalid absolute request URLs return a generic 400 at the Node adapter boundary', async context => {
  const fixtureServer = await fixture(context);
  const response = await request(fixtureServer.port, 'http://[');
  assert.equal(response.status, 400);
  assertSecurity(response);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /请求地址无效/);
  assert.ok(!response.body.includes('RequestError'));
  assert.deepEqual(fixtureServer.errors, []);
});

test('unexpected route and static errors return one generic 500 without exposing details', async context => {
  const failure = new Error('private-server-path/secret');
  const fixtureServer = await fixture(context, {
    getHealth: () => { throw failure; },
    serveStatic: async () => { throw failure; },
  });
  for (const path of ['/healthz', '/file.js']) {
    for (const method of ['GET', 'HEAD']) {
      const before = fixtureServer.errors.length;
      const response = await request(fixtureServer.port, path, method);
      assert.equal(response.status, 500);
      assertSecurity(response);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.ok(Number(response.headers['content-length']) > 0);
      assert.ok(!response.body.includes(failure.message));
      if (method === 'HEAD') assert.equal(response.body, '');
      else assert.match(response.body, /服务器内部错误/);
      assert.equal(fixtureServer.errors.length, before + 1);
      assert.equal(fixtureServer.errors.at(-1)[1], failure);
      assert.equal(fixtureServer.requests.at(-1)[1].status, 500);
    }
  }
});

test('intentional HTTP exceptions keep their status and shared security headers', async context => {
  const fixtureServer = await fixture(context, {
    getHealth: () => { throw new HTTPException(401, { message: 'Authentication required' }); },
  });
  const response = await request(fixtureServer.port, '/healthz');
  assert.equal(response.status, 401);
  assertSecurity(response);
  assert.equal(response.body, 'Authentication required');
  assert.deepEqual(fixtureServer.errors, []);
});

test('an exception after headers closes the stream without appending an error page or sending twice', async context => {
  const fixtureServer = await fixture(context, {
    serveStatic: async (incoming, outgoing) => {
      outgoing.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': 1024 });
      outgoing.write('partial file');
      await delay(15);
      throw new Error('private-stream-error');
    },
  });
  const response = await request(fixtureServer.port, '/large.skel');
  assert.equal(response.status, 200);
  assertSecurity(response);
  assert.equal(response.complete, false);
  assert.equal(response.body, 'partial file');
  assert.equal(fixtureServer.errors.length, 1);
  assert.equal((await request(fixtureServer.port, '/healthz')).status, 200);
});
