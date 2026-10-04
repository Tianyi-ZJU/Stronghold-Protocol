import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { inRange } from '../../server/sim/content/support/index.js';

const bond = { raidShip: { count: 2, active: true, tier: 1, layers: 0 } };
function scenario(pos) {
  return makeBattle({
    autoFinish: false, timeLimit: 120, bonds: bond,
    defs: { chess: { raider: chessRec({ id: 'raider', bonds: ['raidShip'] }) }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
    kits: { raider: () => ({ skill: { kind: 'passive' } }) },
    units: [{ chessId: 'raider', row: 12, col: 3 }],
    enemies: pos ? [{ key: 'dummy', pos }] : [],
  });
}
const jumps = (harness) => harness.hooksOf('deploy').filter((context) => context.unit.kind === 'op' && !context.initial);

test('突袭: passive deployment waits for the first reachable ground enemy, jumps before 10 seconds, heals fully, then returns to idle rules', () => {
  const harness = scenario();
  harness.run(1);
  const unit = harness.unit('raider');
  harness.b.dealDamage(null, unit, { amount: 500, type: 'true' });
  const target = harness.spawn('dummy', { pos: [9, 8] });
  harness.run(0.3);
  assert.equal(jumps(harness).length, 1, 'jump within one poll, before 10 seconds');
  assert.ok(inRange(unit, target));
  assert.equal(unit.hp, unit.s.maxHp, 'fresh deployment at full HP');
  harness.run(0.5);
  harness.b.kill(target);
  const next = harness.spawn('dummy', { pos: [12, 6] });
  const last = unit.lastAttackAt;
  harness.run(1);
  assert.equal(jumps(harness).length, 1, 'no perpetual passive-ready jumps');
  assert.ok(harness.runUntil(() => jumps(harness).length === 2, 11));
  assert.ok(harness.b.time - last >= 10 - 1e-6);
  assert.ok(inRange(unit, next));
  checkInvariants(harness.b);
});

test('突袭: an enemy already in range consumes passive arming; a real redeployment arms it again', () => {
  const harness = scenario([12, 4]);
  harness.run(0.5);
  const unit = harness.unit('raider');
  harness.b.kill(harness.enemies()[0]);
  harness.spawn('dummy', { pos: [9, 8] });
  harness.run(1);
  assert.equal(jumps(harness).length, 0, 'initial target was already in range');
  harness.b.kill(unit);
  assert.ok(harness.b.redeploy(unit, { free: true }));
  harness.run(0.3);
  assert.equal(jumps(harness).length, 2, 'normal redeploy, followed by immediate passive raid');
  checkInvariants(harness.b);
});

for (const [chessId, skillIndex] of [['chess_char_1_18_a', 1], ['chess_char_3_05_a', 1], ['chess_char_4_16_a', 0], ['chess_char_4_16_a', 1], ['chess_char_4_16_a', 2], ['chess_char_6_17_a', 1]]) {
  test(`突袭: real passive kit ${chessId} jumps on first enemy`, () => {
    const harness = makeBattle({ autoFinish: false, timeLimit: 30, bonds: bond,
      units: [{ chessId, skillIndex, row: 12, col: 3 }],
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
      enemies: [{ key: 'dummy', pos: [9, 8], time: 1 }],
    });
    harness.run(1.5);
    assert.equal(harness.unit(chessId).skill.kind, 'passive');
    assert.equal(jumps(harness).length, 1);
    checkInvariants(harness.b);
  });
}

test('突袭: 伊内丝 S3 first places her sentry and retreats; her next deployment raids promptly', () => {
  const harness = makeBattle({ autoFinish: false, timeLimit: 30, bonds: bond,
    units: [{ chessId: 'chess_char_4_04_a', skillIndex: 2, row: 12, col: 3 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [9, 8], time: 1 }],
  });
  assert.ok(harness.runUntil(() => harness.hooksOf('death').some((context) => context.reason === 'raid'), 6));
  assert.ok(harness.hooksOf('death').some((context) => context.reason === 'retreat'), 'sentry placement still retreats normally');
  checkInvariants(harness.b);
});
