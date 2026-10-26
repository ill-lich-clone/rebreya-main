import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  buildManagedSpellEntry,
  buildRebreyaSpellItem,
  loadSpellDefinitions,
  SpellsCompendiumService
} = await import("../scripts/data/spells-compendium.js");

function counterspellSource() {
  return {
    _id: "nativecountersp01",
    name: "Counterspell",
    type: "spell",
    img: "icons/magic/defensive/barrier-shield-dome-blue.webp",
    system: {
      identifier: "counterspell",
      level: 3,
      source: {
        custom: "Player's Handbook"
      },
      properties: ["vocal", "somatic"],
      range: {
        value: "60",
        units: "ft",
        special: ""
      },
      activities: {
        counterspell: {
          _id: "counterspell",
          type: "utility",
          activation: {
            type: "reaction",
            value: 1,
            condition: "when you see a creature casting a spell"
          },
          consumption: {
            targets: [],
            scaling: {
              allowed: true,
              max: ""
            }
          },
          spell: {
            level: 3,
            scaling: {
              mode: "level",
              formula: ""
            }
          }
        }
      }
    },
    effects: [],
    flags: {
      dnd5e: {
        riders: {
          activity: []
        }
      }
    }
  };
}

function shieldSource() {
  return { _id: "sourceShield0001", name: "Shield", type: "spell", img: "shield.webp", folder: "cpr-folder",
    system: { identifier: "shield", level: 1, description: { value: "" }, source: { rules: "2014" },
      activities: { cast: { _id: "cast", type: "utility", consumption: { spellSlot: true, targets: [{ value: "@prof" }] },
        effects: [{ _id: "barrier" }] } } },
    effects: [{ _id: "barrier", changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "5" }],
      flags: { dae: { specialDuration: ["turnStartSource"] }, "chris-premades": { info: { identifier: "shield" } } } }],
    flags: { "chris-premades": { info: { identifier: "shield" } } } };
}

test("shipped Rebreya spell catalog includes Shield from CPR alongside Counterspell and Melf", async () => {
  const catalog = JSON.parse(await readFile(new URL("../data/rebreya-spells-v01.json", import.meta.url), "utf8"));
  assert.deepEqual(catalog.spells.find(entry => entry.id === "shield-rebreya"), {
    id: "shield-rebreya", sourceIdentifier: "shield", sourcePack: "chris-premades.CPRSpells"
  });
  assert.equal(catalog.spells.some(entry => entry.id === "counterspell-rebreya"), true);
  assert.equal(catalog.spells.some(entry => entry.id === "melfs-minute-meteors-rebreya"), true);
});

test("managed Shield compendium entry preserves native casting and signs source effects", () => {
  const definition = { id: "shield-rebreya", sourceIdentifier: "shield", sourcePack: "chris-premades.CPRSpells" };
  const source = shieldSource(); const before = structuredClone(source);
  const entry = buildManagedSpellEntry(definition, source, { description: "SRD Shield description" });
  assert.equal(entry.data.name, "Щит"); assert.equal(entry.data.system.identifier, "shield");
  assert.equal(entry.data.system.description.value, "SRD Shield description");
  assert.deepEqual(entry.data.system.activities, source.system.activities);
  assert.deepEqual(entry.data.effects, source.effects);
  assert.equal(entry.data.flags["rebreya-main"].shieldReaction.version, 1);
  assert.equal(entry.data.flags["rebreya-main"].spellId, "shield-rebreya");
  assert.equal(entry.data.folder, undefined);
  assert.deepEqual(source, before);
  source.effects[0].flags.dae.specialDuration = ["turnStart"];
  assert.notEqual(buildManagedSpellEntry(definition, source, { description: "SRD Shield description" }).signature, entry.signature);
});

test("normal Rebreya compendium sync creates Shield with SRD text and retains all spells on repeat sync", async () => {
  const old = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch };
  const catalog = JSON.parse(await readFile(new URL("../data/rebreya-spells-v01.json", import.meta.url), "utf8"));
  const documents = []; const created = []; const deleted = [];
  const pack = { collection: "world.rebreya-spells", documentName: "Item", metadata: { system: "dnd5e" },
    getDocuments: async () => documents,
    documentClass: { createDocuments: async entries => {
      for (const entry of entries) { created.push(entry); documents.push({ id: entry._id || `new${documents.length}`,
        getFlag: (scope, key) => entry.flags?.[scope]?.[key], toObject: () => structuredClone(entry),
        update: async () => { throw new Error("identical spell sync must not update"); } }); }
    }, deleteDocuments: async ids => deleted.push(...ids) } };
  const shield = shieldSource();
  const description = { ...shieldSource(), system: { ...shield.system, description: { value: "Official SRD Shield" } } };
  const sourcePack = (entries) => ({
    getIndex: async () => entries.map(data => ({ _id: data._id, system: { identifier: data.system.identifier } })),
    getDocument: async id => ({ toObject: () => structuredClone(entries.find(data => data._id === id)) })
  });
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm }, system: { id: "dnd5e" },
    packs: new Map([["world.rebreya-spells", pack], ["dnd5e.spells", sourcePack([counterspellSource(), description])],
      ["chris-premades.CPRSpells", sourcePack([shield])]]) };
  globalThis.foundry = {};
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(catalog) });
  try {
    const service = new SpellsCompendiumService();
    assert.deepEqual((await service.sync()).sync, { unchanged: 0, created: 3, updated: 0, deleted: 0 });
    assert.deepEqual((await service.sync()).sync, { unchanged: 3, created: 0, updated: 0, deleted: 0 });
    const copied = created.find(data => data.flags["rebreya-main"].spellId === "shield-rebreya");
    assert.equal(copied.name, "Щит"); assert.equal(copied.system.description.value, "Official SRD Shield");
    assert.deepEqual(copied.effects, shield.effects);
    assert.equal(copied.flags["rebreya-main"].shieldReaction.version, 1);
    assert.deepEqual(deleted, []);
  } finally { Object.assign(globalThis, old); }
});

test("Rebreya Counterspell is a third-level reaction spell", () => {
  const item = buildRebreyaSpellItem(counterspellSource());

  assert.equal(item.system.identifier, "counterspell-rebreya");
  assert.equal(item.system.level, 3);
  assert.equal(item.system.activities.counterspell._id, "counterspell0000");
  assert.match(item.system.activities.counterspell._id, /^[A-Za-z0-9]{16}$/u);
  assert.equal(item.system.activities.counterspell.activation.type, "reaction");
  assert.deepEqual(item.flags["rebreya-main"].spellAutomation, { kind: "counterspell" });
  assert.deepEqual(item.system.properties, ["vocal", "somatic"]);
  assert.deepEqual(item.system.range, { value: "60", units: "ft", special: "" });
  assert.deepEqual(item.system.activities.counterspell.spell.scaling, {
    mode: "level",
    formula: ""
  });
});

test("Rebreya Counterspell strips native check activities so automation owns the roll outcome", () => {
  const source = counterspellSource();
  source.system.activities.counterspell = {
    ...source.system.activities.counterspell,
    type: "check",
    check: {
      ability: "int",
      dc: {
        calculation: "spellcasting"
      }
    }
  };
  source.system.activities.backup = {
    _id: "backup",
    type: "utility",
    activation: {
      type: "reaction",
      value: 1,
      condition: ""
    },
    consumption: {
      targets: [],
      scaling: {
        allowed: true,
        max: ""
      }
    },
    spell: {
      level: 3,
      scaling: {
        mode: "level",
        formula: ""
      }
    }
  };

  const item = buildRebreyaSpellItem(source);

  assert.deepEqual(Object.keys(item.system.activities), ["counterspell"]);
  assert.equal(item.system.activities.counterspell.type, "utility");
  assert.equal(item.system.activities.counterspell.check, undefined);
});

test("spell definitions accept source and builder routes while rejecting incomplete or unknown entries", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      sourcePack: "dnd5e.spells",
      spells: [
        { id: "counterspell-rebreya", sourceIdentifier: "counterspell" },
        { id: "melfs-minute-meteors-rebreya", builder: "melfs-minute-meteors", version: 1 }
      ]
    })
  });

  try {
    assert.deepEqual(await loadSpellDefinitions(), {
      sourcePack: "dnd5e.spells",
      spells: [
        { id: "counterspell-rebreya", sourceIdentifier: "counterspell" },
        { id: "melfs-minute-meteors-rebreya", builder: "melfs-minute-meteors", version: 1 }
      ]
    });
  }
  finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      spells: [
        { id: "missing-route" },
        { id: "unknown-route", builder: "unregistered-builder", version: 1 }
      ]
    })
  });
  try {
    await assert.rejects(loadSpellDefinitions(), /invalid spell definition/i);
  }
  finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed Melf entries retain their logical id and receive a signature from generated data", () => {
  const definition = { id: "melfs-minute-meteors-rebreya", builder: "melfs-minute-meteors", version: 1 };
  const entry = buildManagedSpellEntry(definition);

  assert.equal(entry.spellId, "melfs-minute-meteors-rebreya");
  assert.equal(entry.documentId, "melfMeteorsItem1");
  assert.equal(typeof entry.signature, "string");
  assert.ok(entry.signature.length > 0);
  assert.equal(entry.data.flags["rebreya-main"].managed, true);
  assert.equal(entry.data.flags["rebreya-main"].spellId, "melfs-minute-meteors-rebreya");
  assert.equal(entry.data.flags["rebreya-main"].signature, entry.signature);
  assert.equal(JSON.parse(entry.signature).name, "Мельфовы маленькие метеоры");
});

test("spell sync creates Melf once and reports it unchanged on an identical second sync", async () => {
  const originalFetch = globalThis.fetch;
  const originalGame = globalThis.game;
  const originalFoundry = globalThis.foundry;
  const documents = [];
  const operations = [];
  const pack = {
    collection: "world.rebreya-spells",
    documentName: "Item",
    metadata: { system: "dnd5e" },
    documentClass: {
      async createDocuments(data) {
        operations.push(["create", data.map((entry) => entry._id)]);
        documents.push(...data.map((entry) => ({
          id: entry._id,
          _id: entry._id,
          getFlag(scope, key) {
            return entry.flags?.[scope]?.[key];
          },
          async update() {
            throw new Error("an identical Melf sync must not update");
          }
        })));
      },
      async deleteDocuments(ids) {
        operations.push(["delete", ids]);
      }
    },
    async getDocuments() {
      return documents;
    }
  };
  const packs = new Map([["world.rebreya-spells", pack]]);
  const activeGm = { id: "gm-1", isGM: true, active: true };
  globalThis.game = {
    user: activeGm,
    system: { id: "dnd5e" },
    packs,
    users: { activeGM: activeGm, contents: [activeGm] }
  };
  globalThis.foundry = {
    documents: {
      collections: {
        CompendiumCollection: {
          async createCompendium() {
            return pack;
          }
        }
      }
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      spells: [{ id: "melfs-minute-meteors-rebreya", builder: "melfs-minute-meteors", version: 1 }]
    })
  });

  try {
    const service = new SpellsCompendiumService();
    const first = await service.sync();
    const second = await service.sync();

    assert.deepEqual(first.sync, { unchanged: 0, created: 1, updated: 0, deleted: 0 });
    assert.deepEqual(second.sync, { unchanged: 1, created: 0, updated: 0, deleted: 0 });
    assert.deepEqual(operations, [["create", ["melfMeteorsItem1"]]]);
  }
  finally {
    globalThis.fetch = originalFetch;
    globalThis.game = originalGame;
    globalThis.foundry = originalFoundry;
  }
});

test("spell sync skips a non-active GM before any pack or network access", async () => {
  const originalFetch = globalThis.fetch;
  const originalGame = globalThis.game;
  const originalFoundry = globalThis.foundry;
  let fetches = 0;
  const activeGm = { id: "gm-1", isGM: true, active: true };
  const secondGm = { id: "gm-2", isGM: true, active: true };
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("a non-active GM must not fetch spell definitions");
  };
  globalThis.game = {
    user: secondGm,
    system: { id: "dnd5e" },
    users: { activeGM: activeGm, contents: [activeGm, secondGm] },
    packs: {
      get() {
        throw new Error("a non-active GM must not read packs");
      }
    }
  };
  globalThis.foundry = {
    documents: {
      collections: {
        CompendiumCollection: {
          async createCompendium() {
            throw new Error("a non-active GM must not create a pack");
          }
        }
      }
    }
  };

  try {
    assert.deepEqual(await new SpellsCompendiumService().sync(), {
      skipped: true,
      pack: null,
      sync: { skipped: true, unchanged: 0, created: 0, updated: 0, deleted: 0 }
    });
    assert.equal(fetches, 0);
  }
  finally {
    globalThis.fetch = originalFetch;
    globalThis.game = originalGame;
    globalThis.foundry = originalFoundry;
  }
});
