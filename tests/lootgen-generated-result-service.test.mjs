import test from "node:test";
import assert from "node:assert/strict";
import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";
import { LootgenGeneratedResultService, isValidPrepareLootgenPayload } from "../scripts/application/lootgen-generated-result-service.js";
import { normalizeLootgenForm } from "../scripts/data/lootgen-generator.js";

const request={operationId:"prepare-one",form:normalizeLootgenForm({enableUpgrades:true})};
const context={requesterId:"requester",authorId:"gm"};
function fixture({failCreate=false,loseCreateAck=false,failActivate=false,loseJournalAck=false}={}) {
  let state={version:1,records:[]};const messages=new Map(),calls={generate:0,create:0,activate:0};
  const journal=new DurableMutationJournal({readState:async()=>structuredClone(state),writeState:async(value)=>{state=structuredClone(value);if(loseJournalAck){loseJournalAck=false;throw new Error("journal ack lost");}}});
  const service=new LootgenGeneratedResultService({journal,
    buildState:async()=>{calls.generate++;return {rows:[{rowId:"row",claimed:false}],coins:{totalCopper:0},spentValue:10};},
    findMessage:async(id)=>structuredClone(messages.get(id)??null),
    createMessage:async(prepared,{messageId})=>{calls.create++;if(failCreate){failCreate=false;throw new Error("create failed");}messages.set(messageId,{id:messageId,trusted:true,state:structuredClone(prepared)});if(loseCreateAck){loseCreateAck=false;throw new Error("ack lost");}},
    activateMessage:async(id)=>{calls.activate++;if(failActivate){failActivate=false;throw new Error("activate failed");}messages.get(id).state.generationReady=true;}
  });
  return {service,journal,messages,calls};
}

test("prepare payload accepts only normalized composed form without arbitrary ItemData",()=>{
  assert.equal(isValidPrepareLootgenPayload({form:request.form}),true);
  assert.equal(isValidPrepareLootgenPayload({form:request.form,itemData:{}}),false);
  assert.equal(isValidPrepareLootgenPayload({form:{...request.form,effects:[]}}),false);
  assert.equal(isValidPrepareLootgenPayload({form:normalizeLootgenForm({enableUpgrades:false})}),false);
});
test("preparation persists one result and exact retry preserves claimed state",async()=>{
  const f=fixture(),first=await f.service.prepare(request,context);
  assert.equal(first.state.generationReady,true);f.messages.get(first.messageId).state.rows[0].claimed=true;
  const retry=await f.service.prepare(request,context);
  assert.equal(retry.messageId,first.messageId);assert.equal(retry.state.rows[0].claimed,true);
  assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);
  const record=await f.journal.find("lootgen-prepare:prepare-one");assert.equal(record.terminal,true);assert.equal(record.preparedState,null);
});
test("create failure resumes saved composition without repeating generation",async()=>{
  const f=fixture({failCreate:true});await assert.rejects(f.service.prepare(request,context),/create failed/u);
  const record=await f.journal.find("lootgen-prepare:prepare-one");assert.equal(record.phase,"prepared");assert.ok(record.preparedState);
  const result=await f.service.prepare(request,context);assert.equal(result.state.generationReady,true);assert.equal(f.calls.generate,1);assert.equal(f.calls.create,2);
});
test("write-then-throw message creation is acknowledged by its persisted identity",async()=>{
  const f=fixture({loseCreateAck:true});const result=await f.service.prepare(request,context);
  assert.equal(result.state.generationReady,true);assert.equal(f.calls.create,1);assert.equal(f.calls.generate,1);
});
test("failed activation resumes after terminal receipt without recreating the message",async()=>{
  const f=fixture({failActivate:true});await assert.rejects(f.service.prepare(request,context),/activate failed/u);
  await f.service.prepare(request,context);assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);assert.equal(f.calls.activate,2);
});
test("deleted completed message and conflicting request cannot trigger a fresh result",async()=>{
  const f=fixture(),result=await f.service.prepare(request,context);
  await assert.rejects(f.service.prepare({...request,form:{...request.form,budgetValue:999}},context),error=>error.code==="lootgen-prepare-conflict");
  f.messages.delete(result.messageId);
  await assert.rejects(f.service.prepare(request,context),error=>error.code==="lootgen-generated-result-missing");
  assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);
});
test("concurrent exact requests join the same operation",async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.service.prepare(request,context),f.service.prepare(request,context)]);
  assert.equal(a.messageId,b.messageId);assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);
});

test("authority loss after preparing data prevents journal and message writes",async()=>{
  const f=fixture();let guards=0;
  await assert.rejects(f.service.prepare(request,{...context,assertAuthority:()=>{if(++guards>1)throw new Error("authority lost");}}),/authority lost/u);
  assert.equal(f.calls.generate,1);assert.equal(f.calls.create,0);
  assert.equal(await f.journal.find("lootgen-prepare:prepare-one"),null);
});
test("an untrusted message at the deterministic ID cannot substitute for a generated result",async()=>{
  const f=fixture(),result=await f.service.prepare(request,context);f.messages.get(result.messageId).trusted=false;
  await assert.rejects(f.service.prepare(request,context),error=>error.code==="lootgen-prepare-conflict");
  assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);
});

test("lost journal acknowledgment is read back before any second generation",async()=>{
  const f=fixture({loseJournalAck:true});const result=await f.service.prepare(request,context);
  assert.equal(result.state.generationReady,true);assert.equal(f.calls.generate,1);assert.equal(f.calls.create,1);
});
