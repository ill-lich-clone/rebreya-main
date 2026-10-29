import { MODULE_ID } from "../constants.js";
import { getUpgradeChoiceOptions, validateUpgradeChoices } from "./item-upgrade-choices.js?v=1.4.255";
import { loadUpgradeAutomationManifest, getUpgradeAvailability } from "./upgrade-automation-manifest.js?v=1.4.255";
import { resolveUpgradeProfile, validateUpgradeInstallation, validateUpgradeCapacity, UpgradeRuleError } from "./item-upgrade-rules.js?v=1.4.250";
import { isRebreyaWearableClothingGearId } from "./item-classification.js?v=1.4.292";
import { getItemHeldHands, isItemEquipped } from "../integrations/held-items.js?v=1.4.383";
import { loadWeaponModCatalog, getWeaponModCandidate } from "./weapon-mod-catalog.js?v=1.5.23";
import { getWeaponModHostDescriptor, getWeaponModEffectiveHost, readWeaponMods, weaponModFlag, validateWeaponAttachmentInstallation, WeaponModRuleError } from "./weapon-mod-rules.js?v=1.5.23";
import { getRuntimeWeaponModChildren } from "./runtime-item-graph.js?v=1.5.18";
import { ItemInstanceWorkflow } from "../application/item-instance-workflow.js?v=1.5.17";
import { ItemInstanceDocuments } from "../infrastructure/foundry/item-instance-documents.js?v=1.4.392";
import { planItemInstanceMutation } from "./item-instance-rules.js?v=1.4.379";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildWeaponRebuildQuote } from "./weapon-rebuild-rules.js?v=1.5.23";
import { resolveWeaponModActivity, getWeaponModGrenadeCandidate, buildWeaponModGrenadeActivity, reconcileWeaponModActivities } from "./weapon-mod-activities.js?v=1.5.23";

export const ITEM_UPGRADES_HOST_FLAG = "itemUpgrades";
export const INSTALLED_UPGRADE_FLAG = "installedUpgrade";
export const UPGRADE_HOLD_DURATION_MS = 3000;

const UPGRADE_EQUIPMENT_TYPE = "Усовершенствование";
const DEFAULT_UPGRADE_CAPACITY = 1;
const MAX_UPGRADE_CAPACITY = 3;
const WONDROUS_DND5E_TYPES = new Set(["wondrous", "staff", "rod", "wand"]);
const WONDROUS_SOURCE_TYPES = new Set(["чудесный предмет", "посох", "жезл", "волшебная палочка"]);

function getProperty(source, path) {
  return globalThis.foundry?.utils?.getProperty?.(source, path)
    ?? String(path ?? "").split(".").reduce((current, part) => (
      current && typeof current === "object" ? current[part] : undefined
    ), source);
}

function setProperty(source, path, value) {
  if (globalThis.foundry?.utils?.setProperty instanceof Function) {
    return globalThis.foundry.utils.setProperty(source, path, value);
  }

  const parts = String(path ?? "").split(".").filter(Boolean);
  let target = source;
  for (const part of parts.slice(0, -1)) {
    target = target[part] ??= {};
  }
  target[parts.at(-1)] = value;
  return true;
}

function deepClone(value) {
  if (globalThis.foundry?.utils?.deepClone instanceof Function) {
    return globalThis.foundry.utils.deepClone(value);
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function clampCapacity(value, fallback = DEFAULT_UPGRADE_CAPACITY) {
  const numericValue = Number(value ?? fallback);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(DEFAULT_UPGRADE_CAPACITY, Math.min(MAX_UPGRADE_CAPACITY, Math.floor(numericValue)));
}

function toPositiveInteger(value, fallback = 1) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(1, Math.floor(numericValue)) : fallback;
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  return [];
}

function getActorItems(actor) {
  return collectionValues(actor?.items);
}

function getItemActor(item) {
  return item?.actor ?? item?.parent ?? null;
}

function getItemId(item) {
  return cleanText(item?.id ?? item?._id);
}

function readModuleFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? getProperty(document, `flags.${MODULE_ID}.${key}`);
}

function getItemQuantity(item) {
  return Math.max(0, toPositiveInteger(getProperty(item, "system.quantity"), 1));
}

function normalizeInstalledEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  return value
    .map((entry, index) => ({
      itemId: cleanText(entry?.itemId ?? entry?.id ?? entry),
      slotIndex: toPositiveInteger(entry?.slotIndex ?? entry?.slot ?? index + 1, index + 1)
    }))
    .filter((entry) => {
      if (!entry.itemId || seen.has(entry.itemId)) {
        return false;
      }
      seen.add(entry.itemId);
      return true;
    })
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

export function getItemUpgradeHostState(hostItem) {
  const state = readModuleFlag(hostItem, ITEM_UPGRADES_HOST_FLAG) ?? {};
  const installed = normalizeInstalledEntries(state.installed);
  return {
    category: cleanText(state.category),
    capacity: clampCapacity(state.capacity, DEFAULT_UPGRADE_CAPACITY),
    installed
  };
}

export function getInstalledUpgradeItems(hostItem) {
  const actor = getItemActor(hostItem);
  const installed = getItemUpgradeHostState(hostItem).installed;
  return installed
    .map((entry) => getActorItems(actor).find((item) => getItemId(item) === entry.itemId) ?? null)
    .filter(Boolean);
}

export function isInstalledUpgradeItem(item) {
  const installedFlag = readModuleFlag(item, INSTALLED_UPGRADE_FLAG) ?? {};
  const hostItemId = cleanText(installedFlag.hostItemId);
  return Boolean(hostItemId && getProperty(item, "system.container"));
}

export function getInstalledActorUpgradeItemIds(actor) {
  return new Set(getActorItems(actor)
    .filter((item) => isInstalledUpgradeItem(item))
    .map((item) => getItemId(item))
    .filter(Boolean));
}

export function getItemUpgradeCategory(hostItem) {
  const type = cleanText(hostItem?.type).toLowerCase();
  const typeValue = cleanText(getProperty(hostItem, "system.type.value")).toLowerCase();
  const equipmentType = cleanText(readModuleFlag(hostItem, "equipmentType")).toLowerCase();
  const itemType = cleanText(readModuleFlag(hostItem, "itemType")).toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const gearId = cleanText(readModuleFlag(hostItem, "gearId"));

  if (type === "weapon") {
    return "weapon";
  }

  if (
    type === "equipment"
    && (["light", "medium", "heavy", "shield", "clothing"].includes(typeValue)
      || equipmentType.includes("доспех"))
  ) {
    return "outerwear";
  }

  if (
    type === "loot"
    && typeValue === "gear"
    && equipmentType === "снаряжение"
    && isRebreyaWearableClothingGearId(gearId)
  ) {
    return "outerwear";
  }

  if (WONDROUS_DND5E_TYPES.has(typeValue) || WONDROUS_SOURCE_TYPES.has(itemType)) {
    return "wondrous";
  }

  return "";
}

export function isUpgradeableHostItem(item) {
  return Boolean(getItemId(item) && getItemActor(item) && getItemUpgradeCategory(item) && !isUpgradeItem(item));
}

export function isUpgradeItem(item) {
  if (!item || !getItemId(item)) {
    return false;
  }

  const explicitFlag = readModuleFlag(item, "itemUpgradeTemplate")
    ?? readModuleFlag(item, "upgradeTemplate")
    ?? readModuleFlag(item, "upgrade");
  if (explicitFlag === true) {
    return true;
  }

  const equipmentType = cleanText(readModuleFlag(item, "equipmentType"));
  if (equipmentType === UPGRADE_EQUIPMENT_TYPE) {
    return true;
  }

  const subtype = cleanText(readModuleFlag(item, "foundrySubtype")).toLowerCase();
  return subtype === "upgrade";
}

function buildInstalledUpgradeFlag(hostItem, slotIndex) {
  return {
    hostActorId: cleanText(getItemActor(hostItem)?.id ?? getItemActor(hostItem)?._id),
    hostItemId: getItemId(hostItem),
    slotIndex,
    category: getItemUpgradeCategory(hostItem),
    installedAt: new Date().toISOString()
  };
}

function buildHostStatePatch(hostItem, installedEntries, capacity = null) {
  const current = getItemUpgradeHostState(hostItem);
  return {
    category: getItemUpgradeCategory(hostItem),
    capacity: clampCapacity(capacity ?? current.capacity, DEFAULT_UPGRADE_CAPACITY),
    installed: normalizeInstalledEntries(installedEntries)
  };
}

export function buildUpgradeHostDescriptor(item) {
  const category = getItemUpgradeCategory(item);
  const tags = new Set(category === "wondrous" ? ["wondrous-item"] : category ? [category] : []);
  const type = getProperty(item, "system.type.value");
  if (["light", "medium", "heavy"].includes(type)) tags.add("armor");
  if (type === "shield") tags.add("shield");
  if (item?.type === "weapon") {
    if (["simpleM", "martialM"].includes(type)) tags.add("melee");
    if (["simpleR", "martialR"].includes(type)) tags.add("ranged");
  }
  // Unrepresented material/shape qualifiers need explicit canonical metadata, never a name guess.
  const explicit = readModuleFlag(item, "upgradeCompatibilityTags");
  if (Array.isArray(explicit)) for (const tag of explicit) tags.add(tag);
  return { id: getItemId(item), compatibilityTags: [...tags], capacity: getItemUpgradeHostState(item).capacity,
    quantity: Number(getProperty(item, "system.quantity") ?? 1), isEquipped: isItemEquipped(item),
    isAttuned: getProperty(item, "system.attuned") === true, isHeld: isItemEquipped(item) && getItemHeldHands(item).length > 0,
    isBroken: ["broken", "destroyed"].includes(readModuleFlag(item, "durability")?.state) };
}

function resolveActorItem(actor, itemOrId) {
  if (!actor) {
    return null;
  }
  if (itemOrId && typeof itemOrId === "object") {
    return getItemActor(itemOrId) === actor ? actor.items?.get?.(getItemId(itemOrId)) ?? null : null;
  }
  const id = cleanText(itemOrId);
  if (!id) {
    return null;
  }
  return actor.items?.get?.(id)
    ?? getActorItems(actor).find((item) => getItemId(item) === id)
    ?? null;
}

export function profileSignature(profile) {
  return JSON.stringify(profile, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export class ItemUpgradeService {
  constructor(moduleApi = null, { getManifest = loadUpgradeAutomationManifest, getWeaponModCatalog = loadWeaponModCatalog } = {}) {
    this.moduleApi = moduleApi;
    this.getManifest = getManifest;
    this.getWeaponModCatalog = getWeaponModCatalog;
    this.resolveWeaponModGrenadeRule = context => this.moduleApi.combatAttackService.promptWeaponModGrenadeRule(context);
  }

  async getWeaponModsProjection(item) {
    const catalog=await this.getWeaponModCatalog(),actor=getItemActor(item),host=getWeaponModHostDescriptor(item,catalog);
    const state=readWeaponMods(item,id=>actor?.items?.get(id),catalog);
    const catalogue=catalog.rows.map(row=>{
      const owned=getActorItems(actor).filter(child=>weaponModFlag(child,"gearId")===row.sourceId && !weaponModFlag(child,"installedWeaponMod")?.hostItemId
        && !weaponModFlag(child,INSTALLED_UPGRADE_FLAG)?.hostItemId);
      return {...row,itemIds:owned.map(child=>child.id),quantity:owned.reduce((sum,child)=>sum+Number(child.system.quantity??0),0)};
    });
    const diagnostics=actor?this.moduleApi?.itemUpgradeAutomationService?.project?.(actor,item)?.diagnostics??state.diagnostics:state.diagnostics;
    return {host:getWeaponModEffectiveHost(host,state.modernizedParts),...state,diagnostics,catalogue};
  }

  installWeaponAttachment(host,component,options={}) { return this.#mutateWeaponMod("install",host,component,options); }
  removeWeaponAttachment(host,componentOrId,options={}) { return this.#mutateWeaponMod("remove",host,componentOrId,options); }
  installWeaponModernization(host,component,options={}) { return this.#mutateWeaponMod("modernize",host,component,options); }
  applyWeaponModernization(host,component,options={}) { return this.installWeaponModernization(host,component,options); }

  async useWeaponModActivity(payload,{sender=globalThis.game?.user,assertAuthority=null}={}) {
    const authorityId=globalThis.game?.user?.id,guard=()=>{
      if(!isActiveGmClient(globalThis.game) || globalThis.game.user.id!==authorityId)throw new Error("Активный мастер изменился.");
      return assertAuthority?.();
    };
    guard();
    if(payload.decision?.kind==="target-effects")return this.moduleApi.combatAttackService.resolveWeaponModTargetEffects(payload,{sender,assertAuthority:guard});
    if(payload.decision?.kind==="scatter")return this.moduleApi.combatAttackService.resolveWeaponModScatter(payload,{sender,assertAuthority:guard});
    const intent={...payload,mode:"weapon-mod-activity",sourceActorUuid:payload.actorUuid,destinationActorUuid:payload.actorUuid};
    const documents=new ItemInstanceDocuments(),workflow=new ItemInstanceWorkflow({documents,journal:this.moduleApi.inventoryService.mutationJournal,coordinator:this.moduleApi.inventoryService.mutationCoordinator});
    const result=await workflow.runBatch(intent,{sender,assertAuthority:guard,authorize:({sourceActor:actor})=>{
      if(!(sender?.id && (sender.isGM || actor.testUserPermission?.(sender,"OWNER"))))throw new Error("Недостаточно прав на оружие.");
    },prepareBatch:async(actors,operation)=>{
      const actor=actors.sourceActor;
      const host=actor.items.get(payload.hostItemId),catalog=await this.getWeaponModCatalog();
      if(!host || Number(host.system.quantity)!==1)throw new Error("Оружие больше недоступно.");
      const mods=readWeaponMods(host,id=>actor.items.get(id),catalog),definition=resolveWeaponModActivity(host,mods,payload,{sources:catalog.gearById});
      let prepared;
      if(["launcher-fire","launcher-shot"].includes(definition.marker.action))prepared=await this.#prepareWeaponModLauncherShot({actor,host,definition,payload,intent,operation,catalog,sender});
      else if(definition.marker.action==="launcher-load")prepared=await this.#prepareWeaponModLauncherLoad({actor,actors,host,definition,payload,intent,operation,documents,catalog});
      else {
        const plan=await this.moduleApi.combatAttackService.planWeaponModActivity({actor,host,definition,decision:payload.decision,sender});
        prepared={steps:[{intent,plan:{kind:"placement",preserveSourceId:true},placement:plan.placement}],value:plan.value};
      }
      return {...prepared,value:{...prepared.value,hostName:host.name,componentName:definition.mod.item.name,
        activation:structuredClone(host.system.activities.get?.(payload.activityId)?.activation??host.system.activities[payload.activityId]?.activation)}};
    }});
    if(!result.shot)await this.#publishWeaponModAction(intent,result,sender,guard);
    if(result.shot?.phase==="published")await this.#cleanupWeaponModGrenade(payload.actorUuid,result.shot,guard);
    await this.moduleApi.itemUpgradeAutomationService?.requestSync?.(payload.actorUuid);
    return result;
  }

  async #prepareWeaponModLauncherShot({actor,host,definition,payload,intent,operation,catalog,sender}){
    const decision=payload.decision,path=`flags.${MODULE_ID}.weaponModShot`,before=weaponModFlag(host,"weaponModShot")??null,
      placement=[],launcher=definition.mod.item,options={sources:catalog.gearById,allowedSourceIds:definition.effect.grenadeSourceIds};
    let shot,grenadeSource;
    if(definition.marker.action==="launcher-fire" && decision?.kind==="launcher-prepare"){
      if(before?.phase==="consumed")throw new Error("Сначала восстановите карточку предыдущего выстрела.");
      const grenade=actor.items.get(decision.grenadeItemId),candidate=getWeaponModGrenadeCandidate(grenade,options);
      if(!candidate.available || candidate.quantity!==1 || grenade.system.container!==launcher.id)throw new Error("Выберите одну загруженную гранату.");
      const source=catalog.gearById.get(candidate.sourceId),rule=await this.resolveWeaponModGrenadeRule({actor,host,launcher,source});
      if(!rule){const error=new Error("Выстрел отменён мастером; граната не израсходована.");error.code="weapon-mod-cancelled";throw error;}
      const data=buildWeaponModGrenadeActivity(definition.marker,source,rule),raw=host.toObject().system.activities,
        current=raw instanceof Map?[...raw.values()]:Object.values(raw??{}),matched=current.find(entry=>entry._id===data._id),
        reconciled=reconcileWeaponModActivities(matched?[matched]:[],[data]);
      if(reconciled.diagnostics.length)throw new Error("Сохранена авторская формула гранаты; нужна сверка мастера.");
      const activities={...Object.fromEntries(current.map(entry=>[entry._id,entry])),[data._id]:reconciled.activities[0]},profilesPath=`flags.${MODULE_ID}.weaponModGrenadeActivities`,profiles=weaponModFlag(host,"weaponModGrenadeActivities")??[],
        profile={childItemId:launcher.id,projectileSourceId:source.id,profileSignature:profileSignature(source.explosive),rule,approvedByUserId:globalThis.game.user.id,approvalReceiptId:operation.id};
      shot={phase:"prepared",actorUuid:actor.uuid,hostItemId:host.id,childItemId:launcher.id,grenadeItemId:grenade.id,projectileSourceId:source.id,
        profileSignature:profile.profileSignature,rule,approvedByUserId:profile.approvedByUserId,approvalReceiptId:operation.id,ownerUserId:sender.id,
        prepareOperationId:payload.operationId,activityId:data._id,cardId:createStableGearDocumentId(`weapon-mod-shot:${actor.uuid}:${sender.id}:${payload.operationId}`)};
      grenadeSource=grenade.toObject();
      placement.push({actor:"source",itemId:host.id,before:{"system.activities":raw,[profilesPath]:profiles.length?profiles:null},
        after:{"system.activities":activities,[profilesPath]:[...profiles.filter(entry=>!(entry.childItemId===profile.childItemId && entry.projectileSourceId===profile.projectileSourceId && profileSignature(entry.rule)===profileSignature(rule))),profile]}});
    }else{
      if(!before || before.actorUuid!==actor.uuid || before.hostItemId!==host.id || before.childItemId!==launcher.id || before.ownerUserId!==sender.id
        || before.activityId!==payload.activityId || before.prepareOperationId!==decision?.prepareOperationId)throw new Error("Подготовленный выстрел изменился.");
      const approval=await this.moduleApi.inventoryService.mutationJournal.find(before.approvalReceiptId);
      if(!approval?.terminal || !approval.result?.ok || profileSignature(approval.result.value.shot)!==profileSignature({...before,phase:"prepared"}))throw new Error("Нет подтверждённого решения мастера для этого выстрела.");
      if(decision.kind==="launcher-consume"){
        if(before.phase!=="prepared" || before.grenadeItemId!==decision.grenadeItemId)throw new Error("Граната этого выстрела уже израсходована.");
        const grenade=actor.items.get(before.grenadeItemId),candidate=getWeaponModGrenadeCandidate(grenade,options);
        if(!candidate.available || candidate.quantity!==1 || grenade.system.container!==launcher.id || candidate.sourceId!==before.projectileSourceId
          || profileSignature(candidate.profile)!==before.profileSignature)throw new Error("Загруженная граната изменилась.");
        const raw=grenade.toObject(),after=deepClone(raw);
        if(this.#weaponModGrenadeSignature(raw)!==this.#weaponModGrenadeSignature(approval.result.value.grenadeSource))throw new Error("Экземпляр гранаты изменён после подготовки выстрела.");
        shot={...before,phase:"consumed"};
        after.system.quantity=0;after.system.container=null;after.flags[MODULE_ID].weaponModSpent={prepareOperationId:shot.prepareOperationId,cardId:shot.cardId,sourceId:shot.projectileSourceId};
        const fields=data=>Object.fromEntries(["name","type","img","system","effects","flags","sort","folder"].filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]]));
        placement.push({actor:"source",itemId:grenade.id,before:fields(raw),after:fields(after)});
      }else if(decision.kind==="launcher-ack"){
        const card=globalThis.game.messages?.get?.(decision.cardId),record=card?.getFlag?.(MODULE_ID,"weaponModShot")??card?.flags?.[MODULE_ID]?.weaponModShot;
        if(before.phase!=="consumed" || decision.cardId!==before.cardId || profileSignature(record)!==profileSignature(before))throw new Error("Не подтверждена нативная карточка этого выстрела.");
        shot={...before,phase:"published"};
      }else throw new Error("Неизвестное действие гранатомёта.");
    }
    placement.push({actor:"source",itemId:host.id,before:{[path]:before},after:{[path]:shot}});
    return {steps:[{intent,plan:{kind:"placement",preserveSourceId:true},placement}],value:{hostItemId:host.id,childItemId:launcher.id,action:decision.kind,shot,...(grenadeSource?{grenadeSource}:{})}};
  }

  #weaponModGrenadeSignature(data){
    const source=deepClone(data);if(!source)return null;
    delete source._stats;if(source.folder==null)delete source.folder;if(!source.system?.container)delete source.system.container;
    return profileSignature(source);
  }

  async #cleanupWeaponModGrenade(actorUuid,shot,guard){
    guard();const actor=await globalThis.fromUuid(actorUuid),grenade=actor?.items.get(shot.grenadeItemId);
    if(!grenade)return;
    const expected={prepareOperationId:shot.prepareOperationId,cardId:shot.cardId,sourceId:shot.projectileSourceId};
    const approval=await this.moduleApi.inventoryService.mutationJournal.find(shot.approvalReceiptId),snapshot=deepClone(approval?.result?.value?.grenadeSource);
    if(!snapshot)throw new Error("Нет исходного экземпляра гранаты для сверки.");
    snapshot.system.quantity=0;snapshot.system.container=null;snapshot.flags[MODULE_ID].weaponModSpent=expected;
    if(Number(grenade.system.quantity)!==0 || grenade.system.container || weaponModFlag(grenade,"gearId")!==shot.projectileSourceId
      || this.#weaponModGrenadeSignature(grenade.toObject())!==this.#weaponModGrenadeSignature(snapshot))throw new Error("Израсходованная граната изменена; требуется сверка мастера.");
    guard();try{await grenade.delete();}catch(error){guard();if(actor.items.get(shot.grenadeItemId))throw error;}guard();
  }

  async #prepareWeaponModLauncherLoad({actor,actors,host,definition,payload,intent,operation,documents,catalog}){
    const grenade=payload.decision?.kind==="launcher-load"?actor.items.get(payload.decision.grenadeItemId):null,launcher=definition.mod.item,
      options={sources:catalog.gearById,allowedSourceIds:definition.effect.grenadeSourceIds},candidate=getWeaponModGrenadeCandidate(grenade,options),items=getActorItems(actor);
    if(!grenade || !candidate.available || !Number.isSafeInteger(candidate.quantity) || candidate.quantity<1
      || weaponModFlag(grenade,"installedWeaponMod") || weaponModFlag(grenade,INSTALLED_UPGRADE_FLAG)
      || weaponModFlag(actor.items.get(grenade.system.container),"installedWeaponMod")
      || grenade.system.container===launcher.id || items.some(item=>item.system?.container===grenade.id))throw new Error(candidate.reason||"Выберите доступную гранату в инвентаре владельца.");
    const loaded=items.filter(item=>item.system?.container===launcher.id);
    if(loaded.some(item=>!getWeaponModGrenadeCandidate(item,options).available || !Number.isSafeInteger(Number(item.system.quantity)) || Number(item.system.quantity)<1))throw new Error("Содержимое гранатомёта требует проверки мастера.");
    const count=loaded.reduce((sum,item)=>sum+Number(item.system.quantity),0);
    if(count>=definition.effect.capacity)throw new Error("Гранатомёт вмещает до 6 гранат.");
    const childIntent={...intent,sourceItemId:grenade.id,quantity:1,targetFolderId:null,heroSlotId:null,expectedSourceQuantity:null},source=await documents.readSource(childIntent,actors),
      plan=planItemInstanceMutation({source,quantity:1,sameActor:true,sameFolder:false,forHeroSlot:false}),prepared=await documents.prepare(childIntent,plan,source,{
        preparePlacement:({itemId})=>[{actor:"source",itemId,before:{"system.container":grenade.system.container??null},after:{"system.container":launcher.id}}]
      },operation);
    return {steps:[{...prepared,intent:childIntent,plan}],value:{hostItemId:host.id,childItemId:launcher.id,grenadeItemId:prepared.itemId,loaded:count+1,action:"launcher-load"}};
  }

  async approveWeaponModernization(payload,{sender=globalThis.game?.user,assertAuthority=null}={}){
    const authorityId=globalThis.game?.user?.id,guard=()=>{
      if(!isActiveGmClient(globalThis.game) || globalThis.game.user.id!==authorityId)throw new Error("Активный мастер изменился.");
      return assertAuthority?.();
    };
    guard();if(!sender?.isGM)throw new Error("Применимость модернизации подтверждает мастер.");
    const {actorUuid,hostItemId,sourceId,profileSignature,operationId}=payload;
    const documents=new ItemInstanceDocuments(),workflow=new ItemInstanceWorkflow({documents,journal:this.moduleApi.inventoryService.mutationJournal,
      coordinator:this.moduleApi.inventoryService.mutationCoordinator});
    const intent={...payload,sourceActorUuid:actorUuid,destinationActorUuid:actorUuid,mode:"weapon-mod-approve"};
    return workflow.runBatch(intent,{sender,assertAuthority:guard,authorize:()=>{if(!sender?.isGM)throw new Error("Требуется мастер.");},
      prepareBatch:async({sourceActor:actor},operation)=>{
        const host=actor.items.get(hostItemId),catalog=await this.getWeaponModCatalog(),row=catalog.rows.find(row=>row.sourceId===sourceId);
        if(!host || !getWeaponModHostDescriptor(host,catalog) || !row?.available || row.profile.kind!=="modernizedPart" || row.profileSignature!==profileSignature)throw new WeaponModRuleError("unavailable");
        getRuntimeWeaponModChildren(host,getActorItems(actor));
        const before=weaponModFlag(host,"weaponMods")??null,state=deepClone(before??{version:1,attachments:[],modernizedParts:[],approvals:[]});
        const approval={actorUuid,hostItemId,sourceId,profileSignature,operationId,approvedByUserId:sender.id,approvalReceiptId:operation.id};
        state.approvals=[...(state.approvals??[]).filter(entry=>entry.operationId!==operationId),approval];
        const path=`flags.${MODULE_ID}.weaponMods`;
        return {steps:[{intent,plan:{kind:"placement",preserveSourceId:true},placement:[{actor:"source",itemId:hostItemId,before:{[path]:before},after:{[path]:state}}]}],value:approval};
      }});
  }

  async #mutateWeaponMod(mode,host,componentOrId,{operationId,mountId=null,mountIds=null,removeItemId=null,approvalReceiptId=null,sender=globalThis.game?.user,assertAuthority=null}={}) {
    const actor=getItemActor(host),componentId=typeof componentOrId==="string"?componentOrId:getItemId(componentOrId),authorityId=globalThis.game?.user?.id;
    const guard=()=>{
      if(!isActiveGmClient(globalThis.game) || globalThis.game.user.id!==authorityId)throw new Error("Активный мастер изменился. Повторите операцию.");
      return assertAuthority?.();
    };
    guard();
    if(typeof operationId!=="string" || !operationId.trim() || operationId.length>256 || !actor?.uuid || !componentId)throw new WeaponModRuleError("unavailable");
    if(typeof componentOrId!=="string" && getItemActor(componentOrId)!==actor)throw new WeaponModRuleError("unavailable");
    const documents=new ItemInstanceDocuments(),workflow=new ItemInstanceWorkflow({documents,
      journal:this.moduleApi.inventoryService.mutationJournal,coordinator:this.moduleApi.inventoryService.mutationCoordinator});
    const intent={operationId,mode:`weapon-mod-${mode}`,sourceActorUuid:actor.uuid,destinationActorUuid:actor.uuid,
      sourceItemId:componentId,hostItemId:getItemId(host),mountId,...(mountIds===null?{}:{mountIds}),removeItemId};
    const result=await workflow.runBatch(intent,{sender,assertAuthority:guard,suppressItemRenders:true,
      authorize:({sourceActor})=>{
        if(!(sender?.id && (sender.isGM || sourceActor.testUserPermission?.(sender,"OWNER"))))throw new Error("Недостаточно прав для изменения оружия.");
      },
      prepareBatch:async(actors,operation)=>{
        const current=actors.sourceActor.items.get(intent.hostItemId),component=actors.sourceActor.items.get(componentId);
        if(!current || !component || current===component || Number(current.system.quantity)!==1)throw new WeaponModRuleError("invalid-quantity");
        const catalog=await this.getWeaponModCatalog(),modHost=getWeaponModHostDescriptor(current,catalog),items=getActorItems(actor);
        if(!modHost)throw new WeaponModRuleError("incompatible");
        getRuntimeWeaponModChildren(current,items);
        const before=weaponModFlag(current,"weaponMods")??null,state=deepClone(before??{version:1,attachments:[],modernizedParts:[],approvals:[]}),steps=[];
        const patch=(item,beforeFields,after)=>({actor:"source",itemId:item.id,before:beforeFields,after});
        const statePath=`flags.${MODULE_ID}.weaponMods`,linkPath=`flags.${MODULE_ID}.installedWeaponMod`;
        let itemId=componentId,sourceRemaining=Number(component.system.quantity);
        if(mode==="remove"){
          const link=state.attachments.find(entry=>entry.itemId===componentId);
          if(!link || weaponModFlag(component,"installedWeaponMod")?.kind!=="weaponAttachment")throw new WeaponModRuleError("unavailable");
          state.attachments=state.attachments.filter(entry=>entry.itemId!==componentId);
          steps.push({intent,plan:{kind:"placement",preserveSourceId:true},placement:[
            patch(component,{"system.container":component.system.container??null,[linkPath]:weaponModFlag(component,"installedWeaponMod")??null},{"system.container":null,[linkPath]:null}),
            patch(current,{[statePath]:before},{[statePath]:state})]});
        }else{
          if(isItemEquipped(component) && getItemHeldHands(component).length)throw new WeaponModRuleError("component-held");
          if(weaponModFlag(component,"installedWeaponMod")?.hostItemId || weaponModFlag(component,INSTALLED_UPGRADE_FLAG)?.hostItemId
            || items.some(child=>child.system?.container===component.id))throw new WeaponModRuleError("slot-conflict");
          const candidate=getWeaponModCandidate(component,catalog);let mounts=[];
          if(mode==="install")mounts=validateWeaponAttachmentInstallation(getWeaponModEffectiveHost(modHost,readWeaponMods(current,id=>actor.items.get(id),catalog).modernizedParts),state.attachments,candidate,{mountId,mountIds,freeMounts:modHost.freeMounts}).mountIds;
          else{
            const projection=readWeaponMods(current,id=>actor.items.get(id),catalog);
            if(projection.diagnostics.length)throw new WeaponModRuleError("slot-conflict");
            const approvalId=approvalReceiptId??state.approvals?.find(entry=>entry.operationId===operationId && entry.sourceId===candidate.sourceId)?.approvalReceiptId;
            const audit=approvalId?await this.moduleApi.inventoryService.mutationJournal.find(approvalId):null;
            const approval=audit?.terminal && audit.result?.ok && audit.kind==="item-instance-v1" && audit.intent?.mode==="weapon-mod-approve"?audit.result.value:null;
            const gmApproval=Boolean(approval && approval.approvedByUserId && approval.actorUuid===actor.uuid && approval.hostItemId===current.id
              && approval.sourceId===candidate.sourceId && approval.profileSignature===candidate.profileSignature && approval.operationId===operationId);
            const quote=buildWeaponRebuildQuote({host:modHost,component:candidate,parts:projection.modernizedParts,attachments:projection.attachments,removeItemId,gmApproval,
              currency:actor.toObject().system?.currency});
            steps.push({intent,plan:{kind:"placement",preserveSourceId:true},placement:[{actor:"source",before:{"system.currency":quote.currencyBefore},after:{"system.currency":quote.currencyAfter}}]});
            const ammoPlan=await this.moduleApi.combatAttackService?.planWeaponAmmoReconfiguration?.(actor,current,
              {modernizedParts:[...projection.modernizedParts.filter(part=>part.itemId!==removeItemId),candidate]});
            if(!ammoPlan)throw new Error("Планирование боеприпасов недоступно; пересборка не изменена.");
            for(const [index,creation] of ammoPlan.creates.entries()){
              const createId=`${operation.id}:ammo-refund:${index}`,targetData=deepClone(creation.data),targetId=createStableGearDocumentId(createId);
              targetData._id=targetId;targetData.flags??={};targetData.flags[MODULE_ID]??={};
              targetData.flags[MODULE_ID].itemInstanceOrigin={id:createId,fingerprint:operation.fingerprint};
              steps.push({intent:{...intent,sourceItemId:current.id},itemId:targetId,targetData,
                plan:{kind:"create",quantity:targetData.system.quantity,sourceRemaining:1,preserveSourceId:false},sourceBefore:1,
                sourceMarkerBefore:weaponModFlag(current,"itemInstanceDebit")??null,sourceMarkerAfter:{id:createId},placement:[]});
            }
            if(ammoPlan.updates.length)steps.push({intent,plan:{kind:"placement",preserveSourceId:true},
              placement:ammoPlan.updates.map(({itemId,patch:after})=>({actor:"source",itemId,before:ammoPlan.before[itemId],after}))});
            if(removeItemId){
              const old=actor.items.get(removeItemId);
              steps.push({intent,plan:{kind:"placement",preserveSourceId:true},placement:[patch(old,
                {"system.container":old.system.container??null,[linkPath]:weaponModFlag(old,"installedWeaponMod")??null},{"system.container":null,[linkPath]:null})]});
              state.modernizedParts=state.modernizedParts.filter(entry=>entry.itemId!==removeItemId);
            }
          }
          const childIntent={...intent,quantity:1,targetFolderId:null,heroSlotId:null,expectedSourceQuantity:null},source=await documents.readSource(childIntent,actors);
          const plan=planItemInstanceMutation({source,quantity:1,sameActor:true,sameFolder:false,forHeroSlot:false});
          const prepared=await documents.prepare(childIntent,plan,source,{preparePlacement:({itemId:targetId})=>{
            state[mode==="install"?"attachments":"modernizedParts"].push({itemId:targetId,sourceId:candidate.sourceId,...(mode==="install"?{mountIds:mounts,...(modHost.freeMounts?{freeMounts:true}:{})}:{})});
            const reverse={version:1,kind:candidate.profile.kind,hostActorId:actor.id,hostItemId:current.id,mountIds:mounts,...(mode==="install" && modHost.freeMounts?{freeMounts:true}:{})};
            return [patch({id:targetId},{"system.container":component.system.container??null,[linkPath]:null},{"system.container":current.id,[linkPath]:reverse}),
              patch(current,{[statePath]:before},{[statePath]:state})];
          }},operation);
          itemId=prepared.itemId;sourceRemaining=plan.sourceRemaining;
          steps.push({...prepared,intent:childIntent,plan});
        }
        return {steps,value:{itemId,sourceRemaining,changed:true,hostName:current.name,componentName:component.name}};
      }});
    await this.#publishWeaponModAction(intent,result,sender,guard);
    await this.moduleApi.itemUpgradeAutomationService?.requestSync?.(actor);
    return result;
  }

  async #publishWeaponModAction(intent,result,sender,guard){
    const id=createStableGearDocumentId(`weapon-mod-card:${sender.id}:${intent.mode}:${intent.operationId}`),existing=()=>globalThis.game?.messages?.get?.(id);
    if(existing())return;
    const modernize=intent.mode==="weapon-mod-modernize",utility=intent.mode==="weapon-mod-activity",activation=utility?result.activation:{type:modernize?"special":intent.mode==="weapon-mod-install"?"bonus":"action",value:modernize?0:1};
    const labels={aim:"прицеливание","stop-aim":"прицеливание прекращено","flashlight-toggle":result.enabled?"фонарик включён":"фонарик выключен","launcher-load":"заряжена одна граната"};
    const escape=value=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
    const data={_id:id,speaker:{actor:intent.sourceActorUuid.split(".").at(-1)},content:`<p>${escape(result.hostName)}: ${escape(result.componentName)} — ${utility?escape(labels[result.action]??result.action):modernize?"пересборка, списано 500 зм":activation.type==="bonus"?"установка, бонусное действие":"снятие, действие"}.</p>`,
      flags:{[MODULE_ID]:{weaponModAction:{operationId:intent.operationId,activation,...(modernize?{costCp:50000}:{}),hostItemId:intent.hostItemId,componentItemId:result.itemId}}}};
    guard();
    try{await globalThis.ChatMessage.create(data,{keepId:true});}catch(error){guard();if(!existing())throw error;}
    guard();
  }

  async getUpgradeProjection(item) {
    const manifest = await this.getManifest();
    const sourceId = cleanText(readModuleFlag(item, "gearId"));
    const row = manifest.find(row => row.gearId === sourceId);
    const stored = readModuleFlag(item, "upgrade");
    const profile = resolveUpgradeProfile(stored, row?.profile);
    const legacyOverride = Boolean(stored && typeof stored === "object" && !Array.isArray(stored)
      && profileSignature(stored) !== profileSignature(row?.profile));
    const availability = getUpgradeAvailability(sourceId, manifest);
    if (legacyOverride) Object.assign(availability, { available: false, decision: "unavailable-no-rule",
      label: "Усовершенствования нет в реализации", reason: "Сохранён пользовательский профиль; его полная автоматизация не подтверждена." });
    const choices = readModuleFlag(item, "upgradeChoices"), choiceOptions = getUpgradeChoiceOptions(sourceId);
    let requiresChoice = false;
    try { validateUpgradeChoices(sourceId, choices); } catch { requiresChoice = true; }
    return { sourceId, profile, availability, legacyOverride, choices, choiceOptions, requiresChoice };
  }

  installUpgrade(hostItem, upgradeItem, options = {}) {
    return this.installItemUpgrade(hostItem, upgradeItem, options);
  }

  removeUpgrade(hostItem, upgradeItemOrId) {
    return this.removeItemUpgrade(hostItem, upgradeItemOrId);
  }

  setUpgradeCapacity(hostItem, capacity) {
    return this.setItemUpgradeCapacity(hostItem, capacity);
  }

  async installItemUpgrade(hostItem, upgradeItem, options = {}) {
    const actor = getItemActor(hostItem);
    if (!actor?.isOwner) {
      throw new Error("Недостаточно прав для изменения предмета.");
    }
    if (!isUpgradeableHostItem(hostItem)) {
      throw new Error("Этот предмет нельзя усовершенствовать.");
    }
    if (!isUpgradeItem(upgradeItem)) {
      throw new Error("Перетащите предмет-усовершенствование.");
    }
    if (getItemActor(upgradeItem) !== actor) {
      throw new Error("Усовершенствование должно быть в инвентаре того же персонажа.");
    }

    const projection = await this.getUpgradeProjection(upgradeItem);
    const hostState = getItemUpgradeHostState(hostItem);
    const installed = hostState.installed.filter((entry) => entry.itemId !== getItemId(upgradeItem));
    const capacity = hostState.capacity;
    const quantity = Number(getProperty(upgradeItem, "system.quantity") ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new UpgradeRuleError("invalid-quantity");
    if (options.capacity != null && options.capacity !== capacity) throw new UpgradeRuleError("capacity");
    const previousHost = readModuleFlag(upgradeItem, INSTALLED_UPGRADE_FLAG)?.hostItemId;
    if (previousHost && previousHost !== getItemId(hostItem)) throw new UpgradeRuleError("slot-conflict");
    const { slotIndex } = validateUpgradeInstallation(buildUpgradeHostDescriptor(hostItem), installed,
      { ...projection, slotIndex: options.slotIndex });
    const choices = validateUpgradeChoices(projection.sourceId, options.choices ?? projection.choices);

    let installedItem = upgradeItem;
    const installedFlag = buildInstalledUpgradeFlag(hostItem, slotIndex);
    if (getItemQuantity(upgradeItem) > 1) {
      const itemData = deepClone(upgradeItem.toObject());
      delete itemData._id;
      delete itemData.id;
      setProperty(itemData, "system.quantity", 1);
      setProperty(itemData, "system.container", getItemId(hostItem));
      setProperty(itemData, `flags.${MODULE_ID}.${INSTALLED_UPGRADE_FLAG}`, installedFlag);
      setProperty(itemData, `flags.${MODULE_ID}.upgradeChoices`, choices);
      const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { renderSheet: false });
      if (!created) {
        throw new Error("Не удалось создать установленное усовершенствование.");
      }
      installedItem = created;
      await upgradeItem.update({ "system.quantity": getItemQuantity(upgradeItem) - 1 });
    }
    else {
      await upgradeItem.update({
        "system.container": getItemId(hostItem),
        [`flags.${MODULE_ID}.${INSTALLED_UPGRADE_FLAG}`]: installedFlag,
        [`flags.${MODULE_ID}.upgradeChoices`]: choices
      });
    }

    const nextInstalled = [
      ...installed,
      {
        itemId: getItemId(installedItem),
        slotIndex
      }
    ];
    await hostItem.update({
      [`flags.${MODULE_ID}.${ITEM_UPGRADES_HOST_FLAG}`]: buildHostStatePatch(hostItem, nextInstalled, capacity)
    });

    return installedItem;
  }

  async removeItemUpgrade(hostItem, upgradeItemOrId) {
    const actor = getItemActor(hostItem);
    if (!actor?.isOwner) {
      throw new Error("Недостаточно прав для изменения предмета.");
    }

    const upgradeItem = resolveActorItem(actor, upgradeItemOrId);
    const upgradeItemId = getItemId(upgradeItem) || cleanText(upgradeItemOrId);
    if (!upgradeItemId) {
      throw new Error("Усовершенствование не найдено.");
    }

    const hostState = getItemUpgradeHostState(hostItem);
    const currentEntry = hostState.installed.find((entry) => entry.itemId === upgradeItemId);
    if (!currentEntry) {
      throw new Error("Это усовершенствование не установлено на предмете.");
    }

    const nextInstalled = hostState.installed.filter((entry) => entry.itemId !== upgradeItemId);
    validateUpgradeCapacity(buildUpgradeHostDescriptor(hostItem), nextInstalled, hostState.capacity);
    await hostItem.update({
      [`flags.${MODULE_ID}.${ITEM_UPGRADES_HOST_FLAG}`]: buildHostStatePatch(hostItem, nextInstalled, hostState.capacity)
    });

    if (upgradeItem) {
      await upgradeItem.update({
        "system.container": null,
        [`flags.${MODULE_ID}.${INSTALLED_UPGRADE_FLAG}`]: null
      });
    }

    return upgradeItem;
  }

  async setItemUpgradeCapacity(hostItem, capacity) {
    const actor = getItemActor(hostItem);
    if (!actor?.isOwner) {
      throw new Error("Недостаточно прав для изменения предмета.");
    }
    if (!isUpgradeableHostItem(hostItem)) {
      throw new Error("Этот предмет нельзя усовершенствовать.");
    }

    const hostState = getItemUpgradeHostState(hostItem);
    const nextCapacity = validateUpgradeCapacity(buildUpgradeHostDescriptor(hostItem), hostState.installed, capacity);

    const nextState = buildHostStatePatch(hostItem, hostState.installed, nextCapacity);
    await hostItem.update({
      [`flags.${MODULE_ID}.${ITEM_UPGRADES_HOST_FLAG}`]: nextState
    });
    return nextState;
  }
}
