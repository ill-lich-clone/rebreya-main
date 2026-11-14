import test from "node:test";
import assert from "node:assert/strict";
import { TreatWoundsService } from "../scripts/application/treat-wounds-service.js";
import { TreatWoundsDnd5eAdapter } from "../scripts/integrations/treat-wounds-dnd5e-adapter.js";
import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
const set=(obj,path,value)=>{const keys=path.split('.');let cursor=obj;for(const key of keys.slice(0,-1))cursor=cursor[key]??={};cursor[keys.at(-1)]=structuredClone(value);};
function fixture(total=15) {
  const sender={id:"player"};let state={records:[]},now=1000,rolls=0,debits=0;
  const game={system:{id:"dnd5e"},users:{get:id=>id===sender.id?sender:null},time:{get worldTime(){return now;}},actors:{contents:[]},scenes:{contents:[]}};
  const actor={uuid:"Actor.target",type:"character",name:"Пациент",flags:{},system:{details:{type:{value:"humanoid"}},attributes:{hp:{value:4,max:100,temp:0},death:{failure:2,success:1}}},effects:[],
    async update(patch){for(const [key,value]of Object.entries(patch))set(this,key,value);},
    async createEmbeddedDocuments(_type,rows){const effects=rows.map((row,i)=>({...structuredClone(row),id:String(i)}));this.effects.push(...effects);return effects;}};
  const source={actor:{uuid:"Actor.healer",name:"Лекарь",testUserPermission:u=>u===sender},uuid:"Scene.s.Token.h",name:"Лекарь"},target={actor,uuid:"Scene.s.Token.t",name:"Пациент"};
  const adapter=new TreatWoundsDnd5eAdapter(); adapter.rollMedicine=async()=>{rolls++;return{total,toJSON:()=>({total})};};adapter.rollResult=async()=>({total:9,toJSON:()=>({total:9})});
  game.actors.contents.push(actor);
  actor.deleteEmbeddedDocuments=async(_type,ids)=>{actor.effects=actor.effects.filter(e=>!ids.includes(e.id));};
  const cards=[];
  const documents={async prepare(intent){return{source,target,tier:{dc:15,bonus:10},dc:15,withoutKit:intent.ignoreMissingKit===true && intent.kitItemUuid===""};},async resolve(uuid){return uuid===actor.uuid?actor:source.actor;},async tokens(){return{source,target};},async preview(){return{};}};
  const journal=new DurableMutationJournal({readState:()=>state,writeState:s=>{state=s;}});
  const inventoryService={async consumeTreatWoundsKitOnce(){debits++;}};
  const service=new TreatWoundsService({journal,coordinator:new WorldMutationCoordinator(),adapter,documents,inventoryService,gameProvider:()=>game,isActiveGm:()=>true,publish:async r=>{cards.push(structuredClone(r));}});
  const intent={operationId:"op",sourceTokenUuid:source.uuid,targetTokenUuid:target.uuid,kitItemUuid:"Actor.healer.Item.k",groupActorId:"",tierDc:15,customDc:null};
  const context={sender,assertAuthority:async()=>{}};
  return{service,actor,intent,context,cards,journal,documents,inventoryService,setNow:v=>now=v,counts:()=>({rolls,debits})};
}
test("success heals19, resets only failures, one-hour effect starts at beginning; continue adds19 once",async()=>{
  const f=fixture();const first=await f.service.start(f.intent,f.context);
  assert.equal(first.amount,19);assert.equal(f.actor.system.attributes.hp.value,23);
  assert.equal(f.actor.system.attributes.death.failure,0);assert.equal(f.actor.system.attributes.death.success,1);
  assert.equal(f.actor.effects[0].duration.seconds,3600);assert.equal(f.actor.effects[0].duration.startTime,1000);
  await f.service.continue({operationId:"op"},f.context);await f.service.continue({operationId:"op"},f.context);
  assert.equal(f.actor.system.attributes.hp.value,42);assert.deepEqual(f.counts(),{rolls:1,debits:1});
  assert.equal(f.cards.at(-1).continued,true);
});
test("treating a zero-HP construct with the automatic dead status restores HP and clears failures",async()=>{
  const f=fixture(); f.actor.system.details.type.value="construct"; f.actor.system.attributes.hp.value=0; f.actor.statuses=new Set(["dead"]);
  await f.service.start(f.intent,f.context);
  assert.equal(f.actor.system.attributes.hp.value,19);assert.equal(f.actor.system.attributes.death.failure,0);assert.equal(f.actor.system.attributes.death.success,1);
});
for(const [total,kind,hp]of [[20,"critical-success",23],[14,"failure",4],[10,"critical-failure",0]])test(`chat records ${kind} and attempt spends kit`,async()=>{
  const f=fixture(total);await f.service.start(f.intent,f.context);
  assert.equal(f.cards.at(-1).outcome.kind,kind);assert.equal(f.actor.system.attributes.hp.value,hp);
  assert.equal(f.counts().debits,1);assert.ok(f.cards.some(c=>c.medicineRoll?.total===total));
  if(total<15)await assert.rejects(f.service.continue({operationId:"op"},f.context));
});
test("concurrent and repeated delivery never rerolls or spends twice; changed intent rejected",async()=>{
  const f=fixture();await Promise.all([f.service.start(f.intent,f.context),f.service.start(f.intent,f.context)]);
  assert.deepEqual(f.counts(),{rolls:1,debits:1});
  await f.service.start(Object.fromEntries(Object.entries(f.intent).reverse()),f.context);
  assert.deepEqual(f.counts(),{rolls:1,debits:1});
  await assert.rejects(f.service.start({...f.intent,tierDc:10},f.context));
});
test("cooldown blocks new operation until exactly start+3600; old continuation invalidated",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);
  f.setNow(4599);await assert.rejects(f.service.start({...f.intent,operationId:"op2"},f.context));
  f.setNow(4600);await f.service.start({...f.intent,operationId:"op2"},f.context);
  await assert.rejects(f.service.continue({operationId:"op"},f.context));
});
test("mutation failure preserves visible roll and resumes without reroll",async()=>{
  const f=fixture();f.inventoryService.consumeTreatWoundsKitOnce=async()=>{throw Error("inventory unavailable");};
  await assert.rejects(f.service.start(f.intent,f.context));
  assert.ok(f.cards.at(-1).medicineRoll);assert.match(f.cards.at(-1).applicationError,/inventory unavailable/);
  f.inventoryService.consumeTreatWoundsKitOnce=async()=>{};
  await f.service.resume({operationId:"op"},f.context);assert.equal(f.counts().rolls,1);assert.equal(f.actor.system.attributes.hp.value,23);
});
test("cancelled roll changes no inventory, effects, HP or chat",async()=>{
  const f=fixture();f.service.adapter.rollMedicine=async()=>null;
  await f.service.start(f.intent,f.context);assert.equal(f.actor.effects.length,0);assert.equal(f.actor.system.attributes.hp.value,4);
  assert.equal(f.cards.length,0);assert.equal(f.counts().debits,0);
});
test("foreign sender cannot resume or continue trusted operation",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);
  await assert.rejects(f.service.continue({operationId:"op"},{...f.context,sender:{id:"attacker"}}));
});
test("resume after continuation cannot overwrite chat with original ten-minute result",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);await f.service.continue({operationId:"op"},f.context);
  await f.service.resume({operationId:"op"},f.context);assert.equal(f.cards.at(-1).continued,true);
});
test("new pending treatment invalidates old continuation before its HP write",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);f.setNow(4600);
  f.inventoryService.consumeTreatWoundsKitOnce=async()=>{throw Error("debit failed");};
  await assert.rejects(f.service.start({...f.intent,operationId:"op2"},f.context));
  await assert.rejects(f.service.continue({operationId:"op"},f.context));
});
test("expired immunity removed exactly on world hour; unrelated effects preserved",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);f.actor.effects.push({id:"unrelated",duration:{startTime:1000,seconds:1}});
  await f.service.cleanupExpiredEffects(4599);assert.equal(f.actor.effects.length,2);
  await f.service.cleanupExpiredEffects(4600);assert.deepEqual(f.actor.effects.map(e=>e.id),["unrelated"]);
  f.service.isActiveGm=()=>false;assert.equal(await f.service.cleanupExpiredEffects(5000),0);
});

test("cleanup continues after exact already-deleted immunity and preserves unrelated errors",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);
  f.actor.effects.push({id:"second",flags:{"rebreya-main":{treatWounds:true}},duration:{startTime:1000,seconds:3600}});
  const calls=[];
  f.actor.deleteEmbeddedDocuments=async(_type,ids)=>{
    calls.push([...ids]);
    if(ids.includes("0"))throw Error('ActiveEffect "0" does not exist!');
    f.actor.effects=f.actor.effects.filter(effect=>!ids.includes(effect.id));
  };
  await assert.doesNotReject(()=>f.service.cleanupExpiredEffects(4600));
  assert.ok(calls.some(ids=>ids.includes("second")));
  assert.equal(f.actor.effects.some(effect=>effect.id==="second"),false);
  const denied=Error("Permission denied");f.actor.deleteEmbeddedDocuments=async()=>{throw denied;};
  await assert.rejects(()=>f.service.cleanupExpiredEffects(4600),error=>error===denied);
  const wrongId=Error('ActiveEffect "foreign" does not exist!');f.actor.deleteEmbeddedDocuments=async()=>{throw wrongId;};
  await assert.rejects(()=>f.service.cleanupExpiredEffects(4600),error=>error===wrongId);
});

test("world-time cleanup tracks off-scene immunities without walking the world again", async () => {
  const f = fixture(), handlers = new Map(), hooks = {on(name, fn) {handlers.set(name, fn);}};
  const emit = (name, ...args) => handlers.get(name)?.(...args);
  let reads = 0, active = false;
  const offScene = {uuid: "Scene.s.Token.t.Actor.npc", effects: [],
    async deleteEmbeddedDocuments(_type, ids) { this.effects = this.effects.filter(e => !ids.includes(e.id)); }};
  const token = {uuid: "Scene.s.Token.t", get actor() {reads++; return offScene;}};
  const game = f.service.gameProvider(); game.scenes.contents.push({tokens: [token]});
  f.service.isActiveGm = () => active;
  const immunity = id => ({id, parent: offScene, flags: {"rebreya-main": {treatWounds: true}}, duration: {startTime: 1000, seconds: 3600}});
  offScene.effects.push(immunity("legacy"));
  f.service.registerExpiryIndex(hooks);
  assert.equal(await f.service.cleanupExpiredEffects(4599), 0);
  active = true;
  assert.equal(await f.service.cleanupExpiredEffects(4599), 0);
  assert.equal(reads, 1);
  assert.equal(await f.service.cleanupExpiredEffects(4600), 1);
  assert.equal(reads, 1);
  const newEffect = immunity("later"); offScene.effects.push(newEffect);
  emit("createActiveEffect", newEffect);
  offScene.deleteEmbeddedDocuments = async () => {throw Error("temporary error");};
  await assert.rejects(f.service.cleanupExpiredEffects(4600), /temporary error/);
  offScene.deleteEmbeddedDocuments = async () => {offScene.effects.length = 0;};
  assert.equal(await f.service.cleanupExpiredEffects(4600), 1);
  assert.equal(reads, 1);
  const imported = {...offScene, uuid: "Scene.new.Token.t.Actor.npc", effects: [immunity("import")]};
  imported.deleteEmbeddedDocuments = async () => {imported.effects.length = 0;};
  emit("createScene", {tokens: [{uuid: "Scene.new.Token.t", actor: imported}]});
  assert.equal(await f.service.cleanupExpiredEffects(4600), 1);
  const replacement = {...offScene, uuid: "Scene.s.Token.t.Actor.other", effects: [immunity("new-actor")]};
  replacement.deleteEmbeddedDocuments = async () => {replacement.effects.length = 0;};
  const stale = immunity("stale"); offScene.effects.push(stale);
  emit("createActiveEffect", stale);
  emit("updateToken", {uuid: token.uuid, actor: replacement}, {actorId: "other"});
  assert.equal(await f.service.cleanupExpiredEffects(4600), 1);
  assert.deepEqual(offScene.effects, [stale], "expired effect of detached actor is not mutated");
  const invalid = {...immunity("invalid"), parent: replacement, duration: {startTime: null, seconds: 3600}};
  replacement.effects.push(invalid);
  emit("updateActiveEffect", invalid);
  assert.equal(await f.service.cleanupExpiredEffects(5000), 0);
  invalid.duration.startTime = 1000;
  emit("updateActiveEffect", invalid);
  assert.equal(await f.service.cleanupExpiredEffects(5000), 1);
  const item = {uuid:"Actor.a.Item.i", documentName:"Item", effects:[immunity("item-effect")],
    async deleteEmbeddedDocuments() {assert.fail("item effects were never part of the cleanup");}};
  emit("createActiveEffect", {...item.effects[0],parent:item});
  const packActor = {uuid:"Compendium.pack.collection.Actor.a", documentName:"Actor", inCompendium:true,
    effects:[immunity("pack-effect")], async deleteEmbeddedDocuments() {assert.fail("compendium actors are outside the world scan");}};
  emit("createActor", packActor);
  emit("createActiveEffect", {...packActor.effects[0],parent:packActor});
  assert.equal(await f.service.cleanupExpiredEffects(5000), 0);
  const transferred = {...replacement, uuid:"Scene.new.Token.new.Actor.a", effects:[immunity("replaced-scene")]};
  transferred.deleteEmbeddedDocuments = async () => {transferred.effects.length = 0;};
  emit("updateScene", {uuid:"Scene.new",tokens:[{uuid:"Scene.new.Token.new",actor:transferred}]}, {tokens:[]});
  assert.equal(await f.service.cleanupExpiredEffects(5000), 1);
  const freshToken = {uuid:"Scene.third.Token.t"};
  const fresh = {...replacement, uuid:"Scene.third.Token.t.Actor.npc",token:freshToken,effects:[],
    async deleteEmbeddedDocuments() {assert.fail("the token has already been deleted");}};
  freshToken.actor = fresh;
  emit("createToken", freshToken);
  const granted = {...immunity("granted"), parent:fresh}; fresh.effects.push(granted);
  emit("createActiveEffect", granted);
  emit("deleteToken", freshToken);
  assert.equal(await f.service.cleanupExpiredEffects(5000), 0);
});

test("native Foundry 14 start time blocks treatment and expires at exactly one hour", async () => {
  const f = fixture(), effect = {id: "native", start: {time: 1000}, duration: {seconds: 3600},
    flags: {"rebreya-main": {treatWounds: true}}};
  f.actor.effects.push(effect); f.setNow(4599);
  await assert.rejects(f.service.start(f.intent, f.context), error => error.code === "cooldown");
  assert.equal(await f.service.cleanupExpiredEffects(4599), 0);
  assert.equal(await f.service.cleanupExpiredEffects(4600), 1);
  assert.equal(f.actor.effects.length, 0);
});
test("journal error just after performed check still publishes exact result and does not reroll",async()=>{
  const f=fixture();const original=f.journal.checkpoint.bind(f.journal);let failed=false;
  f.journal.checkpoint=async(...args)=>{if(args[2]==="medicine-rolled"&&!failed){failed=true;throw Error("checkpoint unavailable");}return original(...args);};
  await assert.rejects(f.service.start(f.intent,f.context));
  assert.equal(f.cards.at(-1).medicineRoll.total,15);
  await f.service.resume({operationId:"op"},f.context);assert.equal(f.counts().rolls,1);assert.equal(f.actor.system.attributes.hp.value,23);
});
test("patient becoming dead while application is pending cannot be revived on resume",async()=>{
  const f=fixture();f.inventoryService.consumeTreatWoundsKitOnce=async()=>{throw Error("debit failed");};
  await assert.rejects(f.service.start(f.intent,f.context));
  f.actor.system.attributes.hp.value=0;f.actor.system.attributes.death.failure=3;f.inventoryService.consumeTreatWoundsKitOnce=async()=>{};
  await assert.rejects(f.service.resume({operationId:"op"},f.context));assert.equal(f.actor.system.attributes.hp.value,0);assert.equal(f.actor.system.attributes.death.failure,3);
});

test("confirmed kitless treatment and recovery never debit a kit",async()=>{
  const f=fixture(); f.intent={...f.intent,kitItemUuid:"",groupActorId:"",ignoreMissingKit:true};
  let fail=true; const apply=f.service.adapter.applyResult.bind(f.service.adapter);
  f.service.adapter.applyResult=async(...args)=>{if(fail){fail=false;throw Error("health unavailable");}return apply(...args);};
  await assert.rejects(f.service.start(f.intent,f.context),/health unavailable/);
  await f.service.resume({operationId:"op"},f.context); await f.service.resume({operationId:"op"},f.context);
  assert.deepEqual(f.counts(),{rolls:1,debits:0});assert.equal(f.actor.system.attributes.hp.value,23);
});

test("a checked bypass with an actual kit still debits it exactly once",async()=>{
 const f=fixture(); f.intent.ignoreMissingKit=true; await f.service.start(f.intent,f.context); await f.service.start(f.intent,f.context);
 assert.deepEqual(f.counts(),{rolls:1,debits:1});
});

for(const [total,kind] of [[20,"critical-success"],[15,"success"],[14,"failure"],[10,"critical-failure"]]) test(`kitless ${kind} preserves its outcome and never debits`,async()=>{
 const f=fixture(total);Object.assign(f.intent,{kitItemUuid:"",groupActorId:"",ignoreMissingKit:true});
 const result=await f.service.start(f.intent,f.context);assert.equal(result.outcome.kind,kind);assert.equal(f.counts().debits,0);
 assert.equal(f.actor.effects.length,1);assert.ok(f.cards.some(card=>card.medicineRoll?.total===total));
 if(result.outcome.canContinue) await f.service.continue({operationId:"op"},f.context);
 assert.equal(f.counts().debits,0);
 await assert.rejects(f.service.start({...f.intent,ignoreMissingKit:false},f.context));
});
