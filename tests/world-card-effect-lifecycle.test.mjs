import assert from "node:assert/strict";
import test from "node:test";
import { registerWorldCardEffectLifecycle } from "../scripts/integrations/world-card-automations/effect-lifecycle.js";

function setup() {
  const hooks = new Map(),
    gm = { id: "gm", isGM: true },
    player = { id: "p" },
    foreign = { id: "x" };
  const game = {
    user: gm,
    users: new Map([
      ["gm", gm],
      ["p", player],
      ["x", foreign]
    ]),
    actors: [],
    modules: new Map()
  };
  game.users.activeGM = gm;
  const actor = {
    documentName: "Actor",
    uuid: "Actor.a",
    items: new Map(),
    effects: new Map(),
    testUserPermission: (u) => u === player || u === gm
  };
  const favorites = new Set();
  actor.system = {
    hasFavorite: (k) => favorites.has(k),
    addFavorite: ({ id }) => favorites.add(id),
    removeFavorite: (k) => favorites.delete(k)
  };
  const item = {
    id: "i",
    uuid: "Actor.a.Item.i",
    documentName: "Item",
    actor,
    system: { activities: new Map([["act", { id: "act", relativeUUID: ".Item.i.Activity.act" }]]) },
    effects: [],
    flags: {
      "chris-premades": {
        info: { identifier: "wardingBond" },
        activityIdentifiers: { wardingBondDismiss: "act" },
        hiddenActivities: ["manual", "wardingBondDismiss"]
      },
      dnd5e: { riders: { activity: ["manual", "act"] } }
    },
    async update(delta) {
      for (const [path, v] of Object.entries(delta)) {
        const parts = path.split("."),
          k = parts.pop();
        let obj = this;
        for (const p of parts) obj = obj[p] ??= {};
        if (k.startsWith("-=")) delete obj[k.slice(2)];
        else obj[k] = v;
      }
    }
  };
  actor.items.set(item.id, item);
  let deleted = 0;
  const source = {
    id: "ef",
    uuid: "Actor.a.ActiveEffect.ef",
    documentName: "ActiveEffect",
    parent: actor,
    origin: item.uuid,
    active: true,
    flags: {
      "chris-premades": {
        info: { identifier: "wardingBondSource" },
        unhideActivities: { itemUuid: item.uuid, activityIdentifiers: ["wardingBondDismiss"], favorite: true }
      }
    },
    getDependents: () => [],
    async delete() {
      deleted++;
    }
  };
  source.setFlag = async (scope, key, value) => {
    (source.flags[scope] ??= {})[key] = value;
  };
  source.getFlag = (scope, key) => source.flags[scope]?.[key];
  source.unsetFlag = async (scope, key) => delete source.flags[scope]?.[key];
  actor.effects.set(source.id, source);
  const childActor = { ...actor, uuid: "Actor.b", testUserPermission: (u) => u === foreign || u === gm };
  const child = {
    id: "child",
    uuid: "Actor.b.ActiveEffect.child",
    parent: childActor,
    documentName: "ActiveEffect",
    origin: item.uuid,
    flags: {
      dnd5e: { dependentOn: source.uuid },
      "chris-premades": {
        info: { identifier: "wardingBondTarget" },
        interdependent: true,
        parentEntityUuid: source.uuid
      }
    }
  };
  const deps = new Map([
      [source.uuid, source],
      [item.uuid, item]
    ]),
    Hooks = { on: (k, cb) => hooks.set(k, cb), off: (k) => hooks.delete(k) };
  registerWorldCardEffectLifecycle({ Hooks, game, resolve: async (key) => deps.get(key) });
  return { hooks, game, actor, item, source, child, favorites, deleted: () => deleted };
}
test("warding bond reveals only its own dismiss, preserves existing favorites, and hides only when the last effect ends", async () => {
  const e = setup(),
    other = { ...e.source, id: "ef2" };
  e.favorites.add(".Item.i.Activity.act");
  const emit = (key, ef) => e.hooks.get(key)(ef, {}, "p");
  await emit("createActiveEffect", e.source);
  await emit("createActiveEffect", e.source);
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual"]);
  assert.deepEqual(e.item.flags["chris-premades"].hiddenActivities, ["manual"]);
  e.actor.effects.set(other.id, other);
  e.actor.effects.delete(e.source.id);
  await emit("deleteActiveEffect", e.source);
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual"]);
  e.actor.effects.delete(other.id);
  await emit("deleteActiveEffect", other);
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual", "act"]);
  assert.ok(e.favorites.has(".Item.i.Activity.act"));
});
test("foreign deletion cannot remove another actor's source; active GM cleanup requires the matching link and no other dependents", async () => {
  const e = setup(),
    emit = (effect, sender) => e.hooks.get("deleteActiveEffect")(effect, {}, sender);
  await emit(e.child, "x");
  assert.equal(e.deleted(), 0);
  await emit({ ...e.child, origin: "Actor.b.Item.unrelated" }, "gm");
  assert.equal(e.deleted(), 0);
  await emit(e.child, "gm");
  assert.equal(e.deleted(), 0, "a child flag alone never certifies a foreign link");
  await e.hooks.get("createActiveEffect")(e.child, {}, "gm");
  e.source.getDependents = () => [{ uuid: "other" }];
  await emit(e.child, "gm");
  assert.equal(e.deleted(), 0);
  await e.hooks.get("createActiveEffect")(e.child, {}, "gm");
  e.source.getDependents = () => [];
  await emit(e.child, "x");
  assert.equal(e.deleted(), 1);
});
test("an untrusted effect cannot expose another actor's item or change a manual activity", async () => {
  const e = setup();
  await e.hooks.get("createActiveEffect")(e.source, {}, "x");
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual", "act"]);
  e.source.flags["chris-premades"].unhideActivities.activityIdentifiers = ["manual"];
  await e.hooks.get("createActiveEffect")(e.source, {}, "p");
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual", "act"]);
});

test("v14 effect data inherits the real edition and cast, preserves authorship, and rejects executable effect changes", async () => {
  const { prepareCardEffect, sourceItemOf } =
    await import("../scripts/integrations/world-card-automations/effect-data.js");
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  const spell = { id: "spell", documentName: "Item", system: { source: { rules: "2024" } } };
  const parent = {
    documentName: "ActiveEffect",
    statuses: new Set(["concentrating"]),
    parent: { items: new Map([["spell", spell]]) },
    flags: { dnd5e: { item: { id: "spell" } }, "midi-qol": { castData: { baseLevel: 2, castLevel: 5, saveDC: 16 } } }
  };
  assert.equal(await sourceItemOf(parent), spell);
  const data = {
    changes: [{ key: "flags.midi-qol.disadvantage.attack.all", mode: 0, value: "1", priority: 25 }],
    duration: { seconds: 65 }
  };
  prepareCardEffect(data, { item: spell, concentration: parent, generation: 14 });
  assert.equal(data.changes, undefined);
  assert.deepEqual(data.system.changes, [
    { key: "flags.midi-qol.disadvantage.attack.all", type: "custom", value: 1, priority: 25 }
  ]);
  assert.deepEqual(data.duration, { value: 65, units: "seconds" });
  assert.deepEqual(data.flags["chris-premades"], {
    rules: "modern",
    castData: { baseLevel: 2, castLevel: 5, saveDC: 16 }
  });
  const old = { flags: { "chris-premades": { rules: "legacy", castData: { castLevel: 8 } } } };
  prepareCardEffect(old, { item: spell, concentration: parent, generation: 14 });
  assert.deepEqual(old.flags["chris-premades"], { rules: "legacy", castData: { castLevel: 8 } });
  const unknown = {};
  prepareCardEffect(unknown, { generation: 14 });
  assert.equal(unknown.flags["chris-premades"].rules, undefined);
  assert.throws(
    () => prepareCardEffect({ changes: [{ key: "macro.execute", value: "arbitrary" }] }, { generation: 14 }),
    /executable/u
  );
});

test("owner-proven child link on the source permits normal cleanup after an owner-side confirmed cast", async () => {
  const { rememberCardDependent } = await import("../scripts/integrations/world-card-automations/effect-lifecycle.js");
  const e = setup();
  await rememberCardDependent(e.source, e.child, { id: "x" });
  assert.equal(e.source.getFlag("rebreya-main", "worldCardChildren.Actor_b_ActiveEffect_child"), undefined);
  await rememberCardDependent(e.source, e.child, e.game.users.get("p"));
  await e.hooks.get("deleteActiveEffect")(e.child, {}, "x");
  assert.equal(e.deleted(), 1);
});

test("installed DAE duration and the native dnd5e rider getter keep the synthetic roll separate from the sheet", async () => {
  const { readFile } = await import("node:fs/promises"),
    vm = await import("node:vm"),
    { join } = await import("node:path");
  const { syntheticCardActivity, prepareCardEffect } =
    await import("../scripts/integrations/world-card-automations/effect-data.js");
  const root = process.env.REBREYA_FOUNDRY_DATA_ROOT ?? "D:/FoundryVTT/Data";
  const dae = await readFile(join(root, "modules/dae/module/GMAction.js"), "utf8");
  const start = dae.indexOf("const dnd5eToFoundryUnits ="),
    from = dae.indexOf("export function convertDuration(");
  assert.ok(from >= 0, "installed DAE time unit converter");
  const end = dae.indexOf("\n}", from);
  const scope = {
    simpleCalendarInstalled: false,
    CONFIG: { time: { roundTime: 6 } },
    game: { time: { calendar: { days: { secondsPerMinute: 60, minutesPerHour: 60, hoursPerDay: 24 } } } }
  };
  const convert = vm.runInNewContext(
    dae
      .slice(start >= 0 ? start : from, end + 2)
      .replace("export function convertDuration", "function convertDuration") + "\nconvertDuration",
    scope
  );
  const duration = convert({ value: 1, units: "minute" }, false);
  if (start >= 0) {
    assert.equal(duration.units, "minutes");
    assert.equal(duration.value, 1);
  } else assert.equal(duration.seconds, 60);
  const data = { duration };
  prepareCardEffect(data, { generation: 14 });
  assert.equal(data.duration.value * (data.duration.units === "minutes" ? 60 : 1), 60);
  const dnd = await readFile(join(root, "systems/dnd5e/dnd5e.mjs"), "utf8");
  const signature = "  get isRider() {",
    offset = dnd.indexOf(signature);
  assert.ok(offset >= 0);
  const Cls = vm.runInNewContext("(class Activity {" + dnd.slice(offset, dnd.indexOf("\n  }", offset) + 4) + "})");
  const activity = new Cls();
  activity.id = "a";
  const item = {
    flags: {
      "chris-premades": { hiddenActivities: ["heatMetalDamage"], activityIdentifiers: { heatMetalDamage: "a" } },
      dnd5e: { riders: { activity: ["a", "other"] } }
    },
    effects: [],
    getFlag() {
      return this.flags.dnd5e.riders.activity;
    },
    clone(changes, options) {
      assert.equal(options.keepId, true);
      const clone = new Cls();
      clone.id = "a";
      clone.item = { getFlag: () => changes["flags.dnd5e.riders.activity"] };
      return { system: { activities: new Map([["a", clone]]) } };
    }
  };
  activity.item = item;
  assert.equal(activity.isRider, true);
  assert.equal(syntheticCardActivity(activity).isRider, false);
  assert.equal(activity.isRider, true);
  assert.deepEqual(item.getFlag(), ["a", "other"]);
  item.effects = [{ riders: { activity: new Set(["a"]) } }];
  assert.equal(syntheticCardActivity(activity), activity);
});

test("grapple supplies only its own statuses, respects immunity, and never removes the manual condition", async () => {
  const { attachGrappleStatuses } = await import("../scripts/integrations/world-card-automations/effect-data.js");
  const manual = { statuses: ["grappled"] };
  const grapple = {
    flags: { "chris-premades": { info: { identifier: "grappled" }, conditions: ["grappled", "restrained", "dead"] } }
  };
  attachGrappleStatuses(grapple, new Set(["restrained"]));
  assert.deepEqual(grapple.statuses, ["grappled"]);
  const effects = [manual, grapple];
  effects.splice(effects.indexOf(grapple), 1);
  assert.deepEqual(
    effects.flatMap((effect) => effect.statuses),
    ["grappled"]
  );
  const foreign = { flags: { "chris-premades": { conditions: ["grappled"] } } };
  attachGrappleStatuses(foreign, new Set());
  assert.equal(foreign.statuses, undefined);
});

test("a deliberately visible manual control and a native enchantment rider survive a complete cycle", async () => {
  const e = setup();
  e.item.flags["chris-premades"].hiddenActivities = ["manual"];
  e.item.effects = [{ riders: { activity: new Set(["act"]) } }];
  await e.hooks.get("createActiveEffect")(e.source, {}, "gm");
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual", "act"]);
  e.actor.effects.delete(e.source.id);
  await e.hooks.get("deleteActiveEffect")(e.source, {}, "gm");
  assert.deepEqual(e.item.flags["chris-premades"].hiddenActivities, ["manual"]);
  assert.deepEqual(e.item.flags.dnd5e.riders.activity, ["manual", "act"]);
  assert.deepEqual([...e.favorites], []);
});
