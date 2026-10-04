# HTTP application

`server/index.js` assembles the game services and creates a Node HTTP server with
`createHttpListener(createHttpApp(...))`. Hono owns HTTP middleware and route
dispatch. The existing `ws` upgrade listener remains attached to the same server.

## Request flow

1. `securityHeaders` applies `X-Content-Type-Options: nosniff` and
   `Referrer-Policy: same-origin` to Hono responses and the native static response.
2. `requestLogging` records method, raw path, status and elapsed milliseconds
   through the server logger. `DEBUG=1` enables output; query strings are omitted.
3. `requestPolicy` enforces the existing 4,096-character request URL limit and
   GET/HEAD-only policy, preserving 414 and 405 responses with `Allow: GET, HEAD`.
4. `/healthz` returns uncached JSON, including online counts. All remaining HTTP
   requests pass to the static handler.

Routing uses the original `IncomingMessage.url`, before URL decoding or path
normalization. The static handler receives the raw path and query and retains its
traversal, dotfile and private simulation-module checks. Do not replace this with
`new URL(...).pathname` for origin-form requests: normalizing dot segments before
validation would change which resource a request reaches.

## Static response bridge

`server/http/static.js` retains MIME mappings, ETags, Last-Modified, conditional
304 responses, gzip caching and streaming, cache policies, directory redirects,
HEAD, audio byte ranges, the generated `/data.js` shim and the optional local art
manifest. Files stream directly to the Node response without being buffered into
a Fetch response.

Once static serving completes, the route returns a fresh response using the
adapter's `RESPONSE_ALREADY_SENT` marker and the actual status code. The adapter
then leaves the native response alone. The marker is internal and is never sent
to clients. Each request gets its own response headers.

Middleware that sets headers for static resources must apply them to
`context.env.outgoing` before calling `next()`, as the shared security middleware
does. Middleware that edits a Hono response body or sets headers after `next()`
cannot modify a static response that has already been sent. Compression stays in
the static handler, avoiding double compression.

## Errors and new routes

`app.onError` logs unexpected request exceptions and returns the existing generic
500 HTML page with `Cache-Control: no-store`. Internal exception details stay in
server logs. Intentional `HTTPException` responses retain their chosen status.
The Node adapter also returns generic errors if request conversion fails.

If an exception occurs after headers are sent, the connection is destroyed;
another response or error page is never appended to a partial file. File stream
aborts are handled in the static module. WebSocket events, game timers and HTTP
parser errors remain outside Hono's request pipeline.

Add new HTTP routes before the static fallback in `createHttpApp`, with handlers
under `server/http/routes/`. The current global method policy preserves the
existing GET/HEAD contract; adding a POST API requires deliberately updating that
policy. WebSocket admission, payload limits and reconnection continue to live in
the network layer.

Compatibility exports such as `createStaticHandler`, `parseRange` and build-tag
helpers remain available from `server/index.js`.

Run the focused checks with Node 22 or newer:

```sh
node --test test/http.test.js test/lobby.test.js test/match/simServe.test.js test/static-local-art.test.js test/presence.test.js test/build.test.js
```
