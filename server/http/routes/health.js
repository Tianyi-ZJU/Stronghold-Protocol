export function healthRoute(getHealth) {
  return context => {
    const body = JSON.stringify(getHealth());
    return context.newResponse(body, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      'Cache-Control': 'no-store',
    });
  };
}
