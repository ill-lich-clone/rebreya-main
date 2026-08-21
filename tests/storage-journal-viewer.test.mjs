import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { openStorageJournalViewer } = await import("../scripts/ui/storage-journal-viewer.js?storage-journal-viewer-test");

test("storage Journal viewer renders only the returned safe snapshot in a close-only dialog", async () => {
  const snapshot = {
    name: "Полевые заметки",
    pages: [
      { pageId: "text-1", name: "День первый", type: "text", html: "<p>Очищенный текст</p>" },
      { pageId: "image-1", name: "Карта", type: "image", src: "maps/camp.webp", caption: "Лагерь" }
    ]
  };
  const renderCalls = [];
  let dialog = null;
  class FakeDialogV2 {
    constructor(options) { this.options = options; dialog = this; }
    render(force) { this.force = force; return this; }
  }

  const result = await openStorageJournalViewer(snapshot, {
    renderTemplate: async (...args) => { renderCalls.push(args); return "<section>rendered</section>"; },
    dialogClass: FakeDialogV2
  });

  assert.equal(result, dialog);
  assert.deepEqual(renderCalls, [[
    "modules/rebreya-main/templates/storage-journal-viewer.hbs",
    snapshot
  ]]);
  assert.equal(dialog.force, true);
  assert.equal(dialog.options.window.title, "Полевые заметки");
  assert.deepEqual(dialog.options.position, { width: 760, height: "auto" });
  assert.deepEqual(dialog.options.buttons.map(({ action }) => action), ["close"]);
  assert.equal(dialog.options.content, "<section>rendered</section>");
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
