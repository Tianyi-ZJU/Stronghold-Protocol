// server/index.js — process entry & boot (DESIGN §1, §2).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createHttpApp, createHttpListener } from './http/app.js';
import { createStaticHandler } from './http/static.js';
import { splitUrl } from './http/url.js';
import { Network, SessionRegistry, NET_DEFAULTS } from './net.js';
import { Lobby } from './lobby.js';
import { presenceStats } from './presence.js';
import { getData, loadData } from './data.js';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';

export { createStaticHandler, DATA_SHIM_JS, MIME, COMPRESSIBLE, acceptsGzip, parseRange } from './http/static.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Repository root. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Inbound WebSocket frame limit (DESIGN §8). */
export const WS_MAX_PAYLOAD = 64 * 1024;

// ---------------------------------------------------------------------------------------------------
// build tag — the "your page is stale" signal (public/js/ui/buildGuard.js)
// ---------------------------------------------------------------------------------------------------

/**
 * The files that make up the runtime the BROWSER loads. A change in any of them is a new build: an already-open page
 * keeps the modules it imported at load time (ES modules live in the page's module map for its whole lifetime), so
 * without this signal a deployed fix could never reach a player who does not reload — a client-only battle fix
 * shipped exactly that way and stayed invisible on a page that had been opened before the deploy.
 *
 * `server/`, `data/` and `shared/` are deliberately NOT in here: this process read them once at startup, so when they
 * change without a restart the server still runs the old simulation and data — a page that reloaded into the new files
 * would be out of step with the server that validates its battles (and DEPLOY.md restarts the server for every update).
 */
export const BUILD_INPUTS = Object.freeze(['public/index.html', 'public/js', 'public/css']);

/** Names the static server never serves: dot files (`.DS_Store`, `.main.js.swp`) and editor backups (`main.js~`). */
const isIgnoredBuildName = (name) => name.startsWith('.') || name.endsWith('~');

/** @type {{ tag: string|null }|null} */
let buildCache = null;

/** Every file under `abs` (or `abs` itself), as `[relative path, size, mtimeMs]`, sorted by path. Missing → []. */
function buildEntries(abs, rel, out) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return; }
  if (stat.isFile()) { out.push([rel, stat.size, stat.mtimeMs]); return; }
  if (!stat.isDirectory()) return;
  let names;
  try { names = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (isIgnoredBuildName(d.name)) continue;
    const child = path.join(abs, d.name);
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) buildEntries(child, childRel, out);
    else if (d.isFile()) { try { const s = fs.statSync(child); out.push([childRel, s.size, s.mtimeMs]); } catch { /* ignore */ } }
  }
}

/** Short hash of the served browser runtime (size + mtime of every BUILD_INPUTS file); null when nothing is readable. */
export function computeBuildTag(root = ROOT) {
  const out = [];
  for (const rel of BUILD_INPUTS) buildEntries(path.join(root, rel), rel, out);
  if (!out.length) return null;
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const h = createHash('sha1');
  for (const [rel, size, mtime] of out) h.update(`${rel}\0${size}\0${Math.floor(mtime)}\n`);
  return h.digest('hex').slice(0, 12);
}

/**
 * The build tag of THIS process. Computed once (`startServer` warms it at startup): the tag describes the files the
 * process is actually serving, every update restarts the server (DEPLOY.md), and re-reading the tree on a timer would
 * let a half-finished deploy — or a file that changed while the process kept running — move the tag under a page.
 * @param {string} [root] used by the first call only (tests)
 */
export function buildTag(root = ROOT) {
  if (buildCache === null) buildCache = { tag: computeBuildTag(root) };
  return buildCache.tag;
}

/** Drop the cache: the next `buildTag()` re-reads the tree (tests, and `startServer`). */
export function resetBuildTag() { buildCache = null; }

// ---------------------------------------------------------------------------------------------------
// Server assembly
// ---------------------------------------------------------------------------------------------------

/** Non-internal IPv4 addresses as http URLs. @param {number} port */
export function lanUrls(port) {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(`http://${a.address}:${port}`);
    }
  }
  return out;
}

/** TRUST_PROXY env → net.js trustProxy ('auto' unless explicitly on/off). @param {string | undefined} v */
export function parseTrustProxy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'always'].includes(s)) return true;
  if (['0', 'false', 'no', 'off', 'never'].includes(s)) return false;
  return 'auto';
}

function makeLogger(quiet) {
  if (quiet) return noopLog;
  return {
    info: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
    debug: process.env.DEBUG ? (...a) => console.debug(...a) : () => {},
  };
}

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 * }} [opts]
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: WebSocketServer,
 *                     lobby: Lobby, network: Network, registry: SessionRegistry, close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  const port = opts.port ?? (process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 3000);
  const host = opts.host ?? process.env.HOST ?? '0.0.0.0';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError(`invalid PORT ${port}`);
  const log = opts.log || makeLogger(!!opts.quiet);
  const publicDir = opts.publicDir || path.join(ROOT, 'public');
  const dataDir = opts.dataDir || path.join(ROOT, 'data');
  const sharedDir = opts.sharedDir || path.join(ROOT, 'shared');

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  const netOptions = {};
  for (const k of ['reconnectWindowMs', 'heartbeatMs', 'helloTimeoutMs', 'ratePerSec', 'rateBurst', 'maxConnections', 'abuseDropsPerSec',
    'maxConnectionsPerAddr', 'heavyPerSec', 'heavyBurst', 'trustProxy']) {
    if (opts[k] != null) netOptions[k] = opts[k];
  }
  if (netOptions.trustProxy == null) netOptions.trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs });
  const lobbyOptions = {};
  for (const k of ['lobbyGraceMs', 'maxRooms', 'maxRoomsPerAddr', 'maxMatchesPerAddr', 'resyncMinGapMs', 'soloReconnectWindowMs']) {
    if (opts[k] != null) lobbyOptions[k] = opts[k];
  }
  const lobby = new Lobby({ registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, options: lobbyOptions });
  const network = new Network({ registry, handler: lobby, log, options: netOptions });
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, log });
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag();

  const app = createHttpApp({
    serveStatic, log,
    getHealth: () => ({
      ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      build: buildTag(),
      sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
      presence: presenceStats(network, lobby),
    }),
  });
  const server = http.createServer(createHttpListener(app, { log }));

  server.on('clientError', (err, socket) => {
    if (err && err.code === 'ECONNRESET') { socket.destroy(); return; }
    try {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      else socket.destroy();
    } catch { /* ignore */ }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false });
  wss.on('connection', (ws, req) => network.handleConnection(ws, req));
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts || parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });

  try {
    await new Promise((resolve, reject) => {
      const onError = (e) => { server.off('listening', onListening); reject(e); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host === '0.0.0.0' || host === '::' ? 'localhost' : host}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      network.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host, url, server, wss, lobby, network, registry, close };
}

// ---------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main() {
  process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection', e));
  process.on('uncaughtException', (e) => console.error('[process] uncaught exception', e));
  let srv;
  try {
    srv = await startServer();
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`端口已被占用 / port in use: ${e.port ?? process.env.PORT ?? 3000}. Try PORT=3001 npm start`);
    else console.error('[boot] failed to start', e);
    process.exit(1);
  }
  console.log(`\n  卫戍协议：盟约 · Stronghold Protocol: Alliance v${APP_VERSION}`);
  console.log(`  Local:   ${srv.url}`);
  if (srv.host === '0.0.0.0' || srv.host === '::') {
    for (const u of lanUrls(srv.port)) console.log(`  LAN:     ${u}`);
  }
  console.log('  Internet: cloudflared tunnel --url ' + `http://localhost:${srv.port}` + '\n');

  let stopping = false;
  const stop = (signal) => {
    if (stopping) { console.log('forced exit'); process.exit(1); }
    stopping = true;
    console.log(`\n[${signal}] shutting down…`);
    setTimeout(() => process.exit(0), 5000).unref();
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

if (isMain()) main();
