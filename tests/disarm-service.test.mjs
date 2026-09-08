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
  return {service,journal,calls,rolls,documents,intent,context,defender,gm,users};
}

test("GM must explicitly reassign the defender with a reason before choosing their save",async()=>{
  const f=fixture();f.gm.active=true;await f.service.start(f.intent,f.context);
  await assert.rejects(f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.gm}),e=>e.code==="unauthorized");
  const intent={operationId:"op",expectedResponderRevision:0,responderUserId:f.gm.id,reason:"Владелец отключился"};
  const result=await f.service.reassignResponder(intent,{...f.context,sender:f.gm});
  assert.equal(result.responderUserId,f.gm.id);assert.equal(result.responderRevision,1);
  assert.equal(result.responderDecision.reason,intent.reason);assert.equal(result.responderDecision.gmId,f.gm.id);
  await assert.rejects(f.service.chooseSave({operationId:"op",saveAbility:"dex"},{...f.context,sender:f.defender}),e=>e.code==="unauthorized");
  await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.gm});
  const replay=await f.service.reassignResponder(intent,{...f.context,sender:f.gm});
  assert.equal(replay.phase,"completed");assert.equal(replay.responderRevision,1);assert.equal(f.calls.save,1);assert.equal(f.calls.attack,1);
});

test("reassignment validates live GM, active target OWNER, reason and revision without rolling",async()=>{
  const f=fixture();f.gm.active=true;f.defender.active=true;await f.service.start(f.intent,f.context);
  const context={...f.context,sender:f.gm},intent={operationId:"op",expectedResponderRevision:0,responderUserId:f.defender.id,reason:"Другой владелец"};
  f.documents.revalidate=async()=>({targetActor:{testUserPermission:user=>user===f.defender}});
  await assert.rejects(f.service.reassignResponder(intent,f.context),e=>e.code==="unauthorized");
  await assert.rejects(f.service.reassignResponder(intent,{...context,sender:{...f.gm}}),e=>e.code==="unauthorized");
  for(const patch of [{reason:" "},{reason:"x".repeat(241)},{expectedResponderRevision:-1},{expectedResponderRevision:0.5}])
    await assert.rejects(f.service.reassignResponder({...intent,...patch},context),e=>e.code==="invalid-responder");
  f.users.set("other",{id:"other",active:true});
  for(const responderUserId of ["other","missing"])
    await assert.rejects(f.service.reassignResponder({...intent,responderUserId},context),e=>e.code==="invalid-responder");
  f.defender.active=false;
  await assert.rejects(f.service.reassignResponder(intent,context),e=>e.code==="invalid-responder");f.defender.active=true;
  await f.service.reassignResponder({...intent,responderUserId:f.gm.id},context);
  await assert.rejects(f.service.reassignResponder(intent,context),e=>e.code==="operation-conflict");
  await f.service.reassignResponder({...intent,expectedResponderRevision:1},context);
  await assert.rejects(f.service.reassignResponder({...intent,responderUserId:f.gm.id},context),e=>e.code==="operation-conflict");
  assert.equal((await f.journal.find("disarm:op")).responderRevision,2);assert.equal(f.calls.save,0);assert.equal(f.calls.attack,1);
});

test("reassignment acknowledgement loss replays one durable decision and does not roll",async()=>{
  const f=fixture();f.gm.active=true;await f.service.start(f.intent,f.context);
  const original=f.journal.checkpoint.bind(f.journal);let writes=0;
  f.journal.checkpoint=async(...args)=>{const result=await original(...args);if(++writes===1)throw Error("lost acknowledgement");return result;};
  const intent={operationId:"op",expectedResponderRevision:0,responderUserId:f.gm.id,reason:"Отключение владельца"},context={...f.context,sender:f.gm};
  await assert.rejects(f.service.reassignResponder(intent,context),/lost acknowledgement/);
  assert.equal((await f.service.reassignResponder(intent,context)).responderRevision,1);
  assert.equal(writes,1);assert.equal(f.calls.save,0);assert.equal(f.calls.attack,1);
});

test("save and reassignment serialize: neither order permits an extra defender roll",async()=>{
  for(const saveFirst of [true,false]){
    const f=fixture();f.gm.active=true;await f.service.start(f.intent,f.context);
    const save=()=>f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
    const reassign=()=>f.service.reassignResponder({operationId:"op",expectedResponderRevision:0,responderUserId:f.gm.id,reason:"Смена владельца"},{...f.context,sender:f.gm});
    const results=await Promise.allSettled(saveFirst?[save(),reassign()]:[reassign(),save()]);
    assert.equal(results[0].status,"fulfilled");assert.equal(results[1].status,"rejected");
    assert.equal(results[1].reason.code,saveFirst?"phase-conflict":"unauthorized");assert.equal(f.calls.save,saveFirst?1:0);
  }
});

test("reassigned OWNER loses the right to roll when live ownership is revoked",async()=>{
  const f=fixture();f.defender.active=true;let allowed=true;await f.service.start(f.intent,f.context);
  f.documents.revalidate=async()=>({targetActor:{testUserPermission:()=>allowed}});
  await f.service.reassignResponder({operationId:"op",expectedResponderRevision:0,responderUserId:f.defender.id,reason:"Подтвердить владельца"},{...f.context,sender:f.gm});
  allowed=false;
  await assert.rejects(f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender}),e=>e.code==="unauthorized");
  assert.equal(f.calls.save,0);assert.equal((await f.journal.find("disarm:op")).phase,"awaiting-save");
});
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

for(const boundary of ["completed-checkpoint","terminal-receipt"]){
  for(const timing of ["before","after"]){
    test(`terminal recovery after ${boundary} ${timing} does not block the next disarm`,async()=>{
      const f=fixture();await f.service.start(f.intent,f.context);
      const method=boundary==="completed-checkpoint"?"checkpoint":"finish",original=f.journal[method].bind(f.journal);let failed=false;
      f.journal[method]=async(...args)=>{
        const matches=method==="finish"||args[2]==="completed";
        if(matches&&!failed){failed=true;if(timing==="before")throw Error("terminal write fault");await original(...args);throw Error("terminal acknowledgement lost");}
        return original(...args);
      };
      await f.service.chooseSave({operationId:"op",saveAbility:"str"},{...f.context,sender:f.defender});
      const recovered=await f.service.resume("op",f.context);
      assert.equal(recovered.phase,"completed");assert.equal(recovered.error,null);
      assert.equal((await f.journal.find("disarm:op")).terminal,true);
      assert.equal(f.calls.attack,1);assert.equal(f.calls.save,1);assert.equal(f.calls.drop,1);
      const next=await f.service.start({...f.intent,operationId:"next"},f.context);
      assert.equal(next.phase,"awaiting-save");
    });
  }
}

for(const phase of ["cancelled","conflict","manual-review"]){
  test(`recovery seals ${phase} without erasing its explanation or repeating game actions`,async()=>{
    const f=fixture();await f.service.start(f.intent,f.context);
    const reason=phase==="cancelled"?null:"Требуется проверка исходного предмета";
    // Simulate a restart between durable final phase and journal.finish.
    await f.journal.checkpoint("disarm:op","awaiting-save",phase,{error:reason});
    const calls={...f.calls};const result=await f.service.resume("op",{...f.context,sender:f.gm});
    assert.equal(result.phase,phase);assert.equal(result.error,reason);
    assert.equal((await f.journal.find("disarm:op")).terminal,true);
    assert.equal(f.calls.attack,calls.attack);assert.equal(f.calls.save,calls.save);assert.equal(f.calls.drop,calls.drop);
    assert.equal((await f.journal.listPending()).length,0);
  });
}
