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
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  class FakeActor {}
  class FakeItem {}
  class FakeHTMLElement {
    constructor({ dataset = {}, selectors = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectors = selectors;
      this.selectorAll = selectorAll;
      this.listeners = {};
      this.value = "";
      this.children = [];
    }

    querySelector(selector) {
      return this.selectors[selector] ?? null;
    }

    querySelectorAll(selector) {
      return this.selectorAll[selector] ?? [];
    }

    addEventListener(type, listener) {
      this.listeners[type] ??= [];
      this.listeners[type].push(listener);
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
  globalThis.Actor = FakeActor;
  globalThis.Item = FakeItem;
  globalThis.HTMLElement = FakeHTMLElement;
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
    hooks,
    restore() {
      globalThis.Actor = previousActor;
      globalThis.Item = previousItem;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.game = previousGame;
      globalThis.CONFIG = previousConfig;
      globalThis.Hooks = previousHooks;
      globalThis.window = previousWindow;
      globalThis.ui = previousUi;
      globalThis.foundry = previousFoundry;
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

test("character downtime render hook submits requests for the current sheet actor", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-submit=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "research" },
        "[data-action='character-downtime-weeks']": { value: "2" },
        "[data-action='character-downtime-title']": { value: "Найти наставника" },
        "[data-action='character-downtime-description']": { value: "Спросить в архиве" },
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

    assert.ok(root.listeners.click.length >= 1);
    for (const listener of root.listeners.click) {
      await listener({ target: submitButton });
    }

    assert.deepEqual(calls, [
      ["createRequest", "actor-a", {
        actionId: "research",
        weeks: 2,
        title: "Найти наставника",
        description: "Спросить в архиве"
      }],
      ["render", { force: true }],
      ["refreshOpenApps"]
    ]);
  }
  finally {
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
