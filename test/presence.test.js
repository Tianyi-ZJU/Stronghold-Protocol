import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

async function fixture(t) {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.terminate()));
    await server.close();
  });
  return {
    server,
    async connect(name, token) {
      const client = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`);
      clients.push(client);
      if (name) client.welcome = await client.hello(name, token);
      return client;
    },
    async health() {
      const response = await fetch(`http://127.0.0.1:${server.port}/healthz`, { cache: 'no-store' });
      assert.equal(response.status, 200);
      return response.json();
    },
  };
}

test('online counts include lobby players, exclude visitors and bots, and follow room/match transitions', async t => {
  const f = await fixture(t);
  await f.connect(); // a title-page visitor has a socket, but has not entered with a nickname
  assert.deepEqual((await f.health()).presence, { online: 0, lobby: 0, waiting: 0, playing: 0 });
  const host = await f.connect('甲');
  const guest = await f.connect('乙');
  assert.deepEqual((await f.health()).presence, { online: 2, lobby: 2, waiting: 0, playing: 0 });
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
  const room = await host.waitFor('room.state');
  assert.equal((await guest.request({ t: 'room.join', code: room.code })).t, 'ok');
  assert.equal((await host.request({ t: 'room.addBot' })).t, 'ok');
  const waiting = await f.health();
  assert.equal(waiting.bots, 1);
  assert.deepEqual(waiting.presence, { online: 2, lobby: 0, waiting: 2, playing: 0 });
  assert.equal((await guest.request({ t: 'room.ready', ready: true })).t, 'ok');
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  assert.deepEqual((await f.health()).presence, { online: 2, lobby: 0, waiting: 0, playing: 2 });
  assert.equal((await guest.request({ t: 'room.leave' })).t, 'ok');
  assert.deepEqual((await f.health()).presence, { online: 2, lobby: 1, waiting: 0, playing: 1 });
  await guest.close();
  await host.close();
  const disconnected = await f.health();
  assert.equal(disconnected.sessions, 2, 'reconnect records remain');
  assert.deepEqual(disconnected.presence, { online: 0, lobby: 0, waiting: 0, playing: 0 });
});

test('a reconnect or replacement of the same player is counted once', async t => {
  const f = await fixture(t);
  const first = await f.connect('重连');
  const token = first.welcome.token;
  const second = await f.connect('重连', token);
  await first.closed;
  assert.equal(second.welcome.playerId, first.welcome.playerId);
  assert.deepEqual((await f.health()).presence, { online: 1, lobby: 1, waiting: 0, playing: 0 });
  await second.close();
  assert.equal((await f.health()).presence.online, 0);
  const third = await f.connect('重连', token);
  assert.equal(third.welcome.playerId, first.welcome.playerId);
  assert.equal((await f.health()).presence.online, 1);
  assert.equal((await f.health()).sessions, 1);
});
