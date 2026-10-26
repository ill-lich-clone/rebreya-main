import test from "node:test";
import assert from "node:assert/strict";
import { createOverlayDom } from "./helpers/overlay-dom.mjs";
import { getPotionTrackerState } from "../scripts/integrations/universal-belt.js";

const MODULE = "rebreya-main";

async function bind(root, options) {
  let module;
  try { module = await import("../scripts/integrations/potion-tracker-popover.js"); }
  catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    module = {};
  }
  assert.equal(typeof module.bindPotionTrackerPopover, "function");
  return module.bindPotionTrackerPopover(root, { getState: getPotionTrackerState, ...options });
}

function item(number, name, rank, quantity, productType = "Зелье") {
  return { name, type: "consumable", system: { quantity }, flags: { [MODULE]: {
    managed: true, sourceType: "alchemyProduct", alchemyProductId: `alchemy-${number}`,
    sourceNumber: number, productType, rank
  } } };
}

function effect(name, level, expiresAt, productId, extra = {}) {
  return { name, flags: { [MODULE]: { alchemyReagent: { level, expiresAt, productId } } }, ...extra };
}

function fixture() {
  const dom = createOverlayDom();
  const root = new dom.Element();
  dom.document.body.append(root);
  const buttons = {};
  for (const kind of ["healing", "utility", "reagents"]) {
    const tracker = new dom.Element();
    tracker.dataset.potionTracker = kind;
    const button = new dom.Element();
    button.dataset.action = "rebreya-potion-tracker-edit";
    button.closest = selector => selector.includes("data-potion-tracker") ? tracker : button;
    tracker.append(button);
    root.append(tracker);
    buttons[kind] = button;
  }
  const actor = {
    items: { contents: [item(80, "Лечение", 4, 2), item(35, "Темп", 3, 2),
      item(35, "Темп", 3, 1), item(154, "Бомба", 1, 1, "Бомба")] },
    effects: { contents: [effect("Зелье темпа", 2, 3820, "alchemy-2"),
      effect("Выключено", 5, 4000, "alchemy-1", { disabled: true }),
      effect("Истекло", 9, 100, "alchemy-1")] },
    flags: { [MODULE]: { potionTrackers: {} } },
    getFlag(module, key) { return this.flags[module]?.[key] ?? {}; }
  };
  const moduleApi = { getModel: async () => ({ alchemyProductById: new Map([
    ["alchemy-2", { effect: "Скорость увеличивается на 5 футов." }]
  ]) }) };
  return { dom, root, buttons, actor, moduleApi };
}

function textOf(node) {
  return [node?.textContent ?? "", ...(node?.children ?? []).map(textOf)].join(" ");
}

function portal(dom) {
  return dom.document.body.children.find(child => child.dataset.rmAnchoredOverlay === "true");
}

async function open(root, button, event = "pointerover") {
  await root.emit(event, { target: button });
  await new Promise(resolve => setImmediate(resolve));
}

test("each flask shows its own inventory or active effects and remaining game time", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    await bind(root, { actor, moduleApi });
    await open(root, buttons.healing);
    let text = textOf(portal(dom));
    assert.match(text, /Лечение/u);
    assert.match(text, /4.*2/u);
    assert.doesNotMatch(text, /Бомба|Темп/u);
    await open(root, buttons.utility);
    text = textOf(portal(dom));
    assert.match(text, /Темп/u);
    assert.match(text, /Бомба/u);
    assert.doesNotMatch(text, /Лечение/u);
    assert.match(text, /3.*3/u);
    await open(root, buttons.reagents);
    text = textOf(portal(dom));
    assert.match(text, /Зелье темпа/u);
    assert.match(text, /Скорость увеличивается на 5 футов/u);
    assert.match(text, /1 ч.*2 мин/u);
    assert.doesNotMatch(text, /Выключено|Истекло/u);
  }
  finally { globalThis.game = before; }
});

test("empty lists, manual totals and corrections are explained without interpreting names as markup", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    actor.items.contents = [item(80, "<img src=x onerror=alert(1)>", 4, 2)];
    actor.effects.contents = [];
    actor.flags[MODULE].potionTrackers = {
      healing: { mode: "manual", value: 11, max: 13 },
      utility: { adjustment: -2 }, reagents: { value: 2 }
    };
    await bind(root, { actor, moduleApi });
    await open(root, buttons.healing);
    assert.match(textOf(portal(dom)), /<img src=x onerror=alert\(1\)>/u);
    assert.match(textOf(portal(dom)), /Ручной итог.*11/u);
    await open(root, buttons.utility);
    assert.match(textOf(portal(dom)), /нет|пуст/iu);
    assert.match(textOf(portal(dom)), /Корректировка.*-2/u);
    await open(root, buttons.reagents);
    assert.match(textOf(portal(dom)), /нет|пуст/iu);
    assert.match(textOf(portal(dom)), /Ручная база.*2/u);
  }
  finally { globalThis.game = before; }
});

test("a late catalog response cannot replace the currently open flask", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor } = fixture();
    let finish;
    const moduleApi = { getModel: () => new Promise(resolve => { finish = resolve; }) };
    await bind(root, { actor, moduleApi });
    await open(root, buttons.reagents);
    assert.match(textOf(portal(dom)), /Зелье темпа/u);
    await open(root, buttons.healing);
    finish({ alchemyProductById: new Map([["alchemy-2", { effect: "Запоздалое описание" }]]) });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(textOf(portal(dom)), /Лечение/u);
    assert.doesNotMatch(textOf(portal(dom)), /Запоздалое описание/u);
  }
  finally { globalThis.game = before; }
});

test("catalog failure leaves the active potion name and timing visible", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor } = fixture();
    await bind(root, { actor, moduleApi: { getModel: async () => { throw new Error("catalog unavailable"); } } });
    await open(root, buttons.reagents);
    assert.match(textOf(portal(dom)), /Зелье темпа/u);
    assert.match(textOf(portal(dom)), /1 ч.*2 мин/u);
  }
  finally { globalThis.game = before; }
});

test("focus, pointer movement to the scrollable panel, Escape and click keep their expected behavior", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    await bind(root, { actor, moduleApi });
    await open(root, buttons.healing, "focusin");
    const first = portal(dom);
    assert.ok(first);
    assert.equal(first.style.overflow, "auto");
    assert.ok(buttons.healing.getAttribute("aria-describedby"));
    await root.emit("pointerout", { target: buttons.healing, relatedTarget: first });
    await first.emit("pointerenter");
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(portal(dom), first);
    await dom.events.emit("keydown", { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(portal(dom), undefined);
    assert.equal(dom.document.activeElement, buttons.healing);
    await open(root, buttons.healing);
    await root.emit("click", { target: buttons.healing });
    assert.equal(portal(dom), undefined);
  }
  finally { globalThis.game = before; }
});

test("a flask near the screen edge keeps its panel within the viewport", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    dom.window.innerWidth = 400;
    dom.window.innerHeight = 300;
    buttons.healing.rect = { left: 350, right: 390, top: 250, bottom: 290, width: 40, height: 40 };
    await bind(root, { actor, moduleApi });
    await open(root, buttons.healing);
    const panel = portal(dom);
    assert.equal(panel.dataset.placement, "top");
    assert.ok(parseFloat(panel.style.left) >= 8);
    assert.ok(parseFloat(panel.style.top) >= 8);
    assert.ok(parseFloat(panel.style.left) + parseFloat(panel.style.width) <= 392);
  }
  finally { globalThis.game = before; }
});

test("ArrowDown from a focused flask moves keyboard focus to the scrollable list", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    await bind(root, { actor, moduleApi });
    await open(root, buttons.utility, "focusin");
    let prevented = false;
    await root.emit("keydown", { target: buttons.utility, key: "ArrowDown", preventDefault() { prevented = true; } });
    assert.equal(dom.document.activeElement, portal(dom).children[0]);
    assert.equal(prevented, true);
  }
  finally { globalThis.game = before; }
});

test("the panel closes before the sheet's capturing click handler stops propagation", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    const registrations = [];
    const addListener = root.addEventListener.bind(root);
    root.addEventListener = (type, listener, options = {}) => {
      registrations.push({ type, listener, capture: options.capture === true });
      addListener(type, listener, options);
    };
    await bind(root, { actor, moduleApi });
    root.addEventListener("click", event => event.stopPropagation(), { capture: true });
    await open(root, buttons.healing);
    let stopped = false;
    const event = { target: buttons.healing, stopPropagation() { stopped = true; } };
    for (const entry of registrations.filter(entry => entry.type === "click" && entry.capture)) entry.listener(event);
    if (!stopped) for (const entry of registrations.filter(entry => entry.type === "click" && !entry.capture)) entry.listener(event);
    assert.equal(portal(dom), undefined);
  }
  finally { globalThis.game = before; }
});

test("Escape restores focus without reopening the panel or leaving a stale description", async () => {
  const before = globalThis.game;
  globalThis.game = { time: { worldTime: 100 } };
  try {
    const { dom, root, buttons, actor, moduleApi } = fixture();
    const button = buttons.utility;
    button.setAttribute("aria-describedby", "existing-description");
    button.focus = () => {
      dom.document.activeElement = button;
      for (const listener of root.listeners.get("focusin") ?? []) listener({ target: button });
    };
    let renders = 0;
    await bind(root, { actor, moduleApi, getState: (...args) => { renders += 1; return getPotionTrackerState(...args); } });
    await open(root, button, "focusin");
    await root.emit("keydown", { target: button, key: "ArrowDown", preventDefault() {} });
    await dom.events.emit("keydown", { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(renders, 1);
    assert.equal(portal(dom), undefined);
    assert.equal(button.getAttribute("aria-describedby"), "existing-description");
    assert.equal(dom.document.activeElement, button);
    await root.emit("keydown", { target: button, key: "ArrowDown", preventDefault() {} });
    assert.equal(renders, 2);
    assert.equal(dom.document.activeElement, portal(dom).children[0]);
  }
  finally { globalThis.game = before; }
});
