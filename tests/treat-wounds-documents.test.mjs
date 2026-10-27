import test from "node:test";
import assert from "node:assert/strict";
import { TreatWoundsDocuments } from "../scripts/infrastructure/foundry/treat-wounds-documents.js";
import { TreatWoundsDnd5eAdapter } from "../scripts/integrations/treat-wounds-dnd5e-adapter.js";
function fixture(){
 const sender={id:"p"};const character={uuid:"Actor.h",type:"character",system:{details:{level:5},skills:{med:{value:1}},attributes:{hp:{value:10,max:10}}},items:[],testUserPermission:u=>u===sender};
 const kit={uuid:"Actor.g.Item.k",name:"Комплект целителя",system:{quantity:1}};const group={name:"Отряд",items:[kit]};
 const token={uuid:"Scene.s.Token.h",name:"Лекарь",actor:character,parent:{id:"s"}};let allowed=true;
 const groups={getRegistry:()=>({groupsById:{g:{}}}),canManageGroupForUser:(_id,u)=>u===sender&&allowed,resolveForGroup:()=>({groupActor:group})};
 const docs=new TreatWoundsDocuments({adapter:new TreatWoundsDnd5eAdapter(),groupContextService:groups,resolve:async()=>token,gameProvider:()=>({system:{id:"dnd5e"},users:{get:()=>sender}}),canvasProvider:()=>({scene:{id:"s"}})});
 const intent={sourceTokenUuid:token.uuid,targetTokenUuid:token.uuid,kitItemUuid:kit.uuid,groupActorId:"g",tierDc:15,customDc:null};
 return{docs,sender,character,intent,deny:()=>allowed=false};
}
test("group kits available to member healer and full HP self treatment is valid",async()=>{
 const f=fixture();const preview=await f.docs.preview(f.intent,f.sender);assert.equal(preview.kits[0].groupActorId,"g");assert.deepEqual(preview.tiers.map(t=>t.dc),[10,15]);
 assert.equal((await f.docs.prepare(f.intent,f.sender)).dc,15);
 f.deny();await assert.rejects(f.docs.prepare(f.intent,f.sender));
});
test("live revalidation rejects unavailable tier, foreign sender and missing Medicine",async()=>{
 const f=fixture();await assert.rejects(f.docs.prepare({...f.intent,tierDc:20},f.sender));await assert.rejects(f.docs.prepare(f.intent,{id:"p"}));
 f.character.system.skills.med.value=0.5;await assert.rejects(f.docs.prepare(f.intent,f.sender));
});
test("bypassing a missing kit requires explicit flag and no accessible kit",async()=>{
 const f=fixture();const noKit={...f.intent,kitItemUuid:"",groupActorId:"",ignoreMissingKit:true};
 await assert.rejects(f.docs.prepare(noKit,f.sender));
 f.deny();const prepared=await f.docs.prepare(noKit,f.sender);assert.equal(prepared.dc,15);assert.equal(prepared.withoutKit,true);
 await assert.rejects(f.docs.prepare({...noKit,ignoreMissingKit:false},f.sender));
 await assert.rejects(f.docs.prepare({...f.intent,ignoreMissingKit:true},f.sender));
});
