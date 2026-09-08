import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
class App {constructor(){this.rendered=false;this.renders=0;}async render(){this.rendered=true;this.renders++;return this;}async close(){this.rendered=false;}async _onRender(){}}
let ids=0;
globalThis.foundry={applications:{api:{ApplicationV2:App,HandlebarsApplicationMixin:Base=>Base}},utils:{randomID:()=>`op-${++ids}`}};
const { SceneActivityApp }=await import("../scripts/ui/scene-activity-app.js");
const view=()=>({groupActorId:"party",groupName:"Группа",groupRevision:1,canManage:false,members:[{uuid:"Actor.busy",name:"Занятый"},{uuid:"Actor.player",name:"<Игрок>"}],groups:[],
  session:{sessionId:"scene",revision:1,initiatingActorUuid:"Actor.busy",participantActorUuids:["Actor.player"],selectionByActor:{},selectableActorUuids:["Actor.player"],canManage:false}});
test("remote choices preserve draft and do not rerender the writing controls",async()=>{
  const app=new SceneActivityApp({},view());await app.reopen();app.setDraft("Actor.player",{actionId:"custom",text:"Моя заявка"});
  const next=view();next.session.revision=2;next.session.selectionByActor['Actor.player']={actionId:"help",text:"Из другого окна"};await app.applySnapshot(next);
  assert.equal(app.renders,1);assert.equal((await app._prepareContext()).draft.text,"Моя заявка");
});
test("transport retry keeps the exact request; stale preserves text until another deliberate submit",async()=>{
  const calls=[];let mode="transport";const api={chooseSceneActivity:async payload=>{calls.push(structuredClone(payload));if(mode!=="ok")throw Object.assign(new Error(mode),{code:mode});},refreshSceneActivityApps:async()=>{}};
  const app=new SceneActivityApp(api,view());app.setDraft("Actor.player",{actionId:"custom",text:"Черновик"});
  assert.equal(await app.submitChoice(),false);const next=view();next.session.revision=2;await app.applySnapshot(next);
  mode="stale-revision";assert.equal(await app.submitChoice(),false);assert.deepEqual(calls[0],calls[1]);
  mode="ok";assert.equal(await app.submitChoice(),true);assert.notEqual(calls[1].operationId,calls[2].operationId);assert.equal(calls[2].expectedRevision,2);assert.equal(calls[2].text,"Черновик");
});
test("close collapses an active scene; reopen reuses draft, dispose only removes its own local app",async()=>{
  let closed=0;const app=new SceneActivityApp({},view(),{onClosed:()=>closed++});await app.reopen();app.setDraft("Actor.player",{actionId:"inspect",text:"Осмотр"});
  await app.close();assert.equal(app.collapsed,true);assert.equal(closed,0);await app.reopen();assert.equal((await app._prepareContext()).draft.text,"Осмотр");
  await app.dispose();assert.equal(closed,1);assert.equal(app.disposed,true);
});
test("busy owner has no second action; setup excludes initiator and template has no resource controls",async()=>{
  const busy=view();busy.session.selectableActorUuids=[];const app=new SceneActivityApp({},busy);assert.equal((await app._prepareContext()).canChoose,false);
  const setup=new SceneActivityApp({}, {...view(),canManage:true,session:null});const context=await setup._prepareContext();assert.equal(context.initiatingActorUuid,"Actor.busy");assert.deepEqual(context.participants.map(p=>p.uuid),["Actor.player"]);
  const template=await readFile(new URL('../templates/scene-activity-app.hbs',import.meta.url),'utf8');assert.doesNotMatch(template,/\{\{\{|shortRest|rollHitDie|requestFullscreen|countdown/u);assert.match(template,/У вас есть 10 минут/u);
});

test("terminal disposal during rendering cannot leave a late ghost overlay",async()=>{
  const app=new SceneActivityApp({},view());let release;
  app.render=async()=>{await new Promise(resolve=>{release=resolve;});app.rendered=true;return app;};
  const opening=app.reopen();await app.dispose();release();await opening;assert.equal(app.rendered,false);
});
