import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "rebreya-main";
const UPGRADE_EQUIPMENT_TYPE = "\u0423\u0441\u043e\u0432\u0435\u0440\u0448\u0435\u043d\u0441\u0442\u0432\u043e\u0432\u0430\u043d\u0438\u0435";

function installFoundryStubs() {
  const previousFoundry = globalThis.foundry;
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
      },
      setProperty(source, path, value) {
        const parts = String(path ?? "").split(".").filter(Boolean);
        let target = source;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = value;
        return true;
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

class FakeItem {
  constructor(actor, data) {
    this.parent = actor;
    this.actor = actor;
    this.id = data._id;
    this._id = data._id;
    this.uuid = `Actor.${actor.id}.Item.${this.id}`;
    this.name = data.name ?? this.id;
    this.type = data.type ?? "loot";
    this.system = structuredClone(data.system ?? {});
    this.flags = structuredClone(data.flags ?? {});
    this.isOwner = data.isOwner ?? true;
    this.deleted = false;
    this.updates = [];
  }

  getFlag(scope, key) {
    return String(key ?? "").split(".").reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), this.flags?.[scope]);
  }

  toObject() {
    return structuredClone({
      _id: this.id,
      name: this.name,
      type: this.type,
      system: this.system,
      flags: this.flags
    });
  }

  async update(patch) {
    this.updates.push(patch);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  }

  async delete() {
    this.deleted = true;
    this.parent.items.contents = this.parent.items.contents.filter((item) => item !== this);
  }
}

class FakeActor {
  constructor({ id = "actor-a", isOwner = true } = {}) {
    this.id = id;
    this.type = "character";
    this.isOwner = isOwner;
    this.items = {
      contents: [],
      get: (id) => this.items.contents.find((item) => item.id === id) ?? null
    };
    this.created = [];
  }

  addItem(data) {
    const item = new FakeItem(this, data);
    this.items.contents.push(item);
    return item;
  }

  async createEmbeddedDocuments(type, documents) {
    assert.equal(type, "Item");
    return documents.map((documentData, index) => {
      const item = this.addItem({
        ...documentData,
        _id: documentData._id ?? `created-${this.created.length + index + 1}`
      });
      this.created.push(item);
      return item;
    });
  }
}

function makeUpgrade(actor, data = {}) {
  return actor.addItem({
    _id: data._id ?? "mithril-upgrade",
    name: data.name ?? "Mithril Upgrade",
    type: data.type ?? "loot",
    system: {
      quantity: data.quantity ?? 1,
      ...(data.system ?? {})
    },
    flags: {
      [MODULE_ID]: {
        equipmentType: UPGRADE_EQUIPMENT_TYPE,
        gearId: data.gearId ?? "mithril-upgrade",
        ...(data.flags?.[MODULE_ID] ?? {})
      }
    }
  });
}

test("installing an upgrade stores it inside the host item and links the host slot", async () => {
  const restore = installFoundryStubs();
  try {
    const { ItemUpgradeService } = await import(`../scripts/data/item-upgrade-service.js?install-single=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "longsword",
      name: "Longsword",
      type: "weapon",
      system: { quantity: 1 },
      flags: {}
    });
    const upgrade = makeUpgrade(actor, { _id: "storm-stone" });

    const service = new ItemUpgradeService();
    const installed = await service.installUpgrade(host, upgrade);

    assert.equal(installed, upgrade);
    assert.equal(upgrade.system.container, "longsword");
    assert.deepEqual(host.flags[MODULE_ID].itemUpgrades.installed, [
      { itemId: "storm-stone", slotIndex: 1 }
    ]);
    assert.equal(upgrade.flags[MODULE_ID].installedUpgrade.hostItemId, "longsword");
    assert.equal(upgrade.flags[MODULE_ID].installedUpgrade.slotIndex, 1);
  }
  finally {
    restore();
  }
});

test("installing one upgrade from a stack creates a contained copy and leaves the rest in inventory", async () => {
  const restore = installFoundryStubs();
  try {
    const { ItemUpgradeService } = await import(`../scripts/data/item-upgrade-service.js?install-stack=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "breastplate",
      name: "Breastplate",
      type: "equipment",
      system: { type: { value: "medium" }, quantity: 1 },
      flags: {}
    });
    const upgradeStack = makeUpgrade(actor, { _id: "mithril-stack", quantity: 4 });

    const service = new ItemUpgradeService();
    const installed = await service.installUpgrade(host, upgradeStack);

    assert.notEqual(installed, upgradeStack);
    assert.equal(upgradeStack.system.quantity, 3);
    assert.equal(installed.system.quantity, 1);
    assert.equal(installed.system.container, "breastplate");
    assert.equal(installed.flags[MODULE_ID].installedUpgrade.hostItemId, "breastplate");
    assert.deepEqual(host.flags[MODULE_ID].itemUpgrades.installed, [
      { itemId: installed.id, slotIndex: 1 }
    ]);
  }
  finally {
    restore();
  }
});

test("removing an installed upgrade clears its container and returns it to inventory", async () => {
  const restore = installFoundryStubs();
  try {
    const { ItemUpgradeService } = await import(`../scripts/data/item-upgrade-service.js?remove=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "longsword",
      name: "Longsword",
      type: "weapon",
      system: { quantity: 1 },
      flags: {}
    });
    const upgrade = makeUpgrade(actor, { _id: "storm-stone" });

    const service = new ItemUpgradeService();
    await service.installUpgrade(host, upgrade);
    const removed = await service.removeUpgrade(host, upgrade.id);

    assert.equal(removed, upgrade);
    assert.equal(upgrade.system.container, null);
    assert.equal(upgrade.flags[MODULE_ID].installedUpgrade, null);
    assert.deepEqual(host.flags[MODULE_ID].itemUpgrades.installed, []);
  }
  finally {
    restore();
  }
});

test("upgrade capacity can be raised to three slots and blocks the fourth upgrade", async () => {
  const restore = installFoundryStubs();
  try {
    const { ItemUpgradeService } = await import(`../scripts/data/item-upgrade-service.js?capacity=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "workshop-sword",
      name: "Workshop Sword",
      type: "weapon",
      system: { quantity: 1 },
      flags: {}
    });
    const upgrades = [
      makeUpgrade(actor, { _id: "upgrade-a" }),
      makeUpgrade(actor, { _id: "upgrade-b" }),
      makeUpgrade(actor, { _id: "upgrade-c" }),
      makeUpgrade(actor, { _id: "upgrade-d" })
    ];

    const service = new ItemUpgradeService();
    await service.setUpgradeCapacity(host, 3);
    await service.installUpgrade(host, upgrades[0]);
    await service.installUpgrade(host, upgrades[1]);
    await service.installUpgrade(host, upgrades[2]);

    assert.deepEqual(host.flags[MODULE_ID].itemUpgrades.installed, [
      { itemId: "upgrade-a", slotIndex: 1 },
      { itemId: "upgrade-b", slotIndex: 2 },
      { itemId: "upgrade-c", slotIndex: 3 }
    ]);
    await assert.rejects(
      () => service.installUpgrade(host, upgrades[3]),
      /нет свободного слота/u
    );
    await assert.rejects(
      () => service.setUpgradeCapacity(host, 2),
      /меньше уже установленных/u
    );
  }
  finally {
    restore();
  }
});

test("installed actor upgrade ids include items contained by upgraded hosts", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      ItemUpgradeService,
      getInstalledActorUpgradeItemIds
    } = await import(`../scripts/data/item-upgrade-service.js?installed-ids=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "longsword",
      name: "Longsword",
      type: "weapon",
      system: { quantity: 1 },
      flags: {}
    });
    const upgrade = makeUpgrade(actor, { _id: "storm-stone" });

    const service = new ItemUpgradeService();
    await service.installUpgrade(host, upgrade);

    assert.deepEqual([...getInstalledActorUpgradeItemIds(actor)], ["storm-stone"]);
  }
  finally {
    restore();
  }
});

test("dnd5e item filter hook hides installed upgrades before inventory rows render", async () => {
  const restoreFoundry = installFoundryStubs();
  const previousHooks = globalThis.Hooks;
  const listeners = [];
  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
    }
  };

  try {
    const {
      registerItemUpgradeFilterHook
    } = await import(`../scripts/integrations/item-upgrade-sheet.js?filter-hook=${Date.now()}`);
    const { ItemUpgradeService } = await import(`../scripts/data/item-upgrade-service.js?filter-hook=${Date.now()}`);
    const actor = new FakeActor();
    const host = actor.addItem({
      _id: "longsword",
      name: "Longsword",
      type: "weapon",
      system: { quantity: 1 },
      flags: {}
    });
    const upgrade = makeUpgrade(actor, { _id: "storm-stone" });

    assert.equal(registerItemUpgradeFilterHook(), true);
    const filter = listeners.find((entry) => entry.hookName === "dnd5e.filterItem")?.listener;
    assert.equal(typeof filter, "function");

    const service = new ItemUpgradeService();
    await service.installUpgrade(host, upgrade);

    assert.equal(filter({}, upgrade, new Set()), false);
    assert.equal(filter({}, host, new Set()), undefined);
  }
  finally {
    globalThis.Hooks = previousHooks;
    restoreFoundry();
  }
});

test("item upgrade drop data reads Foundry v13 DragDrop payloads", async () => {
  const previousConfig = globalThis.CONFIG;
  const previousTextEditor = globalThis.TextEditor;
  const payload = { uuid: "Actor.actor-a.Item.storm-stone", type: "Item" };
  globalThis.CONFIG = {
    ux: {
      DragDrop: {
        getPayload(event) {
          return event.payload;
        }
      }
    }
  };
  globalThis.TextEditor = {
    getDragEventData() {
      return null;
    }
  };

  try {
    const { getItemUpgradeDropData } = await import(`../scripts/integrations/item-upgrade-sheet.js?drop-payload=${Date.now()}`);
    assert.deepEqual(getItemUpgradeDropData({ payload }), payload);
  }
  finally {
    globalThis.CONFIG = previousConfig;
    globalThis.TextEditor = previousTextEditor;
  }
});

test("item upgrade drop data falls back when Foundry DragDrop returns an empty object", async () => {
  const previousConfig = globalThis.CONFIG;
  const previousTextEditor = globalThis.TextEditor;
  const payload = { uuid: "Actor.actor-a.Item.storm-stone", type: "Item" };
  globalThis.CONFIG = {
    ux: {
      DragDrop: {
        getPayload() {
          return {};
        }
      }
    }
  };
  globalThis.TextEditor = {
    getDragEventData() {
      return payload;
    }
  };

  try {
    const { getItemUpgradeDropData } = await import(`../scripts/integrations/item-upgrade-sheet.js?drop-payload-fallback=${Date.now()}`);
    assert.deepEqual(getItemUpgradeDropData({}), payload);
  }
  finally {
    globalThis.CONFIG = previousConfig;
    globalThis.TextEditor = previousTextEditor;
  }
});

test("actor sheet inventory rows install a dropped upgrade onto the target item", async () => {
  const restoreFoundry = installFoundryStubs();
  const previousHTMLElement = globalThis.HTMLElement;
  const previousWindow = globalThis.window;
  const previousUi = globalThis.ui;
  const previousFromUuid = globalThis.fromUuid;
  const previousConfig = globalThis.CONFIG;
  const previousTextEditor = globalThis.TextEditor;

  class FakeHTMLElement {
    constructor({ dataset = {}, selectorAll = {} } = {}) {
      this.dataset = dataset;
      this.selectorAll = selectorAll;
      this.listeners = {};
      this.children = [];
      this.classList = {
        values: new Set(),
        add: (...names) => names.forEach((name) => this.classList.values.add(name)),
        remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
        contains: (name) => this.classList.values.has(name)
      };
    }

    querySelectorAll(selector) {
      return this.selectorAll[selector] ?? [];
    }

    addEventListener(type, listener, options) {
      this.listeners[type] ??= [];
      this.listeners[type].push(listener);
      this.listenerOptions ??= {};
      this.listenerOptions[type] ??= [];
      this.listenerOptions[type].push(options);
    }

    contains(target) {
      return target === this || this.children.includes(target);
    }

    closest() {
      return null;
    }
  }

  const actor = new FakeActor();
  const host = actor.addItem({
    _id: "katana",
    name: "Katana",
    type: "weapon",
    system: { quantity: 1 },
    flags: {}
  });
  const upgrade = makeUpgrade(actor, { _id: "elven-steel" });
  const hostRow = new FakeHTMLElement({ dataset: { itemId: host.id } });
  const upgradeRow = new FakeHTMLElement({ dataset: { itemId: upgrade.id } });
  const root = new FakeHTMLElement({
    selectorAll: {
      "[data-item-id]": [hostRow, upgradeRow]
    }
  });
  const payload = { type: "Item", uuid: upgrade.uuid };
  const calls = [];
  let rendered = false;

  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {}
  };
  globalThis.ui = {
    notifications: {
      info() {},
      error() {},
      warn() {}
    }
  };
  globalThis.fromUuid = async (uuid) => (uuid === upgrade.uuid ? upgrade : null);
  globalThis.CONFIG = {};
  globalThis.TextEditor = {
    getDragEventData(event) {
      return event.dragData ?? null;
    }
  };

  try {
    const {
      bindItemUpgradeInventoryRows
    } = await import(`../scripts/integrations/item-upgrade-sheet.js?inventory-row-drop=${Date.now()}`);
    const bound = bindItemUpgradeInventoryRows(root, {
      actor,
      app: {},
      moduleApi: {
        async installItemUpgrade(targetItem, droppedItem) {
          calls.push([targetItem, droppedItem]);
          return droppedItem;
        },
        async refreshOpenApps() {}
      },
      async rerenderActorSheet() {
        rendered = true;
      }
    });

    assert.equal(bound, true);
    assert.equal(hostRow.listeners.dragover.length, 1);
    assert.equal(hostRow.listeners.drop.length, 1);
    assert.equal(upgradeRow.listeners.drop, undefined);

    const event = {
      dragData: payload,
      dataTransfer: {
        dropEffect: "",
        types: ["text/plain"],
        getData() {
          return JSON.stringify(payload);
        }
      },
      preventDefaultCalled: false,
      stopPropagationCalled: false,
      preventDefault() {
        this.preventDefaultCalled = true;
      },
      stopPropagation() {
        this.stopPropagationCalled = true;
      }
    };

    hostRow.listeners.dragover[0](event);
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(event.stopPropagationCalled, true);
    assert.equal(event.dataTransfer.dropEffect, "move");
    assert.equal(hostRow.classList.contains("is-rebreya-upgrade-drop-target"), true);

    await hostRow.listeners.drop[0](event);

    assert.deepEqual(calls, [[host, upgrade]]);
    assert.equal(rendered, true);
    assert.equal(hostRow.classList.contains("is-rebreya-upgrade-drop-target"), false);
  }
  finally {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.window = previousWindow;
    globalThis.ui = previousUi;
    globalThis.fromUuid = previousFromUuid;
    globalThis.CONFIG = previousConfig;
    globalThis.TextEditor = previousTextEditor;
    restoreFoundry();
  }
});

test("item upgrade hold ring is shown immediately when Sequencer is active", async () => {
  const previousWindow = globalThis.window;
  const previousGame = globalThis.game;
  const previousSequence = globalThis.Sequence;
  const classes = new Set();
  const panel = {
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      }
    },
    style: {
      setProperty() {}
    }
  };
  globalThis.window = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {}
  };
  globalThis.game = {
    modules: {
      get(moduleName) {
        return moduleName === "sequencer" ? { active: true } : null;
      }
    }
  };
  globalThis.Sequence = class {
    thenDo() {
      return this;
    }

    wait() {
      return this;
    }

    play() {
      return this;
    }
  };

  try {
    const { startItemUpgradeHold } = await import(`../scripts/integrations/item-upgrade-sheet.js?hold-ring=${Date.now()}`);
    startItemUpgradeHold(panel, "Actor.actor-a.Item.storm-stone");
    assert.equal(classes.has("is-dragover"), true);
    assert.equal(classes.has("is-holding"), true);
  }
  finally {
    globalThis.window = previousWindow;
    globalThis.game = previousGame;
    globalThis.Sequence = previousSequence;
  }
});
