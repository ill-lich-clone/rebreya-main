import test from "node:test";
import assert from "node:assert/strict";
import { SceneActivityController } from "../scripts/ui/scene-activity-controller.js";
const view=(revision=1)=>({groupActorId:"party",groupRevision:1,groupName:"Группа",canManage:true,members:[],session:{sessionId:"scene",revision,status:"open",selectableActorUuids:[]}});
function fixture(){let snapshot=view(),created=0;const registry=new Map();
  const api={listSceneActivityGroups:()=>[{id:"party",name:"Группа"}],getSceneActivitySnapshot:async()=>structuredClone(snapshot)};
  const controller=new SceneActivityController({api,registry,createApp:(data,callbacks)=>{created++;return {snapshot:data,collapsed:false,rendered:false,
    async applySnapshot(next){this.snapshot=next;},async reopen(){this.collapsed=false;this.rendered=true;},async dispose(){this.disposed=true;callbacks.onClosed(this);}};}});
  return {controller,api,registry,get created(){return created;},set snapshot(v){snapshot=v;}};
}
test("one overlay per session survives repeated notifications, collapse and reopen",async()=>{
  const f=fixture();await f.controller.refresh();const app=f.registry.get("scene");app.collapsed=true;app.rendered=false;
  f.snapshot=view(2);await f.controller.refresh();assert.equal(f.created,1);assert.equal(app.collapsed,true);assert.equal(app.snapshot.session.revision,2);
  assert.equal(await f.controller.open({groupActorId:"party"}),app);assert.equal(app.collapsed,false);
});
test("out-of-order snapshots cannot overwrite a newer choice or terminal state",async()=>{
  const f=fixture();let resolveOld;f.api.getSceneActivitySnapshot=()=>new Promise(resolve=>{resolveOld=resolve;});
  const old=f.controller.refresh();await Promise.resolve();f.api.getSceneActivitySnapshot=async()=>view(3);await f.controller.refresh();
  resolveOld(view(1));await old;assert.equal(f.registry.get("scene").snapshot.session.revision,3);
  f.api.getSceneActivitySnapshot=async()=>({...view(),groupRevision:2,session:null});await f.controller.refresh();assert.equal(f.registry.size,0);
  f.api.getSceneActivitySnapshot=async()=>view(4);await f.controller.refresh();assert.equal(f.registry.size,0);
});
test("closed stale app cannot delete replacement; terminal while typing disposes the overlay",async()=>{
  const f=fixture();await f.controller.refresh();const old=f.registry.get("scene"),replacement={...old};f.registry.set("scene",replacement);
  await old.dispose();assert.equal(f.registry.get("scene"),replacement);
  f.snapshot={...view(),groupRevision:2,session:null};await f.controller.refresh();assert.equal(replacement.disposed,true);assert.equal(f.registry.size,0);
});
test("setup is GM-only; removed membership closes existing apps without inventing a scene",async()=>{
  const f=fixture();f.snapshot={...view(),session:null};const setup=await f.controller.open({groupActorId:"party"});assert.equal(f.created,1);assert.equal(setup.snapshot.session,null);
  f.api.listSceneActivityGroups=()=>[];await f.controller.refresh();assert.equal(f.registry.size,0);
  await assert.rejects(f.controller.open({groupActorId:"party"}));
  f.api.listSceneActivityGroups=()=>[{id:"party"}];f.snapshot={...view(),canManage:false,session:null};await assert.rejects(f.controller.open({groupActorId:"party"}));
});

test("terminal refresh during an awaited setup close cannot revive the earlier session",async()=>{
  const f=fixture();f.snapshot={...view(),session:null};const setup=await f.controller.open({groupActorId:"party"});
  let release,entered;const closing=new Promise(resolve=>{entered=resolve;});
  const dispose=setup.dispose.bind(setup);setup.dispose=async()=>{entered();await new Promise(resolve=>{release=resolve;});await dispose();};
  f.snapshot=view();const opening=f.controller.refresh();await closing;
  // A newer terminal snapshot arrives while Foundry animates the setup window closed.
  f.snapshot={...view(),groupRevision:2,session:null};const terminal=f.controller.refresh();
  await new Promise(resolve=>setImmediate(resolve));release();await Promise.all([opening,terminal]);
  assert.equal(f.registry.size,0);assert.equal(f.controller.views.get("party").session,null);
});
