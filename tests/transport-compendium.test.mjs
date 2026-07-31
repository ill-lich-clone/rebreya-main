import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MODULE_ID,
  TRANSPORT_COMPENDIUM_ID,
  TRANSPORT_COMPENDIUM_LABEL,
  TRANSPORT_COMPENDIUM_NAME
} from "../scripts/constants.js";
import {
  TransportCompendiumService,
  loadTransportCatalog,
  repairTransportInstanceSpeeds
} from "../scripts/data/transport-compendium.js";
import { buildTransportActorData } from "../scripts/data/transport-actor-builder.js";

const catalog = JSON.parse(await readFile(
  new URL("../data/rebreya-transport-v01.json", import.meta.url),
  "utf8"
));

function clone(value) {
  return structuredClone(value);
}

function createDocument(row) {
  return {
    ...clone(row),
    id: row._id,
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      Object.assign(this, clone(patch));
      return this;
    }
  };
}

function createTransportPackHarness({ existingPack = true } = {}) {
  const documents = [];
  const createdMetadata = [];
  const pack = {
    collection: TRANSPORT_COMPENDIUM_ID,
    documentName: "Actor",
    metadata: { system: "dnd5e" },
    documentClass: {
      async createDocuments(rows, options) {
        assert.deepEqual(options, { pack: TRANSPORT_COMPENDIUM_ID, keepId: true });
        documents.push(...rows.map(createDocument));
      },
      async deleteDocuments(ids, options) {
        assert.deepEqual(options, { pack: TRANSPORT_COMPENDIUM_ID });
        for (const id of ids) {
          const index = documents.findIndex((document) => document.id === id);
          if (index >= 0) documents.splice(index, 1);
        }
      }
    },
    async getDocuments() {
      return documents;
    }
  };
  const game = {
    system: { id: "dnd5e" },
    packs: {
      get: (id) => existingPack && id === pack.collection ? pack : null
    }
  };
  return {
    documents,
    pack,
    game,
    createdMetadata,
    async createCompendium(metadata) {
      createdMetadata.push(clone(metadata));
      return pack;
    }
  };
}

test("transport compendium constants identify a world Actor pack", () => {
  assert.equal(TRANSPORT_COMPENDIUM_NAME, "rebreya-transport");
  assert.equal(TRANSPORT_COMPENDIUM_LABEL, "Транспорт Ребреи");
  assert.equal(TRANSPORT_COMPENDIUM_ID, "world.rebreya-transport");
});

test("transport catalog loader validates the checked-in row count", async () => {
  const rows = await loadTransportCatalog({
    path: "test-catalog.json",
    fetcher: async (path) => ({
      ok: path === "test-catalog.json",
      async json() {
        return catalog;
      }
    })
  });

  assert.equal(rows.length, 62);
  await assert.rejects(
    loadTransportCatalog({
      fetcher: async () => ({ ok: true, async json() { return catalog.slice(1); } })
    }),
    /exactly 62 rows/u
  );
});

test("transport compendium sync creates one managed vehicle per catalog row and is idempotent", async () => {
  const harness = createTransportPackHarness();
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true,
    createCompendium: harness.createCompendium,
    catalogProvider: async () => catalog
  });

  const first = await service.sync();
  const second = await service.sync();

  assert.equal(first.pack.collection, TRANSPORT_COMPENDIUM_ID);
  assert.deepEqual(first.result, { unchanged: 0, created: 62, updated: 0, deleted: 0 });
  assert.equal(harness.documents.length, 62);
  assert.ok(harness.documents.every((document) => document.type === "vehicle"));
  assert.ok(harness.documents.every((document) => document.getFlag("rebreya-main", "managed") === true));
  const kettle = harness.documents.find((document) => document.name === "Автомобиль «Кипятильник»");
  assert.equal(kettle.system.attributes.movement.walk, 100);
  assert.equal(kettle.system.attributes.travel.speeds.land, 10);
  assert.equal(kettle.flags[MODULE_ID].transport.combatSpeed.primaryFt, 100);
  assert.equal(kettle.flags[MODULE_ID].transport.travelSpeed.value, 10);
  assert.deepEqual(second.result, { unchanged: 62, created: 0, updated: 0, deleted: 0 });
});

test("transport compendium sync skips inactive GM and non-dnd5e clients", async () => {
  const inactive = new TransportCompendiumService({
    gameProvider: () => ({ system: { id: "dnd5e" } }),
    isActiveGmClient: () => false
  });
  const otherSystem = new TransportCompendiumService({
    gameProvider: () => ({ system: { id: "pf2e" } }),
    isActiveGmClient: () => true
  });

  assert.deepEqual(await inactive.sync([]), { skipped: true, pack: null, result: null });
  assert.deepEqual(await otherSystem.sync([]), { skipped: true, pack: null, result: null });
});

test("transport compendium creates the exact Actor pack metadata", async () => {
  const harness = createTransportPackHarness({ existingPack: false });
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true,
    createCompendium: harness.createCompendium
  });

  await service.sync(catalog);

  assert.deepEqual(harness.createdMetadata, [{
    name: TRANSPORT_COMPENDIUM_NAME,
    label: TRANSPORT_COMPENDIUM_LABEL,
    type: "Actor",
    system: "dnd5e",
    package: "world"
  }]);
});

test("transport compendium refuses to delete an incompatible user pack", async () => {
  const harness = createTransportPackHarness({ existingPack: false });
  let deleted = 0;
  const incompatible = {
    collection: TRANSPORT_COMPENDIUM_ID,
    documentName: "Item",
    metadata: { system: "dnd5e" },
    async deleteCompendium() {
      deleted += 1;
    }
  };
  harness.game.packs.get = () => incompatible;
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true,
    createCompendium: harness.createCompendium
  });

  await assert.rejects(
    () => service.sync(catalog),
    /incompatible/u
  );

  assert.equal(deleted, 0);
  assert.equal(harness.createdMetadata.length, 0);
});

test("transport compendium updates changed managed rows, deletes stale managed rows, and keeps unmanaged actors", async () => {
  const harness = createTransportPackHarness();
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true
  });
  await service.sync(catalog);
  const changed = harness.documents[0];
  changed.flags["rebreya-main"].signature = "outdated";
  const stale = createDocument({
    _id: "staletransport01",
    name: "Устаревший",
    type: "vehicle",
    flags: {
      "rebreya-main": {
        managed: true,
        sourceId: "transport-v01-stale",
        signature: "stale"
      }
    }
  });
  const unmanaged = createDocument({
    _id: "unmanagedactor01",
    name: "Пользовательский",
    type: "vehicle",
    flags: {}
  });
  harness.documents.push(stale, unmanaged);

  const result = await service.sync(catalog);

  assert.equal(result.result.updated, 1);
  assert.equal(result.result.deleted, 1);
  assert.equal(harness.documents.includes(stale), false);
  assert.equal(harness.documents.includes(unmanaged), true);
  assert.notEqual(changed.getFlag("rebreya-main", "signature"), "outdated");
});

test("transport compendium rejects an unmanaged stable-id collision before mutation", async () => {
  const harness = createTransportPackHarness();
  const colliding = createDocument({
    _id: catalog[0].documentId,
    name: "Пользовательский транспорт",
    type: "vehicle",
    flags: {}
  });
  harness.documents.push(colliding);
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true
  });

  await assert.rejects(
    () => service.sync(catalog),
    /unmanaged document id collision/u
  );
  assert.deepEqual(harness.documents, [colliding]);
});

test("transport compendium rejects a managed stable-id collision with the wrong source identity", async () => {
  const harness = createTransportPackHarness();
  const colliding = createDocument({
    _id: catalog[0].documentId,
    name: "Чужая управляемая запись",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceId: "transport-v01-wrong-source",
        signature: "wrong"
      }
    }
  });
  harness.documents.push(colliding);
  const service = new TransportCompendiumService({
    gameProvider: () => harness.game,
    isActiveGmClient: () => true
  });

  await assert.rejects(
    () => service.sync(catalog),
    /managed document identity collision/u
  );
  assert.deepEqual(harness.documents, [colliding]);
});

test("transport speed repair restores only malformed imported fields on concrete instances", async () => {
  const source = catalog.find((row) => row.name === "Автомобиль «Кипятильник»");
  const sourceData = buildTransportActorData(source);
  const updates = [];
  const actor = {
    id: "kettle-instance",
    type: "vehicle",
    img: "world/custom-kettle.webp",
    flags: {
      [MODULE_ID]: {
        sourceId: source.sourceId,
        transport: {
          sourceId: source.sourceId,
          sourceActorUuid: `Compendium.${TRANSPORT_COMPENDIUM_ID}.Actor.${source.documentId}`,
          groupActorId: "group-a",
          instance: true,
          combatSpeed: { primaryFt: null, secondaryFt: null, raw: "[object Object]" },
          travelSpeed: { value: null, units: "mi", raw: "[object Object]" },
          instanceState: { condition: "damaged", reserveCurrent: 7, reserveCapacity: 12, reserveUnit: "gal" }
        }
      }
    },
    system: {
      attributes: {
        hp: { value: 70, max: 100 },
        movement: { walk: 0, units: "ft" },
        travel: { speeds: {}, units: "mph" }
      }
    },
    async update(patch) {
      updates.push(structuredClone(patch));
    }
  };

  const result = await repairTransportInstanceSpeeds(
    [actor],
    new Map([[source.sourceId, sourceData]])
  );

  assert.deepEqual(result, { inspected: 1, updated: 1 });
  assert.deepEqual(updates, [{
    "system.attributes.movement.walk": 100,
    "system.attributes.travel.speeds.land": 10,
    [`flags.${MODULE_ID}.transport.combatSpeed.primaryFt`]: 100,
    [`flags.${MODULE_ID}.transport.combatSpeed.secondaryFt`]: 200,
    [`flags.${MODULE_ID}.transport.combatSpeed.raw`]: "100/200 футов",
    [`flags.${MODULE_ID}.transport.travelSpeed.value`]: 10,
    [`flags.${MODULE_ID}.transport.travelSpeed.raw`]: "10 миль/час"
  }]);
  assert.equal(actor.img, "world/custom-kettle.webp");
  assert.equal(actor.system.attributes.hp.value, 70);
  assert.equal(actor.flags[MODULE_ID].transport.instanceState.reserveCurrent, 7);
});

test("transport speed repair preserves deliberate non-zero world overrides", async () => {
  const source = catalog.find((row) => row.name === "Автомобиль «Кипятильник»");
  const sourceData = buildTransportActorData(source);
  let updates = 0;
  const actor = {
    id: "custom-kettle",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        sourceId: source.sourceId,
        transport: {
          sourceId: source.sourceId,
          sourceActorUuid: `Compendium.${TRANSPORT_COMPENDIUM_ID}.Actor.${source.documentId}`,
          groupActorId: "group-a",
          instance: true,
          combatSpeed: { primaryFt: 120, secondaryFt: 240, raw: "120/240 футов" },
          travelSpeed: { value: 12, units: "mi", raw: "12 миль/час" }
        }
      }
    },
    system: {
      attributes: {
        movement: { walk: 120, units: "ft" },
        travel: { speeds: { land: 12 }, units: "mph" }
      }
    },
    async update() {
      updates += 1;
    }
  };

  const result = await repairTransportInstanceSpeeds(
    [actor],
    new Map([[source.sourceId, sourceData]])
  );

  assert.deepEqual(result, { inspected: 1, updated: 0 });
  assert.equal(updates, 0);
});

test("transport speed repair preserves a deliberate stopped transport and partial flag overrides", async () => {
  const source = catalog.find((row) => row.name === "Автомобиль «Кипятильник»");
  const sourceData = buildTransportActorData(source);
  const updates = [];
  const actor = {
    id: "stopped-kettle",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        sourceId: source.sourceId,
        transport: {
          sourceId: source.sourceId,
          instance: true,
          combatSpeed: { primaryFt: 0, secondaryFt: 333, raw: "остановлен вручную" },
          travelSpeed: { value: 0, units: "mi", raw: "остановлен вручную" }
        }
      }
    },
    system: {
      attributes: {
        movement: { walk: 0, units: "ft" },
        travel: { speeds: { land: 0 }, units: "mph" }
      }
    },
    async update(patch) {
      updates.push(structuredClone(patch));
    }
  };

  const result = await repairTransportInstanceSpeeds(
    [actor],
    new Map([[source.sourceId, sourceData]])
  );

  assert.deepEqual(result, { inspected: 1, updated: 0 });
  assert.deepEqual(updates, []);
});

test("transport speed repair merges malformed primary values without replacing valid nested overrides", async () => {
  const source = catalog.find((row) => row.name === "Автомобиль «Кипятильник»");
  const sourceData = buildTransportActorData(source);
  const updates = [];
  const actor = {
    id: "partial-kettle",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        sourceId: source.sourceId,
        transport: {
          sourceId: source.sourceId,
          instance: true,
          combatSpeed: { primaryFt: null, secondaryFt: 333, raw: "ручной второй режим" },
          travelSpeed: { value: null, units: "kn", raw: "ручные единицы" }
        }
      }
    },
    system: {
      attributes: {
        movement: { walk: 0, units: "ft" },
        travel: { speeds: { land: 0 }, units: "mph" }
      }
    },
    async update(patch) {
      updates.push(structuredClone(patch));
    }
  };

  await repairTransportInstanceSpeeds([actor], new Map([[source.sourceId, sourceData]]));

  assert.deepEqual(updates, [{
    "system.attributes.movement.walk": 100,
    "system.attributes.travel.speeds.land": 10,
    [`flags.${MODULE_ID}.transport.combatSpeed.primaryFt`]: 100,
    [`flags.${MODULE_ID}.transport.travelSpeed.value`]: 10
  }]);
});
