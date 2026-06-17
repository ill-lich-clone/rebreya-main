import { MAGIC_ITEMS_COMPENDIUM_LABEL, MAGIC_ITEMS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import {
  buildSlug,
  classifyMagicItem,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";
import { MAGIC_ITEMS } from "../../magicItem.js";

const PACK_ID = `world.${MAGIC_ITEMS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_MAGIC_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const MAGIC_TEMPLATE_VERSION = 3;
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const MAGIC_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Magic Items`, MODULE_ICONS_BASE_PATH];

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clampRank(value) {
  return Math.max(0, Math.min(10, Math.round(toNumber(value, 0))));
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const text = String(value ?? "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "да"].includes(text);
}

function normalizeRarity(value) {
  switch (normalizeMatchText(value)) {
    case "обычный":
      return "common";
    case "необычный":
      return "uncommon";
    case "редкий":
      return "rare";
    case "очень редкий":
      return "veryRare";
    case "легендарный":
      return "legendary";
    case "артефакт":
      return "artifact";
    default:
      return "";
  }
}

function resolveItemSlotGroup(item, classification) {
  const explicitSlot = normalizeHeroDollSlotGroup(item.itemSlot ?? "", "");
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

export function parseFixedPriceTextToGold(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/,/gu, ".")
    .replace(/\s+/gu, " ");

  if (!text || text === "—" || text === "-") {
    return null;
  }

  const match = text.match(/^(\d[\d ]*(?:\.\d+)?)\s*(пм|pp|эм|ep|зм|gp|см|sp|мм|cp)$/iu);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[1].replace(/\s+/gu, ""));
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  switch (match[2].toLowerCase()) {
    case "пм":
    case "pp":
      return numericValue * 10;
    case "эм":
    case "ep":
      return numericValue * 0.5;
    case "зм":
    case "gp":
      return numericValue;
    case "см":
    case "sp":
      return numericValue * 0.1;
    case "мм":
    case "cp":
      return numericValue * 0.01;
    default:
      return null;
  }
}

function getNativeMagicItemPrice(item) {
  const parsedCostGold = parseFixedPriceTextToGold(item?.costText);
  if (parsedCostGold === null) {
    return {
      value: null,
      denomination: "gp"
    };
  }

  return goldToDnd5ePrice(parsedCostGold);
}

export function normalizeMagicItems(rawItems = MAGIC_ITEMS) {
  const usedIds = new Set();
  return (Array.isArray(rawItems) ? rawItems : [])
    .filter(Boolean)
    .map((rawItem, index) => {
      const name = String(rawItem.name ?? rawItem.Name ?? `Магический предмет ${index + 1}`).trim();
      const baseId = buildSlug(rawItem.id ?? name, "magic-item");
      let id = baseId;
      let duplicateIndex = 2;
      while (usedIds.has(id)) {
        id = `${baseId}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedIds.add(id);

      return {
        id,
        name,
        type: String(rawItem.type ?? rawItem.Type ?? "Магический предмет").trim(),
        rarity: String(rawItem.rarity ?? rawItem.itemRarity ?? "").trim(),
        itemType: String(rawItem.itemType ?? rawItem.ItemType ?? "").trim(),
        itemSubtype: String(rawItem.itemSubtype ?? "").trim(),
        itemSlot: String(rawItem.itemSlot ?? "").trim(),
        source: String(rawItem.source ?? rawItem.itemSourse ?? "").trim(),
        rank: clampRank(rawItem.rank),
        materials: String(rawItem.materials ?? rawItem.item_materials ?? "").trim(),
        bargaining: String(rawItem.bargaining ?? rawItem.itemBargaining ?? "").trim(),
        costText: String(rawItem.costText ?? rawItem.itemCost ?? "").trim(),
        impact: String(rawItem.impact ?? rawItem.item_impact ?? "").trim(),
        attunement: String(rawItem.attunement ?? rawItem.itemAttunementDetails ?? "").trim(),
        isConsumable: normalizeBoolean(rawItem.isConsumable),
        description: String(rawItem.description ?? rawItem.Desc ?? "").trim(),
        priceGold: toNumber(rawItem.priceGold ?? rawItem.value, 0),
        heroDollSlots: rawItem.heroDollSlots ?? null
      };
    });
}

function buildFolderPath(classification) {
  return normalizeFolderPath(classification.folderPath);
}

function buildMagicSignature(item) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  return JSON.stringify({
    templateVersion: MAGIC_TEMPLATE_VERSION,
    id: item.id,
    name: item.name,
    type: item.type,
    rarity: item.rarity,
    itemType: item.itemType,
    itemSubtype: item.itemSubtype,
    itemSlot,
    source: item.source,
    rank: clampRank(item.rank),
    materials: item.materials,
    bargaining: item.bargaining,
    costText: item.costText,
    impact: item.impact,
    attunement: item.attunement,
    isConsumable: item.isConsumable,
    description: item.description,
    priceGold: item.priceGold,
    foundryType: classification.documentType,
    foundrySubtype: classification.systemTypeValue,
    foundrySubtypeExtra: classification.systemTypeSubtype,
    foundryBaseItem: classification.baseItem,
    folderPath: buildFolderPath(classification),
    heroDollSlots,
    firearmClass: classification.firearmClass
  });
}

function getMagicItemIcon(item, _classification, iconLookup = null) {
  return resolveNamedIcon(item?.name, iconLookup, DEFAULT_MAGIC_ITEM_ICON);
}

function buildMetadataRows(item, classification) {
  const itemSlotGroup = resolveItemSlotGroup(item, classification);
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
    })
    .filter(Boolean);

  return [
    ["Тип", item.type],
    ["Редкость", item.rarity],
    ["Вид предмета", item.itemType],
    ["Подтип", item.itemSubtype || null],
    ["Слот", itemSlotLabel],
    ["Слоты куклы", heroDollSlotLabels.join(", ") || null],
    ["Источник", item.source || null],
    ["Ранг", clampRank(item.rank)],
    ["Материалы", item.materials || null],
    ["Торг", item.bargaining || null],
    ["Цена", item.costText || null],
    ["Оценка", item.priceGold ? `${item.priceGold} зм` : null],
    ["Воздействие", item.impact || null],
    ["Настройка", item.attunement || null],
    ["Тип Foundry", classification.documentType],
    ["Подтип Foundry", classification.systemTypeSubtype || classification.systemTypeValue || null]
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function buildDescriptionHtml(item, classification) {
  const metadataRows = buildMetadataRows(item, classification);
  return `
    <section class="rebreya-gear-item">
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}
        </ul>
      ` : ""}
      ${item.description
        ? `<p>${escapeHtml(item.description)}</p>`
        : "<p>Описание магического предмета пока не заполнено.</p>"}
    </section>
  `.trim();
}

export function buildSystemData(item, classification, descriptionHtml) {
  const price = getNativeMagicItemPrice(item);
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
      value: 0,
      units: "lb"
    },
    rarity: normalizeRarity(item.rarity),
    properties: ["mgc"]
  };

  switch (classification.documentType) {
    case "weapon":
      baseData.type = {
        value: classification.systemTypeValue || "martialM",
        baseItem: classification.baseItem || ""
      };
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

export function createMagicItemData(item, folderIdByPath, iconLookup = null) {
  const classification = classifyMagicItem(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const rank = clampRank(item.rank);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);

  return {
    name: item.name,
    type: classification.documentType,
    img: getMagicItemIcon(item, classification, iconLookup),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: buildSystemData(item, classification, descriptionHtml),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "magicItem",
        magicItemId: item.id,
        signature: buildMagicSignature(item),
        rarity: item.rarity,
        itemType: item.itemType,
        itemSubtype: item.itemSubtype,
        itemSlot,
        heroDollSlots,
        rank,
        foundryType: classification.documentType,
        foundrySubtype: classification.systemTypeValue ?? "",
        foundrySubtypeExtra: classification.systemTypeSubtype ?? "",
        foundryBaseItem: classification.baseItem ?? "",
        foundryFolder: folderPath,
        firearmClass: classification.firearmClass ?? "",
        magical: true,
        attunement: item.attunement,
        bargaining: item.bargaining,
        itemBargaining: item.bargaining,
        isConsumable: item.isConsumable,
        value: Math.max(1, Math.round(toNumber(item.priceGold, 0))),
        priceGold: item.priceGold,
        source: item.source
      }
    }
  };
}

function getDesiredPackMetadata() {
  return {
    label: MAGIC_ITEMS_COMPENDIUM_LABEL,
    type: "Item",
    name: MAGIC_ITEMS_COMPENDIUM_NAME,
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

async function ensurePack() {
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
    console.warn(`${MODULE_ID} | Failed to assign magic items compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findMagicItemDocument(pack, magicItemId, fallbackName = "") {
  const normalizedId = String(magicItemId ?? "").trim();
  const normalizedFallbackName = normalizeMatchText(fallbackName);
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.magicItemId`]
  });
  const indexEntry = index.find((entry) => {
    const entryMagicItemId = String(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.magicItemId`) ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const entryMagicItemId = String(entry.getFlag(MODULE_ID, "magicItemId") ?? "").trim();
    if (normalizedId && entryMagicItemId === normalizedId) {
      return true;
    }

    return normalizedFallbackName && normalizeMatchText(entry.name) === normalizedFallbackName;
  }) ?? null;
}

function shouldRebuildPack(items, documents) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== items.length) {
    return true;
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const document of managedDocuments) {
    const itemId = document.getFlag(MODULE_ID, "magicItemId");
    const item = byId.get(itemId);
    if (!item) {
      return true;
    }

    const entryBargaining = String(document.getFlag(MODULE_ID, "bargaining") ?? "").trim();
    if (!entryBargaining) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== buildMagicSignature(item)) {
      return true;
    }
  }

  return false;
}

async function deleteManagedDocuments(pack, documents) {
  const managedIds = documents
    .filter((document) => document.getFlag(MODULE_ID, "managed"))
    .map((document) => document.id);
  if (!managedIds.length) {
    return;
  }

  await Item.implementation.deleteDocuments(managedIds, { pack: pack.collection });
}

async function syncManagedDocumentIcons(pack, documents, iconLookup) {
  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const currentIcon = String(document.img ?? "").trim() || DEFAULT_MAGIC_ITEM_ICON;
    const nextIcon = resolveNamedIcon(document.name, iconLookup, currentIcon);
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

async function createManagedDocuments(pack, items, iconLookup = null) {
  if (!items.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      items.map((item) => buildFolderPath(classifyMagicItem(item)))
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for magic pack.`, error);
  }

  await Item.implementation.createDocuments(
    items.map((item) => createMagicItemData(item, folderIdByPath, iconLookup)),
    { pack: pack.collection }
  );
}

export class MagicItemsCompendiumService {
  async sync(items = MAGIC_ITEMS) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const normalizedItems = normalizeMagicItems(items);
    const pack = await ensurePack();
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(MAGIC_ICON_SEARCH_PATHS, { forceRefresh: true });
    if (!shouldRebuildPack(normalizedItems, documents)) {
      await syncManagedDocumentIcons(pack, documents, iconLookup);
      return game.packs.get(PACK_ID) ?? pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, normalizedItems, iconLookup);
    const activePack = game.packs.get(PACK_ID) ?? pack;
    const activeDocuments = await getPackDocuments(activePack);
    await syncManagedDocumentIcons(activePack, activeDocuments, iconLookup);

    return activePack;
  }

  async getMagicItemDocument(magicItemId, fallbackName = "") {
    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      return null;
    }

    return findMagicItemDocument(pack, magicItemId, fallbackName);
  }

  async openMagicItem(magicItemId, fallbackName = "") {
    const document = await this.getMagicItemDocument(magicItemId, fallbackName);
    if (!document) {
      ui.notifications?.warn("Запись магического предмета не найдена в компендиуме.");
      return null;
    }

    await document.sheet?.render?.(true);
    const app = document.sheet;
    if (typeof app?.bringToFront === "function") {
      app.bringToFront();
    }
    return document;
  }
}
