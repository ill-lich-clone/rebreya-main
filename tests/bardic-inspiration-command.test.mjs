import test from "node:test";
import assert from "node:assert/strict";
import { BardicInspirationCompatService, isLaaruBardicInspirationItem } from "../scripts/combat/bardic-inspiration-compat-service.js";
import { bardicFixture } from "./helpers/bardic-inspiration-fixture.mjs";

test("Laaru identity accepts modern and legacy exact source, rejecting unrelated same-name features", () => {
  assert.equal(isLaaruBardicInspirationItem(bardicFixture().item), true);
  assert.equal(isLaaruBardicInspirationItem(bardicFixture({ modern: false }).item), true);
  assert.equal(isLaaruBardicInspirationItem({ name: "Бардовское вдохновение", system: { uses: {} }, flags: { core: { sourceId: "Compendium.laaru.other.Item.other" } } }), false);
});

for (const [level, expected] of [[1, "1d6"], [5, "1d8"], [10, "1d10"], [15, "1d12"]]) {
  test(`grant freezes source bard die at level ${level}, retains performer and native resource`, async () => {
    const f = bardicFixture({ level });
    const performer = { flags: { "rebreya-main": { d20Bonus: { kind: "activePerformanceDie", formula: "1d3" } } } };
    f.target.effects.push(performer);
    const before = structuredClone(f.item.system.uses);
    const service = new BardicInspirationCompatService({});
    await service.grantInspiration(f.payload, { sender: f.sender });
    const effect = f.target.effects[1];
    assert.equal(effect.flags["rebreya-main"].d20Bonus.formula, expected);
    assert.equal(effect.duration.seconds, 600);
    assert.equal(effect.duration.startTime, 100);
    assert.equal(effect.transfer, false);
    assert.equal(f.target.effects[0], performer);
    assert.deepEqual(f.item.system.uses, before);
    await effect.delete();
    await service.grantInspiration(f.payload, { sender: f.sender });
    assert.equal(f.target.effects.length, 1, "replayed native use cannot restore a spent die");
  });
}

test("authored source formula wins over level progression and resolves source data", async () => {
  const f = bardicFixture({ level: 15, scale: "d8" });
  const service = new BardicInspirationCompatService({});
  await service.grantInspiration(f.payload, { sender: f.sender });
  assert.equal(f.target.effects[0].flags["rebreya-main"].d20Bonus.formula, "1d8");
  await f.target.effects[0].delete();
  f.item.system.formula = "2d6 + @abilities.cha.mod";
  f.message("second-use");
  await service.grantInspiration({ ...f.payload, operationId: "second-use" }, { sender: f.sender });
  assert.equal(f.target.effects[0].flags["rebreya-main"].d20Bonus.formula, "2d6 + 4");
});

test("pre-use rejects self, missing/multiple targets and an existing bardic die without consuming uses", async () => {
  const f = bardicFixture();
  const service = new BardicInspirationCompatService({});
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [] }), false);
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [f.source] }), false);
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [f.target, f.source] }), false);
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [f.target] }), true);
  await service.grantInspiration(f.payload, { sender: f.sender });
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [f.target] }), false);
  game.time.worldTime = 700;
  f.message("replace-expired");
  assert.equal(service.applyDnd5ePreUseActivity(f.grant, { targets: [f.target] }), true);
  await service.grantInspiration({ ...f.payload, operationId: "replace-expired" }, { sender: f.sender });
  assert.equal(f.target.effects.length, 1);
  assert.equal(f.target.effects[0].duration.startTime, 700);
  assert.equal(f.item.system.uses.spent, 1);
});

test("only grant activity creates a die, and a player routes the exact target through the command", async () => {
  const f = bardicFixture();
  game.user = { id: "owner", active: true, isGM: false };
  const calls = [];
  const service = new BardicInspirationCompatService({ socketCommandBus: { async request(command, payload) { calls.push({ command, payload }); } } });
  await service.applyDnd5ePostUseActivity(f.dieRoll, { targets: [f.target] }, { message: { id: "roll-card" } });
  assert.equal(calls.length, 0);
  await service.applyDnd5ePostUseActivity(f.grant, { targets: [f.target] }, { message: { id: "grant-card" } });
  await service.applyDnd5ePostUseActivity(f.grant, { targets: [f.target] }, { message: { id: "grant-card" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "bardic.inspiration.grant");
  assert.equal(calls[0].payload.targetActorUuid, f.target.uuid);
  assert.equal(f.target.effects.length, 0);
});

test("authority rejects wrong sender, source/activity and token-actor substitutions", async () => {
  const f = bardicFixture();
  const service = new BardicInspirationCompatService({});
  await assert.rejects(service.grantInspiration(f.payload, { sender: { id: "stranger" } }), /владелец|прав/i);
  await assert.rejects(service.grantInspiration({ ...f.payload, activityId: f.dieRoll.id }, { sender: f.sender }), /вдохнов|активност/i);
  await assert.rejects(service.grantInspiration({ ...f.payload, targetTokenUuid: "Scene.scene.Token.wrong" }, { sender: f.sender }), /цел|токен/i);
  await assert.rejects(service.grantInspiration({ ...f.payload, sourceItemUuid: "Actor.other.Item.wrong" }, { sender: f.sender }), /источник|вдохнов/i);
  await service.grantInspiration(f.payload, { sender: { id: "owner" } });
  assert.equal(f.target.effects.length, 1);
});

test("exact synthetic Actor target is retained and scene range is enforced", async () => {
  const f = bardicFixture();
  const scene = { id: "scene", grid: { size: 100, distance: 5 } };
  const synthetic = f.actor("synthetic", "Scene.scene.Token.synthetic.Actor.base");
  const sourceToken = { uuid: "Scene.scene.Token.bard", documentName: "Token", actor: f.source, parent: scene, x: 0, y: 0, width: 1, height: 1 };
  const targetToken = { uuid: "Scene.scene.Token.synthetic", documentName: "Token", actor: synthetic, parent: scene, x: 1200, y: 0, width: 1, height: 1 };
  f.documents.set(sourceToken.uuid, sourceToken); f.documents.set(targetToken.uuid, targetToken);
  const payload = { ...f.payload, targetActorUuid: synthetic.uuid, sourceTokenUuid: sourceToken.uuid, targetTokenUuid: targetToken.uuid };
  game.messages.get(payload.operationId).flags.dnd5e.targets = [{ uuid: synthetic.uuid }];
  const service = new BardicInspirationCompatService({});
  targetToken.x = 1300;
  await assert.rejects(service.grantInspiration(payload, { sender: f.sender }), /60|дистанц/i);
  targetToken.x = 1200;
  await service.grantInspiration(payload, { sender: f.sender });
  assert.equal(synthetic.effects.length, 1);
  assert.equal(f.target.effects.length, 0);
});

test("typed command rejects extra claims and schedules exact source/target Documents", async () => {
  const { registerBardicInspirationCommand } = await import("../scripts/infrastructure/foundry/bardic-inspiration-command.js");
  const f = bardicFixture();
  let handler;
  registerBardicInspirationCommand({ register(name, entry) { assert.equal(name, "bardic.inspiration.grant"); handler = entry; } }, new BardicInspirationCompatService({}));
  assert.equal(handler.validate(f.payload), true);
  assert.equal(handler.validate({ ...f.payload, formula: "100d100" }), false);
  assert.equal(handler.validate({ ...f.payload, sourceItemUuid: "Compendium.evil.Item.fake" }), false);
  assert.equal(await handler.authorize(f.payload, { sender: { id: "stranger" } }), false);
  assert.equal(await handler.authorize(f.payload, { sender: { id: "owner" } }), true);
  await handler.execute(f.payload, { sender: { id: "owner" } });
  assert.equal(f.target.effects.length, 1);
});

test("a grant requires a matching native use with a spent charge and the original target", async () => {
  const f = bardicFixture();
  const service = new BardicInspirationCompatService({});
  await assert.rejects(service.grantInspiration({ ...f.payload, operationId: "forged" }, { sender: f.sender }), /использован|сообщен/i);
  const native = game.messages.get(f.payload.operationId);
  native.flags.dnd5e.use.consumed.item = {};
  await assert.rejects(service.grantInspiration(f.payload, { sender: f.sender }), /расход|заряд/i);
  native.flags.dnd5e.use.consumed.item = { [f.item.id]: [{ keyPath: "system.uses.spent", delta: 1 }] };
  native.flags.dnd5e.targets = [{ uuid: f.source.uuid }];
  await assert.rejects(service.grantInspiration(f.payload, { sender: f.sender }), /цел/i);
});

for (const remove of [false, true]) test(`interrupted completion ${remove ? "cannot recreate a removed die" : "recovers the one pending die"}`, async () => {
  const f = bardicFixture();
  const message = game.messages.get(f.payload.operationId), originalUpdate = message.update;
  let fail = true;
  message.update = async function(patch) {
    if (fail && patch['flags.rebreya-main.bardicInspirationGrant']?.complete === true) { fail = false; throw new Error("receipt write interrupted"); }
    return originalUpdate.call(this, patch);
  };
  await assert.rejects(new BardicInspirationCompatService({}).grantInspiration(f.payload, { sender: f.sender }), /interrupted/);
  assert.equal(f.target.effects.length, 1);
  assert.equal(f.target.effects[0].disabled, true, "unconfirmed grant must not be usable");
  if (remove) await f.target.effects[0].delete();
  const fresh = new BardicInspirationCompatService({});
  if (remove) {
    await assert.rejects(fresh.grantInspiration(f.payload, { sender: f.sender }), /не подтвержд|провер/i);
    assert.equal(f.target.effects.length, 0);
  } else {
    await fresh.grantInspiration(f.payload, { sender: f.sender });
    assert.equal(f.target.effects.length, 1);
    assert.equal(f.target.effects[0].disabled, false);
  }
  assert.equal(f.item.system.uses.spent, 1);
});
