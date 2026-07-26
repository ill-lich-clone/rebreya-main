import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;"),
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let cursor = object;
      while (keys.length > 1) {
        const key = keys.shift();
        cursor[key] ??= {};
        cursor = cursor[key];
      }
      cursor[keys[0]] = value;
      return true;
    }
  }
};

globalThis.game ??= {
  user: { id: "user", isGM: true },
  packs: new Map()
};

const {
  PALADIN_DOGMA_OPERATION_OPTION,
  PaladinDogmaAutomationService,
  normalizePaladinDogmaSelection,
  paladinOathIdFromSubclass
} = await import("../scripts/combat/paladin-dogma-automation-service.js");
const { getPaladinDogmas } = await import("../scripts/data/paladin-dogmas.js");
const { registerCombatHooks } = await import("../scripts/combat/hooks.js");

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    foundry.utils.setProperty(target, path, foundry.utils.deepClone(value));
  }
}

function makeOwnedItem({
  id,
  type,
  name,
  identifier = "",
  levels = 0,
  flags = {},
  prepared = undefined
}) {
  return {
    id,
    uuid: `Actor.test.Item.${id}`,
    type,
    name,
    system: {
      identifier,
      levels,
      ...(prepared === undefined ? {} : { prepared })
    },
    flags: foundry.utils.deepClone(flags),
    updates: [],
    async update(patch, options = {}) {
      this.updates.push({ patch, options });
      applyPatch(this, patch);
      return this;
    }
  };
}

class TestActor {
  constructor(items = []) {
    this.id = "test";
    this.uuid = "Actor.test";
    this.name = "Паладин";
    this.isOwner = true;
    this.created = [];
    this.items = {
      contents: items,
      get: (id) => items.find((item) => item.id === id) ?? null,
      values: () => items.values(),
      [Symbol.iterator]: function* iterator() {
        yield* items;
      }
    };
    for (const item of items) {
      item.parent = this;
      item.actor = this;
    }
  }

  async createEmbeddedDocuments(type, documents, options = {}) {
    assert.equal(type, "Item");
    this.created.push({ documents: foundry.utils.deepClone(documents), options });
    return documents.map((document, index) => {
      const item = makeOwnedItem({
        id: `created-${this.items.contents.length + index}`,
        type: document.type,
        name: document.name,
        identifier: document.system?.identifier,
        flags: document.flags,
        prepared: document.system?.prepared
      });
      item.system = foundry.utils.deepClone(document.system ?? {});
      item.parent = this;
      item.actor = this;
      this.items.contents.push(item);
      return item;
    });
  }
}

function makeClass(level) {
  return makeOwnedItem({
    id: "paladin-class",
    type: "class",
    name: "Паладин (реворк V0.1)",
    identifier: "paladin-rework-v01",
    levels: level
  });
}

function makeSubclass(oathId) {
  const identifier = oathId === "oathbreaker"
    ? "paladin-oathbreaker"
    : `paladin-oath-${oathId}`;
  return makeOwnedItem({
    id: `subclass-${oathId}`,
    type: "subclass",
    name: identifier,
    identifier
  });
}

function makeDedication() {
  return makeOwnedItem({
    id: "dedication",
    type: "feat",
    name: "Посвящение в догматы паладина",
    identifier: "posvyaschenie-v-dogmaty-paladina"
  });
}

function makeDogmaDocument(dogma) {
  return {
    uuid: `Compendium.world.rebreya-class-features.Item.${dogma.id}`,
    toObject: () => ({
      name: `Догмат: ${dogma.spell.nameRu}`,
      type: "feat",
      system: {
        identifier: dogma.id,
        description: { value: dogma.tenet }
      },
      flags: {
        "rebreya-main": {
          paladinDogma: foundry.utils.deepClone(dogma)
        }
      }
    })
  };
}

function makeSpellDocument(dogma) {
  return {
    uuid: `Compendium.world.rebreya-spells.Item.${dogma.spell.identifier}`,
    name: dogma.spell.nameRu,
    type: "spell",
    system: {
      identifier: dogma.spell.identifier,
      prepared: 0,
      method: "",
      sourceClass: ""
    },
    flags: {},
    toObject() {
      return foundry.utils.deepClone({
        name: this.name,
        type: this.type,
        system: this.system,
        flags: this.flags
      });
    }
  };
}

function makeService(options = {}) {
  return new PaladinDogmaAutomationService(null, {
    chooseOath: async () => null,
    chooseDogmas: async ({ dogmas }) => [dogmas[0].id],
    resolveDogmaDocument: async (dogma) => makeDogmaDocument(dogma),
    resolveSpellDocument: async (dogma) => makeSpellDocument(dogma),
    notifyWarning: () => {},
    ...options
  });
}

test("dogma selection accepts one or two available dogmas and rejects every other shape", () => {
  const dogmas = getPaladinDogmas("devotion", 3);
  assert.deepEqual(normalizePaladinDogmaSelection([dogmas[0].id], dogmas), [dogmas[0].id]);
  assert.deepEqual(normalizePaladinDogmaSelection([dogmas[0].id, dogmas[1].id], dogmas), [
    dogmas[0].id,
    dogmas[1].id
  ]);
  assert.deepEqual(normalizePaladinDogmaSelection([], dogmas), []);
  assert.deepEqual(normalizePaladinDogmaSelection([dogmas[0].id, dogmas[1].id, "extra"], dogmas), []);
  assert.deepEqual(normalizePaladinDogmaSelection(["missing"], dogmas), []);
});

test("subclass identifiers map to all seven paladin oaths", () => {
  assert.equal(paladinOathIdFromSubclass(makeSubclass("devotion")), "devotion");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("vengeance")), "vengeance");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("glory")), "glory");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("oathbreaker")), "oathbreaker");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("nirkadu")), "nirkadu");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("arcana")), "arcana");
  assert.equal(paladinOathIdFromSubclass(makeSubclass("magistrate")), "magistrate");
});

test("reconcile prompts reached class thresholds in order and grants every selected dogma spell prepared", async () => {
  const subclass = makeSubclass("devotion");
  const actor = new TestActor([makeClass(9), subclass]);
  const promptedLevels = [];
  const service = makeService({
    chooseDogmas: async ({ level, dogmas }) => {
      promptedLevels.push(level);
      return level === 5 ? dogmas.map((dogma) => dogma.id) : [dogmas[0].id];
    }
  });

  await service.reconcileActor(actor);

  assert.deepEqual(promptedLevels, [3, 5, 9]);
  assert.deepEqual(subclass.flags["rebreya-main"].paladinDogmaChoices, {
    oathId: "devotion",
    selections: {
      3: ["devotion-3-protection-from-evil-and-good"],
      5: ["devotion-5-lesser-restoration", "devotion-5-see-invisibility"],
      9: ["devotion-9-dispel-magic"]
    }
  });
  const dogmaItems = actor.items.contents.filter((item) => item.flags?.["rebreya-main"]?.paladinDogma);
  const spells = actor.items.contents.filter((item) => item.type === "spell");
  assert.equal(dogmaItems.length, 4);
  assert.equal(spells.length, 4);
  assert.equal(spells.every((spell) => spell.system.prepared === 1), true);
  assert.equal(spells.every((spell) => spell.flags["rebreya-main"].paladinDogmaSpell.dogmaIds.length === 1), true);
  assert.equal(actor.created.every((entry) => entry.options[PALADIN_DOGMA_OPERATION_OPTION] === true), true);

  await service.reconcileActor(actor);
  assert.deepEqual(promptedLevels, [3, 5, 9]);
  assert.equal(actor.items.contents.filter((item) => item.type === "spell").length, 4);
});

test("dedication independently chooses an oath and one or two level-three dogmas without a paladin class", async () => {
  const dedication = makeDedication();
  const actor = new TestActor([dedication]);
  let oathPrompts = 0;
  const service = makeService({
    chooseOath: async () => {
      oathPrompts += 1;
      return "arcana";
    },
    chooseDogmas: async ({ dogmas }) => dogmas.map((dogma) => dogma.id)
  });

  await service.reconcileActor(actor);

  assert.equal(oathPrompts, 1);
  assert.deepEqual(dedication.flags["rebreya-main"].paladinDogmaChoices, {
    oathId: "arcana",
    selections: {
      3: ["arcana-3-absorb-elements", "arcana-3-detect-magic"]
    }
  });
  assert.equal(actor.items.contents.filter((item) => item.type === "spell").length, 2);
});

test("cancelled or unresolved choices leave the threshold and actor inventory unchanged", async () => {
  const cancelledSubclass = makeSubclass("devotion");
  const cancelledActor = new TestActor([makeClass(3), cancelledSubclass]);
  await makeService({ chooseDogmas: async () => null }).reconcileActor(cancelledActor);
  assert.equal(cancelledSubclass.flags["rebreya-main"]?.paladinDogmaChoices, undefined);
  assert.equal(cancelledActor.created.length, 0);

  const unresolvedSubclass = makeSubclass("devotion");
  const unresolvedActor = new TestActor([makeClass(3), unresolvedSubclass]);
  const warnings = [];
  await makeService({
    chooseDogmas: async ({ dogmas }) => dogmas.map((dogma) => dogma.id),
    resolveSpellDocument: async (dogma) => (
      dogma.spell.identifier === "sanctuary" ? null : makeSpellDocument(dogma)
    ),
    notifyWarning: (message) => warnings.push(message)
  }).reconcileActor(unresolvedActor);

  assert.equal(unresolvedSubclass.flags["rebreya-main"]?.paladinDogmaChoices, undefined);
  assert.equal(unresolvedActor.created.length, 0);
  assert.match(warnings[0], /Убежище/u);
});

test("shared dogma spells are reused and retain every source dogma id", async () => {
  const subclass = makeSubclass("vengeance");
  const dedication = makeDedication();
  const actor = new TestActor([makeClass(3), subclass, dedication]);
  const service = makeService({
    chooseOath: async () => "nirkadu",
    chooseDogmas: async ({ oath }) => {
      const hunterMark = getPaladinDogmas(oath.id, 3)
        .find((dogma) => dogma.spell.identifier === "hunters-mark");
      return [hunterMark.id];
    }
  });

  await service.reconcileActor(actor);

  const spells = actor.items.contents.filter((item) => item.type === "spell");
  assert.equal(spells.length, 1);
  assert.deepEqual(spells[0].flags["rebreya-main"].paladinDogmaSpell.dogmaIds, [
    "vengeance-3-hunters-mark",
    "nirkadu-3-hunters-mark"
  ]);
  assert.equal(spells[0].system.prepared, 1);
});

test("item hooks ignore recursive operations and restore a dogma spell to prepared", async () => {
  const spell = makeOwnedItem({
    id: "dogma-spell",
    type: "spell",
    name: "Приказ",
    identifier: "command",
    prepared: 0,
    flags: {
      "rebreya-main": {
        paladinDogmaSpell: { dogmaIds: ["magistrate-3-command"] }
      }
    }
  });
  const actor = new TestActor([spell]);
  const service = makeService();

  await service.handleUpdatedItem(spell, { system: { prepared: 0 } }, {}, "user");
  assert.equal(spell.system.prepared, 1);
  assert.equal(spell.updates[0].options[PALADIN_DOGMA_OPERATION_OPTION], true);

  spell.system.prepared = 0;
  await service.handleUpdatedItem(
    spell,
    { system: { prepared: 0 } },
    { [PALADIN_DOGMA_OPERATION_OPTION]: true },
    "user"
  );
  assert.equal(spell.system.prepared, 0);
  assert.equal(actor.created.length, 0);
});

test("combat hooks dispatch owned item creation and updates to the dogma service", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const calls = [];
  globalThis.Hooks = {
    on(name, listener) {
      listeners.push({ name, listener });
      return listeners.length;
    }
  };
  globalThis.game = {
    user: { id: "user", isGM: true }
  };

  try {
    registerCombatHooks({
      paladinDogmaAutomationService: {
        async handleCreatedItem(...args) {
          calls.push(["create", ...args]);
        },
        async handleUpdatedItem(...args) {
          calls.push(["update", ...args]);
        }
      }
    });

    const item = { id: "item" };
    const create = listeners.find((entry) => entry.name === "createItem");
    const update = listeners.find((entry) => entry.name === "updateItem");
    assert.equal(typeof create?.listener, "function");
    assert.equal(typeof update?.listener, "function");
    await create.listener(item, { create: true }, "user");
    await update.listener(item, { system: { levels: 3 } }, { update: true }, "user");
    assert.deepEqual(calls, [
      ["create", item, { create: true }, "user"],
      ["update", item, { system: { levels: 3 } }, { update: true }, "user"]
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
