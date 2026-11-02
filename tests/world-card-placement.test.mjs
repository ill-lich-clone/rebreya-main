import assert from "node:assert/strict";
import test from "node:test";
import { Crosshairs } from "../scripts/integrations/world-card-automations/selected/lib/crosshairs.js";
import { DialogApp } from "../scripts/integrations/world-card-automations/selected/applications/dialog.js";
import { Teleport } from "../scripts/integrations/world-card-automations/selected/lib/teleport.js";
import { Summons } from "../scripts/integrations/world-card-automations/selected/lib/summons.js";

function scene(t, confirmed = true) {
  const source = { id: "caster", uuid: "Actor.caster", isOwner: true };
  const sceneDoc = {
    id: "scene",
    grid: { distance: 5 },
    tokens: new Map(),
    dimensions: { sceneRect: { contains: (x, y) => x >= 0 && y >= 0 && x < 600 && y < 600 } }
  };
  const sourceToken = {
    id: "caster",
    center: { x: 50, y: 50 },
    actor: source,
    document: {
      id: "caster",
      uuid: "Scene.scene.Token.caster",
      actor: source,
      parent: sceneDoc,
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      isOwner: true,
      texture: { src: "token.webp" }
    }
  };
  sceneDoc.tokens.set("caster", sourceToken.document);
  sourceToken.document.object = sourceToken;
  const canvasStub = {
    ready: true,
    scene: sceneDoc,
    grid: { distance: 5, size: 100, measurePath: ([a, b]) => ({ distance: Math.hypot(a.x - b.x, a.y - b.y) / 20 }) },
    tokens: {
      controlled: [sourceToken],
      placeTokens: async (_data, options) => {
        assert.equal(options.create, false);
        if (!confirmed) return [];
        const doc = { x: 200, y: 0, rotation: 0, getCenterPoint: () => ({ x: 250, y: 50 }) };
        options.onChange?.({ document: doc });
        if (options.preConfirm?.({ document: doc }) === false) return [];
        return [doc];
      }
    }
  };
  const old = { canvas: globalThis.canvas, game: globalThis.game };
  Object.assign(globalThis, {
    canvas: canvasStub,
    game: { user: { id: "gm", isGM: true, character: source }, actors: new Map([[source.id, source]]) }
  });
  t.after(() => Object.assign(globalThis, old));
  return { sourceToken, sceneDoc };
}

test("crosshair returns the selected center or cancellation without creating documents", async (t) => {
  scene(t);
  assert.deepEqual((({ x, y, cancelled }) => ({ x, y, cancelled }))(await Crosshairs.showCrosshairs({ size: 2.5 })), {
    x: 250,
    y: 50,
    cancelled: false
  });
  globalThis.canvas.tokens.placeTokens = async () => [];
  assert.equal((await Crosshairs.showCrosshairs({ size: 2.5 })).cancelled, true);
});

test("teleport validates range before moving owned token and cancellation never moves it", async (t) => {
  const { sourceToken } = scene(t);
  const moves = [];
  sourceToken.document.update = async (data) => moves.push(data);
  await Teleport.target([sourceToken], sourceToken, { range: 5 });
  assert.equal(moves.length, 0);
  await Teleport.target([sourceToken], sourceToken, { range: 30 });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].x, 200);
  globalThis.canvas.tokens.placeTokens = async () => [];
  await Teleport.target([sourceToken], sourceToken, { range: 30 });
  assert.equal(moves.length, 1);
});

test("dialog preserves typed choices, encodes labels, and dismisses normally", async (t) => {
  const previous = globalThis.foundry;
  t.after(() => {
    globalThis.foundry = previous;
  });
  const captured = [];
  globalThis.foundry = {
    applications: {
      api: {
        DialogV2: {
          wait: async (config) => {
            captured.push(config);
            return config.buttons[0].callback(null, {});
          }
        }
      }
    }
  };
  assert.deepEqual(await DialogApp.dialog("Test", "Pick <danger>", [["button", [{ label: "<choice>", name: 2 }]]]), {
    buttons: 2
  });
  assert.doesNotMatch(captured[0].content, /<danger>/);
  globalThis.foundry.applications.api.DialogV2.wait = async () => null;
  assert.equal(await DialogApp.dialog("Test", "", [], "yesNo"), false);
});

test("cancelled Find Steed placement creates neither token nor effect", async (t) => {
  const { sourceToken, sceneDoc } = scene(t, false);
  const sourceActor = {
    id: "horse",
    name: "Horse",
    prototypeToken: { width: 1, height: 1 },
    system: { abilities: { int: { value: 2 } } },
    folder: { name: "Steeds" }
  };
  sceneDoc.createEmbeddedDocuments = async () => assert.fail("cancelled summon wrote data");
  sourceToken.actor.createEmbeddedDocuments = async () => assert.fail("cancelled summon created effect");
  const spell = {
    uuid: "Actor.caster.Item.steed",
    name: "Find Steed",
    actor: sourceToken.actor,
    system: { identifier: "find-steed" }
  };
  await Summons.spawn(
    sourceActor,
    { actor: { system: { details: { type: { value: "fey" } }, traits: { languages: "common" } } } },
    spell,
    sourceToken,
    { range: 30 }
  );
});

test("Find Steed creates one unlinked token and reciprocal caster effect; expiry deletes only that steed", async (t) => {
  const { sourceToken, sceneDoc } = scene(t);
  const old = { foundry: globalThis.foundry, fromUuid: globalThis.fromUuid, Hooks: globalThis.Hooks };
  t.after(() => Object.assign(globalThis, old));
  sourceToken.actor.system = { traits: { languages: { value: new Set(["common"]) } } };
  sourceToken.actor.effects = [];
  sourceToken.actor.ownership = { caster: 3 };
  sceneDoc.uuid = "Scene.scene";
  sourceToken.document.disposition = 1;
  const template = {
    id: "horse",
    uuid: "Actor.horse",
    name: "Horse",
    prototypeToken: { width: 1, height: 1 },
    folder: { name: "Steeds" },
    system: { abilities: { int: { value: 2 } }, traits: { languages: { value: new Set(["elvish"]) } } },
    async getTokenDocument(data) {
      const record = { ...data, actorId: "horse" };
      return { updateSource: (next) => Object.assign(record, next), toObject: () => record };
    }
  };
  const batches = [];
  const ids = ["newEffect", "newToken"];
  game.release = { generation: 14 };
  game.users = { activeGM: game.user };
  game.rebreyaMain = { worldMutationCoordinator: { run: (_key, op) => op() } };
  globalThis.foundry = {
    utils: { randomID: () => ids.shift() },
    documents: {
      modifyBatch: async (ops) => {
        batches.push(ops);
      }
    }
  };
  const item = { name: "Find Steed", uuid: "Actor.caster.Item.item", actor: sourceToken.actor, img: "steed.webp" };
  await Summons.spawn(
    template,
    { actor: { system: { details: { type: { value: "fey" } }, traits: { languages: "common" } } } },
    item,
    sourceToken,
    { range: 30 }
  );
  assert.equal(batches.length, 1);
  const [[token], [effect]] = batches[0].map((op) => op.data);
  assert.equal(token.actorLink, false);
  assert.equal(token.actorId, "horse");
  assert.equal(token.delta.system.abilities.int.value, 6);
  assert.deepEqual(token.delta.system.traits.languages.value, ["elvish", "common"]);
  assert.equal(effect.origin, item.uuid);
  assert.deepEqual(effect.flags["chris-premades"].summons.ids[item.name], ["newToken"]);
  assert.equal(effect.flags["rebreya-main"].cardSteed, "Scene.scene.Token.newToken");
  const hooks = new Map();
  globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn) };
  const { registerSteedLifecycle } =
    await import("../scripts/integrations/world-card-automations/selected/lib/summons.js");
  registerSteedLifecycle();
  let deletes = 0;
  const effectUuid = "Actor.caster.ActiveEffect.newEffect";
  const spawned = {
    documentName: "Token",
    flags: { "rebreya-main": { cardSteed: effectUuid } },
    delete: async () => {
      deletes++;
    }
  };
  globalThis.fromUuid = async (uuid) => (uuid === "Scene.scene.Token.newToken" ? spawned : null);
  await hooks.get("deleteActiveEffect")({ ...effect, uuid: "Actor.other.ActiveEffect.newEffect" });
  assert.equal(deletes, 0);
  await hooks.get("deleteActiveEffect")({ ...effect, uuid: effectUuid });
  assert.equal(deletes, 1);
});

test("privileged card mutations reject other users' chat cards and foreign payload fields before confirmation or writes", async (t) => {
  const { sourceToken } = scene(t);
  const { moveCardToken } = await import("../scripts/integrations/world-card-automations/selected/lib/teleport.js");
  const { summonCardSteed } = await import("../scripts/integrations/world-card-automations/selected/lib/summons.js");
  const old = globalThis.fromUuid;
  t.after(() => {
    globalThis.fromUuid = old;
  });
  const data = {
    sourceTokenUuid: sourceToken.document.uuid,
    targetTokenUuid: sourceToken.document.uuid,
    itemCardUuid: "ChatMessage.card",
    x: 250,
    y: 50
  };
  const user = { active: true, id: "attacker" };
  game.users = { activeGM: game.user };
  globalThis.fromUuid = async (uuid) =>
    uuid === data.itemCardUuid ? { documentName: "ChatMessage", author: { id: "legitimate" } } : sourceToken.document;
  assert.equal(await moveCardToken(data, { sender: user }), false);
  globalThis.fromUuid = () => assert.fail("malformed payload was resolved");
  assert.equal(await moveCardToken({ ...data, arbitraryUpdates: {} }, { sender: user }), false);
  assert.equal(await summonCardSteed({ ...data, actorData: {} }, { sender: user }), false);
});

test("legacy and modern Magic Missile preserve cast allocation and offer a Shield reaction once per damaged target", async (t) => {
  const old = { CONFIG: globalThis.CONFIG, game: globalThis.game, MidiQOL: globalThis.MidiQOL };
  t.after(() => Object.assign(globalThis, old));
  let rolled = 0;
  globalThis.CONFIG = {
    Canvas: { darknessAnimations: {} },
    Dice: {
      DamageRoll: class {
        constructor(formula) {
          assert.equal(formula, "1d4+1");
        }
        async evaluate() {
          rolled++;
          return { total: 4 };
        }
      }
    }
  };
  globalThis.MidiQOL = { displayDSNForRoll: async () => {} };
  globalThis.game = { i18n: { format: (x) => x, localize: (x) => x } };
  const base = "../scripts/integrations/world-card-automations/selected/";
  const { definitions } = await import("../scripts/integrations/world-card-automations/registry.js");
  const { workflowUtils } = await import(base + "lib/utilities/workflowUtils.js");
  const { itemUtils } = await import(base + "lib/utilities/itemUtils.js");
  const { activityUtils } = await import(base + "lib/utilities/activityUtils.js");
  const { dialogUtils } = await import(base + "lib/utilities/dialogUtils.js");
  const a = { id: "a" },
    b = { id: "b" };
  let selection = [
    [
      { document: a, value: 2 },
      { document: b, value: 1 }
    ]
  ];
  let rollEach = false;
  const hits = [];
  t.mock.method(dialogUtils, "selectTargetDialog", async () => selection);
  t.mock.method(itemUtils, "getConfig", (_item, key) => (key === "rollEach" ? rollEach : false));
  const feature = { damage: { parts: [{ formula: "1d4+1", types: new Set(["force"]) }] } };
  t.mock.method(activityUtils, "getActivityByIdentifier", () => feature);
  t.mock.method(activityUtils, "withChangedDamage", (_feature, value) => ({ value }));
  t.mock.method(workflowUtils, "syntheticActivityDataRoll", async (data, _item, _actor, [target], { options }) =>
    hits.push([target.id, data.value, options.workflowOptions.rebreyaMissileShieldPrompt])
  );
  t.mock.method(workflowUtils, "syntheticActivityRoll", async (_activity, [target], { options }) =>
    hits.push([target.id, "roll", options.workflowOptions.rebreyaMissileShieldPrompt])
  );
  const workflow = {
    castData: { castLevel: 1, baseLevel: 1 },
    targets: new Set([a, b]),
    activity: { getRollData: () => ({}) },
    item: {},
    actor: {}
  };
  for (const spell of [definitions.legacy.magicMissile, definitions.modern.magicMissile]) {
    rollEach = spell.config.find((entry) => entry.value === "rollEach").default;
    const use = spell.midi.item[0].macro;
    hits.length = 0;
    await use({ workflow });
    const value = rollEach ? "roll" : "4";
    assert.deepEqual(hits, [
      ["a", value, true],
      ["a", value, false],
      ["b", value, true]
    ]);
  }
  assert.equal(rolled, 1);
  selection = [[{ document: a, value: 4 }]];
  hits.length = 0;
  await definitions.modern.magicMissile.midi.item[0].macro({ workflow });
  assert.deepEqual(hits, []);
});

test("v13 placement keeps the tracking callback alive until confirmation and removes its native pointer listener", async (t) => {
  scene(t);
  delete canvas.tokens.placeTokens;
  let listen;
  let off = 0;
  canvas.stage = {
    on: (_event, fn) => {
      listen = fn;
    },
    off: (_event, fn) => {
      assert.equal(fn, listen);
      off++;
    }
  };
  game.dnd5e = {
    canvas: {
      TokenPlacement: {
        place: async ({ tokens }) => {
          assert.equal(tokens[0].toObject().sight.enabled, false);
          listen({ getLocalPosition: () => ({ x: 120, y: 55 }) });
          return [{ x: 100, y: 0, rotation: 25 }];
        }
      }
    }
  };
  let cursor;
  const result = await Crosshairs.showCrosshairs(
    { size: 2.5 },
    {
      show: (c) => {
        cursor = c;
        assert.equal(c.inFlight, true);
      }
    }
  );
  assert.deepEqual(result, { x: 150, y: 50, direction: 25, cancelled: false });
  assert.equal(cursor.inFlight, false);
  assert.equal(cursor.x, 120);
  assert.equal(off, 1);
});

test("cancelled Dash and Disengage previews never animate an unconfirmed movement", async (t) => {
  const old = {
    CONFIG: globalThis.CONFIG,
    game: globalThis.game,
    canvas: globalThis.canvas,
    Sequencer: globalThis.Sequencer
  };
  t.after(() => Object.assign(globalThis, old));
  globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
  globalThis.Sequencer = { EffectManager: { endEffects: () => {} } };
  globalThis.canvas = { dimensions: { distance: 5 } };
  const base = "../scripts/integrations/world-card-automations/selected/";
  const { dash } = await import(base + "macros/2024/actions/dash.js");
  const { disengage } = await import(base + "macros/2024/actions/disengage.js");
  const { itemUtils } = await import(base + "lib/utilities/itemUtils.js");
  const { animationUtils } = await import(base + "lib/utilities/animationUtils.js");
  const { crosshairUtils } = await import(base + "lib/utilities/crosshairUtils.js");
  t.mock.method(itemUtils, "getConfig", (_item, key) => key === "playAnimation");
  t.mock.method(animationUtils, "jb2aCheck", () => "patreon");
  t.mock.method(animationUtils, "aseCheck", () => true);
  t.mock.method(crosshairUtils, "aimCrosshair", async () => ({ cancelled: true }));
  let restores = 0;
  const workflow = {
    actor: {
      sheet: {
        minimize: async () => {},
        maximize: async () => {
          restores++;
        }
      },
      system: { attributes: { movement: { walk: 30 } } }
    },
    item: {},
    token: {
      center: { x: 0, y: 0 },
      document: { width: 1, parent: { grid: { distance: 5 } }, texture: { src: "token" } }
    }
  };
  for (const action of [dash, disengage]) await action.midi.item[0].macro({ workflow });
  assert.equal(restores, 2);
});

test("active GM moves only the Vortex Warp card's valid target after confirmation", async (t) => {
  const { sourceToken, sceneDoc } = scene(t);
  const { moveCardToken } = await import("../scripts/integrations/world-card-automations/selected/lib/teleport.js");
  const old = { fromUuid: globalThis.fromUuid, foundry: globalThis.foundry };
  t.after(() => Object.assign(globalThis, old));
  const sender = { id: "caster", name: "caster", active: true };
  game.users = { activeGM: game.user };
  sourceToken.document.documentName = "Token";
  sourceToken.actor.testUserPermission = (user) => user === sender;
  const target = {
    ...sourceToken.document,
    id: "enemy",
    uuid: "Scene.scene.Token.enemy",
    x: 300,
    flags: {},
    name: "Enemy"
  };
  const targetObject = { document: target, actor: { effects: [] } };
  target.object = targetObject;
  let moves = 0;
  let confirmations = 0;
  target.update = async (data) => {
    moves++;
    const flags=target.flags["rebreya-main"]??={cardMovementReceipts:{}};
    for(const [path,expires] of Object.entries(data)) if(path.startsWith("flags.rebreya-main.cardMovementReceipts.")){
      flags.cardMovementReceipts[path.split(".").at(-1)]=expires;
    }
  };
  sceneDoc.tokens.set(target.id, target);
  const item = {
    type: "spell",
    name: "Vortex Warp",
    system: { identifier: "vortex-warp", level: 2 },
    actor: sourceToken.actor
  };
  const message = {
    uuid: "ChatMessage.fresh",
    documentName: "ChatMessage",
    timestamp: Date.now(),
    author: sender,
    system: { targets: [{ token: target.uuid, saved: false }] },
    getAssociatedItem: () => item,
    getAssociatedToken: () => sourceToken.document
  };
  globalThis.fromUuid = async (uuid) =>
    new Map([
      [message.uuid, message],
      [sourceToken.document.uuid, sourceToken.document],
      [target.uuid, target]
    ]).get(uuid);
  let answer = false;
  globalThis.foundry = {
    applications: {
      api: {
        DialogV2: {
          confirm: async () => {
            confirmations++;
            return answer;
          }
        }
      }
    }
  };
  const data = {
    sourceTokenUuid: sourceToken.document.uuid,
    targetTokenUuid: target.uuid,
    itemCardUuid: message.uuid,
    x: 250,
    y: 50
  };
  assert.equal(await moveCardToken(data, { sender }), false);
  assert.equal(moves, 0);
  answer = true;
  message.system.targets[0].saved = true;
  assert.equal(await moveCardToken(data, { sender }), false);
  assert.equal(confirmations, 1);
  message.system.targets[0].saved = false;
  assert.equal(await moveCardToken(data, { sender }), true);
  assert.equal(moves, 1);
  assert.equal(await moveCardToken(data, { sender }), true);
  assert.equal(moves, 1);
  const second = {...message,uuid:"ChatMessage.next"};
  const docs=new Map([[message.uuid,message],[second.uuid,second],[sourceToken.document.uuid,sourceToken.document],[target.uuid,target]]);
  globalThis.fromUuid=async uuid=>docs.get(uuid);
  const later={...data,itemCardUuid:second.uuid};
  await Promise.all([moveCardToken(later,{sender}),moveCardToken(later,{sender})]);
  assert.equal(moves,2);
  assert.equal(await moveCardToken(data,{sender}),true);
  assert.equal(moves,2);
});

test("teleport preserves handwritten grapple effects and releases only a matching pair on these tokens",async t=>{
  const {sourceToken}=scene(t), actor=sourceToken.actor, sceneDoc=sourceToken.document.parent;
  sourceToken.document.update=async()=>{};
  const grappler={id:"enemy",uuid:"Actor.enemy",effects:[]}, deleted=[];
  const holding={uuid:"Actor.enemy.ActiveEffect.hold",origin:grappler.uuid,parent:grappler,
    flags:{"chris-premades":{info:{identifier:"grappling"},grapple:{tokenId:sourceToken.id}},dnd5e:{dependentOn:"Actor.caster.ActiveEffect.held"}}};
  const held={uuid:"Actor.caster.ActiveEffect.held",origin:grappler.uuid,parent:actor,statuses:new Set(["grappled"]),
    flags:{"chris-premades":{info:{identifier:"grappled"},grapple:{tokenId:"enemyToken"}},dnd5e:{dependentOn:holding.uuid}},
    async delete(){deleted.push("held");}};
  const manual={uuid:"Actor.caster.ActiveEffect.manual",parent:actor,statuses:new Set(["grappled","restrained"]),
    async delete(){deleted.push("manual");}};
  const unrelated={...held,uuid:"Actor.caster.ActiveEffect.unrelated",async delete(){deleted.push("unrelated");}};
  actor.effects=[manual,unrelated,held];grappler.effects=[holding];
  sceneDoc.tokens.set("enemyToken",{id:"enemyToken",actor:grappler});
  await Teleport.target([sourceToken],sourceToken,{range:30});
  assert.deepEqual(deleted,["held"]);
});

test("movement receipts expire after the validity window and retain unrelated live cards", async () => {
  const {movementReceiptPatch,withMovementReceipt}=await import("../scripts/integrations/world-card-automations/movement-receipts.js");
  const flags={cardMovementReceipts:{mold:10,mlive:1000},cardTeleport:"ChatMessage.legacy"};
  const token={uuid:"Scene.scene.Token.token",flags:{"rebreya-main":flags}};
  assert.deepEqual(movementReceiptPatch(token,"ChatMessage.new",500),{
    "flags.rebreya-main.cardMovementReceipts.mnew":630500,
    ["flags.rebreya-main.cardMovementReceipts."+(globalThis._del?"mold":"-=mold")]: globalThis._del??null
  });
  let attempts=0;
  assert.equal(await withMovementReceipt(token,"ChatMessage.legacy",true,async()=>{attempts++;return false;}),true);
  assert.equal(attempts,0);
});
