import test from "node:test";
import assert from "node:assert/strict";
import { registerCprCardHandlers } from "../scripts/integrations/world-card-automations/hooks.js";
import { loadInstalledFunction } from "./helpers/installed-combat-providers.mjs";

function fixture(definitions, modern = {}) {
  const events = {},
    Hooks = {
      events,
      on(name, fn) {
        (events[name] ??= []).push({ fn });
      }
    };
  const game = {
    modules: new Map([["midi-qol", { active: true }]]),
    user: { id: "player" },
    users: { activeGM: { id: "gm" } }
  };
  const install = () => registerCprCardHandlers({ Hooks, game, definitions: { legacy: definitions, modern } });
  install();
  install();
  return { game, Hooks, fire: (name, ...args) => events[name][0].fn(...args) };
}
const card = (id, scope, extra = {}) => ({
  name: id,
  flags: { "chris-premades": { macros: { midi: { [scope]: [id] } } } },
  ...extra
});
const row = (pass, macro, priority = 50) => ({ pass, macro, priority });

test("installed MIDI state hook awaits only selected card and actor handlers in priority order", async () => {
  const calls = [];
  const item = card("selected", "item"),
    passive = card("passive", "actor");
  item.flags["chris-premades"].activityIdentifiers = { main: "aa" };
  item.flags["chris-premades"].macros.midi.item.push("toString", "evilScript", "selected");
  const workflow = { actor: { items: [passive] }, token: {}, item, activity: { id: "aa", item } };
  const { Hooks, game } = fixture({
    selected: {
      midi: {
        item: [
          {
            ...row("rollFinished", async ({ trigger, workflow: w }) => {
              await Promise.resolve();
              assert.equal(w, workflow);
              calls.push(trigger.entity);
            }),
            activities: ["main"]
          },
          { ...row("rollFinished", () => assert.fail()), activities: ["other"] }
        ]
      }
    },
    passive: {
      midi: {
        actor: [
          row(
            "rollFinished",
            ({ trigger }) => {
              calls.push(trigger.entity);
            },
            10
          )
        ]
      }
    }
  });
  const hook = "midi-qol.postRollFinished";
  assert.equal(Hooks.events[hook].length, 1);
  const globals = { Hooks, CONFIG: { debug: { hooks: false } }, debugEnabled: 0 };
  globals.hookCall = await loadInstalledFunction("midi-qol/midi-qol.js", "hookCall", globals);
  const call = await loadInstalledFunction("midi-qol/midi-qol.js", "asyncHooksCall", globals);
  await call(hook, workflow);
  assert.deepEqual(calls, [passive, item]);
  game.modules.set("chris-premades", { active: true });
  await call(hook, workflow);
  assert.deepEqual(calls, [passive, item]);
});

test("preTargeting cancellation uses the actual activity identifier and returns false to MIDI", async () => {
  const item = card("main", "item"),
    actor = { items: [item] },
    activity = { item, actor, id: "aa" };
  item.flags["chris-premades"].activityIdentifiers = { main: "aa" };
  const { fire } = fixture({
    main: {
      midi: {
        item: [
          {
            ...row("preTargeting", ({ activity: a, config }) => {
              assert.equal(a, activity);
              assert.equal(config.test, true);
              return true;
            }),
            activities: ["main"]
          }
        ]
      }
    }
  });
  assert.equal(await fire("midi-qol.preTargeting", { activity, config: { test: true } }), false);
  assert.notEqual(await fire("midi-qol.preTargeting", { activity: { ...activity, id: "other" } }), false);
});

test("damage receiver gets its own applied effect and per-target damage entry exactly once", async () => {
  const seen = [],
    e = card("debuff", "actor", { type: "base" }),
    token = { actor: { items: [], appliedEffects: [e] } };
  const { fire } = fixture({
    debuff: {
      midi: {
        actor: [
          row("targetApplyDamage", ({ trigger, ditem }) => {
            seen.push([trigger.entity, trigger.token, ditem]);
          })
        ]
      }
    }
  });
  const dmg = { hpDamage: 4 };
  await fire("midi-qol.preTargetDamageApplication", token, { workflow: {}, ditem: dmg });
  assert.deepEqual(seen, [[e, token, dmg]]);
});

test("a 2024 card and its modern child effect select only their matching book", async () => {
  const calls = [],
    make = (tag) => ({
      midi: {
        item: [
          row("rollFinished", () => {
            calls.push(tag);
          })
        ]
      },
      effect: [
        row("deleted", ({ trigger }) => {
          calls.push([tag, trigger.target]);
        })
      ]
    });
  const { fire, game } = fixture({ same: make("legacy") }, { same: make("modern") });
  const item = card("same", "item", { documentName: "Item", system: { source: { rules: "2024" } } });
  await fire("midi-qol.postRollFinished", { item });
  const child = {
    name: "Child",
    parent: { documentName: "Actor" },
    flags: { "chris-premades": { rules: "modern", macros: { effect: ["same"] } } }
  };
  await fire("deleteActiveEffect", child, {});
  game.user = { id: "gm", isGM: true };
  await fire("deleteActiveEffect", child, {});
  assert.deepEqual(calls, ["modern", ["modern", child]]);
});

test("only the active GM runs final movement and passes native teleport information to the effect", async (t) => {
  const calls = [],
    fx = { name: "Booming Blade", flags: { "chris-premades": { macros: { movement: ["boomingBladeMoved"] } } } };
  const { fire, game } = fixture({
    boomingBladeMoved: {
      movement: [
        row("moved", ({ trigger, options }) => {
          calls.push([trigger.entity, options["chris-premades"].movement.teleport]);
        })
      ]
    }
  });
  const oldCanvas = globalThis.canvas,
    oldConfig = globalThis.CONFIG;
  globalThis.canvas = { scene: { id: "s" } };
  globalThis.CONFIG = { Token: { movement: { actions: { teleport: { teleport: true } } } } };
  t.after(() => {
    globalThis.canvas = oldCanvas;
    globalThis.CONFIG = oldConfig;
  });
  const token = { parent: { id: "s" }, actor: { appliedEffects: [fx] }, object: {} },
    movement = { passed: { waypoints: [{ action: "teleport" }] }, pending: { waypoints: [] } };
  await fire("moveToken", token, movement, {});
  game.user = { id: "otherGM", isGM: true };
  await fire("moveToken", token, movement, {});
  game.user = { id: "gm", isGM: true };
  await fire("moveToken", token, { ...movement, pending: { waypoints: [{}] } }, {});
  await fire("moveToken", token, movement, {});
  assert.deepEqual(calls, [[fx, true]]);
});

test("turn boundary checks enemy disposition and native distance before running a nearby effect", async (t) => {
  const hits = [],
    fx = { name: "shroud", flags: { "chris-premades": { macros: { combat: ["spiritShroud"] } } } };
  const { fire, game } = fixture({
    spiritShroud: {
      combat: [
        {
          ...row("turnStartNear", ({ trigger }) => {
            hits.push(trigger);
          }),
          distance: 10,
          disposition: "enemy"
        }
      ]
    }
  });
  const previous = globalThis.MidiQOL;
  globalThis.MidiQOL = {
    computeDistance: (_from, to, options) => {
      assert.equal(options.wallsBlock, true);
      return to.distance;
    }
  };
  t.after(() => {
    globalThis.MidiQOL = previous;
  });
  game.user = { id: "gm", isGM: true };
  const scene = { tokens: [] };
  const place = (disposition, distance) => {
    const doc = { disposition, parent: scene, actor: { appliedEffects: [fx] } };
    doc.object = { document: doc, distance };
    scene.tokens.push(doc);
    return doc;
  };
  const active = place(1, 0),
    near = place(-1, 10);
  place(-1, 15);
  place(1, 5);
  const combat = {
    started: true,
    isActive: true,
    combatants: new Map([["a", { token: active }]]),
    current: { round: 2, turn: 0, combatantId: "a" },
    previous: { round: 1, turn: 2 }
  };
  await fire("updateCombat", combat, { round: 2, turn: 0 });
  assert.deepEqual(
    hits.map((c) => [c.token, c.target, c.currentTurn]),
    [[near.object, active.object, 0]]
  );
});

test("an editable player effect cannot execute a selected document callback as GM", async () => {
  let count = 0;
  const { game, fire } = fixture({
    child: {
      effect: [
        row("deleted", () => {
          count++;
        })
      ]
    }
  });
  const player = game.user,
    gm = { id: "gm", isGM: true, active: true };
  player.active = true;
  game.users = new Map([
    [gm.id, gm],
    [player.id, player]
  ]);
  game.users.contents = [gm, player];
  game.users.activeGM = gm;
  const actor = { documentName: "Actor", hasPlayerOwner: true, testUserPermission: (u) => u === player };
  const child = { name: "effect", parent: actor, flags: { "chris-premades": { macros: { effect: ["child"] } } } };
  game.user = gm;
  await fire("deleteActiveEffect", child, {});
  assert.equal(count, 0);
  game.user = player;
  await fire("deleteActiveEffect", child, {});
  assert.equal(count, 1);
  player.active = false;
  game.user = gm;
  await fire("deleteActiveEffect", child, {});
  assert.equal(count, 1);
});

test("grouped turn-end delegates the non-representative's card only to its confirmed owner and deduplicates socket retries", async t => {
  const {buildPhaseStepKey} = await import("../scripts/combat/turn-group-rules.js");
  const gm = { id: "gm", isGM: true, active: true }, player = { id: "player", isGM: false, active: true };
  const users = new Map([[gm.id, gm], [player.id, player]]);
  users.contents = [gm, player]; users.activeGM = gm;
  const actor = { uuid: "Actor.hero", hasPlayerOwner: true, testUserPermission: u => u === player };
  player.character = actor;
  const item = { documentName: "Item", name: "selected", actor, system: {}, flags: { "chris-premades": { macros: {combat:["selected"]} } } };
  actor.items = [item];
  const member = { id:"b", token: { id:"token-b", actor, object: {} } };
  const phase = { kind: "turn-end", groupId: "first", round: 1, memberIds:["a", "b"] };
  const state = { mode: "active", pendingTransition: { phases:[phase] }, receipts: {} };
  const combat = { id: "fight", combatants:new Map([["b",member]]), turns:[{},member], started:true, isActive:true,
    flags:{"rebreya-main":{groupedCombat:state}} };
  const game = { version:"14.369", user:gm, users, combats:new Map([[combat.id,combat]]),
    modules:new Map([["midi-qol",{active:true}]]) };
  const hooks = new Map(); let planner, handler, payload; const calls = [];
  const transport = { register(name, callback) {assert.equal(name,"groupedWorldCard");handler=callback;},
    async executeAsUser(name,user,request) { assert.equal(name,"groupedWorldCard");assert.equal(user,"player");
      payload=request; game.user=player;return handler.call({socketdata:{userId:"gm"}},request); }};
  const oldSocket = globalThis.socketlib; globalThis.socketlib={registerModule:()=>transport};
  t.after(()=>{if(oldSocket === undefined) delete globalThis.socketlib;else globalThis.socketlib=oldSocket;});
  game.rebreyaMain={groupedCombatService:{effects:{setWorldCardPhase:fn=>planner=fn}}};
  registerCprCardHandlers({Hooks:{on:(name,callback)=>hooks.set(name,callback)},game,
    definitions:{legacy:{selected:{combat:[{pass:"turnEnd",macro:({trigger})=>{calls.push([game.user.id,trigger.entity]);}}]}}}});
  const steps=[]; planner(combat,phase,member,(provider,c,id,run)=>steps.push({provider,c,id,run}));
  assert.equal(steps.length,1);
  const [step]=steps;
  const key=buildPhaseStepKey(combat.id,phase,member.id,step.provider,step.id);
  state.receipts[key]={status:"running",provider:step.provider,phase:phase.kind,combatantId:member.id,operationId:"advance"};
  await hooks.get("updateCombat")(combat,{turn:1});
  assert.deepEqual(calls,[]);
  assert.equal(await step.run(),true);
  assert.equal(await handler.call({socketdata:{userId:"other"}},payload),false);
  assert.equal(await handler.call({socketdata:{userId:"gm"}},payload),true);
  assert.deepEqual(calls,[[player.id,item]]);
  state.receipts[key].status="done";
  assert.equal(await handler.call({socketdata:{userId:"gm"}},payload),false);
});
