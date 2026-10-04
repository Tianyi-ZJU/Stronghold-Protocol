import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

test('深溟巢涌者: every pulse damages each nearby unit exactly once; no extra single-target hit', () => {
  for (const key of ['enemy_1234_dsubrl', 'enemy_1234_dsubrl_2']) {
    const harness = makeBattle({ autoFinish: false, timeLimit: 30,
      defs: { chess: { guard: chessRec({ id: 'guard', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 }, skill: null }) } },
      units: [{ chessId: 'guard', uid: 1, row: 10, col: 6 }, { chessId: 'guard', uid: 2, row: 10, col: 8 }],
      enemies: [{ key, pos: [10, 7], mods: { speedMul: 0 } }],
    });
    const hits = new Map();
    harness.b.on('damaged', (context) => {
      if (context.source?.defId !== key || context.dmg.type === 'element') return;
      assert.ok(context.dmg.isAttack, 'damage belongs to the pulse attack');
      const id = `${context.dmg.attackId}:${context.target.id}`;
      hits.set(id, (hits.get(id) || 0) + 1);
    });
    harness.run(5);
    assert.ok(hits.size >= 4);
    assert.ok([...hits.values()].every((count) => count === 1), 'one damage instance per unit per pulse');
    const [first, second] = harness.allies();
    assert.equal(first.stats.taken, second.stats.taken, 'equal-distance bystanders take equal total damage');
    checkInvariants(harness.b);
  }
});

test('隐匿 / 迷彩 do not prevent 活性源石 environmental damage', () => {
  for (const flag of ['stealth', 'camou']) {
    const harness = makeBattle({ stageId: 'act1autochess_m04', autoFinish: false,
      defs: { chess: { guard: chessRec({ id: 'guard', stats: { maxHp: 1e5 }, skill: null }) } },
      units: [{ chessId: 'guard', row: 11, col: 6 }],
    });
    harness.step();
    const unit = harness.unit('guard');
    harness.b.addBuff(unit, { key: 'test:concealment', flags: { [flag]: true } });
    const damage = [];
    harness.b.on('damaged', (context) => { if (context.target === unit) damage.push(context); });
    harness.run(2);
    assert.equal(damage.length, 2);
    assert.ok(damage.every((context) => context.source === null && context.dmg.tags.includes('terrain')));
    checkInvariants(harness.b);
  }
});

test('联防: pushes in every direction stop at the field edge', () => {
  const harness = makeBattle({ kind: 'unite', autoFinish: false,
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
  });
  harness.step();
  for (const [pos, dir] of [[[9, 3], { x: 0, y: -1 }], [[12, 3], { x: 0, y: 1 }], [[9, 2], { x: -1, y: 0 }], [[9, 18], { x: 1, y: 0 }]]) {
    const enemy = harness.spawn('dummy', { pos });
    harness.b.push(enemy, 10, { dir });
    const rect = harness.b.rect;
    assert.ok(enemy.x >= rect.c0 - 0.5 && enemy.x <= rect.c1 + 0.5);
    assert.ok(enemy.y >= rect.r0 - 0.5 && enemy.y <= rect.r1 + 0.5);
    assert.ok(harness.b.grid.inRect(Math.round(enemy.y), Math.round(enemy.x)));
  }
  checkInvariants(harness.b);
});

test('六叙 = six distinct 叙拉古: its actual 隐匿 buff protects unblocking units from 卢西恩 AOE', () => {
  const harness = makeBattle({ autoFinish: false, timeLimit: 60,
    defs: { chess: {
      hidden: chessRec({ id: 'hidden', bonds: ['siracusaShip'], stats: { maxHp: 1e7, atk: 0, blockCnt: 0 }, skill: null }),
      plain: chessRec({ id: 'plain', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 }, skill: null }),
    } },
    units: [{ chessId: 'hidden', row: 10, col: 5 }, { chessId: 'plain', row: 9, col: 6 }],
    bonds: { siracusaShip: { count: 6, active: true, tier: 2, layers: 1000 } },
    enemies: [{ key: 'enemy_2016_csphtm', pos: [10, 6], mods: { speedMul: 0, hpMul: 1000, atkMul: 0.01 } }],
  });
  harness.run(25);
  assert.ok(harness.unit('hidden').s.flags.stealth);
  assert.equal(harness.unit('hidden').stats.taken, 0);
  assert.ok(harness.unit('plain').stats.taken > 0);
  assert.ok(harness.eventsOf('fx').some((enemy) => enemy[4]?.kind === 'crimsonAoe'), 'AOE was cast on the plain target');
  checkInvariants(harness.b);
});
