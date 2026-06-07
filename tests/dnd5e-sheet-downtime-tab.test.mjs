import test from "node:test";
import assert from "node:assert/strict";

function installSheetExtensionStubs() {
  const previousActor = globalThis.Actor;
  const previousItem = globalThis.Item;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  const previousHooks = globalThis.Hooks;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;
  const previousDnd5e = globalThis.dnd5e;
  const previousFromUuid = globalThis.fromUuid;

  class FakeActor {}
  class FakeItem {}
  class FakeHTMLElement {
    constructor({ dataset = {}, selectors = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectors = selectors;
      this.selectorAll = selectorAll;
      this.listeners = {};
      this.listenerOptions = {};
      this.value = "";
      this.children = [];
    }

    querySelector(selector) {
      return this.selectors[selector] ?? null;
    }

    querySelectorAll(selector) {
      return this.selectorAll[selector] ?? [];
    }

    addEventListener(type, listener, options) {
      this.listeners[type] ??= [];
      this.listeners[type].push(listener);
      this.listenerOptions[type] ??= [];
      this.listenerOptions[type].push(options);
    }

    contains(target) {
      return target === this || this.children.includes(target);
    }

    closest() {
      return null;
    }

    remove() {
      this.removed = true;
    }
  }

  class CharacterActorSheet {
    static TABS = [
      { tab: "inventory", label: "Inventory" },
      { tab: "specialTraits", label: "Special Traits" }
    ];

    static PARTS = {
      inventory: {
        template: "inventory.hbs"
      }
    };

    constructor(actor) {
      this.actor = actor;
      this.tabGroups = {
        primary: "downtime"
      };
    }

    async _preparePartContext(partId, context, _options) {
      return {
        ...context,
        preparedPartId: partId
      };
    }
  }

  const hooks = new Map();
  const fakeDocument = new FakeHTMLElement();
  fakeDocument.documentElement = new FakeHTMLElement();
  globalThis.Actor = FakeActor;
  globalThis.Item = FakeItem;
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.document = fakeDocument;
  globalThis.game = {
    system: {
      id: "dnd5e"
    },
    dnd5e: {
      applications: {
        actor: {
          CharacterActorSheet
        }
      }
    },
    i18n: {
      localize: (key) => key
    }
  };
  globalThis.CONFIG = {
    DND5E: {},
    ux: {},
    Dice: {}
  };
  globalThis.Hooks = {
    on(name, listener) {
      hooks.set(name, listener);
    }
  };
  globalThis.window = {
    setTimeout() {
      return 0;
    }
  };
  globalThis.ui = {
    windows: {},
    notifications: {
      info() {},
      error() {}
    }
  };
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      },
      mergeObject(original, other, { inplace = true } = {}) {
        const target = inplace ? original : { ...(original ?? {}) };
        return Object.assign(target, other ?? {});
      },
      getProperty(source, path) {
        return String(path ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), source);
      },
      hasProperty(source, path) {
        return this.getProperty(source, path) !== undefined;
      }
    }
  };

  return {
    Actor: FakeActor,
    HTMLElement: FakeHTMLElement,
    CharacterActorSheet,
    document: fakeDocument,
    hooks,
    restore() {
      globalThis.Actor = previousActor;
      globalThis.Item = previousItem;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.game = previousGame;
      globalThis.CONFIG = previousConfig;
      globalThis.Hooks = previousHooks;
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.ui = previousUi;
      globalThis.foundry = previousFoundry;
      globalThis.dnd5e = previousDnd5e;
      globalThis.fromUuid = previousFromUuid;
    }
  };
}

function createActor(ActorClass, { id = "actor-a", name = "Hero" } = {}) {
  return new class extends ActorClass {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = "character";
      this.items = [];
      this.system = {};
    }
  }();
}

test("registerDnd5eSheetExtensions registers hero doll and downtime character sheet parts", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-tabs=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const moduleApi = {
      heroDollService: {
        getActorSnapshot(targetActor) {
          calls.push(["heroDoll", targetActor.id]);
          return { actorId: targetActor.id, slots: [] };
        }
      },
      characterDowntimeService: {
        getActorContext(targetActor) {
          calls.push(["downtime", targetActor.id]);
          return { actorId: targetActor.id, hasGroup: true };
        }
      },
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);

    assert.deepEqual(
      stubs.CharacterActorSheet.TABS.map((tab) => tab.tab),
      ["inventory", "heroDoll", "downtime", "specialTraits"]
    );
    assert.match(stubs.CharacterActorSheet.PARTS.heroDoll.template, /hero-doll-tab\.hbs$/u);
    assert.match(stubs.CharacterActorSheet.PARTS.downtime.template, /character-downtime-tab\.hbs$/u);

    const sheet = new stubs.CharacterActorSheet(actor);
    const heroContext = await sheet._preparePartContext("heroDoll", { base: true }, {});
    const downtimeContext = await sheet._preparePartContext("downtime", { base: true }, {});

    assert.equal(heroContext.heroDoll.actorId, "actor-a");
    assert.equal(downtimeContext.characterDowntime.actorId, "actor-a");
    assert.deepEqual(calls, [
      ["heroDoll", "actor-a"],
      ["downtime", "actor-a"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("extendDnd5eItemTypes registers the Rebreya downtime item type", async () => {
  const stubs = installSheetExtensionStubs();
  const warningCalls = [];
  const previousConsoleWarn = console.warn;
  console.warn = (...args) => warningCalls.push(args);
  globalThis.game.modules = new Map([
    ["rebreya-main", {
      documentTypes: {
        Item: {
          state: {},
          downtime: {}
        }
      }
    }]
  ]);
  globalThis.CONFIG.Item = {
    dataModels: {
      background: class BackgroundData {
        static metadata = {};
      }
    },
    typeLabels: {},
    typeIcons: {}
  };

  try {
    const { extendDnd5eItemTypes } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-item-type=${Date.now()}`);

    extendDnd5eItemTypes();

    assert.equal(globalThis.CONFIG.Item.typeLabels["rebreya-main.downtime"], "TYPES.Item.rebreya-main.downtime");
    assert.equal(globalThis.CONFIG.Item.typeLabels["rebreya-main.downtimePl"], "TYPES.Item.rebreya-main.downtimePl");
    assert.equal(globalThis.CONFIG.Item.typeIcons["rebreya-main.downtime"], "fa-solid fa-hourglass-half");
    assert.equal(typeof globalThis.CONFIG.Item.dataModels["rebreya-main.downtime"], "function");
    assert.equal(warningCalls.some((args) => String(args[0]).includes("downtime")), false);
  }
  finally {
    console.warn = previousConsoleWarn;
    stubs.restore();
  }
});

test("selectDowntimeTemplateDocumentWithBrowser locks native dnd5e browser to downtime items", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const calls = [];
    globalThis.dnd5e = {
      applications: {
        CompendiumBrowser: {
          MODES: {
            ADVANCED: "advanced"
          },
          async selectOne(options) {
            calls.push(options);
            return "Compendium.world.rebreya-downtime.Item.gambling";
          }
        }
      }
    };
    globalThis.fromUuid = async (uuid) => ({
      uuid,
      type: "rebreya-main.downtime",
      name: "Gambling"
    });

    const { selectDowntimeTemplateDocumentWithBrowser } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-browser=${Date.now()}`);
    const document = await selectDowntimeTemplateDocumentWithBrowser();

    assert.equal(document.name, "Gambling");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, "advanced");
    assert.equal(calls[0].tab, "items");
    assert.equal(calls[0].filters.locked.documentClass, "Item");
    assert.deepEqual([...calls[0].filters.locked.types], ["rebreya-main.downtime"]);
  }
  finally {
    stubs.restore();
  }
});

test("selectDowntimeTemplateDocumentWithBrowser rejects non-downtime browser results", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    globalThis.dnd5e = {
      applications: {
        CompendiumBrowser: {
          MODES: {
            ADVANCED: "advanced"
          },
          async selectOne() {
            return "Compendium.world.rebreya-downtime.Item.feat";
          }
        }
      }
    };
    globalThis.fromUuid = async (uuid) => ({
      uuid,
      type: "feat",
      name: "Not Downtime"
    });

    const { selectDowntimeTemplateDocumentWithBrowser } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-browser-reject=${Date.now()}`);
    const document = await selectDowntimeTemplateDocumentWithBrowser();

    assert.equal(document, null);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime render hook submits requests for the current sheet actor", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const resourceChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "carousing-resources"
      }
    });
    resourceChoice.value = "wealthy";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "research" },
        "[data-action='character-downtime-weeks']": { value: "2" },
        "[data-action='character-downtime-title']": { value: "Найти наставника" },
        "[data-action='character-downtime-description']": { value: "Спросить в архиве" },
        "[data-action='character-downtime-submit']": submitButton
      },
      selectorAll: {
        "[data-action='character-downtime-resource-choice']": [resourceChoice]
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.ok(root.listeners.click.length >= 1);
    assert.ok(root.listenerOptions.click.some((options) => options?.capture === true));
    for (const listener of root.listeners.click) {
      await listener({ target: submitButton });
    }

    assert.deepEqual(calls, [
      ["createRequest", "actor-a", {
        actionId: "research",
        weeks: 2,
        title: "Найти наставника",
        description: "Спросить в архиве",
        targetActionSelections: [{
          actionId: "carousing-resources",
          choiceId: "wealthy"
        }]
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit reads structured target action controls", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-submit-structured=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const itemChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-item",
        itemUuid: "Compendium.world.rebreya-magic-items.Item.wand",
        itemId: "wand",
        itemName: "Жезл огня",
        itemType: "loot",
        itemSourceType: "magicItem",
        itemRarity: "rare",
        itemPriceGold: "1200"
      }
    });
    const optionChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-trade-step"
      }
    });
    optionChoice.value = "good";
    const numericInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-search-step"
      }
    });
    numericInput.value = "-1";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "magic-item-purchase" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      },
      selectorAll: {
        "[data-action='character-downtime-item-choice']": [itemChoice],
        "[data-action='character-downtime-option-choice']": [optionChoice],
        "[data-action='character-downtime-numeric-input']": [numericInput]
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({ target: submitButton });
    }

    assert.deepEqual(calls.find((call) => call[0] === "createRequest"), [
      "createRequest",
      "actor-a",
      {
        actionId: "magic-item-purchase",
        weeks: 1,
        title: "",
        description: "",
        targetActionSelections: [{
          actionId: "magic-item-purchase-item",
          item: {
            uuid: "Compendium.world.rebreya-magic-items.Item.wand",
            id: "wand",
            name: "Жезл огня",
            type: "loot",
            sourceType: "magicItem",
            rarity: "rare",
            priceGold: 1200
          }
        }, {
          actionId: "magic-item-purchase-trade-step",
          optionId: "good"
        }, {
          actionId: "magic-item-purchase-search-step",
          value: -1
        }]
      }
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime roll buttons roll formula DC before recording success", async () => {
  const stubs = installSheetExtensionStubs();
  const previousRoll = globalThis.Roll;
  try {
    globalThis.Roll = class FakeRoll {
      constructor(formula) {
        this.formula = formula;
        this.total = formula === "5+2d10" ? 17 : 0;
      }

      async evaluate() {
        return this;
      }
    };

    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-roll-dc-formula=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollSkill = async (config) => {
      calls.push(["rollSkill", config]);
      return { total: 18 };
    };

    const rollButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-roll",
        requestId: "downtime-1",
        checkId: "gambling-insight",
        groupId: "group-a",
        sourceType: "skill",
        ability: "wis",
        target: "ins",
        targetLabel: "Проницательность",
        outcomeMode: "dc",
        dc: "0",
        dcFormula: "5+2d10"
      }
    });
    const panel = new stubs.HTMLElement();
    rollButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-roll']") return rollButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(rollButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result, options) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result, options]);
        return { id: requestId, actorId: "actor-a" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({
        target: rollButton,
        preventDefault() {},
        stopPropagation() {}
      });
    }

    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), [[
      "recordDowntimeCheckResult",
      "downtime-1",
      "gambling-insight",
      {
        total: 18,
        outcomeMode: "dc",
        dc: 17,
        dcFormula: "5+2d10",
        success: true,
        sourceType: "skill",
        ability: "wis",
        target: "ins",
        targetLabel: "Проницательность"
      },
      {
        actorId: "actor-a",
        groupId: "group-a"
      }
    ]]);
  }
  finally {
    globalThis.Roll = previousRoll;
    stubs.restore();
  }
});

test("character downtime submit works when the downtime tab is rendered lazily", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-lazy-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "research" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {}
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.ok(root.listeners.click.length >= 1);
    assert.ok(root.listenerOptions.click.some((options) => options?.capture === true));
    for (const listener of root.listeners.click) {
      await listener({ target: submitButton });
    }

    assert.deepEqual(calls, [
      ["createRequest", "actor-a", {
        actionId: "research",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime disabled submit is ignored before creating a request", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-disabled-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    submitButton.disabled = true;
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "research" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    let prevented = false;
    let stopped = false;
    for (const listener of root.listeners.click) {
      await listener({
        target: submitButton,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {
          stopped = true;
        }
      });
    }

    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.deepEqual(calls, []);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit immediately rolls single target checks", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-submit-auto-roll=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollSkill = async (config) => {
      calls.push(["rollSkill", config]);
      return { total: 21 };
    };

    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "Compendium.world.rebreya-downtime.Item.gambling" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return {
            id: "downtime-1",
            actorId: targetActor.id,
            checks: [{
              id: "check-1",
              actionType: "check",
              sourceType: "skill",
              ability: "dex",
              target: "acr",
              targetLabel: "Акробатика",
              outcomeMode: "freeform",
              dc: 0
            }]
          };
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result, options) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result, options]);
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({
        target: submitButton,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    assert.deepEqual(calls.filter((call) => call[0] === "rollSkill"), [[
      "rollSkill",
      {
        event: undefined,
        skill: "acr",
        ability: "dex"
      }
    ]]);
    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), [[
      "recordDowntimeCheckResult",
      "downtime-1",
      "check-1",
      {
        total: 21,
        outcomeMode: "freeform",
        sourceType: "skill",
        ability: "dex",
        target: "acr",
        targetLabel: "Акробатика"
      },
      {
        actorId: "actor-a",
        groupId: ""
      }
    ]]);
    assert.deepEqual(calls.filter((call) => call[0] === "render"), [["render", { force: true }]]);
    assert.deepEqual(calls.filter((call) => call[0] === "refreshOpenApps"), [["refreshOpenApps"]]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime document fallback lets sheet root handle unresolved clicks", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-root-after-document=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "unique" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    stubs.document.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };
    const event = {
      target: submitButton,
      preventDefault() {
        calls.push(["preventDefault"]);
      },
      stopPropagation() {
        calls.push(["stopPropagation"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.ok(stubs.document.listeners.click.length >= 1);
    assert.ok(root.listeners.click.length >= 1);
    for (const listener of stubs.document.listeners.click) {
      await listener(event);
    }
    for (const listener of root.listeners.click) {
      await listener(event);
    }

    assert.deepEqual(calls, [
      ["preventDefault"],
      ["stopPropagation"],
      ["createRequest", "actor-a", {
        actionId: "unique",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit handles pointerup before sheet click handlers can swallow it", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-pointer-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "unique" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.ok(root.listeners.pointerup.length >= 1);
    assert.ok(root.listenerOptions.pointerup.some((options) => options?.capture === true));
    for (const listener of root.listeners.pointerup) {
      await listener({
        type: "pointerup",
        target: submitButton,
        button: 0,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    assert.deepEqual(calls, [
      ["preventDefault"],
      ["stopPropagation"],
      ["createRequest", "actor-a", {
        actionId: "unique",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit button is also bound directly when the panel exists", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-direct-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "unique" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(submitButton.dataset.rebreyaCharacterDowntimeSubmitButtonBound, "true");
    assert.ok(submitButton.listeners.pointerup.length >= 1);
    assert.ok(submitButton.listenerOptions.pointerup.some((options) => options?.capture === true));
    for (const listener of submitButton.listeners.pointerup) {
      await listener({
        type: "pointerup",
        target: submitButton,
        button: 0,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    assert.deepEqual(calls, [
      ["preventDefault"],
      ["stopPropagation"],
      ["createRequest", "actor-a", {
        actionId: "unique",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit resolves text-node click targets inside the button", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-text-target=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "unique" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(submitButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.pointerup) {
      await listener({
        type: "pointerup",
        target: {
          parentElement: submitButton
        },
        button: 0,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    assert.deepEqual(calls, [
      ["preventDefault"],
      ["stopPropagation"],
      ["createRequest", "actor-a", {
        actionId: "unique",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit is delegated from document when sheet render binding is missed", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-document-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "rest" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      }
    });
    const appRoot = new stubs.HTMLElement({
      dataset: {
        appid: "42"
      }
    });
    submitButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-submit']") return submitButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      if (selector.includes("[data-appid]")) return appRoot;
      return null;
    };
    stubs.document.children.push(submitButton);
    globalThis.ui.windows["42"] = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: "downtime-1" };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };
    const event = {
      target: submitButton,
      preventDefault() {
        calls.push(["preventDefault"]);
      },
      stopPropagation() {
        calls.push(["stopPropagation"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);

    assert.ok(stubs.document.listeners.click.length >= 1);
    assert.equal(stubs.document.listenerOptions.click[0]?.capture, true);
    for (const listener of stubs.document.listeners.click) {
      await listener(event);
    }

    assert.deepEqual(calls, [
      ["preventDefault"],
      ["stopPropagation"],
      ["createRequest", "actor-a", {
        actionId: "rest",
        weeks: 1,
        title: "",
        description: ""
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime roll buttons use native dnd5e skill rolls and record the result", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-roll-skill=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollSkill = async (config) => {
      calls.push(["rollSkill", config]);
      return { total: 18 };
    };

    const rollButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-roll",
        requestId: "downtime-1",
        checkId: "check-1",
        groupId: "group-a",
        sourceType: "skill",
        ability: "wis",
        target: "prc",
        targetLabel: "Perception",
        dc: "15"
      }
    });
    const panel = new stubs.HTMLElement();
    rollButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-roll']") return rollButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(rollButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result, options) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result, options]);
        return { id: requestId, actorId: "actor-a" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({
        target: rollButton,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    const rollCall = calls.find((call) => call[0] === "rollSkill");
    assert.equal(rollCall?.[1]?.skill, "prc");
    assert.equal(rollCall?.[1]?.ability, "wis");
    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), [[
      "recordDowntimeCheckResult",
      "downtime-1",
      "check-1",
      {
        total: 18,
        dc: 15,
        success: true,
        sourceType: "skill",
        ability: "wis",
        target: "prc",
        targetLabel: "Perception"
      },
      {
        actorId: "actor-a",
        groupId: "group-a"
      }
    ]]);
    assert.deepEqual(calls.filter((call) => call[0] === "render"), [["render", { force: true }]]);
    assert.deepEqual(calls.filter((call) => call[0] === "refreshOpenApps"), [["refreshOpenApps"]]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime freeform rolls record totals without synthetic DC success", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-roll-freeform=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollSkill = async (config) => {
      calls.push(["rollSkill", config]);
      return { total: 21 };
    };

    const rollButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-roll",
        requestId: "downtime-1",
        checkId: "check-1",
        groupId: "group-a",
        sourceType: "skill",
        ability: "dex",
        target: "acr",
        targetLabel: "Акробатика",
        outcomeMode: "freeform",
        dc: "0"
      }
    });
    const panel = new stubs.HTMLElement();
    rollButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-roll']") return rollButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(rollButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result, options) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result, options]);
        return { id: requestId, actorId: "actor-a" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({
        target: rollButton,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), [[
      "recordDowntimeCheckResult",
      "downtime-1",
      "check-1",
      {
        total: 21,
        sourceType: "skill",
        ability: "dex",
        target: "acr",
        targetLabel: "Акробатика",
        outcomeMode: "freeform"
      },
      {
        actorId: "actor-a",
        groupId: "group-a"
      }
    ]]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime roll buttons use native dnd5e saving throws", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-roll-save=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollSavingThrow = async (config) => {
      calls.push(["rollSavingThrow", config]);
      return [{ total: 8 }];
    };

    const rollButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-roll",
        requestId: "downtime-2",
        checkId: "save-dex",
        actorId: "actor-a",
        sourceType: "save",
        ability: "dex",
        target: "dex",
        targetLabel: "Dexterity Save",
        dc: "10"
      }
    });
    const panel = new stubs.HTMLElement();
    rollButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-roll']") return rollButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(rollButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result, options) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result, options]);
        return { id: requestId, actorId: "actor-a" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.pointerup) {
      await listener({
        type: "pointerup",
        target: rollButton,
        button: 0,
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    const saveCall = calls.find((call) => call[0] === "rollSavingThrow");
    assert.equal(saveCall?.[1]?.ability, "dex");
    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), [[
      "recordDowntimeCheckResult",
      "downtime-2",
      "save-dex",
      {
        total: 8,
        dc: 10,
        success: false,
        sourceType: "save",
        ability: "dex",
        target: "dex",
        targetLabel: "Dexterity Save"
      },
      {
        actorId: "actor-a",
        groupId: ""
      }
    ]]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime roll buttons use native dnd5e death saves", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-roll-death-save=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    actor.rollDeathSave = async (config) => {
      calls.push(["rollDeathSave", config]);
      return [{ total: 12 }];
    };
    actor.rollSavingThrow = async () => {
      throw new Error("death saves must not use rollSavingThrow");
    };

    const rollButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-roll",
        requestId: "downtime-3",
        checkId: "death-save",
        actorId: "actor-a",
        sourceType: "save",
        ability: "death",
        target: "death",
        targetLabel: "Death Save",
        dc: "10"
      }
    });
    const panel = new stubs.HTMLElement();
    rollButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-roll']") return rollButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(rollButton);
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext() {
          return {};
        }
      },
      async recordDowntimeCheckResult(requestId, checkId, result) {
        calls.push(["recordDowntimeCheckResult", requestId, checkId, result]);
        return { id: requestId, actorId: "actor-a" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.pointerup) {
      await listener({
        type: "pointerup",
        target: rollButton,
        button: 0,
        preventDefault() {},
        stopPropagation() {}
      });
    }

    const deathSaveCall = calls.find((call) => call[0] === "rollDeathSave");
    assert.equal(deathSaveCall?.[1]?.event?.type, "pointerup");
    assert.equal(deathSaveCall?.[1]?.legacy, false);
    assert.equal(calls.find((call) => call[0] === "recordDowntimeCheckResult")?.[3]?.success, true);
  }
  finally {
    stubs.restore();
  }
});
