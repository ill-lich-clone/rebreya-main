import {
  ALCHEMY_COMPENDIUM_LABEL,
  ALCHEMY_COMPENDIUM_NAME,
  MODULE_ID
} from "../constants.js?v=1.4.344";
import {
  ensureCompendiumFolders,
  ensurePackSidebarFolder
} from "./compendium-utils.js?v=1.4.327";
import { createStableGearDocumentId } from "./gear-document-ids.js";
import { syncManagedDocuments } from "./managed-compendium-sync.js?v=1.4.330";
import {
  buildAlchemyActivities,
  buildAlchemyConsumableUses
} from "./alchemy-automation.js?v=1.4.355";

const PACK_ID = `world.${ALCHEMY_COMPENDIUM_NAME}`;
const DND5E_SYSTEM_ID = "dnd5e";
const COMPENDIUM_SIDEBAR_FOLDER = Object.freeze(["Ребрея"]);
const TEMPLATE_VERSION = 3;
const MODULE_ASSET_PREFIX = `modules/${MODULE_ID}/`;
const APPROVED_PRODUCT_COUNT = 230;
const OMITTED_DUPLICATE_SOURCE_NUMBERS = new Set([36, 52, 67, 76]);
const APPROVED_SOURCE_NUMBERS = Object.freeze(
  Array.from({ length: 234 }, (_value, index) => index + 1)
    .filter((sourceNumber) => !OMITTED_DUPLICATE_SOURCE_NUMBERS.has(sourceNumber))
);

const SUBTYPE_BY_PRODUCT_TYPE = Object.freeze({
  "Зелье": "potion",
  "Масло": "potion",
  "Вещество": "food",
  "Бомба": "trinket",
  "Побочный продукт": "trinket",
  "Яд (Оружейный)": "poison",
  "Яд (Поглощаемый)": "poison",
  "Яд (Вдыхаемый)": "poison",
  "Яд (Контактный)": "poison"
});

const FOLDER_BY_PRODUCT_TYPE = Object.freeze({
  "Зелье": Object.freeze(["Зелья"]),
  "Масло": Object.freeze(["Масла"]),
  "Вещество": Object.freeze(["Вещества"]),
  "Бомба": Object.freeze(["Бомбы"]),
  "Побочный продукт": Object.freeze(["Побочные продукты"]),
  "Яд (Оружейный)": Object.freeze(["Яды", "Оружейные"]),
  "Яд (Поглощаемый)": Object.freeze(["Яды", "Поглощаемые"]),
  "Яд (Вдыхаемый)": Object.freeze(["Яды", "Вдыхаемые"]),
  "Яд (Контактный)": Object.freeze(["Яды", "Контактные"])
});

const ASPECT_LABELS = Object.freeze([
  ["fire", "Огонь"],
  ["water", "Вода"],
  ["earth", "Земля"],
  ["air", "Воздух"],
  ["positive", "Позитивная энергия"],
  ["negative", "Негативная энергия"]
]);

function cleanString(value) {
  return String(value ?? "").trim();
}

function isPresent(value) {
  return value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function validTypeKeys(validTypes) {
  if (validTypes instanceof Set) return Array.from(validTypes, cleanString).filter(Boolean);
  if (validTypes instanceof Map) return Array.from(validTypes.keys(), cleanString).filter(Boolean);
  if (Array.isArray(validTypes)) return validTypes.map(cleanString).filter(Boolean);
  if (validTypes && typeof validTypes === "object") return Object.keys(validTypes).map(cleanString).filter(Boolean);
  return [];
}

function runtimeConsumableTypes() {
  return globalThis.CONFIG?.DND5E?.consumableTypes ?? null;
}

export function resolveAlchemyConsumableSubtype(productType, validTypes = runtimeConsumableTypes()) {
  const type = cleanString(productType);
  const preferred = SUBTYPE_BY_PRODUCT_TYPE[type];
  if (!preferred) throw new Error(`Неизвестный тип алхимического продукта: ${type || "(пусто)"}`);

  const keys = validTypeKeys(validTypes);
  if (!keys.length || keys.includes(preferred)) return preferred;
  if (keys.includes("trinket")) return "trinket";
  return keys[0];
}

function requireRank(value) {
  const rank = Number(value);
  if (!Number.isInteger(rank) || rank < 1 || rank > 9) {
    throw new Error(`Некорректный ранг алхимического продукта: ${value}`);
  }
  return rank;
}

export function buildAlchemyFolderPath(product) {
  const type = cleanString(product?.productType);
  const base = FOLDER_BY_PRODUCT_TYPE[type];
  if (!base) throw new Error(`Неизвестный тип алхимического продукта: ${type || "(пусто)"}`);
  return [...base, `Ранг ${requireRank(product?.rank)}`];
}

export function buildAlchemyDescriptionHtml(product) {
  const descriptionText = cleanString(product?.effect);
  const metadataRows = [
    ["Эффект катализатора", product?.catalystEffect],
    ["Активация", product?.activation],
    ["Длительность", product?.duration],
    ["Требования", product?.requirements],
    ["Зона", product?.radiusOrEmanation],
    ["Цена", isPresent(product?.priceFormula) ? `${cleanString(product.priceFormula)} ЗМ` : null],
    ["Уровень реагентов", product?.reagentLevel],
    ...ASPECT_LABELS.map(([key, label]) => [label, product?.aspects?.[key]]),
    ["Обязательный компонент", product?.mandatoryComponent],
    ["Сл создания", product?.craftingDc],
    ["Частный катализатор", product?.privateCatalyst],
    ["Упрощённое создание", product?.simplifiedCreation]
  ].filter(([, value]) => isPresent(value));

  return `
    <section class="rebreya-gear-item">
      ${descriptionText
        ? `<p>${escapeHtml(descriptionText)}</p>`
        : "<p>Описание предмета пока не заполнено.</p>"}
      ${metadataRows.length ? `
        <ul>
          ${metadataRows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join("")}
        </ul>
      ` : ""}
    </section>
  `.trim();
}

function normalizedAspects(product) {
  return Object.fromEntries(ASPECT_LABELS.map(([key]) => [key, product?.aspects?.[key] ?? null]));
}

export function buildAlchemySignature(product) {
  return JSON.stringify({
    templateVersion: TEMPLATE_VERSION,
    id: cleanString(product?.id),
    sourceNumber: Number(product?.sourceNumber),
    name: cleanString(product?.name),
    productType: cleanString(product?.productType),
    consumableSubtype: resolveAlchemyConsumableSubtype(product?.productType),
    priceFormula: cleanString(product?.priceFormula),
    priceMaximumGp: Number(product?.priceMaximumGp),
    rank: requireRank(product?.rank),
    reagentLevel: product?.reagentLevel ?? null,
    effect: product?.effect ?? null,
    catalystEffect: product?.catalystEffect ?? null,
    activation: product?.activation ?? null,
    duration: product?.duration ?? null,
    requirements: product?.requirements ?? null,
    radiusOrEmanation: product?.radiusOrEmanation ?? null,
    aspects: normalizedAspects(product),
    mandatoryComponent: product?.mandatoryComponent ?? null,
    craftingDc: product?.craftingDc ?? null,
    privateCatalyst: product?.privateCatalyst ?? null,
    simplifiedCreation: product?.simplifiedCreation ?? null,
    rarity: cleanString(product?.rarity),
    weight: Number(product?.weight),
    icon: cleanString(product?.icon),
    topDownImage: cleanString(product?.topDownImage),
    sourceRef: cleanString(product?.sourceRef),
    folderPath: buildAlchemyFolderPath(product)
  });
}

function requireText(value, field) {
  const text = cleanString(value);
  if (!text) throw new Error(`Алхимический продукт не содержит обязательное поле ${field}`);
  return text;
}

function moduleAssetPath(path) {
  const normalized = cleanString(path).replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if (!normalized) throw new Error("Алхимический продукт не содержит путь к изображению");
  return normalized.startsWith(MODULE_ASSET_PREFIX) ? normalized : `${MODULE_ASSET_PREFIX}${normalized}`;
}

export function createAlchemyItemData(product, folderIdByPath = new Map()) {
  const id = requireText(product?.id, "id");
  const name = requireText(product?.name, "name");
  const productType = requireText(product?.productType, "productType");
  const sourceRef = requireText(product?.sourceRef, "sourceRef");
  const priceFormula = requireText(product?.priceFormula, "priceFormula");
  const rarity = requireText(product?.rarity, "rarity");
  const rank = requireRank(product?.rank);
  const priceMaximumGp = Number(product?.priceMaximumGp);
  if (!Number.isFinite(priceMaximumGp) || priceMaximumGp < 0) {
    throw new Error(`Некорректная максимальная цена алхимического продукта ${id}`);
  }
  const weight = Number(product?.weight);
  if (!Number.isFinite(weight) || weight !== rank) {
    throw new Error(`Вес алхимического продукта ${id} должен совпадать с рангом`);
  }

  const folderPath = buildAlchemyFolderPath(product).join("/");
  const icon = moduleAssetPath(product?.icon);
  const topDownImage = moduleAssetPath(product?.topDownImage);
  const signature = buildAlchemySignature(product);
  const activities = buildAlchemyActivities(product);
  const uses = buildAlchemyConsumableUses(product);

  return {
    _id: createStableGearDocumentId(`alchemy-product:${id}`),
    name,
    type: "consumable",
    img: icon,
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2
    },
    system: {
      description: {
        value: buildAlchemyDescriptionHtml(product),
        chat: ""
      },
      unidentified: {
        description: ""
      },
      quantity: 1,
      price: {
        value: priceMaximumGp,
        denomination: "gp"
      },
      weight: {
        value: rank,
        units: "lb"
      },
      rarity,
      type: {
        value: resolveAlchemyConsumableSubtype(productType),
        subtype: ""
      },
      ...(uses ? { uses } : {}),
      activities
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "alchemyProduct",
        alchemyProductId: id,
        sourceNumber: Number(product?.sourceNumber),
        sourceRef,
        productType,
        rank,
        reagentLevel: product?.reagentLevel ?? null,
        priceFormula,
        priceMaximumGp,
        rarity,
        weight,
        topDownImage,
        signature
      }
    }
  };
}

function desiredPackMetadata() {
  return {
    label: ALCHEMY_COMPENDIUM_LABEL,
    type: "Item",
    name: ALCHEMY_COMPENDIUM_NAME,
    system: globalThis.game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "Rebreya",
        types: ["consumable"]
      }
    }
  };
}

async function ensureAlchemyPack() {
  const desired = desiredPackMetadata();
  const pack = globalThis.game.packs.get(PACK_ID);
  if (pack && (pack.documentName !== desired.type || pack.metadata?.system !== desired.system)) {
    throw new Error(
      `Alchemy sync found an incompatible existing compendium '${PACK_ID}' `
      + `(${cleanString(pack.documentName) || "unknown"}/${cleanString(pack.metadata?.system) || "unknown"}); `
      + `expected ${desired.type}/${desired.system}. The existing compendium was preserved.`
    );
  }
  const compatiblePack = pack
    ?? await globalThis.foundry.documents.collections.CompendiumCollection.createCompendium(desired);

  const currentDnd5eFlags = compatiblePack.metadata?.flags?.dnd5e ?? {};
  if (
    typeof compatiblePack.configure === "function"
    && (
      cleanString(currentDnd5eFlags.sourceBook) !== desired.flags.dnd5e.sourceBook
      || JSON.stringify(currentDnd5eFlags.types ?? []) !== JSON.stringify(desired.flags.dnd5e.types)
    )
  ) {
    await compatiblePack.configure({
      flags: {
        ...(compatiblePack.metadata?.flags ?? {}),
        dnd5e: {
          ...currentDnd5eFlags,
          ...desired.flags.dnd5e
        }
      }
    });
  }

  await ensurePackSidebarFolder(compatiblePack, COMPENDIUM_SIDEBAR_FOLDER);
  return compatiblePack;
}

function normalizedAssetPath(path) {
  const normalized = cleanString(path).replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  try {
    return decodeURIComponent(normalized);
  }
  catch (_error) {
    return normalized;
  }
}

async function browseAssetDirectory(path) {
  const browse = globalThis.FilePicker?.browse;
  if (typeof browse !== "function") {
    throw new TypeError("Foundry FilePicker.browse is required to validate alchemy assets");
  }

  let lastError = null;
  for (const source of ["data", "public"]) {
    try {
      return await browse.call(globalThis.FilePicker, source, path);
    }
    catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Не удалось проверить каталог изображений: ${path}`);
}

async function validateAlchemyAssetPaths(paths) {
  const uniquePaths = Array.from(new Set(paths.map(normalizedAssetPath).filter(Boolean)));
  const pathsByDirectory = new Map();
  for (const path of uniquePaths) {
    const separator = path.lastIndexOf("/");
    const directory = separator >= 0 ? path.slice(0, separator) : "";
    const entries = pathsByDirectory.get(directory) ?? [];
    entries.push(path);
    pathsByDirectory.set(directory, entries);
  }

  const missing = [];
  for (const [directory, expectedPaths] of pathsByDirectory) {
    const result = await browseAssetDirectory(directory);
    const actualPaths = new Set((Array.isArray(result?.files) ? result.files : []).map(normalizedAssetPath));
    for (const expectedPath of expectedPaths) {
      if (!actualPaths.has(expectedPath)) missing.push(expectedPath);
    }
  }
  if (missing.length) {
    throw new Error(`Отсутствуют изображения алхимических продуктов: ${missing.join(", ")}`);
  }
}

function documentHasExpectedAutomation(document, product) {
  const activities = document?.system?.activities;
  const activityIds = activities instanceof Map
    ? Array.from(activities.keys(), cleanString).filter(Boolean)
    : Object.keys(activities ?? {});
  const expectedIds = Object.keys(buildAlchemyActivities(product));
  const effects = document?.effects;
  const effectCount = Array.isArray(effects) ? effects.length : Number(effects?.size ?? 0);
  return activityIds.length === expectedIds.length
    && activityIds.every((id) => expectedIds.includes(id))
    && effectCount === 0;
}

function embeddedDocumentIds(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) {
    return collection.map((entry) => cleanString(entry?._id ?? entry?.id)).filter(Boolean);
  }
  if (typeof collection.keys === "function") {
    return Array.from(collection.keys(), cleanString).filter(Boolean);
  }
  const contents = collection.contents;
  if (Array.isArray(contents)) {
    return contents.map((entry) => cleanString(entry?._id ?? entry?.id)).filter(Boolean);
  }
  if (typeof collection === "object") {
    return Object.entries(collection)
      .map(([key, entry]) => cleanString(entry?._id ?? entry?.id ?? key))
      .filter(Boolean);
  }
  return [];
}

function requireCompleteApprovedCatalog(products) {
  if (!Array.isArray(products) || products.length !== APPROVED_PRODUCT_COUNT) {
    throw new TypeError(`Alchemy sync requires the complete approved catalog of ${APPROVED_PRODUCT_COUNT} products.`);
  }
  const ids = products.map((product) => cleanString(product?.id));
  const sourceNumbers = products.map((product) => product?.sourceNumber);
  const hasExpectedSourceNumbers = sourceNumbers.every(
    (sourceNumber, index) => sourceNumber === APPROVED_SOURCE_NUMBERS[index]
  );
  if (ids.some((id) => !id) || new Set(ids).size !== APPROVED_PRODUCT_COUNT || !hasExpectedSourceNumbers) {
    throw new TypeError(`Alchemy sync requires the complete approved catalog of ${APPROVED_PRODUCT_COUNT} products.`);
  }
  return products;
}

async function applyTextOnlyAlchemyUpdate(document, data) {
  const effectIds = embeddedDocumentIds(document?.effects);
  if (effectIds.length > 0) {
    if (typeof document?.deleteEmbeddedDocuments !== "function") {
      throw new TypeError(`Managed alchemy document ${cleanString(document?.id ?? document?._id)} cannot remove Active Effects`);
    }
    await document.deleteEmbeddedDocuments("ActiveEffect", effectIds);
  }
  for (const activityId of embeddedDocumentIds(document?.system?.activities)) {
    data[`system.activities.-=${activityId}`] = null;
  }
  await document.update(data);
}

export class AlchemyCompendiumService {
  constructor({ validateAssetPaths = validateAlchemyAssetPaths } = {}) {
    if (typeof validateAssetPaths !== "function") {
      throw new TypeError("validateAssetPaths must be a function");
    }
    this.validateAssetPaths = validateAssetPaths;
  }

  async sync(products = []) {
    if (!globalThis.game?.user?.isGM || globalThis.game?.system?.id !== DND5E_SYSTEM_ID) {
      return null;
    }

    const safeProducts = requireCompleteApprovedCatalog(products);
    const prebuiltData = safeProducts.map((product) => createAlchemyItemData(product, new Map()));
    await this.validateAssetPaths(prebuiltData.flatMap((data) => [
      data.img,
      data.flags[MODULE_ID].topDownImage
    ]));

    const pack = await ensureAlchemyPack();
    const documents = await pack.getDocuments();
    let folderIdByPath = new Map();

    await syncManagedDocuments({
      pack,
      entries: safeProducts,
      documents: Array.isArray(documents) ? documents : [],
      sourceIdOfEntry: (product) => product?.id,
      sourceIdOfDocument: (document) => (
        document.getFlag?.(MODULE_ID, "managed")
        && document.getFlag?.(MODULE_ID, "sourceType") === "alchemyProduct"
          ? document.getFlag(MODULE_ID, "alchemyProductId")
          : ""
      ),
      signatureOfEntry: (product) => buildAlchemySignature(product),
      signatureOfDocument: (document) => document.getFlag?.(MODULE_ID, "signature"),
      documentIdOfEntry: (product) => createStableGearDocumentId(`alchemy-product:${product?.id}`),
      documentMatchesEntry: (document, product) => documentHasExpectedAutomation(document, product),
      prepareFolders: async (entries) => {
        folderIdByPath = await ensureCompendiumFolders(pack, entries.map(buildAlchemyFolderPath));
      },
      createData: (product) => createAlchemyItemData(product, folderIdByPath),
      updateData: (_document, product) => {
        const data = createAlchemyItemData(product, folderIdByPath);
        delete data._id;
        return data;
      },
      applyUpdate: applyTextOnlyAlchemyUpdate
    });

    return globalThis.game.packs.get(PACK_ID) ?? pack;
  }
}
