import {MODULE_ID} from "../constants.js";
import {getWeaponModCandidate} from "../data/weapon-mod-catalog.js?v=1.4.389";
import {weaponModFlag,validateWeaponAttachmentInstallation,validateModernizedPartInstallation} from "../data/weapon-mod-rules.js?v=1.4.389";
import {loadWeaponBlueprints,getWeaponBlueprint} from "../data/weapon-blueprints.js?v=1.4.389";
import {getItemHeldHands,isItemEquipped} from "./held-items.js?v=1.4.383";
const states=new WeakMap(),requests=new WeakMap(),values=collection=>Array.from(collection?.contents??collection?.values?.()??collection??[]);
const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const labels={top:"Верх","bottom-1":"Низ 1","bottom-2":"Низ 2","side-1":"Сторона 1","side-2":"Сторона 2",barrel:"Ствол"};
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
export function buildWeaponModCatalogView({catalog,host,installed,inventory,kind,mountId=null,isOwner}){
 return catalog.rows.filter(row=>row.profile.kind===kind).map(row=>{
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
  return {sourceId:row.sourceId,name:row.name,img:copies[0]?.img||row.img||"icons/svg/item-bag.svg",mechanics:row.profile.propertiesText??"",requirements:requirementsText(row.profile,catalog),ownedQuantity,instances,available,reason,availabilityRank:available?0:ownedQuantity>0?1:2};
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
 const positions={top:{x:50,y:19},"bottom-1":{x:host.family==="crossbow"?50:40,y:81},"bottom-2":{x:70,y:81},"side-1":{x:12,y:31},"side-2":{x:12,y:69},barrel:{x:88,y:45}};
 return Object.fromEntries(host.mountIds.map(id=>[id,positions[id]]));
}
export function createWeaponModPanelHtml(item,projection,blueprint){
 const {host,attachments=[],modernizedParts=[],diagnostics=[]}=projection;
 if(!host || !blueprint)return "";
 const positions=getWeaponModMountPositions(host);
 const bounds=host.family==="advanced"?{x:240,y:180,w:520,h:250}:{x:110,y:180,w:650,h:250},
  scale=Math.min(bounds.w/blueprint.width,bounds.h/blueprint.height),image={w:blueprint.width*scale,h:blueprint.height*scale};
 image.x=bounds.x+(bounds.w-image.w)/2;image.y=bounds.y+(bounds.h-image.h)/2;
 const arrows=host.mountIds.map(id=>{const p=positions[id],anchor=blueprint.anchors[id];return `<line x1="${p.x*10}" y1="${p.y*6}" x2="${image.x+anchor.x*image.w}" y2="${image.y+anchor.y*image.h}"/>`;}).join(""),
  slots=host.mountIds.map(id=>{
   const p=positions[id],child=attachments.find(child=>child.mountIds.includes(id)),primary=child?.mountIds[0]===id,document=child?.item,
    content=child?(primary?`<img src="${escape(document?.img||"icons/svg/item-bag.svg")}" alt=""><span>${escape(document?.name??child.sourceId)}</span>`:`<span class="rm-wm__linked">Связано: ${escape(document?.name??child.sourceId)}</span>`):'<span class="rm-wm__empty">＋ Пусто</span>';
   return `<button type="button" class="rm-wm__mount ${child?"is-filled":"is-empty"}" style="left:${p.x}%;top:${p.y}%" data-wm-mount="${id}" ${primary?`data-main-child="${escape(child.itemId)}"`:""} ${child?`data-wm-child="${escape(child.itemId)}"`:""} aria-label="${escape(labels[id]+(child?": "+(document?.name??child.sourceId):": выбрать обвес"))}"><strong>${labels[id]}</strong>${content}</button>`;
  }).join(""),
  counted=modernizedParts.filter(part=>part.profile?.countsTowardLimit!==false).length,
  parts=modernizedParts.map(part=>`<button type="button" class="rm-wm__part" data-wm-open="${escape(part.itemId)}">${escape(part.item?.name??part.sourceId)}${part.profile?.countsTowardLimit===false?" · вне лимита":""}</button>`).join(""),
  legacy=diagnostics.map(row=>`<li>${escape(row.reason??"Связь компонента требует сверки мастера.")}${row.itemId?` <button type="button" data-wm-legacy="${escape(row.itemId)}">Открыть / снять старый обвес</button>`:""}</li>`).join("");
 return `<section class="rm-wm" data-weapon-mod-panel data-host-id="${escape(item.id)}"><header class="rm-wm__header"><strong>${escape(localize("REBREYA.WeaponMods.Title","Оружейные обвесы"))}</strong><span>Установка — бонусное действие · снятие — действие</span></header>
 <div class="rm-wm__diagram"><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" class="rm-wm__arrows">${arrows}</svg><svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" class="rm-wm__art"><image href="${escape(blueprint.img)}" x="${image.x}" y="${image.y}" width="${image.w}" height="${image.h}"/></svg>${slots}</div>
 ${host.family!=="crossbow"?`<div class="rm-wm__modern"><header><strong>Модернизированные части · ${counted}/3</strong><button type="button" data-wm-modern>${escape(localize("REBREYA.WeaponMods.Rebuild","Пересборка · 500 зм"))}</button></header><p>Одна часть за пересборку. При полном лимите можно заменить одну часть.</p><div class="rm-wm__parts">${parts||"Части не установлены"}</div></div>`:""}
 ${host.quantity!==1?'<p role="status">Для установки разделите оружие на отдельные экземпляры.</p>':""}${legacy?`<ul class="rm-wm__diagnostics">${legacy}</ul>`:""}
 <div class="rm-wm__catalog" data-wm-catalog hidden></div><p class="rm-wm__status" data-wm-status role="status"></p></section>`;
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
function catalogHtml(rows,kind,mountId){
 return `<header><strong>${kind==="modernizedPart"?"Модернизация · 500 зм":"Обвесы · "+labels[mountId]}</strong><button type="button" data-wm-close aria-label="Закрыть каталог">×</button></header><div class="rm-wm__catalog-rows">${rows.map(row=>`<button type="button" class="rm-wm__choice ${row.availabilityRank===2?"is-missing":""}" data-wm-choice="${escape(row.sourceId)}" ${row.available?"":"disabled"} title="${escape(row.reason)}"><img src="${escape(row.img)}" alt=""><span><strong>${escape(row.name)}</strong><small>${row.ownedQuantity?"В инвентаре: "+row.ownedQuantity:"Нет в инвентаре"}${row.reason?" · "+escape(row.reason):""}</small><small>${escape(row.requirements)}</small><small>${escape(row.mechanics)}</small></span></button>`).join("")}</div>`;
}
export async function bindWeaponModPanel(root,app,api,{loadBlueprints=loadWeaponBlueprints,resolveBlueprint=getWeaponBlueprint,render=renderWeaponModPanel,getDropData,resolveDropItem,rerender}={}){
 const item=app?.item??app?.document??app?.object;if(!root?.querySelector || item?.type!=="weapon" || !api?.itemUpgradeService?.getWeaponModsProjection)return false;
 const previous=states.get(root);previous?.abort?.abort();const state={sequence:(previous?.sequence??0)+1,busy:false,abort:new AbortController()};states.set(root,state);
 const [catalog,projection]=await Promise.all([api.itemUpgradeService.getWeaponModCatalog(),api.itemUpgradeService.getWeaponModsProjection(item)]);
 if(!projection.host || states.get(root)!==state || root.isConnected===false)return false;
 const index=await loadBlueprints(catalog.hosts);if(states.get(root)!==state || root.isConnected===false)return false;
 const panel=render(root,item,projection,resolveBlueprint(index,item,catalog));if(!panel)return false;
 const actor=item.actor??item.parent,status=panel.querySelector("[data-wm-status]"),catalogNode=panel.querySelector("[data-wm-catalog]");
 const fresh=()=>states.get(root)===state && root.isConnected!==false && (app.item??app.document??app.object)===item;
 const run=async action=>{
  if(state.busy || !fresh())return;state.busy=true;panel.setAttribute("aria-busy","true");
  try{await action();if(fresh())await (rerender?.()??app.render?.({force:true}));}
  catch(error){if(fresh()){status.textContent=errorText(error);globalThis.ui?.notifications?.error?.(errorText(error));}}
  finally{state.busy=false;panel.removeAttribute("aria-busy");}
 };
 const open=id=>actor?.items.get(id)?.sheet?.render?.({force:true});
 const show=(kind,mountId=null)=>{
  state.selection={kind,mountId,rows:buildWeaponModCatalogView({catalog,host:projection.host,installed:projection,inventory:values(actor?.items),kind,mountId,isOwner:owner(item)})};
  catalogNode.innerHTML=catalogHtml(state.selection.rows,kind,mountId);catalogNode.hidden=false;
 };
 const context=async id=>{
  const child=actor?.items.get(id);if(!child)return;
  if(!owner(item)){await open(id);return;}
  const attachment=projection.attachments.find(child=>child.itemId===id),raw=weaponModFlag(child,"installedWeaponMod"),
   activities=values(item.system?.activities).filter(activity=>activity.flags?.[MODULE_ID]?.weaponModActivity?.childItemId===id),
   choices=[{id:"open",name:"Открыть предмет"},...(attachment || raw?.kind==="weaponAttachment"?[{id:"remove",name:"Снять · действие"}]:[]),...activities.map(activity=>({id:activity.id??activity._id,name:activity.name}))],
   choice=await choose(child.name,choices);
  if(choice==="open"){await open(id);return;}if(!choice)return;
  if(choice==="remove")await request(item,"removeWeaponAttachment",{actorUuid:actor.uuid,hostItemId:item.id,componentItemId:id},api);
  else {const activity=activities.find(activity=>(activity.id??activity._id)===choice);if(!activity)throw Error("Действие больше недоступно.");await activity.use();}
 };
 panel.addEventListener("click",event=>{
  const button=event.target.closest("button");if(!button || !panel.contains(button))return;event.preventDefault();event.stopPropagation();
  if(button.hasAttribute("data-wm-close")){catalogNode.hidden=true;return;}
  if(button.dataset.wmOpen){void open(button.dataset.wmOpen);return;}
  if(button.dataset.wmLegacy){void run(()=>context(button.dataset.wmLegacy));return;}
  if(button.hasAttribute("data-wm-modern")){show("modernizedPart");return;}
  if(button.dataset.wmMount){if(button.dataset.wmChild)void open(button.dataset.wmChild);else show("weaponAttachment",button.dataset.wmMount);return;}
  if(button.dataset.wmChoice)void run(async()=>{
   const selection=state.selection,row=selection?.rows.find(row=>row.sourceId===button.dataset.wmChoice);if(!row?.available)throw Error(row?.reason??"Нет доступного обвеса.");
   const id=await choose("Выберите экземпляр",row.instances.filter(instance=>instance.available).map(instance=>({id:instance.itemId,name:`${instance.name} ×${instance.quantity} · ${instance.itemId}`})));
   if(!id || !fresh())return;const child=actor.items.get(id);if(!child)throw Error("Экземпляр уже отсутствует.");
   await installWeaponModWithChoices(item,child,api,{mountId:selection.mountId});catalogNode.hidden=true;
  });
 },{signal:state.abort.signal});
 panel.addEventListener("contextmenu",event=>{
  const slot=event.target.closest("[data-wm-mount],[data-wm-legacy]");if(!slot)return;event.preventDefault();event.stopPropagation();
  if(slot.dataset.wmChild || slot.dataset.wmLegacy)void run(()=>context(slot.dataset.wmChild??slot.dataset.wmLegacy));else show("weaponAttachment",slot.dataset.wmMount);
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
  if(slot.dataset.wmChild)void run(()=>context(slot.dataset.wmChild));else show("weaponAttachment",slot.dataset.wmMount);
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
