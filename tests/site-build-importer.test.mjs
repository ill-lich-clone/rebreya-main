import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// --- Minimal Foundry fakes ------------------------------------------------------
// Just enough of game/foundry/Actor for SiteBuildImporter: compendium index +
// getDocument, fromUuid, game.items.fromCompendium, embedded item CRUD.

const SRD = JSON.parse(readFileSync(new URL("./fixtures/dnd5e-srd-build-sample.json", import.meta.url), "utf-8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
let idCounter = 0;

function setProperty(obj, path, value) {
  const keys = path.split(".");
  let target = obj;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}
function getProperty(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function makeDoc(packId, data) {
  return { uuid: `Compendium.${packId}.Item.${data._id}`, name: data.name, toObject: () => clone(data), _data: data };
}

function makePack(packId, items) {
  const docs = new Map(items.map((d) => [d._id, makeDoc(packId, d)]));
  return {
    getIndex: async () => new Map(items.map((d) => [d._id, { _id: d._id, name: d.name, type: d.type, system: d.system }])),
    getDocument: async (id) => docs.get(id) ?? null,
  };
}

function makeItem(data) {
  const item = {
    ...clone(data),
    get id() { return this._id; },
    getFlag(scope, key) { return getProperty(this.flags ?? {}, `${scope}.${key}`); },
    async updateAdvancement(advId, updates) {
      const adv = this.system.advancement.find((a) => a._id === advId);
      Object.assign(adv, clone(updates));
    },
  };
  return item;
}

function makeActor(initialItems = []) {
  const items = initialItems.map(makeItem);
  const api = {
    flags: {},
    updates: [],
    items: Object.assign(items, { get: (id) => items.find((i) => i.id === id) }),
    getFlag(scope, key) { return getProperty(this.flags, `${scope}.${key}`); },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) items.splice(items.findIndex((i) => i.id === id), 1);
    },
    async createEmbeddedDocuments(_type, data) {
      const created = data.map(makeItem);
      items.push(...created);
      return created;
    },
    async update(data) {
      this.updates.push(data);
      for (const [path, value] of Object.entries(data)) {
        if (path.startsWith("flags.")) {
          const rest = path.slice(6);
          if (rest.includes(".-=")) {
            const [scope, key] = rest.split(".-=");
            delete this.flags[scope]?.[key];
          } else setProperty(this.flags, rest, value);
        }
      }
    },
  };
  return api;
}

// A generic feature for every ItemGrant uuid in the fixtures.
const FEATURE = (uuid) => ({ uuid, name: `Feature ${uuid.split(".").pop()}`, toObject: () => ({ name: `Feature ${uuid}`, type: "feat", system: {} }) });

function installGlobals({ rebreyaRaces = [] } = {}) {
  const packs = new Map([
    ["dnd5e.classes", makePack("dnd5e.classes", [SRD.wizard])],
    ["dnd5e.subclasses", makePack("dnd5e.subclasses", [SRD.schoolOfEvocation])],
    ["dnd5e.races", makePack("dnd5e.races", [SRD.rockGnome])],
    ["dnd5e.backgrounds", makePack("dnd5e.backgrounds", [SRD.acolyte])],
  ]);
  if (rebreyaRaces.length) packs.set("world.rebreya-races", makePack("world.rebreya-races", rebreyaRaces));
  globalThis.foundry = { utils: { randomID: () => `id${String(++idCounter).padStart(14, "0")}`, setProperty } };
  globalThis.fromUuid = async (uuid) => FEATURE(uuid);
  globalThis.game = {
    packs: { get: (id) => packs.get(id) ?? null },
    items: {
      fromCompendium: (doc) => {
        const data = doc.toObject();
        delete data._id;
        return { ...data, _stats: { compendiumSource: doc.uuid } };
      },
    },
  };
}

const { SiteBuildImporter } = await import("../scripts/integrations/site-build-importer.js");

// Site record in the real format (Frontend CharacterForm.tsx).
const WIZARD = {
  name: "Тест", gameClass: "Волшебник", classSlug: "105-wizard", subclass: "Школа Воплощения", level: 5,
  race: "Гном", raceSlug: "83-gnome", background: "Прислужник", backgroundSlug: "766-acolyte",
  data: { spellSlots: { 1: 4, 2: 3, 3: 2 }, multiclass: [] },
};

const siteBuildItems = (actor) => actor.items.filter((i) => i.getFlag("rebreya-main", "siteBuild"));

test("import creates class, subclass, race, background and granted features with dnd5e flags", async () => {
  installGlobals();
  const actor = makeActor();
  const res = await new SiteBuildImporter().import(actor, WIZARD);
  const types = actor.items.map((i) => i.type);
  assert.equal(types.filter((t) => t === "class").length, 1);
  assert.equal(types.filter((t) => t === "subclass").length, 1);
  assert.equal(types.filter((t) => t === "race").length, 1);
  assert.equal(types.filter((t) => t === "background").length, 1);
  const wizard = actor.items.find((i) => i.type === "class");
  assert.equal(wizard.system.levels, 5);
  // Features granted at 1 and 2 (2 + 1) + Evocation at 2 (2) + gnome (3) + acolyte (1).
  assert.equal(types.filter((t) => t === "feat").length, 9);
  const feature = actor.items.find((i) => i.getFlag("dnd5e", "advancementOrigin")?.startsWith(wizard.id));
  assert.ok(feature, "class feature carries advancementOrigin");
  const grant = wizard.system.advancement.find((a) => a.type === "ItemGrant" && a.level === 1);
  assert.equal(Object.keys(grant.value.added).length, 2);
  const sub = wizard.system.advancement.find((a) => a.type === "Subclass");
  assert.equal(sub.value.document, actor.items.find((i) => i.type === "subclass").id);
  assert.deepEqual(wizard.system.advancement.find((a) => a.type === "HitPoints").value, { 1: "max", 2: "avg", 3: "avg", 4: "avg", 5: "avg" });
  assert.equal(res.created, actor.items.length);
  // A class was resolved → dnd5e derives slots; no override written.
  assert.equal(actor.updates.some((u) => "system.spells.spell1.override" in u), false);
});

test("re-import is idempotent and never touches hand-added items", async () => {
  installGlobals();
  const handAdded = { _id: "handmade0000001", name: "Меч игрока", type: "weapon", system: {}, flags: {} };
  const actor = makeActor([handAdded]);
  const importer = () => new SiteBuildImporter().import(actor, WIZARD);
  await importer();
  const firstCount = actor.items.length;
  const firstOurs = siteBuildItems(actor).length;
  await importer();
  assert.equal(actor.items.length, firstCount);
  assert.equal(siteBuildItems(actor).length, firstOurs);
  assert.ok(actor.items.get("handmade0000001"), "hand-added item kept");
});

test("a hand-added class with the same identifier is kept and the site one skipped", async () => {
  installGlobals();
  const manual = { _id: "manualclass0001", name: "Волшебник", type: "class", system: { identifier: "wizard", levels: 3 }, flags: {} };
  const actor = makeActor([manual]);
  const res = await new SiteBuildImporter().import(actor, WIZARD);
  assert.equal(actor.items.filter((i) => i.type === "class").length, 1);
  assert.equal(actor.items.get("manualclass0001").system.levels, 3);
  assert.ok(res.warnings.some((w) => w.includes("добавлен вручную")));
});

test("unresolved class → placeholder + spellSlots override; resolving later clears it", async () => {
  installGlobals();
  const actor = makeActor();
  const strelok = { ...WIZARD, gameClass: "Стрелок", classSlug: "strelok", subclass: "", race: "", raceSlug: "", background: "", backgroundSlug: "", level: 3 };
  const res = await new SiteBuildImporter().import(actor, strelok);
  const cls = actor.items.find((i) => i.type === "class");
  assert.equal(cls.system.identifier, "strelok");
  assert.equal(cls.system.levels, 3);
  const overrides = actor.updates.find((u) => "system.spells.spell1.override" in u);
  assert.equal(overrides["system.spells.spell1.override"], 4);
  assert.equal(overrides["system.spells.spell3.override"], 2);
  assert.equal(actor.getFlag("rebreya-main", "siteSlotOverride"), true);
  assert.ok(res.warnings.some((w) => w.includes("override")));

  await new SiteBuildImporter().import(actor, WIZARD);
  const cleared = actor.updates.at(-1);
  assert.equal(cleared["system.spells.spell1.override"], null);
  assert.equal(actor.getFlag("rebreya-main", "siteSlotOverride"), undefined);
});

test("Rebreya race comes from the module compendium, not a placeholder", async () => {
  installGlobals({ rebreyaRaces: [{ _id: "rbrace000000001", name: "Кирисан", type: "race", system: { identifier: "kirisan", advancement: [] } }] });
  const actor = makeActor();
  const res = await new SiteBuildImporter().import(actor, { ...WIZARD, race: "Кирисаны (Аасимары)", raceSlug: "kirisany-aasimary" });
  const race = actor.items.find((i) => i.type === "race");
  assert.equal(race.name, "Кирисан");
  assert.equal(race.flags.dnd5e.sourceId, "Compendium.world.rebreya-races.Item.rbrace000000001");
  assert.equal(res.warnings.some((w) => w.includes("Раса")), false);
});
