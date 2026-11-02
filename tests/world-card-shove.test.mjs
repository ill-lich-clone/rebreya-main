import test from "node:test";
import assert from "node:assert/strict";
import { pushCardToken } from "../scripts/integrations/world-card-automations/shove-authority.js";
import { tokenUtils } from "../scripts/integrations/world-card-automations/selected/lib/utilities/tokenUtils.js";

test("a remote shove is confirmed against the message and the live target, then cannot replay", async (t) => {
  const gm = { id: "gm", isGM: true },
    player = { id: "p", active: true };
  const scene = {},
    size = { traits: { size: "med" } };
  const source = {
    object: {},
    parent: scene,
    name: "caster",
    uuid: "Scene.s.Token.a",
    actor: { uuid: "Actor.a", items: [], system: size, testUserPermission: (u) => u === player }
  };
  let applications = 0;
  const target = {
    object: {},
    parent: scene,
    name: "target",
    uuid: "Scene.s.Token.b",
    flags:{"rebreya-main":{cardMovementReceipts:{}}},
    async update(patch) {
      for(const [path,expires] of Object.entries(patch)) this.flags["rebreya-main"].cardMovementReceipts[path.split(".").at(-1)]=expires;
    },
    actor: {
      uuid: "Actor.b",
      system: size,
      toggleStatusEffect: (id, opts) => {
        assert.equal(id, "prone");
        assert.deepEqual(opts, { active: true });
        applications++;
      }
    }
  };
  const item = { actor: source.actor, flags: { "chris-premades": { info: { identifier: "shove" } } } };
  const message = {
    author: player,
    timestamp: Date.now(),
    getAssociatedItem: () => item,
    getAssociatedToken: () => source,
    system: { targets: [{ token: target.uuid }] }
  };
  const db = new Map([
    [source.uuid, source],
    [target.uuid, target],
    ["ChatMessage.q", message]
  ]);
  let confirm = async () => true;
  globalThis.game = { user: gm, users: { activeGM: gm } };
  globalThis.canvas = { scene };
  globalThis.fromUuid = (uuid) => db.get(uuid);
  globalThis.foundry = { applications: { api: { DialogV2: { confirm: () => confirm() } } } };
  t.mock.method(tokenUtils, "getDistance", () => 5);
  const data = { source: source.uuid, target: target.uuid, message: "ChatMessage.q", result: "prone" };
  assert.equal(await pushCardToken({ ...data, x: 10000 }, { sender: player }), false);
  assert.equal(await pushCardToken(data, { sender: { id: "impostor", active: true } }), false);
  confirm = async () => {
    message.system.targets = [];
    return true;
  };
  assert.equal(await pushCardToken(data, { sender: player }), false);
  assert.equal(applications, 0);
  message.system.targets = [{ token: target.uuid }];
  confirm = async () => true;
  assert.equal(await pushCardToken(data, { sender: player }), true);
  assert.equal(await pushCardToken(data, { sender: player }), false);
  assert.equal(applications, 1);
  db.set("ChatMessage.b", {...message});
  const later = {...data,message:"ChatMessage.b"};
  await Promise.all([pushCardToken(later,{sender:player}),pushCardToken(later,{sender:player})]);
  assert.equal(applications,2);
  assert.equal(await pushCardToken(data,{sender:player}),false);
  assert.equal(applications,2);
});

test("pushing a grappler releases only its reciprocal grip on the token in this scene", async (t) => {
  const gm={id:"gm",isGM:true}, tokens=new Map(), scene={tokens}, removed=[];
  const prev={game:globalThis.game,canvas:globalThis.canvas,foundry:globalThis.foundry};
  const grid={getSnappedPoint:point=>point};
  class Ray { constructor(){this.distance=100;this.angle=0;this.A={x:0,y:0};} static fromAngle(){return new Ray();} project(){return {x:150,y:50};} }
  Object.assign(globalThis,{game:{user:gm,users:new Map([["gm",gm]])},canvas:{scene,dimensions:{size:100,distance:5},grid},foundry:{canvas:{geometry:{Ray}}}});
  t.after(()=>Object.assign(globalThis,prev));
  const actor={uuid:"Actor.A",isOwner:true,items:[],effects:[]},victim={uuid:"Actor.B",effects:[]};
  const moved={id:"T1",actor,document:{id:"T1",parent:scene,testUserPermission:()=>true,async update(){}},center:{x:50,y:50},w:100,h:100,checkCollision:()=>false};
  tokens.set("T1",moved.document);tokens.set("T2",{id:"T2",actor:victim});
  const holding={uuid:"Actor.A.ActiveEffect.a",parent:actor,origin:actor.uuid,
    flags:{"chris-premades":{info:{identifier:"grappling"},grapple:{tokenId:"T2"}},dnd5e:{dependentOn:"Actor.B.ActiveEffect.b"}},async delete(){removed.push("heldPair");}};
  const held={uuid:"Actor.B.ActiveEffect.b",parent:victim,origin:actor.uuid,
    flags:{"chris-premades":{info:{identifier:"grappled"},grapple:{tokenId:"T1"}},dnd5e:{dependentOn:holding.uuid}}};
  actor.effects=[{statuses:new Set(["grappled"]),async delete(){removed.push("manual");}},{...holding,uuid:"forged",async delete(){removed.push("foreign");}},holding];
  victim.effects=[held];
  assert.equal(await tokenUtils.pushToken({center:{x:0,y:0}},moved,5),true);
  assert.deepEqual(removed,["heldPair"]);
});
