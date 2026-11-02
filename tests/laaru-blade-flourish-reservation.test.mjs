import test from "node:test";
import assert from "node:assert/strict";
import { BardicInspirationCompatService } from "../scripts/combat/bardic-inspiration-compat-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { bardicFixture } from "./helpers/bardic-inspiration-fixture.mjs";

function setup() {
  const f=bardicFixture({level:5,scale:"d8"});
  const feature={id:"flourish",uuid:`${f.source.uuid}.Item.flourish`,actor:f.source,parent:f.source,type:"feat",
    flags:{core:{sourceId:"Compendium.laaru-dnd5-hw.classfeatures.Item.qDRuySW6197wSH4l"}}};
  f.source.items.push(feature); f.documents.set(feature.uuid,feature);
  const weapon={id:"weapon",uuid:`${f.source.uuid}.Item.weapon`,actor:f.source,parent:f.source,type:"weapon"};
  f.source.items.push(weapon); f.documents.set(weapon.uuid,weapon);
  const scene={id:"scene",documentName:"Scene",tokens:new Map()};
  const sourceToken={id:"source",uuid:"Scene.scene.Token.source",documentName:"Token",parent:scene,actor:f.source};
  const targetToken={id:"target",uuid:"Scene.scene.Token.target",documentName:"Token",parent:scene,actor:f.target};
  scene.tokens.set(sourceToken.id,sourceToken);scene.tokens.set(targetToken.id,targetToken);
  f.documents.set(sourceToken.uuid,sourceToken);f.documents.set(targetToken.uuid,targetToken);
  const attackCard = id => ({ id, author:f.sender, speaker:{scene:"scene",token:"source",actor:f.source.id},
    flags:{dnd5e:{messageType:"usage",item:{uuid:weapon.uuid},activity:{type:"attack"}},
      "midi-qol":{hitTargetUuids:[targetToken.uuid],damageRolls:[{options:{type:"piercing",properties:["mgc", "sil"]}}]}} });
  for (const id of ["attack-1","new-attack","next-turn","later-attack","another-attack","another"]) game.messages.set(id,attackCard(id));
  f.item.system.uses.value=3; f.item.system.uses.spent=1;
  game.combat={id:"combat",uuid:"Combat.combat",started:true,round:3,turn:1,combatant:{actor:f.source,token:sourceToken}};
  let rolls=0;
  const service=new BardicInspirationCompatService({worldMutationCoordinator:new WorldMutationCoordinator()}, {
    rollBladeFlourish:async formula=>{rolls++;return {formula,total:5,toJSON(){return {formula,total:5};}};}
  });
  const payload={operationId:"attack-1",sourceItemUuid:f.item.uuid,featureItemUuid:feature.uuid,weaponItemUuid:weapon.uuid,
    sourceTokenUuid:sourceToken.uuid,targetTokenUuid:targetToken.uuid,secondaryTokenUuid:"",combatId:"combat",round:3,turn:1,mode:"defensive",damageType:"piercing",useMaster:false,actionConfirmed:true};
  return {...f,service,payload,sourceToken,targetToken,weapon,get rolls(){return rolls;}};
}

function setupMovable(f) {
  const previous = globalThis.canvas, scene = f.sourceToken.parent;
  scene.grid = { size: 100, distance: 5, units: "ft", type: 1 };
  Object.assign(f.sourceToken, { x: 0, y: 0, width: 1, height: 1, object: {} });
  Object.assign(f.targetToken, { x: 100, y: 0, width: 1, height: 1, flags: {}, object: { checkCollision: () => false }, async update() {} });
  globalThis.canvas = { scene: { id: "scene" }, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 1000, sceneHeight: 1000 }, tokens: { placeables: [] } };
  return () => { globalThis.canvas = previous; };
}

test("one successful flourish reserves one die and exact retries do not spend or roll twice",async()=>{
  const f=setup();
  const [a,b]=await Promise.all([f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),f.service.reserveBladeFlourish(f.payload,{sender:f.sender})]);
  assert.equal(f.item.system.uses.spent,2);assert.equal(f.rolls,1);assert.equal(a.roll.total,5);assert.deepEqual(b.roll,a.roll);
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,operationId:"another-attack"},{sender:f.sender}),/ход|использован|не заверш/iu);
  assert.equal(f.item.system.uses.spent,2);
});

test("v14 Flourish requires a confirmed hit on the exact usage card and snapshots native damage properties",async()=>{
  const f=setup(),card=game.messages.get(f.payload.operationId),legacy=card.flags.dnd5e;
  card.type="usage";card.system={item:legacy.item,activity:legacy.activity,midi:{sections:{hits:{data:{hits:[{uuid:f.targetToken.uuid,hitClass:"failure"}]}}}}};
  card.rolls=[{options:{"midi-qol":{rollType:"defaultDamage"},type:"piercing",properties:["mgc","sil"]}}];
  delete card.flags.dnd5e;
  card.flags["rebreya-main"]={bladeFlourishHit:{targetTokenUuid:f.targetToken.uuid,sourceTokenUuid:f.sourceToken.uuid}};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/попадание/u);
  assert.equal(f.item.system.uses.spent,1);
  card.system.midi.sections.hits.data.hits[0].hitClass="success";
  await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.item.system.uses.spent,2);
  const flourish={total:5,options:{rebreyaBladeFlourishOperationId:f.payload.operationId,type:"piercing",
    properties:["mgc","sil","rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"],"midi-qol":{rollType:"bonusDamage"}}};
  card.flags["midi-qol"].bonusDamageRolls=[flourish];
  await assert.rejects(f.service.commitBladeFlourish(f.payload,{sender:f.sender}),/урон|атак/u);
  card.rolls.push(flourish);
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.item.system.uses.spent,2);assert.equal(f.source.effects.length,1);
});

test("flourish reservation validates actor ownership, actual feature, turn and available resource before spending",async()=>{
  const f=setup();
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:{id:"stranger",isGM:false}}),/прав|владел/iu);
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,round:2},{sender:f.sender}),/ход|бой/iu);
  f.item.system.uses.value=0;
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/вдохнов|заряд|кость/iu);
  assert.equal(f.item.system.uses.spent,1);assert.equal(f.rolls,0);
});

test("cancelled flourish restores exactly its own charge and permits a different attack",async()=>{
  const f=setup(); await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  await f.service.cancelBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.item.system.uses.spent,1);
  await f.service.cancelBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.item.system.uses.spent,1);
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/отмен/iu);
  await f.service.reserveBladeFlourish({...f.payload,operationId:"new-attack"},{sender:f.sender});
  assert.equal(f.item.system.uses.spent,2);
});

test("pending flourish cannot be overwritten in a later turn and cannot undo an unrelated spend",async()=>{
  const f=setup(); await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.combat.turn=2;
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,operationId:"later-attack",turn:2},{sender:f.sender}),/не заверш|ожида/iu);
  f.item.system.uses.spent=3;
  await assert.rejects(f.service.cancelBladeFlourish(f.payload,{sender:f.sender}),/измен|провер/iu);
  assert.equal(f.item.system.uses.spent,3);
});

test("Master's Flourish may roll d6 without spending inspiration",async()=>{
  const f=setup();f.item.system.uses.value=0;
  f.source.items.push({type:"feat",flags:{core:{sourceId:"Compendium.laaru-dnd5-hw.classfeatures.Item.2CBi1sXX75w4yXTb"}}});
  const result=await f.service.reserveBladeFlourish({...f.payload,useMaster:true},{sender:f.sender});
  assert.equal(result.roll.formula,"1d6");assert.equal(f.item.system.uses.spent,1);
});

test("a lost update response replays the persisted roll without a second expenditure",async()=>{
  const f=setup(), update=f.item.update.bind(f.item);let fail=true;
  f.item.update=async patch=>{const value=await update(patch);if(fail){fail=false;throw new Error("response lost");}return value;};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/response lost/u);
  const replay=await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(replay.roll.total,5);assert.equal(f.rolls,1);assert.equal(f.item.system.uses.spent,2);
});

test("committed flourish cannot be refunded and prevents another use in the same turn",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.messages.get(f.payload.operationId).flags["midi-qol"].bonusDamageRolls=[{total:5,options:{rebreyaBladeFlourishOperationId:f.payload.operationId,type:"piercing",properties:["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]}}];
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.source.effects.length,1);
  assert.deepEqual(f.source.effects[0].changes,[{key:"system.attributes.ac.bonus",mode:2,value:"5",priority:20}]);
  await assert.rejects(f.service.cancelBladeFlourish(f.payload,{sender:f.sender}),/заверш|отмен/iu);
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,operationId:"another"},{sender:f.sender}),/ход|использован/iu);
  assert.equal(f.item.system.uses.spent,2);
  game.combat.turn=2;await f.service.reserveBladeFlourish({...f.payload,turn:2,operationId:"next-turn"},{sender:f.sender});
  assert.equal(f.item.system.uses.spent,3);
});

test("defensive flourish does not commit without proof its roll joined the attack",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  await assert.rejects(f.service.commitBladeFlourish(f.payload,{sender:f.sender}),/урон|бросок|атак/iu);
  assert.equal(f.source.effects.length,0);assert.equal(f.item.system.uses.spent,2);
  await f.service.cancelBladeFlourish(f.payload,{sender:f.sender});assert.equal(f.item.system.uses.spent,1);
});

test("a reserved flourish can be replayed after the combat turn changes",async()=>{
  const f=setup();const first=await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.combat.turn=2;
  const retry=await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  assert.deepEqual(retry.roll,first.roll);assert.equal(f.rolls,1);assert.equal(f.item.system.uses.spent,2);
});

test("an owner can cancel a reservation after the originating feature is removed",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  f.documents.delete(f.payload.featureItemUuid);
  await f.service.cancelBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.item.system.uses.spent,1);
});

test("concurrent resource edits or an authority change during the roll never get overwritten",async()=>{
  const f=setup();
  f.service.options.rollBladeFlourish=async formula=>{f.item.system.uses.spent=2;return {formula,total:4,toJSON(){return {formula,total:4};}};};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/измен|повтор/iu);
  assert.equal(f.item.system.uses.spent,2);
  f.item.system.uses.spent=1;
  f.service.options.rollBladeFlourish=async formula=>{game.users.activeGM={id:"new-gm",active:true,isGM:true};return {formula,total:4,toJSON(){return {formula,total:4};}};};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/мастер|повтор/iu);
  assert.equal(f.item.system.uses.spent,1);
});

test("flourish socket accepts only exact same-actor validated requests",async()=>{
  const {isValidBladeFlourishRequest}=await import("../scripts/infrastructure/foundry/bardic-inspiration-command.js");
  const f=setup(), payload={...f.payload,phase:"reserve"};
  assert.equal(isValidBladeFlourishRequest(payload),true);
  assert.equal(isValidBladeFlourishRequest({...payload,phase:"cancel"}),true);
  assert.equal(isValidBladeFlourishRequest({...payload,extra:true}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,phase:"unknown"}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,sourceItemUuid:"Actor.other.Item.inspiration"}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,damageType:"cold] + 999"}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,actionConfirmed:false}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,secondaryTokenUuid:"Scene.scene.Token.other"}),false);
  assert.equal(isValidBladeFlourishRequest({...payload,round:-1}),false);
});

test("direct flourish calls enforce the same strict payload contract as the socket",async()=>{
  const f=setup();
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,extra:true},{sender:f.sender}),/параметр/iu);
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,featureItemUuid:"Actor.other.Item.flourish"},{sender:f.sender}),/параметр/iu);
  assert.equal(f.rolls,0);assert.equal(f.item.system.uses.spent,1);
});

test("flourish command authorizes the owner and routes reserve and cancel through the same service",async()=>{
  const {registerBladeFlourishCommand}=await import("../scripts/infrastructure/foundry/bardic-inspiration-command.js");
  const f=setup(), commands=new Map();
  registerBladeFlourishCommand({register(name,definition){commands.set(name,definition);}},f.service);
  const command=commands.get("bardic.blade-flourish"), payload={...f.payload,phase:"reserve"};
  assert.ok(command);assert.equal(command.validate(payload),true);
  assert.ok(command.scheduling.keys(payload).includes(`document:${payload.targetTokenUuid}`));
  assert.equal(await command.authorize(payload,{sender:{id:"stranger",isGM:false}}),false);
  assert.equal(await command.authorize(payload,{sender:f.sender}),true);
  await command.execute(payload,{sender:f.sender});assert.equal(f.item.system.uses.spent,2);
  await command.execute({...payload,phase:"cancel"},{sender:f.sender});assert.equal(f.item.system.uses.spent,1);
});

test("duplicate inspiration items cannot each supply a flourish in the same turn",async()=>{
  const f=setup();
  const duplicate={...f.item,id:"second",uuid:`${f.source.uuid}.Item.second`,system:structuredClone({...f.item.system,activities:[]}),flags:structuredClone(f.item.flags)};
  duplicate.actor=f.source;duplicate.parent=f.source;f.source.items.push(duplicate);f.documents.set(duplicate.uuid,duplicate);
  await assert.rejects(f.service.reserveBladeFlourish({...f.payload,sourceItemUuid:duplicate.uuid},{sender:f.sender}),/источник|вдохнов/iu);
  assert.equal(f.item.system.uses.spent,1);assert.equal(duplicate.system.uses.spent,1);assert.equal(f.rolls,0);
});

test("commit and cancel reject a replay whose operation parameters were changed",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  await assert.rejects(f.service.cancelBladeFlourish({...f.payload,mode:"mobile"},{sender:f.sender}),/параметр|операц/iu);
  await assert.rejects(f.service.commitBladeFlourish({...f.payload,damageType:"fire"},{sender:f.sender}),/параметр|операц/iu);
  assert.equal(f.item.system.uses.spent,2);
});

test("flourish rejects a foreign weapon, stale source token or target from another scene",async()=>{
  const f=setup();
  f.weapon.actor={uuid:"Actor.other"};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/оруж|токен|цель/iu);
  f.weapon.actor=f.source;
  game.combat.combatant.token={uuid:"Scene.scene.Token.other"};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/оруж|токен|цель/iu);
  game.combat.combatant.token=f.sourceToken;f.targetToken.parent={id:"elsewhere",documentName:"Scene"};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/оруж|токен|цель/iu);
  assert.equal(f.item.system.uses.spent,1);assert.equal(f.rolls,0);
});

test("removed feature or reassigned target while rolling aborts before paying",async()=>{
  const f=setup();
  const feature=f.documents.get(f.payload.featureItemUuid);
  f.service.options.rollBladeFlourish=async formula=>{feature.flags.core.sourceId="Compendium.other.Item.fake";return {formula,total:4,toJSON(){return {formula,total:4};}};};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/измен|повтор/iu);
  assert.equal(f.item.system.uses.spent,1);
  feature.flags.core.sourceId="Compendium.laaru-dnd5-hw.classfeatures.Item.qDRuySW6197wSH4l";
  f.service.options.rollBladeFlourish=async formula=>{f.targetToken.actor={uuid:"Actor.someoneElse"};return {formula,total:4,toJSON(){return {formula,total:4};}};};
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/измен|повтор/iu);
  assert.equal(f.item.system.uses.spent,1);
});

test("a flourish requires the owner's attack card and a confirmed hit on its exact target",async()=>{
  const f=setup(), card=game.messages.get("attack-1");
  card.flags["midi-qol"].hitTargetUuids=[];
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/попадан|атак/iu);
  card.flags["midi-qol"].hitTargetUuids=[f.targetToken.uuid];card.flags.dnd5e.item.uuid=`${f.source.uuid}.Item.other`;
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/попадан|атак/iu);
  card.flags.dnd5e.item.uuid=f.weapon.uuid;card.speaker.scene="another-scene";
  await assert.rejects(f.service.reserveBladeFlourish(f.payload,{sender:f.sender}),/попадан|атак/iu);
  assert.equal(f.item.system.uses.spent,1);assert.equal(f.rolls,0);
});

test("defensive flourish expires at the next source turn without touching unrelated effects",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.messages.get(f.payload.operationId).flags["midi-qol"].bonusDamageRolls=[{total:5,options:{rebreyaBladeFlourishOperationId:f.payload.operationId,type:"piercing",properties:["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]}}];
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  const unrelated={id:"unrelated",flags:{},async delete(){throw new Error("unrelated effect was deleted");}};f.source.effects.push(unrelated);
  await f.service.expireBladeFlourishDefense(game.combat,f.source);assert.equal(f.source.effects.length,2);
  game.combat.round=4;game.combat.turn=1;
  await f.service.expireBladeFlourishDefense(game.combat,f.source);
  assert.deepEqual(f.source.effects,[unrelated]);
  await f.service.expireBladeFlourishDefense(game.combat,f.source);assert.deepEqual(f.source.effects,[unrelated]);
});

test("combat removal clears only this encounter's defensive flourishes",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.messages.get(f.payload.operationId).flags["midi-qol"].bonusDamageRolls=[{total:5,options:{rebreyaBladeFlourishOperationId:f.payload.operationId,type:"piercing",properties:["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]}}];
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  game.combat.combatants=[{actor:f.source}];game.actors={contents:[f.source]};
  await f.service.handleBladeFlourishCombatEnd(game.combat);
  assert.equal(f.source.effects.length,0);
});

test("defensive effect survives a lost creation response without duplication",async()=>{
  const f=setup();await f.service.reserveBladeFlourish(f.payload,{sender:f.sender});
  game.messages.get(f.payload.operationId).flags["midi-qol"].bonusDamageRolls=[{total:5,options:{rebreyaBladeFlourishOperationId:f.payload.operationId,type:"piercing",properties:["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]}}];
  const create=f.source.createEmbeddedDocuments.bind(f.source);let fail=true;
  f.source.createEmbeddedDocuments=async (...args)=>{const value=await create(...args);if(fail){fail=false;throw new Error("effect response lost");}return value;};
  await assert.rejects(f.service.commitBladeFlourish(f.payload,{sender:f.sender}),/response lost/u);
  await f.service.commitBladeFlourish(f.payload,{sender:f.sender});
  assert.equal(f.source.effects.length,1);assert.equal(f.item.system.uses.spent,2);
});


test("flourish appends to primary damage exactly once and keeps existing Midi bonuses", async () => {
  const f = setup();
  const existing = { total: 3, options: { flavor: "other bonus" } };
  const workflow = {
    chatCard: {}, damageRolls: [{ options: { properties: ["mgc", "sil"] } }], bonusDamageRolls: [existing], async performThrottledUpdate() {},
    async setDamageRolls(rolls) { this.damageRolls = rolls; }
  };
  f.service.options.deserializeBladeFlourish = data => ({ ...data, _evaluated: true, options: {} });
  const saved = { formula: "1d8[piercing]", total: 5 };
  await f.service.attachBladeFlourishRoll(workflow, saved, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  await f.service.attachBladeFlourishRoll(workflow, saved, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.equal(workflow.bonusDamageRolls.length, 1);
  assert.equal(workflow.bonusDamageRolls[0], existing);
  assert.equal(workflow.damageRolls.length, 2);
  assert.equal(workflow.damageRolls[1].total, 5);
  assert.deepEqual(new Set(workflow.damageRolls[1].options.properties), new Set(["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]));
  assert.equal(workflow.damageRolls[1].options.rebreyaBladeFlourishOperationId, "attack-1");
});

test("defensive flourish enters primary damage before Midi applies resistance", async () => {
  const f = setup(), original = { total: 3, options: { type: "piercing", properties: ["mgc"] } };
  const existingBonus = { total: 7, options: { type: "fire", properties: [] } };
  f.service.options.deserializeBladeFlourish = async data => ({ ...data, _evaluated: true, options: { ...data.options } });
  const workflow = { chatCard: {}, damageRolls: [original], bonusDamageRolls: [existingBonus], async performThrottledUpdate() {},
    async setDamageRolls(rolls) { this.damageRolls = rolls; }, async setBonusDamageRolls() { assert.fail("must not place flourish in separate Midi bonus damage"); } };
  await f.service.attachBladeFlourishRoll(workflow, { total: 1, options: { type: "piercing" } }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.equal(workflow.damageRolls.length, 2); assert.deepEqual(workflow.bonusDamageRolls, [existingBonus]);
  const damage = workflow.damageRolls.map(roll => ({ type: roll.options.type, value: roll.total, properties: new Set(roll.options.properties) }));
  f.service.applyBladeFlourishPreCalculateDamage(f.target, damage, { midi: { targetUuid: f.targetToken.uuid } });
  assert.equal(damage.length, 1); assert.equal(Math.floor(damage[0].value / 2), 2);
});

test("GM commits a flourish saved in primary damage and never refunds it", async () => {
  const f = setup(); await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.get("attack-1").flags["midi-qol"].damageRolls.push({ total: 5, options: {
    rebreyaBladeFlourishOperationId: "attack-1", type: "piercing", properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]
  } });
  await assert.rejects(f.service.cancelBladeFlourish(f.payload, { sender: f.sender }), /урон|отмен/u);
  await f.service.commitBladeFlourish(f.payload, { sender: f.sender });
  assert.equal(f.source.effects[0].changes[0].value, "5"); assert.equal(f.item.system.uses.spent, 2);
});

test("GM rejects a flourish duplicated between old and new Midi damage fields", async () => {
  const f = setup(); await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  const die = { total: 5, options: { rebreyaBladeFlourishOperationId: "attack-1", type: "piercing",
    properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"] } };
  const midi = game.messages.get("attack-1").flags["midi-qol"];
  midi.damageRolls.push(die); midi.bonusDamageRolls = [structuredClone(die)];
  await assert.rejects(f.service.commitBladeFlourish(f.payload, { sender: f.sender }), /урон|бросок|подтверж/u);
  assert.equal(f.source.effects.length, 0);
});

test("an already attached legacy flourish is not added again after updating the module", async () => {
  const f = setup(), marker = "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target";
  const legacy = { total: 5, options: { type: "piercing", properties: ["mgc", marker], rebreyaBladeFlourishOperationId: "attack-1" } };
  const workflow = { chatCard: {}, damageRolls: [{ options: { properties: ["mgc"] } }], bonusDamageRolls: [legacy],
    async performThrottledUpdate() {}, async setDamageRolls() { assert.fail("legacy die must not be duplicated"); } };
  const result = await f.service.attachBladeFlourishRoll(workflow, { total: 5, options: { type: "piercing" } }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.equal(result.replayed, true); assert.equal(workflow.damageRolls.length, 1); assert.equal(workflow.bonusDamageRolls.length, 1);
});

test("Midi recalculation does not mutate properties of other primary damage rolls", async () => {
  const f = setup(), first = { options: { properties: ["mgc"] } }, second = { options: { properties: ["sil", "mgc"] } };
  f.service.options.deserializeBladeFlourish = data => ({ ...data, _evaluated: true, options: {} });
  const workflow = { chatCard: {}, damageRolls: [first, second], bonusDamageRolls: [], async performThrottledUpdate() {},
    async setDamageRolls(rolls) { for (let i = 1; i < rolls.length; i++) rolls[i].options.properties = (rolls[i].options.properties ?? []).concat(rolls[0].options.properties); this.damageRolls = rolls; } };
  await f.service.attachBladeFlourishRoll(workflow, { total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.deepEqual(second.options.properties, ["sil", "mgc"]);
  assert.deepEqual(workflow.damageRolls[2].options.properties, ["mgc", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]);
});

test("Midi setter receives arrays even when the existing weapon properties are a Set", async () => {
  const f = setup(), properties = new Set(["mgc"]), first = { options: { properties } };
  f.service.options.deserializeBladeFlourish = data => ({ ...data, _evaluated: true, options: {} });
  const workflow = { chatCard: {}, damageRolls: [first], bonusDamageRolls: [], async performThrottledUpdate() {},
    async setDamageRolls(rolls) { assert.ok(Array.isArray(rolls[0].options.properties)); this.damageRolls = rolls; } };
  await f.service.attachBladeFlourishRoll(workflow, { total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.ok(first.options.properties instanceof Set); assert.deepEqual([...first.options.properties], ["mgc"]);
});


test("flourish refuses a conflicting or unevaluated reconstructed bonus roll", async () => {
  const f = setup();
  const existing = { total: 2, options: { rebreyaBladeFlourishOperationId: "attack-1" } };
  const workflow = { chatCard: {}, damageRolls: [{ options: { properties: [] } }], bonusDamageRolls: [existing], async performThrottledUpdate() {}, async setDamageRolls() { assert.fail("must not overwrite"); } };
  await assert.rejects(f.service.attachBladeFlourishRoll(workflow, { total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid }), /изменился/u);
  workflow.bonusDamageRolls = [];
  f.service.options.deserializeBladeFlourish = () => ({ total: 5, _evaluated: false });
  await assert.rejects(f.service.attachBladeFlourishRoll(workflow, { total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid }), /недоступен/u);
});


test("flourish reconstructs a stored roll through the Foundry Roll JSON API", async () => {
  const f = setup();
  const originalRoll = globalThis.Roll;
  let decoded;
  globalThis.Roll = { fromJSON(json) { decoded = JSON.parse(json); return { ...decoded, _evaluated: true, options: {} }; } };
  try {
    const workflow = { chatCard: {}, damageRolls: [{ options: { properties: [] } }], bonusDamageRolls: [], async performThrottledUpdate() {}, async setDamageRolls(rolls) { this.damageRolls = rolls; } };
    await f.service.attachBladeFlourishRoll(workflow, { formula: "1d8[piercing]", total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
    assert.equal(decoded.total, 5);
    assert.equal(workflow.damageRolls[1].options.rebreyaBladeFlourishOperationId, "attack-1");
  } finally { globalThis.Roll = originalRoll; }
});


test("flourish explicitly flushes Midi's persisted bonus before reporting success", async () => {
  const f = setup();
  f.service.options.deserializeBladeFlourish = data => ({ ...data, _evaluated: true, options: {} });
  const card = {};
  const calls = [];
  const workflow = {
    chatCard: card, damageRolls: [{ options: { properties: [] } }], bonusDamageRolls: [],
    async setDamageRolls(rolls) { this.damageRolls = rolls; calls.push("attach"); },
    async performThrottledUpdate(message, update, immediate) {
      assert.equal(message, card); assert.deepEqual(update, {}); assert.equal(immediate, true); calls.push("flush");
    }
  };
  await f.service.attachBladeFlourishRoll(workflow, { total: 5 }, "attack-1", { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid });
  assert.deepEqual(calls, ["attach", "flush"]);
});


test("flourish commit rejects attack rolls with forged damage type or weapon properties", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  const options = { rebreyaBladeFlourishOperationId: "attack-1", type: "fire", properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"] };
  game.messages.get("attack-1").flags["midi-qol"].bonusDamageRolls = [{ total: 5, options }];
  await assert.rejects(f.service.commitBladeFlourish(f.payload, { sender: f.sender }), /урон|атак/u);
  options.type = "piercing"; options.properties = ["mgc", "sil", "ada", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"];
  await assert.rejects(f.service.commitBladeFlourish(f.payload, { sender: f.sender }), /урон|атак/u);
  assert.equal(f.source.effects.length, 0);
});


test("flourish workflow flushes attack, reserves, attaches, then commits exactly once", async () => {
  const f = setup(), calls = [];
  const workflow = { chatCard: { id: f.payload.operationId }, async performThrottledUpdate() { calls.push("flush-attack"); } };
  f.service.moduleApi.socketCommandBus = { async request(command, request) {
    calls.push(request.phase);
    return request.phase === "reserve" ? { roll: { total: 5 } } : { committed: true };
  } };
  f.service.attachBladeFlourishRoll = async () => { calls.push("attach-and-flush"); };
  await f.service.performBladeFlourish(workflow, f.payload);
  assert.deepEqual(calls, ["flush-attack", "reserve", "attach-and-flush", "commit"]);
});

test("a real Midi hit is recorded when Midi does not save hit targets to its chat card", async () => {
  const f = setup(), card = game.messages.get("attack-1"), calls = [];
  delete card.flags["midi-qol"].hitTargetUuids;
  card.update = async patch => { card.flags["rebreya-main"] = { bladeFlourishHit: patch["flags.rebreya-main.bladeFlourishHit"] }; };
  const workflow = { chatCard: card, hitTargets: new Set([{ document: f.targetToken }]), async performThrottledUpdate() {} };
  f.service.moduleApi.socketCommandBus = { async request(_command, payload) {
    calls.push(payload.phase);
    return payload.phase === "reserve" ? { roll: { total: 5 } } : { committed: true };
  } };
  f.service.attachBladeFlourishRoll = async () => {};
  await f.service.performBladeFlourish(workflow, f.payload);
  assert.equal(card.flags["rebreya-main"].bladeFlourishHit.targetTokenUuid, f.targetToken.uuid);
  assert.deepEqual(calls, ["reserve", "commit"]);
});

test("GM accepts a recorded workflow hit when Midi chat-card hit saving is disabled", async () => {
  const f = setup(), card = game.messages.get("attack-1");
  delete card.flags["midi-qol"].hitTargetUuids;
  card.flags["rebreya-main"] = { bladeFlourishHit: { targetTokenUuid: f.targetToken.uuid, sourceTokenUuid: f.sourceToken.uuid } };
  assert.equal((await f.service.reserveBladeFlourish(f.payload, { sender: f.sender })).roll.total, 5);
});

test("manual flourishes roll and spend without adding attack damage or moving tokens", async () => {
  for (const mode of ["slashing", "mobile"]) {
    const f = setup(), calls = [], workflow = { chatCard: { id: f.payload.operationId }, async performThrottledUpdate() {} };
    f.service.moduleApi.socketCommandBus = { async request(_command, payload) {
      calls.push(payload.phase); return payload.phase === "reserve" ? { roll: { total: 5 } } : { committed: true };
    } };
    f.service.attachBladeFlourishRoll = async () => assert.fail("manual mode must not modify attack damage");
    await f.service.performBladeFlourish(workflow, { ...f.payload, mode });
    assert.deepEqual(calls, ["reserve", "commit"]);
  }
});

test("manual flourish commits once with no damage roll attached or defensive effect", async () => {
  for (const mode of ["slashing", "mobile"]) {
    const f = setup(), payload = { ...f.payload, mode };
    f.service.options.publishManualBladeFlourish = async () => {};
    await f.service.reserveBladeFlourish(payload, { sender: f.sender });
    assert.equal((await f.service.commitBladeFlourish(payload, { sender: f.sender })).committed, true);
    assert.equal((await f.service.commitBladeFlourish(payload, { sender: f.sender })).replayed, true);
    assert.equal(f.item.system.uses.spent, 2);
    assert.equal(f.source.effects.length, 0);
    await assert.rejects(f.service.reserveBladeFlourish({ ...payload, operationId: "new-attack" }, { sender: f.sender }), /ход|использован/iu);
  }
});

test("manual flourish rolls the original die even if the attack was critical", async () => {
  const f = setup();
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.isCritical = true;
  f.service.options.rollBladeFlourish = async (formula, _type, _actor, options) => {
    assert.equal(options.critical, false);
    return { formula, total: 5, toJSON() { return { formula, total: 5 }; } };
  };
  const payload = { ...f.payload, mode: "slashing" };
  f.service.options.publishManualBladeFlourish = async () => {};
  await f.service.reserveBladeFlourish(payload, { sender: f.sender });
  await f.service.commitBladeFlourish(payload, { sender: f.sender });
  assert.equal(f.item.system.uses.spent, 2);
});

test("a lost chat response for manual flourish is recovered without rolling, spending or posting twice", async () => {
  const f = setup(), originalRoll = globalThis.Roll, originalChat = globalThis.ChatMessage;
  const payload = { ...f.payload, mode: "slashing" }; let posts = 0;
  globalThis.Roll = { fromJSON(raw) { return { ...JSON.parse(raw), _evaluated: true, async toMessage(data) { return data; } }; } };
  globalThis.ChatMessage = { getSpeaker: () => ({}), async create(data) {
    posts++; game.messages.set(data._id, data); throw new Error("response lost");
  } };
  try {
    await f.service.reserveBladeFlourish(payload, { sender: f.sender });
    await f.service.commitBladeFlourish(payload, { sender: f.sender });
    await f.service.commitBladeFlourish(payload, { sender: f.sender });
    assert.equal(posts, 1); assert.equal(f.rolls, 1); assert.equal(f.item.system.uses.spent, 2);
  } finally { globalThis.Roll = originalRoll; globalThis.ChatMessage = originalChat; }
});

test("GM can publish a reserved manual roll after chat creation failed", async () => {
  const f = setup(), payload = { ...f.payload, mode: "mobile" }; let published = 0;
  await f.service.reserveBladeFlourish(payload, { sender: f.sender });
  f.service.options.publishManualBladeFlourish = async () => { if (!published++) throw new Error("chat failed"); };
  await assert.rejects(f.service.commitBladeFlourish(payload, { sender: f.sender }), /chat failed/u);
  game.combats = { get: () => game.combat };
  f.service.options.promptBladeRecovery = async ({ canResume }) => { assert.equal(canResume, true); return "resume"; };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(published, 2); assert.equal(f.item.system.uses.spent, 2); assert.equal(f.rolls, 1);
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.status, "committed");
});

test("manual flourish publishes the evaluated die to chat", async () => {
  const f = setup(), previousRoll = globalThis.Roll, previousChat = globalThis.ChatMessage;
  game.messages.get("attack-1").whisper = ["gm", "player"];
  game.messages.get("attack-1").blind = true;
  let message;
  globalThis.Roll = { fromJSON(raw) { const data = JSON.parse(raw); return { ...data, _evaluated: true, async toMessage(options, config) { assert.equal(config.create, false); return options; } }; } };
  globalThis.ChatMessage = { async create(data, options) { assert.equal(options.keepId, true); message = data; game.messages.set(data._id, data); } };
  try {
    const payload = { ...f.payload, mode: "mobile" };
    await f.service.reserveBladeFlourish(payload, { sender: f.sender });
    await f.service.commitBladeFlourish(payload, { sender: f.sender });
    assert.match(message.flavor, /вручную/u);
    assert.deepEqual(message.whisper, ["gm", "player"]);
    assert.equal(message.blind, true);
    assert.equal(message.author, f.sender.id);
  } finally { globalThis.Roll = previousRoll; globalThis.ChatMessage = previousChat; }
});

test("uncertain bonus attachment never automatically refunds the flourish die", async () => {
  const f = setup(), calls = [];
  const workflow = { chatCard: { id: f.payload.operationId }, async performThrottledUpdate() {} };
  f.service.moduleApi.socketCommandBus = { async request(command, request) { calls.push(request.phase); return { roll: { total: 5 } }; } };
  f.service.attachBladeFlourishRoll = async () => { throw new Error("lost response"); };
  await assert.rejects(f.service.performBladeFlourish(workflow, f.payload), /lost response/u);
  assert.deepEqual(calls, ["reserve"]);
  assert.equal(workflow.aborted, true);
});


test("concurrent requests for one attack cannot silently use different flourish choices", async () => {
  const f = setup(); let unblock;
  const workflow = { chatCard: { id: f.payload.operationId }, async performThrottledUpdate() { await new Promise(resolve => { unblock = resolve; }); } };
  f.service.moduleApi.socketCommandBus = { async request(_command, request) { return request.phase === "reserve" ? { roll: { total: 5 } } : {}; } };
  f.service.attachBladeFlourishRoll = async () => {};
  const first = f.service.performBladeFlourish(workflow, f.payload);
  const second = f.service.performBladeFlourish(workflow, { ...f.payload, mode: "mobile" });
  unblock();
  await assert.rejects(second, /параметр|операц/u);
  await first;
});


test("Attack action grants flourish speed once and it expires at the turn boundary", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  const request = { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed };
  await f.service.grantBladeFlourishSpeed(request, { sender: f.sender });
  await f.service.grantBladeFlourishSpeed(request, { sender: f.sender });
  assert.equal(f.source.effects.length, 1);
  assert.deepEqual(f.source.effects[0].changes, [{ key: "system.attributes.movement.walk", mode: 2, value: "10", priority: 20 }]);
  game.combat.turn = 2;
  await f.service.expireBladeFlourishSpeed(game.combat, f.source);
  assert.equal(f.source.effects.length, 0);
});

test("flourish speed increases existing movement modes without granting new ones", async () => {
  const f = setup();
  f.source.system = { attributes: { movement: { walk: 30, fly: 40, swim: 0, climb: 0, burrow: 0, units: "ft" } } };
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  await f.service.grantBladeFlourishSpeed({ operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed }, { sender: f.sender });
  assert.deepEqual(f.source.effects[0].changes.map(change => change.key), ["system.attributes.movement.walk", "system.attributes.movement.fly"]);
});


test("turn and combat cleanup removes stale speed without deleting other effects", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  const request = { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed };
  game.combat.combatants = [{ actor: f.source }];
  await f.service.grantBladeFlourishSpeed(request, { sender: f.sender });
  f.source.effects.push({ id: "unrelated", flags: {} });
  game.combat.turn = 2;
  await f.service.handleBladeFlourishCombatTurn(game.combat);
  assert.deepEqual(f.source.effects.map(effect => effect.id), ["unrelated"]);
});


test("flourish speed validates ownership and refuses a stale or foreign attack", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  const request = { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed };
  await assert.rejects(f.service.grantBladeFlourishSpeed(request, { sender: { id: "stranger", isGM: false } }), /подтверж/u);
  game.combat.turn++;
  await assert.rejects(f.service.grantBladeFlourishSpeed(request, { sender: f.sender }), /подтверж/u);
  assert.equal(f.source.effects.length, 0);
});

test("flourish speed retries after a lost effect-creation response without duplication", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  const request = { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed };
  const create = f.source.createEmbeddedDocuments.bind(f.source); let lost = false;
  f.source.createEmbeddedDocuments = async (...args) => { const result = await create(...args); if (!lost) { lost = true; throw new Error("lost response"); } return result; };
  await assert.rejects(f.service.grantBladeFlourishSpeed(request, { sender: f.sender }), /lost response/u);
  const replay = await f.service.grantBladeFlourishSpeed(request, { sender: f.sender });
  assert.equal(replay.replayed, true);
  assert.equal(f.source.effects.length, 1);
});


test("speed command validates its exact request and authorizes the feature owner", async () => {
  const { registerBladeFlourishSpeedCommand } = await import("../scripts/infrastructure/foundry/bardic-inspiration-command.js");
  const f = setup(), commands = new Map();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  const request = { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed };
  registerBladeFlourishSpeedCommand({ register(name, definition) { commands.set(name, definition); } }, f.service);
  const command = commands.get("bardic.blade-flourish-speed");
  assert.equal(command.validate(request), true);
  assert.equal(command.validate({ ...request, actionConfirmed: false }), false);
  assert.equal(command.validate({ ...request, weaponItemUuid: "Actor.other.Item.weapon" }), false);
  assert.equal(await command.authorize(request, { sender: { id: "stranger", isGM: false } }), false);
  assert.equal(await command.authorize(request, { sender: f.sender }), true);
  await command.execute(request, { sender: f.sender });
  assert.equal(f.source.effects.length, 1);
});


test("flourish speed converts ten feet to the actor's metric movement units", async () => {
  const f = setup();
  f.source.system = { attributes: { movement: { walk: 9, units: "m" } } };
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  await f.service.grantBladeFlourishSpeed({ operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed }, { sender: f.sender });
  assert.equal(f.source.effects[0].changes[0].value, "3");
});


test("flourish speed asks for Attack action confirmation and ignores bonus or reaction attacks", async () => {
  const f = setup(), calls = [];
  f.sourceToken.object = { document: f.sourceToken };
  f.service.options.confirmBladeAttackAction = async () => { calls.push("confirm"); return true; };
  f.service.moduleApi.socketCommandBus = { async request(_command, payload) { calls.push(payload); return { applied: true }; } };
  const workflow = { actor: f.source, item: f.weapon, token: f.sourceToken.object, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), async performThrottledUpdate() { calls.push("flush"); } };
  await f.service.applyMidiBladeFlourishPreAttack(workflow);
  assert.equal(workflow.rebreyaBladeFlourishAttackAction, true);
  assert.equal(calls[0], "confirm"); assert.equal(calls[1], "flush"); assert.equal(calls[2].actionConfirmed, true);
  calls.length = 0;
  await f.service.applyMidiBladeFlourishPreAttack({ ...workflow, itemUsesBonusAction: true });
  await f.service.applyMidiBladeFlourishPreAttack({ ...workflow, itemUsesReaction: true });
  assert.deepEqual(calls, []);
});


test("removing a combatant clears its temporary flourish effects", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  await f.service.grantBladeFlourishSpeed({ operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed }, { sender: f.sender });
  await f.service.handleBladeFlourishCombatantRemoved({ actor: f.source, token: f.sourceToken, parent: game.combat });
  assert.equal(f.source.effects.length, 0);
});


test("removing another token of the same actor does not remove this token's flourish", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  await f.service.grantBladeFlourishSpeed({ operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed }, { sender: f.sender });
  const otherToken = { uuid: "Scene.scene.Token.other" };
  await f.service.handleBladeFlourishCombatantRemoved({ actor: f.source, token: otherToken, parent: game.combat });
  assert.equal(f.source.effects.length, 1);
});


test("declining Attack action confirmation never grants speed or marks the attack", async () => {
  const f = setup(); let requested = false;
  f.service.options.confirmBladeAttackAction = async () => false;
  f.service.moduleApi.socketCommandBus = { async request() { requested = true; } };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), async performThrottledUpdate() { assert.fail("must not flush"); } };
  await f.service.applyMidiBladeFlourishPreAttack(workflow);
  assert.equal(requested, false);
  assert.equal(workflow.rebreyaBladeFlourishAttackAction, false);
});


test("Attack action remains confirmed when the speed request loses its response", async () => {
  const f = setup();
  f.service.options.confirmBladeAttackAction = async () => true;
  f.service.moduleApi.socketCommandBus = { async request() { throw new Error("lost response"); } };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), async performThrottledUpdate() {} };
  await assert.rejects(f.service.applyMidiBladeFlourishPreAttack(workflow), /lost response/u);
  assert.equal(workflow.rebreyaBladeFlourishAttackAction, true);
});


test("a confirmed weapon hit offers a flourish and uses the selected target and damage type", async () => {
  const f = setup(); let submitted;
  f.service.options.promptBladeFlourish = async choices => { assert.equal(choices.hitTargets.length, 1); return { mode: "defensive", targetTokenUuid: f.targetToken.uuid, secondaryTokenUuid: "", useMaster: false }; };
  f.service.performBladeFlourish = async (_workflow, payload) => { submitted = payload; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(submitted.targetTokenUuid, f.targetToken.uuid);
  assert.equal(submitted.damageType, "piercing");
  assert.equal(submitted.mode, "defensive");
});


test("a missed or unconfirmed attack never opens the flourish prompt", async () => {
  const f = setup(); let prompts = 0;
  f.service.options.promptBladeFlourish = async () => { prompts++; return null; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set(), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  workflow.hitTargets.add({ document: f.targetToken }); workflow.rebreyaBladeFlourishAttackAction = false;
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(prompts, 0);
});


test("flourish dialog escapes target names and submits the chosen defensive option", async () => {
  const f = setup(), previous = globalThis.foundry; let submitted, html;
  f.targetToken.name = '<img src=x onerror="bad()">';
  globalThis.foundry = { applications: { api: { DialogV2: { async wait(config) {
    html = config.content;
    return config.buttons.find(button => button.action === "defensive").callback(null, { form: { elements: {
      namedItem(name) { return name === "target" ? { value: f.targetToken.uuid } : null; }
    } } });
  } } } } };
  try {
    f.service.performBladeFlourish = async (_workflow, payload) => { submitted = payload; };
    const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
      chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
      hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
    await f.service.applyMidiBladeFlourishDamage(workflow);
    assert.doesNotMatch(html, /<img src=x/u);
    assert.match(html, /&lt;img/u);
    assert.equal(submitted.mode, "defensive");
  } finally { globalThis.foundry = previous; }
});


test("repeated damage-complete hooks share one pending choice", async () => {
  const f = setup(); let prompts = 0, release;
  f.service.options.promptBladeFlourish = async () => { prompts++; return new Promise(resolve => { release = resolve; }); };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  const first = f.service.applyMidiBladeFlourishDamage(workflow);
  const second = f.service.applyMidiBladeFlourishDamage(workflow);
  release(null); await Promise.all([first, second]);
  assert.equal(prompts, 1);
});


test("critical flourish uses the original inspiration die for defense, not the doubled damage total", async () => {
  const f = setup();
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.isCritical = true;
  f.service.options.rollBladeFlourish = async (formula, type, actor, { critical }) => {
    assert.equal(critical, true);
    return { total: 9, dice: [{ results: [{ result: 4 }, { result: 5 }] }], toJSON() { return { total: 9, options: { type } }; } };
  };
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.effectTotal, 4);
  game.messages.get("attack-1").flags["midi-qol"].bonusDamageRolls = [{ total: 9, options: {
    rebreyaBladeFlourishOperationId: "attack-1", type: "piercing", properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]
  } }];
  await f.service.commitBladeFlourish(f.payload, { sender: f.sender });
  assert.equal(f.source.effects[0].changes[0].value, "4");
});


test("an unconfirmed critical damage flag never spends inspiration", async () => {
  const f = setup(); let prompted = false;
  f.service.options.promptBladeFlourish = async () => { prompted = true; return { mode: "defensive", targetTokenUuid: f.targetToken.uuid }; };
  f.service.performBladeFlourish = async () => assert.fail("unconfirmed critical damage must be handled manually");
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true, isCritical: true,
    hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(prompted, true);
  assert.equal(f.item.system.uses.spent, 1);
});

test("manual flourish remains available when Midi has not confirmed the critical damage flag", async () => {
  const f = setup(); let submitted;
  f.service.options.promptBladeFlourish = async () => ({ mode: "mobile", targetTokenUuid: f.targetToken.uuid });
  f.service.performBladeFlourish = async (_workflow, payload) => { submitted = payload; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true, isCritical: true,
    hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(submitted?.mode, "mobile");
});


test("a custom complex die formula is never silently changed on a critical hit", async () => {
  const f = setup(); f.item.system.formula = "1d8r1 + 2";
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.isCritical = true;
  await assert.rejects(f.service.reserveBladeFlourish(f.payload, { sender: f.sender }), /вручную/u);
  assert.equal(f.item.system.uses.spent, 1);
});


test("critical flourish preserves a multi-die authored formula and its flat modifier", async () => {
  const f = setup(); f.item.system.formula = "2d6 + 2";
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.isCritical = true;
  f.service.options.rollBladeFlourish = async formula => {
    assert.equal(formula, "2d6 + 2");
    return { total: 14, dice: [{ results: [{ result: 1 }, { result: 2 }, { result: 4 }, { result: 5 }] }], toJSON() { return { total: 14 }; } };
  };
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.effectTotal, 5);
});


test("critical flourish respects authored keep-highest dice and modifier for its effect", async () => {
  const f = setup(); f.item.system.formula = "2d6kh1 + 2";
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.isCritical = true;
  f.service.options.rollBladeFlourish = async () => ({ total: 8, dice: [{ results: [{ result: 1 }, { result: 5 }, { result: 6 }, { result: 2 }] }], toJSON() { return { total: 8 }; } });
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.effectTotal, 7);
});


test("reconciliation removes flourish effects after their combat was deleted", async () => {
  const f = setup();
  const { operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed } = f.payload;
  await f.service.grantBladeFlourishSpeed({ operationId, featureItemUuid, weaponItemUuid, sourceTokenUuid, combatId, round, turn, actionConfirmed }, { sender: f.sender });
  game.combats = { get: () => null };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(f.source.effects.length, 0);
});


test("defensive flourish follows the source token if initiative order changes", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.get("attack-1").flags["midi-qol"].bonusDamageRolls = [{ total: 5, options: {
    rebreyaBladeFlourishOperationId: "attack-1", type: "piercing", properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]
  } }];
  await f.service.commitBladeFlourish(f.payload, { sender: f.sender });
  game.combat.round = 4; game.combat.turn = 1;
  game.combat.turns = [{ token: { uuid: "other-0" } }, { token: { uuid: "other-1" } }, { token: f.sourceToken }];
  game.combat.combatants = [{ actor: f.source }];
  await f.service.handleBladeFlourishCombatTurn(game.combat);
  assert.equal(f.source.effects.length, 1);
  game.combat.turn = 2;
  await f.service.handleBladeFlourishCombatTurn(game.combat);
  assert.equal(f.source.effects.length, 0);
});


test("critical flourish does not repeat weapon-only critical bonus dice", async () => {
  const f = setup();
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options = { type: "piercing", properties: ["mgc", "sil"], isCritical: true,
    critical: { multiplier: 3, bonusDice: 2 } };
  f.service.options.rollBladeFlourish = async (_formula, _type, _actor, { criticalOptions }) => {
    assert.equal(criticalOptions.multiplier, 3); assert.equal(criticalOptions.bonusDice, undefined);
    return { total: 12, dice: [{ results: [{ result: 4 }, { result: 4 }, { result: 4 }] }], toJSON() { return { total: 12 }; } };
  };
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
});


test("GM can cancel a recovered reservation only while no bonus damage was attached", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.combats = { get: id => id === "combat" ? game.combat : null };
  f.service.options.promptBladeRecovery = async ({ canCancel }) => { assert.equal(canCancel, true); return "cancel"; };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(f.item.system.uses.spent, 1);
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.status, "cancelled");
});

test("recovery never refunds after the bonus die has reached the attack card", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.get("attack-1").flags["midi-qol"].bonusDamageRolls = [{ total: 5, options: { rebreyaBladeFlourishOperationId: "attack-1" } }];
  game.combats = { get: id => id === "combat" ? game.combat : null };
  f.service.options.promptBladeRecovery = async ({ canCancel }) => { assert.equal(canCancel, false); return "cancel"; };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(f.item.system.uses.spent, 2);
  assert.equal(f.item.flags["rebreya-main"].bladeFlourish.status, "reserved");
});


test("a deleted attack card cannot be used as proof that a die was never attached", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.delete("attack-1");
  await assert.rejects(f.service.cancelBladeFlourish(f.payload, { sender: f.sender }), /проверка|карточк/u);
  assert.equal(f.item.system.uses.spent, 2);
  game.combats = { get: () => game.combat };
  let canCancel;
  f.service.options.promptBladeRecovery = async details => { canCancel = details.canCancel; return "cancel"; };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(canCancel, false);
  assert.equal(f.item.system.uses.spent, 2);
});


test("recovery does not race an active remote player's ongoing workflow", async () => {
  const f = setup();
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.get("attack-1").author = { id: "remote-owner", active: true };
  game.combats = { get: () => game.combat };
  let prompts = 0; f.service.options.promptBladeRecovery = async () => { prompts++; return "cancel"; };
  await f.service.reconcileBladeFlourishEffects([f.source]);
  assert.equal(prompts, 0); assert.equal(f.item.system.uses.spent, 2);
});


test("reopening the same attack can resume its reserved flourish without another choice", async () => {
  const f = setup(); await f.service.reserveBladeFlourish(f.payload, { sender: f.sender }); let resumed;
  f.item.system.uses.value = 0;
  f.service.options.promptBladeFlourish = async () => { assert.fail("must not prompt again"); };
  f.service.performBladeFlourish = async (_workflow, payload) => { resumed = payload; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.deepEqual(resumed, f.payload);
});


test("flourish commit refuses an attack whose damage properties changed after reservation", async () => {
  const f = setup(); await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  game.messages.get("attack-1").flags["midi-qol"].bonusDamageRolls = [{ total: 5, options: {
    rebreyaBladeFlourishOperationId: "attack-1", type: "piercing", properties: ["mgc", "sil", "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target"]
  } }];
  game.messages.get("attack-1").flags["midi-qol"].damageRolls[0].options.properties = [];
  await assert.rejects(f.service.commitBladeFlourish(f.payload, { sender: f.sender }), /изменил|подтверж/u);
  assert.equal(f.source.effects.length, 0);
});


test("flourish serializes nested Foundry roll terms through their JSON representation", async () => {
  const f = setup();
  f.service.options.rollBladeFlourish = async () => ({ total: 5, toJSON() { return { total: 5, dice: [{ toJSON() { return { faces: 8, result: 5 }; } }] }; } });
  await f.service.reserveBladeFlourish(f.payload, { sender: f.sender });
  assert.deepEqual(f.item.flags["rebreya-main"].bladeFlourish.roll.dice, [{ faces: 8, result: 5 }]);
});


test("multi-target Midi reactions never see an incorrect automatic flourish bonus", async () => {
  const f = setup(), other = { uuid: "Scene.scene.Token.other", documentName: "Token", actor: { uuid: "Actor.other" } }; let prompted = false;
  f.service.options.promptBladeFlourish = async () => { prompted = true; return { mode: "defensive", targetTokenUuid: f.targetToken.uuid }; };
  f.service.performBladeFlourish = async () => assert.fail("multi-target defensive damage must be handled manually");
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set([{ document: f.targetToken }, { document: other }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(prompted, true); assert.equal(f.item.system.uses.spent, 1);
});

test("manual flourish is offered even when the weapon attack hits several targets", async () => {
  const f = setup(), other = { uuid: "Scene.scene.Token.other", documentName: "Token", actor: { uuid: "Actor.other" } }; let submitted;
  f.service.options.promptBladeFlourish = async () => ({ mode: "slashing", targetTokenUuid: f.targetToken.uuid });
  f.service.performBladeFlourish = async (_workflow, payload) => { submitted = payload; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set([{ document: f.targetToken }, { document: other }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(submitted?.mode, "slashing");
});


test("marked flourish damage is calculated only for its chosen target", () => {
  const f = setup();
  const marker = "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target";
  const base = { value: 8, type: "piercing", properties: new Set(["mgc"]) };
  const bonus = { value: 5, type: "piercing", properties: new Set(["mgc", marker]) };
  const otherDamage = [base, bonus];
  f.service.applyBladeFlourishPreCalculateDamage({ uuid: "Actor.other" }, otherDamage, { midi: { targetUuid: "Scene.scene.Token.other" } });
  assert.deepEqual(otherDamage, [base]);
  const chosenDamage = [base, bonus];
  f.service.applyBladeFlourishPreCalculateDamage(f.target, chosenDamage, { midi: { targetUuid: f.targetToken.uuid } });
  assert.equal(chosenDamage.length, 1); assert.equal(chosenDamage[0].value, 13);
  const manualOther = [base, bonus];
  f.service.applyBladeFlourishPreCalculateDamage({ uuid: "Actor.other" }, manualOther, {});
  assert.deepEqual(manualOther, [base]);
});


test("linked tokens of the same actor do not receive ambiguous target-specific flourish damage", async () => {
  const f = setup(), other = { uuid: "Scene.scene.Token.other", documentName: "Token", actor: f.target }; let prompted = false;
  f.service.options.promptBladeFlourish = async () => { prompted = true; return { mode: "defensive", targetTokenUuid: f.targetToken.uuid }; };
  f.service.performBladeFlourish = async () => assert.fail("ambiguous damage must be handled manually");
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), rebreyaBladeFlourishAttackAction: true,
    hitTargets: new Set([{ document: f.targetToken }, { document: other }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(prompted, true); assert.equal(f.item.system.uses.spent, 1);
});


test("flourish cannot substitute a different damage type from the confirmed attack", async () => {
  const f = setup();
  await assert.rejects(f.service.reserveBladeFlourish({ ...f.payload, damageType: "force" }, { sender: f.sender }), /тип урона/u);
  assert.equal(f.item.system.uses.spent, 1); assert.equal(f.rolls, 0);
});


test("a failed GM commit aborts Midi after the bonus roll was attached", async () => {
  const f = setup();
  const workflow = { chatCard: { id: f.payload.operationId }, async performThrottledUpdate() {} };
  f.service.moduleApi.socketCommandBus = { async request(_command, request) {
    if (request.phase === "reserve") return { roll: { total: 5 }, targetActorUuid: f.target.uuid };
    throw new Error("commit response lost");
  } };
  f.service.attachBladeFlourishRoll = async () => {};
  await assert.rejects(f.service.performBladeFlourish(workflow, f.payload), /commit response lost/u);
  assert.equal(workflow.aborted, true);
});

test("an existing flourish die must match its target, type, and weapon properties", async () => {
  const f = setup();
  const workflow = { chatCard: {}, damageRolls: [{ options: { properties: ["mgc"] } }],
    bonusDamageRolls: [{ total: 5, options: { rebreyaBladeFlourishOperationId: "attack-1", type: "force", properties: ["mgc"] } }],
    async performThrottledUpdate() {}, async setDamageRolls() { assert.fail("must not overwrite"); } };
  await assert.rejects(f.service.attachBladeFlourishRoll(workflow, { total: 5, options: { type: "piercing" } }, "attack-1",
    { targetTokenUuid: f.targetToken.uuid, targetActorUuid: f.target.uuid }), /изменился/u);
});


test("selected flourish die merges with matching bonus damage before flat mitigation", () => {
  const f = setup(), marker = "rebreya-blade:attack-1:Scene.scene.Token.target:Actor.target";
  const other = { value: 5, damage: 5, type: "piercing", formula: "1d8", properties: new Set(["mgc"]) };
  const flourish = { value: 5, damage: 5, type: "piercing", formula: "1d8", properties: new Set(["mgc", marker]) };
  const damages = [other, flourish];
  f.service.applyBladeFlourishPreCalculateDamage(f.target, damages, { midi: { targetUuid: f.targetToken.uuid } });
  assert.equal(damages.length, 1); assert.equal(damages[0].value, 10);
  assert.deepEqual([...damages[0].properties], ["mgc"]);
});


test("a restored Midi workflow can confirm its Attack action before choosing flourish", async () => {
  const f = setup(); let confirmed = 0, submitted;
  f.service.options.confirmBladeAttackAction = async () => { confirmed++; return true; };
  f.service.options.promptBladeFlourish = async () => ({ mode: "defensive", targetTokenUuid: f.targetToken.uuid, secondaryTokenUuid: "", useMaster: false });
  f.service.performBladeFlourish = async (_workflow, payload) => { submitted = payload; };
  const workflow = { actor: f.source, item: f.weapon, token: { document: f.sourceToken }, activity: { type: "attack" },
    chatCard: game.messages.get("attack-1"), hitTargets: new Set([{ document: f.targetToken }]), damageRolls: [{ options: { type: "piercing" } }] };
  await f.service.applyMidiBladeFlourishDamage(workflow);
  assert.equal(confirmed, 1); assert.equal(submitted.targetTokenUuid, f.targetToken.uuid);
});
