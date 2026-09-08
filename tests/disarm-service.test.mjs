import test from "node:test";
import assert from "node:assert/strict";
import { DisarmService } from "../scripts/combat/disarm-service.js";
import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
function fixture() {
  let state={records:[]}; const journal=new DurableMutationJournal({readState:()=>state,writeState:next=>{state=next;}});
  const calls={attack:0,save:0,drop:0,publish:0};
  const sender={id:"attacker"},defender={id:"defender"},gm={id:"gm",isGM:true}; const users=new Map([sender,defender,gm].map(u=>[u.id,u]));
  const intent={operationId:"op",sourceTokenUuid:"Scene.s.Token.a",targetTokenUuid:"Scene.s.Token.b",weaponItemUuid:"Actor.a.Item.w",targetItemUuid:"Actor.b.Item.i",weaponMode:"melee"};
  const documents={async prepare(){return {attackerSize:"sm",targetSize:"med",heldHands:2,responderUserId:defender.id,attackPlan:{formula:"1d20 + 3 + 2"},sourceName:"A",targetName:"B",itemName:"Blade"};},
    async revalidate(){if(documents.stale)throw Object.assign(new Error("changed"),{code:"stale-item"});return {targetActor:{}};},
    async dropPoints(){return [{x:100,y:200,direction:1}];}};
  const rolls={async attack(){calls.attack++;if(rolls.fail)throw new Error("lost");return {total:17,json:{total:17}};},async save(){calls.save++;return {total:rolls.saveTotal??16,json:{total:rolls.saveTotal??16}};},async direction(){return {total:1,json:{total:1}};}};
  const service=new DisarmService({journal,coordinator:new WorldMutationCoordinator(),documents,rollAdapter:rolls,
    storageCommands:{async dropDisarmedItem(){calls.drop++;return {tokenUuid:"Scene.s.Token.ground"};}},
    publish:async()=>{calls.publish++;},gameProvider:()=>({users,user:gm})});
  const context={sender,assertAuthority(){}};
  return {service,journal,calls,rolls,documents,intent,context,defender,gm};
}
test("one attack, assigned save and one drop; replay does not resolve removed source",async()=>{
  const f=fixture(); const started=await f.service.start(f.intent,f.context);
  assert.equal(started.phase,"awaiting-save"); assert.equal(f.calls.attack,1);
  await f.service.start(f.intent,f.context); assert.equal(f.calls.attack,1);
  const result=await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
  assert.equal(result.phase,"completed"); assert.equal(result.dropped,true); assert.equal(f.calls.drop,1);
  f.documents.stale=true;
  await f.service.start(f.intent,f.context); await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
  assert.equal(f.calls.attack,1);assert.equal(f.calls.save,1);assert.equal(f.calls.drop,1);
  await assert.rejects(f.service.start({...f.intent,weaponMode:"ranged"},f.context),e=>e.code==="operation-conflict");
});
test("successful save does not touch storage and attacker cannot choose defender's save",async()=>{
  const f=fixture();f.rolls.saveTotal=17; await f.service.start(f.intent,f.context);
  await assert.rejects(f.service.chooseSave({operationId:"op",saveAbility:"dex"},f.context),e=>e.code==="unauthorized");
  const result=await f.service.chooseSave({operationId:"op",saveAbility:"dex"},{...f.context,sender:f.defender});
  assert.equal(result.dropped,false);assert.equal(f.calls.drop,0);
});
test("stale held item, pending competing intent and forged sender fail before another roll",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);
  await assert.rejects(f.service.start({...f.intent,operationId:"another"},f.context),e=>e.code==="operation-pending");
  await assert.rejects(f.service.start(f.intent,{...f.context,sender:{id:"attacker",isGM:true}}),e=>e.code==="unauthorized");
  f.documents.stale=true;
  const result=await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
  assert.equal(result.phase,"conflict");assert.equal(f.calls.save,0);assert.equal(f.calls.drop,0);
});
test("ambiguous roll is durable manual review; resume never rerolls",async()=>{
  const f=fixture();f.rolls.fail=true;
  const result=await f.service.start(f.intent,f.context);assert.equal(result.phase,"manual-review");
  await f.service.resume("op",f.context);assert.equal(f.calls.attack,1);assert.equal(f.calls.save,0);
});
test("cancel keeps rolled attack visible; no legal point never debits target",async()=>{
  const f=fixture();await f.service.start(f.intent,f.context);
  const cancelled=await f.service.cancel("op",f.context);assert.equal(cancelled.phase,"cancelled");assert.equal(cancelled.attackTotal,17);assert.equal(f.calls.drop,0);
  const g=fixture();g.documents.dropPoints=async()=>[];await g.service.start(g.intent,g.context);
  const result=await g.service.chooseSave({operationId:"op",saveAbility:"dex"},{...g.context,sender:g.defender});
  assert.equal(result.phase,"manual-review");assert.equal(g.calls.drop,0);
});
test("failed transfer stays visible and resumes the same drop without another save",async()=>{
  const f=fixture(); let failed=true;
  f.service.storageCommands.dropDisarmedItem=async()=>{f.calls.drop++;if(failed){failed=false;throw Error("source debit offline");}return {tokenUuid:"ground"};};
  await f.service.start(f.intent,f.context);
  const pending=await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
  assert.equal(pending.phase,"drop-prepared");assert.match(pending.error,/offline/);
  const done=await f.service.resume("op",f.context);assert.equal(done.phase,"completed");assert.equal(f.calls.attack,1);assert.equal(f.calls.save,1);
});
