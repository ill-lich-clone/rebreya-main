import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const application = () => import("../scripts/ui/alchemy-crafting-app.js");
const snapshot = {
  recipes: [
    { id: "alchemy-78", name: "Зелье лечения", rank: 2, icon: "heal.webp" },
    { id: "alchemy-71", name: "Зелье скорости", rank: 8, icon: "speed.webp" }
  ],
  options: [{ goldGp: 40, label: "40 зм" }],
  stockOptions: [], catalysts: [], availableWeeks: 3,
  field: { status: "prepared", operationId: "field-1", productId: "alchemy-78" }
};

test("a single view exposes manual cost only in the simplified laboratory mode", async () => {
  const { buildAlchemyCraftingView } = await application();
  const state = { productId: "alchemy-78", selection: { optionIndex: 0 }, search: "леч" };
  const lab = buildAlchemyCraftingView(snapshot, { ...state, mode: "laboratory" });
  const field = buildAlchemyCraftingView(snapshot, { ...state, mode: "field" });
  assert.equal(lab.manual, true);
  assert.equal(lab.manualGoldGp, 40);
  assert.equal(lab.manualWeeks, "");
  assert.equal(lab.recipes.length, 1);
  assert.equal(field.manual, false);
  assert.equal(field.prepared, true);
});

test("only the existing Rebreya menu launches the new window and edits stay in the form until confirmation", async () => {
  const [hooks, template] = await Promise.all([
    readFile(new URL("../scripts/hooks.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/alchemy-crafting.hbs", import.meta.url), "utf8")
  ]);
  assert.equal(hooks.match(/openAlchemyCraftingApp\?\.\(/gu)?.length, 1);
  assert.match(template, /value="laboratory"/u);
  assert.match(template, /value="field"/u);
  assert.match(template, /data-craft-action="confirm"/u);
  assert.match(template, /\{\{#if manual\}\}/u);
});
