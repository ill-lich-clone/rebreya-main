import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

function makeActor({ flags = {}, currency = {} } = {}) {
  return {
    type: "character",
    flags,
    system: { currency },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function makeItem({ type = "loot", quantity, flags = {} } = {}) {
  return {
    type,
    flags,
    system: quantity === undefined ? {} : { quantity },
    toObject() {
      return { type: this.type, flags: this.flags, system: this.system };
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("universal belt slot count defaults to one and clamps actor flag values", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      getUniversalBeltUnlockedSlotCount
    } = await import(`../scripts/integrations/universal-belt.js?helpers=${Date.now()}`);

    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor()), 1);
    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 0 } } }
    })), 1);
    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 99 } } }
    })), 3);
  }
  finally {
    restore();
  }
});

test("universal belt accepts physical quantity items and rejects non-physical documents", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      isUniversalBeltEligibleItem
    } = await import(`../scripts/integrations/universal-belt.js?eligibility=${Date.now()}`);

    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "weapon", quantity: 1 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "equipment", quantity: 1 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "loot", quantity: 0 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "spell" })), false);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "class" })), false);
  }
  finally {
    restore();
  }
});

test("universal belt purchase spends gp first and makes pp change into gp", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      calculateUniversalBeltPayment
    } = await import(`../scripts/integrations/universal-belt.js?payment=${Date.now()}`);

    assert.deepEqual(calculateUniversalBeltPayment({ gp: 800, pp: 2 }), {
      ok: true,
      currency: { gp: 300, pp: 2 }
    });
    assert.deepEqual(calculateUniversalBeltPayment({ gp: 495, pp: 1 }), {
      ok: true,
      currency: { gp: 5, pp: 0 }
    });
    assert.deepEqual(calculateUniversalBeltPayment({ gp: 499, pp: 0 }), {
      ok: false,
      currency: { gp: 499, pp: 0 }
    });
  }
  finally {
    restore();
  }
});

class FakeItem {
  constructor(actor, data) {
    this.parent = actor;
    this.actor = actor;
    this.id = data._id;
    this.uuid = `Actor.${actor.id}.Item.${this.id}`;
    this.name = data.name;
    this.type = data.type ?? "loot";
    this.img = data.img ?? "icons/svg/item-bag.svg";
    this.system = structuredClone(data.system ?? {});
    this.flags = structuredClone(data.flags ?? {});
    this.deleted = false;
  }

  toObject() {
    return structuredClone({
      _id: this.id,
      name: this.name,
      type: this.type,
      img: this.img,
      system: this.system,
      flags: this.flags
    });
  }

  getFlag(scope, key) {
    return String(key).split(".").reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), this.flags?.[scope]);
  }

  async update(patch) {
    this.parent.updates.push([this.id, patch]);
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
  constructor({ id = "actor-a", flags = {}, currency = {} } = {}) {
    this.id = id;
    this.type = "character";
    this.isOwner = true;
    this.flags = structuredClone(flags);
    this.system = { currency: structuredClone(currency) };
    this.created = [];
    this.updates = [];
    this.items = {
      contents: [],
      get: (id) => this.items.contents.find((item) => item.id === id) ?? null
    };
  }

  addItem(data) {
    const item = new FakeItem(this, data);
    this.items.contents.push(item);
    return item;
  }

  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  }

  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value;
    return value;
  }

  async update(patch) {
    this.updates.push(["actor", patch]);
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
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

test("assigning a stack to the belt splits exactly one item into the slot", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      assignItemToUniversalBeltSlot,
      getUniversalBeltItemSlot
    } = await import(`../scripts/integrations/universal-belt.js?split=${Date.now()}`);
    const actor = new FakeActor();
    const source = actor.addItem({
      _id: "item-stack",
      name: "Зелье лечения",
      type: "consumable",
      system: { quantity: 5 }
    });

    const belted = await assignItemToUniversalBeltSlot(actor, 1, source);

    assert.equal(source.system.quantity, 4);
    assert.equal(belted.system.quantity, 1);
    assert.equal(getUniversalBeltItemSlot(belted), 1);
    assert.equal(actor.items.contents.length, 2);
  }
  finally {
    restore();
  }
});

test("assigning a quantity-one item moves that item into the belt without creating a clone", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      assignItemToUniversalBeltSlot,
      getUniversalBeltItemSlot
    } = await import(`../scripts/integrations/universal-belt.js?move-one=${Date.now()}`);
    const actor = new FakeActor();
    const source = actor.addItem({
      _id: "dagger",
      name: "Кинжал",
      type: "weapon",
      system: { quantity: 1 }
    });

    const belted = await assignItemToUniversalBeltSlot(actor, 1, source);

    assert.equal(belted, source);
    assert.equal(actor.created.length, 0);
    assert.equal(getUniversalBeltItemSlot(source), 1);
  }
  finally {
    restore();
  }
});

test("replacing an occupied slot removes and merges the previous belt item", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      assignItemToUniversalBeltSlot,
      getUniversalBeltItemSlot
    } = await import(`../scripts/integrations/universal-belt.js?replace=${Date.now()}`);
    const actor = new FakeActor();
    const normalPotion = actor.addItem({
      _id: "normal-potion",
      name: "Зелье лечения",
      type: "consumable",
      system: { quantity: 2 }
    });
    const beltedPotion = actor.addItem({
      _id: "belted-potion",
      name: "Зелье лечения",
      type: "consumable",
      system: { quantity: 1 },
      flags: { "rebreya-main": { universalBelt: { slot: 1 } } }
    });
    const dagger = actor.addItem({
      _id: "dagger",
      name: "Кинжал",
      type: "weapon",
      system: { quantity: 1 }
    });

    await assignItemToUniversalBeltSlot(actor, 1, dagger);

    assert.equal(normalPotion.system.quantity, 3);
    assert.equal(beltedPotion.deleted, true);
    assert.equal(getUniversalBeltItemSlot(dagger), 1);
  }
  finally {
    restore();
  }
});

test("purchasing belt slots unlocks slot two then slot three and updates gp and pp", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      purchaseUniversalBeltSlot,
      getUniversalBeltUnlockedSlotCount
    } = await import(`../scripts/integrations/universal-belt.js?purchase=${Date.now()}`);
    const actor = new FakeActor({ currency: { gp: 495, pp: 101 } });

    assert.equal(await purchaseUniversalBeltSlot(actor), 2);
    assert.equal(getUniversalBeltUnlockedSlotCount(actor), 2);
    assert.equal(actor.system.currency.gp, 5);
    assert.equal(actor.system.currency.pp, 100);

    assert.equal(await purchaseUniversalBeltSlot(actor), 3);
    assert.equal(getUniversalBeltUnlockedSlotCount(actor), 3);
    assert.equal(actor.system.currency.gp, 5);
    assert.equal(actor.system.currency.pp, 50);
  }
  finally {
    restore();
  }
});

test("purchasing belt slot fails without enough gp and pp", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      purchaseUniversalBeltSlot
    } = await import(`../scripts/integrations/universal-belt.js?purchase-fail=${Date.now()}`);
    const actor = new FakeActor({ currency: { gp: 499, pp: 0 } });

    await assert.rejects(
      () => purchaseUniversalBeltSlot(actor),
      /Недостаточно средств/u
    );
    assert.equal(actor.system.currency.gp, 499);
  }
  finally {
    restore();
  }
});

test("using a belt item calls native item use flow without movement automation", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      useUniversalBeltItem
    } = await import(`../scripts/integrations/universal-belt.js?use=${Date.now()}`);
    const actor = new FakeActor();
    const item = actor.addItem({
      _id: "potion",
      name: "Зелье лечения",
      type: "consumable",
      system: { quantity: 1 },
      flags: { "rebreya-main": { universalBelt: { slot: 1 } } }
    });
    const calls = [];
    item.use = async (options) => {
      calls.push(options);
      return "used";
    };

    assert.equal(await useUniversalBeltItem(actor, 1, { type: "click" }), "used");
    assert.deepEqual(calls, [{ event: { type: "click" }, legacy: false }]);
  }
  finally {
    restore();
  }
});

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    if (force === false) this.values.delete(name);
    else this.values.add(name);
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.innerHTML = "";
    this.hidden = false;
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  prepend(...children) {
    for (const child of children.reverse()) {
      child.parentElement = this;
      this.children.unshift(child);
    }
  }

  remove() {
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
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
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === "ul.containers" && child.tagName === "UL" && child.classList.contains("containers")) result.push(child);
        if (selector === ".rm-universal-belt-slot" && child.classList.contains("rm-universal-belt-slot")) result.push(child);
        if (selector === "[data-item-id]" && child.dataset.itemId) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

test("renderUniversalBeltSlots prepends three circular belt slots before native containers", async () => {
  const restore = installFoundryStubs();
  const previousDocument = globalThis.document;
  try {
    const {
      renderUniversalBeltSlots
    } = await import(`../scripts/integrations/universal-belt.js?dom=${Date.now()}`);
    globalThis.document = { createElement: (tag) => new FakeElement(tag) };
    const root = new FakeElement("section");
    const containers = new FakeElement("ul");
    containers.classList.add("containers");
    const nativeContainer = new FakeElement("li");
    nativeContainer.classList.add("container");
    nativeContainer.dataset.itemId = "backpack";
    containers.append(nativeContainer);
    root.append(containers);
    const actor = new FakeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 1 } } }
    });

    assert.equal(renderUniversalBeltSlots(root, actor), true);

    const slotNodes = containers.children.filter((child) => child.classList.contains("rm-universal-belt-slot"));
    assert.equal(slotNodes.length, 3);
    assert.equal(containers.children.at(0).dataset.beltSlot, "1");
    assert.equal(containers.children.at(1).dataset.locked, "true");
    assert.equal(containers.children.at(3).dataset.itemId, "backpack");
  }
  finally {
    globalThis.document = previousDocument;
    restore();
  }
});

test("renderUniversalBeltSlots removes the locked marker from unlocked empty slots", async () => {
  const restore = installFoundryStubs();
  const previousDocument = globalThis.document;
  try {
    const {
      renderUniversalBeltSlots
    } = await import(`../scripts/integrations/universal-belt.js?dom-unlocked=${Date.now()}`);
    globalThis.document = { createElement: (tag) => new FakeElement(tag) };
    const root = new FakeElement("section");
    const containers = new FakeElement("ul");
    containers.classList.add("containers");
    root.append(containers);
    const actor = new FakeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 2 } } }
    });

    assert.equal(renderUniversalBeltSlots(root, actor), true);

    const slotNodes = containers.children.filter((child) => child.classList.contains("rm-universal-belt-slot"));
    assert.equal(slotNodes.at(0).dataset.locked, undefined);
    assert.equal(slotNodes.at(1).dataset.locked, undefined);
    assert.equal(slotNodes.at(2).dataset.locked, "true");
    assert.equal(slotNodes.at(0).children.at(0).children.length, 0);
    assert.equal(slotNodes.at(1).children.at(0).children.length, 0);
    assert.match(slotNodes.at(2).children.at(0).children.at(0).className, /fa-lock/u);
    assert.equal(slotNodes.at(1).children.at(0).dataset.action, undefined);
  }
  finally {
    globalThis.document = previousDocument;
    restore();
  }
});

test("universal belt context hook adds remove action for belted items only", async () => {
  const restore = installFoundryStubs();
  const previousHooks = globalThis.Hooks;
  try {
    let hookListener = null;
    globalThis.Hooks = {
      on(name, listener) {
        if (name === "dnd5e.getItemContextOptions") hookListener = listener;
      }
    };
    const {
      registerUniversalBeltItemContextHook
    } = await import(`../scripts/integrations/universal-belt.js?context=${Date.now()}`);
    const moduleApi = { refreshOpenApps: async () => undefined };
    registerUniversalBeltItemContextHook(moduleApi);

    const actor = new FakeActor();
    const belted = actor.addItem({
      _id: "belted",
      name: "Кинжал",
      type: "weapon",
      system: { quantity: 1 },
      flags: { "rebreya-main": { universalBelt: { slot: 1 } } }
    });
    const normal = actor.addItem({
      _id: "normal",
      name: "Факел",
      type: "loot",
      system: { quantity: 1 }
    });
    const beltedOptions = [];
    const normalOptions = [];

    hookListener(belted, beltedOptions);
    hookListener(normal, normalOptions);

    assert.equal(beltedOptions.some((option) => option.name === "Убрать из пояса"), true);
    assert.equal(normalOptions.some((option) => option.name === "Убрать из пояса"), false);
  }
  finally {
    globalThis.Hooks = previousHooks;
    restore();
  }
});

test("universal belt styles are scoped to dnd5e inventory container strip", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.dnd5e2\.sheet\.actor[\s\S]+\.rm-universal-belt-slot/u);
  assert.match(css, /\.rm-universal-belt-slot\s*\{[\s\S]*border-radius:\s*50%/u);
  assert.match(css, /\.rm-universal-belt-slot\[data-locked="true"\]/u);
  assert.match(css, /\.rm-universal-belt-hidden-item\s*\{[\s\S]*display:\s*none/u);
});
