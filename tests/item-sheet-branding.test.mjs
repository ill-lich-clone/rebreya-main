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
      applications: {}
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
