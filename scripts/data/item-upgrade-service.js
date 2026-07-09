import { MODULE_ID } from "../constants.js";

export const ITEM_UPGRADES_HOST_FLAG = "itemUpgrades";
export const INSTALLED_UPGRADE_FLAG = "installedUpgrade";
export const UPGRADE_HOLD_DURATION_MS = 3000;

const UPGRADE_EQUIPMENT_TYPE = "Усовершенствование";
const DEFAULT_UPGRADE_CAPACITY = 1;
const MAX_UPGRADE_CAPACITY = 3;

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

  if (["equipment", "loot", "consumable"].includes(type)) {
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

function getNextFreeSlot(installed, capacity) {
  const occupied = new Set(installed.map((entry) => entry.slotIndex));
  for (let slotIndex = 1; slotIndex <= capacity; slotIndex += 1) {
    if (!occupied.has(slotIndex)) {
      return slotIndex;
    }
  }
  return 0;
}

function resolveActorItem(actor, itemOrId) {
  if (!actor) {
    return null;
  }
  if (itemOrId && typeof itemOrId === "object") {
    return itemOrId;
  }
  const id = cleanText(itemOrId);
  if (!id) {
    return null;
  }
  return actor.items?.get?.(id)
    ?? getActorItems(actor).find((item) => getItemId(item) === id)
    ?? null;
}

export class ItemUpgradeService {
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

    const hostState = getItemUpgradeHostState(hostItem);
    const installed = hostState.installed.filter((entry) => entry.itemId !== getItemId(upgradeItem));
    const capacity = clampCapacity(options.capacity ?? hostState.capacity, DEFAULT_UPGRADE_CAPACITY);
    const slotIndex = toPositiveInteger(options.slotIndex, getNextFreeSlot(installed, capacity));
    if (!slotIndex || slotIndex > capacity || installed.some((entry) => entry.slotIndex === slotIndex)) {
      throw new Error("На предмете нет свободного слота усовершенствования.");
    }

    let installedItem = upgradeItem;
    const installedFlag = buildInstalledUpgradeFlag(hostItem, slotIndex);
    if (getItemQuantity(upgradeItem) > 1) {
      const itemData = deepClone(upgradeItem.toObject());
      delete itemData._id;
      delete itemData.id;
      setProperty(itemData, "system.quantity", 1);
      setProperty(itemData, "system.container", getItemId(hostItem));
      setProperty(itemData, `flags.${MODULE_ID}.${INSTALLED_UPGRADE_FLAG}`, installedFlag);
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
        [`flags.${MODULE_ID}.${INSTALLED_UPGRADE_FLAG}`]: installedFlag
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
    const nextCapacity = clampCapacity(capacity, DEFAULT_UPGRADE_CAPACITY);
    if (nextCapacity < hostState.installed.length) {
      throw new Error("Нельзя поставить слотов меньше уже установленных усовершенствований.");
    }

    const nextState = buildHostStatePatch(hostItem, hostState.installed, nextCapacity);
    await hostItem.update({
      [`flags.${MODULE_ID}.${ITEM_UPGRADES_HOST_FLAG}`]: nextState
    });
    return nextState;
  }
}
