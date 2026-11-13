import assert from "node:assert/strict";
import test from "node:test";
import { StorageService, readStorageState } from "../scripts/data/storage-service.js";
import { StorageCommandService, isValidStorageHarvestPayload } from "../scripts/data/storage-command-service.js";
import { CreatureHarvestRepository } from "../scripts/infrastructure/foundry/creature-harvest-repository.js";

function fixture(type = "beast", { rollTotal = 27, nativeRoll = false } = {}) {
  const parent = { id: "scene" };
  const body = { uuid: "body", name: "Клещ", parent,
    actor: { type: "npc", system: { attributes: { hp: { value: 0 } }, details: { type: { value: type } } } },
    flags: { "rebreya-main": { storage: { state: "opened", generatedRows: [{ rowId: "gear", name: "Сумка" }] } } },
    async update(patch) { this.flags["rebreya-main"].storage = patch["flags.rebreya-main.storage"]; }
  };
  const nativeCalls = [];
  const character = { uuid: "hero", name: "Следопыт", parent,
    actor: { type: "character", testUserPermission: user => user.id === "owner",
      async rollSkill(...args) { nativeCalls.push(args); return [{ total: rollTotal }]; } } };
  const storage = new StorageService();
  let rolls = 0;
  const notices = [];
  let state = { body: { diedAt: 0 } };
  const records = new CreatureHarvestRepository({ worldSettings: { readObject: () => structuredClone(state),
    async mutateObject(_key, mutate) { return mutate(state); } } });
  const commands = new StorageCommandService({ storageService: storage, inventoryService: {},
    resolveToken: uuid => ({ body, hero: character }[uuid]), measureDistance: () => 5, isVisibleTo: () => true,
    journalReader: { read() {} }, getHarvestCatalog: () => [{ id: "tick", name: "Клещ", rank: 1, common: ["Хитин"] },
      { id: "dragon", name: "Дракон", rank: 10, common: ["Чешуя"] }],
    getHarvestMaterials: () => [], getWorldTime: () => 20,
    harvestRecords: records,
    ...(nativeRoll ? {} : { rollHarvest: async () => { rolls++; return rollTotal; } }),
    notifyHarvest: async notice => { notices.push(notice); }
  });
  const command = (action, extra = {}, sender = { id: "owner" }) => commands.harvest({
    action, tokenUuid: "body", characterTokenUuid: "hero", ...extra
  }, { sender });
  return { body, command, rolls: () => rolls, notices, records, nativeCalls };
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
  const { body, command, rolls } = fixture();
  body.name = "Неизвестный";
  assert.equal((await command("read")).reason, "monster");
  assert.equal((await command("read", { name: "Клещ" })).dc, 21);
  const results = await Promise.all([command("begin", { monsterId: "tick", name: "Клещ" }), command("begin", { monsterId: "tick", name: "Клещ" })]);
  assert.equal(rolls(), 1);
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(readStorageState(body).generatedRows.map(row => row.name),
    ["Сумка", "Хитин", "Кровь чудовища", "Уникальный компонент — Клещ"]);
});

test("a known corpse cannot use another monster's loot even with a forged id and name", async () => {
  const { command, rolls } = fixture();
  await assert.rejects(command("begin", { monsterId: "dragon", name: "Дракон" }), /запись/);
  assert.equal(rolls(), 0);
});

test("a saved roll resumes after a failed atomic grant", async () => {
  const { body, command, rolls } = fixture();
  const update = body.update.bind(body);
  let fail = true;
  body.update = async patch => {
    if (fail && patch["flags.rebreya-main.storage"].corpseHarvestReceipt) {
      fail = false;
      throw new Error("write failed");
    }
    await update(patch);
  };
  await assert.rejects(command("begin", { monsterId: "tick" }), /write failed/);
  assert.equal(readStorageState(body).generatedRows.length, 1);
  assert.equal((await command("begin", { monsterId: "tick" })).outcome, "exceptional");
  assert.equal(rolls(), 1);
});

test("only the GM can supply missing rank ten DC and recover a started roll", async () => {
  const { body, command, rolls, records } = fixture("dragon");
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
  await assert.rejects(command("begin", { monsterId: "dragon" }), /result write failed/);
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

test("the active GM gets one result and time notice for a player's severe failure", async () => {
  const { command, notices } = fixture("beast", { rollTotal: 16 });
  const result = await command("begin", { monsterId: "tick" });
  await command("begin", { monsterId: "tick" });
  assert.equal(result.outcome, "severe");
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].result, result);
  assert.equal(notices[0].minutes, 10);
  assert.deepEqual(notices[0].harvester, { tokenUuid: "hero", name: "Следопыт" });
});

test("an editable token flag cannot make the GM grant a fabricated harvest", async () => {
  const { body, command, rolls } = fixture("beast", { rollTotal: 16 });
  body.flags["rebreya-main"].storage.corpseHarvest = { attempt: { status: "resolved", monster: { id: "fake" },
    result: { outcome: "success", total: 99, dc: 21, loot: [{ name: "Подделка" }] } } };
  assert.equal((await command("begin", { monsterId: "tick" })).outcome, "severe");
  assert.equal(rolls(), 1);
  assert.deepEqual(readStorageState(body).generatedRows.map(row => row.name), ["Сумка"]);
});

test("a persisted token receipt prevents duplicate rows after a failed completion checkpoint", async () => {
  const { body, command, rolls, records, notices } = fixture();
  const patch = records.patch.bind(records);
  records.patch = async (uuid, fields) => {
    if (fields.attempt?.status === "complete") throw new Error("completion write failed");
    await patch(uuid, fields);
  };
  await assert.rejects(command("begin", { monsterId: "tick" }), /completion write failed/);
  const rows = readStorageState(body).generatedRows;
  assert.equal(rows.length, 4);
  records.patch = patch;
  assert.equal((await command("begin", { monsterId: "tick" })).outcome, "exceptional");
  assert.deepEqual(readStorageState(body).generatedRows, rows);
  assert.equal(rolls(), 1);
  assert.equal(notices.length, 1);
});

test("the native check leaves GM roll evidence for manual recovery", async () => {
  const { command, nativeCalls, records } = fixture("beast", { nativeRoll: true });
  await command("begin", { monsterId: "tick" });
  const [[config, dialog, message]] = nativeCalls;
  assert.deepEqual(config, { skill: "sur", ability: "wis", target: 21 });
  assert.equal(dialog.configure, false);
  assert.equal(message.rollMode, "gmroll");
  assert.equal(message.data.flags["rebreya-main"].corpseHarvestRoll, records.read("body").attempt.receipt);
});
