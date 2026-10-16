import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildUpgradeHostDescriptor, getItemUpgradeCategory, profileSignature } from "../data/item-upgrade-service.js?v=1.4.389";
import { loadUpgradeAutomationManifest } from "../data/upgrade-automation-manifest.js?v=1.4.255";
import { validateUpgradeInstallation } from "../data/item-upgrade-rules.js?v=1.4.250";
import { buildSimpleUpgradeContributions, projectSimpleUpgradeItem } from "./item-upgrade-projections.js?v=1.4.279";
import { SimpleUpgradeRollAdapter } from "../integrations/item-upgrade-roll-adapter.js?v=1.4.389";
import { loadWeaponModCatalog } from "../data/weapon-mod-catalog.js?v=1.4.389";
import { readWeaponMods } from "../data/weapon-mod-rules.js?v=1.4.389";
import { buildWeaponModContributions, projectWeaponModItem } from "./weapon-mod-projections.js?v=1.4.383";
import { getWeaponModAimState, evaluateWeaponModAttack } from "./weapon-mod-roll-modifiers.js?v=1.4.386";
import { buildWeaponModActivities, buildWeaponModBayonetProfile, reconcileWeaponModActivities } from "../data/weapon-mod-activities.js?v=1.4.389";
import { getItemHeldHands } from "../integrations/held-items.js?v=1.4.383";
import { createStableGearDocumentId } from "../data/gear-document-ids.js";
import { storageTokenCenter } from "../data/storage-access.js";

const FLAG = "simpleItemUpgrade", PATCH = Symbol.for("rebreya-main.simple-upgrade-item-effects");
const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
const getFlag = (document, key) => document?.flags?.[MODULE_ID]?.[key] ?? document?.getFlag?.(MODULE_ID, key);
const damageSnapshot = system => Object.fromEntries(["base", "versatile"].filter(key => system.damage?.[key])
  .map(key => [key, { number: system.damage[key].number, denomination:system.damage[key].denomination, types: Array.from(system.damage[key].types ?? []) }]));
const has=(system,key)=>system.properties?.has?.(key)??system.properties?.includes?.(key);
const nativeSnapshot=system=>({weight:system.weight?.value,strength:system.strength,stealth:has(system,"stealthDisadvantage"),damage:damageSnapshot(system),
  range:{value:system.range?.value,long:system.range?.long},properties:Object.fromEntries(["two","lchFirearmProneFire"].map(key=>[key,has(system,key)]))});

/** Owns simple passive and roll contributions; installed links remain owned by ItemUpgradeService. */
export class ItemUpgradeAutomationService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi; this.options = options; this.manifest = []; this.pending = new Map(); this.hostAdapterReady = false;
    this.itemProjections = new WeakMap();
    this.weaponModActivityRuntime=new WeakMap();
    this.weaponModActivityRanges=new WeakMap();this.weaponModRangeWrappers=new WeakMap();
    this.weaponModCatalog={rows:[],hosts:[]};
    this.rolls = new SimpleUpgradeRollAdapter(this, { getWorkflow: activity => {
      const workflows = this.moduleApi.curseUpgradeAutomationService?.attacks?.activityWorkflows?.get(activity);
      return workflows?.size === 1 ? [...workflows][0] : null;
    } });
  }
  isAuthority() { return this.options.isAuthority?.() ?? isActiveGmClient(globalThis.game); }
  readHosts(actor, hostItem = null) {
    return (hostItem ? [hostItem] : values(actor.items)).filter(item => getFlag(item, "itemUpgrades")?.installed?.length).map(item => {
      const descriptor = buildUpgradeHostDescriptor(item), links = getFlag(item, "itemUpgrades").installed;
      const eligibleHost = Boolean(getItemUpgradeCategory(item));
      return { id: item.id, descriptor, source: item.toObject(), upgrades: links.map(link => {
        const upgrade = actor.items.get(link.itemId), sourceId = getFlag(upgrade, "gearId");
        const entry = this.manifest.find(row => row.productId === sourceId), reverse = getFlag(upgrade, "installedUpgrade");
        const stored = getFlag(upgrade, "upgrade");
        let compatible = false;
        if (eligibleHost) try {
          validateUpgradeInstallation(descriptor, links.filter(other => other !== link), { profile: entry?.profile, availability: entry?.decision, slotIndex: link.slotIndex });
          compatible = true;
        } catch { /* An invalid historical link contributes nothing; its documents remain intact. */ }
        return { id: link.itemId, sourceId, choices: getFlag(upgrade, "upgradeChoices"), valid: Boolean(upgrade && entry && compatible && upgrade.system?.quantity === 1
          && links.filter(other => other.itemId === link.itemId).length === 1 && reverse?.hostItemId === item.id
          && reverse.slotIndex === link.slotIndex && upgrade.system?.container === item.id
          && (!stored || profileSignature(stored) === profileSignature(entry.profile))) };
      }) };
    });
  }
  project(actor, hostItem = null) {
    const override=this.options.project?.(actor);if(override!=null)return override;
    const simple=buildSimpleUpgradeContributions({ actor: { uuid: actor.uuid, type: actor.type,
      source: { system: { attributes: { hp: { max: actor._source?.system?.attributes?.hp?.max ?? null } } } } }, hosts: this.readHosts(actor, hostItem), manifest: this.manifest,
      capabilities: new Set(this.hostAdapterReady ? ["actor", "host", "roll", "damage"] : ["actor", "roll", "damage"]) });
    const result={...simple,contributions:[...simple.contributions],diagnostics:[]};
    const selected=hostItem && getFlag(hostItem,"installedWeaponMod")?.hostItemId?actor.items.get(getFlag(hostItem,"installedWeaponMod").hostItemId):hostItem;
    const hosts=(selected?[selected]:values(actor.items)).filter(item=>getFlag(item,"weaponMods"));
    for(const item of hosts){
      const mods=readWeaponMods(item,id=>actor.items.get(id),this.weaponModCatalog);
      const detached=Object.fromEntries(["attachments","modernizedParts"].map(field=>[field,mods[field].map(mod=>({itemId:mod.itemId,sourceId:mod.sourceId,profile:mod.profile,
        source:mod.item.toObject(),catalogWeightLb:this.weaponModCatalog.rows.find(row=>row.sourceId===mod.sourceId)?.weight}))]));
      const weights=globalThis.CONFIG?.DND5E?.weightUnits,pound=weights?.lb?.conversion??1,
        poundsPerUnit=Object.fromEntries(Object.entries(weights??{}).map(([key,row])=>[key,row.conversion/pound]).filter(([,factor])=>Number.isFinite(factor)&&factor>0));
      const projected=buildWeaponModContributions({host:{id:item.id,actorUuid:actor.uuid,source:item.toObject()},mods:detached,context:{poundsPerUnit}});
      result.contributions.push(...projected.contributions);result.diagnostics.push(...mods.diagnostics,...projected.diagnostics);
      const aim=getWeaponModAimState(item,globalThis.game?.combat,projected.contributions);
      const optic=aim && projected.contributions.find(c=>c.kind==="aim" && c.childItemId===aim.childItemId);
      if(optic?.stopMovement)for(const movement of ["walk","fly","swim","climb","burrow"]){
        result.contributions.push({...optic,scope:"actor",upgradeItemId:optic.childItemId,path:`system.attributes.movement.${movement}`,mode:5,value:0,priority:100,
          key:`${optic.key}:aim-movement:${movement}`});
      }
    }
    return result;
  }
  requestSync(actorOrUuid, reason = "changed") {
    const uuid = typeof actorOrUuid === "string" ? actorOrUuid : actorOrUuid?.uuid;
    if (!uuid || !this.isAuthority()) return Promise.resolve();
    const pending = this.pending.get(uuid);
    if (pending) { pending.dirty = true; return pending.promise; }
    const state = { dirty: true };
    state.promise = this.moduleApi.worldMutationCoordinator.run(`simple-upgrades:${uuid}`, async () => {
      do { state.dirty = false; await this.syncActor(uuid, reason); } while (state.dirty);
    }).finally(() => { if (this.pending.get(uuid) === state) this.pending.delete(uuid); });
    this.pending.set(uuid, state);
    return state.promise;
  }
  async syncActor(actorOrUuid) {
    if (!this.isAuthority()) return;
    const uuid = typeof actorOrUuid === "string" ? actorOrUuid : actorOrUuid?.uuid;
    const actor = await (this.options.readActor?.(uuid) ?? globalThis.fromUuid?.(uuid));
    if (!actor?.items || !actor.createEmbeddedDocuments || !this.isAuthority()) return;
    await this.syncWeaponModActivities(actor);
    await this.syncWeaponModLights(actor);
    const desired = new Map(this.project(actor).contributions.filter(c => c.scope === "actor").map(c => [c.key, {
      name: actor.items.get?.(c.upgradeItemId)?.name ?? c.sourceId, type: "base", transfer: false, disabled: false,
      changes: [{ key: c.path, mode: c.mode??2, value: String(c.value), priority: c.priority??20 }],
      flags: { [MODULE_ID]: { [FLAG]: { managed: true, key: c.key, hostItemId: c.hostItemId, upgradeItemId: c.upgradeItemId } } }
    }]));
    const remove = [], update = [];
    for (const effect of values(actor.effects)) {
      const own = getFlag(effect, FLAG); if (own?.managed !== true) continue;
      const data = desired.get(own.key);
      if (!data) { remove.push(effect.id); continue; }
      desired.delete(own.key);
      const current = effect.toObject();
      if (Object.keys(data).some(key => profileSignature(key === "flags" ? current.flags?.[MODULE_ID]?.[FLAG] : current[key])
        !== profileSignature(key === "flags" ? data.flags[MODULE_ID][FLAG] : data[key]))) update.push({ _id: effect.id, ...data });
    }
    const options = { rebreyaSimpleUpgradeSync: true };
    for (const [method, data] of [["deleteEmbeddedDocuments", remove], ["updateEmbeddedDocuments", update], ["createEmbeddedDocuments", [...desired.values()]]]) {
      if (!this.isAuthority()) return;
      if (data.length) await actor[method]("ActiveEffect", data, options);
    }
  }
  async syncWeaponModActivities(actor){
    for(const host of values(actor.items)){
      const source=host.toObject?.(),raw=source?.system?.activities??{},existing=Array.isArray(raw)?raw:raw instanceof Map?[...raw.values()]:Object.values(raw);
      if(!getFlag(host,"weaponMods") && !existing.some(activity=>activity.flags?.[MODULE_ID]?.weaponModActivity))continue;
      const mods=readWeaponMods(host,id=>actor.items.get(id),this.weaponModCatalog),desired=buildWeaponModActivities({hostId:host.id,mods,sources:this.weaponModCatalog.gearById,heldHands:getItemHeldHands(host).length,
        grenadeActivities:getFlag(host,"weaponModGrenadeActivities")??[]}),
        result=reconcileWeaponModActivities(existing,desired),after=Object.fromEntries(result.activities.map(activity=>[activity._id,activity]));
      if(profileSignature(raw)===profileSignature(after))continue;
      if(!this.isAuthority())return;
      await host.update({"system.==activities":after},{rebreyaSimpleUpgradeSync:true,render:false});
    }
  }
  async syncWeaponModLights(actor){
    const desired=new Map();
    for(const host of values(actor.items)){
      if(!getFlag(host,"weaponMods"))continue;
      const mods=readWeaponMods(host,id=>actor.items.get(id),this.weaponModCatalog);
      for(const mod of mods.attachments){
        const effect=mod.profile.effects.find(effect=>effect.kind==="flashlight"),state=getFlag(mod.item,"weaponModLight");
        if(!effect || !state?.enabled || !state.tokenUuid)continue;
        const token=await globalThis.fromUuid?.(state.tokenUuid);
        if(token?.actor?.uuid!==actor.uuid || !token.parent?.createEmbeddedDocuments)continue;
        const id=createStableGearDocumentId(`weapon-mod-light:${actor.uuid}:${host.id}:${mod.itemId}:${token.uuid}`),center=storageTokenCenter(token),
          config=this.moduleApi.combatAttackService.getWeaponModLightConfiguration(effect,token);
        desired.set(id,{scene:token.parent,token,data:{_id:id,x:center.x,y:center.y,elevation:token.elevation??0,rotation:token.rotation??0,hidden:false,config,
          flags:{[MODULE_ID]:{weaponModLight:{actorUuid:actor.uuid,hostItemId:host.id,childItemId:mod.itemId,tokenUuid:token.uuid}}}}});
      }
    }
    for(const scene of values(globalThis.game?.scenes))for(const light of values(scene.lights)){
      const marker=getFlag(light,"weaponModLight");if(!marker?.actorUuid)continue;
      const expectedId=createStableGearDocumentId(`weapon-mod-light:${marker.actorUuid}:${marker.hostItemId}:${marker.childItemId}:${marker.tokenUuid}`);
      if(light.id!==expectedId)continue;
      if(marker.actorUuid!==actor.uuid){
        const linkedToken=await globalThis.fromUuid?.(marker.tokenUuid);
        if(linkedToken?.actor?.uuid===marker.actorUuid)continue;
        if(!this.isAuthority())return;
        await light.delete({rebreyaSimpleUpgradeSync:true});continue;
      }
      const wanted=desired.get(light.id);desired.delete(light.id);
      if(!this.isAuthority())return;
      if(!wanted){await light.delete({rebreyaSimpleUpgradeSync:true});continue;}
      if(wanted.token.actor?.uuid!==actor.uuid)continue;
      const current=light.toObject(),data=wanted.data,patch={};
      for(const field of ["x","y","elevation","rotation","hidden"])if(current[field]!==data[field])patch[field]=data[field];
      for(const field of ["bright","dim","angle"])if(current.config?.[field]!==data.config[field])patch[`config.${field}`]=data.config[field];
      if(Object.keys(patch).length)await light.update(patch,{rebreyaSimpleUpgradeSync:true});
    }
    for(const {scene,token,data} of desired.values()){
      if(!this.isAuthority())return;
      if(token.actor?.uuid!==actor.uuid)continue;
      try{await scene.createEmbeddedDocuments("AmbientLight",[data],{keepId:true,rebreyaSimpleUpgradeSync:true});}
      catch(error){
        const observed=values(scene.lights).find(light=>light.id===data._id);
        if(!observed || profileSignature(getFlag(observed,"weaponModLight"))!==profileSignature(data.flags[MODULE_ID].weaponModLight))throw error;
      }
    }
  }
  handleChanged(document, options = {}) {
    if (options.rebreyaSimpleUpgradeSync) return Promise.resolve();
    return this.requestSync(document?.actor ?? (document?.parent?.items ? document.parent : document));
  }
  #createWeaponModBayonetItem(activity){
    const definition=this.moduleApi.combatAttackService?.getManagedWeaponModActivityDefinition(activity);
    if(definition?.marker.action!=="bayonet-attack")return null;
    const profile=buildWeaponModBayonetProfile(this.weaponModCatalog.gearById?.get("kop-e")),data=profile.nativeData,
      canonical=buildWeaponModActivities({hostId:definition.host.id,mods:{attachments:[definition.mod],modernizedParts:[]},sources:this.weaponModCatalog.gearById,
        heldHands:getItemHeldHands(definition.host).length}).find(entry=>entry._id===(activity.id??activity._id));
    data._id=definition.host.id;data.flags[MODULE_ID].heldHands=getItemHeldHands(definition.host);
    data.system.properties=[...profile.properties];
    if(getItemHeldHands(definition.host).length>=2)data.system.damage.base=structuredClone(profile.damage.versatile);
    data.system.activities={[canonical._id]:{...canonical,damage:{includeBase:true,parts:[]},flags:{}}};
    const item=this.options.createNativeItem?.(data,definition.actor)??new (globalThis.CONFIG?.Item?.documentClass??globalThis.Item)(data,{parent:definition.actor});
    item.prepareData?.();return item;
  }
  getWeaponModActivityProficiency(activity){
    if(activity?.flags?.[MODULE_ID]?.weaponModActivity?.action!=="bayonet-attack")return undefined;
    return this.#createWeaponModBayonetItem(activity)?.system?.prof?.hasProficiency;
  }
  #applyWeaponModLauncherRuntime(activity){
    if(activity.flags?.[MODULE_ID]?.weaponModActivity?.action!=="launcher-shot" || typeof activity.consume!=="function" || typeof activity._createUsageMessage!=="function")return;
    if(this.weaponModActivityRuntime.get(activity)?.consume===activity.consume)return;
    const service=this,consume=activity.consume,createMessage=activity._createUsageMessage;
    const command=(shot,kind)=>({actorUuid:shot.actorUuid,hostItemId:shot.hostItemId,childItemId:shot.childItemId,activityId:shot.activityId,
      operationId:`${shot.prepareOperationId}:${kind}`,decision:{kind,prepareOperationId:shot.prepareOperationId,...(kind==="launcher-consume"?{grenadeItemId:shot.grenadeItemId}:{cardId:shot.cardId})}});
    const acknowledge=async shot=>service.moduleApi.useWeaponModActivity(command(shot,"launcher-ack"));
    activity.consume=async function(usage,message){
      const definition=service.moduleApi.combatAttackService.getManagedWeaponModActivityDefinition(this),requested=usage.rebreyaWeaponModShot,
        shot=getFlag(definition.host,"weaponModShot");
      if(!requested || !shot || requested.prepareOperationId!==shot.prepareOperationId || requested.grenadeItemId!==shot.grenadeItemId
        || shot.activityId!==(this.id??this._id) || shot.ownerUserId!==globalThis.game.user.id)throw new Error("Сначала выберите загруженную гранату через действие гранатомёта.");
      const existing=globalThis.game.messages?.get?.(shot.cardId);
      if(existing || shot.phase==="published"){
        if(["consumed","published"].includes(shot.phase))await acknowledge(shot);return false;
      }
      let updates={rolls:[]};
      if(shot.phase==="prepared"){
        updates=await consume.call(this,usage,message);if(updates===false)return false;
      }
      const result=await service.moduleApi.useWeaponModActivity(command(shot,"launcher-consume"));
      message.data??={};message.data.flags??={};message.data.flags[MODULE_ID]??={};
      message.data.flags[MODULE_ID].weaponModShot=result.shot;
      message.data.flags[MODULE_ID].weaponModShotPublisher=globalThis.crypto.randomUUID();
      return updates;
    };
    activity._createUsageMessage=async function(message){
      const shot=message.data?.flags?.[MODULE_ID]?.weaponModShot;
      if(!shot || message.create===false)return createMessage.call(this,message);
      const publisher=message.data.flags[MODULE_ID].weaponModShotPublisher,
        data=await createMessage.call(this,{...message,create:false});data._id=shot.cardId;
      let card=globalThis.game.messages?.get?.(shot.cardId);
      if(!card){try{card=await globalThis.ChatMessage.create(data,{keepId:true});}catch(error){card=globalThis.game.messages?.get?.(shot.cardId);if(!card)throw error;}}
      const actualPublisher=card.getFlag?.(MODULE_ID,"weaponModShotPublisher")??card.flags?.[MODULE_ID]?.weaponModShotPublisher;
      try{await acknowledge(shot);}catch(error){globalThis.ui?.notifications?.warn?.(error.message);}
      if(actualPublisher!==publisher)throw new Error("Карточка этого выстрела уже опубликована; повторное применение остановлено.");
      return card;
    };
    this.weaponModActivityRuntime.set(activity,{consume:activity.consume,createUsageMessage:activity._createUsageMessage});
  }
  restoreWeaponModActivityRange(activity){
    const prior=this.weaponModActivityRanges.get(activity);this.weaponModActivityRanges.delete(activity);
    if(prior?.range!==activity.range)return;
    for(const field of ["value","long"])if(activity.range[field]===prior.effective[field])activity.range[field]=prior.base[field];
  }
  projectWeaponModActivityRange(activity){
    this.restoreWeaponModActivityRange(activity);
    const item=activity.item,actor=item?.actor??item?.parent;
    if(!actor || !getFlag(item,"weaponMods") || activity.type!=="attack" || activity.flags?.[MODULE_ID]?.weaponModActivity
      || activity.actionType==="mwak" || activity.attack?.type?.value==="melee" || !activity.range)return;
    const contributions=this.project(actor,item).contributions,conditions=this.moduleApi.combatAttackService?.getWeaponModAttackConditions?.(activity,null,{})??{},
      result=evaluateWeaponModAttack({host:{id:item.id},attack:{type:"ranged"},contributions,conditions});
    if(!result.allowed || result.rangeMultiplier===1 || result.needsDecision.some(row=>["movedFeet","underwater"].includes(row.field)))return;
    const base={value:activity.range.value,long:activity.range.long},effective={...base};
    for(const field of ["value","long"])if(Number.isFinite(base[field]))effective[field]=base[field]*result.rangeMultiplier;
    Object.assign(activity.range,effective);this.weaponModActivityRanges.set(activity,{range:activity.range,base,effective});
  }
  getWeaponModActivityRangeState(activity){
    const prior=this.weaponModActivityRanges.get(activity);
    return prior?.range===activity.range && ["value","long"].every(field=>activity.range[field]===prior.effective[field])?{...prior.base,units:activity.range.units}:null;
  }
  applyWeaponModActivityRuntime(item){
    for(const activity of values(item.system?.activities)){
      this.#applyWeaponModLauncherRuntime(activity);
      if(getFlag(item,"weaponMods") && activity.type==="attack" && !activity.flags?.[MODULE_ID]?.weaponModActivity
        && typeof activity.prepareFinalData==="function" && this.weaponModRangeWrappers.get(activity)!==activity.prepareFinalData){
        const original=activity.prepareFinalData,service=this;
        activity.prepareFinalData=function(...args){
          service.restoreWeaponModActivityRange(this);const result=original.apply(this,args);service.projectWeaponModActivityRange(this);return result;
        };this.weaponModRangeWrappers.set(activity,activity.prepareFinalData);
      }
      if(getFlag(item,"weaponMods") && !activity.flags?.[MODULE_ID]?.weaponModActivity && activity.type==="attack" && typeof activity.rollDamage==="function"
        && this.weaponModActivityRuntime.get(activity)?.rollDamage!==activity.rollDamage){
        const original=activity.rollDamage,service=this;
        activity.rollDamage=async function(config={},dialog={},message={}){
          const prepared=await service.moduleApi.combatAttackService?.prepareWeaponModDamageUse?.(this,config,message);
          if(prepared?.cancelled)return;
          const next=prepared?.damageContext?{...message,data:{...message.data,flags:{...message.data?.flags,[MODULE_ID]:{...message.data?.flags?.[MODULE_ID],weaponModDamageContext:prepared.damageContext}}}}:message;
          return original.call(this,config,dialog,next);
        };this.weaponModActivityRuntime.set(activity,{rollDamage:activity.rollDamage});
      }
      if(activity.flags?.[MODULE_ID]?.weaponModActivity?.action!=="bayonet-attack" || typeof activity.getAttackData!=="function")continue;
      if(this.weaponModActivityRuntime.get(activity)?.getAttackData===activity.getAttackData)continue;
      const service=this,wrapper=function(config){
        const canonical=service.#createWeaponModBayonetItem(this),attack=canonical?.system?.activities?.get?.(this.id??this._id);
        if(!attack?.getAttackData)throw new Error("Нативная атака копьём недоступна.");
        return attack.getAttackData({...config,ammunition:false});
      };
      activity.getAttackData=wrapper;
      if(typeof activity.getDamageConfig==="function"){
        activity.getDamageConfig=function(config={},...rest){
          const canonical=service.#createWeaponModBayonetItem(this),native=canonical?.system?.activities?.get?.(this.id??this._id);
          if(!native?.getDamageConfig)throw new Error("Нативное действие копья недоступно.");
          return native.getDamageConfig({...config,ammunition:false},...rest);
        };
      }
      if(typeof activity.rollAttack==="function"){
        const original=activity.rollAttack;
        activity.rollAttack=function(config={},dialog={},message={}){
          return original.call(this,{...config,ammunition:false},{...dialog,options:{...dialog.options,ammunitionOptions:[]}},message);
        };
      }
      if(typeof activity._buildAttackConfig==="function"){
        const original=activity._buildAttackConfig;
        activity._buildAttackConfig=function(process,config,...rest){
          original.call(this,process,config,...rest);config.options??={};config.options.ammunition=false;
          if(config.options.attackMode?.startsWith("thrown"))config.options.attackMode="oneHanded";
        };
      }
      this.weaponModActivityRuntime.set(activity,{getAttackData:wrapper});
    }
  }
  applyItemProjection(item) {
    if (!item.actor) return;
    this.applyWeaponModActivityRuntime(item);
    const contributions = this.project(item.actor, item).contributions;
    if(!contributions.some(c=>c.scope==="host" || c.scope==="weapon-mod" && c.targetItemId===item.id))return;
    const before = nativeSnapshot(item.system);
    projectWeaponModItem(item.system,contributions,{itemId:item.id});
    projectSimpleUpgradeItem(item.system, contributions);
    this.itemProjections.set(item, { system: item.system, source: profileSignature(item.toObject().system), sourceFields:nativeSnapshot(item.toObject().system), before,
      after:nativeSnapshot(item.system),weaponMods:{sawOff:contributions.some(c=>c.scope==="weapon-mod" && c.targetItemId===item.id && c.kind==="saw-off")} });
  }
  getWeaponModItemState(item){const state=this.itemProjections.get(item)?.weaponMods;return state?{...state}:null;}
  restoreItemProjection(item) {
    const prior = this.itemProjections.get(item); this.itemProjections.delete(item);
    if (!prior || item.system !== prior.system) return;
    const source=nativeSnapshot(item.toObject().system),sameSource=(field,key)=>profileSignature(key?prior.sourceFields[field]?.[key]:prior.sourceFields[field])===profileSignature(key?source[field]?.[key]:source[field]);
    // Restore only a value still equal to our previous result; unrelated effects and fresh source edits survive.
    if (sameSource("weight") && prior.before.weight !== prior.after.weight && item.system.weight?.value === prior.after.weight) item.system.weight.value = prior.before.weight;
    if (sameSource("strength") && prior.before.strength !== prior.after.strength && item.system.strength === prior.after.strength) item.system.strength = prior.before.strength;
    if (sameSource("stealth") && prior.before.stealth === true && prior.after.stealth === false && item.system.properties?.has?.("stealthDisadvantage") === false) item.system.properties.add("stealthDisadvantage");
    for(const key of ["value","long"])if(sameSource("range",key) && prior.before.range[key]!==prior.after.range[key] && item.system.range?.[key]===prior.after.range[key])item.system.range[key]=prior.before.range[key];
    for(const key of ["two","lchFirearmProneFire"])if(sameSource("properties",key) && prior.before.properties[key]!==prior.after.properties[key] && item.system.properties?.has?.(key)===prior.after.properties[key]){
      if(prior.before.properties[key])item.system.properties.add(key);else item.system.properties.delete(key);
    }
    for (const key of ["base", "versatile"]) {
      const before = prior.before.damage?.[key], after = prior.after.damage?.[key], current = item.system.damage?.[key];
      if (!before || !after || !current) continue;
      const sameDamage=field=>profileSignature(prior.sourceFields.damage?.[key]?.[field])===profileSignature(source.damage?.[key]?.[field]);
      if (sameDamage("number") && before.number !== after.number && current.number === after.number) current.number = before.number;
      if(sameDamage("denomination") && before.denomination!==after.denomination && current.denomination===after.denomination)current.denomination=before.denomination;
      if (sameDamage("types") && profileSignature(before.types) !== profileSignature(after.types) && profileSignature(Array.from(current.types ?? [])) === profileSignature(after.types)) current.types = new Set(before.types);
    }
  }
  registerItemDataPatch() {
    const prototype = globalThis.CONFIG?.Item?.documentClass?.prototype;
    if (!prototype || prototype[PATCH] || typeof prototype.applyActiveEffects !== "function") return false;
    const service = this, original = prototype.applyActiveEffects;
    prototype.applyActiveEffects = function(...args) {
      service.restoreItemProjection(this);
      const result = original.apply(this, args); service.applyItemProjection(this); return result;
    };
    Object.defineProperty(prototype, PATCH, { value: true });
    this.hostAdapterReady = true;
    return true;
  }
  async initialize() {
    if (globalThis.game?.system?.id !== "dnd5e") return;
    this.manifest = await (this.options.getManifest?.() ?? loadUpgradeAutomationManifest());
    this.weaponModCatalog=await (this.options.getWeaponModCatalog?.()??loadWeaponModCatalog());
    this.registerItemDataPatch();
    for (const actor of values(globalThis.game?.actors)) {
      // Native dnd5e final preparation appends base damage parts. Reset the models first.
      actor.reset?.();
      await this.requestSync(actor, "ready");
    }
  }
}
