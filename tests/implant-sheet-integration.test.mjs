import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("modification tab shows installed and installable item names without the inventory renderer", async () => {
  const template = await readFile(
    new URL("../templates/modification-tab.hbs", import.meta.url),
    "utf8"
  );
  assert.match(
    template,
    /Установленные[\s\S]*\{\{#each modification\.installedEntries\}\}[\s\S]*Доступные к установке[\s\S]*\{\{#each installableImplants\}\}/u
  );
  assert.equal(template.match(/data-link data-uuid="\{\{uuid\}\}" href="#">\{\{name\}\}/gu)?.length, 2);
  assert.doesNotMatch(template, /inventory\.hbs|Бросок|\{\{img\}\}/u);
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
