import assert from "node:assert/strict";
import test from "node:test";
import {createGroupedCombatEffects,inspectGroupedCombatSupport} from "../scripts/integrations/grouped-combat-effects.js";

import { loadInstalledClass, loadInstalledFunction } from "./helpers/installed-combat-providers.mjs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

async function fixture() {
  const log=[];
  const gm={id:"gm",isGM:true};
  const game={version:"14.369",system:{id:"dnd5e",version:"6.0.6"},user:gm,modules:new Map()};
  const actors=Array.from("abcd",id=>({id,uuid:"Actor."+id,appliedEffects:[],items:{contents:[]}}));
  const members=actors.map(actor=>({id:actor.id,actor,token:{id:actor.id,regions:new Set()},recoverCombatUses:async p=>log.push([actor.id,...p])}));
  const groups=[{id:"one",memberIds:["a","b"]},{id:"two",memberIds:["c","d"]}];
  const state={groups,current:{round:1,groupId:"one"},mode:"active"};
  const combat={id:"fight",started:true,round:1,turn:0,current:{round:1,turn:0},combatants:members,turns:members,flags:{"rebreya-main":{groupedCombat:state}}};
  members.get=id=>members.find(c=>c.id===id);
  combat.getCombatantsByActor=actor=>members.filter(c=>c.actor===actor);
  for(const actor of actors)actor.onUpdateEffectDurations=()=>{};
  game._documentsReady=true;game.users={activeGM:{isSelf:true}};
  const root=process.env.REBREYA_FOUNDRY_APP_ROOT ?? fileURLToPath(new URL("../../../../Foundry Virtual Tabletop/resources/app",import.meta.url));
  const registryPath=path.relative(fileURLToPath(new URL("../../",import.meta.url)),path.join(root,"client/helpers/active-effect-registry.mjs"));
  const Registry=await loadInstalledClass(registryPath,"ActiveEffectRegistry",{IterableWeakSet:Set,game,CONFIG:{ActiveEffect:{expiryAction:"update"}},
    foundry:{documents:{async modifyBatch(operations){for(const {parent,updates} of operations)for(const row of updates){
      const e=parent.appliedEffects.find(effect=>effect.id===row._id);assert.ok(row.duration.expired);await e.update({"duration.expired":true});
    }}}}});
  const registry=new Registry();
  class Effect {
    isExpiryEvent(event){return !this.duration.expiry || this.duration.expiry===event;}
    _prepareCombatBasedDuration(d,ctx){return Object.assign(d,{remaining:d.value-(ctx.round-this.start.round)*members.length-(ctx.turn-this.start.turn)});}
    updateDuration(ctx){const d=this.duration;
      if(d.units==="turns")return this._prepareCombatBasedDuration(d,ctx);
      d.remaining=Number.isFinite(d.value)?d.value-(ctx.round-this.start.round):Infinity;return d;}
  }
  const Hooks={events:{updateCombat:[],combatTurn:[],combatRound:[]}};
  const api=createGroupedCombatEffects({gameProvider:()=>game,Hooks,
    EffectClass:Effect,effectRegistry:()=>registry,DAE:{daeMacro(){}},
    effectmacro:{utils:{callMacro(){},getExecutor(){return gm;},hasMacro(){return false;}}},
    socketlib:{registerModule:()=>({register(){}})},
    MidiQOL:{doOverTimeEffect:async(a,e,start)=>log.push(["ot",a.id,e.id,start]),getItemFromEffectOrigin(){},
      socket:()=>({executeAsUser:async()=>{}}),playerForActor:()=>gm}});
  api.installNativeGuards();
  const run=async(kind,group,round,ids=groups.find(g=>g.id===group)?.memberIds??["a","b","c","d"])=>{
    state.executionPosition={round,groupId:group??state.groups[0].id};
    const steps=api.plan(combat,{kind,round,groupId:group,memberIds:ids},state);for(const step of steps)await step.run();return steps;
  };
  function effect(actor,id,expiry,value=null,units="rounds",source=actor){
    const e={id,_id:id,uuid:actor.uuid+".ActiveEffect."+id,actor,parent:actor,active:true,isExpiryTrackable:true,start:{combat,round:1,turn:0,combatant:actor.id},
      flags:{},system:{changes:[]},duration:{value,units,expiry,expired:false,remaining:Infinity},getSourceActor:()=>source,
      async update(data){assert.equal(data["duration.expired"],true);this.duration.expired=true;this.isExpiryTrackable=false;log.push(["expired",id]);}};
    Object.setPrototypeOf(e,Effect.prototype);actor.appliedEffects.push(e);registry.add(e);return e;
  }
  return {registry,gm,game,actors,members,groups,state,combat,Hooks,api,run,effect,log};
}
test("v14 preflight recognises the actual DAE/MIDI/effectmacro hooks and refuses an unknown version or missing guard",async()=>{
  const h=await fixture();
  const expirePerTurnBonusActions=await loadInstalledFunction("midi-qol/midi-qol.js","expirePerTurnBonusActions");
  const updateCombat=await loadInstalledFunction("effectmacro/main.mjs","updateCombat");
  const {readFile}=await import("node:fs/promises");
  const registered=await readFile(new URL("../../dae/module/specialDurations.js",import.meta.url),"utf8");
  const callback=registered.match(/Hooks.on\("updateCombat", (async \([^]*?processMacroRepeats\(combat, update, options\);\s*\})\);/u)?.[1];
  assert.ok(callback,"installed DAE updateCombat no longer delegates to processMacroRepeats");
  const dae=vm.runInNewContext(callback);
  for(const [id,version] of [["dae","14.6.6"],["midi-qol","14.6.8"],["effectmacro","14.0.1"]])h.game.modules.set(id,{active:true,version});
  h.Hooks.events.updateCombat.push({fn:dae},{fn:updateCombat});
  h.Hooks.events.combatRound.push({fn:expirePerTurnBonusActions});h.Hooks.events.combatTurn.push({fn:expirePerTurnBonusActions});
  assert.equal(inspectGroupedCombatSupport({game:h.game,Hooks:h.Hooks}).supported,true);
  assert.equal(h.api.inspect().supported,true);
  const scene={regions:[{behaviors:[{type:"midi-qol.regionActivity",system:{sourceActorUuid:h.actors[1].uuid,moveDistance:10}}]}]};
  assert.equal(h.api.inspect(scene,[h.actors[0]]).supported,true);
  assert.ok(h.api.inspect(scene,[h.actors[1]]).issues.includes("midi-moving-region"));
  for(const record of h.Hooks.events.updateCombat)assert.equal(await record.fn(h.combat,{turn:1},{}),undefined);
  h.Hooks.events.updateCombat.shift();assert.equal(inspectGroupedCombatSupport({game:h.game,Hooks:h.Hooks}).supported,false);
  h.game.modules.set("times-up",{active:true,version:"13.1.9"});assert.ok(inspectGroupedCombatSupport({game:h.game,Hooks:h.Hooks}).issues.some(x=>x.includes("times-up")));
});
test("grouped v14 phase expires each source/target effect at its logical edge once, including non-representatives",async()=>{
  const h=await fixture();
  h.effect(h.actors[3],"sourceB","sourceEnd",null,"seconds",h.actors[1]);
  h.effect(h.actors[3],"d-start","targetStart");
  h.effect(h.actors[3],"two-turns","turnStart",2,"turns");
  h.effect(h.actors[3],"round","roundStart",1);
  const overtime=h.effect(h.actors[3],"overtime",null);overtime.isExpiryTrackable=false;h.registry.delete(overtime);overtime.system.changes=[{key:"flags.midi-qol.OverTime.x",value:"turn=start"}];
  await h.run("turn-end","one",1);
  assert.deepEqual(h.log.filter(r=>r[0]==="expired"),[]);
  await h.run("turn-start","two",1);
  assert.deepEqual(h.log.filter(r=>r[0]==="expired"),[["expired","d-start"]]);
  assert.ok(h.log.some(r=>r.join()==="ot,d,overtime,true"));
  await h.run("round-start",null,2);
  await h.run("turn-end","one",2);
  await h.run("turn-start","two",2);await h.run("turn-start","two",2);
  assert.deepEqual(h.log.filter(r=>r[0]==="expired").map(r=>r[1]).sort(),["d-start","round","sourceB","two-turns"]);
  assert.ok(h.log.some(r=>r.join()==="d,round"));
});
test("v14 phase notifies all member regions with actual member turn context rather than only the representative",async()=>{
  const h=await fixture();
  for(const c of h.members)c.token.regions.add({uuid:"Scene.map.Region.zone",_triggerEvent:async(name,ctx)=>h.log.push([name,ctx.combatant.id,ctx.turn])});
  await h.run("turn-start","one",1);
  assert.deepEqual(h.log.filter(r=>r[0]==="tokenTurnStart"),[["tokenTurnStart","a",0],["tokenTurnStart","b",1]]);
});

test("v14 Midi optional recovery belongs to its selected actor and phase",async()=>{
  const h=await fixture();
  const actor=h.actors[1];
  const effect=h.effect(actor,"feature",null);h.registry.delete(effect);
  effect.system.changes=["turn","each-turn","each-round"].map(period=>({key:`flags.midi-qol.optional.${period}.countAlt`,value:period}));
  const used=new Set(["optional.turn.used","optional.each-turn.used","optional.each-round.used"]);
  actor.getFlag=(namespace,path)=>namespace==="midi-qol" && used.has(path);
  actor.unsetFlag=async(_,path)=>{used.delete(path);h.log.push(["reset",path]);};
  await h.run("turn-start","two",1);
  assert.equal(used.size,3);
  await h.run("each-turn","one",1,h.members.map(c=>c.id));
  await h.run("turn-start","one",1);await h.run("turn-start","one",1);
  assert.deepEqual([...used],["optional.each-round.used"]);
  await h.run("round-start",null,2);
  assert.deepEqual(h.log.filter(r=>r[0]==="reset").map(r=>r[1]),["optional.each-turn.used","optional.turn.used","optional.each-round.used"]);
});
