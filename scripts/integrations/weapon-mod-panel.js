import {MODULE_ID,GEAR_COMPENDIUM_NAME} from "../constants.js";
import {getWeaponModCandidate} from "../data/weapon-mod-catalog.js?v=1.4.389";
import {weaponModFlag,validateWeaponAttachmentInstallation,validateModernizedPartInstallation} from "../data/weapon-mod-rules.js?v=1.4.389";
import {loadWeaponBlueprints,getWeaponBlueprint} from "../data/weapon-blueprints.js?v=1.4.389";
import {getItemHeldHands,isItemEquipped} from "./held-items.js?v=1.4.383";
import {AnchoredOverlay,bindAnchoredTooltips} from "../ui/anchored-overlay.js?v=1.4.392";
const states=new WeakMap(),requests=new WeakMap(),viewSelections=new WeakMap(),tabBindings=new WeakMap(),values=collection=>Array.from(collection?.contents??collection?.values?.()??collection??[]);
const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const labels={top:"Верх","bottom-1":"Низ 1","bottom-2":"Низ 2","side-1":"Сторона 1","side-2":"Сторона 2",barrel:"Ствол"};
const mountHalfSize=93.5;
const owner=item=>Boolean(item?.actor??item?.parent) && (globalThis.game?.user?.isGM || item.isOwner===true || (item.actor??item.parent)?.testUserPermission?.(game.user,"OWNER"));
const errorText=error=>error?.message??"Компонент недоступен.";
function localize(key,fallback){const value=globalThis.game?.i18n?.localize?.(key);return value && value!==key?value:fallback;}
function requirementsText(profile,catalog){
 const names={top:"Верх",bottom:"Низ",side:"Сторона",barrel:"Ствол",firearm:"Огнестрел","long-firearm":"Длинноствольное",
  "short-firearm":"Короткоствольное","all-firearms":"Любой огнестрел","magazine-fed-firearm":"Магазинное питание",musket:"Мушкет",
  "flintlock-pistol":"Кремнёвый пистолет",arquebus:"Аркебуза",wheellock:"Колесцовое",rifle:"Винтовка",carbine:"Карабин",shotgun:"Дробовик",
  "short-firearm-with-pistol-grip":"Короткоствольное с пистолетной рукоятью"},name=id=>catalog.rows.find(row=>row.sourceId===id)?.name??names[id]??id,
  slots=profile.slots?.values?.map(name).join(profile.slots.mode==="all"?" + ":" / ");
 return [slots?`Крепления: ${slots}`:"Встроенная часть",profile.compatibility?.length?`Оружие: ${profile.compatibility.map(name).join(", ")}`:"",
  profile.requires?.length?`Требуется: ${profile.requires.map(name).join(", ")}`:"",profile.requiresParts?.length?`Нужна часть: ${profile.requiresParts.map(name).join(", ")}`:"",
  profile.excludes?.length?`Несовместимо: ${profile.excludes.map(name).join(", ")}`:"",profile.countsTowardLimit===false?"Не занимает лимит частей":""].filter(Boolean).join(" · ");
}
function validateChoice(host,installed,candidate,kind,mountId){
 if(kind==="weaponAttachment")return {mountIds:validateWeaponAttachmentInstallation(host,installed.attachments??[],candidate,{mountId}).mountIds,replacements:[]};
 const parts=installed.modernizedParts??[];
 try{validateModernizedPartInstallation(host,parts,candidate,{gmApproval:true});return {replacements:[]};}
 catch(error){
  if(error.code!=="capacity")throw error;
  const replacements=parts.filter(part=>{try{validateModernizedPartInstallation(host,parts,candidate,{gmApproval:true,removeItemId:part.itemId});return true;}catch{return false;}});
  if(!replacements.length)throw error;return {replacements:replacements.map(part=>part.itemId)};
 }
}
function fitsCatalogSlot(row,host,catalog,mountId,installed){
 const candidate={sourceId:row.sourceId,profile:row.profile,quantity:1,available:true};
 if(row.profile.kind==="modernizedPart")try{validateChoice(host,installed,candidate,"modernizedPart",null);return true;}catch{/* A blocked current installation may still belong to the compatible catalogue. */}
 try{
  if(row.profile.kind==="weaponAttachment")validateWeaponAttachmentInstallation({...host,quantity:1},[],candidate,{mountId});
  else{
   const dependencies=catalog.rows.filter(part=>row.profile.requiresParts?.includes(part.sourceId)).map(part=>({itemId:`catalog:${part.sourceId}`,sourceId:part.sourceId,profile:part.profile}));
   validateModernizedPartInstallation({...host,quantity:1,baseForm:host.form},dependencies,candidate,{gmApproval:true});
  }
  return true;
 }catch{return false;}
}
export async function loadWeaponModSourceItems(catalog){
 const ids=new Set(catalog.rows.map(row=>row.sourceId)),sources=values(globalThis.game?.items).filter(item=>ids.has(weaponModFlag(item,"gearId")) && item.visible!==false
  && item.testUserPermission?.(globalThis.game?.user,"OBSERVER")!==false),pack=globalThis.game?.packs?.get?.(`world.${GEAR_COMPENDIUM_NAME}`);
 if(pack && pack.visible!==false)try{
  const index=await pack.getIndex({fields:[`flags.${MODULE_ID}.gearId`]});
  for(const entry of values(index))if(ids.has(weaponModFlag(entry,"gearId")))sources.push({...entry,uuid:`Compendium.${pack.collection??`world.${GEAR_COMPENDIUM_NAME}`}.${entry._id??entry.id}`});
 }catch{/* Missing read access must not block the owned inventory or the diagram. */}
 return sources;
}
export function buildWeaponModCatalogView({catalog,host,installed,inventory,sourceItems=[],kind,mountId=null,isOwner}){
 return catalog.rows.filter(row=>row.profile.kind===kind && fitsCatalogSlot(row,host,catalog,mountId,installed)).map(row=>{
  const copies=inventory.filter(item=>weaponModFlag(item,"gearId")===row.sourceId && !weaponModFlag(item,"installedWeaponMod")?.hostItemId
    && !weaponModFlag(item,"installedUpgrade")?.hostItemId),instances=copies.map(item=>{
    let reason="",checked={};
    try{
      if(!isOwner)throw Error("Нет прав владельца оружия.");
      if(isItemEquipped(item) && getItemHeldHands(item).length)throw Error("Сначала освободите компонент из рук.");
      if(inventory.some(child=>child.system?.container===(item.id??item._id)))throw Error("Сначала извлеките содержимое компонента.");
      checked=validateChoice(host,installed,getWeaponModCandidate(item,catalog),kind,mountId);
    }catch(error){reason=errorText(error);}
    return {itemId:item.id??item._id,name:item.name??row.name,quantity:Number(item.system?.quantity??0),available:!reason,reason,...checked};
  }),available=instances.some(instance=>instance.available),ownedQuantity=instances.reduce((sum,instance)=>sum+Math.max(0,Number.isFinite(instance.quantity)?instance.quantity:0),0),
   reason=available?"":instances[0]?.reason??localize("REBREYA.WeaponMods.Missing","Нет в инвентаре персонажа.");
  const source=copies.find(copy=>instances.some(instance=>instance.itemId===(copy.id??copy._id) && instance.available))??copies[0]??sourceItems.find(item=>weaponModFlag(item,"gearId")===row.sourceId);
  return {sourceId:row.sourceId,name:row.name,img:source?.img||row.img||"icons/svg/item-bag.svg",documentUuid:source?.uuid??null,mechanics:row.profile.propertiesText??"",requirements:requirementsText(row.profile,catalog),ownedQuantity,instances,available,reason,availabilityRank:available?0:ownedQuantity>0?1:2};
 }).sort((a,b)=>a.availabilityRank-b.availabilityRank || a.name.localeCompare(b.name,"ru") || a.sourceId.localeCompare(b.sourceId));
}
export function getWeaponModCompatibleMounts(item,component,catalog,projection){
 const actor=item.actor??item.parent;
 if(!owner(item) || actor?.items.get(component?.id)!==component || (component?.actor??component?.parent)!==actor
   || getWeaponModCandidate(component,catalog).profile?.kind!=="weaponAttachment")return [];
 return projection.host.mountIds.filter(mountId=>buildWeaponModCatalogView({catalog,host:projection.host,installed:projection,inventory:values(actor.items),
  kind:"weaponAttachment",mountId,isOwner:true}).some(row=>row.instances.some(instance=>instance.itemId===component.id && instance.available)));
}
export function getWeaponModMountPositions(host){
 const positions={top:{x:50,y:19},"bottom-1":{x:host.family==="crossbow"?50:40,y:81},"bottom-2":{x:70,y:81},"side-1":{x:12,y:31},"side-2":{x:12,y:69},barrel:{x:88,y:42}};
 return Object.fromEntries(host.mountIds.map(id=>[id,positions[id]]));
}
export function getWeaponModConnectorPoints(host,mountIds){
 const positions=getWeaponModMountPositions(host),bottom=positions[mountIds.find(id=>id.startsWith("bottom-"))],barrel=mountIds.includes("barrel")&&positions.barrel;
 if(mountIds.length!==2 || !bottom || !barrel)return [];
 const from=[bottom.x*10,bottom.y*6-mountHalfSize],to=[barrel.x*10,barrel.y*6+mountHalfSize],middle=(from[1]+to[1])/2;
 return [from,[from[0],middle],[to[0],middle],to];
}
export function bindWeaponModSubtabs(root,app,{enabled=true,signal}={}){
 const nav=root.querySelector?.("[data-weapon-mod-tabs]");if(!nav)return null;
 tabBindings.get(nav)?.abort();const abort=new AbortController();tabBindings.set(nav,abort);
 signal?.addEventListener("abort",()=>abort.abort(),{once:true});nav.hidden=!enabled;
 const buttons=Array.from(nav.querySelectorAll("[data-weapon-mod-subtab]")),panes=Array.from(root.querySelectorAll("[data-weapon-mod-view]")),
  select=choice=>{
   if(enabled)viewSelections.set(app,choice);
   for(const pane of panes)pane.hidden=pane.dataset.weaponModView!==(enabled?choice:"upgrades");
   for(const button of buttons){const selected=enabled&&button.dataset.weaponModSubtab===choice;button.setAttribute("aria-selected",String(selected));button.setAttribute("tabindex",selected?"0":"-1");}
  };
 const current=enabled?(viewSelections.get(app)??"attachments"):"upgrades";select(current);
 nav.addEventListener("click",event=>{const button=event.target.closest("[data-weapon-mod-subtab]");if(!enabled || !button || !nav.contains(button))return;
  event.preventDefault();event.stopPropagation();select(button.dataset.weaponModSubtab);
 },{signal:abort.signal});
 nav.addEventListener("keydown",event=>{if(!enabled || !["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const index=buttons.findIndex(button=>button.dataset.weaponModSubtab===viewSelections.get(app)),
   next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
  select(buttons[next].dataset.weaponModSubtab);buttons[next].focus?.();
 },{signal:abort.signal});return current;
}
export function createWeaponModPanelHtml(item,projection,blueprint){
 const {host,attachments=[],modernizedParts=[],diagnostics=[]}=projection;
 if(!host || !blueprint)return "";
 const positions=getWeaponModMountPositions(host);
 const bounds=host.family==="advanced"?{x:240,y:180,w:520,h:250}:{x:110,y:180,w:650,h:250},
  scale=Math.min(bounds.w/blueprint.width,bounds.h/blueprint.height),image={w:blueprint.width*scale,h:blueprint.height*scale};
 image.x=bounds.x+(bounds.w-image.w)/2;image.y=bounds.y+(bounds.h-image.h)/2;
 const arrows=host.mountIds.map(id=>{const p=positions[id],anchor=blueprint.anchors[id],x=image.x+anchor.x*image.w,y=image.y+anchor.y*image.h,
   dx=x-p.x*10,dy=y-p.y*6,ratio=Math.min(1,mountHalfSize/Math.max(Math.abs(dx),Math.abs(dy)));return `<line x1="${p.x*10+dx*ratio}" y1="${p.y*6+dy*ratio}" x2="${x}" y2="${y}"/>`;}).join(""),
  links=attachments.map(child=>{const points=getWeaponModConnectorPoints(host,child.mountIds);return points.length?`<path data-wm-link="${escape(child.itemId)}" d="M${points.map(point=>point.join(",")).join(" L")}"/><g class="rm-wm__lock" data-wm-lock="${escape(child.itemId)}" transform="translate(${(points[1][0]+points[2][0])/2},${points[1][1]})"><path d="M-6,-2v-7a6,6 0 0 1 12,0v7"/><rect x="-10" y="-2" width="20" height="17" rx="2"/><path d="M0,4v5"/></g>`:"";}).join(""),
  slots=host.mountIds.map(id=>{
   const p=positions[id],child=attachments.find(child=>child.mountIds.includes(id)),primary=child?.mountIds[0]===id,document=child?.item,
    name=document?.name??child?.sourceId,
    content=child?`<img src="${escape(document?.img||"icons/svg/item-bag.svg")}" alt="" draggable="false">`:'<span class="rm-wm__empty" aria-hidden="true">＋</span>',
    tooltip=`${labels[id]}: ${child?name+(!primary?" (Связано)":""):"Пусто"}`;
   return `<button type="button" class="rm-wm__mount ${child?"is-filled":"is-empty"}" style="left:${p.x}%;top:${p.y}%" data-wm-mount="${id}" ${primary?`data-main-child="${escape(child.itemId)}"`:""} ${child?`data-wm-child="${escape(child.itemId)}"`:""} data-rm-tooltip="${escape(tooltip)}" aria-label="${escape(tooltip)}">${content}</button>`;
  }).join(""),
  counted=modernizedParts.filter(part=>part.profile?.countsTowardLimit!==false).length,
  parts=modernizedParts.map(part=>`<button type="button" class="rm-wm__part" data-wm-open="${escape(part.itemId)}">${escape(part.item?.name??part.sourceId)}${part.profile?.countsTowardLimit===false?" · вне лимита":""}</button>`).join(""),
  legacy=diagnostics.map(row=>`<li>${escape(row.reason??"Связь компонента требует сверки мастера.")}${row.itemId?` <button type="button" data-wm-legacy="${escape(row.itemId)}">Открыть / снять старый обвес</button>`:""}</li>`).join("");
 return `<section class="rm-wm" data-weapon-mod-panel data-host-id="${escape(item.id)}">
 <fieldset class="rm-wm__diagram"><legend>${escape(localize("REBREYA.WeaponMods.Title","Оружейные обвесы"))}</legend><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" class="rm-wm__arrows">${arrows}</svg><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" class="rm-wm__art"><image href="${escape(blueprint.img)}" x="${image.x}" y="${image.y}" width="${image.w}" height="${image.h}"/></svg><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" class="rm-wm__connections">${links}</svg>${slots}</fieldset>
 <p class="rm-wm__activation">Установка — бонусное действие · снятие — действие</p>
 ${host.family!=="crossbow"?`<div class="rm-wm__modern"><header><strong>Модернизированные части · ${counted}/3</strong><button type="button" data-wm-modern>${escape(localize("REBREYA.WeaponMods.Rebuild","Пересборка · 500 зм"))}</button></header><div class="rm-wm__parts">${parts||"Части не установлены"}</div></div>`:""}
 ${host.quantity!==1?'<p role="status">Для установки разделите оружие на отдельные экземпляры.</p>':""}${legacy?`<ul class="rm-wm__diagnostics">${legacy}</ul>`:""}
 <p class="rm-wm__status" data-wm-status role="status"></p></section>`;
}
export function renderWeaponModPanel(root,item,projection,blueprint){
 const container=root.querySelector(".sheet-body .tab[data-tab='mods']")??root.querySelector(".tab[data-tab='mods']")??root.querySelector("[data-application-part='mods']");
 if(!container)return null;container.querySelector("[data-weapon-mod-panel]")?.remove();
 const wrapper=document.createElement("div");wrapper.innerHTML=createWeaponModPanelHtml(item,projection,blueprint);const panel=wrapper.firstElementChild;
 const mount=container.querySelector("[data-weapon-mod-mount]");
 if(panel){if(mount)mount.replaceChildren(panel);else container.insertBefore(panel,container.querySelector("[data-rebreya-item-upgrades='true']"));}return panel;
}
async function choose(title,entries){
 if(!entries.length)throw Error("Нет доступных экземпляров.");if(entries.length===1)return entries[0].id;
 return foundry.applications.api.DialogV2.wait({window:{title},content:`<select name="choice">${entries.map(entry=>`<option value="${escape(entry.id)}">${escape(entry.name)}</option>`).join("")}</select>`,
  buttons:[{action:"apply",label:"Выбрать",callback:(_event,button)=>button.form.elements.namedItem("choice").value},{action:"cancel",label:"Отмена",callback:()=>null}],close:()=>null,rejectClose:false});
}
async function request(item,method,payload,api){
 let pending=requests.get(item);if(!pending){pending=new Map();requests.set(item,pending);}
 const key=JSON.stringify({method,...payload});let saved=pending.get(key);
 if(!saved){saved={...payload,operationId:crypto.randomUUID()};pending.set(key,saved);}
 const result=await api[method](saved);pending.delete(key);return result;
}
export function buildWeaponModContextActions(item,child,projection,api,{run=action=>action(),open=()=>child.sheet?.render?.({force:true})}={}){
 const actor=item.actor??item.parent,reverse=weaponModFlag(child,"installedWeaponMod"),legacy=weaponModFlag(child,"installedUpgrade"),sameActor=actor && (child.actor??child.parent)===actor,
  matches=link=>link?.hostItemId===item.id && (!link.hostActorId || link.hostActorId===actor?.id),
  weaponLinked=(projection.attachments??[]).some(entry=>entry.itemId===child.id) || weaponModFlag(item,"weaponMods")?.attachments?.some(entry=>entry.itemId===child.id),
  ordinaryLinked=weaponModFlag(item,"itemUpgrades")?.installed?.some(entry=>entry.itemId===child.id),
  actions=[{id:"open",label:"Открыть предмет",icon:"fa-solid fa-up-right-from-square",callback:open}];
 if(sameActor && weaponLinked && reverse?.kind==="weaponAttachment" && matches(reverse))actions.push({id:"remove-weapon",label:"Снять · действие",icon:"fa-solid fa-link-slash",
  callback:()=>run(()=>request(item,"removeWeaponAttachment",{actorUuid:actor.uuid,hostItemId:item.id,componentItemId:child.id},api))});
 else if(sameActor && ordinaryLinked && matches(legacy))actions.push({id:"remove-upgrade",label:"Снять старый обвес",icon:"fa-solid fa-link-slash",
  callback:()=>run(()=>api.removeItemUpgrade(item,child.id))});
 for(const activity of values(item.system?.activities).filter(activity=>activity.flags?.[MODULE_ID]?.weaponModActivity?.childItemId===child.id))actions.push({id:`activity-${activity.id??activity._id}`,label:activity.name,icon:"fa-solid fa-bolt",callback:()=>run(()=>activity.use())});
 return actions;
}
export async function installWeaponModWithChoices(item,component,api,{mountId=null,catalog=null,projection=null}={}){
 if(!owner(item))throw Error("Нет прав владельца оружия.");
 const actor=item.actor??item.parent;if((component.actor??component.parent)!==actor || actor.items.get(component.id)!==component)throw Error("Компонент должен находиться в инвентаре владельца оружия.");
 catalog??=await api.itemUpgradeService.getWeaponModCatalog();projection??=await api.itemUpgradeService.getWeaponModsProjection(item);
 const kind=getWeaponModCandidate(component,catalog).profile?.kind;if(!kind)throw Error("Нет проверенного правила обвеса.");
 const rows=buildWeaponModCatalogView({catalog,host:projection.host,installed:projection,inventory:values(actor.items),kind,mountId,isOwner:true}),
  row=rows.find(row=>row.sourceId===weaponModFlag(component,"gearId")),instance=row?.instances.find(instance=>instance.itemId===component.id);
 if(!instance?.available)throw Error(instance?.reason??row?.reason??"Экземпляр недоступен.");
 let removeItemId=null;
 if(kind==="modernizedPart"){
  if(instance.replacements?.length){
   removeItemId=await choose("Заменить одну модернизированную часть",instance.replacements.map(id=>({id,name:actor.items.get(id)?.name??id})));if(!removeItemId)return null;
  }
  const accepted=await foundry.applications.api.DialogV2.confirm({window:{title:"Пересборка оружия · 500 зм"},content:`<p>Установить «${escape(component.name)}» на «${escape(item.name)}»${removeItemId?` вместо «${escape(actor.items.get(removeItemId)?.name)}»`:""}? У владельца оружия будет списано 500 зм.</p>`,defaultYes:false});
  if(!accepted)return null;
 }
 const payload={actorUuid:actor.uuid,hostItemId:item.id,componentItemId:component.id,...(kind==="weaponAttachment"?{mountId}:{removeItemId})};
 return request(item,kind==="weaponAttachment"?"installWeaponAttachment":"installWeaponModernization",payload,api);
}
export function createWeaponModCatalogHtml(rows,kind,mountId){
 const owned=rows.filter(row=>row.ownedQuantity>0),missing=rows.filter(row=>!row.ownedQuantity),render=entries=>entries.map(row=>{
  const content=`<img src="${escape(row.img)}" alt=""><span>${escape(row.name)}</span>`,reference=row.documentUuid?`<a class="content-link rm-wm__reference" data-link data-type="Item" data-uuid="${escape(row.documentUuid)}" role="button" tabindex="0" draggable="false">${content}</a>`:`<span class="rm-wm__reference">${content}</span>`;
  return `<div class="rm-wm__choice ${row.ownedQuantity?"":"is-missing"}" role="listitem" title="${escape(row.reason)}">${reference}<small>${row.ownedQuantity?"×"+row.ownedQuantity:"Нет"}</small><button type="button" data-wm-choice="${escape(row.sourceId)}" ${row.available?"":"disabled"} aria-label="Установить ${escape(row.name)}" title="${escape(row.reason||"Установить")}">＋</button></div>`;
 }).join("");
 return `<header><strong>${kind==="modernizedPart"?"Модернизация · 500 зм":"Обвесы · "+labels[mountId]}</strong><button type="button" data-wm-close aria-label="Закрыть каталог">×</button></header><div class="rm-wm__catalog-rows"><h4>Есть в инвентаре</h4><div role="list">${render(owned)||`<p class="rm-wm__empty-owned">${kind==="modernizedPart"?"Нет подходящих частей в инвентаре":"Нет подходящих обвесов в инвентаре"}.</p>`}</div><hr><h4>Нет в инвентаре</h4><div role="list">${render(missing)||"<p>Нет отсутствующих вариантов.</p>"}</div></div>`;
}
export async function bindWeaponModPanel(root,app,api,{loadBlueprints=loadWeaponBlueprints,loadSourceItems=loadWeaponModSourceItems,resolveBlueprint=getWeaponBlueprint,render=renderWeaponModPanel,getDropData,resolveDropItem,rerender,openContextMenu}={}){
 const item=app?.item??app?.document??app?.object;if(!root?.querySelector || item?.type!=="weapon" || !api?.itemUpgradeService?.getWeaponModsProjection)return false;
 const previous=states.get(root);previous?.abort?.abort();const state={sequence:(previous?.sequence??0)+1,busy:false,abort:new AbortController()};states.set(root,state);
 const [catalog,projection]=await Promise.all([api.itemUpgradeService.getWeaponModCatalog(),api.itemUpgradeService.getWeaponModsProjection(item)]);
 if(states.get(root)!==state || root.isConnected===false)return false;
 if(!projection.host){bindWeaponModSubtabs(root,app,{enabled:false,signal:state.abort.signal});return false;}
 const [index,sourceItems]=await Promise.all([loadBlueprints(catalog.hosts),loadSourceItems(catalog)]);if(states.get(root)!==state || root.isConnected===false)return false;
 const panel=render(root,item,projection,resolveBlueprint(index,item,catalog));if(!panel)return false;
 bindWeaponModSubtabs(root,app,{signal:state.abort.signal});
 const actor=item.actor??item.parent,status=panel.querySelector("[data-wm-status]");
 let catalogAnchor=null,contextMenu=null,catalogListeners=null;
 const catalogOverlay=new AnchoredOverlay({ownerElement:root,resolveAnchor:()=>catalogAnchor,onClose:()=>{state.selection=null;catalogListeners?.abort();catalogListeners=null;}}),
  tooltips=bindAnchoredTooltips(root,panel.querySelectorAll("[data-wm-mount]"),{signal:state.abort.signal,className:"rm-wm-tooltip",preferredPlacement:"top",
   getText:target=>catalogOverlay.element || contextMenu?.isConnected ? "" : target.dataset.rmTooltip});
 state.abort.signal.addEventListener("abort",()=>catalogOverlay.destroy(),{once:true});
 const fresh=()=>states.get(root)===state && root.isConnected!==false && (app.item??app.document??app.object)===item;
 const run=async action=>{
  if(state.busy || !fresh())return;state.busy=true;panel.setAttribute("aria-busy","true");
  try{await action();if(fresh())await (rerender?.()??app.render?.({force:true}));}
  catch(error){if(fresh()){status.textContent=errorText(error);globalThis.ui?.notifications?.error?.(errorText(error));}}
  finally{state.busy=false;panel.removeAttribute("aria-busy");}
 };
 const open=id=>actor?.items.get(id)?.sheet?.render?.({force:true});
 const show=(kind,mountId=null,anchor)=>{
  tooltips.close();if(contextMenu?.isConnected)openContextMenu?.({actions:[]});contextMenu=null;catalogAnchor=anchor;
  catalogListeners?.abort();catalogListeners=new AbortController();
  state.selection={kind,mountId,rows:buildWeaponModCatalogView({catalog,host:projection.host,installed:projection,inventory:values(actor?.items),sourceItems,kind,mountId,isOwner:owner(item)})};
  const content=(root.ownerDocument??document).createElement("div");content.className="rm-wm rm-wm__catalog rm-context-menu";content.dataset.wmCatalog="true";
  content.innerHTML=createWeaponModCatalogHtml(state.selection.rows,kind,mountId);
  content.addEventListener("click",onClick,{signal:catalogListeners.signal});
  content.addEventListener("keydown",event=>{const reference=event.target.closest("a[data-link]");if(reference && ["Enter"," "].includes(event.key)){event.preventDefault();reference.click();}},{signal:catalogListeners.signal});
  catalogOverlay.show(content);
 };
 const context=(id,event,anchor)=>{
  const child=actor?.items.get(id);if(!child)return;
  if(!owner(item)){void open(id);return;}
  tooltips.close();catalogOverlay.close();const bounds=anchor?.getBoundingClientRect?.(),actions=buildWeaponModContextActions(item,child,projection,api,{run,open:()=>open(id)});
  contextMenu=openContextMenu?.({x:event.clientX??bounds?.right??0,y:event.clientY??bounds?.bottom??0,title:child.name,actions,signal:state.abort.signal});
 };
 const onClick=event=>{
  const reference=event.target.closest("a[data-link]");if(reference && catalogOverlay.element?.contains(reference)){catalogOverlay.close();return;}
  const button=event.target.closest("button");if(!button || (!panel.contains(button) && !catalogOverlay.element?.contains(button)))return;event.preventDefault();event.stopPropagation();
  if(button.hasAttribute("data-wm-close")){catalogOverlay.close();return;}
  if(button.dataset.wmOpen){void open(button.dataset.wmOpen);return;}
  if(button.dataset.wmLegacy){context(button.dataset.wmLegacy,event,button);return;}
  if(button.hasAttribute("data-wm-modern")){show("modernizedPart",null,button);return;}
  if(button.dataset.wmMount){if(button.dataset.wmChild)void open(button.dataset.wmChild);else show("weaponAttachment",button.dataset.wmMount,button);return;}
  if(button.dataset.wmChoice)void run(async()=>{
   const selection=state.selection,row=selection?.rows.find(row=>row.sourceId===button.dataset.wmChoice);if(!row?.available)throw Error(row?.reason??"Нет доступного обвеса.");
   const id=await choose("Выберите экземпляр",row.instances.filter(instance=>instance.available).map(instance=>({id:instance.itemId,name:`${instance.name} ×${instance.quantity} · ${instance.itemId}`})));
   if(!id || !fresh())return;const child=actor.items.get(id);if(!child)throw Error("Экземпляр уже отсутствует.");
   await installWeaponModWithChoices(item,child,api,{mountId:selection.mountId});catalogOverlay.close();
  });
 };
 panel.addEventListener("click",onClick,{signal:state.abort.signal});
 panel.addEventListener("contextmenu",event=>{
  const slot=event.target.closest("[data-wm-mount],[data-wm-legacy]");if(!slot)return;event.preventDefault();event.stopPropagation();
  if(slot.dataset.wmChild || slot.dataset.wmLegacy)context(slot.dataset.wmChild??slot.dataset.wmLegacy,event,slot);else show("weaponAttachment",slot.dataset.wmMount,slot);
 },{signal:state.abort.signal});
 const paintMounts=mounts=>panel.querySelectorAll("[data-wm-mount]").forEach(slot=>slot.classList.toggle("is-compatible",mounts.includes(slot.dataset.wmMount))),
  clearDrag=()=>{state.dragSequence=(state.dragSequence??0)+1;state.compatibleMounts=[];paintMounts([]);},
  previewDrag=async event=>{
   const sequence=state.dragSequence=(state.dragSequence??0)+1;state.compatibleMounts=[];paintMounts([]);
   try{
    const data=getDropData?.(event)??JSON.parse(event.dataTransfer?.getData("text/plain")||"{}"),
     child=resolveDropItem?await resolveDropItem(data):data.uuid?await fromUuid(data.uuid):actor?.items.get(data.id??data._id);
    if(!child || !fresh())return;const current=await api.itemUpgradeService.getWeaponModsProjection(item);
    if(!fresh() || sequence!==state.dragSequence || !current.host)return;
    state.compatibleMounts=getWeaponModCompatibleMounts(item,child,catalog,current);paintMounts(state.compatibleMounts);
   }catch{/* Protected browser drag data is unavailable until drop; do not guess a source. */}
  };
 if(typeof app.addEventListener==="function" && typeof app.removeEventListener==="function"){
  const closed=()=>state.abort.abort();app.addEventListener("close",closed,{once:true});
  state.abort.signal.addEventListener("abort",()=>app.removeEventListener("close",closed),{once:true});
  globalThis.document?.addEventListener("dragstart",event=>{if(fresh() && owner(item))void previewDrag(event);},{signal:state.abort.signal});
  globalThis.document?.addEventListener("dragend",clearDrag,{signal:state.abort.signal});
 }
 panel.addEventListener("dragleave",event=>{if(!panel.contains(event.relatedTarget))paintMounts([]);},{signal:state.abort.signal});
 panel.addEventListener("dragover",event=>{if(owner(item)){event.preventDefault();event.stopPropagation();paintMounts(state.compatibleMounts??[]);if(event.dataTransfer)event.dataTransfer.dropEffect="move";}},{signal:state.abort.signal});
 panel.addEventListener("keydown",event=>{
  if(event.key!=="ContextMenu" && !(event.shiftKey && event.key==="F10"))return;
  const slot=event.target.closest("[data-wm-mount]");if(!slot)return;event.preventDefault();
  if(slot.dataset.wmChild)context(slot.dataset.wmChild,event,slot);else show("weaponAttachment",slot.dataset.wmMount,slot);
 },{signal:state.abort.signal});
 panel.addEventListener("drop",event=>{
  event.preventDefault();event.stopPropagation();clearDrag();void run(async()=>{
   if(!owner(item))throw Error("Нет прав владельца оружия.");
   const data=getDropData?.(event)??JSON.parse(event.dataTransfer?.getData("text/plain")||"{}"),child=resolveDropItem?await resolveDropItem(data):data.uuid?await fromUuid(data.uuid):actor.items.get(data.id??data._id);
   if(!child)throw Error("Перетащите экземпляр из инвентаря персонажа.");
   await installWeaponModWithChoices(item,child,api,{mountId:event.target.closest("[data-wm-mount]")?.dataset.wmMount??null});
  });
 },{signal:state.abort.signal});
 return true;
}
