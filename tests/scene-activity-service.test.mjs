import test from "node:test";
import assert from "node:assert/strict";
import { SceneActivityService } from "../scripts/application/scene-activity-service.js";
import { normalizeSceneActivityState } from "../scripts/data/scene-activity-rules.js";

const start={operationId:"start",groupActorId:"party",expectedGroupRevision:0,initiatingActorUuid:"Actor.busy",participantActorUuids:["Actor.player","Actor.other"],durationMinutes:10};
const choose={operationId:"choose",sessionId:"session",actorUuid:"Actor.player",actionId:"rest",text:"",expectedRevision:1};
function fixture(){
  let state=normalizeSceneActivityState(null),writes=0,active=true,loseAck=false,failBefore=false,chain=Promise.resolve(),members=["Actor.busy","Actor.player","Actor.other"];
  const repository={readObject:()=>structuredClone(state),mutateObject:(_key,mutator,options)=>{
    const task=chain.catch(()=>{}).then(async()=>{if(!active)throw new Error("no active GM");const next=structuredClone(state),result=await mutator(next);
      if(!options.shouldCommit(result,next))return result;if(failBefore)throw new Error("write unavailable");
      state=next;writes++;if(loseAck){loseAck=false;throw new Error("lost acknowledgement");}return result;});chain=task;return task;
  }};
  const resolveContext=async({sender,groupActorId})=>{assert.equal(groupActorId,"party");return {senderId:sender.id,isGM:sender.isGM,
    groupMemberActorUuids:members,ownedActorUuids:sender.isGM?[]:["Actor.player"],now:1000,createSessionId:()=>"session",
    groupName:"Группа",actorNames:{"Actor.busy":"Занятый","Actor.player":"Игрок","Actor.other":"Другой"}};};
  const create=()=>new SceneActivityService({repository,resolveContext,refresh:()=>{}});
  return {create,repository,get state(){return state;},get writes(){return writes;},set active(v){active=v;},set loseAck(v){loseAck=v;},set failBefore(v){failBefore=v;},set members(v){members=v;}};
}
const gm={id:"gm",isGM:true},player={id:"player",isGM:false};
test("scene service uses one write per transition and reopens after service replacement",async()=>{
  const f=fixture();await f.create().start(start,gm);assert.equal(f.writes,1);
  await f.create().start(start,gm);assert.equal(f.writes,1);
  await f.create().choose(choose,player);assert.equal(f.writes,2);
  await f.create().choose({...choose,operationId:"noop",expectedRevision:2},player);assert.equal(f.writes,2);
  const view=await f.create().getSnapshot({groupActorId:"party",viewer:player});assert.equal(view.session.revision,2);assert.equal(view.members[0].name,"Занятый");
  await f.create().finish({operationId:"finish",sessionId:"session",expectedRevision:2},gm);assert.equal(f.writes,3);
  assert.equal((await f.create().getSnapshot({groupActorId:"party",viewer:player})).session,null);
});
test("write then throw confirms the exact receipt; write failure never auto-retries",async()=>{
  const f=fixture();f.loseAck=true;const result=await f.create().start(start,gm);assert.equal(result.replayed,true);assert.equal(f.writes,1);
  f.failBefore=true;await assert.rejects(f.create().choose(choose,player),/write unavailable/u);assert.equal(f.writes,1);
  f.failBefore=false;await f.create().choose(choose,player);assert.equal(f.writes,2);
});
test("auth and no-GM failures do not write; member removal is checked inside the queue",async()=>{
  const f=fixture();await assert.rejects(f.create().start(start,player),{code:"unauthorized"});assert.equal(f.writes,0);
  f.active=false;await assert.rejects(f.create().start(start,gm),/active GM/u);assert.equal(f.writes,0);f.active=true;
  await f.create().start(start,gm);f.members=["Actor.busy"];
  await assert.rejects(f.create().choose(choose,player),{code:"unauthorized"});assert.equal(f.writes,1);
});
test("concurrent selections serialize; stale actor must re-read and retry deliberately",async()=>{
  const f=fixture(),service=f.create();await service.start(start,gm);
  const second={...choose,actorUuid:"Actor.other",operationId:"other",actionId:"help"};
  const results=await Promise.allSettled([service.choose(choose,player),service.choose(second,gm)]);
  assert.equal(results[0].status,"fulfilled");assert.equal(results[1].reason.code,"stale-revision");assert.equal(f.writes,2);
  await service.choose({...second,expectedRevision:2},gm);assert.equal(f.writes,3);
  await service.cancel({operationId:"cancel",sessionId:"session",expectedRevision:3},gm);assert.equal(f.state.history[0].status,"cancelled");
});

test("two GM starts serialize to one open session",async()=>{
  const f=fixture();const outcomes=await Promise.allSettled([f.create().start(start,gm),f.create().start({...start,operationId:"other-start"},{id:"gm2",isGM:true})]);
  assert.equal(outcomes[0].status,"fulfilled");assert.equal(outcomes[1].reason.code,"stale-revision");assert.equal(f.writes,1);
  assert.equal(Object.keys(f.state.activeByGroup).length,1);
});
