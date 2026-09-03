import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { openStorageJournalViewer } = await import("../scripts/ui/storage-journal-viewer.js?storage-journal-viewer-test");

test("ordinary storage Journal viewer offers only the record action", async () => {
  const snapshot = {
    name: "Полевые заметки",
    pages: [
      { pageId: "text-1", name: "День первый", type: "text", html: "<p>Очищенный текст</p>" },
      { pageId: "image-1", name: "Карта", type: "image", src: "maps/camp.webp", caption: "Лагерь" }
    ]
  };
  const renderCalls = [];
  const recordCalls = [];
  const notifications = [];
  let dialog = null;
  class FakeDialogV2 {
    constructor(options) { this.options = options; dialog = this; }
    render(force) { this.force = force; return this; }
  }

  const result = await openStorageJournalViewer(snapshot, {
    renderTemplate: async (...args) => { renderCalls.push(args); return "<section>rendered</section>"; },
    dialogClass: FakeDialogV2,
    notifications: { info: (message) => notifications.push(message) },
    onRecord: async () => { recordCalls.push("record"); return { created: true }; }
  });

  assert.equal(result, dialog);
  assert.deepEqual(renderCalls, [[
    "modules/rebreya-main/templates/storage-journal-viewer.hbs",
    snapshot
  ]]);
  assert.equal(dialog.force, true);
  assert.equal(dialog.options.window.title, "Полевые заметки");
  assert.deepEqual(dialog.options.position, { width: 760, height: "auto" });
  assert.deepEqual(dialog.options.buttons.map(({ action, label }) => [action, label]), [["record", "Записать"]]);
  assert.equal(dialog.options.content, "<section>rendered</section>");

  await dialog.options.buttons[0].callback();
  assert.deepEqual(recordCalls, ["record"]);
  assert.deepEqual(notifications, ["Запись добавлена в инвентарь."]);
});

test("record Item Journal viewer satisfies DialogV2 while exposing no visible action buttons", async () => {
  let dialog;
  class FakeDialogV2 {
    constructor(options) {
      if (!options.buttons?.length) throw new Error("You must define at least one entry in config.buttons");
      this.options = options;
      dialog = this;
    }
    render() { return this; }
  }

  await openStorageJournalViewer({ name: "Запись", pages: [] }, {
    renderTemplate: async () => "<section></section>",
    dialogClass: FakeDialogV2
  });

  assert.deepEqual(dialog.options.classes, [
    "rm-storage-journal-dialog",
    "rm-storage-journal-dialog--readonly"
  ]);
  assert.deepEqual(dialog.options.buttons, [{
    action: "readonly",
    label: "",
    type: "button",
    disabled: true,
    class: "rm-storage-journal-viewer__sentinel",
    style: { display: "none" }
  }]);
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  assert.match(css, /\.rm-storage-journal-dialog--readonly\s+\.form-footer\s*\{[^}]*display:\s*none;/su);
});

test("Journal record action distinguishes an existing Item and handles failures without rejection", async () => {
  const notifications = [];
  let dialog;
  class FakeDialogV2 {
    constructor(options) { this.options = options; dialog = this; }
    render() { return this; }
  }
  await openStorageJournalViewer({ name: "Запись", pages: [] }, {
    renderTemplate: async () => "<section></section>",
    dialogClass: FakeDialogV2,
    notifications: { info: (message) => notifications.push(message) },
    onRecord: async () => ({ created: false })
  });
  await dialog.options.buttons[0].callback();
  assert.deepEqual(notifications, ["Эта запись уже есть в инвентаре."]);

  const failure = new Error("write failed");
  const errors = [];
  await openStorageJournalViewer({ name: "Запись", pages: [] }, {
    renderTemplate: async () => "<section></section>",
    dialogClass: FakeDialogV2,
    notifications: { error: (message) => errors.push(message) },
    onRecord: async () => { throw failure; }
  });
  assert.equal(await dialog.options.buttons[0].callback(), false);
  assert.deepEqual(errors, ["write failed"]);
});

test("storage Journal viewer template uses safe text and whitelisted media without document controls", async () => {
  const template = await readFile(new URL("../templates/storage-journal-viewer.hbs", import.meta.url), "utf8");

  assert.match(template, /\{\{\{html\}\}\}/u);
  assert.match(template, /<img[^>]*src="\{\{src\}\}"[^>]*alt="\{\{caption\}\}"/u);
  assert.match(template, /<video[^>]*src="\{\{src\}\}"[^>]*controls/u);
  assert.match(template, /<iframe[^>]*src="\{\{src\}\}"/u);
  assert.doesNotMatch(template, /uuid|data-action|edit|export|ownership|claim|drag|autoplay/iu);
});

test("storage Journal viewer keeps images proportional and narrower than a wide dialog", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const imageRule = css.match(/\.rebreya-storage-journal-viewer__page img\s*\{(?<body>[^}]*)\}/u)?.groups?.body ?? "";

  assert.match(imageRule, /width:\s*auto;/u);
  assert.match(imageRule, /max-width:\s*min\(100%,\s*720px\);/u);
  assert.match(imageRule, /height:\s*auto;/u);
  assert.match(imageRule, /margin-inline:\s*auto;/u);
});
