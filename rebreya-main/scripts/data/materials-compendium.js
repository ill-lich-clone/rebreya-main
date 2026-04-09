import { MATERIALS_COMPENDIUM_LABEL, MATERIALS_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { bringAppToFront } from "../ui.js";

const PACK_ID = `world.${MATERIALS_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const DEFAULT_ITEM_ICON = "systems/dnd5e/icons/svg/items/loot.svg";
const MATERIALS_TEMPLATE_VERSION = 3;
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

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function renderValue(value, fallback = "&mdash;") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return escapeHtml(value);
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
  const descriptionText = String(material.description ?? "").trim() || (material.isSynthetic ? buildSyntheticDescription(material) : "");

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
    </section>
  `.trim();
}

function createDnd5eItemData(material) {
  const signature = buildMaterialSignature(material);
  const weightValue = Number.isFinite(Number(material.weight)) ? Number(material.weight) : 0;
  const price = goldToDnd5ePrice(material.priceGold);

  return {
    name: material.name,
    type: "loot",
    img: getMaterialIcon(material),
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

  if (pack) {
    return pack;
  }

  return foundry.documents.collections.CompendiumCollection.createCompendium(desired);
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

function shouldRebuildPack(materials, documents) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== materials.length) {
    return true;
  }

  const materialById = new Map(materials.map((material) => [material.id, material]));
  for (const document of managedDocuments) {
    const materialId = document.getFlag(MODULE_ID, "materialId");
    const signature = document.getFlag(MODULE_ID, "signature");
    const material = materialById.get(materialId);
    if (!material) {
      return true;
    }

    if (signature !== buildMaterialSignature(material)) {
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

async function createManagedDocuments(pack, materials) {
  if (!materials.length) {
    return;
  }

  await Item.implementation.createDocuments(
    materials.map((material) => createDnd5eItemData(material)),
    { pack: pack.collection }
  );
}

export class MaterialsCompendiumService {
  async sync(materials = []) {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const safeMaterials = Array.isArray(materials) ? materials : [];
    const pack = await ensureMaterialsPack();
    const documents = await getPackDocuments(pack);
    if (!shouldRebuildPack(safeMaterials, documents)) {
      return pack;
    }

    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(pack, safeMaterials);

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
