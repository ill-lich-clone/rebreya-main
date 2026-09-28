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
  TriggerEditor,
  StorageTriggerEditor,
  buildDoorLockTrigger,
  buildStorageLockTrigger,
  buildStorageTrapTrigger,
  resolveStorageTriggerItemDrop
} = await import(`../scripts/ui/storage-trigger-editor.js?test=${Date.now()}`);

test("door trigger editor exposes two events and saves an implicitly active target", async () => {
  const state = createEmptyStorageTriggerState();
  const saves = [];
  const app = new TriggerEditor({
    async getDoorTriggers() {
      return { wallUuid: "Scene.room.Wall.north", enabled: false, triggers: state };
    },
    async saveDoorTriggers(wallUuid, enabled, definitions, expectedRevision, operationId) {
      saves.push({ wallUuid, enabled, definitions, expectedRevision, operationId });
      return {
        wallUuid,
        enabled,
        triggers: { ...state, revision: expectedRevision + 1, chainsByEvent: definitions.chainsByEvent }
      };
    }
  }, { kind: "door", uuid: "Scene.room.Wall.north", path: [] }, {
    targetName: "Северная дверь",
    availableEvents: ["beforeOpen", "afterOpen"],
    canToggleEnabled: true
  });

  const context = await app._prepareContext();
  assert.deepEqual(context.events.map(({ event }) => event), ["beforeOpen", "afterOpen"]);
  assert.equal(context.targetName, "Северная дверь");
  assert.equal(context.targetKindLabel, "двери");
  assert.equal(context.canToggleEnabled, false);
  await app.saveDraft();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].enabled, true);
  assert.deepEqual(Object.keys(saves[0].definitions.chainsByEvent), ["beforeOpen", "afterOpen", "afterClaim", "emptied"]);
  assert.deepEqual(saves[0].definitions.chainsByEvent.afterClaim, []);
});

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
  assert.equal(context.canToggleEnabled, false);
  assert.equal(context.chains[0].name, "Замок");
  assert.deepEqual(context.steps.map(({ label }) => label), ["Проверка предмета", "Разрешить", "Запретить"]);
});

test("built-in lock and trap templates encode the approved native examples without cooldown", () => {
  const lock = buildStorageLockTrigger();
  const doorLock = buildDoorLockTrigger();
  const trap = buildStorageTrapTrigger();
  assert.equal(lock.name, "Замок");
  assert.equal(lock.steps[0].type, "conditionItem");
  assert.deepEqual(lock.steps[0].config, { itemName: "", showItemName: false });
  assert.equal(lock.steps.at(-1).type, "deny");
  assert.equal(doorLock.steps.at(-1).config.message, "Дверь заперта.");
  assert.equal(trap.name, "Ловушка");
  assert.equal(trap.repeat, "oncePerCharacter");
  assert.deepEqual(trap.steps.map(({ type }) => type), ["savingThrow", "damage", "finish"]);
  assert.equal(JSON.stringify([lock, trap]).includes("cooldown"), false);
});

test("condition item inspector exposes a hidden-by-default name requirement", async () => {
  const state = createEmptyStorageTriggerState();
  state.chainsByEvent.beforeOpen.push(buildStorageLockTrigger());
  const app = new StorageTriggerEditor({
    async getStorageTriggers() { return { tokenUuid: "Token.chest", path: [], triggers: state }; }
  }, "Token.chest");

  const context = await app._prepareContext();

  assert.deepEqual(context.configFields, [
    { name: "itemName", label: "Название предмета", type: "text", value: "", checked: false },
    { name: "showItemName", label: "Показывать название предмета", type: "checkbox", value: false, checked: false }
  ]);
});

test("condition item drop resolves an Item or scene Token to its authoritative name", async () => {
  const fromUuid = async (uuid) => ({
    uuid,
    documentName: uuid.includes(".Token.") ? "Token" : "Item",
    name: uuid.includes(".Token.") ? " Медный ключ " : "Подозрительный ключ"
  });

  assert.equal(await resolveStorageTriggerItemDrop({ type: "Token", uuid: "Scene.room.Token.key" }, { fromUuid }), "Медный ключ");
  assert.equal(await resolveStorageTriggerItemDrop({ type: "Item", uuid: "Actor.hero.Item.key" }, { fromUuid }), "Подозрительный ключ");
  assert.equal(await resolveStorageTriggerItemDrop({ type: "JournalEntry", uuid: "JournalEntry.note" }, { fromUuid }), "");
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
  assert.doesNotMatch(editor, /data-field="target\.enabled"/u);
  assert.match(storage, /data-action="storage-open-trigger-editor"/u);
  assert.match(storage, /data-action="storage-reset-triggers"/u);
  assert.doesNotMatch(editor, /cooldown|перезаряд/iu);
});
