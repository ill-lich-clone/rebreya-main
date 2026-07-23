import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("modification tab reuses the native dnd5e inventory renderer", async () => {
  const template = await readFile(
    new URL("../templates/modification-tab.hbs", import.meta.url),
    "utf8"
  );
  assert.match(
    template,
    /\{\{>\s*"systems\/dnd5e\/templates\/inventory\/inventory\.hbs"\s*\}\}/u
  );
  assert.doesNotMatch(template, /rm-(?:implant|modification)-(?:card|tile)/u);
  assert.match(template, /modification\.used/u);
  assert.match(template, /modification\.capacity/u);
});

test("modification styles stay scoped and collapse cleanly on narrow sheets", async () => {
  const styles = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  assert.match(styles, /\.tab\.rm-modification-tab/u);
  assert.match(styles, /@container\s*\(max-width:\s*700px\)/u);
  assert.match(styles, /\.rm-modification-tab__header/u);
});

test("long-rest implant dialog displays outer pipeline progress", async () => {
  const source = await readFile(
    new URL("../scripts/data/implant-service.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /progress\?\.title\?\.\("Модифицирование"\)/u);
  assert.match(source, /progress\?\.header\?\.\("Модифицирование"\)/u);
  assert.match(source, /close:\s*\(\)\s*=>\s*null/u);
});
