import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildUpgradeHostDescriptor, getItemUpgradeCategory, profileSignature } from "../data/item-upgrade-service.js?v=1.4.383";
import { loadUpgradeAutomationManifest } from "../data/upgrade-automation-manifest.js?v=1.4.255";
import { validateUpgradeInstallation } from "../data/item-upgrade-rules.js?v=1.4.250";
import { buildSimpleUpgradeContributions, projectSimpleUpgradeItem } from "./item-upgrade-projections.js?v=1.4.279";
import { SimpleUpgradeRollAdapter } from "../integrations/item-upgrade-roll-adapter.js?v=1.4.255";
import { loadWeaponModCatalog } from "../data/weapon-mod-catalog.js?v=1.4.381";
import { readWeaponMods } from "../data/weapon-mod-rules.js?v=1.4.383";
import { buildWeaponModContributions, projectWeaponModItem } from "./weapon-mod-projections.js?v=1.4.383";

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
    const desired = new Map(this.project(actor).contributions.filter(c => c.scope === "actor").map(c => [c.key, {
      name: actor.items.get?.(c.upgradeItemId)?.name ?? c.sourceId, type: "base", transfer: false, disabled: false,
      changes: [{ key: c.path, mode: 2, value: String(c.value), priority: 20 }],
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
  handleChanged(document, options = {}) {
    if (options.rebreyaSimpleUpgradeSync) return Promise.resolve();
    return this.requestSync(document?.actor ?? (document?.parent?.items ? document.parent : document));
  }
  applyItemProjection(item) {
    if (!item.actor) return;
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
