import test from "node:test";
import assert from "node:assert/strict";

function installStubs() {
  const previousActor = globalThis.Actor;
  const previousItem = globalThis.Item;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  const previousHooks = globalThis.Hooks;
  const previousDocument = globalThis.document;
  const previousUi = globalThis.ui;
  const previousFoundry = globalThis.foundry;

  class FakeActor {}
  class FakeItem {}
  class FakeItemSheet5e {
    static TABS = [
      { tab: "description", label: "DND5E.ITEM.SECTIONS.Description" },
      { tab: "details", label: "DND5E.ITEM.SECTIONS.Details" },
      { tab: "activities", label: "DND5E.ITEM.SECTIONS.Activities" },
      { tab: "effects", label: "DND5E.ITEM.SECTIONS.Effects" },
      { tab: "advancement", label: "DND5E.ITEM.SECTIONS.Advancement" }
    ];

    static PARTS = {
      description: { template: "systems/dnd5e/templates/items/description.hbs" },
      details: { template: "systems/dnd5e/templates/items/details.hbs" },
      activities: { template: "systems/dnd5e/templates/items/activities.hbs" },
      effects: { template: "systems/dnd5e/templates/items/effects.hbs" },
      advancement: { template: "systems/dnd5e/templates/items/advancement.hbs" }
    };

    constructor(item) {
      this.document = item;
      this.item = item;
      this.tabGroups = { primary: "mods" };
    }

    async _preparePartContext(_partId, context = {}) {
      const tabs = this.constructor.TABS.reduce((acc, tab) => {
        if (!tab.condition || tab.condition(this.document)) {
          acc[tab.tab] = {
            ...tab,
            id: tab.tab,
            group: "primary",
            active: this.tabGroups.primary === tab.tab,
            cssClass: this.tabGroups.primary === tab.tab ? "active" : ""
          };
        }
        return acc;
      }, {});
      return { ...context, tabs };
    }
  }

  class FakeHTMLElement {
    constructor({ dataset = {}, selectors = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectors = selectors;
      this.selectorAll = selectorAll;
      this.children = [];
      this.attributes = {};
      const styleProperties = new Map();
      this.style = {
        setProperty(name, value) {
          styleProperties.set(name, value);
        },
        getPropertyValue(name) {
          return styleProperties.get(name) ?? "";
        },
        removeProperty(name) {
          styleProperties.delete(name);
        }
      };
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
      this.parentElement = null;
    }
  }

  const hooks = new Map();
  const fakeDocument = new FakeHTMLElement();
  fakeDocument.createElement = () => new FakeHTMLElement();

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
        item: {
          ItemSheet5e: FakeItemSheet5e
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
  globalThis.ui = {
    notifications: {
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
      }
    }
  };

  return {
    Actor: FakeActor,
    Item: FakeItem,
    ItemSheet5e: FakeItemSheet5e,
    HTMLElement: FakeHTMLElement,
    hooks,
    restore() {
      globalThis.Actor = previousActor;
      globalThis.Item = previousItem;
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.game = previousGame;
      globalThis.CONFIG = previousConfig;
      globalThis.Hooks = previousHooks;
      globalThis.document = previousDocument;
      globalThis.ui = previousUi;
      globalThis.foundry = previousFoundry;
    }
  };
}

test("item sheets with an owning actor do not render character sheet branding", async () => {
  const stubs = installStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?item-sheet-branding=${Date.now()}`);
    const actor = new stubs.Actor();
    actor.id = "actor-a";
    actor.type = "character";
    const item = new stubs.Item();
    item.id = "katana";
    item.type = "weapon";
    item.actor = actor;
    item.parent = actor;

    const staleBrand = new stubs.HTMLElement();
    staleBrand.dataset.rebreyaCharacterBrand = "true";
    staleBrand.classList.add("rm-character-sheet-brand");
    const nameInput = new stubs.HTMLElement();
    const leftHeader = new stubs.HTMLElement({
      selectors: {
        "[data-rebreya-character-brand='true']": staleBrand
      }
    });
    leftHeader.append(staleBrand, nameInput);
    const root = new stubs.HTMLElement({
      selectors: {
        ".sheet-header > .left": leftHeader
      },
      selectorAll: {
        "[data-rebreya-character-brand='true']": [staleBrand]
      }
    });

    registerDnd5eSheetExtensions({});
    stubs.hooks.get("renderApplicationV2")({
      actor,
      document: item,
      item
    }, root);

    assert.equal(staleBrand.removed, true);
    assert.deepEqual(leftHeader.children, [nameInput]);
    assert.equal(root.style.getPropertyValue("--rm-character-sheet-header-image"), "");
  }
  finally {
    stubs.restore();
  }
});

test("upgradeable item sheets expose upgrades in a separate Mods tab", async () => {
  const stubs = installStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?item-mods-tab=${Date.now()}`);
    const actor = new stubs.Actor();
    actor.id = "actor-a";
    const item = new stubs.Item();
    item.id = "katana";
    item.type = "weapon";
    item.name = "Katana";
    item.img = "icons/svg/sword.svg";
    item.actor = actor;
    item.parent = actor;
    item.system = {
      equipped: true,
      type: {
        baseItem: "katana",
        value: "martialM"
      }
    };
    item.flags = {};
    item.getFlag = () => undefined;

    registerDnd5eSheetExtensions({});

    assert.deepEqual(
      stubs.ItemSheet5e.TABS.map((tab) => tab.tab),
      ["description", "details", "activities", "effects", "mods", "advancement"]
    );

    const modsTab = stubs.ItemSheet5e.TABS.find((tab) => tab.tab === "mods");
    assert.equal(modsTab.label, "Моды");
    assert.equal(modsTab.condition(item), true);
    assert.equal(stubs.ItemSheet5e.PARTS.mods.template, "modules/rebreya-main/templates/item-mods-tab.hbs");

    const sheet = new stubs.ItemSheet5e(item);
    const context = await sheet._preparePartContext("mods", {});
    assert.equal(context.itemUpgradeTab.id, "mods");
    assert.match(context.itemUpgradePanelHtml, /data-rebreya-item-upgrades="true"/u);
    assert.match(context.itemUpgradePanelHtml, /Усовершенствования/u);
  }
  finally {
    stubs.restore();
  }
});
