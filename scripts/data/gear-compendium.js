import { GEAR_COMPENDIUM_LABEL, GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import {
  deduplicateCompendiumFolders,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath
} from "./compendium-utils.js";
import {
  classifyGearEntry,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";

const PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const GEAR_TEMPLATE_VERSION = 7;
const CUSTOM_GEAR_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const SUPPORTED_GEAR_ICON_EXTENSIONS = new Set(["webp", "png", "jpg", "jpeg", "svg", "avif"]);
const customGearIconByName = new Map();
let customGearIconsCacheReady = false;

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

function resetCustomGearIconCache() {
  customGearIconsCacheReady = false;
  customGearIconByName.clear();
}

function registerCustomGearIcon(filePath) {
  const normalizedPath = String(filePath ?? "").replace(/\\/gu, "/");
  if (!normalizedPath) {
    return;
  }

  let filename = normalizedPath.split("/").pop() ?? "";
  try {
    filename = decodeURIComponent(filename);
  }
  catch (_error) {
    // Оставляем исходное имя, если путь уже не в URL-формате.
  }

  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return;
  }

  const extension = filename.slice(extensionIndex + 1).toLowerCase();
  if (!SUPPORTED_GEAR_ICON_EXTENSIONS.has(extension)) {
    return;
  }

  const iconName = filename.slice(0, extensionIndex);
  const key = normalizeMatchText(iconName);
  if (!key || customGearIconByName.has(key)) {
    return;
  }

  const encodedFilename = encodeURIComponent(filename);
  customGearIconByName.set(key, `${CUSTOM_GEAR_ICONS_BASE_PATH}/${encodedFilename}`);
}

async function browseIconDirectory(path) {
  let lastError = null;
  for (const source of ["data", "public"]) {
    try {
      return await FilePicker.browse(source, path);
    }
    catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Unable to browse icon directory: ${path}`);
}

async function ensureCustomGearIconCache(forceRefresh = false) {
  if (forceRefresh) {
    resetCustomGearIconCache();
  }

  if (customGearIconsCacheReady) {
    return;
  }

  customGearIconsCacheReady = true;

  if (typeof FilePicker !== "function" || typeof FilePicker.browse !== "function") {
    return;
  }

  const pendingPaths = [CUSTOM_GEAR_ICONS_BASE_PATH];
  const visitedPaths = new Set();

  while (pendingPaths.length) {
    const currentPath = pendingPaths.shift();
    if (!currentPath || visitedPaths.has(currentPath)) {
      continue;
    }
    visitedPaths.add(currentPath);

    try {
      const browseResult = await browseIconDirectory(currentPath);
      const files = Array.isArray(browseResult?.files) ? browseResult.files : [];
      const directories = Array.isArray(browseResult?.dirs) ? browseResult.dirs : [];
      files.forEach((filePath) => registerCustomGearIcon(filePath));
      directories.forEach((directoryPath) => pendingPaths.push(directoryPath));
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to scan custom gear icons path "${currentPath}".`, error);
    }
  }
}

function getCustomGearIconByName(name) {
  const key = normalizeMatchText(name);
  if (!key) {
    return "";
  }

  return customGearIconByName.get(key) ?? "";
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

function getGearIcon(item, classification) {
  const folderPath = buildFolderPath(classification).join(" / ").toLowerCase();
  const typeText = normalizeMatchText(item.equipmentType);
  const namedCustomIcon = getCustomGearIconByName(item.name);
  if (namedCustomIcon) {
    return namedCustomIcon;
  }

  if (classification.documentType === "weapon") {
    if (classification.firearmClass) {
      return "icons/weapons/guns/gun-pistol-flintlock-blue.webp";
    }

    if (/арбалет|лук|пращ/u.test(typeText + item.name.toLowerCase())) {
      return "icons/weapons/ammunition/arrows-war-quiver-brown.webp";
    }

    return "icons/weapons/swords/greatsword-crossguard-silver.webp";
  }

  if (classification.documentType === "equipment") {
    if (classification.systemTypeValue === "shield") {
      return "icons/equipment/shield/heater-steel-blue.webp";
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

    return "icons/consumables/potions/potion-bottle-corked-red.webp";
  }

  if (folderPath.includes("обвес")) {
    return "icons/tools/hand/wrench-double-headed.webp";
  }

  if (folderPath.includes("скакуны") || folderPath.includes("транспорт")) {
    return "icons/environment/settlement/wagon.webp";
  }

  if (folderPath.includes("снаряжение") && /рюкзак|сумк|чехол|футляр/u.test(normalizeMatchText(item.name))) {
    return "icons/containers/bags/pack-simple-brown.webp";
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

export function createDnd5eItemData(item, folderIdByPath) {
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

  return {
    name: item.name,
    type: classification.documentType,
    img: getGearIcon(item, classification),
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
        types: ["loot", "weapon", "equipment", "tool", "consumable"]
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
    fields: [`flags.${MODULE_ID}.gearId`]
  });
  const indexEntry = index.find((entry) => {
    const gearId = foundry.utils.getProperty(entry, `flags.${MODULE_ID}.gearId`);
    return gearId === gearItem.id || normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name);
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const gearId = entry.getFlag(MODULE_ID, "gearId");
    return gearId === gearItem.id || normalizeMatchText(entry.name) === normalizeMatchText(gearItem.name);
  }) ?? null;
}

function shouldRebuildPack(gear, documents) {
  if (getLegacyDuplicateDocumentIds(gear, documents).length) {
    return true;
  }

  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== gear.length) {
    return true;
  }

  const gearById = new Map(gear.map((item) => [item.id, item]));
  for (const document of managedDocuments) {
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

async function createManagedDocuments(pack, gear) {
  if (!gear.length) {
    return;
  }

  await ensureCustomGearIconCache(true);

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

  await Item.implementation.createDocuments(
    gear.map((item) => createDnd5eItemData(item, folderIdByPath)),
    { pack: pack.collection }
  );
}

export class GearCompendiumService {
  async sync(gear = []) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const safeGear = Array.isArray(gear) ? gear : [];
    const pack = await ensureGearPack();
    await deduplicateCompendiumFolders(pack, ["Обвес", "Обвесы", "Огнестрельное оружие"]);
    const documents = await getPackDocuments(pack);
    if (!shouldRebuildPack(safeGear, documents)) {
      return pack;
    }

    await deleteManagedDocuments(pack, documents, safeGear);
    await createManagedDocuments(pack, safeGear);

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
