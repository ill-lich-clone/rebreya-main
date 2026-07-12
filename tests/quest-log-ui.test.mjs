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
  const logTemplate = await readFile(new URL("../templates/forien-quest-log.hbs", import.meta.url), "utf8");
  const rumorEditor = await readFile(new URL("../templates/forien-quest-rumor-editor.hbs", import.meta.url), "utf8");
  const eventEditor = await readFile(new URL("../templates/forien-quest-event-editor.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/quest-log-enhancements.css", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../module.json", import.meta.url), "utf8");
  const resolveRollTableSource = source.slice(
    source.indexOf("async function resolveRollTable"),
    source.indexOf("async function rollRumorFromTable")
  );

  assert.match(source, /contextmenu/u);
  assert.match(source, /markTaskFailed/u);
  assert.match(source, /injectQuestTaskEnhancements/u);
  assert.match(source, /patchQuestLogApplication/u);
  assert.match(source, /QuestLog\.prototype\.getData/u);
  assert.match(source, /QuestLog\.prototype\.activateListeners/u);
  assert.match(source, /QuestLog\.prototype\._render/u);
  assert.match(source, /REBREYA_QUEST_LOG_TEMPLATE/u);
  assert.doesNotMatch(source, /nav\.insertAdjacentHTML\("beforeend"/u);
  assert.match(source, /RebreyaRumorEditor/u);
  assert.match(source, /RebreyaQuestEventEditor/u);
  assert.match(source, /openQuestActivityEditor/u);
  assert.match(source, /rememberQuestLogTab/u);
  assert.match(source, /roll-rumor-table/u);
  assert.match(source, /toggle-rumor-entry-visibility/u);
  assert.match(source, /function getRumorEntryRow[\s\S]+li\[data-rumor-entry-id\]/u);
  assert.match(source, /const row = getRumorEntryRow\(button\)/u);
  assert.match(source, /rm-fql-subtask-row/u);
  assert.match(source, /getTaskInheritance/u);
  assert.match(source, /is-parent-hidden/u);
  assert.match(source, /is-parent-completed/u);
  assert.match(source, /is-parent-failed/u);
  assert.match(source, /callback:\s*\(\)\s*=>\s*null/u);
  assert.match(source, /insertAdjacentHTML\("afterend"/u);
  assert.match(resolveRollTableSource, /try\s*\{[\s\S]*fromUuid[\s\S]*catch/u);
  assert.match(logTemplate, /modules\/forien-quest-log\/templates\/partials\/quest-log\/tab\.html/u);
  assert.match(logTemplate, /data-tab="rebreya-rumors"/u);
  assert.match(logTemplate, /data-tab="rebreya-events"/u);
  assert.match(logTemplate, /modules\/rebreya-main\/templates\/forien-quest-log-activities\.hbs/u);
  assert.match(template, /data-rm-fql-log-panel="rumors"/u);
  assert.match(template, /data-rm-fql-log-panel="events"/u);
  assert.match(template, /data-rm-fql-log-action="open-rumor-topic"/u);
  assert.match(template, /data-rm-fql-log-action="add-event"/u);
  assert.match(template, /data-rm-fql-log-action="open-event"/u);
  assert.match(template, /class="drag-quest/u);
  assert.match(template, /class="open-quest title"/u);
  assert.match(template, /class="actions/u);
  assert.match(rumorEditor, /class="quest-preview/u);
  assert.match(rumorEditor, /class="details-header"/u);
  assert.match(rumorEditor, /class="quest-info"/u);
  assert.match(rumorEditor, /class="quest-tasks"/u);
  assert.match(rumorEditor, /class="actions tasks/u);
  assert.match(source, /#runLockedEditorAction/u);
  assert.match(rumorEditor, /data-rm-fql-editor-action="toggle-rumor-entry-visibility"/u);
  assert.match(rumorEditor, /name="rm-fql-rumor-table"/u);
  assert.match(eventEditor, /name="rm-fql-event-text"/u);
  assert.doesNotMatch(template, /name="rm-fql-event-title"/u);
  assert.doesNotMatch(template, /name="rm-fql-rumor-title"/u);
  assert.doesNotMatch(template, /name="rm-fql-rumor-entry"/u);
  assert.match(css, /\.forien-quest-log\s+\.rm-fql-log-panel/u);
  assert.match(css, /\.forien-quest-preview\s+\.quest-tasks\s+ul\s+li\.rm-fql-subtask-row/u);
  assert.match(css, /margin-left:\s*56px/u);
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
