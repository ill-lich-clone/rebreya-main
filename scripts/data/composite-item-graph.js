import { normalizeLootgenItemDescriptor } from "./lootgen-item-descriptor.js?v=1.4.379";
import { loadWeaponModCatalog, getWeaponModCandidate } from "./weapon-mod-catalog.js?v=1.4.389";
import { getWeaponModHostDescriptor, validateWeaponAttachmentInstallation, validateModernizedPartInstallation } from "./weapon-mod-rules.js?v=1.4.389";
import { buildUpgradeHostDescriptor, profileSignature, getItemUpgradeCategory, ITEM_UPGRADES_HOST_FLAG, INSTALLED_UPGRADE_FLAG } from "./item-upgrade-service.js?v=1.4.392";
import { validateUpgradeInstallation } from "./item-upgrade-rules.js?v=1.4.250";
import { buildHeldItemWornUpdate } from "../integrations/held-items.js?v=1.4.383";

const MODULE_ID = "rebreya-main";
const fail = reason => { const error = new Error(`Не удалось подготовить составной предмет: ${reason}.`); error.code = "invalid-composite-graph"; throw error; };

function cleanCatalogItem(source, id) {
  if (!source || typeof source !== "object" || !source.type || !source.system) fail("catalog-item");
  const data = structuredClone(source);
  for (const key of ["_id","id","_stats","ownership","folder","sort","parent","pack"]) delete data[key];
  data._id = id;data.system.container = null;data.flags ??= {};data.flags[MODULE_ID] ??= {};
  for (const key of ["inventoryMutation","inventoryTransfer","runtimeItemGraph","runtimeGraphOrigin","itemInstanceOrigin","itemInstanceDebit","disarmDebit",INSTALLED_UPGRADE_FLAG,"installedWeaponMod","weaponMods"]) delete data.flags[MODULE_ID][key];
  for (const [path,value] of Object.entries(buildHeldItemWornUpdate(false,data))) {
    const parts=path.split("."),last=parts.pop();let target=data;
    for(const key of parts)target=target[key]??={};
    if(last.startsWith("-="))delete target[last.slice(2)];else target[last]=structuredClone(value);
  }
  // dnd5e loot has no equipped field; its schema would discard this synthetic value.
  if (data.type === "loot") delete data.system.equipped;
  return data;
}

/** Builds trusted detached catalog data only. The ingress journal owns persistence and recovery. */
export async function buildCompositeItemGraph(raw, { buildBase, buildUpgrade, buildWeaponMod=buildUpgrade, weaponModCatalog=null, createDocumentId, manifest = [], actorId = "" } = {}) {
  const descriptor = normalizeLootgenItemDescriptor(raw);
  if (descriptor.container !== null) fail("container-requires-storage-planner");
  if (typeof buildBase !== "function" || typeof buildUpgrade !== "function" || typeof createDocumentId !== "function") fail("builders");
  const ids = new Set(), nextId = () => {
    const id=createDocumentId();
    if(typeof id!=="string" || !/^[a-zA-Z0-9]{16}$/u.test(id) || ids.has(id))fail("document-id");
    ids.add(id);return id;
  };
  const root = cleanCatalogItem(await buildBase(descriptor.sourceType,descriptor.sourceId),nextId());
  root.system.quantity=descriptor.quantity;
  const host = buildUpgradeHostDescriptor(root), category=getItemUpgradeCategory(root), installed=[], links=[], children=[];
  root.flags[MODULE_ID][ITEM_UPGRADES_HOST_FLAG]={category,capacity:host.capacity,installed};
  // Validate the complete installation before invoking any upgrade builder.
  for(const upgrade of descriptor.upgrades) {
    const entry=manifest.find(row=>row.productId===upgrade.sourceId);
    validateUpgradeInstallation(host,installed,{sourceId:upgrade.sourceId,profile:entry?.profile,availability:entry?.decision,slotIndex:upgrade.slotIndex});
    installed.push({itemId:nextId(),slotIndex:upgrade.slotIndex});
  }
  const modPlans=[];
  if(descriptor.version===3){
    const catalog=weaponModCatalog??await loadWeaponModCatalog(),modHost=getWeaponModHostDescriptor(root,catalog);
    const state={version:1,attachments:[],modernizedParts:[],approvals:[]};
    root.flags[MODULE_ID].weaponMods=state;
    for(const field of ["modernizedParts","attachments"]){
      for(const entry of descriptor.weaponMods[field]){
        const row=catalog.rows.find(row=>row.sourceId===entry.sourceId),itemId=nextId();
        const candidate={...row,itemId,quantity:1};
        if(field==="attachments"){
          const selected=validateWeaponAttachmentInstallation(modHost,state.attachments,candidate,{mountId:entry.mountIds[0]});
          if(selected.mountIds.length!==entry.mountIds.length || selected.mountIds.some(mount=>!entry.mountIds.includes(mount)))fail("weapon-mod-mounts");
        }else validateModernizedPartInstallation(modHost,state.modernizedParts,candidate);
        state[field].push({itemId,sourceId:entry.sourceId,...(entry.mountIds?{mountIds:structuredClone(entry.mountIds)}:{})});
        modPlans.push({entry,row,itemId});
      }
    }
  }
  for(const [index,upgrade] of descriptor.upgrades.entries()) {
    const child=cleanCatalogItem(await buildUpgrade(upgrade.sourceId,upgrade.choices),installed[index].itemId);
    const profile=manifest.find(row=>row.productId===upgrade.sourceId).profile;
    child.system.quantity=1;child.system.container=root._id;
    const flags=child.flags[MODULE_ID];
    if (flags.upgrade && typeof flags.upgrade === "object" && !Array.isArray(flags.upgrade)
      && profileSignature(flags.upgrade) !== profileSignature(profile)) fail("custom-upgrade-profile");
    delete flags[ITEM_UPGRADES_HOST_FLAG];
    Object.assign(flags,{gearId:upgrade.sourceId,upgrade:structuredClone(profile),itemUpgradeTemplate:true,upgradeChoices:structuredClone(upgrade.choices),
      [INSTALLED_UPGRADE_FLAG]:{hostActorId:actorId,hostItemId:root._id,slotIndex:upgrade.slotIndex,category}});
    children.push(child);links.push({hostItemId:root._id,upgradeItemId:child._id,slotIndex:upgrade.slotIndex});
  }
  for(const {entry,row,itemId} of modPlans){
    const child=cleanCatalogItem(await buildWeaponMod(entry.sourceId,{}),itemId),flags=child.flags[MODULE_ID];
    if(!getWeaponModCandidate({...child,flags:{...child.flags,[MODULE_ID]:{...flags,gearId:entry.sourceId}}},{rows:[row]}).available)fail("custom-weapon-mod-profile");
    child.system.quantity=1;child.system.container=root._id;
    delete flags[ITEM_UPGRADES_HOST_FLAG];
    Object.assign(flags,{gearId:entry.sourceId,installedWeaponMod:{version:1,kind:row.profile.kind,hostActorId:actorId,hostItemId:root._id,mountIds:structuredClone(entry.mountIds??[])}});
    children.push(child);
  }
  return {rootItemId:root._id,documents:[root,...children],links};
}
