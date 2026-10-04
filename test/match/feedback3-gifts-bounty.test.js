import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, chessOfTier, checkInvariants } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { spawnChildren } from '../../server/sim/content/enemies.js';
import { planUnite } from '../../server/match/unite.js';
import { buildUniteWave } from '../../server/match/waves.js';

for (const clientCombat of [false, true]) {
  test(`信标: sender eliminated before the next round; recipient receives the gift exactly once (client=${clientCombat})`, () => {
    const harness = makeMatch({ humans: 2, fake: true, clientCombat, seed: 31 }).start();
    harness.toPrep(1);
    const match = harness.m, sender = harness.ps('p_0'), recipient = harness.ps('p_1');
    const id = chessOfTier(3).find((chessId) => match.pool.has(chessId));
    const target = give(match, sender, id);
    const beacon = giveItem(match, sender, 'chess_item_5_04_e_a');
    assert.equal(match.handle(sender.playerId, { t: 'g.equip', itemUid: beacon.uid, targetUid: target.uid }).ok, true);
    sender.eliminate(1);
    harness.toPrep(2);
    assert.equal(recipient.allChess().filter((parent) => match.gd.baseIdOf(parent.id) === id).length, 1, 'gift delivered despite elimination');
    harness.toPrep(3);
    assert.equal(recipient.allChess().filter((parent) => match.gd.baseIdOf(parent.id) === id).length, 1, 'no duplicate delivery');
    checkInvariants(match);
    assert.deepEqual(harness.logs.error, []);
    match.dispose();
  });
}

test('赏金: spawned children keep wave stats and leak attribution, but never inherit their parent’s bounty in 联防', () => {
  const harness = makeMatch({ humans: 2, fake: true, seed: 5 }).start();
  harness.toPrep(3);
  const match = harness.m, leaker = harness.ps('p_0');
  const card = { enemyKey: 'enemy_1439_dslntf', coin: 2, payout: 'kill', count: 1, rounds: 1 };
  match.addBounty(leaker, card);
  const bountyId = leaker.bounties[0].id;
  const battleHarness = makeBattle({ autoFinish: false, timeLimit: 60 });
  battleHarness.step();
  const parent = battleHarness.spawn('enemy_1439_dslntf', { pos: [9, 7], mods: { hpMul: 2, atkMul: 3, bountyId, bountyCoins: 2 }, bounty: { coins: 2, ownerPlayerId: 'p_0' } });
  const [child] = spawnChildren(battleHarness.b, parent, 'enemy_1007_slime', 1);
  assert.equal(child.mods.hpMul, 2);
  assert.equal(child.mods.atkMul, 3);
  assert.equal(parent.mods.bountyId, bountyId, 'parent still earns its reward');
  const leak = (e) => ({ enemyKey: e.defId, mods: e.mods, counted: true, lpr: 1 });
  const plan = planUnite(match, new Map([
    ['p_0', { perfect: false, leaked: [leak(child), leak(parent)] }],
    ['p_1', { perfect: true, leaked: [] }],
  ]));
  assert.equal(plan.leaked[0].sourcePlayerId, 'p_0');
  assert.equal(plan.leaked[0].bounty, null, 'child does not regain the bounty on entering 联防');
  assert.equal(plan.leaked[1].bounty.coins, 2, 'a leaked bounty parent still pays');
  const wave = buildUniteWave(match.gd, plan.leaked, 1, 60);
  assert.equal(wave.spawns.filter((s) => s.bounty).length, 1);
  checkInvariants(match);
  match.dispose();
});

for (const key of ['enemy_1207_sfji', 'enemy_1207_sfji_2', 'enemy_1203_sfhu', 'enemy_1203_sfhu_2']) {
  test(`赏金: real splitting enemy ${key} pays once; killing every child pays nothing extra`, () => {
    const harness = makeBattle({ autoFinish: false, players: [{ playerId: 'p_0', units: [], bonds: {} }] });
    harness.step();
    const parent = harness.spawn(key, { pos: [9, 7], sourcePlayerId: 'p_0', mods: { hpMul: 2, bountyId: 'bounty:123', bountyCoins: 2 }, bounty: { coins: 2, ownerPlayerId: 'p_0' } });
    harness.b.kill(parent);
    const children = harness.enemies();
    assert.ok(children.length > 0);
    for (const child of children) {
      assert.equal(child.mods.hpMul, 2);
      assert.equal(child.sourcePlayerId, 'p_0');
      assert.equal(child.bounty, null);
      assert.equal(child.mods.bountyId, undefined);
      assert.equal(child.mods.bountyCoins, undefined);
      harness.b.kill(child);
    }
    assert.equal(harness.result().perPlayer.p_0.coins, 2);
  });
}
