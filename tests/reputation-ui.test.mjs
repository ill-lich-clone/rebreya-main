import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
globalThis.foundry = { applications: { api: { ApplicationV2: class { async render() {} async _onRender() {} async _onClose() {} }, HandlebarsApplicationMixin: c => c } } };
const { ReputationPanel, buildReputationUpdateRequest } = await import("../scripts/ui/reputation-panel.js");
const actor = id => ({ uuid: `Actor.${id}`, name: id, type: "character", testUserPermission: () => true });
const a = actor("abcdefghijklmnop"), b = actor("ponmlkjihgfedcba");
function appFixture() {
  globalThis.game = { user: { isGM: true }, actors: [a, b] };
  globalThis.ui = { notifications: { error() {} } };
  const calls = [];
  const api = { getCosmologyState: () => ({ mechanusEnabled: false }),
    getReputation: async uuid => ({ actorUuid: uuid, name: uuid, fame: 4, infamy: 3, revision: 2, canEdit: true, recentChanges: [] }),
    updateReputation: async payload => calls.push(payload) };
  return { app: new ReputationPanel(api), api, calls };
}
test("explicit selection, independent display and read-only player context", async () => {
  const { app } = appFixture();
  assert.equal((await app.prepareContext([a, b])).selected, false);
  await app.selectReputationActor(a.uuid); const ctx = await app.prepareContext([a, b]);
  assert.deepEqual([ctx.fame, ctx.infamy], [4, 3]);
  game.user.isGM = false; assert.equal((await app.prepareContext([a, b])).canEdit, false);
  await app.prepareContext([b]);
  assert.equal(app.selectedActorUuid, "");
  assert.equal(app.reputationDraft, null);
});
test("cancel and invalid local form never send commands", async () => {
  const { app, calls } = appFixture(); await app.selectReputationActor(a.uuid); await app.prepareContext([a, b]);
  app.beginReputationEdit(); app.cancelReputationEdit(); assert.equal(calls.length, 0);
  app.beginReputationEdit(); app.reputationDraft.reason = "reason"; app.reputationDraft.fame = "1.5";
  await app.submitReputationEdit(); assert.equal(calls.length, 0);
  assert.throws(() => buildReputationUpdateRequest({ ...app.reputationDraft, fame: "1e2" }));
});
test("submit captures actor and revision while selection changes during await", async () => {
  const { app, api, calls } = appFixture(); let release;
  api.updateReputation = payload => { calls.push(payload); return new Promise(resolve => { release = resolve; }); };
  await app.selectReputationActor(a.uuid); await app.prepareContext([a, b]); app.beginReputationEdit();
  Object.assign(app.reputationDraft, { fame: "2", infamy: "0", reason: "Помощь" });
  const pending = app.submitReputationEdit(); await Promise.resolve();
  await app.selectReputationActor(b.uuid); release(); await pending;
  assert.equal(calls[0].actorUuid, a.uuid); assert.equal(calls[0].expectedRevision, 2); assert.equal(app.selectedActorUuid, b.uuid);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["actorUuid", "change", "expectedRevision", "operationId", "reason"].sort());
});
test("stale requires a new explicit edit; ambiguous retry keeps exact operation", async () => {
  const { app, api, calls } = appFixture();
  await app.selectReputationActor(a.uuid); await app.prepareContext([a, b]); app.beginReputationEdit(); app.reputationDraft.reason = "reason";
  api.updateReputation = async p => { calls.push(p); throw Object.assign(new Error("stale"), { code: "stale-revision" }); };
  await app.submitReputationEdit(); assert.equal(app.reputationDraft, null);
  await app.prepareContext([a, b]); app.beginReputationEdit(); app.reputationDraft.reason = "retry";
  api.updateReputation = async p => { calls.push(p); throw Object.assign(new Error("ambiguous"), { code: "ambiguous-outcome" }); };
  await app.submitReputationEdit(); await app.submitReputationEdit(); assert.deepEqual(calls.at(-1), calls.at(-2));
});
test("template places escaped counters only on inventory Group page", async () => {
  const html = await readFile(new URL("../templates/reputation-panel.hbs", import.meta.url), "utf8");
  const inventory = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const cosmology = await readFile(new URL("../templates/cosmology-app.hbs", import.meta.url), "utf8");
  assert.ok(inventory.indexOf("{{{reputationHtml}}}") > inventory.indexOf("{{#if tabs.isParty}}"));
  assert.doesNotMatch(cosmology, /reputation/u);
  assert.match(html, /data-reputation-panel/u);
  assert.match(html, /Слава/u); assert.match(html, /Дурная слава/u); assert.match(html, /Выберите персонажа/u);
  assert.doesNotMatch(html, /\{\{\{reputation/u);
});

test("rerender on the same root replaces listeners and close detaches them", async () => {
  const { app } = appFixture(); let changes = 0;
  const select = new EventTarget(); select.value = a.uuid;
  const previous = globalThis.HTMLElement;
  globalThis.HTMLElement = class { querySelector(selector) { return selector === "[data-reputation-actor]" ? select : null; } };
  try {
    app.element = new HTMLElement(); app.selectReputationActor = async () => { changes++; };
    app.bind(app.element); app.bind(app.element);
    select.dispatchEvent(new Event("change")); assert.equal(changes, 1);
    app.close(); select.dispatchEvent(new Event("change")); assert.equal(changes, 1);
  } finally { globalThis.HTMLElement = previous; }
});
