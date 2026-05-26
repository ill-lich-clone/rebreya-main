import { GEAR_COMPENDIUM_LABEL, GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  buildNamedIconLookup,
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import {
  classifyGearEntry,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";
import { createStableGearDocumentId } from "./gear-document-ids.js";

const PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const GEAR_TEMPLATE_VERSION = 8;
const GEAR_CONTAINER_CONTENT_SOURCE_TYPE = "gearContainerContent";
const CUSTOM_GEAR_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const GEAR_ICON_SEARCH_PATHS = [
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/Goods`,
  `${CUSTOM_GEAR_ICONS_BASE_PATH}/weapons`,
  CUSTOM_GEAR_ICONS_BASE_PATH
];

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function renderValue(value, fallback = "&mdash;") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return escapeHtml(value);
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanArray(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanString(value))
    .filter(Boolean)));
}

function toFiniteNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeContainerContents(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isPlainObject(entry)) {
        return null;
      }

      const gearId = cleanString(entry.gearId ?? entry.id ?? entry.itemId);
      if (!gearId) {
        return null;
      }

      return {
        gearId,
        quantity: Math.max(1, Math.floor(toFiniteNumber(entry.quantity ?? entry.count, 1)))
      };
    })
    .filter(Boolean);
}

function cloneContainerContents(value) {
  return normalizeContainerContents(value).map((entry) => ({ ...entry }));
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

function normalizeContainerCapacity(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const count = toFiniteNumber(value.count, 0);
  const volume = toFiniteNumber(value.volume, 0);
  const weight = toFiniteNumber(value.weight, 0);
  const units = cleanString(value.units, "lb");
  const volumeUnits = cleanString(value.volumeUnits, "ft3");

  return {
    count: count > 0 ? count : null,
    volume: {
      value: volume > 0 ? volume : null,
      units: volumeUnits
    },
    weight: {
      value: weight > 0 ? weight : null,
      units
    }
  };
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function clampRank(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Math.round(numericValue)));
}

function resolveItemSlotGroup(item, classification) {
  const explicitSlot = normalizeHeroDollSlotGroup(item.itemSlot ?? item.foundryItemSlot ?? "", "");
  if (explicitSlot) {
    return explicitSlot;
  }

  return inferHeroDollSlotGroupFromSlots(classification.heroDollSlots, "");
}

function goldToDnd5ePrice(priceGoldEquivalent) {
  const totalCopper = Math.max(0, Math.round(Number(priceGoldEquivalent ?? 0) * 100));
  if (totalCopper >= 100) {
    return {
      value: Math.round(((totalCopper / 100) + Number.EPSILON) * 100) / 100,
      denomination: "gp"
    };
  }

  if (totalCopper % 10 !== 0) {
    return { value: totalCopper, denomination: "cp" };
  }

  return { value: totalCopper / 10, denomination: "sp" };
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification.folderPath);
}

function stripTrailingParenthetical(value) {
  return cleanString(value).replace(/\s*\([^()]*\)\s*$/u, "").trim();
}

function getGearIconNameCandidates(item) {
  const name = cleanString(item?.name);
  if (!name) {
    return [];
  }

  const candidates = [];
  const equipmentType = cleanString(item?.equipmentType);
  if (equipmentType) {
    candidates.push(`${name} (${equipmentType})`);
  }

  candidates.push(name);

  const shortenedName = stripTrailingParenthetical(name);
  if (shortenedName && shortenedName !== name) {
    candidates.push(shortenedName);
  }

  return Array.from(new Set(candidates));
}

function resolveGearNamedIcon(item, iconLookup) {
  for (const iconName of getGearIconNameCandidates(item)) {
    const iconPath = resolveNamedIcon(iconName, iconLookup, "");
    if (iconPath) {
      return iconPath;
    }
  }

  return "";
}

function buildGearSignature(item) {
  const classification = classifyGearEntry(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  return JSON.stringify({
    templateVersion: GEAR_TEMPLATE_VERSION,
    name: item.name ?? "",
    equipmentType: item.equipmentType ?? "",
    priceText: item.priceText ?? "",
    priceValue: item.priceValue ?? 0,
    priceDenomination: item.priceDenomination ?? "gp",
    priceGoldEquivalent: item.priceGoldEquivalent ?? 0,
    rank: clampRank(item.rank),
    weight: item.weight ?? 0,
    volume: item.volume ?? "",
    capacity: item.capacity ?? "",
    containerCapacity: clonePlainObject(item.containerCapacity),
    containerContents: cloneContainerContents(item.containerContents),
    description: item.description ?? "",
    predominantMaterialId: item.predominantMaterialId ?? null,
    predominantMaterialName: item.predominantMaterialName ?? "",
    linkedTool: item.linkedTool ?? "",
    value: item.value ?? "",
    source: item.source ?? "",
    foundryType: classification.documentType,
    foundrySubtype: classification.systemTypeValue,
    foundrySubtypeExtra: classification.systemTypeSubtype,
    foundryBaseItem: classification.baseItem,
    folderPath: buildFolderPath(classification),
    itemSlot,
    heroDollSlots,
    firearmClass: classification.firearmClass,
    weapon: isPlainObject(item.weapon) ? item.weapon : null
  });
}

function getGearIcon(item, classification, iconLookup = null) {
  const folderPath = buildFolderPath(classification).join(" / ").toLowerCase();
  const typeText = normalizeMatchText(item.equipmentType);
  const namedCustomIcon = resolveGearNamedIcon(item, iconLookup);
  if (namedCustomIcon) {
    return namedCustomIcon;
  }

  if (classification.documentType === "container") {
    if (classification.systemTypeValue === "chest") {
      return "icons/containers/chest/chest-reinforced-steel-brown.webp";
    }

    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  if (classification.documentType === "weapon") {
    if (classification.firearmClass) {
      return "icons/weapons/guns/gun-pistol-flintlock-metal.webp";
    }

    const weaponName = normalizeMatchText(item.name);
    if (/арбалет/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/crossbows/crossbow-simple-brown.webp";
    }

    if (/пращ/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/slings/slingshot-wood.webp";
    }

    if (/лук/u.test(`${typeText} ${weaponName}`)) {
      return "icons/weapons/bows/longbow-recurve-brown.webp";
    }

    return "icons/weapons/swords/greatsword-crossguard-silver.webp";
  }

  if (classification.documentType === "equipment") {
    if (classification.systemTypeValue === "shield") {
      return "icons/equipment/shield/heater-steel-grey.webp";
    }

    return "icons/equipment/chest/breastplate-layered-steel.webp";
  }

  if (classification.documentType === "tool") {
    return "icons/tools/smithing/anvil.webp";
  }

  if (classification.documentType === "consumable") {
    if (classification.systemTypeValue === "ammo") {
      return "icons/weapons/ammunition/arrow-broadhead-glowing-orange.webp";
    }

    return "icons/consumables/potions/potion-bottle-corked-labeled-red.webp";
  }

  if (folderPath.includes("обвес")) {
    return "icons/tools/hand/wrench-steel-grey.webp";
  }

  if (folderPath.includes("скакуны") || folderPath.includes("транспорт")) {
    return "icons/environment/settlement/wagon.webp";
  }

  if (folderPath.includes("снаряжение") && /рюкзак|сумк|чехол|футляр/u.test(normalizeMatchText(item.name))) {
    return "icons/containers/bags/pack-simple-leather-brown.webp";
  }

  return DEFAULT_ITEM_ICON;
}

function buildMetadataRows(item, classification) {
  const itemSlotGroup = resolveItemSlotGroup(item, classification);
  const weapon = isPlainObject(item.weapon) ? item.weapon : {};
  const itemSlotLabel = {
    head: "Голова",
    neck: "Шея",
    shoulders: "Плечи",
    bracers: "Наручи",
    hand: "Рука",
    chest: "Грудь",
    belt: "Пояс",
    legs: "Ноги",
    ring: "Кольцо",
    back: "Спина"
  }[itemSlotGroup] ?? null;
  const heroDollSlotLabels = mapSlotGroupToHeroDollSlots(itemSlotGroup, classification.heroDollSlots)
    .map((slotId) => {
      const slotName = {
        head: "Голова",
        neck: "Шея",
        shoulders: "Плечи",
        chest: "Грудь",
        belt: "Пояс",
        legs: "Ноги",
        bracers: "Наручи",
        leftHand: "Рука",
        rightHand: "Рука",
        ring1: "Кольцо 1",
        ring2: "Кольцо 2",
        back1: "Спина 1",
        back2: "Спина 2",
        back3: "Спина 3",
        back4: "Спина 4",
        back5: "Спина 5"
      };
      return slotName[slotId] ?? slotId;
    });

  return [
    ["Тип снаряжения", item.equipmentType],
    ["Слот", itemSlotLabel],
    ["Тип Foundry", classification.documentType],
    ["Подтип Foundry", classification.systemTypeSubtype || classification.systemTypeValue || null],
    ["Базовый предмет", classification.baseItem || null],
    ["Папка", buildFolderPath(classification).join(" / ") || null],
    ["Слоты куклы", heroDollSlotLabels.join(", ") || null],
    ["Цена", item.priceText || null],
    ["Ранг", clampRank(item.rank)],
    ["Вес", item.weight ? `${item.weight} фнт.` : null],
    ["Объем", item.volume],
    ["Вместимость", item.capacity],
    ["Преобладающий материал", item.predominantMaterialName],
    ["Связанный инструмент", item.linkedTool],
    ["Value", item.value],
    ["Урон", weapon.damageFormula],
    ["Тип урона", weapon.damageTypeLabel],
    ["Свойства оружия", weapon.propertiesText]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function buildDescriptionHtml(item, classification) {
  const metadataRows = buildMetadataRows(item, classification);
  const descriptionText = String(item.description ?? "").trim();

  return `
    <section class="rebreya-gear-item">
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${renderValue(value)}</li>`).join("")}
        </ul>
      ` : ""}
      ${descriptionText
        ? `<p>${escapeHtml(descriptionText)}</p>`
        : "<p>Описание предмета пока не заполнено.</p>"}
    </section>
  `.trim();
}

function buildWeaponDamagePart(formula, damageType) {
  const safeFormula = cleanString(formula);
  const safeDamageType = cleanString(damageType);
  const simpleFormulaMatch = safeFormula.match(/^(\d+)d(\d+)(?:\s*\+\s*(.+))?$/iu);
  const damagePart = {
    types: safeDamageType ? [safeDamageType] : [],
    custom: {
      enabled: Boolean(safeFormula),
      formula: safeFormula
    }
  };

  if (simpleFormulaMatch) {
    damagePart.number = Number(simpleFormulaMatch[1]);
    damagePart.denomination = Number(simpleFormulaMatch[2]);
    damagePart.bonus = cleanString(simpleFormulaMatch[3]);
    damagePart.custom = {
      enabled: false,
      formula: ""
    };
  }

  if (!safeFormula) {
    damagePart.custom = {
      enabled: false,
      formula: ""
    };
  }

  return damagePart;
}

function normalizeWeaponRange(range) {
  if (!isPlainObject(range)) {
    return null;
  }

  const value = Number(range.value ?? 0);
  const long = Number(range.long ?? 0);
  const reach = Number(range.reach ?? 0);
  if (![value, long, reach].some((entry) => Number.isFinite(entry) && entry > 0)) {
    return null;
  }

  return {
    value: Number.isFinite(value) ? Math.max(0, value) : 0,
    long: Number.isFinite(long) ? Math.max(0, long) : 0,
    reach: Number.isFinite(reach) ? Math.max(0, reach) : 0,
    units: cleanString(range.units, "ft")
  };
}

function applyWeaponData(baseData, weapon) {
  if (!isPlainObject(weapon)) {
    return;
  }

  const properties = cleanArray(weapon.properties);
  if (properties.length) {
    baseData.properties = properties;
  }

  const damageFormula = cleanString(weapon.damageFormula);
  const damageType = cleanString(weapon.damageType);
  const versatileDamageFormula = cleanString(weapon.versatileDamageFormula);
  if (damageFormula || damageType || versatileDamageFormula) {
    baseData.damage = {
      base: buildWeaponDamagePart(damageFormula, damageType),
      versatile: buildWeaponDamagePart(versatileDamageFormula, damageType)
    };
  }

  const range = normalizeWeaponRange(weapon.range);
  if (range) {
    baseData.range = range;
  }
}

function buildSystemData(item, classification, descriptionHtml) {
  const weightValue = Number.isFinite(Number(item.weight)) ? Number(item.weight) : 0;
  const price = goldToDnd5ePrice(item.priceGoldEquivalent ?? item.priceValue ?? 0);
  const baseData = {
    description: {
      value: descriptionHtml,
      chat: ""
    },
    unidentified: {
      description: ""
    },
    quantity: 1,
    price: {
      value: price.value,
      denomination: price.denomination
    },
    weight: {
      value: weightValue,
      units: "lb"
    }
  };

  switch (classification.documentType) {
    case "weapon":
      baseData.type = {
        value: classification.systemTypeValue || "martialM",
        baseItem: classification.baseItem || ""
      };
      applyWeaponData(baseData, item.weapon);
      break;

    case "equipment":
      baseData.type = {
        value: classification.systemTypeValue || "wondrous",
        baseItem: classification.baseItem || ""
      };
      break;

    case "tool":
      baseData.type = {
        value: classification.systemTypeValue || "art",
        baseItem: classification.baseItem || ""
      };
      break;

    case "consumable":
      baseData.type = {
        value: classification.systemTypeValue || "potion",
        subtype: classification.systemTypeSubtype || ""
      };
      break;

    case "container":
      baseData.type = {
        value: classification.systemTypeValue || "backpack",
        subtype: classification.systemTypeSubtype || ""
      };
      baseData.capacity = normalizeContainerCapacity(item.containerCapacity) ?? {
        count: null,
        volume: {
          value: null,
          units: "ft3"
        },
        weight: {
          value: null,
          units: "lb"
        }
      };
      baseData.properties = cleanArray(item.containerProperties ?? item.properties);
      break;

    case "loot":
    default:
      baseData.type = {
        value: classification.systemTypeValue || "gear",
        subtype: classification.systemTypeSubtype || ""
      };
      break;
  }

  return baseData;
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  return JSON.parse(JSON.stringify(value));
}

export function createDnd5eItemData(item, folderIdByPath, iconLookup = null) {
  const classification = classifyGearEntry(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const signature = buildGearSignature(item);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);
  const weapon = isPlainObject(item.weapon) ? item.weapon : {};
  const attackTraits = clonePlainObject(weapon.attackTraits);
  const lichWeaponPropertyValues = clonePlainObject(weapon.lichWeaponPropertyValues);
  const attackTraitsText = cleanString(weapon.attackTraitsText || weapon.propertiesText);
  const containerContents = cloneContainerContents(item.containerContents);

  return {
    _id: createStableGearDocumentId(item.id),
    name: item.name,
    type: classification.documentType,
    img: getGearIcon(item, classification, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: buildSystemData(item, classification, descriptionHtml),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: item.id,
        signature,
        equipmentType: item.equipmentType ?? "",
        foundryType: classification.documentType,
        foundrySubtype: classification.systemTypeValue ?? "",
        foundrySubtypeExtra: classification.systemTypeSubtype ?? "",
        foundryBaseItem: classification.baseItem ?? "",
        foundryFolder: folderPath,
        itemSlot,
        heroDollSlots,
        rank: clampRank(item.rank),
        firearmClass: classification.firearmClass ?? "",
        predominantMaterialId: item.predominantMaterialId ?? null,
        predominantMaterialName: item.predominantMaterialName ?? "",
        linkedTool: item.linkedTool ?? "",
        value: item.value ?? "",
        priceGoldEquivalent: Number(item.priceGoldEquivalent ?? 0),
        containerCapacity: clonePlainObject(item.containerCapacity),
        containerContents,
        attackTraits: attackTraits && Object.keys(attackTraits).length ? attackTraits : null,
        attackTraitsText: attackTraitsText || null,
        attackProperties: attackTraitsText || null,
        lichWeaponPropertyValues: lichWeaponPropertyValues && Object.keys(lichWeaponPropertyValues).length
          ? lichWeaponPropertyValues
          : null
      }
    }
  };
}

export function createDnd5eContainerContentData(containerItem, gearById, containerDocumentId, folderIdByPath, iconLookup = null) {
  const containerId = cleanString(containerDocumentId);
  if (!containerId || !(gearById instanceof Map)) {
    return [];
  }

  return normalizeContainerContents(containerItem?.containerContents)
    .map((entry) => {
      const sourceItem = gearById.get(entry.gearId);
      if (!sourceItem) {
        return null;
      }

      const data = createDnd5eItemData(sourceItem, folderIdByPath, iconLookup);
      delete data._id;
      delete data.id;
      data.system ??= {};
      data.system.quantity = entry.quantity;
      data.system.container = containerId;

      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      const moduleFlags = data.flags[MODULE_ID];
      delete moduleFlags.gearId;
      moduleFlags.sourceType = GEAR_CONTAINER_CONTENT_SOURCE_TYPE;
      moduleFlags.containerGearId = cleanString(containerItem?.id);
      moduleFlags.containerContentGearId = entry.gearId;
      moduleFlags.containerContentQuantity = entry.quantity;
      moduleFlags.signature = JSON.stringify({
        templateVersion: GEAR_TEMPLATE_VERSION,
        sourceType: GEAR_CONTAINER_CONTENT_SOURCE_TYPE,
        containerGearId: moduleFlags.containerGearId,
        containerContentGearId: entry.gearId,
        quantity: entry.quantity,
        sourceSignature: buildGearSignature(sourceItem)
      });

      return data;
    })
    .filter(Boolean);
}

function getDesiredPackMetadata() {
  return {
    label: GEAR_COMPENDIUM_LABEL,
    type: "Item",
    name: GEAR_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["loot", "weapon", "equipment", "tool", "consumable", "container"]
      }
    }
  };
}

async function ensureGearPack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign gear compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findGearDocument(pack, gearItem) {
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.gearId`, `flags.${MODULE_ID}.sourceType`]
  });
  const primaryEntries = Array.from(index ?? []).filter((entry) => (
    foundry.utils.getProperty(entry, `flags.${MODULE_ID}.sourceType`) !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE
  ));
  const indexEntry = primaryEntries.find((entry) => {
    const gearId = foundry.utils.getProperty(entry, `flags.${MODULE_ID}.gearId`);
    return gearId === gearItem.id;
  }) ?? primaryEntries.find((entry) => normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name));

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  const primaryDocuments = documents.filter((entry) => (
    entry.getFlag(MODULE_ID, "sourceType") !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE
  ));
  return primaryDocuments.find((entry) => {
    const gearId = entry.getFlag(MODULE_ID, "gearId");
    return gearId === gearItem.id;
  }) ?? primaryDocuments.find((entry) => normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name)) ?? null;
}

function getExpectedManagedDocumentCount(gear) {
  const gearById = new Set(gear.map((item) => cleanString(item?.id)).filter(Boolean));
  const contentCount = gear.reduce((total, item) => (
    total + normalizeContainerContents(item?.containerContents)
      .filter((entry) => gearById.has(entry.gearId))
      .length
  ), 0);
  return gear.length + contentCount;
}

function shouldRebuildPack(gear, documents) {
  if (getLegacyDuplicateDocumentIds(gear, documents).length) {
    return true;
  }

  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== getExpectedManagedDocumentCount(gear)) {
    return true;
  }

  const primaryDocuments = managedDocuments
    .filter((document) => document.getFlag(MODULE_ID, "sourceType") !== GEAR_CONTAINER_CONTENT_SOURCE_TYPE);
  if (primaryDocuments.length !== gear.length) {
    return true;
  }

  const gearById = new Map(gear.map((item) => [item.id, item]));
  for (const document of primaryDocuments) {
    const gearId = document.getFlag(MODULE_ID, "gearId");
    const signature = document.getFlag(MODULE_ID, "signature");
    const item = gearById.get(gearId);
    if (!item) {
      return true;
    }

    if (signature !== buildGearSignature(item)) {
      return true;
    }
  }

  return false;
}

function getLegacyDuplicateDocumentIds(gear, documents) {
  const gearIds = new Set(
    gear.map((item) => String(item?.id ?? "").trim()).filter(Boolean)
  );
  const gearNameKeys = new Set(
    gear.map((item) => normalizeMatchText(item?.name ?? "")).filter(Boolean)
  );

  return documents
    .filter((document) => !document.getFlag(MODULE_ID, "managed"))
    .filter((document) => {
      const legacyGearId = String(document.getFlag(MODULE_ID, "gearId") ?? "").trim();
      if (legacyGearId && gearIds.has(legacyGearId)) {
        return true;
      }

      return gearNameKeys.has(normalizeMatchText(document.name));
    })
    .map((document) => document.id);
}

async function deleteManagedDocuments(pack, documents, gear = []) {
  const managedIds = documents
    .filter((document) => document.getFlag(MODULE_ID, "managed"))
    .map((document) => document.id);
  const legacyDuplicateIds = getLegacyDuplicateDocumentIds(gear, documents);
  const deleteIds = Array.from(new Set([...managedIds, ...legacyDuplicateIds]));

  if (!deleteIds.length) {
    return;
  }

  await Item.implementation.deleteDocuments(deleteIds, { pack: pack.collection });
}

async function syncManagedDocumentIcons(pack, documents, iconLookup) {
  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const currentIcon = String(document.img ?? "").trim() || DEFAULT_ITEM_ICON;
    const nextIcon = resolveGearNamedIcon({
      name: document.name,
      equipmentType: document.getFlag(MODULE_ID, "equipmentType")
    }, iconLookup) || currentIcon;
    if (!nextIcon || nextIcon === currentIcon) {
      continue;
    }

    updates.push({
      _id: document.id,
      img: nextIcon
    });
  }

  if (!updates.length) {
    return;
  }

  await Item.implementation.updateDocuments(updates, { pack: pack.collection });
}

async function createManagedDocuments(pack, gear, iconLookup = null) {
  if (!gear.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      gear.map((item) => buildFolderPath(classifyGearEntry(item)))
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for gear pack.`, error);
  }

  const createdDocuments = await Item.implementation.createDocuments(
    gear.map((item) => createDnd5eItemData(item, folderIdByPath, iconLookup)),
    { pack: pack.collection }
  );
  const createdByGearId = new Map(
    collectionValues(createdDocuments)
      .map((document) => [document.getFlag?.(MODULE_ID, "gearId"), document])
      .filter(([gearId]) => gearId)
  );
  const gearById = new Map(gear.map((item) => [item.id, item]));
  const containedDocumentsData = gear.flatMap((item) => {
    if (!normalizeContainerContents(item.containerContents).length) {
      return [];
    }

    const containerDocumentId = cleanString(createdByGearId.get(item.id)?.id);
    if (!containerDocumentId) {
      console.warn(`${MODULE_ID} | Failed to create contents for gear container '${item.id}': missing created container document.`);
      return [];
    }

    return createDnd5eContainerContentData(item, gearById, containerDocumentId, folderIdByPath, iconLookup);
  });

  if (containedDocumentsData.length) {
    await Item.implementation.createDocuments(containedDocumentsData, { pack: pack.collection });
  }
}

export class GearCompendiumService {
  async sync(gear = []) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const safeGear = Array.isArray(gear) ? gear : [];
    const pack = await ensureGearPack();
    await deduplicateCompendiumFolders(pack, ["Обвес", "Обвесы", "Огнестрельное оружие", "Примитивное", "Продвинутое"]);
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(GEAR_ICON_SEARCH_PATHS, { forceRefresh: true });
    if (!shouldRebuildPack(safeGear, documents)) {
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return pack;
    }

    await deleteManagedDocuments(pack, documents, safeGear);
    await createManagedDocuments(pack, safeGear, iconLookup);

    return game.packs.get(PACK_ID) ?? pack;
  }

  async openGear(gearItem) {
    if (!gearItem) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    const document = await findGearDocument(pack, gearItem);

    if (!document) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.GearEntryNotFound"));
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
