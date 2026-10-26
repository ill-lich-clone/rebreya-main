import assert from "node:assert/strict";
import test from "node:test";

async function harness({ type = "activity", fail = false, force = false } = {}) {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  const dialogs = []; const events = [];
  let now = 100;
  let controls;
  const actor = { uuid: "Actor.guard", flags: { "midi-qol": { optional: type === "ac" ? { shield: { ac: "@abilities.dex.mod + 1d4", ...(force ? { force: "true" } : {}), count: "reaction" } } : {} } }, name: "Guard" };
  class NativeDialog {
    constructor(data) { this.data = data; }
    render() {
      this.data.buttons = [{ key: "Activity.shield", callback: this.data.callback }];
      dialogs.push(this); return this;
    }
    async submit(button = this.data.buttons[0]) { this.data.completed = true; await button.callback(this, button); }
    async close() { this.closed = true; if (!this.data.completed) this.data.close?.(); }
  }
  class OptionalDialog extends NativeDialog {
    async submit(button) { await this.data.callback(this, button); }
    async close() { this.closed = true; this.data.close?.(); }
  }
  const original = async data => {
    if (force) {
      events.push("forced");
      return { name: "Guard", uuid: actor.uuid, ac: 19 };
    }
    return new Promise(resolve => {
      const optional = type === "ac";
      let result = { name: "None" };
      const Class = optional ? OptionalDialog : NativeDialog;
      const dialog = new Class({ actor, content: optional ? '<div>native dice HTML</div>' : data.reactionFlavor,
        ...(optional ? {rollHTML: '<div>native dice HTML</div>', targetObject: {actor, rollHTML: data.reactionFlavor}} : {}), timeout: 10,
        callback: async (_dialog, button) => {
          events.push(["native-callback", button.value, button.key]);
          result = fail ? { name: "None" } : optional ? { name: "Guard", uuid: actor.uuid, ac: 18 } : { name: "Shield", uuid: button.key, itemUuid: "Item.shield" };
          if (!optional) resolve(result);
        },
        close: () => resolve(result)
      });
      dialog.render({ force: true });
    });
  };
  const socket = { functions: new Map([["chooseReactions", original]]) };
  const queue = {
    async resolveManagedReaction(request, execute) {
      events.push("service");
      const controller = new AbortController();
      controls = { signal: controller.signal, commit: async () => { events.push("commit"); return true; }, sessionId: `session-${events.length}` };
      const pending = execute(controls);
      controls.abort = () => controller.abort("timeout");
      return pending;
    }
  };
  const midi = { apps: { ReactionDialog: NativeDialog, RollModifyDialog: OptionalDialog } };
  const adapter = new MidiReactionAdapter({ reactionQueueService: queue }, {
    midiProvider: () => midi,
    socketProvider: () => socket,
    resolver: uuid => uuid === "Token.guard" ? { actor, uuid } : { actor, item: { actor }, uuid },
    now: () => now
  });
  await adapter.initialize();
  const data = { tokenUuid: "Token.guard", triggerTokenUuid: "Token.enemy", triggerType: type === "ac" || force ? "reactionattacked" : "reaction", reactionFlavor: "Choose", reactionActivityList: type === "activity" && !force ? ["Activity.shield"] : [], options: { workflowId: "attack:1" } };
  return { adapter, socket, original, actor, dialogs, events, data, controls: () => controls, now: value => { now = value; }, invoke: () => socket.functions.get("chooseReactions")(data) };
}

test("native socket handler goes through service and commits before original activity callback", async () => {
  const h = await harness();
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  assert.deepEqual(h.events, ["service"]);
  await h.dialogs[0].submit();
  assert.deepEqual(await pending, { name: "Shield", uuid: "Activity.shield", itemUuid: "Item.shield" });
  assert.deepEqual(h.events, ["service", "commit", ["native-callback", undefined, "Activity.shield"]]);
});

test("optional AC native formula and counter callback is preserved, including multiple choices", async () => {
  const h = await harness({ type: "ac" });
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  const button = { key: "flags.midi-qol.optional.guard", value: "@abilities.dex.mod + 1d4" };
  await h.dialogs[0].submit(button);
  await h.dialogs[0].submit({ ...button, key: "flags.midi-qol.optional.other" });
  await h.dialogs[0].close();
  assert.equal((await pending).ac, 18);
  assert.equal(h.events.filter(x => Array.isArray(x) && x[0] === "native-callback").length, 2);
  assert.deepEqual(h.events[2], ["native-callback", button.value, button.key]);
});

test("native close and failed activity keep original no-result contract", async () => {
  for (const fail of [false, true]) {
    const h = await harness({ fail });
    const pending = h.invoke();
    while (!h.dialogs.length) await Promise.resolve();
    if (fail) await h.dialogs[0].submit();
    else await h.dialogs[0].close();
    assert.deepEqual(await pending, { name: "None" });
  }
});

test("aborted native session closes only its dialog and rejects late callbacks", async () => {
  const h = await harness();
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  h.controls().abort();
  assert.deepEqual(await pending, { name: "None" });
  await h.dialogs[0].submit();
  assert.equal(h.events.some(x => Array.isArray(x)), false);
});

test("late native callback after authoritative deadline cannot start application", async () => {
  const h = await harness();
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  h.now(10101);
  await h.dialogs[0].submit();
  assert.deepEqual(await pending, { name: "None" });
  assert.equal(h.events.some(x => Array.isArray(x)), false);
});

test("forced optional AC obtains permission before native headless execution", async () => {
  const h = await harness({ type: "ac", force: true });
  assert.equal((await h.invoke()).ac, 19);
  assert.deepEqual(h.events, ["service", "commit", "forced"]);
});

test("initialization is idempotent and unrelated dialogs render without interception", async () => {
  const h = await harness();
  const wrapped = h.socket.functions.get("chooseReactions");
  await h.adapter.initialize();
  assert.equal(h.socket.functions.get("chooseReactions"), wrapped);
  const Class = h.adapter._options.midiProvider().apps.RollModifyDialog;
  const dialog = new Class({ actor: h.actor, content: "Ordinary attack bonus", callback: async () => h.events.push("ordinary") });
  dialog.render(); await dialog.submit({});
  assert.deepEqual(h.events, ["ordinary"]);
});

test("denied coordinator commit prevents native payment or formula application", async () => {
  const h = await harness();
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  h.controls().commit = async () => false;
  // Adapter retains the controls object; permission denial is checked on use.
  const session = [...h.adapter._sessions.values()][0];
  session.commit = async () => false;
  await h.dialogs[0].submit();
  assert.deepEqual(await pending, { name: "None" });
  assert.equal(h.events.some(Array.isArray), false);
});

test("unsupported native API fails explicitly instead of reporting coverage", async () => {
  const h = await harness();
  const errors = [];
  const Adapter = h.adapter.constructor;
  const adapter = new Adapter({}, { midiProvider: () => ({}), socketProvider: () => ({}), logger: { error: error => errors.push(error) } });
  assert.equal(await adapter.initialize(), false);
  assert.equal(errors.length, 1);
});

test("two activity clicks during the same pending permission apply only once", async () => {
  const h = await harness();
  const pending = h.invoke();
  while (!h.dialogs.length) await Promise.resolve();
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  [...h.adapter._sessions.values()][0].commit = () => permission;
  const first = h.dialogs[0].submit();
  const second = h.dialogs[0].submit();
  allow(true);
  await Promise.all([first, second, pending]);
  assert.equal(h.events.filter(Array.isArray).length, 1);
});

function shieldCase({ total = 12, ac = 10, critical = false, resourceErrors = false } = {}) {
  const actor = { uuid: "Actor.defender", system: { attributes: { ac: { value: ac, cover: 0 } } }, effects: [],
    flags: {}, statuses: new Set() };
  const item = { uuid: "Actor.defender.Item.shield", actor, type: "spell", system: { level: 1, method: "spell", prepared: 1 },
    flags: { "rebreya-main": { shieldReaction: { version: 1 } } } };
  const activity = { uuid: `${item.uuid}.Activity.cast`, id: "cast", actor, item, reactionCondition: "",
    _prepareUsageConfig: () => ({}), _prepareUsageUpdates: async () => resourceErrors ? [new Error("No resource")] : ({}) };
  const target = { actor, document: { uuid: "Scene.room.Token.guard" }, cover: 0 };
  const attacker = { uuid: "Actor.attacker", flags: {} };
  const workflow = { id: "attack-1", actor: attacker, token: { actor: attacker }, attackTotal: total,
    attackRoll: { total }, isCritical: critical, isFumble: false, activity: { actionType: "mwak", item: { type: "weapon" }, attack: {} },
    targets: new Set([target]), targetACModifiers: new Map(), targetDescriptors: [] };
  const midi = { configSettings: () => ({ ignoreSpellReactionRestriction: true, optionalRules: {} }),
    computeCoverBonus: (_attacker, token) => token.cover, createConditionData: x => x, evalCondition: x => x === "allowed" };
  return { actor, item, activity, target, workflow, midi };
}

test("managed Shield filter offers only ordinary hits that +5 actually cancels and preserves other reactions", async () => {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  for (const [total, want] of [[9, false], [10, true], [14, true], [15, false], [20, false]]) {
    for (const trigger of ["reaction", "reactionattacked", "reactionmissed", "reactionpreattack"]) {
      const h = shieldCase({ total });
      const adapter = new MidiReactionAdapter({}, { midiProvider: () => h.midi });
      const other = { uuid: "other", item: { type: "spell" } };
      const reactions = [h.activity, other]; const ids = reactions.map(x => x.uuid);
      await adapter.filterReactions(reactions, { workflow: h.workflow }, trigger, ids);
      assert.deepEqual(ids, want && trigger === "reaction" ? [h.activity.uuid, "other"] : ["other"], `${total}/${trigger}`);
      assert.equal(reactions.at(-1), other);
    }
  }
});

test("Shield filter respects critical, fumble, existing effects, preparation, resources and authored conditions", async () => {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  for (const change of [h => { h.workflow.isCritical = true; }, h => { h.workflow.isFumble = true; },
    h => { h.actor.effects.push({ flags: { "chris-premades": { info: { identifier: "shield" } } } }); },
    h => { h.item.system.prepared = 0; }, h => { h.activity._prepareUsageUpdates = async () => ["No slot"]; },
    h => { h.activity.reactionCondition = "forbidden"; }]) {
    const h = shieldCase(); change(h);
    const adapter = new MidiReactionAdapter({}, { midiProvider: () => h.midi });
    const ids = [h.activity.uuid];
    await adapter.filterReactions([h.activity], { workflow: h.workflow }, "reaction", ids);
    assert.deepEqual(ids, []);
  }
  for (const method of ["pact", "atwill", "innate"]) {
    const h = shieldCase(); h.item.system.method = method; h.item.system.prepared = 0;
    const adapter = new MidiReactionAdapter({}, { midiProvider: () => h.midi }); const ids = [h.activity.uuid];
    await adapter.filterReactions([h.activity], { workflow: h.workflow }, "reaction", ids);
    assert.deepEqual(ids, [h.activity.uuid]);
  }
});

test("Shield uses actual cover, descriptor AC, flanking and already evaluated bonuses without rerolling", async () => {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  const h = shieldCase({ total: 18, ac: 12 }); h.target.cover = 5;
  h.workflow.targetACModifiers.set(h.actor.uuid, 2);
  h.workflow.targetDescriptors = [{ uuid: h.actor.uuid, flankingBonus: 1 }];
  h.midi.configSettings = () => ({ optionalRules: { flankingBonus: "+1" } });
  h.workflow.actor.flags = { midi: { evaluated: { grants: { attack: { bonus: { all: { value: 2 } } } } } } };
  h.actor.flags["midi-qol"] = { grants: { attack: { bonus: { all: "1d4" } } } };
  const adapter = new MidiReactionAdapter({}, { midiProvider: () => h.midi });
  let context = await adapter.getShieldAttackContext(h.workflow, h.target);
  assert.equal(context.effectiveAC, 18); assert.equal(context.attackTotal, 20);
  h.workflow.actor.flags.midi.evaluated.ignoreCover = { value: true };
  context = await adapter.getShieldAttackContext(h.workflow, h.target);
  assert.equal(context.effectiveAC, 13);
  h.target.cover = Infinity;
  assert.equal(await adapter.getShieldAttackContext(h.workflow, h.target), null);
  h.target.cover = 0; h.actor.system.attributes.ac.cover = 2;
  context = await adapter.getShieldAttackContext(h.workflow, h.target);
  assert.equal(context.effectiveAC, 11); // native ignoreCover removes the status bonus already baked into value
});

test("exact target snapshot prevents linked-token cover substitution before entering the queue", async () => {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  const h = shieldCase({ total: 16 });
  const covered = { actor: h.actor, document: { uuid: "Scene.room.Token.covered" }, cover: 5 };
  h.workflow.targets.add(covered);
  let begins = 0;
  const adapter = new MidiReactionAdapter({ reactionQueueService: { resolveManagedReaction: () => { begins++; return { name: "queued" }; } } }, {
    midiProvider: () => h.midi,
    resolver: uuid => uuid === h.activity.uuid ? h.activity : uuid === covered.document.uuid ? covered : h.target
  });
  const options = { workflow: h.workflow }; const ids = [h.activity.uuid];
  await adapter.filterReactions([h.activity], options, "reaction", ids);
  const copied = JSON.parse(JSON.stringify({ ...options, workflow: undefined }));
  const data = { triggerType: "reaction", reactionActivityList: ids, options: copied };
  assert.deepEqual(await adapter.choose({ ...data, tokenUuid: h.target.document.uuid }), { name: "None" });
  assert.equal(begins, 0);
  assert.deepEqual(await adapter.choose({ ...data, tokenUuid: covered.document.uuid }), { name: "queued" });
  assert.equal(begins, 1);
  covered.actor.system.attributes.ac.value = 20;
  assert.deepEqual(await adapter.choose({ ...data, tokenUuid: covered.document.uuid }), { name: "None" });
  assert.equal(begins, 1);
});

test("Active Defence offers Shield using the exact evaluated defence result rather than attack d20 total", async () => {
  const { MidiReactionAdapter } = await import("../scripts/integrations/midi-reaction-adapter.js");
  for (const [attackTotal, defenceTotal, want] of [[14, 9, false], [20, 12, true], [14, 10, true], [20, 15, false]]) {
    const h = shieldCase({ total: attackTotal });
    h.workflow.activeDefenceDC = 15;
    h.workflow.rollResults = [{ total: defenceTotal, dice: [{ total: defenceTotal }] }];
    const adapter = new MidiReactionAdapter({}, { midiProvider: () => h.midi }); const ids = [h.activity.uuid];
    await adapter.filterReactions([h.activity], { workflow: h.workflow }, "reaction", ids);
    assert.deepEqual(ids, want ? [h.activity.uuid] : [], `${attackTotal}/${defenceTotal}`);
  }
});
