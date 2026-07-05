import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Forien quest overlay template exposes group, import, requirement, and reward actions", async () => {
  const template = await readFile(new URL("../templates/forien-quest-overlay.hbs", import.meta.url), "utf8");

  assert.match(template, /class="rm-fql-overlay"/u);
  assert.match(template, /data-rm-fql-action="assign-current-group"/u);
  assert.match(template, /data-rm-fql-action="import-subquest"/u);
  assert.match(template, /data-rm-fql-action="add-requirement"/u);
  assert.match(template, /data-rm-fql-action="add-unlock-reward"/u);
  assert.match(template, /data-rm-fql-action="apply-unlock-reward"/u);
});

test("Forien quest overlay styles are scoped to the quest preview", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay\s*\{/u);
  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay__grid\s*\{/u);
});

test("Forien quest overlay uses high-contrast parchment-safe colors", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /--rm-fql-overlay-bg:\s*rgb\(246 239 220 \/ 0\.96\);/u);
  assert.match(css, /--rm-fql-overlay-text:\s*#241b12;/u);
  assert.match(css, /--rm-fql-overlay-muted:\s*#5f5144;/u);
  assert.match(css, /--rm-fql-overlay-button-bg:\s*#2f3540;/u);
  assert.match(css, /--rm-fql-overlay-button-text:\s*#f7f1e4;/u);
  assert.match(css, /background:\s*var\(--rm-fql-overlay-bg\);/u);
  assert.match(css, /color:\s*var\(--rm-fql-overlay-text\);/u);
});

test("main entrypoint wires the Rebreya quest log service and Forien integration", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(source, /RebreyaQuestLogService/u);
  assert.match(source, /registerForienQuestLogIntegration/u);
  assert.match(source, /this\.questLogService\s*=\s*new RebreyaQuestLogService/u);
  assert.match(source, /registerForienQuestLogIntegration\(moduleApi\)/u);
});
