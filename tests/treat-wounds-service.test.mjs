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
  const documents={async prepare(){return{source,target,tier:{dc:15,bonus:10},dc:15};},async resolve(uuid){return uuid===actor.uuid?actor:source.actor;},async tokens(){return{source,target};},async preview(){return{};}};
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
