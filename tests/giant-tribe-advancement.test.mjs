import test from "node:test";
import assert from "node:assert/strict";

function clone(value) {
  return structuredClone(value);
}

function setProperty(object, path, value) {
  const keys = String(path).split(".");
  let cursor = object;
  while (keys.length > 1) {
    const key = keys.shift();
    cursor[key] ??= {};
    cursor = cursor[key];
  }
  cursor[keys[0]] = value;
  return true;
}

globalThis.foundry ??= { utils: {} };
Object.assign(globalThis.foundry.utils, {
  deepClone: clone,
  getProperty: (object, path) => String(path).split(".").reduce((value, key) => value?.[key], object),
  setProperty,
  mergeObject: (original, other, { inplace = true } = {}) => {
    const target = inplace ? original : clone(original);
    for (const [key, value] of Object.entries(other)) {
      if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set)) {
        target[key] = globalThis.foundry.utils.mergeObject(target[key] ?? {}, value, { inplace: true });
      }
      else target[key] = value;
    }
    return target;
  }
});

globalThis.Actor ??= class Actor {};
globalThis.Item ??= class Item {};

class AdvancementError extends Error {}

class FakeSizeAdvancement {
  static ERROR = AdvancementError;

  static get metadata() {
    return {
      order: 25,
      apps: {},
      title: "Размер",
      hint: ""
    };
  }

  constructor({ actor, item = { type: "race" }, configuration, value = {} } = {}) {
    this.actor = actor;
    this.item = item;
    this.configuration = configuration ?? { sizes: new Set(["hill", "stone", "frost", "fire", "cloud", "storm"]) };
    this.value = clone(value);
    this.title = "Великанье племя";
    this.hint = "Выберите одно племя.";
  }

  updateSource(patch) {
    for (const [path, value] of Object.entries(patch)) setProperty(this, path, value);
  }
}

class FakeAdvancementFlow {
  static get defaultOptions() {
    return { template: "base.hbs", popOut: false };
  }

  constructor(advancement) {
    this.advancement = advancement;
    this.level = 0;
    this.retainedData = null;
  }

  getData() {
    return { title: this.advancement.title, hint: this.advancement.hint };
  }
}

const {
  GIANT_TRIBE_CHOICES,
  createGiantTribeAdvancementClasses,
  registerGiantTribeAdvancement
} = await import("../scripts/integrations/giant-tribe-advancement.js");

function giantTribeFeature({ tribe = null, effects = [], activities = {} } = {}) {
  return {
    _id: "giant-tribe-item",
    id: "giant-tribe-item",
    name: "Великанье племя",
    type: "feat",
    flags: {
      "rebreya-main": {
        sourceType: "raceFeature",
        raceId: "полувеликаны",
        abilityId: "полувеликаны-ability-3",
        ...(tribe ? { raceAutomation: { giantTribe: tribe } } : {})
      }
    },
    effects: clone(effects),
    system: { activities: clone(activities) }
  };
}

function testActor(items) {
  const contents = items.map(clone);
  return {
    items: {
      find: (predicate) => contents.find(predicate),
      delete: (id) => {
        const index = contents.findIndex((item) => (item.id ?? item._id) === id);
        if (index >= 0) contents.splice(index, 1);
      },
      get contents() {
        return contents;
      }
    },
    updateSource(patch) {
      for (const item of patch.items ?? []) contents.push(clone(item));
    }
  };
}

test("Giant Tribe flow exposes exactly six choices and restores the selected value", () => {
  const { GiantTribeAdvancement, GiantTribeFlow } = createGiantTribeAdvancementClasses({
    SizeAdvancement: FakeSizeAdvancement,
    AdvancementFlow: FakeAdvancementFlow
  });
  const advancement = new GiantTribeAdvancement({ value: { size: "frost" } });
  const flow = new GiantTribeFlow(advancement);
  const data = flow.getData();

  assert.deepEqual(data.choices, {
    hill: "Холмовой великан",
    stone: "Каменный великан",
    frost: "Ледяной великан",
    fire: "Огненный великан",
    cloud: "Облачный великан",
    storm: "Штормовой великан"
  });
  assert.deepEqual(data.choices, GIANT_TRIBE_CHOICES);
  assert.equal(data.selectedTribe, "frost");
  assert.equal(GiantTribeFlow.defaultOptions.template, "modules/rebreya-main/templates/advancement/giant-tribe-flow.hbs");
});

test("Giant Tribe advancement configures the granted feature without replacing its id", async () => {
  const { GiantTribeAdvancement } = createGiantTribeAdvancementClasses({
    SizeAdvancement: FakeSizeAdvancement,
    AdvancementFlow: FakeAdvancementFlow
  });
  const actor = testActor([giantTribeFeature()]);
  const advancement = new GiantTribeAdvancement({ actor });

  await advancement.apply(0, { size: "frost" });

  assert.equal(actor.items.contents.length, 1);
  assert.equal(actor.items.contents[0]._id, "giant-tribe-item");
  assert.equal(actor.items.contents[0].name, "Великанье племя (Ледяной великан)");
  assert.equal(actor.items.contents[0].effects[0].changes[0].key, "system.traits.dr.value");
  assert.equal(advancement.value.size, "frost");
  assert.equal(advancement.automaticApplicationValue(), false);
});

test("switching Giant Tribe replaces managed automation but preserves user data", async () => {
  const { GiantTribeAdvancement } = createGiantTribeAdvancementClasses({
    SizeAdvancement: FakeSizeAdvancement,
    AdvancementFlow: FakeAdvancementFlow
  });
  const customEffect = { _id: "custom-effect", name: "Пользовательский эффект", flags: {}, changes: [] };
  const customActivity = { _id: "custom-activity", name: "Пользовательская активность", flags: {} };
  const storm = giantTribeFeature({
    tribe: "storm",
    effects: [customEffect],
    activities: { "custom-activity": customActivity }
  });
  const actor = testActor([storm]);
  const advancement = new GiantTribeAdvancement({ actor, value: { size: "storm" } });

  await advancement.apply(0, { size: "cloud" });

  const configured = actor.items.contents[0];
  assert.equal(configured._id, "giant-tribe-item");
  assert.deepEqual(configured.effects.map((effect) => effect.name), [
    "Пользовательский эффект",
    "Облачный великан: Обман",
    "Облачный великан: Убеждение"
  ]);
  assert.deepEqual(Object.values(configured.system.activities).map((activity) => activity.name), [
    "Пользовательская активность"
  ]);
  assert.equal(advancement.value.size, "cloud");
});

test("Giant Tribe advancement rejects empty, unknown, and missing-feature applications", async () => {
  const { GiantTribeAdvancement } = createGiantTribeAdvancementClasses({
    SizeAdvancement: FakeSizeAdvancement,
    AdvancementFlow: FakeAdvancementFlow
  });
  const advancement = new GiantTribeAdvancement({ actor: testActor([giantTribeFeature()]) });

  await assert.rejects(() => advancement.apply(0, {}), AdvancementError);
  await assert.rejects(() => advancement.apply(0, { size: "random" }), AdvancementError);
  await assert.rejects(
    () => new GiantTribeAdvancement({ actor: testActor([]) }).apply(0, { size: "hill" }),
    /Не найдена черта/u
  );
});

test("Giant Tribe reversal clears only the advancement value", async () => {
  const { GiantTribeAdvancement } = createGiantTribeAdvancementClasses({
    SizeAdvancement: FakeSizeAdvancement,
    AdvancementFlow: FakeAdvancementFlow
  });
  const actor = testActor([giantTribeFeature({ tribe: "fire" })]);
  const advancement = new GiantTribeAdvancement({ actor, value: { size: "fire" } });

  assert.deepEqual(await advancement.reverse(0), { size: "fire" });
  assert.equal(advancement.value.size, null);
  assert.equal(actor.items.contents.length, 1);
});

test("registration publishes one hidden race-only GiantTribe advancement type", () => {
  globalThis.CONFIG = { DND5E: { advancementTypes: {} } };
  globalThis.game = {
    i18n: { localize: (value) => value },
    dnd5e: {
      documents: { advancement: { SizeAdvancement: FakeSizeAdvancement } },
      applications: { advancement: { AdvancementFlow: FakeAdvancementFlow } }
    }
  };

  assert.equal(registerGiantTribeAdvancement(), true);
  const registration = CONFIG.DND5E.advancementTypes.GiantTribe;
  assert.ok(registration.documentClass);
  assert.equal(registration.validItemTypes.has("race"), true);
  assert.equal(registration.validItemTypes.size, 1);
  assert.equal(registration.hidden, true);
  assert.equal(registration.documentClass.metadata.order, 45);
});
