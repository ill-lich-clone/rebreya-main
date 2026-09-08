import test from "node:test";
import assert from "node:assert/strict";
import { isValidSceneActivityPayload, authorizeSceneActivity, sceneActivityTransportId } from "../scripts/infrastructure/foundry/scene-activity-command-contract.js";
const choose={operationId:"choose",sessionId:"session",actorUuid:"Actor.player",actionId:"rest",text:"",expectedRevision:1};
test("scene wire commands are exact and terminal status comes from the route",()=>{
  assert.equal(isValidSceneActivityPayload("choose",choose),true);
  for(const payload of [{...choose,senderId:"gm"},{...choose,restore:true},{...choose,text:"x".repeat(501)}])assert.equal(isValidSceneActivityPayload("choose",payload),false);
  const finish={operationId:"finish",sessionId:"session",expectedRevision:2};
  assert.equal(isValidSceneActivityPayload("finish",finish),true);assert.equal(isValidSceneActivityPayload("cancel",finish),true);
  assert.equal(isValidSceneActivityPayload("finish",{...finish,status:"open"}),false);
  assert.notEqual(sceneActivityTransportId("finish",finish,"gm"),sceneActivityTransportId("cancel",finish,"gm"));
});
test("scene transport replay identity includes sender, payload and durable operation ID",()=>{
  const first=sceneActivityTransportId("choose",choose,"player");
  assert.equal(first,sceneActivityTransportId("choose",{text:"",expectedRevision:1,operationId:"choose",sessionId:"session",actorUuid:"Actor.player",actionId:"rest"},"player"));
  assert.notEqual(first,sceneActivityTransportId("choose",{...choose,text:"changed"},"player"));assert.notEqual(first,sceneActivityTransportId("choose",choose,"gm"));
});
test("only authenticated GMs can start and close; choose still requires service ownership",()=>{
  const gm={id:"gm",isGM:true},player={id:"player",isGM:false},game={users:new Map([[gm.id,gm],[player.id,player]])};
  for(const action of ["start","finish","cancel"]){assert.equal(authorizeSceneActivity(action,{}, {sender:gm,game}),true);assert.equal(authorizeSceneActivity(action,{}, {sender:player,game}),false);}
  assert.equal(authorizeSceneActivity("choose",choose,{sender:player,game}),true);
  assert.equal(authorizeSceneActivity("choose",choose,{sender:{...player,isGM:true},game}),false);
});
