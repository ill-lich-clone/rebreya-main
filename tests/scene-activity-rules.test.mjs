import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSceneActivityState, startSceneActivity, chooseSceneActivity, finishSceneActivity, projectSceneActivityForUser } from "../scripts/data/scene-activity-rules.js";

const gm={senderId:"gm",isGM:true,ownedActorUuids:[],groupMemberActorUuids:["Actor.busy","Actor.player","Actor.other"],now:1000,createSessionId:()=>"scene-1"};
const start={operationId:"start-1",groupActorId:"party",expectedGroupRevision:0,initiatingActorUuid:"Actor.busy",participantActorUuids:["Actor.player","Actor.other"],durationMinutes:10};
const choose={operationId:"choose-1",sessionId:"scene-1",actorUuid:"Actor.player",actionId:"rest",text:"",expectedRevision:1};
const player={...gm,senderId:"player",isGM:false,ownedActorUuids:["Actor.player"]};
const opened=()=>startSceneActivity(normalizeSceneActivityState(null),start,gm).state;

test("scene start, rest selection and finish only change the session envelope",()=>{
  const empty=normalizeSceneActivityState(null),before=structuredClone(empty),a=startSceneActivity(empty,start,gm);
  assert.deepEqual(empty,before);assert.equal(a.state.activeByGroup.party.revision,1);assert.equal(a.state.groupRevisions.party,1);
  const b=chooseSceneActivity(a.state,choose,player);
  assert.equal(b.state.activeByGroup.party.selectionByActor['Actor.player'].actionId,"rest");assert.equal(b.result.revision,2);
  const c=finishSceneActivity(b.state,{operationId:"finish",sessionId:"scene-1",expectedRevision:2,status:"completed"},gm);
  assert.equal(c.state.activeByGroup.party,undefined);assert.equal(c.state.history[0].status,"completed");assert.equal(c.state.groupRevisions.party,2);
  assert.deepEqual(Object.keys(c.state).sort(),["activeByGroup","groupRevisions","history","recentOperations","version"]);
});
test("durable retry precedes revision checks and rejects changed fingerprint or sender",()=>{
  const state=opened(),a=chooseSceneActivity(state,choose,player);
  const replay=chooseSceneActivity(a.state,choose,player);assert.equal(replay.result.replayed,true);assert.equal(replay.result.changed,false);assert.deepEqual(replay.state,a.state);
  assert.throws(()=>chooseSceneActivity(a.state,{...choose,text:"changed"},player),{code:"operation-conflict"});
  assert.throws(()=>chooseSceneActivity(a.state,choose,{...gm,senderId:"other-gm"}),{code:"operation-conflict"});
  const repeatStart=startSceneActivity(a.state,start,gm);assert.equal(repeatStart.result.replayed,true);assert.equal(repeatStart.result.revision,1);
});
for(const [label,patch,context]of [
  ["player start",{},player],["duplicate participants",{participantActorUuids:["Actor.player","Actor.player"]},gm],
  ["busy actor repeated",{participantActorUuids:["Actor.busy"]},gm],["initiator outside group",{initiatingActorUuid:"Actor.stranger"},gm],
  ["participant outside group",{participantActorUuids:["Actor.stranger"]},gm],["duration",{durationMinutes:20},gm],
  ["stale group",{expectedGroupRevision:5},gm],["extra property",{hiddenNote:"secret"},gm]
])test(`scene rejects ${label}`,()=>assert.throws(()=>startSceneActivity(normalizeSceneActivityState(null),{...start,...patch},context)));
for(const [label,patch,context]of [
  ["other actor",{actorUuid:"Actor.other"},player],["busy actor",{actorUuid:"Actor.busy"},gm],
  ["unknown action",{actionId:"shortRest"},player],["empty custom",{actionId:"custom",text:"  "},player],
  ["long text",{text:"x".repeat(501)},player],["stale choice",{expectedRevision:0},player],
  ["departed member",{}, {...player,groupMemberActorUuids:["Actor.busy"]}]
])test(`scene rejects ${label}`,()=>assert.throws(()=>chooseSceneActivity(opened(),{...choose,...patch},context)));
test("simultaneous choices require a fresh revision and preserve the first participant",()=>{
  const a=chooseSceneActivity(opened(),choose,player);
  const other={...choose,operationId:"choose-other",actorUuid:"Actor.other",actionId:"help"};
  assert.throws(()=>chooseSceneActivity(a.state,other,gm),{code:"stale-revision"});
  const b=chooseSceneActivity(a.state,{...other,expectedRevision:2},gm);assert.equal(Object.keys(b.state.activeByGroup.party.selectionByActor).length,2);
  const noop=chooseSceneActivity(b.state,{...choose,operationId:"noop",expectedRevision:3},player);assert.equal(noop.result.changed,false);assert.deepEqual(noop.state,b.state);
});
test("finish retry stays terminal, conflicting close and later choice cannot reopen",()=>{
  const request={operationId:"finish",sessionId:"scene-1",expectedRevision:1,status:"cancelled"};
  const a=finishSceneActivity(opened(),request,gm);
  assert.equal(finishSceneActivity(a.state,request,gm).result.replayed,true);
  assert.throws(()=>finishSceneActivity(a.state,{...request,status:"completed"},gm),{code:"operation-conflict"});
  assert.throws(()=>chooseSceneActivity(a.state,choose,player));assert.throws(()=>finishSceneActivity(opened(),request,player),{code:"unauthorized"});
});
test("bounded history and receipts keep group revision after old start eviction",()=>{
  let state=normalizeSceneActivityState(null);
  for(let i=0;i<140;i++){
    const a=startSceneActivity(state,{...start,operationId:`s-${i}`,expectedGroupRevision:i*2},{...gm,createSessionId:()=>`scene-${i}`});
    state=finishSceneActivity(a.state,{operationId:`f-${i}`,sessionId:`scene-${i}`,expectedRevision:1,status:"completed"},gm).state;
  }
  assert.equal(state.history.length,64);assert.equal(state.recentOperations.length,256);assert.equal(state.groupRevisions.party,280);
  assert.throws(()=>startSceneActivity(state,{...start,operationId:"s-0"},gm),{code:"stale-revision"});
});
test("one session per group, independent groups, projection and literal free text",()=>{
  let state=opened();assert.throws(()=>startSceneActivity(state,{...start,operationId:"another",expectedGroupRevision:1},gm),{code:"already-open"});
  state=startSceneActivity(state,{...start,groupActorId:"second",operationId:"second"},{...gm,createSessionId:()=>"scene-2"}).state;
  state=chooseSceneActivity(state,{...choose,actionId:"custom",text:" <b>Заявка</b> "},player).state;
  const view=projectSceneActivityForUser(state,{...player,groupActorId:"party"});assert.equal(view.session.selectionByActor['Actor.player'].text,"<b>Заявка</b>");
  assert.deepEqual(view.session.selectableActorUuids,["Actor.player"]);assert.equal(view.session.canManage,false);
  assert.equal(projectSceneActivityForUser(state,{...player,ownedActorUuids:[],groupActorId:"party"}).session,null);
  assert.equal(projectSceneActivityForUser(state,{...gm,groupActorId:"party"}).session.canManage,true);
  const closed=finishSceneActivity(state,{operationId:"finish",sessionId:"scene-1",expectedRevision:2,status:"completed"},gm).state;
  assert.equal(projectSceneActivityForUser(closed,{...player,groupActorId:"party"}).session,null);
});

test("busy actor sees the session without a second action and corrupt stored state never resets silently",()=>{
  const state=opened(),view=projectSceneActivityForUser(state,{...player,groupActorId:"party",ownedActorUuids:["Actor.busy"]});
  assert.equal(view.session.initiatingActorUuid,"Actor.busy");assert.deepEqual(view.session.selectableActorUuids,[]);
  for(const change of [s=>s.version=2,s=>s.activeByGroup.party.status="completed",s=>s.groupRevisions.party=-1,s=>s.activeByGroup.party.participantActorUuids.push("Actor.player")]){
    const corrupt=structuredClone(state);change(corrupt);assert.throws(()=>normalizeSceneActivityState(corrupt),{code:"invalid-state"});
  }
});
