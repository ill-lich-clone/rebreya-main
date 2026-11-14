import assert from "node:assert/strict";
import test from "node:test";
import { StorageService, readStorageState } from "../scripts/data/storage-service.js";
import { StorageCommandService, isValidStorageHarvestPayload } from "../scripts/data/storage-command-service.js";
import { CreatureHarvestRepository } from "../scripts/infrastructure/foundry/creature-harvest-repository.js";
import { promptHarvestRoll, renderHarvestChat } from "../scripts/integrations/creature-harvesting-chat.js";

function fixture(type = "beast", { rollTotal = 27 } = {}) {
  const parent = { id: "scene" };
  const body = { uuid: "body", name: "Клещ", parent,
    actor: { type: "npc", system: { attributes: { hp: { value: 0 } }, details: { type: { value: type } } } },
    flags: { "rebreya-main": { storage: { state: "opened", generatedRows: [{ rowId: "gear", name: "Сумка" }] } } },
    async update(patch) { this.flags["rebreya-main"].storage = patch["flags.rebreya-main.storage"]; }
  };
  const character = { uuid: "hero", name: "Следопыт", parent,
    actor: { type: "character", uuid: "Actor.hero", testUserPermission: user => user.id === "owner" } };
  const storage = new StorageService();
  let rolls = 0;
  const notices = [];
  const state = {};
  const records = new CreatureHarvestRepository({ worldSettings: { readObject: () => structuredClone(state),
    async mutateObject(_key, mutate) { return mutate(state); } } });
  const commands = new StorageCommandService({ storageService: storage, inventoryService: {},
    resolveToken: uuid => ({ body, hero: character }[uuid]), measureDistance: () => 5, isVisibleTo: () => true,
    journalReader: { read() {} }, getHarvestCatalog: () => [{ id: "tick", name: "Клещ", rank: 1, common: ["Хитин"] },
      { id: "dragon", name: "Дракон", rank: 10, common: ["Чешуя"] }],
    getHarvestMaterials: () => [],
    harvestRecords: records,
    notifyHarvest: async notice => { notices.push(notice); }
  });
  const command = (action, extra = {}, sender = { id: "owner" }) => commands.harvest({
    action, tokenUuid: "body", characterTokenUuid: "hero", ...extra
  }, { sender });
  const reply = async (overrides = {}) => {
    const attempt = records.read("body").attempt;
    const [ability, skill] = attempt.check.split(":");
    rolls++;
    return commands.acceptHarvestReply({ type: "check", system: { ability, skill },
      flags: { "rebreya-main": { harvestRoll: { tokenUuid: "body", receipt: attempt.receipt, actorUuid: attempt.actorUuid } } },
      author: { id: "owner" }, rolls: [{ total: rollTotal, validD20Roll: true }], ...overrides });
  };
  return { body, command, rolls: () => rolls, notices, records, reply };
}

test("typed command refuses spoofed rules and enforces actual actor access and type", async () => {
  assert.equal(isValidStorageHarvestPayload({ action: "begin", tokenUuid: "body", characterTokenUuid: "hero", total: 99 }), false);
  const { command, rolls } = fixture("humanoid");
  await assert.rejects(command("read", {}, { id: "stranger" }), /персонажа/);
  assert.equal((await command("read", { monsterId: "tick" })).reason, "humanoid");
  await assert.rejects(command("configure", { config: { type: "beast" } }), /Мастер/);
  await assert.rejects(command("begin", { monsterId: "tick" }), /гуманоид/i);
  assert.equal(rolls(), 0);
});

test("unknown names allow an analogue and simultaneous attempts grant once beside existing gear", async () => {
  const { body, command, reply } = fixture();
  body.name = "Неизвестный";
  assert.equal((await command("read")).reason, "monster");
  assert.equal((await command("read", { name: "Клещ" })).dc, 21);
  const results = await Promise.all([command("begin", { monsterId: "tick", name: "Клещ" }), command("begin", { monsterId: "tick", name: "Клещ" })]);
  assert.deepEqual(results[0], results[1]);
  const resolved = await Promise.all([reply(), reply()]);
  assert.equal(resolved.filter(Boolean).length, 1);
  assert.deepEqual(readStorageState(body).generatedRows.map(row => row.name),
    ["Сумка", "Хитин", "Кровь чудовища", "Уникальный компонент — Клещ"]);
});

test("a known corpse cannot use another monster's loot even with a forged id and name", async () => {
  const { command, rolls } = fixture();
  await assert.rejects(command("begin", { monsterId: "dragon", name: "Дракон" }), /запись/);
  assert.equal(rolls(), 0);
});

test("a saved roll resumes after a failed atomic grant", async () => {
  const { body, command, rolls, reply } = fixture();
  const update = body.update.bind(body);
  let fail = true;
  body.update = async patch => {
    if (fail && patch["flags.rebreya-main.storage"].corpseHarvestReceipt) {
      fail = false;
      throw new Error("write failed");
    }
    await update(patch);
  };
  await command("begin", { monsterId: "tick" });
  await assert.rejects(reply(), /write failed/);
  assert.equal(readStorageState(body).generatedRows.length, 1);
  assert.equal((await command("begin", { monsterId: "tick" })).outcome, "exceptional");
  assert.equal(rolls(), 1);
});

test("only the GM can supply missing rank ten DC and recover a started roll", async () => {
  const { body, command, rolls, records, reply } = fixture("dragon");
  body.name = "Дракон";
  assert.equal((await command("read")).reason, "dc");
  const gm = { id: "gm", isGM: true };
  await command("configure", { config: { dc: 40 } }, gm);
  assert.equal((await command("read")).dc, 40);
  const checkpoint = records.patch.bind(records);
  records.patch = async (id, patch) => {
    if (patch.attempt?.status === "resolved") throw new Error("result write failed");
    await checkpoint(id, patch);
  };
  await command("begin", { monsterId: "dragon" });
  await assert.rejects(reply(), /result write failed/);
  records.patch = checkpoint;
  await assert.rejects(command("resolve", { total: 45 }), /Мастер/);
  const update = body.update.bind(body);
  let failedGrant = false;
  body.update = async patch => {
    if (!failedGrant && patch["flags.rebreya-main.storage"].corpseHarvestReceipt) {
      failedGrant = true;
      throw new Error("grant write failed");
    }
    await update(patch);
  };
  await assert.rejects(command("resolve", { total: 45 }, gm), /grant write failed/);
  const result = await command("resolve", { total: 45 }, gm);
  assert.equal(result.outcome, "exceptional");
  assert.deepEqual(await command("resolve", { total: 45 }, gm), result);
  assert.equal(rolls(), 1);
});

test("the active GM gets one severe failure notice without time tracking", async () => {
  const { command, notices, reply } = fixture("beast", { rollTotal: 16 });
  await command("begin", { monsterId: "tick" });
  const result = await reply();
  await command("begin", { monsterId: "tick" });
  assert.equal(result.outcome, "severe");
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].result, result);
  assert.equal(Object.hasOwn(notices[0], "minutes"), false);
  assert.deepEqual(notices[0].harvester, { tokenUuid: "hero", name: "Следопыт" });
});

test("an editable token flag cannot make the GM grant a fabricated harvest", async () => {
  const { body, command, rolls, reply } = fixture("beast", { rollTotal: 16 });
  body.flags["rebreya-main"].storage.corpseHarvest = { attempt: { status: "resolved", monster: { id: "fake" },
    result: { outcome: "success", total: 99, dc: 21, loot: [{ name: "Подделка" }] } } };
  await command("begin", { monsterId: "tick" });
  assert.equal((await reply()).outcome, "severe");
  assert.equal(rolls(), 1);
  assert.deepEqual(readStorageState(body).generatedRows.map(row => row.name), ["Сумка"]);
});

test("a persisted token receipt prevents duplicate rows after a failed completion checkpoint", async () => {
  const { body, command, rolls, records, notices, reply } = fixture();
  const patch = records.patch.bind(records);
  records.patch = async (uuid, fields) => {
    if (fields.attempt?.status === "complete") throw new Error("completion write failed");
    await patch(uuid, fields);
  };
  await command("begin", { monsterId: "tick" });
  await assert.rejects(reply(), /completion write failed/);
  const rows = readStorageState(body).generatedRows;
  assert.equal(rows.length, 4);
  records.patch = patch;
  assert.equal((await command("begin", { monsterId: "tick" })).outcome, "exceptional");
  assert.deepEqual(readStorageState(body).generatedRows, rows);
  assert.equal(rolls(), 1);
  assert.equal(notices.length, 1);
});

test("accepts only a matching native check from its player", async () => {
  const { command, reply, notices } = fixture();
  const { roll } = await command("begin", { monsterId: "tick", check: "int:arc", blood: false });
  assert.equal(roll.check, "int:arc");
  assert.equal(roll.dc, 21);
  assert.equal(await reply({ author: { id: "stranger" } }), undefined);
  assert.equal(await reply({ system: { ability: "wis", skill: "sur" } }), undefined);
  assert.equal(await reply({ rolls: [{ total: 99 }] }), undefined);
  const result = await reply();
  assert.equal(result.loot.some(row => row.name === "Кровь чудовища"), false);
  await renderHarvestChat(notices[0], (path, data) => {
    assert.match(path, /creature-harvesting-chat\.hbs$/);
    assert.equal(data.corpse, "Клещ");
    assert.equal(data.total, 27);
    assert.deepEqual(data.loot.map(item => item.name), ["Хитин", "Уникальный компонент — Клещ"]);
  });
});

test("ability and skill checks both open the native roll dialog and tag their eventual message", async () => {
  const calls = [];
  const actor = { uuid: "Actor.hero", rollAbilityCheck: (...args) => calls.push(args), rollSkill: (...args) => calls.push(args) };
  const attempt = { dc: 21, tokenUuid: "body", receipt: "receipt", corpseName: "Клещ" };
  await promptHarvestRoll(actor, { ...attempt, check: "str" });
  await promptHarvestRoll(actor, { ...attempt, check: "int:arc" });
  assert.deepEqual(calls.map(([config]) => config), [{ ability: "str", target: 21 }, { ability: "int", skill: "arc", target: 21 }]);
  for (const [, dialog, message] of calls) {
    assert.deepEqual(dialog, { configure: true });
    assert.deepEqual(message.data.flags["rebreya-main"].harvestRoll, { actorUuid: "Actor.hero", tokenUuid: "body", receipt: "receipt" });
  }
});

test("begin returns the native roll parameters without publishing a chat request", async () => {
  const { body, command, records } = fixture();
  const pending = await command("begin", { monsterId: "tick", check: "int:arc", blood: false });
  assert.equal(pending.roll.check, "int:arc");
  assert.equal(pending.roll.dc, 21);
  assert.equal(records.read("body").attempt.status, "requested");
  assert.deepEqual(readStorageState(body).generatedRows.map(row => row.name), ["Сумка"]);
});
