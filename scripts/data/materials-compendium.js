import { MATERIALS_COMPENDIUM_LABEL, MATERIALS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";
import { escapeFoundryHtml as escapeHtml } from "../shared/foundry-values.js";
import { buildNamedIconLookup, ensurePackSidebarFolder, resolveNamedIcon } from "./compendium-utils.js";
import { syncManagedDocumentsOnActiveGm } from "./managed-compendium-sync.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const PACK_ID = `world.${MATERIALS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const DEFAULT_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const MATERIALS_TEMPLATE_VERSION = 4;
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const MATERIAL_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Materials`, MODULE_ICONS_BASE_PATH];
const FOOD_GOOD_IDS = new Set([
  "pshenitsa",
  "muka",
  "myaso",
  "ryba",
  "ovoshchi",
  "frukty",
  "sakhar",
  "sol",
  "myod"
]);

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function renderValue(value, fallback = "&mdash;") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return escapeHtml(value);
}

function normalizeApplications(material) {
  return {
    upgrade: String(material?.applications?.upgrade ?? ""),
    implant: String(material?.applications?.implant ?? ""),
    crafting: String(material?.applications?.crafting ?? ""),
    alchemy: String(material?.applications?.alchemy ?? ""),
    knowledge: String(material?.applications?.knowledge ?? "")
  };
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function goldToDnd5ePrice(priceGold) {
  const totalCopper = Math.max(0, Math.round(Number(priceGold ?? 0) * 100));
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

function buildMaterialSignature(material) {
  return JSON.stringify({
    templateVersion: MATERIALS_TEMPLATE_VERSION,
    name: material.name ?? "",
    type: material.type ?? "",
    subtype: material.subtype ?? "",
    priceGold: material.priceGold ?? null,
    weight: material.weight ?? null,
    rank: material.rank ?? null,
    description: material.description ?? "",
    applications: normalizeApplications(material),
    alchemyAspects: String(material.alchemyAspects ?? ""),
    linkedGoodId: material.linkedGoodId ?? null,
    linkedGoodName: material.linkedGoodName ?? "",
    source: material.source ?? "",
    isSynthetic: Boolean(material.isSynthetic)
  });
}

function getLootType(material) {
  if (material.isSynthetic) {
    return "resource";
  }

  if (FOOD_GOOD_IDS.has(material.linkedGoodId)) {
    return "trade";
  }

  return "trade";
}

function getMaterialIcon(material) {
  const goodId = material.linkedGoodId ?? "";
  const typeText = normalizeMatchText(material.type);

  if (FOOD_GOOD_IDS.has(goodId)) {
    return "icons/consumables/grains/bread-loaf-boule-rustic-brown.webp";
  }

  if (goodId === "chernila") {
    return "systems/dnd5e/icons/svg/ink-pot.svg";
  }

  if (goodId === "porokh") {
    return "icons/commodities/materials/powder-black.webp";
  }

  if (goodId === "zhidkiy-ugol" || goodId === "maslo" || goodId === "spirt") {
    return "icons/consumables/potions/bottle-round-corked-green.webp";
  }

  if (typeText.includes("минерал")) {
    return "icons/commodities/metal/ingot-iron.webp";
  }

  if (typeText.includes("растение")) {
    return "icons/commodities/materials/plant-sprout-brown-green.webp";
  }

  if (typeText.includes("существо")) {
    return "icons/commodities/leather/leather-bolt-brown.webp";
  }

  return DEFAULT_ITEM_ICON;
}

function buildMetadataRows(material) {
  const rows = [];

  if (material.type) {
    rows.push(["Тип", material.type]);
  }

  if (material.subtype) {
    rows.push(["Подтип / добыча", material.subtype]);
  }

  if (material.rank !== null && material.rank !== undefined && material.rank !== "") {
    rows.push(["Ранг", material.rank]);
  }

  if (
    material.linkedGoodName
    && normalizeMatchText(material.linkedGoodName) !== normalizeMatchText(material.name)
  ) {
    rows.push(["Экономический товар", material.linkedGoodName]);
  }

  return rows;
}

function buildSyntheticDescription(material) {
  const targetName = material.linkedGoodName || material.name || "этого товара";
  return `Материал создан автоматически, потому что для товара «${targetName}» нет отдельной строки в таблице материалов.`;
}

function buildDescriptionHtml(material) {
  const metadataRows = buildMetadataRows(material);
  const sourceDescription = String(material.description ?? "");
  const descriptionText = sourceDescription.trim()
    ? sourceDescription
    : (material.isSynthetic ? buildSyntheticDescription(material) : "");
  const applications = normalizeApplications(material);
  const applicationRows = [
    ["Усовершенствование", applications.upgrade],
    ["Имплант", applications.implant],
    ["Создание и снаряжение", applications.crafting],
    ["Алхимия", applications.alchemy],
    ["Знания", applications.knowledge],
    ["Аспекты (алхимия)", String(material.alchemyAspects ?? "")]
  ];

  return `
    <section class="rebreya-material-item">
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${renderValue(value)}</li>`).join("")}
        </ul>
      ` : ""}
      ${descriptionText
        ? `<p>${escapeHtml(descriptionText)}</p>`
        : "<p>Описание материала пока не заполнено.</p>"}
      <h3>Применение</h3>
      <ul>
        ${applicationRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${renderValue(value)}</li>`).join("")}
      </ul>
    </section>
  `.trim();
}

export function createDnd5eItemData(material, iconLookup = null) {
  const signature = buildMaterialSignature(material);
  const weightValue = Number.isFinite(Number(material.weight)) ? Number(material.weight) : 0;
  const price = goldToDnd5ePrice(material.priceGold);
  const defaultIcon = getMaterialIcon(material);
  const resolvedIcon = resolveNamedIcon(material.name, iconLookup, defaultIcon);

  return {
    name: material.name,
    type: "loot",
    img: resolvedIcon,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: {
      description: {
        value: buildDescriptionHtml(material),
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
      },
      type: {
        value: getLootType(material),
        subtype: String(material.subtype ?? "").trim()
      }
    },
    flags: {
      [MODULE_ID]: {
        managed: true,
        materialId: material.id,
        linkedGoodId: material.linkedGoodId ?? null,
        priceGold: material.priceGold ?? null,
        weight: material.weight ?? null,
        rank: material.rank ?? null,
        applications: normalizeApplications(material),
        alchemyAspects: String(material.alchemyAspects ?? ""),
        signature,
        source: material.source ?? "",
        isSynthetic: Boolean(material.isSynthetic)
      }
    }
  };
}

function getDesiredPackMetadata() {
  return {
    label: MATERIALS_COMPENDIUM_LABEL,
    type: "Item",
    name: MATERIALS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["loot"]
      }
    }
  };
}

async function ensureMaterialsPack() {
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
    console.warn(`${MODULE_ID} | Failed to assign materials compendium to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function findMaterialDocument(pack, material) {
  const index = await pack.getIndex({
    fields: [`flags.${MODULE_ID}.materialId`]
  });
  const indexEntry = index.find((entry) => {
    const materialId = foundry.utils.getProperty(entry, `flags.${MODULE_ID}.materialId`);
    return materialId === material.id || normalizeMatchText(entry.name) === normalizeMatchText(material.name);
  });

  if (indexEntry) {
    return pack.getDocument(indexEntry._id ?? indexEntry.id);
  }

  const documents = await pack.getDocuments();
  return documents.find((entry) => {
    const materialId = entry.getFlag(MODULE_ID, "materialId");
    return materialId === material.id || normalizeMatchText(entry.name) === normalizeMatchText(material.name);
  }) ?? null;
}

export class MaterialsCompendiumService {
  async syncPartyItemIcons(materials = [], iconLookup = null) {
    if (!isActiveGmClient(game) || !isDnd5eWorld()) return 0;
    const byId = new Map(materials.map(material => [material.id, material]));
    let updated = 0;
    for (const actor of game.actors?.contents ?? []) {
      if (actor.type !== "group" || actor.flags?.[MODULE_ID]?.managedPartyGroup !== true) continue;
      for (const item of actor.items?.contents ?? []) {
        if (!isActiveGmClient(game)) return updated;
        const flags = item.flags?.[MODULE_ID];
        const material = flags?.managed === true ? byId.get(flags.materialId) : null;
        if (!material || item.img !== getMaterialIcon(material)) continue;
        const img = resolveNamedIcon(material.name, iconLookup, "");
        if (!img || img === item.img) continue;
        await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, img }]);
        updated += 1;
      }
    }
    return updated;
  }

  async sync(materials = []) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const safeMaterials = Array.isArray(materials) ? materials : [];
    const pack = await ensureMaterialsPack();
    const documents = await getPackDocuments(pack);
    const iconLookup = await buildNamedIconLookup(MATERIAL_ICON_SEARCH_PATHS, { forceRefresh: true });
    await syncManagedDocumentsOnActiveGm(game, {
      pack,
      entries: safeMaterials,
      documents,
      sourceIdOfEntry: (material) => material.id,
      sourceIdOfDocument: (document) => document.getFlag(MODULE_ID, "managed")
        ? document.getFlag(MODULE_ID, "materialId")
        : "",
      signatureOfEntry: (material) => JSON.stringify([
        buildMaterialSignature(material),
        resolveNamedIcon(material.name, iconLookup, DEFAULT_ITEM_ICON)
      ]),
      signatureOfDocument: (document) => JSON.stringify([
        document.getFlag(MODULE_ID, "signature"),
        String(document.img ?? "").trim() || DEFAULT_ITEM_ICON
      ]),
      createData: (material) => createDnd5eItemData(material, iconLookup),
      updateData: (_document, material) => {
        const data = createDnd5eItemData(material, iconLookup);
        delete data._id;
        return data;
      }
    });
    await this.syncPartyItemIcons(safeMaterials, iconLookup);
    return game.packs.get(PACK_ID) ?? pack;
  }

  async openMaterial(material) {
    if (!material) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.MaterialNotFound"));
      return null;
    }

    const pack = game.packs.get(PACK_ID);
    if (!pack) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.MaterialEntryNotFound"));
      return null;
    }

    const document = await findMaterialDocument(pack, material);

    if (!document) {
      ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.MaterialEntryNotFound"));
      return null;
    }

    await document.sheet?.render?.(true);
    bringAppToFront(document.sheet);
    window.setTimeout(() => bringAppToFront(document.sheet), 40);
    window.setTimeout(() => bringAppToFront(document.sheet), 140);
    return document;
  }
}
