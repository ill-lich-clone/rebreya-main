import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TRANSPORT_COMPENDIUM_ID,
  TRANSPORT_COMPENDIUM_LABEL,
  TRANSPORT_COMPENDIUM_NAME
} from "../scripts/constants.js";
import {
  TransportCompendiumService,
  loadTransportCatalog
} from "../scripts/data/transport-compendium.js";

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
