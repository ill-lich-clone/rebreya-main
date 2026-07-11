import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Forien quest overlay template exposes group, import, requirement, and reward actions", async () => {
  const template = await readFile(new URL("../templates/forien-quest-overlay.hbs", import.meta.url), "utf8");

  assert.match(template, /class="rm-fql-overlay"/u);
  assert.match(template, /data-rm-fql-action="assign-current-group"/u);
  assert.match(template, /data-rm-fql-action="import-subquest"/u);
  assert.match(template, /data-rm-fql-action="add-requirement"/u);
  assert.match(template, /data-rm-fql-action="update-requirement"/u);
  assert.match(template, /data-rm-fql-action="remove-requirement"/u);
  assert.match(template, /data-rm-fql-action="add-unlock-reward"/u);
  assert.match(template, /data-rm-fql-action="apply-unlock-reward"/u);
  assert.match(template, /data-rm-fql-action="remove-unlock-reward"/u);
  assert.match(template, /name="rm-fql-required-type"/u);
  assert.match(template, /name="rm-fql-required-status"/u);
  assert.match(template, /name="rm-fql-required-level"/u);
  assert.match(template, /name="rm-fql-required-item-name"/u);
  assert.match(template, /data-rm-fql-requirement-field="level"/u);
  assert.match(template, /data-rm-fql-requirement-field="item"/u);
  assert.match(template, /name="rm-fql-import-search"/u);
  assert.match(template, /name="rm-fql-required-search"/u);
  assert.match(template, /name="rm-fql-unlock-search"/u);
});

test("Forien quest overlay integration wires search filtering and editable row actions", async () => {
  const source = await readFile(new URL("../scripts/integrations/forien-quest-log.js", import.meta.url), "utf8");

  assert.match(source, /filterQuestSelectOptions/u);
  assert.match(source, /data-rm-fql-search-target/u);
  assert.match(source, /action === "update-requirement"/u);
  assert.match(source, /action === "remove-requirement"/u);
  assert.match(source, /action === "remove-unlock-reward"/u);
  assert.match(source, /syncRequirementTypeFields/u);
  assert.match(source, /getRequirementPayload/u);
});

test("Forien quest integration wires subtasks, right-click task failure, and activity tabs", async () => {
  const source = await readFile(new URL("../scripts/integrations/forien-quest-log.js", import.meta.url), "utf8");
  const template = await readFile(new URL("../templates/forien-quest-log-activities.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/quest-log-enhancements.css", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../module.json", import.meta.url), "utf8");
  const resolveRollTableSource = source.slice(
    source.indexOf("async function resolveRollTable"),
    source.indexOf("async function rollRumorFromTable")
  );

  assert.match(source, /contextmenu/u);
  assert.match(source, /markTaskFailed/u);
  assert.match(source, /injectQuestTaskEnhancements/u);
  assert.match(source, /injectQuestLogActivities/u);
  assert.match(source, /promptQuestActivityForm/u);
  assert.match(source, /DialogV2\.wait/u);
  assert.match(source, /roll-rumor-table/u);
  assert.match(resolveRollTableSource, /try\s*\{[\s\S]*fromUuid[\s\S]*catch/u);
  assert.match(template, /data-rm-fql-log-panel="rumors"/u);
  assert.match(template, /data-rm-fql-log-panel="events"/u);
  assert.match(template, /data-rm-fql-log-action="add-rumor-entry"/u);
  assert.match(template, /data-rm-fql-log-action="edit-rumor-topic"/u);
  assert.match(template, /data-rm-fql-log-action="edit-rumor-entry"/u);
  assert.match(template, /data-rm-fql-log-action="add-event"/u);
  assert.match(template, /data-rm-fql-log-action="edit-event"/u);
  assert.doesNotMatch(template, /name="rm-fql-event-title"/u);
  assert.doesNotMatch(template, /name="rm-fql-rumor-title"/u);
  assert.doesNotMatch(template, /name="rm-fql-rumor-entry"/u);
  assert.match(css, /\.forien-quest-log\s+\.rm-fql-log-panel/u);
  assert.match(manifest, /styles\/quest-log-enhancements\.css/u);
});

test("Forien quest log refreshes when the active Rebreya group changes", async () => {
  const integrationSource = await readFile(new URL("../scripts/integrations/forien-quest-log.js", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(integrationSource, /export\s+async\s+function\s+refreshForienQuestLogApps/u);
  assert.match(integrationSource, /ViewManager\.renderAll\(\{\s*force:\s*true,\s*questPreview:\s*true/u);
  assert.match(mainSource, /refreshForienQuestLogApps/u);
  assert.match(
    mainSource,
    /async\s+setActivePartyGroup[\s\S]+?await\s+this\.refreshOpenApps\(\);[\s\S]+?await\s+refreshForienQuestLogApps\(\);/u
  );
});

test("Forien quest overlay styles are scoped to the quest preview", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay\s*\{/u);
  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay__grid\s*\{/u);
  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay__panel--wide\s*\{/u);
  assert.match(css, /grid-column:\s*1 \/ -1;/u);
});

test("Forien quest overlay layout stretches panels across the preview width", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay\s*\{[^}]*width:\s*100%;/su);
  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay__grid\s*\{[^}]*width:\s*100%;/su);
  assert.match(css, /\.forien-quest-preview\s+\.rm-fql-overlay__panel\s*\{[^}]*width:\s*100%;/su);
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
