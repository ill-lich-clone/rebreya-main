import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAlchemyCraftingView } from "../scripts/ui/alchemy-crafting-app.js";

const loadDialog = () => import("../scripts/ui/alchemy-extraction-dialog.js");

test("rendering a plant card twice binds one action and excludes non-plant loot", async () => {
  const { bindAlchemyExtractionAction } = await loadDialog();
  const actor = { id: "hero", type: "character", testUserPermission: () => true };
  const reference = { groupId: "party", members: [actor] };
  const api = {
    alchemyExtractionService: {},
    groupContextService: { resolveReferenceForCurrentUser: () => reference },
    getModel: async () => ({ materialById: new Map([
      ["plant", { type: "Растение", alchemyAspects: "42 З" }],
      ["ore", { type: "Минерал", alchemyAspects: "42 З" }]
    ]) })
  };
  const children = [];
  const root = {
    ownerDocument: { createElement: () => ({ dataset: {}, addEventListener(_event, callback) { this.click = callback; } }) },
    querySelector: (selector) => selector === "[data-alchemy-extraction]" ? children[0] ?? null : null,
    prepend: (button) => children.push(button)
  };
  const item = (materialId) => ({ parent: actor, type: "loot", flags: { "rebreya-main": { materialId } }, system: { quantity: 1 } });
  let opened = 0;
  const options = { user: { id: "owner" }, open: async () => { opened++; } };
  assert.equal(await bindAlchemyExtractionAction(root, item("ore"), api, options), false);
  const plant = item("plant");
  await Promise.all([bindAlchemyExtractionAction(root, plant, api, options), bindAlchemyExtractionAction(root, plant, api, options)]);
  assert.equal(children.length, 1);
  assert.equal(opened, 0);
  await children[0].click();
  assert.equal(opened, 1);
});

test("the crafting view shows six zero balances and the exact fire requirement without a false failure cost", async () => {
  const snapshot = {
    recipes: [{ id: "alchemy-1", name: "Взрывное зелье", rank: 1, icon: "fire.webp" }],
    options: [{ label: "15 О" }], catalysts: [], stockOptions: [], availableWeeks: 0,
    aspectStock: {}, quote: { aspectNeeds: { fire: 15 }, anyAspects: 0,
      errors: [{ code: "potion-base", message: "Нужна одна порция крови чудовища." }], failureDebits: [] }
  };
  const view = buildAlchemyCraftingView(snapshot, { mode: "field", productId: "alchemy-1", selection: { optionIndex: 0 } });
  assert.equal(view.aspectStock.length, 6);
  assert.ok(view.aspectStock.every(({ available }) => available === 0));
  assert.deepEqual(view.aspectNeeds, [{ name: "Огонь", available: 0, required: 15 }]);
  assert.equal(view.showFieldLoss, false);
  assert.deepEqual(view.errors.map(({ code }) => code), ["potion-base"]);
  const template = await readFile(new URL("../templates/alchemy-crafting.hbs", import.meta.url), "utf8");
  assert.match(template, /\{\{#each aspectStock\}\}/u);
  assert.match(template, /\{\{available\}\}\/\{\{required\}\}/u);
});

test("closing the plant dialog does not submit an operation", async () => {
  const { openAlchemyExtractionDialog } = await loadDialog();
  const actor = { id: "hero", name: "Элиан", type: "character", testUserPermission: () => true };
  const item = { id: "slime", type: "loot", parent: actor };
  const moduleApi = {
    groupContextService: { resolveReferenceForCurrentUser: () => ({ groupId: "party", members: [actor] }) },
    alchemyExtractionService: { preview: async () => ({
      tool: { id: "kit" }, plants: [{ actorId: actor.id, actorName: actor.name, itemId: item.id,
        name: "Хромовая слизь", baseYield: { earth: 42 }, available: 2 }]
    }) },
    mutateAlchemyExtraction: () => assert.fail("dialog cancellation is read-only")
  };
  const result = await openAlchemyExtractionDialog(item, moduleApi, {
    user: { id: "owner" },
    DialogV2: { wait: async (configuration) => {
      assert.match(configuration.content, /10 игровых минут/);
      assert.match(configuration.content, /42 З за порцию/);
      assert.match(configuration.content, /value="1" data-extract-index="0"/);
      const cancel = configuration.buttons.find(({ action }) => action === "cancel");
      return (await cancel.callback()) ?? cancel.action;
    } }
  });
  assert.equal(result, null);
});

test("the extraction button disables for an empty selection and reenables when a portion is restored", async () => {
  const { openAlchemyExtractionDialog } = await loadDialog();
  const actor = { id: "hero", name: "Элиан", type: "character", testUserPermission: () => true };
  const item = { id: "slime", type: "loot", parent: actor };
  const portion = { value: "1", dataset: { extractIndex: "0" } };
  const confirm = { disabled: false };
  const cancel = {};
  const listeners = {};
  const select = { value: actor.id, addEventListener(name, callback) { listeners[name] = callback; } };
  const part = { dataset: { extractActor: actor.id }, querySelectorAll: () => [portion] };
  const content = {
    querySelector: () => select, querySelectorAll: () => [part],
    addEventListener(name, callback) { listeners[name] = callback; }
  };
  const moduleApi = {
    groupContextService: { resolveReferenceForCurrentUser: () => ({ groupId: "party", members: [actor] }) },
    alchemyExtractionService: { preview: async () => ({
      tool: { id: "kit" }, plants: [{ actorId: actor.id, actorName: actor.name, itemId: item.id,
        name: "Хромовая слизь", baseYield: { earth: 42 }, available: 2 }]
    }) },
    mutateAlchemyExtraction: () => assert.fail("no extraction was confirmed")
  };
  await openAlchemyExtractionDialog(item, moduleApi, {
    user: { id: "owner" },
    DialogV2: { wait: async (configuration) => {
      configuration.render(null, { element: { querySelector: (selector) =>
        selector.includes("cancel") ? cancel : selector.includes("extract'") ? confirm : content } });
      assert.equal(confirm.disabled, false);
      portion.value = "0";
      listeners.input?.();
      assert.equal(confirm.disabled, true);
      const action = configuration.buttons.find(({ action }) => action === "extract");
      assert.equal(action.callback(null, { form: content }), false);
      portion.value = "1";
      listeners.input?.();
      assert.equal(confirm.disabled, false);
      return false;
    } }
  });
});
