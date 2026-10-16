import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
import {optionalModule,required,makeCatalog,makeItem,getHost,makeWeaponModMutationFixture} from "./helpers/weapon-mod-fixture.mjs";
const module=await optionalModule(new URL("../scripts/integrations/weapon-mod-panel.js",import.meta.url)),view=required(module,"buildWeaponModCatalogView");
test("catalogue shows every row, available owned first, blocked owned next, missing grey and never installable",()=>{
 const catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog),inventory=[makeItem("lazernyy-tseleukazatel"),makeItem("glushitel"),makeItem("glushitel",{id:"second",system:{quantity:2}})],
  installed={attachments:[{itemId:"installed",sourceId:"lazernyy-tseleukazatel",mountIds:["bottom-1"]}],modernizedParts:[]},
  rows=view({catalog,host,installed,inventory,kind:"weaponAttachment",mountId:"barrel",isOwner:true});
 assert.equal(rows.length,13);assert.ok(rows.some(row=>row.availabilityRank===0));assert.ok(rows.some(row=>row.availabilityRank===1));assert.ok(rows.some(row=>row.availabilityRank===2));
 assert.deepEqual(rows.map(row=>row.availabilityRank),rows.map(row=>row.availabilityRank).sort());
 const silencer=rows.find(row=>row.sourceId==="glushitel");assert.equal(silencer.ownedQuantity,3);assert.equal(silencer.instances.length,2);assert.equal(silencer.available,true);
 assert.ok(rows.filter(row=>!row.ownedQuantity).every(row=>!row.available && row.reason));
 assert.equal(view({catalog,host,installed,inventory,kind:"modernizedPart",isOwner:true}).length,12);
 assert.ok(view({catalog,host,installed,inventory,kind:"weaponAttachment",isOwner:false}).every(row=>!row.available));
});
test("filled mount cards fit the diagram at narrow and wide sheet sizes without overlapping",()=>{
 const layout=required(module,"getWeaponModMountPositions"),catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog);
 for(const width of [400,788]){
  const height=width*.6,rects=Object.values(layout(host)).map(point=>({left:width*(point.x/100-.11),right:width*(point.x/100+.11),top:height*point.y/100-43,bottom:height*point.y/100+43}));
  for(const rect of rects){assert.ok(rect.left>=0);assert.ok(rect.right<=width);assert.ok(rect.top>=0);assert.ok(rect.bottom<=height);}
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top);}
 }
});
test("owned modified, held, installed and fractional copies cannot be selected as usable instances",()=>{
 const catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog),copy=makeItem("glushitel"),held=makeItem("glushitel",{id:"held",system:{quantity:1,equipped:true},flags:{...copy.flags,"rebreya-main":{...copy.flags["rebreya-main"],heldHands:["left"]}}}),
  custom=makeItem("glushitel",{id:"custom",flags:{"rebreya-main":{gearId:"glushitel",attachment:{kind:"custom"}}}}),fraction=makeItem("glushitel",{id:"fraction",system:{quantity:.5}});
 const rows=view({catalog,host,installed:{attachments:[],modernizedParts:[]},inventory:[held,custom,fraction],kind:"weaponAttachment",mountId:"barrel",isOwner:true});
 assert.equal(rows.find(row=>row.sourceId==="glushitel").available,false);
});
test("one all-mount child renders one open card and a reference in its second mount above normal slots",async()=>{
 const html=required(module,"createWeaponModPanelHtml"),catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog),
  projection={host,attachments:[{itemId:"one",sourceId:"shtyk",mountIds:["bottom-1","barrel"],item:{id:"one",name:"Штык",img:"icon.png"}}],modernizedParts:[],diagnostics:[]},
  blueprint={img:"blueprint.png",width:1000,height:400,anchors:Object.fromEntries(host.mountIds.map(id=>[id,{x:.5,y:.5}]))},
  result=html(makeItem("vintovka"),projection,blueprint);
 assert.equal((result.match(/data-main-child="one"/g)??[]).length,1);assert.match(result,/Связано/);assert.match(result,/500 зм/);assert.match(result,/<svg/);
 const integration=await readFile(new URL("../scripts/integrations/item-upgrade-sheet.js",import.meta.url),"utf8");assert.match(integration,/bindWeaponModPanel/);
});
test("stale asynchronous panel response cannot restore old slots",async()=>{
 const bind=required(module,"bindWeaponModPanel"),resolvers=[],renders=[],root={querySelector:()=>null,isConnected:true},host=makeItem("vintovka"),
  catalog=makeCatalog(),api={itemUpgradeService:{getWeaponModCatalog:async()=>catalog,getWeaponModsProjection:()=>new Promise(resolve=>resolvers.push(resolve))}},
  options={loadBlueprints:async()=>({}),resolveBlueprint:()=>({}),render:(_root,_host,projection)=>{renders.push(projection.tag);return null;}};
 const first=bind(root,{item:host},api,options);await new Promise(resolve=>setImmediate(resolve));
 const second=bind(root,{item:host},api,options);await new Promise(resolve=>setImmediate(resolve));
 const projection={host:getHost(host,catalog),attachments:[],modernizedParts:[],diagnostics:[]};
 resolvers[1]({...projection,tag:"new"});await second;resolvers[0]({...projection,tag:"old"});await first;assert.deepEqual(renders,["new"]);
});
test("panel install uses the canonical owned-instance mutation and splits one unit, never a catalogue-created item",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:3});
 try{
  let calls=0;fx.api.installWeaponAttachment=payload=>{calls++;return fx.service.installWeaponAttachment(fx.host,fx.group.items.get(payload.componentItemId),payload);};
  const install=required(module,"installWeaponModWithChoices"),result=await install(fx.host,fx.component,fx.api,{mountId:"bottom-1"});
  assert.equal(calls,1);assert.equal(result.sourceRemaining,2);assert.equal(fx.component.system.quantity,2);assert.equal(fx.host.getFlag("rebreya-main","weaponMods").attachments.length,1);
  const absent=makeItem("glushitel");await assert.rejects(install(fx.host,absent,fx.api,{mountId:"barrel"}),/инвентаре/u);assert.equal(calls,1);
 }finally{fx.restore();}
});
test("cancelled rebuild does not debit currency or invoke installation, and old upgrade routing still accepts mods",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1}),previousFoundry=globalThis.foundry;
 try{
  fx.component.data.flags=makeItem("priklad").flags;let calls=0;fx.api.installWeaponModernization=()=>{calls++;};
  const before=structuredClone(fx.group.system.currency);globalThis.foundry={...previousFoundry,applications:{api:{DialogV2:{confirm:async()=>false}}}};
  assert.equal(await required(module,"installWeaponModWithChoices")(fx.host,fx.component,fx.api),null);assert.equal(calls,0);assert.deepEqual(fx.group.system.currency,before);
  const sheet=await import("../scripts/integrations/item-upgrade-sheet.js");
  assert.equal(await sheet.installItemUpgradeWithChoices(fx.host,fx.component,fx.api),null);assert.equal(calls,0);
  assert.equal(sheet.isInstalledModInventoryItem({system:{container:"weapon"},flags:{"rebreya-main":{installedWeaponMod:{version:1,hostItemId:"weapon"}}}}),true);
 }finally{globalThis.foundry=previousFoundry;fx.restore();}
});
test("ordinary upgrades keep working without loading or depending on the weapon catalogue",async()=>{
 const sheet=await import("../scripts/integrations/item-upgrade-sheet.js");let installed=0,loaded=0;
 const item={id:"ordinary",flags:{}},host={id:"host"},api={itemUpgradeService:{getWeaponModCatalog:async()=>{loaded++;throw Error("weapon catalogue offline");}},installItemUpgrade:async(h,u)=>{assert.equal(h,host);assert.equal(u,item);installed++;return "ok";}};
 assert.equal(await sheet.installItemUpgradeWithChoices(host,item,api),"ok");assert.equal(installed,1);assert.equal(loaded,0);
});
