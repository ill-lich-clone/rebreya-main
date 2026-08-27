import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmptyStorageTriggerState } from "../scripts/data/storage-trigger-service.js";

class FakeApplicationV2 {
  constructor(options = {}) { this.options = options; }
  async render() {}
  async close() { return true; }
}

globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApplicationV2, HandlebarsApplicationMixin: (Base) => Base, DialogV2: { confirm: async () => true } } },
  utils: { deepClone: structuredClone, randomID: () => "stable" }
};

const {
  StorageTriggerEditor,
  buildStorageLockTrigger,
  buildStorageTrapTrigger
} = await import(`../scripts/ui/storage-trigger-editor.js?test=${Date.now()}`);

test("storage trigger editor is a separate wide four-event ApplicationV2 surface", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen.push(buildStorageLockTrigger());
  const app = new StorageTriggerEditor({
    async getStorageTriggers() { return { tokenUuid: "Token.chest", path: ["bag"], triggers: state }; }
  }, "Token.chest", { path: ["bag"], storageName: "Кухонный буфет" });

  const context = await app._prepareContext();

  assert.equal(StorageTriggerEditor.DEFAULT_OPTIONS.position.width, 1120);
  assert.equal(StorageTriggerEditor.DEFAULT_OPTIONS.position.height, 720);
  assert.match(app.id, /Token-chest-bag/u);
  assert.deepEqual(context.events.map(({ event, label }) => [event, label]), [
    ["beforeOpen", "До открытия"], ["afterOpen", "После открытия"],
    ["afterClaim", "После получения"], ["emptied", "Опустело"]
  ]);
  assert.equal(context.storageName, "Кухонный буфет");
  assert.equal(context.chains[0].name, "Замок");
  assert.deepEqual(context.steps.map(({ label }) => label), ["Проверка предмета", "Разрешить", "Запретить"]);
});

test("built-in lock and trap templates encode the approved native examples without cooldown", () => {
  const lock = buildStorageLockTrigger();
  const trap = buildStorageTrapTrigger();
  assert.equal(lock.name, "Замок");
  assert.equal(lock.steps[0].type, "conditionItem");
  assert.equal(lock.steps.at(-1).type, "deny");
  assert.equal(trap.name, "Ловушка");
  assert.equal(trap.repeat, "oncePerCharacter");
  assert.deepEqual(trap.steps.map(({ type }) => type), ["savingThrow", "damage", "finish"]);
  assert.equal(JSON.stringify([lock, trap]).includes("cooldown"), false);
});

test("storage trigger templates expose editor, reset, CRUD, inspector, and macro drop controls", async () => {
  const [editor, storage] = await Promise.all([
    readFile(new URL("../templates/storage-trigger-editor.hbs", import.meta.url), "utf8"),
    readFile(new URL("../templates/storage-app.hbs", import.meta.url), "utf8")
  ]);
  for (const action of [
    "trigger-event", "trigger-add-chain", "trigger-template-lock", "trigger-template-trap",
    "trigger-add-step", "trigger-delete-step", "trigger-save", "trigger-reload", "trigger-reset"
  ]) assert.match(editor, new RegExp(`data-action="${action}"`, "u"));
  assert.match(editor, /data-field="step\.type"/u);
  assert.match(editor, /step\.config\.\{\{name\}\}/u);
  assert.match(storage, /data-action="storage-open-trigger-editor"/u);
  assert.match(storage, /data-action="storage-reset-triggers"/u);
  assert.doesNotMatch(editor, /cooldown|перезаряд/iu);
});
