import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  applyFixedRaceSize,
  applyBg3HotbarAutoAddSuppression,
  ensurePlayerInventoryQuickButton,
  getBg3DeathSaveData,
  patchBg3HotbarDeathSavesContainer,
  patchBg3HotbarStorageCommonActions,
  registerSceneControlsHook,
  resolvePlayerInventoryButtonAnchor,
  shouldSkipBg3HotbarCommonActionsForActor,
  shouldSuppressBg3HotbarAutoAdd
} = await import("../scripts/hooks.js");

function withSceneControlsHandler(callback) {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousCanvas = globalThis.canvas;
  const handlers = [];

  globalThis.Hooks = {
    on: (hookName, handler) => {
      if (hookName === "getSceneControlButtons") {
        handlers.push(handler);
      }
    }
  };
  globalThis.game = {
    i18n: { localize: (key) => key },
    settings: { get: () => true },
    user: { isGM: true }
  };
  globalThis.ui = {
    controls: { render: () => undefined }
  };

  try {
    registerSceneControlsHook();
    assert.equal(handlers.length, 1);
    callback(handlers[0]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.canvas = previousCanvas;
  }
}

function withSceneControlsHandlerForUser(user, callback) {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const previousCanvas = globalThis.canvas;
  const handlers = [];

  globalThis.Hooks = {
    on: (hookName, handler) => {
      if (hookName === "getSceneControlButtons") {
        handlers.push(handler);
      }
    }
  };
  globalThis.game = {
    i18n: { localize: (key) => key },
    settings: { get: () => true },
    user
  };
  globalThis.ui = {
    controls: { render: () => undefined }
  };

  try {
    registerSceneControlsHook();
    assert.equal(handlers.length, 1);
    callback(handlers[0]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    globalThis.canvas = previousCanvas;
  }
}

function makeItem({ type = "feat", rebreyaFlags = {}, teyvankalFlags = null } = {}) {
  return {
    type,
    flags: {
      ...(Object.keys(rebreyaFlags).length ? { "rebreya-main": rebreyaFlags } : {}),
      ...(teyvankalFlags ? { teyvankal: teyvankalFlags } : {})
    },
    getFlag: (scope, key) => scope === "rebreya-main" ? rebreyaFlags[key] : undefined
  };
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.listeners = {};
    this.innerHTML = "";
    this.id = "";
    this.style = {};
    this.type = "";
    this.title = "";
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.append(child));
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  querySelector(selector) {
    if (selector === "[data-rebreya-player-inventory-button='true']") {
      return this.children.find((child) => child.dataset.rebreyaPlayerInventoryButton === "true") ?? null;
    }

    if (selector === "#players") {
      for (const child of this.children) {
        if (child.id === "players") {
          return child;
        }

        const nestedMatch = child.querySelector?.("#players");
        if (nestedMatch) {
          return nestedMatch;
        }
      }
    }

    return null;
  }
}

function createFakeDocument() {
  const document = {
    body: null,
    createElement(tagName) {
      return new FakeElement(tagName, this);
    }
  };
  document.body = new FakeElement("body", document);
  return document;
}

test("BG3 hotbar auto-add suppression marks Rebreya feat creations", () => {
  const options = {};
  const item = makeItem({ rebreyaFlags: { automation: { status: "partial" } } });

  assert.equal(shouldSuppressBg3HotbarAutoAdd(item), true);
  assert.equal(applyBg3HotbarAutoAddSuppression(item, options), true);
  assert.equal(options.noBG3AutoAdd, true);
});

test("BG3 hotbar auto-add suppression covers Teyvankal feat data", () => {
  const options = {};
  const item = makeItem({ teyvankalFlags: { section: "Младшие черты" } });

  assert.equal(shouldSuppressBg3HotbarAutoAdd(item), true);
  assert.equal(applyBg3HotbarAutoAddSuppression(item, options), true);
  assert.equal(options.noBG3AutoAdd, true);
});

test("BG3 hotbar auto-add suppression leaves unrelated items alone", () => {
  const options = {};

  assert.equal(shouldSuppressBg3HotbarAutoAdd(makeItem({ type: "weapon", rebreyaFlags: { managed: true } })), false);
  assert.equal(shouldSuppressBg3HotbarAutoAdd(makeItem({ type: "feat" })), false);
  assert.equal(applyBg3HotbarAutoAddSuppression(makeItem({ type: "feat" }), options), false);
  assert.equal(options.noBG3AutoAdd, undefined);
});

test("BG3 hotbar common actions are skipped for Rebreya storage actors", async () => {
  const created = [];
  const actor = {
    type: "npc",
    flags: {
      "rebreya-main": {
        storage: { enabled: true },
        groundPilePrototype: { enabled: true }
      }
    },
    createEmbeddedDocuments: async (...args) => {
      created.push(args);
      return [{ uuid: "Actor.loot.Item.dash" }];
    }
  };
  class AutoPopulateCreateToken {}
  AutoPopulateCreateToken._getCombatActionsList = async (targetActor) => {
    await targetActor.createEmbeddedDocuments("Item", [{ name: "Dash" }]);
    return ["Actor.loot.Item.dash"];
  };

  assert.equal(shouldSkipBg3HotbarCommonActionsForActor(actor), true);
  assert.equal(await patchBg3HotbarStorageCommonActions({
    force: true,
    importModule: async () => ({ AutoPopulateCreateToken })
  }), true);

  assert.deepEqual(await AutoPopulateCreateToken._getCombatActionsList(actor), []);
  assert.deepEqual(created, []);
});

test("BG3 hotbar common actions still populate regular actors", async () => {
  const actor = {
    type: "npc",
    flags: {},
    createEmbeddedDocuments: async () => [{ uuid: "Actor.guard.Item.dash" }]
  };
  class AutoPopulateCreateToken {}
  AutoPopulateCreateToken._getCombatActionsList = async () => ["Actor.guard.Item.dash"];

  assert.equal(shouldSkipBg3HotbarCommonActionsForActor(actor), false);
  assert.equal(await patchBg3HotbarStorageCommonActions({
    force: true,
    importModule: async () => ({ AutoPopulateCreateToken })
  }), true);

  assert.deepEqual(await AutoPopulateCreateToken._getCombatActionsList(actor), ["Actor.guard.Item.dash"]);
});

test("BG3 hotbar ignores unrelated module flags without a Rebreya storage marker", () => {
  assert.equal(shouldSkipBg3HotbarCommonActionsForActor({
    type: "npc",
    flags: {
      "foreign-module": { data: { enabled: true, type: "pile" } }
    }
  }), false);
});

test("BG3 hotbar death save data tolerates actors without death saves", () => {
  assert.deepEqual(
    getBg3DeathSaveData({ type: "group", system: { attributes: {} } }, "show"),
    { display: "show", success: 0, failure: 0 }
  );
  assert.deepEqual(
    getBg3DeathSaveData({
      type: "character",
      system: {
        attributes: {
          death: {
            success: 2,
            failure: 1
          }
        }
      }
    }, "only"),
    { display: "only", success: 2, failure: 1 }
  );
});

test("BG3 hotbar death saves container getData is patched to avoid missing death data crashes", async () => {
  const previousGame = globalThis.game;
  class DeathSavesContainer {}
  DeathSavesContainer.prototype.getData = async function getData() {
    return {
      display: "show",
      success: this.actor.system.attributes.death.success || 0,
      failure: this.actor.system.attributes.death.failure || 0
    };
  };
  let importedPath = "";
  globalThis.game = {
    settings: {
      get: (_moduleId, key) => key === "showDeathSavingThrow" ? "show" : null
    }
  };

  try {
    assert.equal(await patchBg3HotbarDeathSavesContainer({
      force: true,
      importModule: async (path) => {
        importedPath = path;
        return { DeathSavesContainer };
      }
    }), true);

    const instance = new DeathSavesContainer();
    instance.actor = { type: "group", system: { attributes: {} } };

    assert.match(importedPath, /DeathSavesContainer\.js$/u);
    assert.deepEqual(await instance.getData(), { display: "show", success: 0, failure: 0 });
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("fixed-size Rebreya race items update character size after creation", async () => {
  const updates = [];
  const actor = {
    type: "character",
    system: { traits: { size: "med" } },
    update: async (patch) => {
      updates.push(patch);
      actor.system.traits.size = patch["system.traits.size"];
    }
  };
  const item = makeItem({
    type: "race",
    rebreyaFlags: { fixedSize: "sm" }
  });
  item.parent = actor;

  assert.equal(await applyFixedRaceSize(item), true);
  assert.deepEqual(updates, [{ "system.traits.size": "sm" }]);
});

test("variable-size race items leave character size to dnd5e advancement", async () => {
  const actor = {
    type: "character",
    system: { traits: { size: "med" } },
    update: async () => {
      throw new Error("size should not update");
    }
  };
  const item = makeItem({
    type: "race",
    rebreyaFlags: { fixedSize: null }
  });
  item.parent = actor;

  assert.equal(await applyFixedRaceSize(item), false);
});

test("player list inventory button shows and refreshes the active group token", async () => {
  const document = createFakeDocument();
  const playersElement = new FakeElement("div", document);
  playersElement.getBoundingClientRect = () => ({
    top: 100,
    right: 220,
    bottom: 220,
    left: 20,
    width: 200,
    height: 120
  });
  const opened = [];
  const groupA = {
    prototypeToken: {
      texture: {
        src: "tokens/groups/group-a.webp"
      }
    },
    img: "actors/groups/group-a.webp"
  };
  const groupB = {
    prototypeToken: {
      texture: {
        src: "tokens/groups/group-b.webp"
      }
    },
    img: "actors/groups/group-b.webp"
  };

  const inserted = ensurePlayerInventoryQuickButton(playersElement, {
    getGroupContext: () => ({ groupActor: groupA }),
    openInventoryApp: async () => {
      opened.push(true);
    }
  }, {
    viewport: {
      innerWidth: 1000,
      innerHeight: 800
    }
  });
  const insertedAgain = ensurePlayerInventoryQuickButton(playersElement, {
    getGroupContext: () => ({ groupActor: groupB }),
    openInventoryApp: async () => {
      opened.push("duplicate");
    }
  }, {
    viewport: {
      innerWidth: 1000,
      innerHeight: 800
    }
  });

  const button = document.body.children[0];
  assert.equal(inserted, true);
  assert.equal(insertedAgain, false);
  assert.equal(playersElement.children.length, 0);
  assert.equal(document.body.children.length, 1);
  assert.equal(button.parentElement, document.body);
  assert.equal(button.dataset.rebreyaPlayerInventoryButton, "true");
  assert.equal(button.classList.contains("rm-player-inventory-button"), true);
  assert.equal(button.getAttribute("aria-label"), "Открыть инвентарь Rebreya");
  assert.equal(button.children.length, 1);
  assert.equal(button.children[0].tagName, "IMG");
  assert.equal(button.children[0].src, "tokens/groups/group-b.webp");
  assert.equal(button.children[0].getAttribute("aria-hidden"), "true");
  assert.equal(button.style.left, "calc(clamp(220px, 8.5vw, 280px) + 8px)");
  assert.match(button.style.top, /vh$/u);

  await button.listeners.click[0]({
    preventDefault() {},
    stopPropagation() {}
  });

  assert.deepEqual(opened, [true]);
});

test("player inventory button anchor prefers the outer player list app", () => {
  const document = createFakeDocument();
  const appRoot = new FakeElement("div", document);
  const innerHtml = new FakeElement("div", document);
  const innerPlayers = new FakeElement("div", document);
  appRoot.id = "players";
  innerPlayers.id = "players";
  innerHtml.append(innerPlayers);

  const anchor = resolvePlayerInventoryButtonAnchor({ element: appRoot }, innerHtml);

  assert.equal(anchor, appRoot);
});

test("scene controls create a separate Rebreya group for record controls", () => {
  withSceneControlsHandler((handler) => {
    const controls = {
      tokens: {
        name: "tokens",
        order: 20,
        tools: {}
      }
    };

    handler(controls);

    assert.deepEqual(controls.tokens.tools, {});
    assert.ok(controls["rebreya-main-rebreya"]);
    assert.equal(controls["rebreya-main-rebreya"].activeTool, "rebreya-main-panel");
    assert.equal(controls["rebreya-main-rebreya"].tools["rebreya-main-panel"].onChange, undefined);
    assert.equal(controls["rebreya-main-rebreya"].tools["rebreya-main-panel"].button, undefined);
    assert.deepEqual(Object.keys(controls["rebreya-main-rebreya"].tools), [
      "rebreya-main-panel",
      "rebreya-main-economy",
      "rebreya-main-inventory",
      "rebreya-main-groups",
      "rebreya-main-calendar",
      "rebreya-main-cosmology",
      "rebreya-main-lootgen"
    ]);
    const groupsTool = controls["rebreya-main-rebreya"].tools["rebreya-main-groups"];
    assert.equal(groupsTool.title, "REBREYA_MAIN.Controls.OpenGroups");
    assert.equal(groupsTool.visible, true);
    const cosmologyTool = controls["rebreya-main-rebreya"].tools["rebreya-main-cosmology"];
    assert.equal(cosmologyTool.title, "REBREYA_MAIN.Controls.OpenCosmology");
    assert.equal(cosmologyTool.icon, "fa-solid fa-solar-system");
    assert.equal(cosmologyTool.visible, true);
  });
});

test("scene controls remove the hidden Rebreya placeholder row from layout", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(
    css,
    /#scene-controls-tools\s*>\s*li:has\(>\s*\.tool\[data-tool="rebreya-main-panel"\]\)\s*\{[^}]*display:\s*none;/su
  );
  assert.doesNotMatch(
    css,
    /#scene-controls-tools\s+\.tool\[data-tool="rebreya-main-panel"\]\s*\{[^}]*display:\s*none;/su
  );
});

test("scene controls create a separate Rebreya group for array controls", () => {
  withSceneControlsHandler((handler) => {
    const tokenControl = {
      name: "tokens",
      order: 20,
      tools: []
    };
    const controls = [
      { name: "measure", order: 10, tools: [] },
      tokenControl,
      { name: "tiles", order: 30, tools: [] }
    ];

    handler(controls);

    assert.deepEqual(tokenControl.tools, []);
    const rebreyaIndex = controls.findIndex((control) => control?.name === "rebreya-main-rebreya");
    assert.equal(rebreyaIndex, 2);
    assert.equal(controls[rebreyaIndex].activeTool, "rebreya-main-panel");
    assert.equal(controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-panel").onChange, undefined);
    assert.equal(controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-panel").button, undefined);
    assert.deepEqual(controls[rebreyaIndex].tools.map((tool) => tool.name), [
      "rebreya-main-panel",
      "rebreya-main-economy",
      "rebreya-main-inventory",
      "rebreya-main-groups",
      "rebreya-main-calendar",
      "rebreya-main-cosmology",
      "rebreya-main-lootgen"
    ]);
    const groupsTool = controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-groups");
    assert.equal(groupsTool.title, "REBREYA_MAIN.Controls.OpenGroups");
    assert.equal(groupsTool.visible, true);
    const cosmologyTool = controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-cosmology");
    assert.equal(cosmologyTool.title, "REBREYA_MAIN.Controls.OpenCosmology");
    assert.equal(cosmologyTool.icon, "fa-solid fa-solar-system");
    assert.equal(cosmologyTool.visible, true);
  });
});

test("scene controls hide groups tool from non-GM users", () => {
  withSceneControlsHandlerForUser({ isGM: false }, (handler) => {
    const controls = {
      tokens: {
        name: "tokens",
        order: 20,
        tools: {}
      }
    };

    handler(controls);

    const groupsTool = controls["rebreya-main-rebreya"].tools["rebreya-main-groups"];
    assert.equal(groupsTool.visible, false);
  });
});

test("scene controls expose Economy to non-GM users", () => {
  withSceneControlsHandlerForUser({ isGM: false }, (handler) => {
    const controls = { tokens: { name: "tokens", order: 20, tools: {} } };
    handler(controls);

    const economyTool = controls["rebreya-main-rebreya"].tools["rebreya-main-economy"];
    assert.equal(economyTool.visible, true);
    assert.equal(economyTool.title, "REBREYA_MAIN.Controls.OpenEconomy");
  });
});

test("scene controls deactivate the tiles layer before Rebreya app buttons run", () => {
  withSceneControlsHandler((handler) => {
    let deactivationCount = 0;
    const tilesLayer = {
      options: { name: "tiles" },
      deactivate: () => {
        deactivationCount += 1;
      }
    };
    globalThis.canvas = { activeLayer: tilesLayer };
    const controls = {
      tokens: {
        name: "tokens",
        order: 20,
        tools: {}
      }
    };

    handler(controls);
    controls["rebreya-main-rebreya"].onChange(new Event("change"), true);

    assert.equal(deactivationCount, 1);
  });
});
