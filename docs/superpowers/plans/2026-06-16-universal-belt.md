# Universal Belt [Lich] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three Rebreya universal belt slots to the dnd5e character inventory sheet with purchases, stack splitting, item use, and removal.

**Architecture:** Put the belt state and DOM binding in a focused integration module, then call it from the existing dnd5e sheet extension render hooks. Store unlocked slot count on the actor and belt slot assignment on the embedded Item so dnd5e/Rebreya item behavior remains native.

**Tech Stack:** Foundry VTT v13, dnd5e 5.2.x ApplicationV2/V1 sheets, plain ES modules, Node's built-in `node:test`, `styles/main.css`.

---

## File Structure

- Create `scripts/integrations/universal-belt.js`
  - Owns belt constants, flag reads/writes, currency purchase math, item eligibility, item split/merge, item use, DOM insertion, sheet event binding, and dnd5e item context hook registration.
- Modify `scripts/integrations/dnd5e-sheet-extensions.js`
  - Imports the new integration and calls it from existing character sheet render hooks.
  - Registers the context menu hook once when dnd5e sheet extensions are registered.
- Modify `styles/main.css`
  - Adds narrow styles for `.rm-universal-belt-*` inside the dnd5e inventory container strip.
- Create `tests/universal-belt.test.mjs`
  - Covers pure helpers, purchase math, item assignment/removal/merge, DOM rendering, and context hook behavior.
- Modify `tests/dnd5e-sheet-downtime-tab.test.mjs`
  - Adds a regression check that registering dnd5e sheet extensions also binds the universal belt without breaking hero doll or downtime tabs.

Do not edit `scripts/main-1.4.*.js` manually. The active entrypoint already imports `scripts/integrations/dnd5e-sheet-extensions.js`, so changing that integration file is enough.

---

### Task 1: Belt Constants, State, Eligibility, And Purchase Math

**Files:**
- Create: `scripts/integrations/universal-belt.js`
- Create: `tests/universal-belt.test.mjs`

- [ ] **Step 1: Write failing helper tests**

Add this initial test file:

```js
import test from "node:test";
import assert from "node:assert/strict";

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
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: FAIL because `scripts/integrations/universal-belt.js` does not exist.

- [ ] **Step 3: Add minimal helper implementation**

Create `scripts/integrations/universal-belt.js` with:

```js
import { MODULE_ID } from "../constants.js";

export const UNIVERSAL_BELT_FLAG = "universalBelt";
export const UNIVERSAL_BELT_ITEM_SLOT_FLAG = "universalBelt.slot";
export const UNIVERSAL_BELT_SLOT_COUNT = 3;
export const UNIVERSAL_BELT_DEFAULT_UNLOCKED_SLOTS = 1;
export const UNIVERSAL_BELT_SLOT_PRICE_GP = 500;

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toWholeCoins(value) {
  return Math.max(0, Math.floor(toNumber(value, 0)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(toNumber(value, min))));
}

export function getUniversalBeltUnlockedSlotCount(actor) {
  const rawState = actor?.getFlag?.(MODULE_ID, UNIVERSAL_BELT_FLAG)
    ?? foundry.utils.getProperty(actor, `flags.${MODULE_ID}.${UNIVERSAL_BELT_FLAG}`)
    ?? {};
  return clamp(
    rawState.unlockedSlots,
    UNIVERSAL_BELT_DEFAULT_UNLOCKED_SLOTS,
    UNIVERSAL_BELT_SLOT_COUNT
  );
}

export function getUniversalBeltItemSlot(item) {
  const slot = item?.getFlag?.(MODULE_ID, UNIVERSAL_BELT_ITEM_SLOT_FLAG)
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`)
    ?? 0;
  const numericSlot = Math.floor(toNumber(slot, 0));
  return numericSlot >= 1 && numericSlot <= UNIVERSAL_BELT_SLOT_COUNT ? numericSlot : 0;
}

export function isUniversalBeltEligibleItem(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  return foundry.utils.hasProperty(itemData, "system.quantity");
}

export function calculateUniversalBeltPayment(currency = {}, costGp = UNIVERSAL_BELT_SLOT_PRICE_GP) {
  const gp = toWholeCoins(currency.gp);
  const pp = toWholeCoins(currency.pp);
  const cost = toWholeCoins(costGp);

  if (gp >= cost) {
    return { ok: true, currency: { gp: gp - cost, pp } };
  }

  const deficit = cost - gp;
  const ppToSpend = Math.ceil(deficit / 10);
  if (ppToSpend > pp) {
    return { ok: false, currency: { gp, pp } };
  }

  return {
    ok: true,
    currency: {
      gp: (ppToSpend * 10) - deficit,
      pp: pp - ppToSpend
    }
  };
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: PASS for the three helper tests.

- [ ] **Step 5: Commit helper foundation**

Run:

```powershell
git add scripts/integrations/universal-belt.js tests/universal-belt.test.mjs
git commit -m "feat: add universal belt helpers"
```

---

### Task 2: Item Assignment, Stack Splitting, Removal, And Merge

**Files:**
- Modify: `scripts/integrations/universal-belt.js`
- Modify: `tests/universal-belt.test.mjs`

- [ ] **Step 1: Add failing item movement tests**

Append these fake document helpers and tests to `tests/universal-belt.test.mjs`:

```js
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
```

- [ ] **Step 2: Run item movement tests and verify they fail**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: FAIL because `assignItemToUniversalBeltSlot` is not implemented.

- [ ] **Step 3: Implement item mutation helpers**

Extend `scripts/integrations/universal-belt.js` with these exported helpers:

```js
function getCollectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getActorItems(actor) {
  return getCollectionValues(actor?.items);
}

function getItemQuantity(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 0));
}

function setBeltSlotOnData(itemData, slot) {
  foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`, slot);
}

function buildMergeKey(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  const flags = itemData.flags?.[MODULE_ID] ?? {};
  return JSON.stringify({
    type: itemData.type ?? "",
    name: itemData.name ?? "",
    sourceType: flags.sourceType ?? "",
    gearId: flags.gearId ?? "",
    magicItemId: flags.magicItemId ?? "",
    materialId: flags.materialId ?? "",
    foundrySubtype: flags.foundrySubtype ?? foundry.utils.getProperty(itemData, "system.type.value") ?? "",
    foundrySubtypeExtra: flags.foundrySubtypeExtra ?? foundry.utils.getProperty(itemData, "system.type.subtype") ?? ""
  });
}

function findMergeCandidate(actor, item) {
  const sourceKey = buildMergeKey(item);
  return getActorItems(actor).find((candidate) => (
    candidate !== item
    && !candidate.deleted
    && getUniversalBeltItemSlot(candidate) === 0
    && isUniversalBeltEligibleItem(candidate)
    && buildMergeKey(candidate) === sourceKey
  )) ?? null;
}

async function clearBeltSlotFlag(item) {
  await item.update({
    [`flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`]: null
  });
}

export function getUniversalBeltItemsBySlot(actor) {
  const result = new Map();
  for (const item of getActorItems(actor)) {
    const slot = getUniversalBeltItemSlot(item);
    if (slot) result.set(slot, item);
  }
  return result;
}

export async function removeItemFromUniversalBelt(actor, slotOrItem) {
  const item = typeof slotOrItem === "number"
    ? getUniversalBeltItemsBySlot(actor).get(slotOrItem) ?? null
    : slotOrItem;
  if (!item) return false;

  const mergeCandidate = findMergeCandidate(actor, item);
  if (mergeCandidate) {
    await mergeCandidate.update({
      "system.quantity": getItemQuantity(mergeCandidate) + getItemQuantity(item)
    });
    await item.delete();
    return true;
  }

  await clearBeltSlotFlag(item);
  return true;
}

export async function assignItemToUniversalBeltSlot(actor, slot, item) {
  const safeSlot = Math.floor(toNumber(slot, 0));
  if (!actor?.isOwner) throw new Error("Недостаточно прав для изменения пояса.");
  if (safeSlot < 1 || safeSlot > getUniversalBeltUnlockedSlotCount(actor)) {
    throw new Error("Этот слот пояса ещё не открыт.");
  }
  if (!isUniversalBeltEligibleItem(item) || item?.parent !== actor) {
    throw new Error("Перетащите физический предмет из инвентаря этого персонажа.");
  }
  if (getItemQuantity(item) <= 0) {
    throw new Error("У предмета нет доступного количества.");
  }

  const existing = getUniversalBeltItemsBySlot(actor).get(safeSlot) ?? null;
  if (existing && existing !== item) await removeItemFromUniversalBelt(actor, existing);

  const currentSlot = getUniversalBeltItemSlot(item);
  if (currentSlot && currentSlot !== safeSlot) await clearBeltSlotFlag(item);

  const sourceQuantity = getItemQuantity(item);
  if (sourceQuantity > 1) {
    const itemData = foundry.utils.deepClone(item.toObject());
    delete itemData._id;
    setBeltSlotOnData(itemData, safeSlot);
    foundry.utils.setProperty(itemData, "system.quantity", 1);
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { renderSheet: false });
    await item.update({ "system.quantity": sourceQuantity - 1 });
    return created ?? null;
  }

  await item.update({
    [`flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`]: safeSlot
  });
  return item;
}
```

- [ ] **Step 4: Run movement tests and verify they pass**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: PASS for helper and movement tests.

- [ ] **Step 5: Commit item movement**

Run:

```powershell
git add scripts/integrations/universal-belt.js tests/universal-belt.test.mjs
git commit -m "feat: support universal belt item movement"
```

---

### Task 3: Purchasing Slots And Item Use

**Files:**
- Modify: `scripts/integrations/universal-belt.js`
- Modify: `tests/universal-belt.test.mjs`

- [ ] **Step 1: Add failing purchase and use tests**

Append:

```js
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
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: FAIL because `purchaseUniversalBeltSlot` and `useUniversalBeltItem` are not implemented.

- [ ] **Step 3: Implement purchase and use**

Add:

```js
export async function purchaseUniversalBeltSlot(actor) {
  if (!actor?.isOwner) throw new Error("Недостаточно прав для покупки слота пояса.");

  const unlockedSlots = getUniversalBeltUnlockedSlotCount(actor);
  if (unlockedSlots >= UNIVERSAL_BELT_SLOT_COUNT) {
    throw new Error("Все слоты пояса уже открыты.");
  }

  const currentCurrency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  const payment = calculateUniversalBeltPayment(currentCurrency);
  if (!payment.ok) {
    throw new Error("Недостаточно средств: нужно 500 зм или эквивалент в пм.");
  }

  const nextUnlockedSlots = unlockedSlots + 1;
  await actor.update({
    "system.currency.gp": payment.currency.gp,
    "system.currency.pp": payment.currency.pp
  });
  await actor.setFlag(MODULE_ID, UNIVERSAL_BELT_FLAG, {
    unlockedSlots: nextUnlockedSlots
  });
  return nextUnlockedSlots;
}

export async function useUniversalBeltItem(actor, slot, event = null) {
  const item = getUniversalBeltItemsBySlot(actor).get(Math.floor(toNumber(slot, 0))) ?? null;
  if (!item) throw new Error("В этом слоте пояса нет предмета.");
  if (typeof item.use === "function") {
    return item.use({ event, legacy: false });
  }
  await item.sheet?.render?.(true);
  return item;
}
```

- [ ] **Step 4: Run purchase and use tests**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit purchase and use**

Run:

```powershell
git add scripts/integrations/universal-belt.js tests/universal-belt.test.mjs
git commit -m "feat: add universal belt purchase and use"
```

---

### Task 4: Sheet DOM Binding And dnd5e Context Menu Integration

**Files:**
- Modify: `scripts/integrations/universal-belt.js`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `tests/universal-belt.test.mjs`
- Modify: `tests/dnd5e-sheet-downtime-tab.test.mjs`

- [ ] **Step 1: Add failing DOM and context tests**

Add a small fake DOM section to `tests/universal-belt.test.mjs`:

```js
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
```

Add this assertion to the first registration test in `tests/dnd5e-sheet-downtime-tab.test.mjs` after `registerDnd5eSheetExtensions(moduleApi);`:

```js
assert.equal(typeof stubs.hooks.get("renderCharacterActorSheet"), "function");
```

- [ ] **Step 2: Run DOM/context tests and verify they fail**

Run:

```powershell
node --test tests/universal-belt.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: FAIL because DOM binding and context hook exports do not exist.

- [ ] **Step 3: Implement DOM rendering, event binding, and context hook**

Add to `scripts/integrations/universal-belt.js`:

```js
let contextHookRegistered = false;
const boundRoots = new WeakSet();

function buildSlotTitle(slot, item, locked) {
  if (locked) return `Слот пояса ${slot}: купить за 500 зм`;
  return item ? `Слот пояса ${slot}: ${item.name}` : `Слот пояса ${slot}: пусто`;
}

function createSlotElement(slot, actor) {
  const unlockedCount = getUniversalBeltUnlockedSlotCount(actor);
  const itemsBySlot = getUniversalBeltItemsBySlot(actor);
  const item = itemsBySlot.get(slot) ?? null;
  const locked = slot > unlockedCount;
  const li = document.createElement("li");
  li.classList.add("container", "draggable", "rm-universal-belt-slot");
  li.dataset.rebreyaUniversalBeltSlot = "true";
  li.dataset.beltSlot = String(slot);
  li.dataset.locked = locked ? "true" : "false";
  li.setAttribute("aria-label", buildSlotTitle(slot, item, locked));
  li.setAttribute("title", buildSlotTitle(slot, item, locked));
  if (item) {
    li.dataset.itemId = item.id;
    li.dataset.uuid = item.uuid ?? "";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("rm-universal-belt-slot__button");
  button.dataset.action = locked ? "rebreya-universal-belt-purchase" : "rebreya-universal-belt-use";
  if (item) {
    const img = document.createElement("img");
    img.src = item.img ?? "icons/svg/item-bag.svg";
    img.alt = item.name ?? "";
    img.draggable = false;
    button.append(img);
  }
  else {
    const icon = document.createElement("i");
    icon.className = locked ? "fa-solid fa-lock" : "fa-solid fa-bag-shopping";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
  }
  li.append(button);
  return li;
}

export function renderUniversalBeltSlots(root, actor) {
  const containers = root?.querySelector?.("ul.containers") ?? null;
  if (!containers || !actor) return false;

  for (const existing of Array.from(containers.querySelectorAll(".rm-universal-belt-slot") ?? [])) {
    existing.remove();
  }
  containers.prepend(...[1, 2, 3].map((slot) => createSlotElement(slot, actor)));
  hideBeltedInventoryRows(root, actor);
  return true;
}

export function hideBeltedInventoryRows(root, actor) {
  const beltedIds = new Set([...getUniversalBeltItemsBySlot(actor).values()].map((item) => item.id));
  if (!beltedIds.size) return;
  for (const node of Array.from(root?.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (node.closest?.(".rm-universal-belt-slot")) continue;
    if (node.closest?.(".containers")) continue;
    if (beltedIds.has(node.dataset.itemId)) {
      node.hidden = true;
      node.classList?.add?.("rm-universal-belt-hidden-item");
    }
  }
}

function getDropData(event) {
  for (const type of ["text/plain", "text", "application/json"]) {
    const raw = event.dataTransfer?.getData?.(type);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    }
    catch (_error) {
      return { uuid: raw };
    }
  }
  return null;
}

async function resolveDroppedItem(dropData) {
  const document = dropData?.uuid ? await fromUuid(dropData.uuid) : null;
  return document ?? null;
}

async function confirmBeltPurchase(slot) {
  if (globalThis.Dialog?.confirm instanceof Function) {
    return Dialog.confirm({
      title: "Купить слот пояса",
      content: `<p>Купить слот пояса ${slot} за 500 зм? Используются только зм и пм.</p>`
    });
  }
  return true;
}

export function bindUniversalBeltSheet(root, { actor, app, moduleApi, rerenderActorSheet }) {
  if (!renderUniversalBeltSlots(root, actor) || boundRoots.has(root)) return false;
  boundRoots.add(root);

  root.addEventListener("dragover", (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot || slot.dataset.locked === "true") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    slot.classList.add("is-dragover");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }, { capture: true });

  root.addEventListener("dragleave", (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot) return;
    slot.classList.remove("is-dragover");
  }, { capture: true });

  root.addEventListener("drop", async (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot || slot.dataset.locked === "true") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    slot.classList.remove("is-dragover");
    try {
      const item = await resolveDroppedItem(getDropData(event));
      await assignItemToUniversalBeltSlot(actor, Number(slot.dataset.beltSlot), item);
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to assign universal belt slot.`, error);
      ui.notifications?.error(error.message || "Не удалось поместить предмет в пояс.");
    }
  }, { capture: true });

  root.addEventListener("click", async (event) => {
    const action = event.target?.closest?.("[data-action='rebreya-universal-belt-use'], [data-action='rebreya-universal-belt-purchase']");
    const slot = action?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!action || !slot) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    try {
      if (action.dataset.action === "rebreya-universal-belt-purchase") {
        if (!(await confirmBeltPurchase(slot.dataset.beltSlot))) return;
        await purchaseUniversalBeltSlot(actor);
      }
      else {
        await useUniversalBeltItem(actor, Number(slot.dataset.beltSlot), event);
      }
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to handle universal belt action.`, error);
      ui.notifications?.error(error.message || "Не удалось выполнить действие пояса.");
    }
  }, { capture: true });

  return true;
}

export function registerUniversalBeltItemContextHook(moduleApi) {
  if (contextHookRegistered || !globalThis.Hooks?.on) return false;
  contextHookRegistered = true;
  Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
    if (!getUniversalBeltItemSlot(item)) return;
    options.push({
      name: "Убрать из пояса",
      icon: '<i class="fa-solid fa-box-open fa-fw"></i>',
      condition: () => item.isOwner !== false,
      callback: async () => {
        try {
          await removeItemFromUniversalBelt(item.parent ?? item.actor, item);
          await moduleApi?.refreshOpenApps?.();
          await item.parent?.sheet?.render?.({ force: true });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to remove universal belt item.`, error);
          ui.notifications?.error(error.message || "Не удалось убрать предмет из пояса.");
        }
      },
      group: "action"
    });
  });
  return true;
}
```

Modify `scripts/integrations/dnd5e-sheet-extensions.js`:

```js
import {
  bindUniversalBeltSheet,
  registerUniversalBeltItemContextHook
} from "./universal-belt.js";
```

Inside `registerDnd5eSheetExtensions(moduleApi)`, after the existing global delegation calls, add:

```js
registerUniversalBeltItemContextHook(moduleApi);
```

In both character actor render branches, after `bindCharacterDowntimePanel(root, app, moduleApi);`, add:

```js
bindUniversalBeltSheet(root, { actor, app, moduleApi, rerenderActorSheet });
```

- [ ] **Step 4: Run integration tests**

Run:

```powershell
node --test tests/universal-belt.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit sheet integration**

Run:

```powershell
git add scripts/integrations/universal-belt.js scripts/integrations/dnd5e-sheet-extensions.js tests/universal-belt.test.mjs tests/dnd5e-sheet-downtime-tab.test.mjs
git commit -m "feat: render universal belt on character sheets"
```

---

### Task 5: Belt Styling And Final Verification

**Files:**
- Modify: `styles/main.css`
- Modify: `tests/universal-belt.test.mjs`

- [ ] **Step 1: Add failing CSS selector test**

Change the top imports in `tests/universal-belt.test.mjs` to include `readFile`, then append the test:

```js
import { readFile } from "node:fs/promises";

test("universal belt styles are scoped to dnd5e inventory container strip", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.dnd5e2\.sheet\.actor[\s\S]+\.rm-universal-belt-slot/u);
  assert.match(css, /\.rm-universal-belt-slot\s*\{[\s\S]*border-radius:\s*50%/u);
  assert.match(css, /\.rm-universal-belt-slot\[data-locked="true"\]/u);
  assert.match(css, /\.rm-universal-belt-hidden-item\s*\{[\s\S]*display:\s*none/u);
});
```

- [ ] **Step 2: Run style test and verify it fails**

Run:

```powershell
node --test tests/universal-belt.test.mjs
```

Expected: FAIL because universal belt CSS selectors do not exist.

- [ ] **Step 3: Add scoped CSS**

Append to `styles/main.css` near the other dnd5e sheet extension styles:

```css
.dnd5e2.sheet.actor .tab[data-tab="inventory"] .containers .rm-universal-belt-slot {
  position: relative;
  border-radius: 50%;
  border-color: rgb(var(--rm-color-gold-rgb) / 0.72);
  background:
    radial-gradient(circle at 50% 38%, rgb(var(--rm-color-gold-rgb) / 0.24), transparent 42%),
    var(--rm-surface-1);
  box-shadow:
    inset 0 0 0 1px rgb(0 0 0 / 0.42),
    0 0 0 1px rgb(var(--rm-color-gold-rgb) / 0.12);
  overflow: hidden;
}

.dnd5e2.sheet.actor .tab[data-tab="inventory"] .containers .rm-universal-belt-slot__button {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--rm-accent-strong);
  cursor: pointer;
}

.dnd5e2.sheet.actor .tab[data-tab="inventory"] .containers .rm-universal-belt-slot__button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.dnd5e2.sheet.actor .tab[data-tab="inventory"] .containers .rm-universal-belt-slot[data-locked="true"] {
  opacity: 0.72;
  border-style: dashed;
  filter: grayscale(0.3);
}

.dnd5e2.sheet.actor .tab[data-tab="inventory"] .containers .rm-universal-belt-slot.is-dragover {
  border-color: var(--rm-accent-strong);
  box-shadow:
    inset 0 0 0 2px rgb(var(--rm-color-gold-rgb) / 0.65),
    0 0 14px rgb(var(--rm-color-gold-rgb) / 0.24);
}

.rm-universal-belt-hidden-item {
  display: none !important;
}
```

- [ ] **Step 4: Run targeted and full tests**

Run:

```powershell
git diff --check
node --test tests/universal-belt.test.mjs
node --test tests/dnd5e-sheet-downtime-tab.test.mjs
node --test tests/module-manifest.test.mjs
node --test tests\*.test.mjs
```

Expected: all commands PASS.

- [ ] **Step 5: Manual Foundry verification**

In Foundry, open a dnd5e character sheet as GM and as a player owner. Verify:

- three circular belt slots appear before backpacks in the inventory container strip;
- slot 1 is open and slots 2-3 show locks;
- clicking a locked slot confirms purchase and deducts gp/pp correctly;
- dragging a stack of 5 creates one belted item and leaves 4 in normal inventory;
- the belted item is hidden from the normal inventory rows;
- clicking the belted item opens the normal dnd5e use flow;
- right-clicking the belted item shows the standard dnd5e item menu plus `Убрать из пояса`;
- removing the item returns it to normal inventory and merges compatible stacks;
- console has no Rebreya errors.

- [ ] **Step 6: Commit styling and final verification**

Run:

```powershell
git add styles/main.css tests/universal-belt.test.mjs
git commit -m "style: add universal belt inventory slots"
git status --short --branch
```

Expected: only intentional untracked user archives remain.

---

## Final Branch Verification

After all tasks are complete:

```powershell
git status --short --branch
git diff origin/lich_branch...HEAD --stat
git log --oneline origin/lich_branch..HEAD
git push origin lich_branch
```

Expected:

- branch is `lich_branch`;
- no unexpected unstaged changes;
- commits are focused on universal belt implementation;
- push succeeds without force.
