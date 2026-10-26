import assert from "node:assert/strict";
import test from "node:test";

const KEY = "CHRISPREMADES.Macros.MagicMissile.Shield";
async function harness({ accepted = true, denied = false, fail = false, cancelUse = false } = {}) {
  const { CprShieldReactionAdapter } = await import("../scripts/integrations/cpr-shield-reaction-adapter.js");
  const events = []; const dialogs = [];
  const actor = { uuid: "Actor.owner", effects: [], items: [] };
  const item = { id: "shield", uuid: "Actor.owner.Item.shield", type: "spell", actor,
    flags: { "rebreya-main": { shieldReaction: { version: 1 } } } };
  const activity = { uuid: `${item.uuid}.Activity.cast`, actor, item, activation: { type: "reaction" } };
  item.system = { activities: [activity] }; actor.items = [item];
  class Dialog {
    render() { dialogs.push(this); return this; }
    async close() { this.resolve(null); }
    static dialog(...args) {
      events.push("dialog");
      return new Promise(resolve => { const dialog = new Dialog(); dialog.resolve = resolve; dialog.render(); });
    }
  }
  const midi = { completeItemUse: async (used, config, options) => {
    events.push(["use", used.uuid, config, options]);
    if (fail) throw new Error("native failed");
    if (cancelUse) return undefined;
    (used.actor ?? actor).effects.push({ flags: { "chris-premades": { info: { identifier: "shield" } } } });
    return { uuid: "workflow.cast", item: used };
  } };
  let controls;
  const queue = { resolveManagedReaction: async (request, execute) => {
    events.push(["begin", request.candidate.actorUuid]);
    const controller = new AbortController();
    controls = { signal: controller.signal, sessionId: "lease-1", commit: async choice => { events.push(["commit", choice.activityUuid]); return !denied; } };
    controls.abort = () => controller.abort();
    const result = await execute(controls);
    events.push(["finish", result.name]); return result;
  } };
  const actors = [actor];
  const cpr = { DialogApp: Dialog, utils: { dialogUtils: { selectDocumentDialog: async (title, content, documents) => {
    const uuidMode = !documents[0]?.id;
    const answer = await Dialog.dialog(title, content, [["button", documents.map(doc => ({ name: uuidMode ? doc.uuid : doc.id }))]]);
    return documents.find(doc => (uuidMode ? doc.uuid : doc.id) === answer?.buttons);
  } } } };
  const adapter = new CprShieldReactionAdapter({ reactionQueueService: queue }, {
    cprProvider: () => cpr, midiProvider: () => midi,
    actorsProvider: () => actors, canOfferShield: async () => accepted, idFactory: () => "trigger-1"
  });
  adapter.initialize();
  const args = ["Magic Missile", KEY, [["button", [{ name: item.id }, { name: "none" }]]]];
  return { adapter, actor, item, activity, events, dialogs, midi, cpr, actors, Dialog, args, controls: () => controls,
    select: () => Dialog.dialog(...args), use: () => midi.completeItemUse(item, { native: true }, { targetUuids: [actor.uuid] }) };
}
async function untilDialog(h) { for (let i = 0; i < 100 && !h.dialogs.length; i++) await Promise.resolve(); assert.equal(h.dialogs.length, 1); }

test("CPR selection stays inside owner queue through one native use and effect before finish", async () => {
  const h = await harness();
  const selection = h.select(); await untilDialog(h);
  h.dialogs[0].resolve({ buttons: "shield" });
  assert.deepEqual(await selection, { buttons: "shield" });
  assert.equal(h.events.some(x => x[0] === "finish"), false);
  const result = await h.use();
  assert.equal(result.uuid, "workflow.cast");
  assert.deepEqual(h.events.map(x => Array.isArray(x) ? x[0] : x), ["begin", "dialog", "commit", "use", "finish"]);
  assert.equal(h.actor.effects.length, 1);
  assert.equal(h.adapter.pending.size, 0);
});

test("CPR decline, close, denied commit and timeout do not start native use or keep a pending lease", async () => {
  for (const mode of ["none", "close", "denied", "abort"]) {
    const h = await harness({ denied: mode === "denied" });
    const selection = h.select(); await untilDialog(h);
    if (mode === "abort") h.controls().abort();
    else h.dialogs[0].resolve(mode === "close" ? null : { buttons: mode === "denied" ? "shield" : "none" });
    assert.equal((await selection)?.buttons === "shield", false);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.events.some(x => x[0] === "use"), false);
    assert.equal(h.adapter.pending.size, 0);
  }
});

test("CPR native resource cancellation and native failure finish without successful Shield result", async () => {
  for (const fail of [false, true]) {
    const h = await harness({ fail, cancelUse: !fail });
    const selection = h.select(); await untilDialog(h); h.dialogs[0].resolve({ buttons: "shield" }); await selection;
    if (fail) await assert.rejects(h.use(), /native failed/); else assert.equal(await h.use(), undefined);
    assert.equal(h.actor.effects.length, 0); assert.equal(h.adapter.pending.size, 0);
    assert.deepEqual(h.events.at(-1), ["finish", "None"]);
  }
});

test("CPR unrelated dialogs and nested other item use retain original contracts and initialization is idempotent", async () => {
  const h = await harness(); const dialog = h.Dialog.dialog; const use = h.midi.completeItemUse;
  h.adapter.initialize(); assert.equal(h.Dialog.dialog, dialog); assert.equal(h.midi.completeItemUse, use);
  const selection = h.select(); await untilDialog(h); h.dialogs[0].resolve({ buttons: "shield" }); await selection;
  const other = { uuid: "Actor.owner.Item.other" };
  assert.equal((await h.midi.completeItemUse(other, {}, {})).item, other);
  assert.equal(h.events.some(x => x[0] === "finish"), false);
  await h.use();
  const unrelated = h.Dialog.dialog("Other", "OTHER", []);
  assert.equal(h.dialogs.length, 2); h.dialogs[1].resolve({ buttons: "custom" });
  assert.deepEqual(await unrelated, { buttons: "custom" });
});

test("already active or unavailable Shield and an unconnected coordinator cannot open a CPR Shield prompt", async () => {
  const h = await harness({ accepted: false });
  assert.equal(await h.select(), null); assert.equal(h.dialogs.length, 0);
  const missing = await harness();
  missing.adapter.moduleApi.reactionQueueService.resolveManagedReaction = async () => ({ name: "None" });
  assert.equal(await missing.select(), null); assert.equal(missing.dialogs.length, 0);
});

test("overlapping CPR attacks wait for the first Shield and do not recast or damage through its active effect", async () => {
  const h = await harness();
  const first = h.select(); await untilDialog(h);
  const second = h.select();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.dialogs.length, 1);
  h.dialogs[0].resolve({ buttons: "shield" }); await first;
  await h.use();
  assert.deepEqual(await second, { buttons: "shield" });
  assert.equal(await h.use(), undefined);
  assert.equal(h.events.filter(x => x[0] === "use").length, 1);
  assert.equal(h.actor.effects.length, 1);
});

test("two simultaneous native handoff calls execute the selected CPR Shield once", async () => {
  const h = await harness();
  const selection = h.select(); await untilDialog(h); h.dialogs[0].resolve({ buttons: "shield" }); await selection;
  const [a, b] = await Promise.all([h.use(), h.use()]);
  assert.equal(a, b); assert.equal(h.events.filter(x => x[0] === "use").length, 1);
});

test("CPR selector carries full Item UUID so synthetic/base Actors sharing embedded ids cannot bypass queue", async () => {
  const h = await harness();
  const synthetic = { uuid: "Scene.room.Token.copy.Actor.owner", effects: [], items: [] };
  const copy = { ...h.item, actor: synthetic, uuid: `${synthetic.uuid}.Item.shield` };
  copy.system = { activities: [{ ...h.activity, item: copy, actor: synthetic, uuid: `${copy.uuid}.Activity.cast` }] };
  synthetic.items = [copy]; h.actors.push(synthetic);
  const chosen = h.cpr.utils.dialogUtils.selectDocumentDialog("Magic Missile", KEY, [copy]);
  await untilDialog(h);
  assert.deepEqual(h.events[0], ["begin", synthetic.uuid]);
  h.dialogs[0].resolve({ buttons: copy.uuid });
  assert.equal((await chosen).uuid, copy.uuid);
  await h.midi.completeItemUse(copy, {}, {});
});
