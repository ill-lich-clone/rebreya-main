import { normalizeLootgenItemDescriptor } from "./lootgen-item-descriptor.js?v=1.4.256";
import { buildUpgradeHostDescriptor, profileSignature, getItemUpgradeCategory, ITEM_UPGRADES_HOST_FLAG, INSTALLED_UPGRADE_FLAG } from "./item-upgrade-service.js?v=1.4.255";
import { validateUpgradeInstallation } from "./item-upgrade-rules.js?v=1.4.250";
import { buildHeldItemWornUpdate } from "../integrations/held-items.js";

const MODULE_ID = "rebreya-main";
const fail = reason => { const error = new Error(`Не удалось подготовить составной предмет: ${reason}.`); error.code = "invalid-composite-graph"; throw error; };

function cleanCatalogItem(source, id) {
  if (!source || typeof source !== "object" || !source.type || !source.system) fail("catalog-item");
  const data = structuredClone(source);
  for (const key of ["_id","id","_stats","ownership","folder","sort","parent","pack"]) delete data[key];
  data._id = id;data.system.container = null;data.flags ??= {};data.flags[MODULE_ID] ??= {};
  for (const key of ["inventoryMutation","inventoryTransfer","runtimeItemGraph","runtimeGraphOrigin","itemInstanceOrigin","itemInstanceDebit","disarmDebit",INSTALLED_UPGRADE_FLAG]) delete data.flags[MODULE_ID][key];
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
export async function buildCompositeItemGraph(raw, { buildBase, buildUpgrade, createDocumentId, manifest = [], actorId = "" } = {}) {
  const descriptor = normalizeLootgenItemDescriptor(raw);
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
  return {rootItemId:root._id,documents:[root,...children],links};
}
