import test from "node:test";
import assert from "node:assert/strict";
import { ItemUpgradeAutomationService } from "../scripts/automation/item-upgrade-automation-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

function fixture() {
  const effects = new Map(); let writes = 0, authority = true;
  const actor = { uuid: "Actor.a", effects, items: { contents: [] },
    async createEmbeddedDocuments(_type, rows) { for (const row of rows) { const id = `e${++writes}`; effects.set(id, { ...structuredClone(row), id, toObject() { const { toObject, ...data } = this; return structuredClone(data); } }); } },
    async updateEmbeddedDocuments(_type, rows) { for (const row of rows) { Object.assign(effects.get(row._id), structuredClone(row)); writes++; } },
    async deleteEmbeddedDocuments(_type, ids) { for (const id of ids) { effects.delete(id); writes++; } }
  };
  let contributions = [{ key: "one", scope: "actor", path: "system.attributes.ac.bonus", value: 1, hostItemId: "host", upgradeItemId: "upgrade", sourceId: "maloe-zacharovanie-zashchity" }];
  const service = new ItemUpgradeAutomationService({ worldMutationCoordinator: new WorldMutationCoordinator() }, {
    readActor: async () => actor, isAuthority: () => authority,
    project: () => ({ contributions, unavailable: [] })
  });
  return { actor, effects, service, writes: () => writes, setContributions: value => { contributions = value; }, setAuthority: value => { authority = value; } };
}
test("sync is idempotent; remove preserves unrelated and curse effects", async () => {
  const f = fixture();
  f.effects.set("user", { id: "user", flags: {} });
  f.effects.set("curse", { id: "curse", flags: { "rebreya-main": { curseUpgrade: { managed: true } } } });
  await f.service.requestSync(f.actor.uuid, "install");
  assert.equal(f.effects.size, 3); const writes = f.writes();
  await f.service.requestSync(f.actor.uuid, "repeat"); assert.equal(f.writes(), writes);
  f.setContributions([]); await f.service.requestSync(f.actor.uuid, "remove");
  assert.deepEqual([...f.effects.keys()], ["user", "curse"]);
});
test("identical item contributions remain separate and loss of authority prevents writes", async () => {
  const f = fixture();
  f.setContributions([1,2].map(i => ({ key: `key${i}`, scope: "actor", path: "system.bonuses.abilities.save", value: 1, hostItemId: `h${i}`, upgradeItemId: `u${i}`, sourceId: "maloe-zacharovanie-stoykosti" })));
  await Promise.all([f.service.requestSync(f.actor.uuid, "one"), f.service.requestSync(f.actor.uuid, "two")]);
  assert.equal(f.effects.size, 2); assert.equal(f.writes(), 2);
  f.setAuthority(false); f.setContributions([]);
  await f.service.requestSync(f.actor.uuid, "nonGM"); assert.equal(f.effects.size, 2);
});

test("native preparation repeats without accumulating weight and honors a source edit equal to the old result", () => {
  const previous = globalThis.CONFIG;
  class Item {
    constructor() { this.actor = {}; this.source = { weight: { value: 25, units: "lb" } }; this.system = structuredClone(this.source); this.flags = { "rebreya-main": { itemUpgrades: { installed: [{}] } } }; }
    toObject() { return { system: structuredClone(this.source) }; }
    applyActiveEffects() {}
  }
  const service = new ItemUpgradeAutomationService({}, { project: () => ({ contributions: [{ scope: "host", operation: "reduce-weight-lb", value: 10 }] }) });
  service.manifest = [{}];
  try {
    globalThis.CONFIG = { Item: { documentClass: Item } };
    service.registerItemDataPatch();
    const item = new Item();
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
    item.source.weight.value = 15; item.system = structuredClone(item.source);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 5);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 5);
    service.options.project = () => ({ contributions: [] });
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
  } finally { globalThis.CONFIG = previous; }
});

test("initialize resets native actor models before preparing existing activities", async () => {
  const previous = globalThis.game;
  let resets = 0;
  const actor = { uuid: "Actor.ready", reset() { resets++; }, prepareData() { assert.fail("Direct prepareData duplicates native base damage parts"); } };
  const service = new ItemUpgradeAutomationService({}, { getManifest: async () => [], isAuthority: () => false });
  service.registerItemDataPatch = () => false;
  try {
    globalThis.game = { system: { id: "dnd5e" }, actors: { contents: [actor] } };
    await service.initialize();
    assert.equal(resets, 1);
  } finally { globalThis.game = previous; }
});

test("holy steel restores only its own base dice and respects source edits and removal", () => {
  const previous = globalThis.CONFIG;
  class Item {
    constructor() {
      this.actor = {}; this.source = { damage: { base: { number: 1, types: ["slashing"] } } };
      this.system = { damage: { base: { number: 1, types: new Set(["slashing"]) } } };
      this.flags = { "rebreya-main": { itemUpgrades: { installed: [{}] } } };
    }
    toObject() { return { system: structuredClone(this.source) }; }
    applyActiveEffects() {}
  }
  const service = new ItemUpgradeAutomationService({}, { project: () => ({ contributions: [{ scope: "host", operation: "radiant-double-base", value: true }] }) });
  service.manifest = [{}];
  try {
    globalThis.CONFIG = { Item: { documentClass: Item } }; service.registerItemDataPatch();
    const item = new Item(); item.applyActiveEffects(); item.applyActiveEffects();
    assert.equal(item.system.damage.base.number, 2);
    assert.deepEqual([...item.system.damage.base.types], ["radiant"]);
    item.source.damage.base.number = 2;
    item.system = { damage: { base: { number: 2, types: new Set(["slashing"]) } } };
    item.applyActiveEffects(); assert.equal(item.system.damage.base.number, 4);
    service.options.project = () => ({ contributions: [] });
    item.applyActiveEffects(); assert.equal(item.system.damage.base.number, 2);
    assert.deepEqual([...item.system.damage.base.types], ["slashing"]);
  } finally { globalThis.CONFIG = previous; }
});
