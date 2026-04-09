import { GEAR_COMPENDIUM_LABEL, GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import { ensureCompendiumFolders, normalizeFolderPath } from "./compendium-utils.js";
import {
  classifyGearEntry,
  inferHeroDollSlotGroupFromSlots,
  mapSlotGroupToHeroDollSlots,
  normalizeHeroDollSlotGroup
} from "./item-classification.js";

const PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const GEAR_TEMPLATE_VERSION = 4;

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
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
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
    firearmClass: classification.firearmClass
  });
}

function getGearIcon(item, classification) {
  const folderPath = buildFolderPath(classification).join(" / ").toLowerCase();
  const typeText = normalizeMatchText(item.equipmentType);

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
    ["Value", item.value]
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

function createDnd5eItemData(item, folderIdByPath) {
  const classification = classifyGearEntry(item);
  const itemSlot = resolveItemSlotGroup(item, classification);
  const heroDollSlots = mapSlotGroupToHeroDollSlots(itemSlot, classification.heroDollSlots);
  const signature = buildGearSignature(item);
  const folderPath = buildFolderPath(classification).join("/");
  const descriptionHtml = buildDescriptionHtml(item, classification);

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
        priceGoldEquivalent: Number(item.priceGoldEquivalent ?? 0)
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

  if (pack) {
    return pack;
  }

  return foundry.documents.collections.CompendiumCollection.createCompendium(desired);
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

async function deleteManagedDocuments(pack, documents) {
  const managedIds = documents
    .filter((document) => document.getFlag(MODULE_ID, "managed"))
    .map((document) => document.id);

  if (!managedIds.length) {
    return;
  }

  await Item.implementation.deleteDocuments(managedIds, { pack: pack.collection });
}

async function createManagedDocuments(pack, gear) {
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
    const documents = await getPackDocuments(pack);
    if (!shouldRebuildPack(safeGear, documents)) {
      return pack;
    }

    await deleteManagedDocuments(pack, documents);
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
