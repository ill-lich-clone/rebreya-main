import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

function readWebpDimensions(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");

  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (chunkType === "VP8 ") {
      assert.equal(bytes[payloadOffset + 3], 0x9d);
      assert.equal(bytes[payloadOffset + 4], 0x01);
      assert.equal(bytes[payloadOffset + 5], 0x2a);

      return {
        width: bytes.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(payloadOffset + 8) & 0x3fff
      };
    }

    if (chunkType === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(payloadOffset + 4, 3),
        height: 1 + bytes.readUIntLE(payloadOffset + 7, 3)
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("Unsupported WebP file without VP8 or VP8X dimensions");
}

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
  const previousTextEditor = globalThis.TextEditor;

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
      this.attributes = {};
      const styleProperties = new Map();
      this.style = {
        setProperty(name, value) {
          styleProperties.set(name, value);
        },
        getPropertyValue(name) {
          return styleProperties.get(name) ?? "";
        }
      };
      this.tagName = "DIV";
      this.classList = {
        values: new Set(),
        add: (...names) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name) => this.classList.values.has(name)
      };
    }

    append(...children) {
      for (const child of children) {
        if (child.parentElement?.children) {
          child.parentElement.children = child.parentElement.children.filter((entry) => entry !== child);
        }
        child.parentElement = this;
        this.children.push(child);
      }
    }

    prepend(...children) {
      for (const child of children.reverse()) {
        if (child.parentElement?.children) {
          child.parentElement.children = child.parentElement.children.filter((entry) => entry !== child);
        }
        child.parentElement = this;
        this.children.unshift(child);
      }
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "name") {
        this.name = String(value);
      }
      if (name === "type") {
        this.type = String(value);
      }
    }

    getAttribute(name) {
      return this.attributes[name];
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
      if (this.parentElement?.children) {
        this.parentElement.children = this.parentElement.children.filter((entry) => entry !== this);
      }
      this.parentElement = null;
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
  fakeDocument.createElement = (tagName) => {
    const element = new FakeHTMLElement();
    element.tagName = String(tagName ?? "div").toUpperCase();
    return element;
  };
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
      globalThis.TextEditor = previousTextEditor;
    }
  };
}

function createActor(ActorClass, { id = "actor-a", name = "Hero", type = "character" } = {}) {
  return new class extends ActorClass {
    constructor() {
      super();
      this.id = id;
      this.name = name;
      this.type = type;
      this.items = [];
      this.system = {};
    }
  }();
}

function findTreeNode(root, predicate) {
  if (!root || typeof predicate !== "function") {
    return null;
  }

  if (predicate(root)) {
    return root;
  }

  for (const child of root.children ?? []) {
    const match = findTreeNode(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
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

test("registerDnd5eSheetExtensions adds Rebreya branding to character sheet headers", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?character-branding=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const nameInput = new stubs.HTMLElement();
    nameInput.classList.add("document-name");
    const leftHeader = new stubs.HTMLElement();
    leftHeader.append(nameInput);
    const header = new stubs.HTMLElement();
    const root = new stubs.HTMLElement({
      selectors: {
        ".sheet-header": header,
        ".sheet-header > .left": leftHeader
      }
    });
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    const brand = leftHeader.children[0];
    assert.equal(brand.dataset.rebreyaCharacterBrand, "true");
    assert.equal(brand.classList.contains("rm-character-sheet-brand"), true);
    assert.equal(brand.textContent, "Ребрея: Тень прогресса");
    assert.equal(brand.children.length, 0);
    assert.equal(leftHeader.children[1], nameInput);
    assert.equal(root.style.getPropertyValue("--rm-character-sheet-header-image"), 'url("/modules/rebreya-main/assets/ui/rebreya-character-header.webp")');
  }
  finally {
    stubs.restore();
  }
});

test("main stylesheet applies Rebreya character header image and brand positioning", async () => {
  const styles = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const headerAssetUrl = new URL("../assets/ui/rebreya-character-header.webp", import.meta.url);
  const headerAsset = await stat(headerAssetUrl);
  const headerDimensions = readWebpDimensions(await readFile(headerAssetUrl));

  assert.ok(headerAsset.size < 100_000);
  assert.deepEqual(headerDimensions, { width: 1280, height: 560 });
  assert.match(styles, /--rm-character-sheet-header-image:\s*url\("\/modules\/rebreya-main\/assets\/ui\/rebreya-character-header\.webp"\)/u);
  assert.doesNotMatch(styles, /--dnd5e-character-header-image:\s*var\(--rm-character-sheet-header-image\)/u);
  assert.doesNotMatch(styles, /--dnd5e-character-background-image:\s*var\(--rm-character-sheet-header-image\)/u);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*height:\s*380px/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*flex:\s*0 0 380px/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*min-height:\s*380px/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*content:\s*""/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*opacity:\s*1/su);
  assert.doesNotMatch(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*filter:\s*blur/su);
  assert.doesNotMatch(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*mask-image:\s*none/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*-webkit-mask-image:\s*linear-gradient\(180deg,[^}]*transparent 100%\)/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character:not\(\.minimized\) \.window-content::before\s*\{[^}]*mask-image:\s*linear-gradient\(180deg,[^}]*transparent 100%\)/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character\s+\.sheet-header\s*\{[^}]*background:\s*transparent/su);
  assert.doesNotMatch(styles, /\.dnd5e2\.sheet\.actor\.character\s+\.sheet-header\s*\{[^}]*linear-gradient/su);
  assert.match(styles, /\.dnd5e2\.sheet\.actor\.character\s+\.sheet-header\s*>\s*\.left\s*\{[^}]*justify-content:\s*center/su);
  assert.match(styles, /\.rm-character-sheet-brand\s*\{/u);
  assert.match(styles, /\.rm-character-sheet-brand\s*\{[^}]*color:\s*#d8dce2/su);
  assert.match(styles, /\.rm-character-sheet-brand\s*\{[^}]*font-size:\s*36px/su);
  assert.match(styles, /\.rm-character-sheet-brand\s*\{[^}]*letter-spacing:\s*0/su);
  assert.doesNotMatch(styles, /\.rm-character-sheet-brand\s*\{[^}]*background-clip:\s*text/su);
  assert.doesNotMatch(styles, /\.rm-character-sheet-brand\s*\{[^}]*-webkit-text-fill-color:\s*transparent/su);
  assert.doesNotMatch(styles, /\.rm-character-sheet-brand\s*\{[^}]*-webkit-text-stroke/su);
  assert.doesNotMatch(styles, /\.rm-character-sheet-brand\s*\{[^}]*paint-order:\s*stroke fill/su);
  assert.doesNotMatch(styles, /\.rm-character-sheet-brand\s*\{[^}]*text-shadow:[^}]*rgb\(255 255 255/su);
});

test("registerDnd5eSheetExtensions renders universal belt slots in the inventory container strip", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?universal-belt-bind=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    actor.flags = {
      "rebreya-main": {
        universalBelt: {
          unlockedSlots: 1
        }
      }
    };
    actor.getFlag = (scope, key) => actor.flags?.[scope]?.[key];
    actor.items = {
      contents: [],
      get: () => null
    };
    const containers = new stubs.HTMLElement();
    containers.tagName = "UL";
    containers.classList.add("containers");
    containers.selectorAll[".rm-universal-belt-slot"] = [];
    const nativeContainer = new stubs.HTMLElement();
    nativeContainer.tagName = "LI";
    nativeContainer.dataset.itemId = "backpack";
    containers.append(nativeContainer);
    const root = new stubs.HTMLElement({
      selectors: {
        "ul.containers": containers
      }
    });
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    const beltSlots = containers.children.filter((child) => child.classList.contains("rm-universal-belt-slot"));
    assert.equal(beltSlots.length, 3);
    assert.equal(containers.children[0].dataset.beltSlot, "1");
    assert.equal(containers.children[1].dataset.locked, "true");
    assert.equal(containers.children[3].dataset.itemId, "backpack");
  }
  finally {
    stubs.restore();
  }
});

test("registerDnd5eSheetExtensions adds right-click hand choices to equipped item controls", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-menu=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const updates = [];
    const item = {
      id: "sword",
      _id: "sword",
      name: "Sword",
      type: "weapon",
      system: { equipped: false },
      flags: {},
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update(patch) {
        updates.push(patch);
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "sword" ? item : null)
    };
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "sword"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    stubs.document.body = new stubs.HTMLElement();
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(equipControl.listeners.contextmenu.length, 1);
    await equipControl.listeners.contextmenu[0]({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {}
    });

    const menu = stubs.document.body.children.find((child) => child.classList.contains("rm-context-menu"));
    assert.ok(menu);
    const rightHandButton = menu.children.find((child) => (
      child.children?.some((node) => node.textContent === "Правая рука")
    ));
    assert.ok(rightHandButton);
    await rightHandButton.listeners.click[0]({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(updates.at(-1), {
      "system.equipped": true,
      "flags.rebreya-main.heldHands": ["right"]
    });
  }
  finally {
    stubs.restore();
  }
});

test("registerDnd5eSheetExtensions adds right-click hand choices to npc item controls", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-menu-npc=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-npc", name: "Guard", type: "npc" });
    const updates = [];
    const item = {
      id: "spear",
      _id: "spear",
      name: "Spear",
      type: "weapon",
      system: { equipped: false },
      flags: {},
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update(patch, options) {
        updates.push({ patch, options });
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "spear" ? item : null)
    };
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "spear"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    stubs.document.body = new stubs.HTMLElement();
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderActorSheet")(app, root);

    assert.equal(equipControl.listeners.contextmenu.length, 1);
    await equipControl.listeners.contextmenu[0]({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {}
    });

    const menu = stubs.document.body.children.find((child) => child.classList.contains("rm-context-menu"));
    assert.ok(menu);
    const rightHandButton = menu.children.find((child) => child.dataset.action === "right");
    assert.ok(rightHandButton);
    await rightHandButton.listeners.click[0]({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(updates.at(-1), {
      patch: {
        "system.equipped": true,
        "flags.rebreya-main.heldHands": ["right"]
      },
      options: { render: false }
    });
  }
  finally {
    stubs.restore();
  }
});

test("held item context menu updates npc hand state without forced sheet rerenders", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-menu-npc-render=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-npc", name: "Guard", type: "npc" });
    const updates = [];
    const item = {
      id: "spear",
      _id: "spear",
      name: "Spear",
      type: "weapon",
      system: { equipped: false },
      flags: {},
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update(patch, options = {}) {
        options.parent = actor;
        updates.push({ patch, options });
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "spear" ? item : null)
    };
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "spear"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    stubs.document.body = new stubs.HTMLElement();
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    let renderCount = 0;
    let refreshCount = 0;
    const app = {
      actor,
      async render() {
        renderCount += 1;
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
      async refreshOpenApps() {
        refreshCount += 1;
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderActorSheet")(app, root);

    await equipControl.listeners.contextmenu[0]({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {}
    });
    const menu = stubs.document.body.children.find((child) => child.classList.contains("rm-context-menu"));
    const rightHandButton = menu.children.find((child) => child.dataset.action === "right");
    await rightHandButton.listeners.click[0]({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(updates.at(-1)?.patch, {
      "system.equipped": true,
      "flags.rebreya-main.heldHands": ["right"]
    });
    assert.equal(updates.at(-1)?.options.render, false);
    assert.equal(updates.at(-1)?.options.parent, actor);
    assert.equal(renderCount, 0);
    assert.equal(refreshCount, 0);
  }
  finally {
    stubs.restore();
  }
});

test("held item context menu can replace an occupied hand slot after confirmation", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-replace=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const oldUpdates = [];
    const newUpdates = [];
    const occupiedItem = {
      id: "mace",
      _id: "mace",
      name: "Mace",
      type: "weapon",
      system: { equipped: true },
      flags: {
        "rebreya-main": {
          heldHands: ["left"]
        }
      },
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update(patch) {
        oldUpdates.push(patch);
      }
    };
    const replacementItem = {
      id: "sword",
      _id: "sword",
      name: "Sword",
      type: "weapon",
      system: { equipped: true },
      flags: {},
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update(patch) {
        newUpdates.push(patch);
      }
    };
    actor.items = {
      contents: [occupiedItem, replacementItem],
      get: (id) => [occupiedItem, replacementItem].find((item) => item.id === id) ?? null
    };
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "sword"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    stubs.document.body = new stubs.HTMLElement();
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const confirmations = [];
    globalThis.foundry.applications = {
      api: {
        DialogV2: {
          async confirm(config) {
            confirmations.push(config);
            return true;
          }
        }
      }
    };
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    await equipControl.listeners.contextmenu[0]({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {}
    });

    const menu = stubs.document.body.children.find((child) => child.classList.contains("rm-context-menu"));
    const leftHandButton = menu.children.find((child) => (
      child.children?.some((node) => node.textContent === "Левая рука")
    ));
    assert.ok(leftHandButton);
    assert.equal(leftHandButton.disabled, false);
    assert.equal(leftHandButton.classList.contains("is-muted"), true);

    await leftHandButton.listeners.click[0]({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(confirmations.length, 1);
    assert.deepEqual(oldUpdates.at(-1), {
      "system.equipped": true,
      "flags.rebreya-main.-=heldHands": null
    });
    assert.deepEqual(newUpdates.at(-1), {
      "system.equipped": true,
      "flags.rebreya-main.heldHands": ["left"]
    });
  }
  finally {
    stubs.restore();
  }
});

test("held item context menu marks one-hand choices for two-handed weapons as carrying only", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-carry-only=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const item = {
      id: "longbow",
      _id: "longbow",
      name: "Longbow",
      type: "weapon",
      system: {
        equipped: true,
        properties: ["two"]
      },
      flags: {},
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      },
      async update() {}
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "longbow" ? item : null)
    };
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "longbow"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    stubs.document.body = new stubs.HTMLElement();
    globalThis.window.innerWidth = 800;
    globalThis.window.innerHeight = 600;
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    await equipControl.listeners.contextmenu[0]({
      clientX: 10,
      clientY: 20,
      preventDefault() {},
      stopPropagation() {}
    });

    const menu = stubs.document.body.children.find((child) => child.classList.contains("rm-context-menu"));
    const leftHandButton = menu.children.find((child) => child.dataset.action === "left");
    const bothHandsButton = menu.children.find((child) => child.dataset.action === "both");

    assert.ok(leftHandButton);
    assert.equal(leftHandButton.disabled, false);
    assert.equal(leftHandButton.classList.contains("is-muted"), true);
    assert.ok(leftHandButton.dataset.tooltip);
    assert.ok(bothHandsButton);
    assert.equal(bothHandsButton.classList.contains("is-muted"), false);
  }
  finally {
    stubs.restore();
  }
});

test("registerDnd5eSheetExtensions reflects selected held state on the native equip control", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-presentation=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const item = {
      id: "sword",
      _id: "sword",
      name: "Sword",
      type: "weapon",
      system: { equipped: true },
      flags: {
        "rebreya-main": {
          heldHands: ["right"]
        }
      },
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "sword" ? item : null)
    };
    const icon = new stubs.HTMLElement();
    icon.tagName = "I";
    icon.className = "fa-solid fa-shield";
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      },
      selectors: {
        "i": icon
      }
    });
    equipControl.append(icon);
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "sword"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(equipControl.getAttribute("title"), "Правая рука");
    assert.equal(equipControl.getAttribute("aria-label"), "Правая рука");
    assert.equal(equipControl.dataset.tooltip, "Правая рука");
    assert.equal(icon.className, "fa-solid fa-hand-point-right fa-fw");
  }
  finally {
    stubs.restore();
  }
});

test("held item update hook refreshes already rendered equip controls", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-hook-refresh=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const item = {
      id: "sword",
      _id: "sword",
      name: "Sword",
      type: "weapon",
      system: { equipped: false },
      flags: {
        "rebreya-main": {}
      },
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "sword" ? item : null)
    };
    const icon = new stubs.HTMLElement();
    icon.tagName = "I";
    icon.className = "fa-solid fa-shield";
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      },
      selectors: {
        "i": icon
      }
    });
    equipControl.append(icon);
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "sword"
      },
      selectors: {
        "[data-action='equip']": equipControl
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    item.system.equipped = true;
    item.flags["rebreya-main"].heldHands = ["left"];
    stubs.hooks.get("rebreya-main.heldItemUpdated")({
      actor,
      item,
      actorId: actor.id,
      itemId: item.id
    });

    assert.equal(icon.className, "fa-solid fa-hand-point-left fa-fw");
  }
  finally {
    stubs.restore();
  }
});

test("registerDnd5eSheetExtensions shows versatile damage formula for two-handed held weapons", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?held-item-formula=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const item = {
      id: "longsword",
      _id: "longsword",
      name: "Longsword",
      type: "weapon",
      system: {
        equipped: true,
        properties: ["ver"],
        damage: {
          versatile: {
            number: 1,
            denomination: 10,
            bonus: "",
            custom: {
              enabled: false,
              formula: ""
            }
          }
        }
      },
      flags: {
        "rebreya-main": {
          heldHands: ["left", "right"],
          handRequirement: {
            requiredHands: 1,
            allowedHands: [1, 2],
            versatile: true
          }
        }
      },
      getFlag(scope, key) {
        return String(key ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), this.flags?.[scope]);
      }
    };
    actor.items = {
      contents: [item],
      get: (id) => (id === "longsword" ? item : null)
    };
    const formulaNode = new stubs.HTMLElement();
    formulaNode.textContent = "1d8 + 10";
    const equipControl = new stubs.HTMLElement({
      dataset: {
        action: "equip"
      }
    });
    const row = new stubs.HTMLElement({
      dataset: {
        itemId: "longsword"
      },
      selectors: {
        "[data-action='equip']": equipControl
      },
      selectorAll: {
        "[data-column-id='formula'] .formula": [formulaNode],
        ".item-formula .formula": [formulaNode]
      }
    });
    const root = new stubs.HTMLElement({
      selectorAll: {
        "[data-item-id]": [row]
      }
    });
    const app = {
      actor,
      async render() {}
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
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(formulaNode.textContent, "1d10 + 10");
    assert.equal(formulaNode.dataset.rebreyaBaseFormula, "1d8 + 10");
  }
  finally {
    stubs.restore();
  }
});

test("registerDnd5eSheetExtensions augments actor sheet conditions with Rebreya statuses and valued inputs", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?combat-status-sheet-render=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const frightenedRow = new stubs.HTMLElement({
      dataset: {
        conditionId: "frightened",
        action: "toggleCondition"
      }
    });
    frightenedRow.classList.add("condition");
    const unconsciousRow = new stubs.HTMLElement({
      dataset: {
        conditionId: "unconscious",
        action: "toggleCondition"
      }
    });
    unconsciousRow.classList.add("condition");
    const conditionsList = new stubs.HTMLElement();
    conditionsList.append(frightenedRow, unconsciousRow);
    const root = new stubs.HTMLElement({
      selectors: {
        ".effects-element .conditions-list": conditionsList
      },
      selectorAll: {
        "[data-rebreya-combat-status='true']": []
      }
    });
    const app = {
      actor,
      isEditable: true
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
      getCombatStatusDefinitions() {
        return [
          { id: "frightened", label: "Испуганный", icon: "fear.svg", supportsValue: true },
          { id: "rebreya-weakened", label: "Ослабленный", icon: "weak.svg", supportsValue: true },
          { id: "rebreya-gaseous", label: "Газообразный", icon: "gas.svg", supportsValue: false }
        ];
      },
      getCombatStatus(_actor, statusId) {
        if (statusId === "frightened") {
          return { active: true, value: 3 };
        }
        return { active: false, value: null };
      },
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(conditionsList.children.length, 4);
    assert.equal(frightenedRow.dataset.rebreyaCombatStatusId, "frightened");
    assert.equal(frightenedRow.dataset.action, "");
    assert.equal(frightenedRow.classList.contains("active"), true);

    const frightenedInput = findTreeNode(
      frightenedRow,
      (node) => node?.dataset?.rebreyaCombatStatusInput === "true"
    );
    assert.ok(frightenedInput);
    assert.equal(frightenedInput.value, "3");

    const weakenedRow = conditionsList.children.find((node) => node.dataset.rebreyaCombatStatusId === "rebreya-weakened");
    assert.ok(weakenedRow);
    assert.equal(weakenedRow.dataset.rebreyaCombatStatus, "true");
    assert.ok(findTreeNode(weakenedRow, (node) => node?.dataset?.rebreyaCombatStatusInput === "true"));

    const gaseousRow = conditionsList.children.find((node) => node.dataset.rebreyaCombatStatusId === "rebreya-gaseous");
    assert.ok(gaseousRow);
    assert.equal(gaseousRow.classList.contains("active"), false);
  }
  finally {
    stubs.restore();
  }
});

test("character sheet Rebreya status controls write through the combat status API", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?combat-status-sheet-actions=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    actor.isOwner = true;
    const frightenedRow = new stubs.HTMLElement({
      dataset: {
        conditionId: "frightened",
        action: "toggleCondition"
      }
    });
    frightenedRow.classList.add("condition");
    const conditionsList = new stubs.HTMLElement();
    conditionsList.append(frightenedRow);
    const root = new stubs.HTMLElement({
      selectors: {
        ".effects-element .conditions-list": conditionsList
      },
      selectorAll: {
        "[data-rebreya-combat-status='true']": []
      }
    });
    const app = {
      actor,
      isEditable: false
    };
    const calls = [];
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
      getCombatStatusDefinitions() {
        return [
          { id: "frightened", label: "Испуганный", icon: "fear.svg", supportsValue: true },
          { id: "rebreya-gaseous", label: "Газообразный", icon: "gas.svg", supportsValue: false }
        ];
      },
      getCombatStatus(_actor, statusId) {
        if (statusId === "frightened") {
          return { active: false, value: null };
        }
        return { active: false, value: null };
      },
      async setCombatStatusValue(targetActor, statusId, value) {
        calls.push(["value", targetActor.id, statusId, value]);
      },
      async clearCombatStatus(targetActor, statusId) {
        calls.push(["clear", targetActor.id, statusId]);
      },
      async setCombatStatus(targetActor, statusId, options) {
        calls.push(["toggle", targetActor.id, statusId, options]);
      },
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    const frightenedInput = findTreeNode(
      frightenedRow,
      (node) => node?.dataset?.rebreyaCombatStatusInput === "true"
    );
    assert.equal(frightenedInput.disabled, false);
    frightenedInput.value = "5";
    await frightenedInput.listeners.change[0]({
      currentTarget: frightenedInput,
      preventDefault() {},
      stopPropagation() {}
    });

    frightenedInput.value = "";
    await frightenedInput.listeners.change[0]({
      currentTarget: frightenedInput,
      preventDefault() {},
      stopPropagation() {}
    });

    const gaseousRow = conditionsList.children.find((node) => node.dataset.rebreyaCombatStatusId === "rebreya-gaseous");
    assert.equal(Array.isArray(gaseousRow.listeners.click), true);
    await gaseousRow.listeners.click[0]({
      currentTarget: gaseousRow,
      preventDefault() {},
      stopPropagation() {}
    });

    assert.deepEqual(calls, [
      ["value", "actor-a", "frightened", 5],
      ["clear", "actor-a", "frightened"],
      ["toggle", "actor-a", "rebreya-gaseous", { active: true }]
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character sheet status references use Rebreya text and compact Russian label wrapping", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?combat-status-sheet-reference=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    actor.isOwner = true;

    const unconsciousTitle = new stubs.HTMLElement();
    unconsciousTitle.classList.add("title");
    unconsciousTitle.textContent = "Без сознания";
    const unconsciousRow = new stubs.HTMLElement({
      dataset: {
        conditionId: "unconscious",
        action: "toggleCondition",
        uuid: "Compendium.dnd5e.rules.english-unconscious"
      },
      selectors: {
        ".name-stacked .title": unconsciousTitle
      }
    });
    unconsciousRow.classList.add("condition", "content-link");

    const conditionsList = new stubs.HTMLElement();
    conditionsList.append(unconsciousRow);
    const root = new stubs.HTMLElement({
      selectors: {
        ".effects-element .conditions-list": conditionsList
      },
      selectorAll: {
        "[data-rebreya-combat-status='true']": []
      }
    });
    const app = {
      actor,
      isEditable: false
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
      getCombatStatusDefinitions() {
        return [
          { id: "rebreya-provoked", label: "Спровоцированный", icon: "provoked.svg", supportsValue: true }
        ];
      },
      getCombatStatus() {
        return { active: false, value: null };
      },
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    assert.equal(unconsciousRow.dataset.uuid, "");
    assert.match(unconsciousRow.dataset.tooltip, /Без сознания/u);
    assert.match(unconsciousRow.dataset.tooltip, /Недееспособный/u);
    assert.equal(unconsciousRow.dataset.tooltipClass, "dnd5e2 dnd5e-tooltip item-tooltip themed theme-light");
    assert.equal(unconsciousTitle.getAttribute("lang"), "ru");

    const provokedRow = conditionsList.children.find((node) => node.dataset.rebreyaCombatStatusId === "rebreya-provoked");
    const provokedTitle = findTreeNode(
      provokedRow,
      (node) => node?.classList?.contains?.("title")
    );
    assert.ok(provokedTitle);
    assert.equal(provokedTitle.getAttribute("lang"), "ru");
    assert.equal(provokedTitle.classList.contains("rm-sheet-status-title--compact"), true);
    assert.match(provokedRow.dataset.tooltip, /Состояние Rebreya/u);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime template renders full description html before summary fallback", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");
  const descriptionBranchIndex = template.indexOf("{{#if characterDowntime.selectedTemplate.hasDescriptionHtml}}");
  const descriptionValueIndex = template.indexOf("{{{characterDowntime.selectedTemplate.descriptionHtml}}}");
  const summaryFallbackIndex = template.indexOf("{{else if characterDowntime.selectedTemplate.hasSummary}}");
  const escapedSummaryIndex = template.indexOf("{{characterDowntime.selectedTemplate.summary}}");

  assert.ok(descriptionBranchIndex > 0);
  assert.ok(descriptionValueIndex > descriptionBranchIndex);
  assert.ok(summaryFallbackIndex > descriptionValueIndex);
  assert.ok(escapedSummaryIndex > summaryFallbackIndex);
});

test("character downtime form keeps template descriptions expanded in the sheet", async () => {
  const styles = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const match = styles.match(/\.rm-character-downtime-template__description\s*\{(?<body>[^}]*)\}/u);

  assert.ok(match?.groups?.body);
  assert.doesNotMatch(match.groups.body, /max-height\s*:/u);
  assert.doesNotMatch(match.groups.body, /overflow\s*:\s*auto/u);
});

test("character downtime template uses compact summary stats and selection controls", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");

  assert.match(template, /Свободно\s*\{\{rmNum characterDowntime\.balance\.availableWeeks/u);
  assert.match(template, /data-tooltip="Можно заявить сейчас"/u);
  assert.doesNotMatch(template, /<small>можно заявить сейчас<\/small>/u);
  assert.doesNotMatch(template, /<label>Действие<\/label>/u);
  assert.match(template, /data-action="character-downtime-clear-action"/u);
  assert.match(template, /data-action="character-downtime-edit-request"/u);
  assert.match(template, /data-edit-state="\{\{editFormStateJson\}\}"/u);
  assert.match(template, /data-item-snapshot="\{\{selectedItemJson\}\}"/u);
  assert.match(template, /\{\{#if characterDowntime\.selectedTemplate\}\}[\s\S]*data-action="character-downtime-submit"/u);
});

test("character downtime item choice renders as a clearable dropzone with price formula controls", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");

  assert.match(template, /rm-character-downtime-item-dropzone/u);
  assert.match(template, /data-action="character-downtime-clear-item-choice"/u);
  assert.match(template, /data-role="character-downtime-item-choice-price"/u);
  assert.match(template, /data-action="character-downtime-formula-input"/u);
  assert.match(template, /data-formula-by-rarity="\{\{formulaByRarityJson\}\}"/u);
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
    assert.equal(globalThis.CONFIG.DND5E.itemProperties.lchFirearmMisfire.label, "Осечка [О]");
    assert.equal(globalThis.CONFIG.DND5E.itemProperties.lchFirearmAutomatic.label, "Автоматическое [О]");
    assert.equal(globalThis.CONFIG.DND5E.itemProperties.lchFirearmScatter.label, "Разброс [О]");
    assert.equal(globalThis.CONFIG.DND5E.itemProperties.lchFirearmOverheat.label, "Перегрев [О]");
    assert.equal(globalThis.CONFIG.DND5E.validProperties.weapon.has("lchFirearmMisfire"), true);
    assert.equal(globalThis.CONFIG.DND5E.validProperties.weapon.has("lchFirearmAutomatic"), true);
    assert.equal(globalThis.CONFIG.DND5E.validProperties.weapon.has("lchFirearmScatter"), true);
    assert.equal(globalThis.CONFIG.DND5E.validProperties.weapon.has("lchFirearmOverheat"), true);
    assert.equal(warningCalls.some((args) => String(args[0]).includes("downtime")), false);
  }
  finally {
    console.warn = previousConsoleWarn;
    stubs.restore();
  }
});

test("extendDnd5eItemTypes registers firearm activity attack type and Midi action type", async () => {
  const stubs = installSheetExtensionStubs();
  globalThis.game.modules = new Map([["rebreya-main", { documentTypes: { Item: { state: {}, downtime: {} } } }]]);
  globalThis.CONFIG.Item = {
    dataModels: {
      background: class BackgroundData {
        static metadata = {};
      }
    },
    typeLabels: {},
    typeIcons: {}
  };
  globalThis.CONFIG.DND5E.attackTypes = Object.seal({
    melee: { label: "Рукопашная" },
    ranged: { label: "Дальнобойная" }
  });
  globalThis.CONFIG.DND5E.itemActionTypes = {
    mwak: "Рукопашная атака",
    rwak: "Дальнобойная атака"
  };
  globalThis.CONFIG.DND5E.activityTypes = {
    attack: {
      documentClass: class AttackActivity {
        constructor({ attack = { type: { value: "ranged", classification: "weapon" } } } = {}) {
          this.attack = attack;
        }

        get actionType() {
          const type = this.attack.type;
          return `${type.value === "ranged" ? "r" : "m"}${type.classification === "spell" ? "sak" : "wak"}`;
        }
      }
    }
  };

  try {
    const { extendDnd5eItemTypes } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?firearm-attack-type=${Date.now()}`);

    extendDnd5eItemTypes();

    assert.equal(CONFIG.DND5E.attackTypes.firearm.label, "Огнестрельная");
    assert.equal(CONFIG.DND5E.itemActionTypes.fwak, "Огнестрельная атака");
    assert.equal(Object.isSealed(CONFIG.DND5E.attackTypes), true);

    const FirearmAttack = CONFIG.DND5E.activityTypes.attack.documentClass;
    const activity = new FirearmAttack({
      attack: {
        type: {
          value: "firearm",
          classification: "weapon"
        }
      }
    });
    assert.equal(activity.actionType, "fwak");
  }
  finally {
    stubs.restore();
  }
});

test("weapon item sheet renders firearm-only properties in a separate details block", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?firearm-property-block=${Date.now()}`);

    const updates = [];
    const item = new globalThis.Item();
    item.type = "weapon";
    item.isOwner = true;
    item.system = {
      type: {
        value: "firearmPrimitive"
      },
      properties: {
        lchFirearmMisfire: true,
        lchGrip: true
      }
    };
    item.flags = {};
    item.getFlag = (scope, key) => item.flags?.[scope]?.[key];
    item.update = async (patch) => {
      updates.push(patch);
      Object.assign(item.system.properties, Object.fromEntries(
        Object.entries(patch)
          .filter(([key]) => key.startsWith("system.properties."))
          .map(([key, value]) => [key.replace("system.properties.", ""), value])
      ));
      return item;
    };

    const propertySelector = (key) => `dnd5e-checkbox[name='system.properties.${key}'], input[name='system.properties.${key}']`;
    const details = new stubs.HTMLElement();
    const nativeFieldset = new stubs.HTMLElement();
    nativeFieldset.tagName = "FIELDSET";
    details.selectors.fieldset = nativeFieldset;
    details.append(nativeFieldset);

    const gripRow = new stubs.HTMLElement();
    gripRow.tagName = "LABEL";
    const gripControl = new stubs.HTMLElement();
    gripControl.checked = true;
    gripRow.append(gripControl);
    nativeFieldset.append(gripRow);

    const root = new stubs.HTMLElement({
      selectors: {
        ".tab[data-tab='details']": details,
        [propertySelector("lchGrip")]: gripControl
      },
      selectorAll: {
        [propertySelector("lchGrip")]: [gripControl]
      }
    });
    const app = {
      item,
      isEditable: true
    };

    registerDnd5eSheetExtensions({});
    stubs.hooks.get("renderItemSheet")(app, root);

    const firearmBlock = findTreeNode(details, (node) => node.dataset?.rebreyaItemField === "firearm-properties");
    assert.ok(firearmBlock, "firearm property block is rendered");
    assert.ok(findTreeNode(firearmBlock, (node) => node.textContent === "Свойства огнестрела"));
    const misfireInput = findTreeNode(firearmBlock, (node) => node.name === "system.properties.lchFirearmMisfire");
    assert.ok(misfireInput, "misfire checkbox is rendered from Rebreya block");
    assert.equal(misfireInput.checked, true);
    assert.equal(findTreeNode(nativeFieldset, (node) => node === gripRow), gripRow);

    misfireInput.checked = false;
    await misfireInput.listeners.change[0]({ currentTarget: misfireInput });
    assert.deepEqual(updates.at(-1), {
      "system.properties.lchFirearmMisfire": false
    });
  }
  finally {
    stubs.restore();
  }
});

test("weapon item sheet removes firearm-only native property rows from non-firearms", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?non-firearm-property-block=${Date.now()}`);

    const item = new globalThis.Item();
    item.type = "weapon";
    item.isOwner = true;
    item.system = {
      type: {
        value: "martialR"
      },
      properties: {
        lchGrip: true
      }
    };
    item.flags = {};
    item.getFlag = (scope, key) => item.flags?.[scope]?.[key];

    const propertySelector = (key) => `dnd5e-checkbox[name='system.properties.${key}'], input[name='system.properties.${key}']`;
    const details = new stubs.HTMLElement();
    const nativeFieldset = new stubs.HTMLElement();
    nativeFieldset.tagName = "FIELDSET";
    details.selectors.fieldset = nativeFieldset;
    details.append(nativeFieldset);

    const misfireRow = new stubs.HTMLElement();
    misfireRow.tagName = "LABEL";
    const misfireControl = new stubs.HTMLElement();
    misfireControl.checked = false;
    misfireRow.append(misfireControl);
    nativeFieldset.append(misfireRow);

    const gripRow = new stubs.HTMLElement();
    gripRow.tagName = "LABEL";
    const gripControl = new stubs.HTMLElement();
    gripControl.checked = true;
    gripRow.append(gripControl);
    nativeFieldset.append(gripRow);

    const root = new stubs.HTMLElement({
      selectors: {
        ".tab[data-tab='details']": details,
        [propertySelector("lchFirearmMisfire")]: misfireControl,
        [propertySelector("lchGrip")]: gripControl
      },
      selectorAll: {
        [propertySelector("lchFirearmMisfire")]: [misfireControl],
        [propertySelector("lchGrip")]: [gripControl]
      }
    });
    const app = {
      item,
      isEditable: true
    };

    registerDnd5eSheetExtensions({});
    stubs.hooks.get("renderItemSheet")(app, root);

    assert.equal(findTreeNode(details, (node) => node.dataset?.rebreyaItemField === "firearm-properties"), null);
    assert.equal(findTreeNode(nativeFieldset, (node) => node === misfireRow), null);
    assert.equal(findTreeNode(nativeFieldset, (node) => node === gripRow), gripRow);
  }
  finally {
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

test("character downtime library selection preserves full downtime description html", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-library-description=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const descriptionHtml = "<h2>Азартные игры</h2><h3>Нарративная заявка</h3><p>Полный текст заявки.</p><h3>Ресурсы</h3><p>Полный текст ресурсов.</p><h3>Определение последствий</h3><p>Полный текст последствий.</p>";
    const actionInput = { value: "" };
    const actionLabel = { textContent: "" };
    const libraryButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-open-library"
      }
    });
    const weeksInput = { value: "1" };
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": actionInput,
        "[data-action='character-downtime-action-label']": actionLabel,
        "[data-action='character-downtime-open-library']": libraryButton,
        "[data-action='character-downtime-weeks']": weeksInput
      }
    });
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    const app = {
      actor,
      async render(options) {
        calls.push(["render", options]);
      }
    };
    globalThis.game.packs = {
      get(packId) {
        if (packId !== "world.rebreya-downtime") {
          return null;
        }
        return {
          collection: packId,
          async getIndex() {
            return [{
              _id: "downtime-gambling",
              name: "Азартные игры",
              uuid: "Compendium.world.rebreya-downtime.Item.downtime-gambling",
              flags: {
                "rebreya-main": {
                  downtime: {
                    descriptionHtml
                  }
                }
              },
              system: {
                description: {
                  value: descriptionHtml
                }
              }
            }];
          }
        };
      }
    };
    globalThis.dnd5e = {
      applications: {
        CompendiumBrowser: {
          MODES: {
            ADVANCED: "advanced"
          },
          async selectOne() {
            return "Compendium.world.rebreya-downtime.Item.downtime-gambling";
          }
        }
      }
    };
    globalThis.fromUuid = async (uuid) => ({
      uuid,
      type: "rebreya-main.downtime",
      name: "Азартные игры",
      system: {
        description: {
          value: descriptionHtml
        }
      },
      getFlag(scope, key) {
        return scope === "rebreya-main" && key === "downtime"
          ? { descriptionHtml }
          : undefined;
      }
    });
    const moduleApi = {
      heroDollService: {
        getActorSnapshot() {
          return {};
        }
      },
      characterDowntimeService: {
        getActorContext(targetActor, formState) {
          calls.push(["context", targetActor.id, formState]);
          return { actorId: targetActor.id };
        }
      },
      async refreshOpenApps() {}
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of libraryButton.listeners.click) {
      await listener({
        preventDefault() {},
        stopPropagation() {}
      });
    }

    const sheet = new stubs.CharacterActorSheet(actor);
    await sheet._preparePartContext("downtime", {}, {});

    const contextCall = calls.find((call) => call[0] === "context");
    assert.equal(actionInput.value, "Compendium.world.rebreya-downtime.Item.downtime-gambling");
    assert.equal(actionLabel.textContent, "Азартные игры");
    assert.equal(contextCall[2].selectedTemplate.descriptionHtml, descriptionHtml);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime clear action removes selected template from form state", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-clear-action=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const actionInput = { value: "Compendium.world.rebreya-downtime.Item.research" };
    const actionLabel = { textContent: "Исследование" };
    const clearButton = new stubs.HTMLElement({
      dataset: {
        action: "character-downtime-clear-action"
      }
    });
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": actionInput,
        "[data-action='character-downtime-action-label']": actionLabel,
        "[data-action='character-downtime-weeks']": { value: "2" },
        "[data-action='character-downtime-clear-action']": clearButton
      }
    });
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
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
        getActorContext(targetActor, formState) {
          calls.push(["context", targetActor.id, formState]);
          return { actorId: targetActor.id };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of clearButton.listeners.click) {
      await listener({
        preventDefault() {
          calls.push(["preventDefault"]);
        },
        stopPropagation() {
          calls.push(["stopPropagation"]);
        }
      });
    }

    const sheet = new stubs.CharacterActorSheet(actor);
    await sheet._preparePartContext("downtime", {}, {});

    const contextCall = calls.find((call) => call[0] === "context");
    assert.equal(actionInput.value, "");
    assert.equal(actionLabel.textContent, "Выбрать простой");
    assert.equal(contextCall[2].actionId, "");
    assert.equal(contextCall[2].selectedTemplate, null);
    assert.deepEqual(calls.filter((call) => call[0] === "render"), [["render", { force: true }]]);
    assert.deepEqual(calls.filter((call) => call[0] === "refreshOpenApps"), [["refreshOpenApps"]]);
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
        getActorContext(targetActor, formState) {
          calls.push(["context", targetActor.id, formState]);
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

    const sheet = new stubs.CharacterActorSheet(actor);
    await sheet._preparePartContext("downtime", {}, {});
    const contextCall = calls.findLast((call) => call[0] === "context");
    assert.equal(contextCall[2].actionId ?? "", "");
    assert.equal(contextCall[2].weeks ?? 1, 1);
    assert.deepEqual(contextCall[2].targetActionSelections ?? [], []);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime edit button restores a pending request and submit updates it", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-edit-request=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const editButton = new stubs.HTMLElement({
      dataset: {
        editState: JSON.stringify({
          requestId: "downtime-1",
          actionId: "long-project",
          weeks: 1,
          title: "",
          description: "",
          targetActionSelections: [{
            actionId: "project-rank",
            value: 2
          }]
        })
      }
    });
    const submitButton = new stubs.HTMLElement();
    const rankChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "project-rank"
      }
    });
    rankChoice.value = "rank-5";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "long-project" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      },
      selectorAll: {
        "[data-action='character-downtime-rank-choice']": [rankChoice]
      }
    });
    editButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-edit-request']") return editButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
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
    root.children.push(editButton, submitButton);
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
        getActorContext(targetActor, formState) {
          calls.push(["context", targetActor.id, formState]);
          return {};
        },
        async createRequest(targetActor, payload) {
          calls.push(["createRequest", targetActor.id, payload]);
          return { id: payload.requestId };
        }
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({
        target: editButton,
        preventDefault() {},
        stopPropagation() {}
      });
    }

    const sheet = new stubs.CharacterActorSheet(actor);
    await sheet._preparePartContext("downtime", {}, {});
    const editContextCall = calls.findLast((call) => call[0] === "context");
    assert.equal(editContextCall[2].editRequestId, "downtime-1");
    assert.equal(editContextCall[2].actionId, "long-project");
    assert.deepEqual(editContextCall[2].targetActionSelections, [{
      actionId: "project-rank",
      value: 2
    }]);

    for (const listener of root.listeners.click) {
      await listener({
        target: submitButton,
        preventDefault() {},
        stopPropagation() {}
      });
    }

    assert.deepEqual(calls.find((call) => call[0] === "createRequest"), [
      "createRequest",
      "actor-a",
      {
        requestId: "downtime-1",
        actionId: "long-project",
        weeks: 1,
        title: "",
        description: "",
        targetActionSelections: [{
          actionId: "project-rank",
          optionId: "rank-5"
        }]
      }
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
    const itemSnapshot = {
      uuid: "Compendium.world.rebreya-magic-items.Item.wand",
      id: "wand",
      name: "Р–РµР·Р» РѕРіРЅСЏ",
      type: "loot",
      img: "icons/magic/fire/wand-fire.webp",
      sourceType: "magicItem",
      rarity: "rare",
      priceGold: 1200,
      rebreya: {
        managed: true,
        sourceType: "magicItem",
        magicItemId: "wand",
        signature: "magic:wands:wand",
        heroDollSlots: ["mainHand", "offHand"],
        rank: 4,
        foundryType: "loot",
        foundryFolder: "magic-items/wands",
        priceGold: 1200
      },
      documentSnapshot: {
        name: "Fire Wand",
        type: "loot",
        img: "icons/magic/fire/wand-fire.webp",
        system: {
          price: {
            value: 1200,
            denomination: "gp"
          }
        },
        flags: {
          "rebreya-main": {
            sourceType: "magicItem",
            magicItemId: "wand",
            signature: "magic:wands:wand"
          }
        }
      }
    };
    const itemChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-item",
        itemUuid: "Compendium.world.rebreya-magic-items.Item.wand",
        itemId: "wand",
        itemName: "Жезл огня",
        itemType: "loot",
        itemSourceType: "magicItem",
        itemRarity: "rare",
        itemPriceGold: "1200",
        itemSnapshot: JSON.stringify(itemSnapshot)
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
            img: "icons/magic/fire/wand-fire.webp",
            sourceType: "magicItem",
            rarity: "rare",
            priceGold: 1200,
            rebreya: {
              managed: true,
              sourceType: "magicItem",
              magicItemId: "wand",
              signature: "magic:wands:wand",
              heroDollSlots: ["mainHand", "offHand"],
              rank: 4,
              foundryType: "loot",
              foundryFolder: "magic-items/wands",
              priceGold: 1200
            },
            documentSnapshot: {
              name: "Fire Wand",
              type: "loot",
              img: "icons/magic/fire/wand-fire.webp",
              system: {
                price: {
                  value: 1200,
                  denomination: "gp"
                }
              },
              flags: {
                "rebreya-main": {
                  sourceType: "magicItem",
                  magicItemId: "wand",
                  signature: "magic:wands:wand"
                }
              }
            }
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

test("character downtime submit reads description block controls", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-description-block=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const titleInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-description"
      }
    });
    titleInput.value = "Башня у моря";
    const descriptionInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-description"
      }
    });
    descriptionInput.value = "Найти архитектора и материалы.";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "long-project" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      },
      selectorAll: {
        "[data-action='character-downtime-description-title']": [titleInput],
        "[data-action='character-downtime-description-text']": [descriptionInput]
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
        actionId: "long-project",
        weeks: 1,
        title: "",
        description: "",
        targetActionSelections: [{
          actionId: "long-project-description",
          title: "Башня у моря",
          description: "Найти архитектора и материалы."
        }]
      }
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime submit reads configurable long project check fields", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-project-config=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const submitButton = new stubs.HTMLElement();
    const sourceSelect = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-check"
      }
    });
    sourceSelect.value = "skill";
    const abilitySelect = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-check"
      }
    });
    abilitySelect.value = "wis";
    const targetSelect = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-check",
        targetLabel: "Perception"
      }
    });
    targetSelect.value = "prc";
    const dcInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "long-project-check"
      }
    });
    dcInput.value = "18";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "long-project" },
        "[data-action='character-downtime-weeks']": { value: "1" },
        "[data-action='character-downtime-title']": { value: "" },
        "[data-action='character-downtime-description']": { value: "" },
        "[data-action='character-downtime-submit']": submitButton
      },
      selectorAll: {
        "[data-action='character-downtime-check-source']": [sourceSelect],
        "[data-action='character-downtime-check-ability']": [abilitySelect],
        "[data-action='character-downtime-check-target']": [targetSelect],
        "[data-action='character-downtime-check-dc']": [dcInput]
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
        actionId: "long-project",
        weeks: 1,
        title: "",
        description: "",
        targetActionSelections: [{
          actionId: "long-project-check",
          sourceType: "skill",
          ability: "wis",
          target: "prc",
          targetLabel: "Perception",
          dc: 18
        }]
      }
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime template locks rank-driven project DC fields", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");

  assert.match(template, /\{\{#if configurableCheck\.isDcLocked\}\}readonly aria-readonly="true"\{\{\/if\}\}/u);
});

test("character downtime template renders current projects with a right-side counter", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");
  const styles = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /characterDowntime\.hasCurrentProjects/u);
  assert.match(template, /characterDowntime\.currentProjects/u);
  assert.match(template, /data-page-type="currentProject"/u);
  assert.match(template, /rm-character-downtime-request \{\{#if hasProjectCounter\}\}has-project-counter\{\{\/if\}\}/u);
  assert.match(template, /data-action="character-downtime-close-project"/u);
  assert.match(template, /data-action="character-downtime-continue"/u);
  assert.match(template, /data-request-id="\{\{id\}\}"/u);
  assert.match(template, /data-group-id="\{\{groupId\}\}"/u);
  assert.match(template, /data-tooltip="Завершить проект досрочно"/u);
  assert.match(template, /fa-solid fa-forward/u);
  assert.match(template, /fa-solid fa-flag-checkered/u);
  assert.match(template, /projectSummaryRows/u);
  assert.doesNotMatch(template, /rm-character-downtime-continue-button/u);
  assert.doesNotMatch(template, /Эта неделя ещё без сдвига/u);
  assert.match(styles, /\.rm-character-downtime-request\.has-project-counter\s*\{/u);
  assert.match(styles, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d+px/u);
  assert.match(styles, /\.rm-character-downtime-project-actions\s*\{/u);
  assert.match(styles, /\.rm-character-downtime-project-summary\s*\{/u);
});

test("character downtime template renders editable description blocks and hides current project status", async () => {
  const template = await readFile(new URL("../templates/character-downtime-tab.hbs", import.meta.url), "utf8");

  assert.match(template, /characterDowntime\.selectedTemplate\.hasDescriptionActions/u);
  assert.match(template, /data-action="character-downtime-description-title"/u);
  assert.match(template, /data-action="character-downtime-description-text"/u);
  assert.match(template, /\{\{#if showStatusBadge\}\}[\s\S]*\{\{statusLabel\}\}[\s\S]*\{\{\/if\}\}/u);
});

test("character downtime continue button rolls the project check and records the same project", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-project-continue=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const continueButton = new stubs.HTMLElement({
      dataset: {
        requestId: "downtime-project",
        groupId: "group-a",
        checkId: "long-project-check",
        sourceType: "skill",
        ability: "int",
        target: "inv",
        targetLabel: "Investigation",
        outcomeMode: "dc-sum",
        dc: "16"
      }
    });
    actor.rollSkill = async (config) => {
      calls.push(["rollSkill", config]);
      return [{ total: 21 }];
    };
    const panel = new stubs.HTMLElement();
    continueButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-continue']") return continueButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(continueButton);
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
        async createRequest(targetActor, requestPayload) {
          calls.push(["createRequest", targetActor.id, requestPayload]);
          return { id: "downtime-2" };
        }
      },
      async continueDowntimeProject(payload) {
        calls.push(["continueDowntimeProject", payload]);
        return { id: payload.requestId, status: "completed" };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    const clickEvent = { target: continueButton, preventDefault() {}, stopPropagation() {} };
    for (const listener of root.listeners.click) {
      await listener(clickEvent);
    }

    assert.equal(calls.some((call) => call[0] === "createRequest"), false);
    assert.deepEqual(calls.find((call) => call[0] === "rollSkill"), [
      "rollSkill",
      {
        event: clickEvent,
        skill: "inv",
        ability: "int"
      }
    ]);
    assert.deepEqual(calls.find((call) => call[0] === "continueDowntimeProject"), [
      "continueDowntimeProject",
      {
        requestId: "downtime-project",
        actorId: "actor-a",
        groupId: "group-a",
        checkId: "long-project-check",
        result: {
          total: 21,
          sourceType: "skill",
          ability: "int",
          target: "inv",
          targetLabel: "Investigation",
          outcomeMode: "dc-sum",
          dc: 16,
          success: true
        }
      }
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime close project button closes without creating a new request", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-project-close=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const closeButton = new stubs.HTMLElement({
      dataset: {
        requestId: "downtime-project",
        groupId: "group-a"
      }
    });
    const panel = new stubs.HTMLElement();
    closeButton.closest = (selector) => {
      if (selector === "[data-action='character-downtime-close-project']") return closeButton;
      if (selector === ".rm-character-downtime-tab") return panel;
      return null;
    };
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
    root.children.push(closeButton);
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
        async createRequest(targetActor, requestPayload) {
          calls.push(["createRequest", targetActor.id, requestPayload]);
          return { id: "downtime-2" };
        }
      },
      async closeDowntimeProject(payload) {
        calls.push(["closeDowntimeProject", payload]);
        return { id: payload.requestId, projectClosed: true };
      },
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    for (const listener of root.listeners.click) {
      await listener({ target: closeButton, preventDefault() {}, stopPropagation() {} });
    }

    assert.equal(calls.some((call) => call[0] === "createRequest"), false);
    assert.deepEqual(calls.find((call) => call[0] === "closeDowntimeProject"), [
      "closeDowntimeProject",
      {
        requestId: "downtime-project",
        actorId: "actor-a",
        groupId: "group-a"
      }
    ]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime item drop derives bargaining and price formula before submit", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-item-drop-formula=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const label = new stubs.HTMLElement();
    const priceLabel = new stubs.HTMLElement();
    const itemChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-item"
      },
      selectors: {
        "[data-role='character-downtime-item-choice-label']": label,
        "[data-role='character-downtime-item-choice-price']": priceLabel
      }
    });
    const tradeSelect = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-trade-step"
      }
    });
    tradeSelect.value = "forbidden";
    const formulaInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-price",
        formulaByRarity: JSON.stringify({
          rare: "1d6 * 1000"
        }),
        tradeStepActionId: "magic-item-purchase-trade-step",
        itemActionId: "magic-item-purchase-item"
      }
    });
    formulaInput.value = "";
    const submitButton = new stubs.HTMLElement();
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
        "[data-action='character-downtime-option-choice']": [tradeSelect],
        "[data-action='character-downtime-formula-input']": [formulaInput]
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
    const rebreyaFlags = {
      managed: true,
      sourceType: "magicItem",
      magicItemId: "belt-fire-giant",
      rarity: "Редкий",
      bargaining: "Невыгодные",
      itemBargaining: "Невыгодные",
      signature: JSON.stringify({
        costText: "2d6kh1*1000 зм",
        bargaining: "Невыгодные",
        rarity: "Редкий"
      }),
      priceGold: 5500
    };
    globalThis.fromUuid = async () => ({
      uuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant",
      id: "belt-fire-giant",
      name: "Пояс силы огненного великана",
      type: "equipment",
      img: "icons/equipment/waist/belt-embossed-gold.webp",
      system: {
        price: {
          value: 5500,
          denomination: "gp"
        },
        rarity: "rare"
      },
      flags: {
        "rebreya-main": rebreyaFlags
      },
      getFlag(scope, key) {
        if (scope !== "rebreya-main") return undefined;
        return key ? rebreyaFlags[key] : rebreyaFlags;
      },
      toObject() {
        return {
          name: "Пояс силы огненного великана",
          type: "equipment",
          img: "icons/equipment/waist/belt-embossed-gold.webp",
          system: this.system,
          flags: this.flags
        };
      }
    });
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

    await itemChoice.listeners.drop[0]({
      preventDefault() {},
      stopPropagation() {},
      dataTransfer: {
        getData(type) {
          return type === "text/plain"
            ? JSON.stringify({ uuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant" })
            : "";
        }
      }
    });

    assert.equal(label.textContent, "Пояс силы огненного великана");
    assert.equal(priceLabel.textContent, "5500 зм");
    assert.equal(tradeSelect.value, "bad");
    assert.equal(formulaInput.value, "2d6kh1*1000");

    for (const listener of root.listeners.click) {
      await listener({ target: submitButton });
    }

    const submitCall = calls.find((call) => call[0] === "createRequest");
    assert.deepEqual(submitCall[2].targetActionSelections.map((entry) => ({
      actionId: entry.actionId,
      optionId: entry.optionId,
      formula: entry.formula,
      itemName: entry.item?.name
    })), [{
      actionId: "magic-item-purchase-item",
      optionId: undefined,
      formula: undefined,
      itemName: "Пояс силы огненного великана"
    }, {
      actionId: "magic-item-purchase-trade-step",
      optionId: "bad",
      formula: undefined,
      itemName: undefined
    }, {
      actionId: "magic-item-purchase-price",
      optionId: undefined,
      formula: "2d6kh1*1000",
      itemName: undefined
    }]);
  }
  finally {
    stubs.restore();
  }
});

test("character downtime item clear removes stale item formula selections", async () => {
  const stubs = installSheetExtensionStubs();
  try {
    const { registerDnd5eSheetExtensions } = await import(`../scripts/integrations/dnd5e-sheet-extensions.js?downtime-item-clear-formula=${Date.now()}`);
    const actor = createActor(stubs.Actor, { id: "actor-a", name: "Asha" });
    const calls = [];
    const label = new stubs.HTMLElement();
    const priceLabel = new stubs.HTMLElement();
    const clearButton = new stubs.HTMLElement();
    const itemChoice = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-item",
        emptyLabel: "Предмет",
        itemUuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant",
        itemName: "Пояс силы огненного великана",
        itemCostText: "2d6kh1*1000 зм",
        itemSnapshot: JSON.stringify({
          uuid: "Compendium.world.rebreya-magic-items.Item.belt-fire-giant",
          name: "Пояс силы огненного великана",
          costText: "2d6kh1*1000 зм"
        })
      },
      selectors: {
        "[data-role='character-downtime-item-choice-label']": label,
        "[data-role='character-downtime-item-choice-price']": priceLabel,
        "[data-action='character-downtime-clear-item-choice']": clearButton
      }
    });
    const tradeSelect = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-trade-step"
      }
    });
    tradeSelect.value = "bad";
    const formulaInput = new stubs.HTMLElement({
      dataset: {
        targetActionId: "magic-item-purchase-price",
        tradeStepActionId: "magic-item-purchase-trade-step",
        itemActionId: "magic-item-purchase-item"
      }
    });
    formulaInput.value = "2d6kh1*1000";
    const panel = new stubs.HTMLElement({
      selectors: {
        "[data-action='character-downtime-action']": { value: "magic-item-purchase" },
        "[data-action='character-downtime-weeks']": { value: "1" }
      },
      selectorAll: {
        "[data-action='character-downtime-item-choice']": [itemChoice],
        "[data-action='character-downtime-option-choice']": [tradeSelect],
        "[data-action='character-downtime-formula-input']": [formulaInput]
      }
    });
    const root = new stubs.HTMLElement({
      selectors: {
        "[data-application-part='downtime'] .rm-character-downtime-tab": panel
      }
    });
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
      async refreshOpenApps() {
        calls.push(["refreshOpenApps"]);
      }
    };

    registerDnd5eSheetExtensions(moduleApi);
    stubs.hooks.get("renderCharacterActorSheet")(app, root);

    await clearButton.listeners.click[0]({
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(itemChoice.dataset.itemName, undefined);
    assert.equal(label.textContent, "Предмет");
    assert.equal(priceLabel.textContent, "");
    assert.equal(formulaInput.value, "");
    assert.equal(tradeSelect.value, "");
    assert.deepEqual(calls, [
      ["render", { force: true }],
      ["refreshOpenApps"]
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

test("character downtime submit leaves rollable checks for explicit player clicks", async () => {
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

    assert.deepEqual(calls.filter((call) => call[0] === "rollSkill"), []);
    assert.deepEqual(calls.filter((call) => call[0] === "recordDowntimeCheckResult"), []);
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
        choiceIndex: "1",
        hasChoices: "true",
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
        targetLabel: "Perception",
        choiceIndex: 1
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
