import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let target = object;
      while (keys.length > 1) {
        const key = keys.shift();
        target[key] ??= {};
        target = target[key];
      }
      target[keys[0]] = value;
      return true;
    },
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};

globalThis.game ??= {
  user: { id: "user", isGM: true },
  combat: { round: 1 }
};

const {
  SorcererAutomationService,
  updateSorcererCastDialogControls
} = await import("../scripts/combat/sorcerer-automation-service.js");

const MODULE_ID = "rebreya-main";
const SORCERER_ROOT = "sorcerer-rework-v011";
const FULL_METAMAGIC_DESCRIPTIONS = Object.freeze({
  "careful-spell": "Когда вы накладываете заклинание, которое вынуждает других существ совершить спасбросок, вы можете защитить некоторых из них от магического воздействия. Для этого вы тратите 1 единицу чародейства и выбираете существ в количестве, равном вашему модификатору Харизмы (минимум одно существо). Указанные существа автоматически преуспевают в спасброске от данного заклинания.",
  "distant-spell": "При накладывании заклинания, дистанция которого 5 футов и более, вы можете потратить 1 единицу чародейства, чтобы удвоить это расстояние.\nПри накладывании заклинания с дистанцией «касание», вы можете потратить 1 единицу чародейства, чтобы увеличить это расстояние до 30 футов.",
  "heightened-spell": "Когда вы накладываете заклинание, которое вынуждает существо совершить спасбросок для защиты от его эффектов, вы можете потратить 3 единицы чародейства, чтобы одна из целей заклинания совершила первый спасбросок от этого заклинания с помехой.",
  "subtle-spell": "Во время накладывания заклинания вы можете потратить 1 единицу чародейства, чтоб наложить его без вербальных и соматических компонентов.",
  "extended-spell": "При накладывании заклинания с длительностью 1 минута или более, вы можете потратить 1 единицу чародейства, чтобы один раз удвоить это время, вплоть до максимального в 24 часа.",
  "twinned-spell": "Если вы используете заклинание, нацеливаемое только на одно существо или объект и не имеющее дистанцию «на себя», вы можете потратить количество единиц чародейства, равное уровню заклинания (1 для заговоров), чтобы нацелиться им на второе существо или объект-цель в пределах дистанции этого заклинания.\nЧтобы применить этот вариант, заклинание не должно быть способно нацеливаться более чем на одну цель на текущем накладываемом уровне. Например, волшебная стрела [magic missile] и палящий луч [scorching ray] не могут быть усилены этой метамагией, а луч холода [ray of frost] и цветной шарик [chromatic orb] — могут.",
  "empowered-spell": "При совершении броска урона от заклинания вы можете потратить 1 единицу чародейства, чтобы перебросить несколько костей урона в количестве не больше вашего модификатора Харизмы (минимум одна). Вы должны использовать новое выпавшее значение.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания.",
  "quickened-spell": "Если вы накладываете заклинание со временем накладывания «1 действие», вы можете потратить 2 единицы чародейства, чтобы наложить это заклинание бонусным действием.",
  "seeking-spell": "Если вы совершаете бросок атаки для заклинания и промахиваетесь, вы можете потратить 2 единицы чародейства, чтобы перебросить к20, и должны использовать новый бросок.\n\tВы можете использовать этот вариант метамагии, даже если вы уже использовали другой вариант метамагии во время накладывания заклинания."
});

class TestActor {
  constructor({ level = 1, pointsSpent = 0, includePoints = false } = {}) {
    this.id = "sorcerer";
    this.uuid = "Actor.sorcerer";
    this.system = {
      scale: {
        [SORCERER_ROOT]: {
          "sorcery-points": [4, 8, 17, 21, 32, 38, 45, 52, 66, 74, 84, 85, 96, 97, 109, 110, 124, 132, 142, 153][level - 1],
          "maximum-spell-level": Math.ceil(level / 2)
        }
      },
      classes: {
        [SORCERER_ROOT]: { levels: level }
      },
      attributes: { exhaustion: 0 }
    };
    this.flags = {};
    this.items = { contents: [] };
    this.effects = { contents: [] };
    this.sorcererClassItem = makeItemFromData(this, {
      name: "Sorcerer",
      type: "class",
      system: { identifier: SORCERER_ROOT }
    }, "classSorcererItem");
    this.wizardClassItem = makeItemFromData(this, {
      name: "Wizard",
      type: "class",
      system: { identifier: "wizard" }
    }, "classWizardItem");
    this.items.contents.push(this.sorcererClassItem, this.wizardClassItem);
    this.updates = [];
    this.createdItems = [];
    this.createdEffects = [];
    this.deletedEffects = [];
    if (includePoints) {
      this.items.contents.push(makePointsItem(this, { spent: pointsSpent }));
    }
  }

  async createEmbeddedDocuments(type, rows) {
    if (type === "Item") {
      this.createdItems.push(rows);
      const documents = rows.map((row, index) => makeItemFromData(this, row, `points-${index + 1}`));
      this.items.contents.push(...documents);
      return documents;
    }

    assert.equal(type, "ActiveEffect");
    this.createdEffects.push({ type, rows: structuredClone(rows) });
    const documents = rows.map((row, index) => {
      const id = row._id ?? `effect-${this.effects.contents.length + index + 1}`;
      const effect = {
        id,
        _id: id,
        uuid: `${this.uuid}.ActiveEffect.${id}`,
        parent: this,
        ...structuredClone(row),
        async delete() {
          await this.parent.deleteEmbeddedDocuments("ActiveEffect", [this.id]);
          return this;
        }
      };
      return effect;
    });
    this.effects.contents.push(...documents);
    return documents;
  }

  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "ActiveEffect");
    this.deletedEffects.push(...ids);
    this.effects.contents = this.effects.contents.filter((effect) => !ids.includes(effect.id ?? effect._id));
    return ids;
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value;
    return value;
  }
}

function makeItemFromData(actor, data, id) {
  const item = {
    id,
    _id: id,
    uuid: `Actor.sorcerer.Item.${id}`,
    actor,
    name: data.name,
    type: data.type,
    flags: structuredClone(data.flags ?? {}),
    system: structuredClone(data.system ?? {}),
    updates: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      this.updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
  return item;
}

function makePointsItem(actor, { spent = 0 } = {}) {
  return makeItemFromData(actor, {
    name: "Sorcery Points",
    type: "feat",
    flags: { [MODULE_ID]: { featureId: "sorcerer-sorcery-points" } },
    system: {
      identifier: "sorcerer-sorcery-points",
      uses: { spent, max: 0, recovery: [] }
    }
  }, "sorcery-points");
}

function makeSorcererSpell(actor, {
  id = "chromatic-orb",
  baseLevel = 1,
  root = `${actor.sorcererClassItem.id}.advancementKnownSpell`,
  system = {},
  activity = {}
} = {}) {
  const item = makeItemFromData(actor, {
    name: "Spell",
    type: "spell",
    flags: { dnd5e: { advancementRoot: root } },
    system: {
      identifier: id,
      level: baseLevel,
      components: { vocal: true, somatic: true, material: false },
      ...system
    }
  }, id);
  return {
    actor,
    item,
    type: "spell",
    spellLevel: baseLevel,
    system: item.system,
    ...activity
  };
}

function makeCooldownCardMessage({ id = "cooldown-card", content, flags = {} } = {}) {
  return {
    id,
    _id: id,
    content,
    flags: structuredClone(flags),
    updateCalls: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key]
        ?? foundry.utils.getProperty(this.flags, `${scope}.${key}`);
    },
    async update(patch = {}) {
      this.updateCalls.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function addMetamagic(actor, metamagicId, cost, stacking = "base", extraFlags = {}) {
  const item = makeItemFromData(actor, {
    name: metamagicId,
    type: "feat",
    flags: { [MODULE_ID]: { sourceType: "sorcererMetamagic", metamagicId, cost, stacking, ...extraFlags } },
    system: { identifier: metamagicId, description: { value: extraFlags.description ?? "" } }
  }, metamagicId);
  actor.items.contents.push(item);
  return item;
}

function addDraconicAncestor(actor, damageType = "Огонь") {
  const item = makeItemFromData(actor, {
    name: "Красный дракон",
    type: "feat",
    flags: { [MODULE_ID]: { sourceType: "sorcererDraconicAncestor", damageType } },
    system: { identifier: "red-dragon-ancestor" }
  }, "red-dragon-ancestor");
  actor.items.contents.push(item);
  return item;
}

function addSubclassFeature(actor, name, featureId = name) {
  const item = makeItemFromData(actor, {
    name,
    type: "feat",
    flags: { [MODULE_ID]: { sourceType: "subclassFeature", featureId } },
    system: { identifier: featureId }
  }, featureId);
  actor.items.contents.push(item);
  return item;
}

function metamagicActor(level = 3) {
  const actor = levelActor(level, { includePoints: true });
  actor.system.abilities = { cha: { mod: 3 } };
  for (const [id, cost, stacking] of [
    ["careful-spell", 1, "base"],
    ["distant-spell", 1, "base"],
    ["heightened-spell", 3, "base"],
    ["subtle-spell", 1, "base"],
    ["extended-spell", 1, "base"],
    ["twinned-spell", "spellLevel", "base"],
    ["empowered-spell", 1, "additive"],
    ["quickened-spell", 2, "base"],
    ["seeking-spell", 2, "additive"]
  ]) addMetamagic(actor, id, cost, stacking);
  return actor;
}

function pointsItem(actor) {
  return actor.items.contents.find((item) => item.getFlag(MODULE_ID, "featureId") === "sorcerer-sorcery-points");
}

function levelActor(level, options = {}) {
  return new TestActor({ level, ...options });
}

function consumeDnd5eSpellSlot(actor, usageConfig) {
  if (!((usageConfig.consume === true) || usageConfig.consume?.spellSlot)) {
    return;
  }

  const slot = actor.system.spells?.[usageConfig.spell?.slot];
  if (slot?.value) {
    slot.value = Math.max(0, slot.value - 1);
  }
}

async function waitForDeferredActivityUse() {
  await new Promise((resolve) => setImmediate(resolve));
}

function completeReactionCheck(usageConfig) {
  return {
    ...usageConfig,
    flags: {
      ...(usageConfig?.flags ?? {}),
      [MODULE_ID]: {
        ...(usageConfig?.flags?.[MODULE_ID] ?? {}),
        reactionCheckComplete: true
      }
    }
  };
}

function makeFakeClassList(classes) {
  return {
    toggle(name, value) {
      if (value) classes.add(name);
      else classes.delete(name);
    }
  };
}

function makeFakeMetamagicLabel(input, slider = null) {
  const costLabel = { textContent: "" };
  const costOutput = slider ? { textContent: "" } : null;
  const label = {
    dataset: {},
    classes: new Set(),
    attributes: {},
    classList: null,
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) {
      if (selector === "[data-metamagic-cost-label]") return costLabel;
      if (selector === "[data-metamagic-cost-slider]") return slider;
      if (selector === "[data-metamagic-cost-output]") return costOutput;
      return null;
    }
  };
  label.classList = makeFakeClassList(label.classes);
  input.closest = () => label;
  return { label, costLabel, costOutput, slider };
}

function makeCastDialogRoot({
  selectedLevel = 2,
  slotCost = 3,
  consume = true,
  castingMode = "sorcery",
  availablePoints = 20,
  requiresExhaustion = false,
  exhaustionOverride = false,
  metamagicInputs = []
} = {}) {
  const level = {
    value: String(selectedLevel),
    selectedOptions: [{ value: String(selectedLevel), dataset: {
      sorcererCost: String(slotCost),
      sorcererExhaustion: String(requiresExhaustion)
    } }]
  };
  const mode = { value: castingMode };
  const consumeResource = { checked: consume };
  const exhaustionInput = { checked: exhaustionOverride };
  const exhaustionRow = {
    hidden: false,
    querySelector: (selector) => selector === "input" ? exhaustionInput : null
  };
  const blocked = { hidden: true, textContent: "" };
  const total = { textContent: "" };
  const castButton = { disabled: false };
  const appWindow = {
    style: {},
    querySelector: (selector) => selector === '[data-action="cast"]' ? castButton : null
  };
  const fields = [{ dataset: { metamagicFields: "careful-spell" }, hidden: false }];
  const container = {
    dataset: { sorcererAvailablePoints: String(availablePoints) },
    matches: (selector) => selector === "[data-sorcerer-cast-dialog]",
    closest: () => appWindow,
    querySelector(selector) {
      if (selector === "[name=spellLevel]") return level;
      if (selector === "[name=castingMode]") return mode;
      if (selector === "[name=consumeResource]") return consumeResource;
      if (selector === "[data-sorcerer-total]") return total;
      if (selector === "[data-sorcerer-exhaustion-row]") return exhaustionRow;
      if (selector === "[data-sorcerer-blocked]") return blocked;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "input[name=metamagic]") return metamagicInputs;
      if (selector === "[data-metamagic-fields]") return fields;
      return [];
    }
  };
  return {
    root: container,
    level,
    mode,
    total,
    castButton,
    appWindow,
    fields,
    exhaustionInput,
    exhaustionRow,
    blocked
  };
}

test("Sorcery Points synchronize to the level-three scale and recover on long rest", async () => {
  const actor = levelActor(3, { pointsSpent: 9, includePoints: true });
  const service = new SorcererAutomationService({});

  await service.syncSorceryPoints(actor);
  const points = pointsItem(actor);

  assert.equal(points.system.uses.max, 17);
  assert.deepEqual(points.system.uses.recovery, [{ period: "lr", type: "recoverAll", formula: "" }]);
  await service.handleRestCompleted(actor, { longRest: true });
  assert.equal(points.system.uses.spent, 0);
});

test("Careful Spell makes selected legal targets automatically pass a save", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["careful-spell"], targetUuids: ["Token.ally-a", "Token.ally-b"] }
  };
  const spell = makeSorcererSpell(actor, { system: { save: { ability: "dex" } } });

  assert.equal(await service.applyDnd5ePreUseActivity(spell, usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.spellCast.modifiers.careful.targets, ["Token.ally-a", "Token.ally-b"]);
  assert.equal(pointsItem(actor).system.uses.spent, 3);
});

test("Distant Spell doubles ranged spells and changes touch to thirty feet", async () => {
  const rangedActor = metamagicActor();
  const touchActor = metamagicActor();
  const rangedUsage = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["distant-spell"] } };
  const touchUsage = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["distant-spell"] } };
  const rangedService = new SorcererAutomationService({});
  const touchService = new SorcererAutomationService({});
  await rangedService.syncSorceryPoints(rangedActor);
  await touchService.syncSorceryPoints(touchActor);

  assert.equal(await rangedService.applyDnd5ePreUseActivity(
    makeSorcererSpell(rangedActor, { system: { range: { value: 60, units: "ft" } } }), rangedUsage, {}, {}
  ), true);
  assert.deepEqual(rangedUsage.spellCast.range, { value: 120, units: "ft" });
  assert.equal(await touchService.applyDnd5ePreUseActivity(
    makeSorcererSpell(touchActor, { system: { range: { value: null, units: "touch" } } }), touchUsage, {}, {}
  ), true);
  assert.deepEqual(touchUsage.spellCast.range, { value: 30, units: "ft" });
});

test("Heightened Spell gives one target disadvantage on its first spell save", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["heightened-spell"], targetUuids: ["Token.enemy"] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { system: { save: { ability: "wis" } } }), usageConfig, {}, {}
  ), true);
  assert.equal(usageConfig.spellCast.modifiers.heightened.targetUuid, "Token.enemy");
  assert.equal(usageConfig.spellCast.modifiers.heightened.firstSaveDisadvantage, true);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
});

test("Subtle Spell removes V and S from the shared cast context", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["subtle-spell"] } };
  const messageConfig = {};

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { components: { vocal: true, somatic: true, material: true } }
  }), usageConfig, {}, messageConfig), true);
  assert.deepEqual(usageConfig.spellCast.components, { verbal: false, somatic: false, material: true });
  assert.deepEqual(usageConfig.flags[MODULE_ID].spellCast.components, { verbal: false, somatic: false, material: true });
  assert.equal(messageConfig.data.flags[MODULE_ID].spellCast.metamagic[0].id, "subtle-spell");
  assert.deepEqual(messageConfig.data.flags[MODULE_ID].spellCast.components, { verbal: false, somatic: false, material: true });
});

test("Extended Spell doubles a legal duration without exceeding twenty-four hours", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["extended-spell"] } };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { duration: { value: 15, units: "hour" } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.spellCast.duration, { value: 24, units: "hour" });
});

test("Twinned Spell charges at the selected spell level while preserving two native targets", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 2,
    targets: ["Token.first", "Token.second"],
    sorcererMetamagic: { ids: ["twinned-spell"], targets: ["Token.first", "Token.second"] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    baseLevel: 1,
    system: { range: { value: 60, units: "ft" }, target: { affects: { count: "1" } } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.targets, ["Token.first", "Token.second"]);
  assert.deepEqual(usageConfig.spellCast.modifiers.twinned.targetUuids, ["Token.first", "Token.second"]);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
});

test("Twinned Spell rejects a programmatic second target that was not selected natively", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    targets: ["Token.first"],
    sorcererMetamagic: { ids: ["twinned-spell"], targets: ["Token.first"], secondTargetUuid: "Token.second" }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    baseLevel: 1,
    system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
  }), usageConfig, {}, {}), false);
  assert.deepEqual(usageConfig.targets, ["Token.first"]);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("Empowered Spell rerolls selected damage dice up to the Charisma modifier", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  let rerolled = [];
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["empowered-spell"],
      damageDice: ["0:0", "0:2"],
      rerollDamage: async (indices) => { rerolled = indices; }
    }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { damage: { parts: [["3d6", "fire"]] } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(rerolled, [
    { id: "0:0", label: "3d6 #1", partIndex: 0, dieIndex: 0 },
    { id: "0:2", label: "3d6 #3", partIndex: 0, dieIndex: 2 }
  ]);
  assert.deepEqual(usageConfig.spellCast.modifiers.empowered.damageDice, [
    { id: "0:0", label: "3d6 #1", partIndex: 0, dieIndex: 0 },
    { id: "0:2", label: "3d6 #3", partIndex: 0, dieIndex: 2 }
  ]);
});

test("Quickened Spell changes this cast from an action to a bonus action", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["quickened-spell"] } };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, {
    system: { activation: { type: "action", value: 1 } }
  }), usageConfig, {}, {}), true);
  assert.deepEqual(usageConfig.activation, { type: "bonus", value: 1 });
  assert.deepEqual(usageConfig.spellCast.activation, { type: "bonus", value: 1 });
});

test("Seeking Spell pays only after a missed spell attack through its real activity roll method", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 1, sorcererMetamagic: { ids: ["seeking-spell"] } };
  let rerolls = 0;
  const roll = { total: 4, isFailure: true };
  const spell = makeSorcererSpell(actor, { system: { attack: { type: "spell" } } });
  spell.rollAttack = async () => {
    rerolls += 1;
    return [{ total: 18 }];
  };

  assert.equal(await service.applyDnd5ePreUseActivity(spell, usageConfig, {}, {}), true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(await service.applyDnd5ePostAttackRoll([roll], {
    subject: spell,
    ammoUpdate: null
  }), true);
  assert.equal(rerolls, 1);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("Seeking Spell does not spend points after a missed attack when resource spending is disabled", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererVirtualSpellLevel: 1,
    sorcererConsumeResource: false,
    sorcererMetamagic: { ids: ["seeking-spell"] }
  };
  let rerolls = 0;
  const roll = { total: 4, isFailure: true };
  const spell = makeSorcererSpell(actor, { system: { attack: { type: "spell" } } });
  spell.rollAttack = async () => {
    rerolls += 1;
    return [{ total: 18 }];
  };

  assert.equal(await service.applyDnd5ePreUseActivity(spell, usageConfig, {}, {}), true);
  assert.equal(usageConfig.spellCast.payment.cost, 0);
  assert.equal(usageConfig.spellCast.modifiers.seeking.cost, 0);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(await service.applyDnd5ePostAttackRoll([roll], {
    subject: spell,
    ammoUpdate: null
  }), true);
  assert.equal(rerolls, 1);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("Metamagic rejects incompatible stacking and unmet preconditions before payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["subtle-spell", "distant-spell"] }
  }, {}, {}), false);
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["heightened-spell"], targetUuids: ["Token.enemy"] }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("Sorcerer casting spends points but preserves native slots", async () => {
  const actor = levelActor(1, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {};

  const result = await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), usageConfig, {}, {});

  assert.equal(result, true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.deepEqual(usageConfig.spellCast, {
    spellLevel: 1,
    castingMode: "sorcery",
    components: { vocal: true, somatic: true, material: false },
    payment: { resource: "sorcery-points", cost: 2 },
    metamagic: [],
    modifiers: { cooldownOverride: false, exhaustion: 0, highLevelOverride: false }
  });
});

test("an external-source spell can use Sorcery Points on a Sorcerer actor", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "sorcery",
    sorcererVirtualSpellLevel: 1,
    consume: { spellSlot: true, resources: [0] },
    cause: { activity: ".Item.scroll.Activity.cast", resources: [0] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(usageConfig.spellCast.castingMode, "sorcery");
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.equal(usageConfig.consume.resources, false);
  assert.equal(usageConfig.cause.resources, false);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "chromatic-orb:1": { remaining: 1 }
  });
});

test("normal casting preserves native consumption when no Sorcery Points remain", async () => {
  const actor = levelActor(3, { includePoints: true, pointsSpent: 17 });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "normal",
    consume: { spellSlot: true, resources: [0] },
    cause: { activity: ".Item.scroll.Activity.cast", resources: [0] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 17);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.deepEqual(usageConfig.consume, { spellSlot: true, resources: [0] });
  assert.deepEqual(usageConfig.cause, { activity: ".Item.scroll.Activity.cast", resources: [0] });
  assert.equal(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("normal casting spends only metamagic points", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "normal",
    sorcererMetamagic: { ids: ["subtle-spell"] },
    consume: { spellSlot: true }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 1);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 1 });
  assert.equal(usageConfig.consume.spellSlot, true);
  assert.equal(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("a Sorcerer cantrip casts normally and still supports metamagic", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererMetamagic: { ids: ["subtle-spell"] },
    consume: { spellSlot: false }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "ray-of-frost", baseLevel: 0, root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 1);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.equal(usageConfig.spellCast.spellLevel, 0);
  assert.equal(usageConfig.consume.spellSlot, false);
});

test("a non-Sorcerer spell bypasses Sorcerer casting modes", async () => {
  const actor = levelActor(3, { includePoints: true });
  actor.items.contents = actor.items.contents.filter((item) => item !== actor.sorcererClassItem);
  delete actor.system.classes[SORCERER_ROOT];
  const service = new SorcererAutomationService({});
  const usageConfig = { consume: { spellSlot: true } };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.deepEqual(usageConfig, { consume: { spellSlot: true } });
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("a virtual level-three cast uses D&D5e slot, scaling, and consume fields without consuming a native slot", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = { sorcererVirtualSpellLevel: 3 };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), usageConfig, {}, {}), true);
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.equal(usageConfig.spell.slot, "spell3");
  assert.equal(usageConfig.scaling, 2);
  assert.equal(usageConfig.consumeSpellSlot, undefined);

  consumeDnd5eSpellSlot(actor, usageConfig);
  assert.equal(actor.system.spells.spell3.value, 1);
  assert.deepEqual(usageConfig.spellCast, {
    spellLevel: 3,
    castingMode: "sorcery",
    components: { vocal: true, somatic: true, material: false },
    payment: { resource: "sorcery-points", cost: 5 },
    metamagic: [],
    modifiers: { cooldownOverride: false, exhaustion: 0, highLevelOverride: false }
  });
});

test("a synchronous dnd5e pre-use hook completes Sorcerer preflight before one paid final cast", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(1, { includePoints: true });
  let prompts = 0;
  let genericHookCalls = 0;
  let attackHookCalls = 0;
  const resumedUses = [];

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 1 };
      }
    });
    await service.syncSorceryPoints(actor);
    const moduleApi = {
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: (_activity, usageConfig) => {
          genericHookCalls += 1;
          usageConfig.flags ??= {};
          usageConfig.flags[MODULE_ID] ??= {};
          usageConfig.flags[MODULE_ID].reactionCheckComplete = true;
          return true;
        }
      },
      combatAttackService: {
        applyDnd5ePreUseActivity: () => {
          attackHookCalls += 1;
          return true;
        }
      }
    };
    registerCombatHooks(moduleApi);
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor);
    activity.use = async (...args) => {
      resumedUses.push(args);
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    const firstResult = preUse(activity, {}, {}, {});
    assert.equal(firstResult, false);
    assert.equal(typeof firstResult, "boolean");
    await waitForDeferredActivityUse();

    assert.equal(prompts, 1);
    assert.equal(resumedUses.length, 2);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationPreflight.accepted, true);
    assert.equal(resumedUses[1][0][MODULE_ID].sorcererAutomationBypass, true);
    assert.equal(pointsItem(actor).system.uses.spent, 2);
    assert.equal(genericHookCalls, 2);
    assert.equal(attackHookCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred cancellation happens after Sorcerer preflight but before payment", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(1, { includePoints: true });
  let prompts = 0;
  let genericHookCalls = 0;
  let resumedUses = 0;

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 1 };
      }
    });
    await service.syncSorceryPoints(actor);
    registerCombatHooks({
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: () => {
          genericHookCalls += 1;
          return false;
        }
      },
      combatAttackService: { applyDnd5ePreUseActivity: () => true }
    });
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor);
    activity.use = async (...args) => {
      resumedUses += 1;
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    assert.equal(preUse(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();

    assert.equal(genericHookCalls, 1);
    assert.equal(prompts, 1);
    assert.equal(resumedUses, 1);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a generic deferred resume reaches one paid Sorcerer final cast after neutral preflight", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(5, { includePoints: true });
  const resumedUses = [];
  let prompts = 0;
  let genericHookCalls = 0;
  let attackHookCalls = 0;

  globalThis.Hooks = {
    on: (name, callback) => {
      const callbacks = handlers.get(name) ?? [];
      callbacks.push(callback);
      handlers.set(name, callbacks);
    }
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => {
        prompts += 1;
        return { accepted: true, spellLevel: 3, exhaustionOverride: true };
      }
    });
    await service.syncSorceryPoints(actor);
    await actor.setFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns", {
      "chromatic-orb:3": { expiresAtRound: 2 }
    });
    registerCombatHooks({
      sorcererAutomationService: service,
      spellAutomationService: {
        deferDnd5ePreUseActivity: (activity, usageConfig, dialogConfig, messageConfig) => {
          genericHookCalls += 1;
          if (usageConfig?.flags?.[MODULE_ID]?.reactionCheckComplete === true) {
            return true;
          }

          queueMicrotask(() => {
            void activity.use({
              ...usageConfig,
              [MODULE_ID]: {
                ...(usageConfig?.[MODULE_ID] ?? {}),
                spellAutomationBypass: true
              },
              flags: {
                ...(usageConfig?.flags ?? {}),
                [MODULE_ID]: {
                  ...(usageConfig?.flags?.[MODULE_ID] ?? {}),
                  reactionCheckComplete: true
                }
              }
            }, dialogConfig, messageConfig);
          });
          return false;
        }
      },
      combatAttackService: {
        applyDnd5ePreUseActivity: () => {
          attackHookCalls += 1;
          return true;
        }
      }
    });
    const preUse = handlers.get("dnd5e.preUseActivity")?.[0];
    const activity = makeSorcererSpell(actor, { baseLevel: 3 });
    activity.use = async (...args) => {
      resumedUses.push(args);
      return preUse(activity, ...args) === true ? { updates: [] } : undefined;
    };

    assert.equal(preUse(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();

    assert.equal(genericHookCalls, 3);
    assert.equal(prompts, 1);
    assert.equal(resumedUses.length, 3);
    assert.equal(resumedUses[0][0][MODULE_ID].sorcererAutomationPreflight.accepted, true);
    assert.equal(resumedUses[0][0][MODULE_ID].spellAutomationBypass, undefined);
    assert.equal(resumedUses[1][0][MODULE_ID].spellAutomationBypass, true);
    assert.equal(resumedUses[1][0].flags[MODULE_ID].reactionCheckComplete, true);
    assert.equal(resumedUses[2][0][MODULE_ID].sorcererAutomationBypass, true);
    assert.equal(pointsItem(actor).system.uses.spent, 5);
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
      "chromatic-orb:3": { remaining: 3 }
    });
    assert.equal(actor.system.attributes.exhaustion, 1);
    assert.equal(attackHookCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("a deferred virtual cast locks the resumed dialog and virtual-cast usage configuration", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
  });
  await service.syncSorceryPoints(actor);
  const usageConfig = {};
  const dialogConfig = { configure: true, width: 480 };
  const messageConfig = { create: false };
  const activity = makeSorcererSpell(actor);
  const resumedUses = [];
  activity.use = async (...args) => {
    resumedUses.push(args);
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, usageConfig, dialogConfig, messageConfig), false);
  await waitForDeferredActivityUse();

  const [preflightUsageConfig, preflightDialogConfig, preflightMessageConfig] = resumedUses[0];
  assert.equal(preflightUsageConfig[MODULE_ID].sorcererAutomationPreflight.accepted, true);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(preflightUsageConfig),
    preflightDialogConfig,
    preflightMessageConfig
  ), false);
  await waitForDeferredActivityUse();

  const [resumedUsageConfig, resumedDialogConfig, resumedMessageConfig] = resumedUses[1];
  assert.notStrictEqual(resumedDialogConfig, dialogConfig);
  assert.deepEqual(dialogConfig, { configure: true, width: 480 });
  assert.deepEqual(resumedDialogConfig, { configure: false, width: 480 });
  assert.strictEqual(resumedMessageConfig, messageConfig);
  assert.equal(resumedUsageConfig.spell.slot, "spell3");
  assert.equal(resumedUsageConfig.scaling, 2);
  assert.equal(resumedUsageConfig.consume.spellSlot, false);
  assert.deepEqual(resumedUsageConfig.spellCast.payment, { resource: "sorcery-points", cost: 5 });
  assert.equal(resumedUsageConfig[MODULE_ID].sorcererAutomationBypass, true);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
  assert.equal(actor.system.spells.spell3.value, 1);
});

test("a deferred virtual cast forwards cooldown metadata to the final usage message", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({
      accepted: true,
      spellLevel: 3,
      castingMode: "sorcery"
    })
  });
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 });
  const resumedUses = [];
  activity.use = async (...args) => {
    resumedUses.push(args);
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
  await waitForDeferredActivityUse();

  const [preflightUsageConfig, preflightDialogConfig, preflightMessageConfig] = resumedUses[0];
  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(preflightUsageConfig),
    preflightDialogConfig,
    preflightMessageConfig
  ), false);
  await waitForDeferredActivityUse();

  const finalMessageConfig = resumedUses[1][2];
  assert.deepEqual(
    finalMessageConfig.data?.flags?.[MODULE_ID]?.["sorcererAutomation.virtualSlotCooldown"],
    {
      actorUuid: actor.uuid,
      actorId: actor.id,
      cooldownKey: "fireball:3",
      remaining: 3
    }
  );
});

test("a deferred virtual cast cannot open an editable dialog that overwrites its selected slot", async () => {
  const actor = levelActor(5, { includePoints: true });
  actor.system.spells = {
    spell1: { level: 1, value: 1, max: 1 },
    spell3: { level: 3, value: 1, max: 1 }
  };
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
  });
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor);
  let editableDialogs = 0;
  const resumedUsageConfigs = [];
  activity.use = async (nextUsageConfig, nextDialogConfig) => {
    resumedUsageConfigs.push(nextUsageConfig);
    if (nextDialogConfig.configure !== false) {
      editableDialogs += 1;
      nextUsageConfig.spell = { slot: "spell1" };
      nextUsageConfig.scaling = 0;
      nextUsageConfig.consume = { spellSlot: true };
    }
    consumeDnd5eSpellSlot(actor, nextUsageConfig);
    return { updates: [] };
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
  await waitForDeferredActivityUse();

  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(resumedUsageConfigs[0]),
    { configure: false },
    {}
  ), false);
  await waitForDeferredActivityUse();
  const resumedUsageConfig = resumedUsageConfigs[1];

  assert.equal(editableDialogs, 0);
  assert.equal(resumedUsageConfig.spell.slot, "spell3");
  assert.equal(resumedUsageConfig.scaling, 2);
  assert.equal(resumedUsageConfig.consume.spellSlot, false);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
  assert.equal(actor.system.spells.spell1.value, 1);
  assert.equal(actor.system.spells.spell3.value, 1);
});

test("a deferred virtual cast rolls back its payment when resumed D&D5e usage is cancelled or fails", async () => {
  for (const resumedResult of [undefined, false]) {
    const actor = levelActor(5, { includePoints: true });
    const service = new SorcererAutomationService({
      chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 3 })
    });
    await service.syncSorceryPoints(actor);
    const activity = makeSorcererSpell(actor, { baseLevel: 3 });
    let preflightUsageConfig;
    let calls = 0;
    activity.use = async (nextUsageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflightUsageConfig = nextUsageConfig;
        return { updates: [] };
      }
      return resumedResult;
    };

    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.equal(service.finalizeDnd5ePreUseActivity(
      activity,
      completeReactionCheck(preflightUsageConfig),
      { configure: false },
      {}
    ), false);
    await waitForDeferredActivityUse();

    assert.equal(pointsItem(actor).system.uses.spent, 0);
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {});
    assert.equal(actor.system.attributes.exhaustion, 0);
  }
});

test("a cancelled final normal cast rolls back metamagic payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({
      accepted: true,
      spellLevel: 1,
      castingMode: "normal"
    }),
    chooseMetamagic: async () => ({ accepted: true, ids: ["subtle-spell"] })
  });
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor, { root: "" });
  let preflightUsageConfig;
  let finalUsageConfig;
  let calls = 0;
  activity.use = async (usageConfig) => {
    calls += 1;
    if (calls === 1) {
      preflightUsageConfig = usageConfig;
      return { updates: [] };
    }
    finalUsageConfig = usageConfig;
    return undefined;
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {
    consume: { spellSlot: true }
  }, {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(preflightUsageConfig),
    {},
    {}
  ), false);
  await waitForDeferredActivityUse();

  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(finalUsageConfig.consume.spellSlot, true);
  assert.equal(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("virtual spell level selection uses the exact Sorcery Point table", async () => {
  const actor = levelActor(17, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  for (const [level, cost] of [[1, 2], [2, 3], [3, 5], [4, 6], [5, 7], [6, 9], [7, 10], [8, 11], [9, 13]]) {
    const usageConfig = { sorcererVirtualSpellLevel: level };
    const before = pointsItem(actor).system.uses.spent;
    const result = await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: `spell-${level}` }), usageConfig, {}, {});
    assert.equal(result, true);
    assert.equal(pointsItem(actor).system.uses.spent, before + cost);
    assert.equal(usageConfig.spellCast.spellLevel, level);
    assert.equal(usageConfig.spellCast.payment.cost, cost);
  }
});

test("virtual-slot prompt shows each legal level with its exact Sorcery Point cost", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  let dialog;
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialog = config;
      return { accepted: true, spellLevel: 2 };
    }
  };

  try {
    assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {}, {}, {}), true);
    assert.match(dialog.content, /1.*2/u);
    assert.match(dialog.content, /2.*3/u);
    assert.match(dialog.content, /rebreya-sorcerer-choice-row/u);
    assert.match(dialog.content, /data-sorcerer-total/u);
    assert.equal(pointsItem(actor).system.uses.spent, 3);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("virtual-slot prompt combines resource, metamagic, and live total controls in one dialog", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      const form = {
        elements: {
          castingMode: { value: "normal" },
          spellLevel: {
            value: "1",
            selectedOptions: [{ dataset: { sorcererCost: "2" } }]
          },
          consumeResource: { checked: true },
          exhaustionOverride: { checked: false },
          metamagic: [
            { tagName: "INPUT", checked: true, value: "subtle-spell" },
            { tagName: "INPUT", checked: false, value: "distant-spell" }
          ],
          carefulTargets: { tagName: "SELECT", multiple: true, selectedOptions: [] },
          heightenedTarget: { tagName: "SELECT", value: "" },
          damageDice: { tagName: "SELECT", multiple: true, selectedOptions: [] }
        }
      };
      return config.buttons.find((button) => button.action === "cast").callback(null, { form });
    }
  };

  try {
    const usageConfig = {};
    assert.equal(await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor)), usageConfig, {}, {}), true);
    assert.equal(dialogs.length, 1);
    assert.match(dialogs[0].content, /Выберите способ каста, уровень и метамагию/u);
    assert.doesNotMatch(dialogs[0].content, /виртуальной ячейки/u);
    assert.match(dialogs[0].content, /name="consumeResource" checked/u);
    assert.match(dialogs[0].content, /name="castingMode"/u);
    assert.match(dialogs[0].content, /Расходовать ресурс/u);
    assert.match(dialogs[0].content, /name="metamagic"/u);
    assert.match(dialogs[0].content, /data-stacking="base"/u);
    assert.match(dialogs[0].content, /data-stacking="additive"/u);
    assert.match(dialogs[0].content, /rebreya-sorcerer-option__lock/u);
    assert.doesNotMatch(dialogs[0].content, /onchange=/u);
    assert.equal(dialogs[0].position.width, 720);
    assert.equal(typeof dialogs[0].render, "function");
    assert.match(dialogs[0].content, /итого: <strong data-sorcerer-total>2<\/strong> единиц чародейства/u);
    assert.doesNotMatch(dialogs[0].content, /Игнорировать ограничение ценой истощения/u);
    assert.equal(pointsItem(actor).system.uses.spent, 1);
    assert.equal(usageConfig.spellCast.castingMode, "normal");
    assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 1 });
    assert.deepEqual(usageConfig.spellCast.modifiers.subtle, true);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("sorcerer cast dialog updater recalculates totals and locks incompatible options", () => {
  const subtle = {
    checked: true,
    disabled: false,
    value: "subtle-spell",
    dataset: { cost: "1", costMode: "fixed", minCost: "1", maxCost: "1", stacking: "base" }
  };
  const quickened = {
    checked: false,
    disabled: false,
    value: "quickened-spell",
    dataset: { cost: "2", costMode: "fixed", minCost: "1", maxCost: "2", stacking: "base" }
  };
  const empowered = {
    checked: false,
    disabled: false,
    value: "empowered-spell",
    dataset: { cost: "1", costMode: "fixed", minCost: "1", maxCost: "1", stacking: "additive" }
  };
  const subtleLabel = makeFakeMetamagicLabel(subtle);
  const quickenedLabel = makeFakeMetamagicLabel(quickened);
  const empoweredLabel = makeFakeMetamagicLabel(empowered);
  const { root, total } = makeCastDialogRoot({
    selectedLevel: 2,
    slotCost: 3,
    metamagicInputs: [subtle, quickened, empowered]
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(total.textContent, "4");
  assert.equal(quickened.disabled, true);
  assert.equal(quickenedLabel.label.classes.has("is-locked"), true);
  assert.equal(subtle.disabled, false);
  assert.equal(subtleLabel.label.classes.has("is-locked"), false);
  assert.equal(empowered.disabled, false);
  assert.equal(empoweredLabel.label.classes.has("is-locked"), false);
});

test("normal mode total contains metamagic cost but not virtual-slot cost", () => {
  const subtle = {
    checked: true,
    disabled: false,
    value: "subtle-spell",
    dataset: { cost: "1", minCost: "1", maxCost: "1", costMode: "fixed", stacking: "base" }
  };
  makeFakeMetamagicLabel(subtle);
  const { root, total, castButton } = makeCastDialogRoot({
    castingMode: "normal",
    slotCost: 5,
    availablePoints: 1,
    metamagicInputs: [subtle]
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(total.textContent, "1");
  assert.equal(castButton.disabled, false);
});

test("Sorcery Points mode disables confirmation when its live total exceeds the budget", () => {
  const { root, total, castButton } = makeCastDialogRoot({
    castingMode: "sorcery",
    slotCost: 5,
    availablePoints: 4
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(total.textContent, "5");
  assert.equal(castButton.disabled, true);
});

test("an active cooldown explains how to cast instead of silently accepting an invalid Sorcery cast", () => {
  const { root, mode, castButton, exhaustionInput, blocked } = makeCastDialogRoot({
    castingMode: "sorcery",
    requiresExhaustion: true
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(castButton.disabled, true);
  assert.equal(blocked.hidden, false);
  assert.match(blocked.textContent, /обычный каст|истощени/iu);

  exhaustionInput.checked = true;
  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(castButton.disabled, false);
  assert.equal(blocked.hidden, true);

  exhaustionInput.checked = false;
  mode.value = "normal";
  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(castButton.disabled, false);
  assert.equal(blocked.hidden, true);
});

test("zero-cost metamagic contributes nothing to the live Sorcery Point total", () => {
  const protection = {
    checked: true,
    disabled: false,
    value: "draconic-dragon-protection",
    dataset: { cost: "0", costMode: "fixed", minCost: "0", maxCost: "0", stacking: "base" }
  };
  const protectionLabel = makeFakeMetamagicLabel(protection);
  const { root, total } = makeCastDialogRoot({
    selectedLevel: 2,
    slotCost: 3,
    metamagicInputs: [protection]
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(protection.dataset.currentCost, "0");
  assert.equal(protectionLabel.costLabel.textContent, "0");
  assert.equal(total.textContent, "3");
});

test("variable origin metamagic uses the selected slider cost for totals and payment", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-dragon-spell", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-spell",
    description: "<p>Dragon spell full source text.</p>"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      const form = {
        elements: {
          spellLevel: { value: "2", selectedOptions: [{ dataset: { sorcererCost: "3" } }] },
          consumeResource: { checked: true },
          exhaustionOverride: { checked: false },
          metamagic: { tagName: "INPUT", checked: true, value: "draconic-dragon-spell" },
          "metamagicCost.draconic-dragon-spell": { tagName: "INPUT", value: "2" },
          carefulTargets: { tagName: "SELECT", multiple: true, selectedOptions: [] },
          heightenedTarget: { tagName: "SELECT", value: "" },
          damageDice: { tagName: "SELECT", multiple: true, selectedOptions: [] }
        }
      };
      return config.buttons.find((button) => button.action === "cast").callback(null, { form });
    }
  };

  try {
    const usageConfig = {};
    const messageConfig = {};
    assert.equal(await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: { damage: { parts: [{ _id: "base-fire", formula: "1d6", types: ["fire"] }] } }
    })), usageConfig, {}, messageConfig), true);
    assert.match(dialogs[0].content, /name="metamagicCost\.draconic-dragon-spell"/u);
    assert.match(dialogs[0].content, /type="range"/u);
    assert.match(dialogs[0].content, /Dragon spell full source text\./u);
    assert.doesNotMatch(dialogs[0].content, /(?:<|&lt;)\/?p(?:>|&gt;)/u);
    assert.equal(pointsItem(actor).system.uses.spent, 5);
    assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 5 });
    assert.deepEqual(usageConfig.spellCast.metamagic, [{
      id: "draconic-dragon-spell",
      name: "draconic-dragon-spell",
      cost: 2,
      stacking: "base",
      automation: "draconic-dragon-spell"
    }]);
    assert.equal(messageConfig.data.flags[MODULE_ID].spellCast.metamagic[0].cost, 2);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("virtual-slot prompt can leave Sorcery Points unspent when resource spending is disabled", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  globalThis.DialogV2 = {
    wait: async (config) => {
      const form = {
        elements: {
          spellLevel: { value: "1", selectedOptions: [{ dataset: { sorcererCost: "2" } }] },
          consumeResource: { checked: false },
          exhaustionOverride: { checked: false },
          metamagic: { tagName: "INPUT", checked: true, value: "subtle-spell" },
          carefulTargets: { tagName: "SELECT", multiple: true, selectedOptions: [] },
          heightenedTarget: { tagName: "SELECT", value: "" },
          damageDice: { tagName: "SELECT", multiple: true, selectedOptions: [] }
        }
      };
      return config.buttons.find((button) => button.action === "cast").callback(null, { form });
    }
  };

  try {
    const usageConfig = {};
    assert.equal(await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor)), usageConfig, {}, {}), true);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
    assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 0 });
    assert.deepEqual(usageConfig.spellCast.modifiers.subtle, true);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("virtual-slot prompt shows exhaustion override only for an active cooldown", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const originalDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      return { accepted: true, spellLevel: 3, consumeResource: true, metamagic: { ids: [] } };
    }
  };

  try {
    const spell = makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 });
    assert.equal(await service.applyDnd5ePreUseActivity(spell, {}, {}, {}), true);
    assert.doesNotMatch(dialogs[0].content, /Игнорировать ограничение ценой истощения/u);

    dialogs.length = 0;
    globalThis.DialogV2.wait = async (config) => {
      dialogs.push(config);
      return { accepted: true, spellLevel: 3, exhaustionOverride: true, consumeResource: true, metamagic: { ids: [] } };
    };
    assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}), true);
    assert.match(dialogs[0].content, /Игнорировать ограничение ценой истощения/u);
    assert.match(dialogs[0].content, /data-sorcerer-exhaustion-row/u);
  }
  finally {
    globalThis.DialogV2 = originalDialog;
  }
});

test("cancelled, invalid, and unaffordable virtual casts do not mutate resources", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: false })
  });
  await service.syncSorceryPoints(actor);

  const cancelledDialogConfig = {};
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor), {}, cancelledDialogConfig, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.deepEqual(cancelledDialogConfig, {});

  const invalidUsage = { sorcererVirtualSpellLevel: 3 };
  assert.equal(await new SorcererAutomationService({}).applyDnd5ePreUseActivity(makeSorcererSpell(actor), invalidUsage, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(invalidUsage.spellCast, undefined);

  pointsItem(actor).system.uses.spent = 16;
  const unaffordableUsage = { sorcererVirtualSpellLevel: 2 };
  assert.equal(await new SorcererAutomationService({}).applyDnd5ePreUseActivity(makeSorcererSpell(actor), unaffordableUsage, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 16);
  assert.equal(unaffordableUsage.spellCast, undefined);
});

test("low-level repeat casts require an exhaustion override until their owner-turn cooldown expires", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  globalThis.game.combat = { round: 10 };

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}), true);
  const blockedUsage = {};
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), blockedUsage, {}, {}), false);
  assert.equal(blockedUsage.spellCast, undefined);

  const overrideUsage = { sorcererExhaustionOverride: true };
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), overrideUsage, {}, {}), true);
  assert.equal(actor.system.attributes.exhaustion, 1);
  assert.equal(overrideUsage.spellCast.modifiers.cooldownOverride, true);
  assert.equal(overrideUsage.spellCast.modifiers.exhaustion, 1);

  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}), true);
});

test("RED: level-three virtual-slot cooldown counts down on each owner turn", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }),
    {},
    {},
    {}
  ), true);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 3 }
  });

  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });

  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 0 }
  });
});

test("RED: an unrelated combatant turn leaves another Sorcerer's cooldown unchanged", async () => {
  const actor = levelActor(5, { includePoints: true });
  const otherActor = levelActor(5, { includePoints: true });
  otherActor.id = "other-sorcerer";
  otherActor.uuid = "Actor.other-sorcerer";
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }),
    {},
    {},
    {}
  ), true);
  await service.handleCombatTurnChange({ combatant: { actor: otherActor } }, { turn: 0 });

  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 3 }
  });
});

test("RED: a reaction Shield cast is ready at the start of its owner's next turn", async () => {
  const actor = levelActor(1, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "shield", baseLevel: 1 }),
    {},
    {},
    {}
  ), true);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "shield:1": { remaining: 1 }
  });

  await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "shield:1": { remaining: 0 }
  });
  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "shield", baseLevel: 1 }),
    {},
    {},
    {}
  ), true);
});

test("combatRound advances a first-in-initiative Sorcerer cooldown", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}
  );
  globalThis.Hooks = {
    on: (name, callback) => handlers.set(name, [...(handlers.get(name) ?? []), callback])
  };
  globalThis.game = { user: { id: "user", isGM: true }, messages: new Map() };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    registerCombatHooks({ sorcererAutomationService: service });
    const combat = { turns: [{ actor }], combatant: { actor } };
    handlers.get("combatRound")?.[0](combat, { round: 2, turn: 0 }, { direction: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
      "fireball:3": { remaining: 2 }
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("rewinding combat does not decrement a Sorcerer cooldown", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}
  );

  await service.handleCombatTurnChange(
    { turns: [{ actor }], combatant: { actor } },
    { round: 1, turn: 0 },
    { direction: -1 }
  );
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 3 }
  });
});

test("RED: a cooldown card stores stable metadata and keeps exactly one footer block", async () => {
  const previousGame = globalThis.game;
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 });
  const messageConfig = {};

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {}, {}, messageConfig), true);
  const message = makeCooldownCardMessage({
    content: '<div class="chat-card"><ul class="card-footer pills unlist"><li>native</li></ul></div>',
    flags: messageConfig.data?.flags
  });
  globalThis.game = { ...previousGame, messages: new Map([[message.id, message]]) };
  try {
    await service.handleDnd5ePostCreateUsageMessage(activity, message);
    await service.handleDnd5ePostCreateUsageMessage(activity, message);
    assert.deepEqual(message.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldown"), {
      actorUuid: actor.uuid,
      actorId: actor.id,
      cooldownKey: "fireball:3",
      remaining: 3
    });
    assert.match(message.content, /Перезарядка: 3 раунда/u);
    assert.equal((message.content.match(/data-rebreya-sorcerer-cooldown/gu) ?? []).length, 1);

    await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
    assert.match(message.content, /Перезарядка: 2 раунда/u);
    assert.equal((message.content.match(/data-rebreya-sorcerer-cooldown/gu) ?? []).length, 1);

    await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
    assert.match(message.content, /Перезарядка: 1 раунд/u);
    assert.equal((message.content.match(/data-rebreya-sorcerer-cooldown/gu) ?? []).length, 1);

    await service.handleCombatTurnChange({ combatant: { actor } }, { turn: 0 });
    assert.match(message.content, /Перезарядка: готово/u);
    assert.equal((message.content.match(/data-rebreya-sorcerer-cooldown/gu) ?? []).length, 1);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("RED: a cooldown override does not flag a new spell card for cooldown display", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }),
    {},
    {},
    {}
  ), true);
  const messageConfig = {};
  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }),
    { sorcererExhaustionOverride: true },
    {},
    messageConfig
  ), true);

  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 3 }
  });
  assert.equal(messageConfig.data?.flags?.[MODULE_ID]?.sorcererAutomation?.virtualSlotCooldown, undefined);
});

test("RED: actor spell rows show active Sorcerer virtual-slot cooldowns", () => {
  const previousHTMLElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;

  class FakeElement {
    constructor({ dataset = {}, selectors = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectors = selectors;
      this.selectorAll = selectorAll;
      this.children = [];
      this.attributes = {};
      this.textContent = "";
      this.classList = {
        values: new Set(),
        add: (...names) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name) => this.classList.values.has(name)
      };
    }

    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }

    querySelector(selector) {
      return this.selectors[selector] ?? null;
    }

    querySelectorAll(selector) {
      return this.selectorAll[selector] ?? [];
    }

    remove() {
      this.removed = true;
      if (this.parentElement?.children) {
        this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      }
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    createElement: () => new FakeElement()
  };

  try {
    const actor = levelActor(3, { includePoints: true });
    actor.items.contents.push(makeItemFromData(actor, {
      name: "Witch Bolt",
      type: "spell",
      system: { identifier: "witch-bolt", level: 1 }
    }, "witch-bolt-item"));
    actor.flags[MODULE_ID] = {
      "sorcererAutomation.virtualSlotCooldowns": {
        "witch-bolt:2": { remaining: 2 },
        "shield:1": { remaining: 1 }
      }
    };

    const nameStack = new FakeElement();
    const row = new FakeElement({
      dataset: { itemId: "witch-bolt-item" },
      selectors: {
        ".item-name .name-stacked": nameStack
      }
    });
    const root = new FakeElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });

    const service = new SorcererAutomationService({});

    assert.equal(service.bindActorSheetCooldownBadges(root, actor), true);
    assert.equal(row.classList.contains("has-rebreya-sorcerer-cooldown"), true);
    assert.equal(row.dataset.rebreyaSorcererCooldownRemaining, "2");
    assert.equal(row.dataset.rebreyaSorcererCooldownLabel, "Перезарядка: 2 раунда");
    assert.equal(row.dataset.rebreyaSorcererCooldownShort, "2р");
    assert.equal(row.attributes["aria-label"], "Перезарядка: 2 раунда");
    assert.equal(nameStack.children.length, 0);
  }
  finally {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.document = previousDocument;
  }
});

test("RED: actor spell cooldown indicator ignores nested item rows for the same spell", () => {
  const previousHTMLElement = globalThis.HTMLElement;

  class FakeElement {
    constructor({ dataset = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectorAll = selectorAll;
      this.children = [];
      this.attributes = {};
      this.classList = {
        values: new Set(),
        add: (...names) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name) => this.classList.values.has(name)
      };
    }

    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        this.children.push(child);
      }
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    removeAttribute(name) {
      delete this.attributes[name];
    }

    querySelectorAll(selector) {
      return this.selectorAll[selector] ?? [];
    }
  }

  globalThis.HTMLElement = FakeElement;

  try {
    const actor = levelActor(3, { includePoints: true });
    actor.items.contents.push(makeItemFromData(actor, {
      name: "Witch Bolt",
      type: "spell",
      system: { identifier: "witch-bolt", level: 1 }
    }, "witch-bolt-item"));
    actor.flags[MODULE_ID] = {
      "sorcererAutomation.virtualSlotCooldowns": {
        "witch-bolt:2": { remaining: 2 }
      }
    };

    const row = new FakeElement({ dataset: { itemId: "witch-bolt-item" } });
    const nestedRow = new FakeElement({ dataset: { itemId: "witch-bolt-item" } });
    row.append(nestedRow);
    const root = new FakeElement({
      selectorAll: {
        "[data-item-id]": [row, nestedRow]
      }
    });

    const service = new SorcererAutomationService({});

    assert.equal(service.bindActorSheetCooldownBadges(root, actor), true);
    assert.equal(row.classList.contains("has-rebreya-sorcerer-cooldown"), true);
    assert.equal(nestedRow.classList.contains("has-rebreya-sorcerer-cooldown"), false);
    assert.equal(nestedRow.dataset.rebreyaSorcererCooldownRemaining, undefined);
  }
  finally {
    globalThis.HTMLElement = previousHTMLElement;
  }
});

test("high-level virtual slots are limited once per level until long rest unless overridden", async () => {
  const actor = levelActor(13, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);

  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "disintegrate", baseLevel: 6 }), {}, {}, {}), true);
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "other-six", baseLevel: 6 }), {}, {}, {}), false);
  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "other-six", baseLevel: 6 }),
    { sorcererExhaustionOverride: true },
    {},
    {}
  ), true);
  assert.equal(actor.system.attributes.exhaustion, 1);

  await service.handleRestCompleted(actor, { longRest: true });
  assert.equal(await service.applyDnd5ePreUseActivity(makeSorcererSpell(actor, { id: "after-rest", baseLevel: 6 }), {}, {}, {}), true);
});

test("class item creation and level updates synchronize the owned Sorcery Points resource", async () => {
  const actor = levelActor(3);
  const service = new SorcererAutomationService({});
  const classItem = {
    type: "class",
    actor,
    system: { identifier: SORCERER_ROOT, levels: 3 },
    flags: { [MODULE_ID]: { classIdentifier: SORCERER_ROOT } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };

  await service.handleCreatedItem(classItem, {}, "user");
  assert.equal(pointsItem(actor).system.uses.max, 17);
  actor.system.scale[SORCERER_ROOT]["sorcery-points"] = 21;
  await service.handleUpdatedItem(classItem, { system: { levels: 4 } }, {}, "user");
  assert.equal(pointsItem(actor).system.uses.max, 21);
});

test("public Sorcery Point spend and restore helpers use the owned resource", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});

  assert.equal(await service.spendSorceryPoints(actor, 5), true);
  assert.equal(pointsItem(actor).system.uses.spent, 5);
  assert.equal(await service.restoreSorceryPoints(actor, 2), true);
  assert.equal(pointsItem(actor).system.uses.spent, 3);
  assert.equal(await service.spendSorceryPoints(actor, 99), false);
  assert.equal(pointsItem(actor).system.uses.spent, 3);
});

function makeDnd5eActivityClone(activity) {
  for (const key of ["activation", "components", "duration", "range", "target", "damage", "attack"]) {
    if (activity.system?.[key] !== undefined) {
      activity[key] = structuredClone(activity.system[key]);
    }
  }
  activity.updateSource = (patch) => {
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(activity, path, structuredClone(value));
    }
    return activity;
  };
  return activity;
}

test("RED: uses the Foundry V13 DialogV2 namespace when the legacy global is absent", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const previousApplications = globalThis.foundry.applications;
  const dialogs = [];
  globalThis.DialogV2 = undefined;
  globalThis.foundry.applications = {
    api: {
      DialogV2: {
        wait: async (config) => {
          dialogs.push(config);
          return dialogs.length === 1
            ? { accepted: true, spellLevel: 1 }
            : { accepted: true, ids: [] };
        }
      }
    }
  };

  try {
    assert.equal(await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor)), {}, {}, {}), true);
    assert.equal(dialogs.length, 2);
  }
  finally {
    globalThis.DialogV2 = previousDialog;
    globalThis.foundry.applications = previousApplications;
  }
});

test("RED: metamagic form callback retains every Careful target and Empowered die selected in multiple selects", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const previousFromUuid = globalThis.fromUuid;
  const dialogs = [];
  globalThis.fromUuid = undefined;
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      const form = {
        elements: {
          metamagic: [
            { tagName: "INPUT", checked: true, value: "careful-spell" },
            { tagName: "INPUT", checked: true, value: "empowered-spell" }
          ],
          carefulTargets: {
            tagName: "SELECT",
            multiple: true,
            selectedOptions: [{ value: "Token.careful-a" }, { value: "Token.careful-b" }]
          },
          heightenedTarget: { tagName: "SELECT", value: "" },
          twinnedTarget: { tagName: "SELECT", value: "" },
          damageDice: {
            tagName: "SELECT",
            multiple: true,
            selectedOptions: [{ value: "fire:0" }, { value: "fire:1" }]
          }
        }
      };
      return config.buttons.find((button) => button.action === "confirm").callback(null, { form });
    }
  };

  try {
    const usageConfig = { sorcererVirtualSpellLevel: 1 };
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: {
        save: { ability: "dex" },
        damage: { parts: [{ _id: "fire", formula: "2d6" }] }
      }
    }));
    assert.equal(await service.applyDnd5ePreUseActivity(activity, usageConfig, {}, {}), true);
    assert.equal(dialogs.length, 1);
    assert.deepEqual(usageConfig.spellCast.modifiers.careful.targets, ["Token.careful-a", "Token.careful-b"]);
    assert.deepEqual(usageConfig.spellCast.modifiers.empowered.damageDice.map((die) => die.id), ["fire:0", "fire:1"]);
  }
  finally {
    globalThis.DialogV2 = previousDialog;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("RED: Twinned rejects Actor, off-scene, and non-placeable token documents before spending Sorcery Points", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  const previousCanvas = globalThis.canvas;
  const previousGame = globalThis.game;
  const currentScene = { id: "current", uuid: "Scene.current" };
  const first = {
    id: "first",
    uuid: "Scene.current.Token.first",
    documentName: "Token",
    parent: currentScene,
    actor: { uuid: "Actor.first" }
  };
  const firstPlaceable = { id: "first", document: first, actor: first.actor };
  const invalidDocuments = [
    { id: "actor", uuid: "Actor.forged", type: "Actor", documentName: "Actor", actor: undefined },
    {
      id: "off-scene",
      uuid: "Scene.other.Token.off-scene",
      documentName: "Token",
      parent: { id: "other", uuid: "Scene.other" },
      actor: { uuid: "Actor.off-scene" }
    },
    {
      id: "not-placeable",
      uuid: "Scene.current.Token.not-placeable",
      documentName: "Token",
      parent: currentScene,
      actor: { uuid: "Actor.not-placeable" }
    }
  ];
  const targetUpdates = [];
  globalThis.fromUuid = async (uuid) => [first, ...invalidDocuments].find((document) => document.uuid === uuid) ?? null;
  globalThis.canvas = { scene: currentScene, tokens: { placeables: [firstPlaceable] } };
  globalThis.game = {
    ...previousGame,
    user: {
      ...(previousGame?.user ?? {}),
      targets: new Set([firstPlaceable]),
      updateTokenTargets: async (ids) => targetUpdates.push(Array.from(ids))
    }
  };

  try {
    for (const secondTarget of invalidDocuments) {
      const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
        id: `twinned-${secondTarget.id}`,
        system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
      }));
      assert.equal(await service.applyDnd5ePreUseActivity(activity, {
        sorcererVirtualSpellLevel: 1,
        sorcererMetamagic: {
          ids: ["twinned-spell"],
          targets: [first.uuid, secondTarget.uuid]
        }
      }, {}, {}), false);
    }
    assert.deepEqual(targetUpdates, []);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.canvas = previousCanvas;
    globalThis.game = previousGame;
  }
});

test("RED: Extended doubles and caps non-concentration cloned ActiveEffect durations used to create effects", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { duration: { value: 12, units: "hour" } }
  }));
  const created = [];
  const effect = {
    name: "Lingering spell",
    duration: { seconds: 50_000 },
    flags: { dnd5e: {} },
    toObject() {
      return structuredClone({ name: this.name, duration: this.duration, flags: this.flags });
    },
    updateSource(patch) {
      for (const [path, value] of Object.entries(patch)) foundry.utils.setProperty(this, path, value);
    }
  };
  const concentrationEffect = {
    name: "Concentration",
    duration: { seconds: 50_000 },
    flags: { dnd5e: { concentration: true } },
    toObject() {
      return structuredClone({ name: this.name, duration: this.duration, flags: this.flags });
    },
    updateSource(patch) {
      for (const [path, value] of Object.entries(patch)) foundry.utils.setProperty(this, path, value);
    }
  };
  activity.item.effects = { contents: [effect, concentrationEffect] };
  actor.createEmbeddedDocuments = async (type, sources) => {
    assert.equal(type, "ActiveEffect");
    created.push(...sources);
    return sources;
  };

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["extended-spell"] }
  }, {}, {}), true);
  await actor.createEmbeddedDocuments("ActiveEffect", activity.item.effects.contents.map((entry) => entry.toObject()));
  assert.equal(created[0].duration.seconds, 86_400);
  assert.equal(created[1].duration.seconds, 50_000);
});

test("RED: resolved DialogV2 metamagic selection is persisted for the final virtual cast", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const responses = [
    { accepted: true, spellLevel: 1 },
    { accepted: true, ids: ["subtle-spell"] }
  ];
  globalThis.DialogV2 = { wait: async () => responses.shift() };
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor));
  const resumed = [];
  activity.use = async (usageConfig) => {
    resumed.push(usageConfig);
    return { updates: [] };
  };

  try {
    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.deepEqual(
      resumed[0][MODULE_ID].sorcererAutomationPreflight.metamagic.ids,
      ["subtle-spell"]
    );
  }
  finally {
    globalThis.DialogV2 = previousDialog;
  }
});

test("RED: metamagic DialogV2 includes compact target and damage-die controls", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      return dialogs.length === 1
        ? { accepted: true, spellLevel: 1 }
        : { accepted: true, ids: [] };
    }
  };
  try {
    await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: {
        save: { ability: "dex" },
        target: { affects: { count: 1 } },
        range: { value: 60, units: "ft" },
        damage: { parts: [{ _id: "fire", formula: "2d6" }] }
      }
    })), {}, {}, {});
    const content = dialogs[1].content;
    for (const control of ["carefulTargets", "heightenedTarget", "damageDice"]) {
      assert.match(content, new RegExp(`name=\"${control}\"`, "u"));
    }
    assert.doesNotMatch(content, /twinnedTarget/u);
    assert.match(content, /выберите две подходящие цели обычным инструментом выбора целей Foundry/u);
    assert.match(content, /rebreya-sorcerer-choice-row/u);
  }
  finally {
    globalThis.DialogV2 = previousDialog;
  }
});

test("RED: sorcerer metamagic option data keeps full source-file descriptions", () => {
  const data = JSON.parse(readFileSync(new URL("../data/sorcerer-rework-v011.json", import.meta.url), "utf8"));
  const descriptionsById = new Map(data.metamagicOptions.map((option) => [option.id, option.description]));
  for (const [id, description] of Object.entries(FULL_METAMAGIC_DESCRIPTIONS)) {
    assert.equal(descriptionsById.get(id), description);
  }
});

test("RED: metamagic DialogV2 shows full source-file descriptions instead of summaries", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousDialog = globalThis.DialogV2;
  const dialogs = [];
  globalThis.DialogV2 = {
    wait: async (config) => {
      dialogs.push(config);
      return dialogs.length === 1
        ? { accepted: true, spellLevel: 1 }
        : { accepted: true, ids: [] };
    }
  };
  try {
    await service.applyDnd5ePreUseActivity(makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: {
        save: { ability: "dex" },
        target: { affects: { count: 1 } },
        range: { value: 60, units: "ft" },
        damage: { parts: [{ _id: "fire", formula: "2d6" }] }
      }
    })), {}, {}, {});
    const content = dialogs[1].content;
    for (const description of Object.values(FULL_METAMAGIC_DESCRIPTIONS)) {
      assert.ok(content.includes(description), `Expected metamagic dialog to include: ${description}`);
    }
  }
  finally {
    globalThis.DialogV2 = previousDialog;
  }
});

test("RED: final dnd5e clone consumes actual Distant, Quickened, Extended, and Subtle activity fields", async () => {
  const cases = [
    {
      id: "distant-spell",
      system: { range: { value: 60, units: "ft" } },
      actual: (activity) => assert.deepEqual(activity.range, { value: 120, units: "ft" })
    },
    {
      id: "quickened-spell",
      system: { activation: { type: "action", value: 1 } },
      actual: (activity) => assert.deepEqual(activity.activation, { type: "bonus", value: 1 })
    },
    {
      id: "extended-spell",
      system: { duration: { value: 15, units: "hour" } },
      actual: (activity) => assert.deepEqual(activity.duration, { value: 24, units: "hour" })
    },
    {
      id: "subtle-spell",
      system: { components: { vocal: true, somatic: true, material: true } },
      actual: (activity) => assert.deepEqual(activity.components, { vocal: false, somatic: false, material: true })
    }
  ];

  for (const entry of cases) {
    const actor = metamagicActor();
    const service = new SorcererAutomationService({});
    await service.syncSorceryPoints(actor);
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: entry.system }));
    assert.equal(await service.applyDnd5ePreUseActivity(activity, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: [entry.id] }
    }, {}, {}), true);
    entry.actual(activity);
  }
});

test("RED: hooks use the installed dnd5e save, damage, and attack hook contracts", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  globalThis.Hooks = {
    on: (name, callback) => handlers.set(name, callback)
  };
  globalThis.game = { user: { id: "user", isGM: true }, combat: { round: 1 } };
  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    const service = new SorcererAutomationService({});
    let combatTurnCalls = 0;
    service.handleCombatTurnChange = async () => { combatTurnCalls += 1; return true; };
    registerCombatHooks({ sorcererAutomationService: service });
    assert.equal(typeof handlers.get("dnd5e.preRollSavingThrow"), "function");
    assert.equal(typeof handlers.get("dnd5e.preRollDamage"), "function");
    assert.equal(typeof handlers.get("dnd5e.rollAttack"), "function");
    handlers.get("combatTurn")({ combatant: { actor: levelActor(1) } }, { turn: 0 }, {});
    await waitForDeferredActivityUse();
    assert.equal(combatTurnCalls, 1);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("RED: Seeking uses a pre-use pending record with the real rollAttack context shape", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { attack: { type: "spell" } } }));
  activity.rollAttack = async () => [{ total: 18 }];
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["seeking-spell"] }
  }, {}, {}), true);
  const missedRoll = { isFailure: true, total: 4 };
  assert.equal(await service.applyDnd5ePostAttackRoll([missedRoll], {
    subject: activity,
    ammoUpdate: null
  }), true);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("real save-roll config consumes Careful success and one Heightened disadvantage from a usage message", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  const message = {
    id: "usage-message",
    getFlag: (_scope, key) => key === "saveOverrides"
      ? {
        carefulTargetUuids: ["Actor.ally"],
        heightenedTargetUuid: "Actor.enemy",
        heightenedUsed: false
      }
      : undefined
  };
  service.handleDnd5ePostCreateUsageMessage(null, message);
  const eventFor = () => ({ target: { closest: () => ({ dataset: { messageId: "usage-message" } }) } });

  const carefulConfig = { subject: { uuid: "Actor.ally" }, event: eventFor(), rolls: [{ options: { target: 17 } }] };
  assert.equal(service.applyDnd5ePreRollSavingThrow(carefulConfig), true);
  assert.equal(carefulConfig.target, 0);
  assert.equal(carefulConfig.rolls[0].options.target, 0);

  const heightenedConfig = { subject: { uuid: "Actor.enemy" }, event: eventFor(), rolls: [{ options: {} }] };
  assert.equal(service.applyDnd5ePreRollSavingThrow(heightenedConfig), true);
  assert.equal(heightenedConfig.disadvantage, true);
  assert.equal(heightenedConfig.rolls[0].options.disadvantage, true);
  const secondSave = { subject: { uuid: "Actor.enemy" }, event: eventFor(), rolls: [{ options: {} }] };
  service.applyDnd5ePreRollSavingThrow(secondSave);
  assert.equal(secondSave.disadvantage, undefined);
});

test("Twinned validates native document ids without changing the selected targets", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  const previousGame = globalThis.game;
  const docs = new Map([
    ["Token.first", { id: "first", actor: { uuid: "Actor.first" } }],
    ["Token.second", { id: "second", actor: { uuid: "Actor.second" } }]
  ]);
  const targetSets = [];
  globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
  globalThis.game = {
    ...previousGame,
    user: {
      ...(previousGame?.user ?? {}),
      updateTokenTargets: async (ids) => targetSets.push(Array.from(ids).sort())
    }
  };
  try {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      baseLevel: 1,
      system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
    }));
    assert.equal(await service.applyDnd5ePreUseActivity(activity, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: {
        ids: ["twinned-spell"],
        targets: ["Token.first", "Token.second"]
      }
    }, {}, {}), true);
    assert.deepEqual(targetSets, []);
    assert.equal(activity.target?.affects?.count, 1);
    assert.equal(pointsItem(actor).system.uses.spent, 3);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.game = previousGame;
  }
});

test("Empowered rerolls only selected real Die results and updates the real damage message", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["fire:0"] }
  }, {}, {}), true);
  let rerolls = 0;
  let messageUpdate;
  const term = {
    results: [{ result: 1, active: true }],
    async roll(options) {
      rerolls += 1;
      assert.deepEqual(options, { reroll: true });
      this.results.push({ result: 6, active: true });
    }
  };
  const roll = {
    terms: [term],
    _evaluateTotal: () => 6,
    toJSON: () => ({ formula: "1d6", total: 6 }),
    parent: { update: async (patch) => { messageUpdate = patch; } }
  };
  assert.equal(await service.applyDnd5ePostDamageRoll([roll], { subject: activity }), true);
  assert.equal(rerolls, 1);
  assert.equal(term.results[0].rerolled, true);
  assert.equal(term.results[0].active, false);
  assert.deepEqual(messageUpdate, { rolls: [{ formula: "1d6", total: 6 }] });
});

test("Empowered follows the originating dnd5e usage-message record when the damage activity is reloaded", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  const message = {
    id: "usage-card",
    getFlag: (_scope, key) => key === "damageReroll" ? { selectedDamageDice: ["fire:0"] } : undefined
  };
  service.handleDnd5ePostCreateUsageMessage(null, message);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  let rerolls = 0;
  const term = {
    results: [{ result: 1, active: true }],
    async roll() { rerolls += 1; this.results.push({ result: 5, active: true }); }
  };
  const roll = {
    terms: [term],
    _evaluateTotal: () => 5,
    toJSON: () => ({}),
    parent: { flags: { dnd5e: { originatingMessage: "usage-card" } }, update: async () => {} }
  };
  await service.applyDnd5ePostDamageRoll([roll], { subject: activity });
  assert.equal(rerolls, 1);
});

test("forged target and damage-die ids fail before any Sorcery Point payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  globalThis.fromUuid = async () => null;
  try {
    const careful = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { save: { ability: "dex" } } }));
    assert.equal(await service.applyDnd5ePreUseActivity(careful, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: ["careful-spell"], targetUuids: ["Token.forged"] }
    }, {}, {}), false);
    const empowered = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
    }));
    assert.equal(await service.applyDnd5ePreUseActivity(empowered, {
      sorcererVirtualSpellLevel: 1,
      sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["fire:99"] }
    }, {}, {}), false);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
  }
});

test("RED: numeric forged Empowered die ids fail before payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "fire", formula: "1d6" }] } }
  }));
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["empowered-spell"], damageDice: ["999"] }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});

test("RED: save overrides rehydrate from the persisted usage message on a target-owner client", () => {
  const previousGame = globalThis.game;
  const service = new SorcererAutomationService({});
  const message = {
    getFlag: (_scope, key) => key === "saveOverrides"
      ? { carefulTargetUuids: ["Actor.ally"], heightenedTargetUuid: null, heightenedUsed: false }
      : undefined
  };
  globalThis.game = { ...previousGame, messages: { get: (id) => id === "remote-usage" ? message : null } };
  try {
    const config = {
      subject: { uuid: "Actor.ally" },
      event: { target: { closest: () => ({ dataset: { messageId: "remote-usage" } }) } },
      rolls: [{ options: { target: 14 } }]
    };
    service.applyDnd5ePreRollSavingThrow(config);
    assert.equal(config.rolls[0].options.target, 0);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("RED: Subtle removes native dnd5e vocal and somatic item properties on the temporary clone", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: {
      components: { vocal: true, somatic: true, material: true },
      properties: new Set(["vocal", "somatic", "material"])
    }
  }));
  activity.system.properties = new Set(["vocal", "somatic", "material"]);
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["subtle-spell"] }
  }, {}, {}), true);
  assert.deepEqual(activity.components, { vocal: false, somatic: false, material: true });
  assert.deepEqual(activity.system.components, { vocal: false, somatic: false, material: true });
  assert.deepEqual(activity.item.system.components, { vocal: false, somatic: false, material: true });
  assert.deepEqual(Array.from(activity.system.properties).sort(), ["material"]);
  assert.deepEqual(Array.from(activity.item.system.properties).sort(), ["material"]);
});

test("Heightened applies disadvantage to the first save from a persisted usage message", () => {
  const service = new SorcererAutomationService({});
  const message = {
    id: "usage-card",
    getFlag: (_scope, key) => key === "saveOverrides"
      ? {
        carefulTargetUuids: [],
        heightenedTargetUuid: "Actor.enemy",
        heightenedUsed: false
      }
      : undefined
  };
  service.handleDnd5ePostCreateUsageMessage(null, message);

  const firstSave = {
    subject: { uuid: "Actor.enemy" },
    message: { id: "usage-card" },
    rolls: [{ options: {} }]
  };
  assert.equal(service.applyDnd5ePreRollSavingThrow(firstSave), true);
  assert.equal(firstSave.disadvantage, true);
  assert.equal(firstSave.rolls[0].options.disadvantage, true);

  const secondSave = {
    subject: { uuid: "Actor.enemy" },
    message: { id: "usage-card" },
    rolls: [{ options: {} }]
  };
  service.applyDnd5ePreRollSavingThrow(secondSave);
  assert.equal(secondSave.disadvantage, undefined);
});

test("Draconic Dragon Spell adds one d6 damage per selected Sorcery Point", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-dragon-spell", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-spell"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "base-fire", formula: "1d6", types: ["fire"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["draconic-dragon-spell"],
      costs: { "draconic-dragon-spell": 2 }
    }
  }, {}, {}), true);

  const added = activity.damage.parts.find((part) => part._id === "rebreya-draconic-dragon-spell");
  assert.equal(added.formula, "2d6");
  assert.deepEqual(added.types, ["fire"]);
  assert.deepEqual(activity.system.damage.parts.at(-1), added);
  assert.deepEqual(activity.item.system.damage.parts.at(-1), added);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("RED: Draconic Dragon Spell forwards its selected damage dice into the damage roll hook", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-dragon-spell", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-spell"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const messageConfig = {};
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "base-fire", formula: "1d6", types: ["fire"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["draconic-dragon-spell"],
      costs: { "draconic-dragon-spell": 2 }
    }
  }, {}, messageConfig), true);

  const usageMessage = makeCooldownCardMessage({
    id: "draconic-usage",
    content: "",
    flags: messageConfig.data?.flags
  });
  const rollConfig = {
    subject: activity,
    message: usageMessage,
    rolls: []
  };

  assert.equal(service.applyDnd5ePreRollDamage(rollConfig), true);
  assert.equal(rollConfig.rolls.length, 1);
  assert.deepEqual(rollConfig.rolls[0].parts, ["2d6"]);
  assert.deepEqual(rollConfig.rolls[0].options.types, ["fire"]);

  assert.equal(service.applyDnd5ePreRollDamage(rollConfig), true);
  assert.equal(rollConfig.rolls.length, 1);
});

test("RED: Draconic Dragon Spell damage hook resolves the usage card from currentTarget", async () => {
  const previousGame = globalThis.game;
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-dragon-spell", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-spell"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const messageConfig = {};
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "base-fire", formula: "1d6", types: ["fire"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["draconic-dragon-spell"],
      costs: { "draconic-dragon-spell": 2 }
    }
  }, {}, messageConfig), true);

  const usageMessage = makeCooldownCardMessage({
    id: "draconic-usage",
    content: "",
    flags: messageConfig.data?.flags
  });
  globalThis.game = {
    ...previousGame,
    messages: new Map([["draconic-usage", usageMessage]])
  };

  try {
    const rollConfig = {
      subject: activity,
      event: {
        currentTarget: {
          closest: () => ({ dataset: { messageId: "draconic-usage" } })
        }
      },
      rolls: []
    };

    assert.equal(service.applyDnd5ePreRollDamage(rollConfig), true);
    assert.equal(rollConfig.rolls.length, 1);
    assert.deepEqual(rollConfig.rolls[0].parts, ["2d6"]);
    assert.deepEqual(rollConfig.rolls[0].options.types, ["fire"]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("Draconic Ancestral Spell changes this cast's spell damage to the ancestor type", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-ancestral-spell", 1, "base", {
    metamagicAutomation: "draconic-ancestral-spell"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: {
      damage: {
        parts: [
          { _id: "cold-part", formula: "1d8", types: ["cold"] },
          ["1d6", "acid"]
        ]
      }
    }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["draconic-ancestral-spell"] }
  }, {}, {}), true);

  assert.deepEqual(activity.damage.parts.map((part) => Array.isArray(part) ? part[1] : part.types[0]), ["fire", "fire"]);
  assert.deepEqual(activity.system.damage.parts.map((part) => Array.isArray(part) ? part[1] : part.types[0]), ["fire", "fire"]);
  assert.deepEqual(activity.item.system.damage.parts.map((part) => Array.isArray(part) ? part[1] : part.types[0]), ["fire", "fire"]);
  assert.equal(pointsItem(actor).system.uses.spent, 3);
});

test("Elemental Affinity adds Charisma modifier once to matching draconic spell damage", async () => {
  const actor = metamagicActor();
  actor.system.abilities.cha.mod = 4;
  addDraconicAncestor(actor, "Огонь");
  addSubclassFeature(actor, "Родство со стихией", "draconic-elemental-affinity");
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const messageConfig = {};
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "base-fire", formula: "2d6", types: ["fire"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1
  }, {}, messageConfig), true);

  const added = activity.damage.parts.find((part) => part._id === "rebreya-draconic-elemental-affinity");
  assert.equal(added.formula, "4");
  assert.deepEqual(added.types, ["fire"]);
  assert.equal(messageConfig.data.flags[MODULE_ID].damageBonus.source, "draconic-elemental-affinity");
  assert.equal(pointsItem(actor).system.uses.spent, 2);
});

test("Elemental Affinity ignores spells that do not match the draconic damage type", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addSubclassFeature(actor, "Родство со стихией", "draconic-elemental-affinity");
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "base-cold", formula: "2d6", types: ["cold"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1
  }, {}, {}), true);

  assert.equal(activity.damage.parts.some((part) => part._id === "rebreya-draconic-elemental-affinity"), false);
});

test("Draconic Dragon Protection creates a temporary resistance effect with its Sorcery Point cost", async () => {
  const actor = metamagicActor();
  addMetamagic(actor, "draconic-dragon-protection", 1, "base", {
    metamagicAutomation: "draconic-dragon-protection"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "acid-part", formula: "2d6", types: ["acid"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["draconic-dragon-protection"] }
  }, {}, {}), true);

  assert.equal(pointsItem(actor).system.uses.spent, 3);
  assert.equal(actor.createdEffects.length, 1);
  const effect = actor.createdEffects[0].rows[0];
  const resistance = effect.changes.find((change) => change.key === "system.traits.dr.value");
  assert.equal(resistance.mode, 2);
  assert.equal(resistance.value, "acid");
  assert.deepEqual(effect.flags.dae.specialDuration, ["turnStartSource", "combatEnd"]);
  assert.equal(effect.flags[MODULE_ID].sorcererAutomation.kind, "draconicDragonProtection");
});

test("Draconic Dragon Protection rejects spell damage outside its elemental list before payment", async () => {
  const actor = metamagicActor();
  addMetamagic(actor, "draconic-dragon-protection", 1, "base", {
    metamagicAutomation: "draconic-dragon-protection"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "force-part", formula: "1d10", types: ["force"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["draconic-dragon-protection"] }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(actor.createdEffects.length, 0);
});

test("Draconic Dragon Spell requires spell damage matching the dragon ancestor before payment", async () => {
  const actor = metamagicActor();
  addDraconicAncestor(actor, "Огонь");
  addMetamagic(actor, "draconic-dragon-spell", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-spell"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: { damage: { parts: [{ _id: "cold-part", formula: "1d8", types: ["cold"] }] } }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["draconic-dragon-spell"],
      costs: { "draconic-dragon-spell": 2 }
    }
  }, {}, {}), false);
  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(activity.damage.parts.some((part) => part._id === "rebreya-draconic-dragon-spell"), false);
});

test("Draconic Dragon Wing creates temporary flight equal to ten feet per selected Sorcery Point", async () => {
  const actor = metamagicActor();
  addMetamagic(actor, "draconic-dragon-wing", 3, "base", {
    costMode: "variable",
    minCost: 1,
    maxCost: 3,
    metamagicAutomation: "draconic-dragon-wing"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: {
      ids: ["draconic-dragon-wing"],
      costs: { "draconic-dragon-wing": 2 }
    }
  }, {}, {}), true);

  assert.equal(pointsItem(actor).system.uses.spent, 4);
  assert.equal(actor.createdEffects.length, 1);
  const effect = actor.createdEffects[0].rows[0];
  const flight = effect.changes.find((change) => change.key === "system.attributes.movement.fly");
  assert.equal(flight.mode, 4);
  assert.equal(flight.value, "20");
  assert.deepEqual(effect.flags.dae.specialDuration, ["turnEndSource", "combatEnd"]);
  assert.equal(effect.flags[MODULE_ID].sorcererAutomation.kind, "draconicDragonWing");
});

test("Mana Storm grants temporary hit points and creates a delayed damage marker", async () => {
  const actor = metamagicActor(5);
  actor.system.attributes.hp = { temp: 1 };
  addMetamagic(actor, "advanced-mana-storm", 2, "base", {
    metamagicAutomation: "advanced-mana-storm"
  });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { baseLevel: 3 }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 3,
    sorcererMetamagic: { ids: ["advanced-mana-storm"] }
  }, {}, {}), true);

  assert.equal(pointsItem(actor).system.uses.spent, 7);
  assert.equal(actor.system.attributes.hp.temp, 3);
  assert.equal(actor.createdEffects.length, 1);
  const effect = actor.createdEffects[0].rows[0];
  assert.deepEqual(effect.flags.dae.specialDuration, ["combatEnd"]);
  assert.deepEqual(effect.flags[MODULE_ID].sorcererAutomation, {
    kind: "advancedManaStorm",
    radius: 10,
    damage: 3,
    damageType: "force"
  });
});

test("Transcendence discounted metamagic costs one less and can stack with any other option", async () => {
  const actor = metamagicActor();
  addSubclassFeature(actor, "РўСЂР°РЅСЃС†РµРЅРґРµРЅС‚РЅРѕСЃС‚СЊ", "sorcerer-transcendence");
  addMetamagic(actor, "quickened-spell", 2, "base");
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
    system: {
      activation: { type: "action", value: 1 },
      components: { vocal: true, somatic: true, material: false }
    }
  }));

  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["quickened-spell", "subtle-spell"] }
  }, {}, {}), true);

  assert.equal(pointsItem(actor).system.uses.spent, 4);
  assert.deepEqual(activity.activation, { type: "bonus", value: 1 });
  assert.deepEqual(activity.components, { vocal: false, somatic: false, material: false });
  assert.deepEqual(activity.item.system.components, { vocal: false, somatic: false, material: false });
});

test("Subtle usage message names metamagic and replaces V/S component pills", async () => {
  const service = new SorcererAutomationService({});
  let messageUpdate = null;
  const message = {
    id: "usage-card",
    content: `<div class="dnd5e-card"><ul class="card-footer pills unlist"><li>В, С, М</li><li>ДЕЙСТВИЕ</li></ul></div>`,
    getFlag: (_scope, key) => key === "spellCast"
      ? {
        components: { verbal: false, somatic: false, material: true },
        metamagic: [{ id: "subtle-spell", name: "Неуловимое заклинание", cost: 1 }]
      }
      : undefined,
    async update(patch) {
      messageUpdate = patch;
      this.content = patch.content ?? this.content;
      return this;
    }
  };

  assert.equal(service.handleDnd5ePostCreateUsageMessage(null, message), true);
  await waitForDeferredActivityUse();
  assert.ok(messageUpdate?.content.includes("Метамагия: Неуловимое заклинание"));
  assert.ok(messageUpdate.content.includes("<li>М</li>"));
  assert.doesNotMatch(messageUpdate.content, /В, С, М/u);
});

test("RED: Seeking reroll retains dnd5e's originating usage-message reference", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({ chooseSeekingReroll: async () => true });
  await service.syncSorceryPoints(actor);
  const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { attack: { type: "spell" } } }));
  let messageConfig;
  activity.rollAttack = async (_config, _dialog, message) => { messageConfig = message; return [{ total: 18 }]; };
  assert.equal(await service.applyDnd5ePreUseActivity(activity, {
    sorcererVirtualSpellLevel: 1,
    sorcererMetamagic: { ids: ["seeking-spell"] }
  }, {}, {}), true);
  await service.applyDnd5ePostAttackRoll([{ isFailure: true, parent: { flags: { dnd5e: { originatingMessage: "usage-card" } } } }], {
    subject: activity,
    ammoUpdate: null
  });
  assert.equal(messageConfig.data["flags.dnd5e.originatingMessage"], "usage-card");
});

test("RED: simultaneous virtual casts serialize Sorcery Point payment for one actor", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const first = makeDnd5eActivityClone(makeSorcererSpell(actor, { id: "first" }));
  const second = makeDnd5eActivityClone(makeSorcererSpell(actor, { id: "second" }));
  const results = await Promise.all([
    service.applyDnd5ePreUseActivity(first, {}, {}, {}),
    service.applyDnd5ePreUseActivity(second, {}, {}, {})
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(pointsItem(actor).system.uses.spent, 4);
});

test("RED: a canceled final cast holds its actor payment lock through rollback", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 })
  });
  await service.syncSorceryPoints(actor);
  let releaseFirstFinal;
  const firstFinal = new Promise((resolve) => { releaseFirstFinal = resolve; });
  let firstFinalStarted;
  const firstStarted = new Promise((resolve) => { firstFinalStarted = resolve; });
  let secondFinalStarted;
  const secondStarted = new Promise((resolve) => { secondFinalStarted = resolve; });
  const makeDeferredActivity = (id, finalUse) => {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, { id }));
    let calls = 0;
    let preflight;
    activity.use = async (usageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflight = usageConfig;
        return { updates: [] };
      }
      return finalUse();
    };
    return { activity, preflight: () => preflight };
  };
  const first = makeDeferredActivity("first-final", async () => {
    firstFinalStarted();
    return firstFinal;
  });
  const second = makeDeferredActivity("second-final", async () => {
    secondFinalStarted();
    return { updates: [] };
  });

  assert.equal(service.deferDnd5ePreUseActivity(first.activity, {}, {}, {}), false);
  assert.equal(service.deferDnd5ePreUseActivity(second.activity, {}, {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(service.finalizeDnd5ePreUseActivity(first.activity, completeReactionCheck(first.preflight()), {}, {}), false);
  await firstStarted;
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(service.finalizeDnd5ePreUseActivity(second.activity, completeReactionCheck(second.preflight()), {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(pointsItem(actor).system.uses.spent, 2);

  releaseFirstFinal(undefined);
  await secondStarted;
  await waitForDeferredActivityUse();
  assert.equal(pointsItem(actor).system.uses.spent, 2);
});

test("deferred Distant plan keeps one resolved range across every temporary activity clone", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 }),
    chooseMetamagic: async () => ({ accepted: true, ids: ["distant-spell"] })
  });
  await service.syncSorceryPoints(actor);
  const initial = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 60, units: "ft" } } }));
  const resumed = [];
  initial.use = async (usageConfig) => { resumed.push(usageConfig); return { updates: [] }; };
  assert.equal(service.deferDnd5ePreUseActivity(initial, {}, {}, {}), false);
  await waitForDeferredActivityUse();
  const preflight = resumed[0];
  const firstClone = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 60, units: "ft" } } }));
  const secondClone = makeDnd5eActivityClone(makeSorcererSpell(actor, { system: { range: { value: 120, units: "ft" } } }));
  assert.equal(service.deferDnd5ePreUseActivity(firstClone, preflight, {}, {}), true);
  assert.equal(service.deferDnd5ePreUseActivity(secondClone, preflight, {}, {}), true);
  assert.deepEqual(firstClone.range, { value: 120, units: "ft" });
  assert.deepEqual(secondClone.range, { value: 120, units: "ft" });
});

test("failed final Twinned cast leaves the native target selection alone while rolling back Sorcery Points", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({ accepted: true, spellLevel: 1 }),
    chooseMetamagic: async () => ({
      accepted: true,
      ids: ["twinned-spell"],
      targets: ["Token.first", "Token.second"]
    })
  });
  await service.syncSorceryPoints(actor);
  const previousFromUuid = globalThis.fromUuid;
  const previousGame = globalThis.game;
  const targetSets = [];
  globalThis.fromUuid = async (uuid) => ({
    id: uuid === "Token.first" ? "first" : "second",
    actor: { uuid: uuid === "Token.first" ? "Actor.first" : "Actor.second" }
  });
  globalThis.game = {
    ...previousGame,
    user: {
      ...(previousGame?.user ?? {}),
      targets: new Set([{ id: "original" }]),
      updateTokenTargets: async (ids) => targetSets.push(Array.from(ids).sort())
    }
  };
  try {
    const activity = makeDnd5eActivityClone(makeSorcererSpell(actor, {
      system: { range: { value: 60, units: "ft" }, target: { affects: { count: 1 } } }
    }));
    let preflight;
    let calls = 0;
    activity.use = async (usageConfig) => {
      calls += 1;
      if (calls === 1) {
        preflight = usageConfig;
        return { updates: [] };
      }
      return undefined;
    };
    assert.equal(service.deferDnd5ePreUseActivity(activity, {}, {}, {}), false);
    await waitForDeferredActivityUse();
    assert.equal(service.finalizeDnd5ePreUseActivity(activity, completeReactionCheck(preflight), {}, {}), false);
    await waitForDeferredActivityUse();
    assert.deepEqual(targetSets, []);
    assert.equal(pointsItem(actor).system.uses.spent, 0);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    globalThis.game = previousGame;
  }
});
