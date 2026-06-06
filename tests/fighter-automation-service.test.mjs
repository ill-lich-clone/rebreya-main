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

globalThis.Actor ??= class Actor {};
globalThis.ActiveEffect ??= class ActiveEffect {};
globalThis.ChatMessage ??= {
  create: async (data) => data,
  getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? "" })
};
globalThis.game ??= {
  user: {
    id: "user",
    isGM: true
  },
  combat: null,
  socket: null
};

const { FighterAutomationService } = await import("../scripts/combat/fighter-automation-service.js");

class TestActor extends Actor {
  constructor({ id = "actor", name = "Actor", hp = {}, classes = {}, items = [], effects = [], currency = {} } = {}) {
    super();
    this.id = id;
    this.uuid = `Actor.${id}`;
    this.name = name;
    this.isOwner = true;
    this.system = {
      abilities: {
        con: { mod: 3 }
      },
      classes,
      attributes: {
        hp: {
          value: hp.value ?? 10,
          max: hp.max ?? 30,
          temp: 0
        }
      },
      currency: {
        gp: currency.gp ?? 0
      }
    };
    this.items = {
      contents: items,
      get: (itemId) => items.find((item) => item.id === itemId) ?? null,
      values: () => items.values(),
      [Symbol.iterator]: function* iterator() {
        yield* items;
      }
    };
    for (const item of items) {
      item.actor = this;
    }
    this.effects = {
      contents: effects,
      values: () => effects.values(),
      [Symbol.iterator]: function* iterator() {
        yield* effects;
      }
    };
    this.damageApplications = [];
    this.updates = [];
    this.createdEffects = [];
    this.createdItems = [];
    this.deletedDocuments = [];
  }

  getRollData() {
    return {
      abilities: this.system.abilities,
      attributes: this.system.attributes
    };
  }

  async applyDamage(damages, options) {
    this.damageApplications.push({ damages, options });
    return true;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  async createEmbeddedDocuments(type, rows, options = {}) {
    if (type === "Item") {
      this.createdItems.push({ type, rows, options });
      for (const [index, row] of rows.entries()) {
        const item = makeItem({
          id: row._id ?? `created-${this.createdItems.length}-${index}`,
          name: row.name,
          featureId: foundry.utils.getProperty(row, "flags.rebreya-main.featureId")
        });
        this.items.contents.push(item);
        item.actor = this;
      }
      return rows;
    }

    this.createdEffects.push({ type, rows });
    return rows;
  }

  async deleteEmbeddedDocuments(type, ids) {
    this.deletedDocuments.push({ type, ids });
    if (type === "Item") {
      this.items.contents = this.items.contents.filter((item) => !ids.includes(item.id));
    }
    return ids;
  }
}

function makeItem({ id, name, featureId = "", uses = null, type = "feat", flags = null, system = {} } = {}) {
  return {
    id,
    _id: id,
    uuid: `Item.${id}`,
    name,
    type,
    system: {
      uses: uses ?? {
        spent: 0,
        max: ""
      },
      ...system
    },
    flags: flags ?? {
      "rebreya-main": {
        featureId
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    updates: [],
    updateOptions: [],
    async update(patch, options = {}) {
      this.updates.push(patch);
      this.updateOptions.push(options);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function makeActivity({ actor, item, automation, fighterAutomation } = {}) {
  return {
    actor,
    item,
    type: "utility",
    name: item?.name ?? "Activity",
    flags: {
      "rebreya-main": {
        automation,
        fighterAutomation
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function makeClassItem({ actor, classIdentifier = "fighter-rework-v028" } = {}) {
  return {
    id: "fighter-class",
    _id: "fighter-class",
    uuid: "Item.fighter-class",
    name: "Воин (реворк V0.28)",
    type: "class",
    actor,
    system: {
      identifier: classIdentifier
    },
    flags: {
      "rebreya-main": {
        classIdentifier
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key] = value;
      return this;
    }
  };
}

function makeStartingEquipmentSource(uuid, { type = "loot", contents = [] } = {}) {
  return {
    name: uuid.split(".").at(-1),
    uuid,
    type,
    system: {
      quantity: 1,
      contents: {
        values: () => contents.values(),
        [Symbol.iterator]: function* iterator() {
          yield* contents;
        }
      }
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

function makeDominanceActivity({ target = "fighter-dominance", fighterAutomation = null } = {}) {
  return {
    _id: "dominance-activity",
    type: "utility",
    consumption: {
      targets: [{
        type: "itemUses",
        target,
        value: "1",
        scaling: {
          mode: "",
          formula: ""
        }
      }]
    },
    flags: {
      "rebreya-main": {
        automation: "fighter-dominance-maneuver",
        fighterAutomation
      }
    },
    range: {
      value: null,
      units: "self"
    },
    target: {
      affects: {
        type: "self"
      },
      prompt: false
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function fixedRoll(total) {
  return {
    total,
    async evaluate() {
      return this;
    },
    async toMessage(data) {
      this.message = data;
      return data;
    }
  };
}

test("fighter class creation prompts for starting equipment and grants selected items", async () => {
  const actor = new TestActor({ id: "fighter", name: "Воин" });
  const classItem = makeClassItem({ actor });
  let promptChoices = null;
  const resolvedUuids = [];
  const resolvedGearIds = [];
  const service = new FighterAutomationService({}, {
    promptFighterStartingEquipment: async (_actor, _item, choices) => {
      promptChoices = choices;
      return {
        package: "b"
      };
    },
    resolveStartingEquipmentGearUuid: async (gearId) => {
      resolvedGearIds.push(gearId);
      return `Compendium.world.rebreya-gear.Item.${gearId}`;
    },
    resolveStartingEquipmentItem: async (uuid) => {
      resolvedUuids.push(uuid);
      return makeStartingEquipmentSource(uuid);
    }
  });

  await service.handleCreatedItem(classItem);

  assert.deepEqual(promptChoices.packages.map((choice) => choice.id), ["a", "b", "c"]);
  assert.equal(actor.createdItems.length, 1);

  const rows = actor.createdItems[0].rows;
  const quantityByUuid = new Map(rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "system.quantity")
  ]));

  assert.deepEqual(resolvedGearIds, [
    "proklyopannyy-kozhanyy-dospekh",
    "skimitar",
    "korotkiy-mech",
    "dlinnyy-luk",
    "strely-20",
    "kolchan",
    "nabor-issledovatelya-podzemeliy"
  ]);
  assert.deepEqual(resolvedUuids, resolvedGearIds.map((gearId) => `Compendium.world.rebreya-gear.Item.${gearId}`));
  assert.equal(quantityByUuid.get("Compendium.world.rebreya-gear.Item.strely-20"), 1);
  assert.equal(actor.system.currency.gp, 11);
  assert.equal(actor.createdItems[0].options.keepId, true);
  assert.equal(classItem.flags["rebreya-main"].startingEquipmentPrompted, true);
});

test("fighter starting equipment package items expand into Rebreya gear and gold", async () => {
  const packageItem = makeItem({
    id: "package-a",
    name: "Стартовое снаряжение: Вариант А",
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipmentPackage",
        startingEquipmentPackageId: "a"
      }
    }
  });
  const actor = new TestActor({ id: "fighter", name: "Воин", items: [packageItem] });
  const resolvedGearIds = [];
  const service = new FighterAutomationService({}, {
    resolveStartingEquipmentGearUuid: async (gearId) => {
      resolvedGearIds.push(gearId);
      return `Compendium.world.rebreya-gear.Item.${gearId}`;
    },
    resolveStartingEquipmentItem: async (uuid) => makeStartingEquipmentSource(uuid)
  });

  await service.handleCreatedItem(packageItem);

  assert.deepEqual(resolvedGearIds, [
    "kol-chuga",
    "dvuruchnyy-mech",
    "tsep",
    "kop-e",
    "nabor-issledovatelya-podzemeliy"
  ]);
  assert.equal(actor.createdItems.length, 1);

  const quantityByUuid = new Map(actor.createdItems[0].rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "system.quantity")
  ]));
  assert.equal(quantityByUuid.get("Compendium.world.rebreya-gear.Item.kop-e"), 8);
  assert.equal(actor.system.currency.gp, 4);
  assert.equal(actor.createdItems[0].options.keepId, true);
  assert.deepEqual(actor.deletedDocuments, [{ type: "Item", ids: ["package-a"] }]);
});

test("paladin starting equipment package items expand into Rebreya gear and gold", async () => {
  const packageItem = makeItem({
    id: "paladin-package-a",
    name: "Стартовое снаряжение: Вариант А",
    flags: {
      "rebreya-main": {
        sourceType: "paladinStartingEquipmentPackage",
        startingEquipmentPackageId: "a"
      }
    }
  });
  const actor = new TestActor({ id: "paladin", name: "Паладин", items: [packageItem] });
  const resolvedGearIds = [];
  const service = new FighterAutomationService({}, {
    resolveStartingEquipmentGearUuid: async (gearId) => {
      resolvedGearIds.push(gearId);
      return `Compendium.world.rebreya-gear.Item.${gearId}`;
    },
    resolveStartingEquipmentItem: async (uuid) => makeStartingEquipmentSource(uuid)
  });

  await service.handleCreatedItem(packageItem);

  assert.deepEqual(resolvedGearIds, [
    "kol-chuga",
    "shchit",
    "dlinnyy-mech",
    "kop-e",
    "amulet-svyashchennyy-simvol",
    "nabor-svyashchennika"
  ]);
  assert.equal(actor.createdItems.length, 1);

  const quantityByUuid = new Map(actor.createdItems[0].rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "system.quantity")
  ]));
  assert.equal(quantityByUuid.get("Compendium.world.rebreya-gear.Item.kop-e"), 6);
  assert.equal(actor.system.currency.gp, 9);
  assert.deepEqual(actor.deletedDocuments, [{ type: "Item", ids: ["paladin-package-a"] }]);
});

test("barbarian starting equipment package items expand into Rebreya gear and gold", async () => {
  const packageItem = makeItem({
    id: "barbarian-package-a",
    name: "Starting Equipment: Variant A",
    flags: {
      "rebreya-main": {
        sourceType: "barbarianStartingEquipmentPackage",
        startingEquipmentPackageId: "a"
      }
    }
  });
  const actor = new TestActor({ id: "barbarian", name: "Barbarian", items: [packageItem] });
  const resolvedGearIds = [];
  const service = new FighterAutomationService({}, {
    resolveStartingEquipmentGearUuid: async (gearId) => {
      resolvedGearIds.push(gearId);
      return `Compendium.world.rebreya-gear.Item.${gearId}`;
    },
    resolveStartingEquipmentItem: async (uuid) => makeStartingEquipmentSource(uuid)
  });

  await service.handleCreatedItem(packageItem);

  assert.deepEqual(resolvedGearIds, [
    "sekira",
    "ruchnoy-topor",
    "nabor-puteshestvennika"
  ]);
  assert.equal(actor.createdItems.length, 1);

  const quantityByUuid = new Map(actor.createdItems[0].rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "system.quantity")
  ]));
  const sourceTypeByUuid = new Map(actor.createdItems[0].rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "flags.rebreya-main.sourceType")
  ]));
  const classIdentifierByUuid = new Map(actor.createdItems[0].rows.map((row) => [
    foundry.utils.getProperty(row, "flags.dnd5e.sourceId"),
    foundry.utils.getProperty(row, "flags.rebreya-main.classIdentifier")
  ]));
  assert.equal(quantityByUuid.get("Compendium.world.rebreya-gear.Item.ruchnoy-topor"), 4);
  assert.equal(sourceTypeByUuid.get("Compendium.world.rebreya-gear.Item.sekira"), "barbarianStartingEquipment");
  assert.equal(classIdentifierByUuid.get("Compendium.world.rebreya-gear.Item.sekira"), "barbarian-rework-v012");
  assert.equal(actor.system.currency.gp, 15);
  assert.deepEqual(actor.deletedDocuments, [{ type: "Item", ids: ["barbarian-package-a"] }]);
});

test("fighter starting equipment imports Rebreya equipment pack contents", async () => {
  const actor = new TestActor({ id: "fighter", name: "Р’РѕРёРЅ" });
  const classItem = makeClassItem({ actor });
  const service = new FighterAutomationService({}, {
    promptFighterStartingEquipment: async () => ({
      package: "a"
    }),
    resolveStartingEquipmentGearUuid: async (gearId) => `Compendium.world.rebreya-gear.Item.${gearId}`,
    resolveStartingEquipmentItem: async (uuid) => {
      if (uuid.endsWith(".nabor-issledovatelya-podzemeliy")) {
        return makeStartingEquipmentSource(uuid, {
          type: "container",
          contents: [
            makeStartingEquipmentSource("Compendium.world.rebreya-gear.Item.fakel"),
            makeStartingEquipmentSource("Compendium.world.rebreya-gear.Item.svecha")
          ]
        });
      }

      return makeStartingEquipmentSource(uuid);
    }
  });

  await service.handleCreatedItem(classItem);

  const rows = actor.createdItems[0].rows;
  const packRow = rows.find((row) => row.type === "container");
  assert.ok(packRow, "equipment pack container is created");
  assert.ok(packRow._id, "equipment pack receives an id for contained items");

  const containedRows = rows.filter((row) => foundry.utils.getProperty(row, "system.container") === packRow._id);
  assert.deepEqual(
    containedRows.map((row) => foundry.utils.getProperty(row, "flags.dnd5e.sourceId")).sort(),
    [
      "Compendium.world.rebreya-gear.Item.fakel",
      "Compendium.world.rebreya-gear.Item.svecha"
    ]
  );
});

test("fighter class creation does not duplicate native starting equipment choices", async () => {
  const actor = new TestActor({ id: "fighter", name: "Р’РѕРёРЅ" });
  const classItem = makeClassItem({ actor });
  classItem.system.advancement = [{
    type: "ItemChoice",
    level: 1,
    configuration: {
      allowDrops: false,
      type: null,
      pool: [{ uuid: "Compendium.world.rebreya-class-features.Item.startingEquipmentPackageA" }]
    }
  }];
  let prompts = 0;
  const service = new FighterAutomationService({}, {
    promptFighterStartingEquipment: async () => {
      prompts += 1;
      return { package: "a" };
    },
    resolveStartingEquipmentItem: async (uuid) => makeStartingEquipmentSource(uuid)
  });

  await service.handleCreatedItem(classItem);

  assert.equal(prompts, 0);
  assert.equal(actor.createdItems.length, 0);
});

test("fighter starting equipment prompt runs only on the creating client", async () => {
  const actor = new TestActor({ id: "fighter", name: "Воин" });
  const classItem = makeClassItem({ actor });
  let prompts = 0;
  const service = new FighterAutomationService({}, {
    promptFighterStartingEquipment: async () => {
      prompts += 1;
      return { package: "a" };
    },
    resolveStartingEquipmentItem: async (uuid) => makeStartingEquipmentSource(uuid)
  });

  await service.handleCreatedItem(classItem, {}, "other-user");

  assert.equal(prompts, 0);
  assert.equal(actor.createdItems.length, 0);
});

test("fighter maneuver runtime adds dominance damage to the last MIDI hit target and applies Rebreya status", async () => {
  const source = new TestActor({ id: "fighter", name: "Воин" });
  const target = new TestActor({ id: "target", name: "Цель" });
  const statuses = [];
  const service = new FighterAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statuses.push(args);
        return true;
      }
    }
  }, {
    rollFactory: () => fixedRoll(5)
  });
  const item = makeItem({ id: "provocation", name: "Провоцирующая атака" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d6"
      },
      status: {
        id: "rebreya-provoked",
        value: 1,
        durationRounds: 1
      }
    }
  });

  await service.applyMidiRollComplete({
    actor: source,
    item: {
      type: "weapon"
    },
    hitTargets: new Set([{ actor: target }]),
    damageDetail: [{ type: "slashing" }]
  });
  await service.applyDnd5ePostUseActivity(activity, {}, {});

  assert.deepEqual(target.damageApplications[0].damages, [{
    value: 5,
    type: "slashing"
  }]);
  assert.equal(target.damageApplications[0].options.sourceActorUuid, source.uuid);
  assert.deepEqual(statuses[0], [target, "rebreya-provoked", {
    active: true,
    value: 1,
    durationRounds: 1,
    sourceActor: source
  }]);
});

test("fighter maneuver runtime ignores the maneuver self-target workflow and uses the selected creature target", async () => {
  const previousTargets = globalThis.game.user.targets;
  const source = new TestActor({ id: "fighter", name: "Воин" });
  const target = new TestActor({ id: "lich", name: "Лич" });
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const service = new FighterAutomationService({}, {
    rollFactory: () => fixedRoll(4)
  });
  const item = makeItem({ id: "riposte", name: "Ответный удар" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d4"
      }
    }
  });

  try {
    await service.applyMidiRollComplete({
      actor: source,
      item,
      activity,
      targets: new Set([{ actor: source }])
    });
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.equal(source.damageApplications.length, 0);
    assert.deepEqual(target.damageApplications[0].damages, [{
      value: 4,
      type: ""
    }]);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver runtime ignores duplicate actor instances for the source target", async () => {
  const previousTargets = globalThis.game.user.targets;
  const source = new TestActor({ id: "fighter", name: "Воин" });
  const sourceTokenActor = new TestActor({ id: "fighter", name: "Воин" });
  const target = new TestActor({ id: "lich", name: "Лич" });
  globalThis.game.user.targets = new Set([{ actor: sourceTokenActor }, { actor: target }]);
  const service = new FighterAutomationService({}, {
    rollFactory: () => fixedRoll(4)
  });
  const item = makeItem({ id: "menacing", name: "Атака с угрозой" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d4"
      }
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.equal(sourceTokenActor.damageApplications.length, 0);
    assert.deepEqual(target.damageApplications[0].damages, [{
      value: 4,
      type: ""
    }]);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver runtime infers automation from stale subtype-only maneuver items", async () => {
  const previousTargets = globalThis.game.user.targets;
  const dominance = makeItem({
    id: "dominance-real",
    name: "Стиль доминирования",
    featureId: "fighter-rework-v028::class::fighter-dominance",
    uses: {
      spent: 0,
      max: 2
    }
  });
  const source = new TestActor({
    id: "fighter",
    name: "Воин",
    items: [dominance]
  });
  const target = new TestActor({ id: "lich", name: "Лич" });
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const service = new FighterAutomationService({}, {
    rollFactory: () => fixedRoll(4)
  });
  const item = makeItem({ id: "menacing", name: "Атака с угрозой" });
  item.actor = source;
  item.system.type = {
    value: "feat",
    subtype: "fighterManeuver"
  };
  const activity = makeActivity({
    actor: source,
    item
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {
      updates: {
        item: [{
          _id: dominance.id,
          "system.uses.spent": 1
        }]
      }
    });

    assert.deepEqual(target.damageApplications[0].damages, [{
      value: 4,
      type: ""
    }]);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver runtime spends the owned dominance dice item when dnd5e did not consume it", async () => {
  const previousTargets = globalThis.game.user.targets;
  const dominance = makeItem({
    id: "dominance-real",
    name: "Стиль доминирования",
    featureId: "fighter-rework-v028::class::fighter-dominance",
    uses: {
      spent: 0,
      max: 2,
      recovery: []
    }
  });
  const item = makeItem({ id: "riposte", name: "Ответный удар" });
  const source = new TestActor({
    id: "fighter",
    name: "Воин",
    items: [dominance, item]
  });
  const target = new TestActor({ id: "target", name: "Цель" });
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const service = new FighterAutomationService({}, {
    rollFactory: () => fixedRoll(4)
  });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d4"
      }
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.equal(dominance.system.uses.spent, 1);
    assert.equal(target.damageApplications.length, 1);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver runtime does not spend dominance twice when the chat card already consumed it", async () => {
  const previousTargets = globalThis.game.user.targets;
  const dominance = makeItem({
    id: "dominance-real",
    name: "Стиль доминирования",
    featureId: "fighter-rework-v028::class::fighter-dominance",
    uses: {
      spent: 1,
      max: 2,
      recovery: []
    }
  });
  const item = makeItem({ id: "menacing", name: "Атака с угрозой" });
  const source = new TestActor({
    id: "fighter",
    name: "Воин",
    items: [dominance, item]
  });
  const target = new TestActor({ id: "target", name: "Цель" });
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const service = new FighterAutomationService({}, {
    rollFactory: () => fixedRoll(4)
  });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      extraDamage: {
        formula: "1d4"
      }
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {
      message: {
        flags: {
          dnd5e: {
            use: {
              consumed: {
                item: {
                  [dominance.id]: [{
                    keyPath: "system.uses.spent",
                    delta: 1
                  }]
                }
              }
            }
          }
        }
      }
    });

    assert.equal(dominance.system.uses.spent, 1);
    assert.equal(dominance.updates.length, 0);
    assert.equal(target.damageApplications.length, 1);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver rolls a target saving throw before applying a save-gated status", async () => {
  const previousTargets = globalThis.game.user.targets;
  const source = new TestActor({ id: "fighter", name: "Воин" });
  source.system.attributes.prof = 3;
  source.system.abilities.str = { mod: 4 };
  source.system.abilities.dex = { mod: 2 };
  const target = new TestActor({ id: "target", name: "Цель" });
  const saves = [];
  target.rollSavingThrow = async (config) => {
    saves.push(config);
    return [fixedRoll(8)];
  };
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const statuses = [];
  const service = new FighterAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statuses.push(args);
        return true;
      }
    }
  }, {
    rollFactory: () => fixedRoll(3)
  });
  const item = makeItem({ id: "provocation", name: "Провоцирующая атака" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      status: {
        id: "rebreya-provoked",
        value: 1,
        durationRounds: 1
      },
      saveAbility: "wis"
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.deepEqual(saves.map((save) => ({
      ability: save.ability,
      target: save.target
    })), [{
      ability: "wis",
      target: 15
    }]);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0][1], "rebreya-provoked");
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver status effects expire at the end of the source actor next turn", async () => {
  const previousTargets = globalThis.game.user.targets;
  const source = new TestActor({ id: "fighter", name: "Воин" });
  source.system.attributes.prof = 2;
  source.system.abilities.str = { mod: 3 };
  const target = new TestActor({ id: "target", name: "Цель" });
  target.rollSavingThrow = async () => [fixedRoll(5)];
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const effectUpdates = [];
  const statusEffect = {
    id: "effect-1",
    async update(patch) {
      effectUpdates.push(patch);
      Object.assign(this, patch);
      return this;
    }
  };
  const service = new FighterAutomationService({
    combatStatusService: {
      setStatus: async () => statusEffect
    }
  });
  const item = makeItem({ id: "menacing", name: "Атака с угрозой" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      status: {
        id: "frightened",
        value: 2,
        durationRounds: 1,
        expires: "sourceTurnEnd"
      },
      saveAbility: "wis"
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.equal(effectUpdates.length, 1);
    assert.equal(effectUpdates[0].origin, source.uuid);
    assert.equal(effectUpdates[0].duration.rounds, 1);
    assert.deepEqual(effectUpdates[0]["flags.dae.specialDuration"], ["turnEndSource", "combatEnd"]);
    assert.equal(effectUpdates[0]["flags.rebreya-main.fighterAutomation.kind"], "maneuverStatus");
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter maneuver does not apply a save-gated status after a successful save", async () => {
  const previousTargets = globalThis.game.user.targets;
  const source = new TestActor({ id: "fighter", name: "Воин" });
  source.system.attributes.prof = 2;
  source.system.abilities.str = { mod: 3 };
  const target = new TestActor({ id: "target", name: "Цель" });
  target.rollSavingThrow = async () => [fixedRoll(20)];
  globalThis.game.user.targets = new Set([{ actor: target }]);
  const statuses = [];
  const service = new FighterAutomationService({
    combatStatusService: {
      setStatus: async (...args) => {
        statuses.push(args);
        return true;
      }
    }
  });
  const item = makeItem({ id: "menacing", name: "Атака с угрозой" });
  const activity = makeActivity({
    actor: source,
    item,
    automation: "fighter-dominance-maneuver",
    fighterAutomation: {
      kind: "maneuver",
      status: {
        id: "frightened",
        value: 2,
        durationRounds: 1
      },
      saveAbility: "wis"
    }
  });

  try {
    await service.applyDnd5ePostUseActivity(activity, {}, {});

    assert.equal(statuses.length, 0);
  }
  finally {
    globalThis.game.user.targets = previousTargets;
  }
});

test("fighter second wind prompts for dice, spends selected uses, and heals the actor", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 1,
      max: 5,
      recovery: []
    }
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 10,
      max: 30
    },
    items: [secondWind]
  });
  const service = new FighterAutomationService({}, {
    promptSecondWindDice: async () => 3,
    rollFactory: () => fixedRoll(11)
  });
  const activity = makeActivity({
    actor,
    item: secondWind,
    automation: "fighter-second-wind",
    fighterAutomation: {
      kind: "secondWind",
      die: "d6",
      maxDiceAbility: "con",
      minDice: 1
    }
  });

  await service.applyDnd5ePostUseActivity(activity, {}, {});

  assert.equal(secondWind.system.uses.spent, 4);
  assert.equal(actor.system.attributes.hp.value, 21);
  assert.ok(secondWind.updates.some((patch) => patch["system.uses.spent"] === 4));
});

test("fighter second wind repairs a missing actor resource before asking how many dice to spend", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 12,
      max: 30
    },
    classes: {
      "fighter-rework-v028": {
        levels: 5
      }
    },
    items: [secondWind]
  });
  let promptContext = null;
  const service = new FighterAutomationService({}, {
    promptSecondWindDice: async (_actor, context) => {
      promptContext = context;
      return 3;
    },
    rollFactory: () => fixedRoll(10)
  });
  const activity = makeActivity({
    actor,
    item: secondWind,
    automation: "fighter-second-wind",
    fighterAutomation: {
      kind: "secondWind",
      die: "d6",
      maxDiceAbility: "con",
      minDice: 1
    }
  });

  await service.applyDnd5ePostUseActivity(activity, {}, {});

  assert.deepEqual(promptContext, {
    min: 1,
    max: 3,
    remaining: 5,
    die: "d6"
  });
  assert.equal(secondWind.system.uses.max, 5);
  assert.deepEqual(secondWind.system.uses.recovery, [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }]);
  assert.equal(secondWind.system.uses.spent, 3);
  assert.equal(actor.system.attributes.hp.value, 22);
});

test("fighter actor repair restores second wind resources and moves maneuvers into their sheet section", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 0,
      max: "",
      recovery: []
    }
  });
  const maneuver = makeItem({
    id: "maneuver",
    name: "Провоцирующая атака",
    featureId: "fighter-rework-v028::fighterManeuver::provociruyushchaya-ataka"
  });
  maneuver.flags["rebreya-main"].sourceType = "fighterManeuver";
  maneuver.system.type = {
    value: "class",
    subtype: ""
  };
  const actor = new TestActor({
    id: "fighter",
    classes: {
      "fighter-rework-v028": {
        levels: 6
      }
    },
    items: [secondWind, maneuver]
  });
  const service = new FighterAutomationService({});

  await service.repairActor(actor);

  assert.equal(secondWind.system.uses.max, 6);
  assert.deepEqual(secondWind.system.uses.recovery, [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }]);
  assert.equal(maneuver.system.type.value, "feat");
  assert.equal(maneuver.system.type.subtype, "fighterManeuver");
  assert.equal(maneuver.flags["rebreya-main"].section, "Воинские приёмы");
  assert.equal(maneuver.flags.teyvankal.section, "Воинские приёмы");
});

test("fighter actor repair does not mutate maneuver activity data during sheet render", async () => {
  const maneuver = makeItem({
    id: "riposte",
    name: "Ответный удар",
    featureId: "fighter-rework-v028::fighterManeuver::riposte"
  });
  maneuver.flags["rebreya-main"].sourceType = "fighterManeuver";
  maneuver.flags["rebreya-main"].section = "Воинские приёмы";
  maneuver.flags.teyvankal = {
    section: "Воинские приёмы",
    subsection: null
  };
  maneuver.system.type = {
    value: "feat",
    subtype: "fighterManeuver"
  };
  maneuver.system.activities = {
    "dominance-activity": makeDominanceActivity({
      fighterAutomation: {
        kind: "maneuver",
        extraDamage: {
          formula: "1d4"
        }
      }
    })
  };
  const actor = new TestActor({
    id: "fighter",
    items: [maneuver]
  });
  const service = new FighterAutomationService({});

  await service.repairActor(actor);

  const activity = maneuver.system.activities["dominance-activity"];
  assert.equal(maneuver.updates.length, 0);
  assert.equal(activity.consumption.targets[0].target, "fighter-dominance");
  assert.equal(activity.target.affects.type, "self");
  assert.equal(activity.target.prompt, false);
  assert.equal(activity.range.units, "self");
});

test("fighter actor repair moves orphaned starting equipment pack contents into their container", async () => {
  const container = makeItem({
    id: "pack",
    name: "Набор исследователя подземелий",
    type: "container",
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        gearId: "nabor-issledovatelya-podzemeliy"
      }
    }
  });
  const torch = makeItem({
    id: "torch",
    name: "Факел",
    system: {
      container: "stale-container-id"
    },
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        containerGearId: "nabor-issledovatelya-podzemeliy",
        containerContentGearId: "fakel"
      }
    }
  });
  const actor = new TestActor({ id: "fighter", name: "Воин", items: [container, torch] });
  const service = new FighterAutomationService({});

  await service.repairActor(actor);

  assert.equal(torch.system.container, "pack");
  assert.deepEqual(torch.updates, [{ "system.container": "pack" }]);
  assert.deepEqual(torch.updateOptions, [{ render: false }]);
});

test("fighter actor repair leaves intentionally extracted starting equipment pack contents in inventory", async () => {
  const container = makeItem({
    id: "pack",
    name: "Equipment Pack",
    type: "container",
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        gearId: "nabor-puteshestvennika"
      }
    }
  });
  const torch = makeItem({
    id: "torch",
    name: "Torch",
    system: {
      container: null
    },
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        containerGearId: "nabor-puteshestvennika",
        containerContentGearId: "fakel"
      }
    }
  });
  const actor = new TestActor({ id: "fighter", name: "Fighter", items: [container, torch] });
  const service = new FighterAutomationService({});

  await service.repairActor(actor);

  assert.equal(torch.system.container, null);
  assert.deepEqual(torch.updates, []);
});

test("fighter actor repair leaves valid object container references untouched", async () => {
  const container = makeItem({
    id: "pack",
    name: "РќР°Р±РѕСЂ РїСѓС‚РµС€РµСЃС‚РІРµРЅРЅРёРєР°",
    type: "container",
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        gearId: "nabor-puteshestvennika"
      }
    }
  });
  const torch = makeItem({
    id: "torch",
    name: "Р¤Р°РєРµР»",
    system: {
      container
    },
    flags: {
      "rebreya-main": {
        sourceType: "fighterStartingEquipment",
        containerGearId: "nabor-puteshestvennika",
        containerContentGearId: "fakel"
      }
    }
  });
  const actor = new TestActor({ id: "fighter", name: "Р’РѕРёРЅ", items: [container, torch] });
  const service = new FighterAutomationService({});

  await service.repairActor(actor);

  assert.equal(torch.system.container, container);
  assert.deepEqual(torch.updates, []);
});

test("actor repair refreshes Rebreya class advancement links from the class compendium", async () => {
  const previousPacks = game.packs;
  const staleGrant = {
    _id: "class-grant-2",
    type: "ItemGrant",
    level: 2,
    title: "Классовые умения (2-й уровень)",
    configuration: {
      items: [{ uuid: "Compendium.world.rebreya-class-features.Item.missingFeature" }]
    },
    value: { added: { "2": { old: "kept" } } }
  };
  const staleSpellChoice = {
    _id: "spells",
    type: "ItemChoice",
    level: 2,
    title: "Заклинания",
    configuration: {
      type: "spell"
    },
    value: { added: { "2": { spell: "Compendium.dnd5e.spells.Item.old" } } }
  };
  const freshGrant = {
    _id: "class-grant-2",
    type: "ItemGrant",
    level: 2,
    title: "Классовые умения (2-й уровень)",
    configuration: {
      items: [{ uuid: "Compendium.world.rebreya-class-features.Item.paladinDivineSmite" }]
    },
    value: {}
  };
  const freshStyleChoice = {
    _id: "fighting-style",
    type: "ItemChoice",
    level: 2,
    title: "Боевой стиль",
    configuration: {
      type: "feat",
      pool: [{ uuid: "Compendium.world.rebreya-class-features.Item.paladinCommonStyle" }]
    },
    value: {}
  };
  const classItem = makeItem({
    id: "paladin-class",
    name: "Паладин (реворк V0.1)",
    type: "class",
    system: {
      identifier: "paladin-rework-v01",
      advancement: [staleGrant, staleSpellChoice]
    },
    flags: {
      "rebreya-main": {
        classIdentifier: "paladin-rework-v01"
      }
    }
  });
  const actor = new TestActor({ id: "paladin", name: "Паладин", items: [classItem] });
  game.packs = {
    get: (packId) => packId === "world.rebreya-classes"
      ? {
          getDocuments: async () => [{
            system: {
              identifier: "paladin-rework-v01",
              advancement: [freshGrant, freshStyleChoice]
            },
            getFlag: (scope, key) => scope === "rebreya-main" && key === "classIdentifier"
              ? "paladin-rework-v01"
              : undefined
          }]
        }
      : null
  };

  try {
    const service = new FighterAutomationService({});
    await service.repairActor(actor);

    assert.deepEqual(classItem.system.advancement, [{
      ...freshGrant,
      value: staleGrant.value
    }, freshStyleChoice]);
    assert.deepEqual(classItem.updates, [{
      "system.advancement": [{
        ...freshGrant,
        value: staleGrant.value
      }, freshStyleChoice]
    }]);
  }
  finally {
    game.packs = previousPacks;
  }
});

test("actor repair coalesces concurrent class advancement refreshes from sheet renders", async () => {
  const previousPacks = game.packs;
  const staleGrant = {
    _id: "class-grant-1",
    type: "ItemGrant",
    level: 1,
    title: "Old class features",
    configuration: {
      items: [{ uuid: "Compendium.world.rebreya-class-features.Item.oldFeature" }]
    },
    value: { added: { "1": { old: "kept" } } }
  };
  const freshGrant = {
    _id: "class-grant-1",
    type: "ItemGrant",
    level: 1,
    title: "Fresh class features",
    configuration: {
      items: [{ uuid: "Compendium.world.rebreya-class-features.Item.freshFeature" }]
    },
    value: {}
  };
  const classItem = makeItem({
    id: "barbarian-class",
    name: "Barbarian",
    type: "class",
    system: {
      identifier: "barbarian-rework-v012",
      advancement: [staleGrant]
    },
    flags: {
      "rebreya-main": {
        classIdentifier: "barbarian-rework-v012"
      }
    }
  });
  classItem.update = async function update(patch, options = {}) {
    this.updates.push(patch);
    this.updateOptions.push(options);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  };
  const actor = new TestActor({ id: "barbarian", name: "Barbarian", items: [classItem] });
  game.packs = {
    get: (packId) => packId === "world.rebreya-classes"
      ? {
          getDocuments: async () => [{
            system: {
              identifier: "barbarian-rework-v012",
              advancement: [freshGrant]
            },
            getFlag: (scope, key) => scope === "rebreya-main" && key === "classIdentifier"
              ? "barbarian-rework-v012"
              : undefined
          }]
        }
      : null
  };

  try {
    const service = new FighterAutomationService({});
    await Promise.all([
      service.repairActor(actor),
      service.repairActor(actor)
    ]);

    assert.equal(classItem.updates.length, 1);
    assert.deepEqual(classItem.updateOptions, [{ render: false }]);
    assert.deepEqual(classItem.system.advancement, [{
      ...freshGrant,
      value: staleGrant.value
    }]);
  }
  finally {
    game.packs = previousPacks;
  }
});

test("fighter long rest keeps the selected multiattack variant and deletes the others", async () => {
  const actionSurge = makeItem({
    id: "action-surge",
    name: "Воинская мультиатака: Всплеск действий",
    featureId: "fighter-rework-v028::class::fighter-multiattack-action-surge"
  });
  const hordeBreaker = makeItem({
    id: "horde-breaker",
    name: "Воинская мультиатака: Разрушитель орд",
    featureId: "fighter-rework-v028::class::fighter-multiattack-horde-breaker"
  });
  const stalwartDefender = makeItem({
    id: "stalwart-defender",
    name: "Воинская мультиатака: Стойкий защитник",
    featureId: "fighter-rework-v028::class::fighter-multiattack-stalwart-defender"
  });
  const actor = new TestActor({
    id: "fighter",
    items: [actionSurge, hordeBreaker, stalwartDefender]
  });
  const service = new FighterAutomationService({}, {
    promptFighterMultiattackChoice: async (_actor, choices) => {
      assert.deepEqual(choices.map((choice) => choice.featureId), [
        "fighter-multiattack-action-surge",
        "fighter-multiattack-horde-breaker",
        "fighter-multiattack-stalwart-defender"
      ]);
      return "fighter-multiattack-horde-breaker";
    }
  });

  await service.handleRestCompleted(actor, { type: "long" }, {});

  assert.deepEqual(actor.deletedDocuments, [{
    type: "Item",
    ids: ["action-surge", "stalwart-defender"]
  }]);
  assert.deepEqual(actor.items.contents.map((item) => item.id), ["horde-breaker"]);
});

test("fighter long rest can add a selected multiattack variant back from the class feature pack", async () => {
  const previousGame = globalThis.game;
  const actionSurge = makeItem({
    id: "action-surge",
    name: "Воинская мультиатака: Всплеск действий",
    featureId: "fighter-rework-v028::class::fighter-multiattack-action-surge"
  });
  const actor = new TestActor({
    id: "fighter",
    items: [actionSurge]
  });
  globalThis.game = {
    ...previousGame,
    packs: {
      get: (packId) => {
        if (packId !== "world.rebreya-class-features") {
          return null;
        }

        return {
          getDocuments: async () => [{
            name: "Воинская мультиатака: Разрушитель орд",
            toObject: () => ({
              name: "Воинская мультиатака: Разрушитель орд",
              type: "feat",
              flags: {
                "rebreya-main": {
                  featureId: "fighter-rework-v028::class::fighter-multiattack-horde-breaker"
                }
              }
            })
          }]
        };
      }
    }
  };
  try {
    const service = new FighterAutomationService({}, {
      promptFighterMultiattackChoice: async () => "fighter-multiattack-horde-breaker"
    });

    await service.handleRestCompleted(actor, { type: "long" }, {});

    assert.deepEqual(actor.deletedDocuments, [{
      type: "Item",
      ids: ["action-surge"]
    }]);
    assert.equal(actor.createdItems[0].rows[0].name, "Воинская мультиатака: Разрушитель орд");
    assert.deepEqual(actor.items.contents.map((item) => item.name), ["Воинская мультиатака: Разрушитель орд"]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("fighter iron will prompts second wind at the start of a bloodied turn", async () => {
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 0,
      max: 5,
      recovery: []
    }
  });
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 10,
      max: 30
    },
    items: [secondWind, ironWill],
    effects: [{
      statuses: new Set(["bloodied"])
    }]
  });
  const service = new FighterAutomationService({}, {
    confirmIronWillSecondWind: async () => true,
    promptSecondWindDice: async () => 2,
    rollFactory: () => fixedRoll(7)
  });

  await service.handleCombatTurnChange({
    round: 4,
    turn: 2,
    combatant: {
      actor
    }
  });

  assert.equal(secondWind.system.uses.spent, 2);
  assert.equal(actor.system.attributes.hp.value, 17);
});

test("fighter iron will resolves the upcoming combatTurn actor from updateData.turn", async () => {
  const oldActor = new TestActor({
    id: "old",
    hp: {
      value: 5,
      max: 30
    },
    items: []
  });
  const secondWind = makeItem({
    id: "second-wind",
    name: "Второе дыхание",
    featureId: "fighter-rework-v028::class::second-wind",
    uses: {
      spent: 0,
      max: 5,
      recovery: []
    }
  });
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const nextActor = new TestActor({
    id: "next",
    hp: {
      value: 8,
      max: 30
    },
    items: [secondWind, ironWill]
  });
  let prompts = 0;
  const service = new FighterAutomationService({}, {
    confirmIronWillSecondWind: async () => {
      prompts += 1;
      return true;
    },
    promptSecondWindDice: async () => 1,
    rollFactory: () => fixedRoll(4)
  });

  await service.handleCombatTurnChange({
    round: 1,
    turn: 0,
    combatant: {
      actor: oldActor
    },
    turns: [
      { actor: oldActor },
      { actor: nextActor }
    ]
  }, {
    round: 1,
    turn: 1
  });

  assert.equal(prompts, 1);
  assert.equal(nextActor.system.attributes.hp.value, 12);
  assert.equal(oldActor.system.attributes.hp.value, 5);
});

test("fighter iron will creates its next-save effect after healing while not bloodied", async () => {
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 20,
      max: 30
    },
    items: [ironWill]
  });
  const service = new FighterAutomationService({});

  await service.applyDnd5eApplyDamage(actor, -4, {});

  assert.equal(actor.createdEffects[0].type, "ActiveEffect");
  const effect = actor.createdEffects[0].rows[0];
  assert.equal(effect.name, "Железная воля: следующий приём");
  assert.equal(effect.duration.rounds, null);
  assert.equal(effect.duration.turns, null);
  assert.deepEqual(effect.flags.dae.specialDuration, ["turnEndSource", "combatEnd"]);
  assert.equal(effect.flags["rebreya-main"].fighterAutomation.kind, "ironWillNextSave");
});

test("fighter iron will does not create duplicate next-save effects when healing fires twice before effects refresh", async () => {
  const ironWill = makeItem({
    id: "iron-will",
    name: "Железная воля",
    featureId: "fighter-rework-v028::class::iron-will"
  });
  const actor = new TestActor({
    id: "fighter",
    hp: {
      value: 20,
      max: 30
    },
    items: [ironWill]
  });
  const service = new FighterAutomationService({});
  let releaseFirstCreate = null;
  const firstCreateStarted = new Promise((resolve) => {
    actor.createEmbeddedDocuments = async (type, rows) => {
      actor.createdEffects.push({ type, rows });
      resolve();
      if (actor.createdEffects.length === 1) {
        await new Promise((release) => {
          releaseFirstCreate = release;
        });
      }
      return rows;
    };
  });

  const firstHealing = service.applyDnd5eApplyDamage(actor, -4, {});
  await firstCreateStarted;
  const secondHealing = service.applyDnd5eApplyDamage(actor, -3, {});
  releaseFirstCreate();
  await Promise.all([firstHealing, secondHealing]);

  assert.equal(actor.createdEffects.length, 1);
});
