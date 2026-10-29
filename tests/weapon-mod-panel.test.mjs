import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
import {optionalModule,required,makeCatalog,makeItem,getHost,makeWeaponModMutationFixture} from "./helpers/weapon-mod-fixture.mjs";
import {getWeaponModEffectiveHost} from "../scripts/data/weapon-mod-rules.js";
import {createOverlayDom} from "./helpers/overlay-dom.mjs";
const module=await optionalModule(new URL("../scripts/integrations/weapon-mod-panel.js",import.meta.url)),view=required(module,"buildWeaponModCatalogView");
test("extra mounts appear below the diagram without blueprint anchors",()=>{
 const item=makeItem("vintovka"),catalog=makeCatalog();
 item.actor={system:{attributes:{prof:6}},items:{contents:[{type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}}]}};
 const host=getHost(item,catalog),blueprint={img:"weapon.png",width:1000,height:400,anchors:Object.fromEntries(host.mountIds.filter(id=>!id.startsWith("extra-")).map(id=>[id,{x:.5,y:.5}]))};
 const html=required(module,"createWeaponModPanelHtml")({id:"host"},{host,attachments:[]},blueprint);
 assert.equal((html.match(/data-wm-mount="extra-\d+"/g)??[]).length,6);
 assert.ok(html.indexOf("rm-wm__extra-grid")>html.indexOf("</fieldset>"));
 assert.match(html,/Дополнительное место 6/);
});
test("master sees compatible bipod at any free mount while ordinary users retain slot restrictions",()=>{
 const catalog=makeCatalog(),item=makeItem("vintovka"),bipod=makeItem("soshki");
 item.actor={items:{contents:[{type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}}]}};
 const host=getHost(item,catalog),installed={attachments:[],modernizedParts:[]};
 const rows=view({catalog,host,installed,inventory:[bipod],kind:"weaponAttachment",mountId:"top",isOwner:true});
 assert.equal(rows.find(row=>row.sourceId==="soshki")?.available,true);
 host.freeMounts=false;
 assert.equal(view({catalog,host,installed,inventory:[bipod],kind:"weaponAttachment",mountId:"top",isOwner:true}).some(row=>row.sourceId==="soshki"),false);
});
test("alternate two-mount installations retain a visible connector",()=>{
 const points=required(module,"getWeaponModConnectorPoints")(getHost(makeItem("vintovka"),makeCatalog()),["top","side-1"]);
 assert.equal(points.length,4);
});
test("catalogue shows compatible rows, available owned first, blocked owned next, missing grey and never installable",()=>{
 const catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog),inventory=[makeItem("lazernyy-tseleukazatel"),makeItem("glushitel"),makeItem("glushitel",{id:"second",system:{quantity:2}}),makeItem("razgonshchik-snaryadov",{flags:{"rebreya-main":{gearId:"razgonshchik-snaryadov",attachment:{kind:"custom"}}}})],
  installed={attachments:[{itemId:"installed",sourceId:"lazernyy-tseleukazatel",mountIds:["bottom-1"]}],modernizedParts:[]},
  rows=view({catalog,host,installed,inventory,kind:"weaponAttachment",mountId:"barrel",isOwner:true});
 assert.ok(rows.length>0 && rows.length<13);assert.ok(rows.some(row=>row.availabilityRank===0));assert.ok(rows.some(row=>row.availabilityRank===1));assert.ok(rows.some(row=>row.availabilityRank===2));
 assert.equal(rows.some(row=>row.sourceId==="lazernyy-tseleukazatel"),false);
 assert.deepEqual(rows.map(row=>row.availabilityRank),rows.map(row=>row.availabilityRank).sort());
 const silencer=rows.find(row=>row.sourceId==="glushitel");assert.equal(silencer.ownedQuantity,3);assert.equal(silencer.instances.length,2);assert.equal(silencer.available,true);
 assert.equal(silencer.mechanics,catalog.rows.find(row=>row.sourceId==="glushitel").profile.propertiesText);assert.match(silencer.requirements,/Ствол/);
 assert.ok(rows.filter(row=>!row.ownedQuantity).every(row=>!row.available && row.reason));
 assert.equal(view({catalog,host,installed,inventory,kind:"modernizedPart",isOwner:true}).some(row=>row.sourceId==="pistoletnaya-rukoyat"),false);
 assert.ok(view({catalog,host,installed,inventory,kind:"weaponAttachment",isOwner:false}).every(row=>!row.available));
});
test("top slot includes only its compatible optics, keeps missing sources and presents two compact groups",()=>{
 const catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog),owned=makeItem("kollimatornyy-pritsel",{uuid:"Actor.a.Item.owned",img:"owned.png"}),
  source=makeItem("opticheskiy-pritsel",{uuid:"Compendium.world.rebreya-gear.scope",img:"source.png"}),
  rows=view({catalog,host,installed:{attachments:[],modernizedParts:[]},inventory:[owned,makeItem("glushitel")],sourceItems:[source],kind:"weaponAttachment",mountId:"top",isOwner:true});
 assert.deepEqual(rows.map(row=>row.sourceId),["kollimatornyy-pritsel","opticheskiy-pritsel"]);
 assert.equal(rows[1].available,false);assert.equal(rows[1].documentUuid,source.uuid);assert.equal(rows[1].img,"source.png");
 const html=required(module,"createWeaponModCatalogHtml")(rows,"weaponAttachment","top");
 assert.match(html,/Есть в инвентаре/);assert.match(html,/Нет в инвентаре/);assert.match(html,/<hr/);
 assert.match(html,/data-uuid="Compendium.world.rebreya-gear.scope"/);assert.match(html,/data-wm-choice="opticheskiy-pritsel"[^>]*disabled/);
 assert.match(html,/<a[^>]*data-link[^>]*data-uuid="Compendium.world.rebreya-gear.scope"/);
 assert.doesNotMatch(html,/\bhref\s*=/);assert.match(html,/role="button" tabindex="0"/);
 assert.equal(html.includes(catalog.rows.find(row=>row.sourceId==="opticheskiy-pritsel").profile.propertiesText),false);
 assert.match(required(module,"createWeaponModCatalogHtml")([rows[1]],"modernizedPart",null),/Нет подходящих частей в инвентаре/);
});
test("catalogue references use existing world and canonical compendium Items without creating documents",async()=>{
 const previous=globalThis.game,catalog=makeCatalog(),world=makeItem("glushitel",{uuid:"Item.world",img:"world.png"});let indexed=0;
 try{
  globalThis.game={items:{contents:[world]},packs:{get:id=>id==="world.rebreya-gear"?{visible:true,collection:id,getIndex:async()=>{indexed++;return [{_id:"optic",name:"Прицел",img:"optic.png",flags:{"rebreya-main":{gearId:"opticheskiy-pritsel"}}}];}}:null}};
  const sources=await required(module,"loadWeaponModSourceItems")(catalog);
  assert.equal(indexed,1);assert.equal(sources.find(item=>item.uuid==="Item.world").img,"world.png");
  assert.equal(sources.find(item=>item.uuid==="Compendium.world.rebreya-gear.optic").img,"optic.png");
 }finally{globalThis.game=previous;}
});
test("modern catalogue compatibility uses the current saw-off form rather than the original long body",()=>{
 const catalog=makeCatalog(),host=getWeaponModEffectiveHost(getHost(makeItem("drobovik"),catalog),[{sourceId:"obrezka-stvola"}]),
  rows=view({catalog,host,installed:{attachments:[],modernizedParts:[]},inventory:[],kind:"modernizedPart",isOwner:true});
 assert.ok(rows.some(row=>row.sourceId==="pistoletnaya-rukoyat"));
});
test("modern catalogue retains a legal at-cap replacement that removes saw-off and restores the long form",()=>{
 const catalog=makeCatalog(),parts=["obrezka-stvola","oblegchyonnyy-korpus","sil-naya-sverdlovka"].map(sourceId=>({itemId:sourceId,sourceId,profile:catalog.rows.find(row=>row.sourceId===sourceId).profile})),
  host=getWeaponModEffectiveHost(getHost(makeItem("drobovik"),catalog),parts),stock=makeItem("priklad"),
  row=view({catalog,host,installed:{attachments:[],modernizedParts:parts},inventory:[stock],kind:"modernizedPart",isOwner:true}).find(row=>row.sourceId==="priklad");
 assert.ok(row,"a valid real replacement must survive catalogue filtering");assert.equal(row.available,true);
 assert.ok(row.instances[0].replacements.includes("obrezka-stvola"));
});
test("drag preview highlights only compatible mounts for a real owned available component",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1});try{
  const mounts=required(module,"getWeaponModCompatibleMounts"),projection=await fx.service.getWeaponModsProjection(fx.host);
  assert.deepEqual(mounts(fx.host,fx.component,fx.catalog,projection),["bottom-1","bottom-2","barrel"]);
  assert.deepEqual(mounts(fx.host,makeItem("soshki"),fx.catalog,projection),[]);
  fx.component.data.system.equipped=true;fx.component.data.flags["rebreya-main"].heldHands=["left"];
  assert.deepEqual(mounts(fx.host,fx.component,fx.catalog,projection),[]);
 }finally{fx.restore();}
});
test("filled mount cards fit the diagram at narrow and wide sheet sizes without overlapping",()=>{
 const layout=required(module,"getWeaponModMountPositions"),catalog=makeCatalog(),host=getHost(makeItem("vintovka"),catalog);
 for(const width of [400,788]){
  const height=width*.6,rects=Object.values(layout(host)).map(point=>({left:width*(point.x/100-.0935),right:width*(point.x/100+.0935),top:height*point.y/100-width*.0935,bottom:height*point.y/100+width*.0935}));
  for(const rect of rects){assert.ok(rect.left>=0);assert.ok(rect.right<=width);assert.ok(rect.top>=0);assert.ok(rect.bottom<=height);}
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top);}
 }
});
test("a two-mount child uses one clear orthogonal link between card edges without crossing another mount",()=>{
 const host=getHost(makeItem("vintovka"),makeCatalog()),positions=required(module,"getWeaponModMountPositions")(host),
  points=required(module,"getWeaponModConnectorPoints")(host,["bottom-1","barrel"]),rect=id=>({x:positions[id].x*10,y:positions[id].y*6});
 assert.equal(points.length,4);assert.deepEqual(points[0],[rect("bottom-1").x,rect("bottom-1").y-93.5]);
 assert.deepEqual(points.at(-1),[rect("barrel").x,rect("barrel").y+93.5]);
 for(let i=1;i<points.length;i++)assert.ok(points[i][0]===points[i-1][0] || points[i][1]===points[i-1][1]);
 assert.ok(points[1][1]<rect("bottom-2").y-110);assert.ok(points[1][1]>rect("barrel").y+110);
});
test("mods template adds two local sub-tabs and filled tiles retain full images and a frame legend",async()=>{
 const template=await readFile(new URL("../templates/item-mods-tab.hbs",import.meta.url),"utf8");
 assert.match(template,/data-weapon-mod-subtab="attachments"/);assert.match(template,/data-weapon-mod-subtab="upgrades"/);
 const tabs=template.match(/<button[^>]*data-weapon-mod-subtab[^>]*>/g);assert.equal(tabs.length,2);
 for(const tab of tabs)assert.match(tab,/class="[^"]*\balways-interactive\b/,"native dnd5e PLAY mode must leave navigation enabled");
 assert.ok(template.indexOf("data-weapon-mod-tabs")<template.indexOf("data-weapon-mod-mount"));
 const host=getHost(makeItem("vintovka"),makeCatalog()),blueprint={img:"weapon.png",width:1000,height:400,anchors:Object.fromEntries(host.mountIds.map(id=>[id,{x:.5,y:.5}]))},
  html=required(module,"createWeaponModPanelHtml")({id:"host"},{host,attachments:[{itemId:"child",sourceId:"shtyk",mountIds:["bottom-1","barrel"],item:{name:"Штык",img:"bayonet.png"}}]},blueprint);
 assert.match(html,/<fieldset[^>]*rm-wm__diagram/);assert.match(html,/<legend[^>]*>Оружейные обвесы/);
 assert.equal((html.match(/src="bayonet.png"/g)??[]).length,2);assert.equal((html.match(/data-main-child="child"/g)??[]).length,1);
 assert.match(html,/data-wm-link="child"/);assert.equal(html.includes("Одна часть за пересборку"),false);
});
test("mounts use the hero doll tooltip binding and keep the image uncovered with one centered link lock",async()=>{
 const host=getHost(makeItem("vintovka"),makeCatalog()),blueprint={img:"weapon.png",width:1000,height:400,anchors:Object.fromEntries(host.mountIds.map(id=>[id,{x:.5,y:.5}]))},
  html=required(module,"createWeaponModPanelHtml")({id:"host"},{host,attachments:[{itemId:"child",sourceId:"shtyk",mountIds:["bottom-1","barrel"],item:{name:"Штык",img:"bayonet.png"}}]},blueprint),
  mounts=html.match(/<button[^>]*data-wm-mount[\s\S]*?<\/button>/g),css=await readFile(new URL("../styles/main.css",import.meta.url),"utf8");
 assert.equal(mounts.length,6);for(const mount of mounts){assert.match(mount,/data-rm-tooltip=/);assert.doesNotMatch(mount,/\btitle=|rm-wm__caption/);}
 assert.match(mounts.find(mount=>mount.includes('data-wm-mount="bottom-1"')),/data-rm-tooltip="Низ 1: Штык"/);
 assert.equal((html.match(/data-wm-lock="child"/g)??[]).length,1);assert.match(html,/data-wm-lock="child" transform="translate\(640,369\)"/);
 assert.match(css,/\.rm-wm \.rm-wm__mount\{[^}]*width:18\.7%[^}]*overflow:visible/);
 assert.match(css,/\.rm-anchored-tooltip\.rm-wm-tooltip\{[^}]*background:transparent/);
 assert.doesNotMatch(html,/data-wm-catalog/);
});
test("context menu removes real weapon attachments through the canonical command, and legacy upgrades through their existing owner only",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1});try{
  const installed=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"context-install",mountId:"bottom-1"}),child=fx.group.items.get(installed.itemId);
  fx.api.removeWeaponAttachment=payload=>fx.service.removeWeaponAttachment(fx.host,payload.componentItemId,payload);
  const build=required(module,"buildWeaponModContextActions"),projection=await fx.service.getWeaponModsProjection(fx.host),actions=build(fx.host,child,projection,fx.api);
  assert.deepEqual(actions.slice(0,2).map(action=>action.id),["open","remove-weapon"]);await actions[1].callback();assert.equal(child.system.container,null);
  fx.host.data.flags["rebreya-main"].itemUpgrades={version:1,capacity:3,installed:[{itemId:child.id}]};child.data.flags["rebreya-main"].installedUpgrade={hostActorId:fx.group.id,hostItemId:fx.host.id};
  let removed=null;fx.api.removeItemUpgrade=async(host,id)=>{removed={host,id};};
  await build(fx.host,child,{attachments:[]},fx.api).find(action=>action.id==="remove-upgrade").callback();assert.equal(removed.host,fx.host);assert.equal(removed.id,child.id);
  child.data.flags["rebreya-main"].installedUpgrade.hostItemId="another-weapon";
  assert.deepEqual(build(fx.host,child,{attachments:[]},fx.api).map(action=>action.id),["open"]);
 }finally{fx.restore();}
});
test("native panel delegates a list context menu and mounts catalogue in a dismissible portal; UUID clicks close it without navigation",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1}),previousDocument=globalThis.document;try{
  const installed=await fx.service.installWeaponAttachment(fx.host,fx.component,{operationId:"portal-install",mountId:"bottom-1"}),dom=createOverlayDom(),{owner}=dom.fixture(),panel=new dom.Element(),top=new dom.Element(),occupied=new dom.Element(),status=new dom.Element();
  owner.append(panel);panel.append(top,occupied);top.dataset={wmMount:"top",rmTooltip:"Верх: Пусто"};occupied.dataset={wmMount:"bottom-1",wmChild:installed.itemId};
  top.closest=()=>top;occupied.closest=()=>occupied;panel.querySelector=()=>status;panel.querySelectorAll=()=>[top,occupied];globalThis.document=dom.document;
  let rendered=0,menu=null;const app=Object.assign(new EventTarget(),{item:fx.host,render(){rendered++;}}),event=target=>({target,clientX:100,clientY:120,preventDefault(){},stopPropagation(){}});
  await required(module,"bindWeaponModPanel")(owner,app,fx.api,{loadBlueprints:async()=>({}),loadSourceItems:async()=>[],resolveBlueprint:()=>({}),render:()=>panel,openContextMenu:options=>{menu=options;return null;}});
  await panel.emit("contextmenu",event(occupied));assert.deepEqual(menu.actions.slice(0,2).map(action=>action.id),["open","remove-weapon"]);assert.equal(rendered,0);
  await panel.emit("contextmenu",event(top));const portal=dom.document.body.children.at(-1),content=portal.children[0];
  assert.notEqual(portal,owner);assert.equal(panel.contains(content),false);assert.match(content.innerHTML,/Есть в инвентаре/);assert.equal(content.dataset.wmCatalog,"true");
  const reference=new dom.Element();content.append(reference);reference.closest=selector=>selector==="a[data-link]"?reference:null;let prevented=false;
  await content.emit("click",{target:reference,preventDefault(){prevented=true;},stopPropagation(){}});
  assert.equal(prevented,false);assert.equal(dom.document.body.children.length,1);
  await panel.emit("contextmenu",event(top));await dom.events.emit("click",{target:dom.document.body});assert.equal(dom.document.body.children.length,1);
  await panel.emit("contextmenu",event(top));app.dispatchEvent(new Event("close"));assert.equal(dom.document.body.children.length,1);assert.equal(menu.signal.aborted,true);
 }finally{globalThis.document=previousDocument;fx.restore();}
});
test("local sub-tab choice survives sheet rerender and ordinary-only sheets keep enhancements visible",()=>{
 const app={},makeRoot=()=>{
  const buttons=["attachments","upgrades"].map(id=>({dataset:{weaponModSubtab:id},setAttribute(key,value){this[key]=value;},closest(){return this;}})),
   nav=Object.assign(new EventTarget(),{querySelectorAll:()=>buttons,contains:()=>true}),panes=buttons.map(button=>({dataset:{weaponModView:button.dataset.weaponModSubtab},hidden:false}));
  return {nav,buttons,panes,querySelector:()=>nav,querySelectorAll:()=>panes};
 },bind=required(module,"bindWeaponModSubtabs"),first=makeRoot();
 assert.equal(bind(first,app),"attachments");assert.equal(first.panes[1].hidden,true);
 const event=new Event("click");Object.defineProperty(event,"target",{value:first.buttons[1]});first.nav.dispatchEvent(event);
 assert.equal(first.panes[0].hidden,true);assert.equal(first.buttons[1]["aria-selected"],"true");
 const next=makeRoot();assert.equal(bind(next,app),"upgrades");assert.equal(next.panes[1].hidden,false);
 bind(next,app,{enabled:false});assert.equal(next.nav.hidden,true);assert.equal(next.panes[1].hidden,false);
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
test("closing the native application releases the document drag listeners",async()=>{
 const fx=await makeWeaponModMutationFixture(),previousDocument=globalThis.document;try{
  const document=new EventTarget(),panel=Object.assign(new EventTarget(),{querySelector:()=>({}),querySelectorAll:()=>[]}),
   app=Object.assign(new EventTarget(),{item:fx.host}),root={querySelector:()=>null,isConnected:true};globalThis.document=document;
  let reads=0;await required(module,"bindWeaponModPanel")(root,app,fx.api,{loadBlueprints:async()=>({}),resolveBlueprint:()=>({}),render:()=>panel,
   getDropData:()=>{reads++;return {};},resolveDropItem:async()=>null});
  document.dispatchEvent(new Event("dragstart"));assert.equal(reads,1);app.dispatchEvent(new Event("close"));
  document.dispatchEvent(new Event("dragstart"));assert.equal(reads,1);
 }finally{globalThis.document=previousDocument;fx.restore();}
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
test("master chooses both locations before an installation request",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:1});
 try{
  fx.group.items.contents.push({id:"feat",type:"feat",system:{identifier:"master-ognestrelnogo-oruzhiya"}});
  let payload;fx.api.installWeaponAttachment=async value=>{payload=value;return {changed:true};};
  const chosen=["side-1"],result=await required(module,"installWeaponModWithChoices")(fx.host,fx.component,fx.api,{mountId:"top",chooseMount:async()=>chosen.shift()});
  assert.equal(result.changed,true);assert.deepEqual(payload.mountIds,["top","side-1"]);
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
test("confirmed UI rebuild installs one actual owned part and debits exactly500gp through the canonical service",async()=>{
 const fx=await makeWeaponModMutationFixture({quantity:2}),previousFoundry=globalThis.foundry;try{
  fx.component.data.flags=makeItem("oblegchyonnyy-korpus").flags;
  globalThis.foundry={...previousFoundry,applications:{api:{DialogV2:{confirm:async()=>true}}}};
  fx.api.installWeaponModernization=payload=>fx.service.installWeaponModernization(fx.host,fx.group.items.get(payload.componentItemId),payload);
  const before=fx.group.system.currency.gp,result=await required(module,"installWeaponModWithChoices")(fx.host,fx.component,fx.api);
  assert.equal(fx.group.system.currency.gp,before-500);assert.equal(fx.component.system.quantity,1);
  assert.equal(fx.host.getFlag("rebreya-main","weaponMods").modernizedParts.length,1);assert.equal(result.sourceRemaining,1);
 }finally{globalThis.foundry=previousFoundry;fx.restore();}
});
test("ordinary upgrades keep working without loading or depending on the weapon catalogue",async()=>{
 const sheet=await import("../scripts/integrations/item-upgrade-sheet.js");let installed=0,loaded=0;
 const item={id:"ordinary",flags:{}},host={id:"host"},api={itemUpgradeService:{getWeaponModCatalog:async()=>{loaded++;throw Error("weapon catalogue offline");}},installItemUpgrade:async(h,u)=>{assert.equal(h,host);assert.equal(u,item);installed++;return "ok";}};
 assert.equal(await sheet.installItemUpgradeWithChoices(host,item,api),"ok");assert.equal(installed,1);assert.equal(loaded,0);
});
