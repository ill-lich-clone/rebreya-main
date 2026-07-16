import { REBREYA_TOOLS } from "../constants.js";

export const MATERIAL_SOURCE_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
export const MATERIAL_SOURCE_SHEET_NAME = "Энциклопедия материалов";

const SOURCE_COLUMNS = [..."ABCDEFGHIJKLM"];
const BASE_RAW_NAME_PREFIX = "Базовое сырье для Инструменты ";
const BASE_RAW_APPLICATION_PREFIX = "Создание и ремонт инструментов:";

function cleanIdentifier(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function literalText(value) {
  return String(value ?? "");
}

function normalizeMatchText(value) {
  return cleanIdentifier(value).toLocaleLowerCase("ru");
}

function parseNullableNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+(?:зм|фнт)$/iu, "")
    .replace(/\s+/gu, "")
    .replace(",", ".");

  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSourceCells(row) {
  if (Array.isArray(row?.cells)) {
    return SOURCE_COLUMNS.map((_, index) => literalText(row.cells[index]));
  }

  if (Array.isArray(row)) {
    return SOURCE_COLUMNS.map((_, index) => literalText(row[index]));
  }

  return SOURCE_COLUMNS.map((column) => literalText(row?.[column]));
}

function getSourceRowNumber(row, index) {
  const value = Number(row?.row ?? row?.__row);
  return Number.isInteger(value) ? value : index + 1;
}

function ensureUniqueId(preferredId, usedIds) {
  const baseId = cleanIdentifier(preferredId) || "material";
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

export function normalizeMaterialSheetRows(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row, index) => {
    const cells = getSourceCells(row);
    const sourceRow = getSourceRowNumber(row, index);
    const name = cleanIdentifier(cells[0]);
    if (!name) {
      return [];
    }

    return [{
      id: `material-${sourceRow}`,
      name,
      type: cleanIdentifier(cells[1]),
      subtype: cleanIdentifier(cells[2]),
      priceGold: parseNullableNumber(cells[3]),
      weight: parseNullableNumber(cells[4]),
      rank: parseNullableNumber(cells[5]),
      description: literalText(cells[6]),
      linkedGoodId: null,
      linkedGoodName: null,
      applications: {
        upgrade: literalText(cells[7]),
        implant: literalText(cells[8]),
        crafting: literalText(cells[9]),
        alchemy: literalText(cells[10]),
        knowledge: literalText(cells[11])
      },
      alchemyAspects: literalText(cells[12]),
      source: {
        spreadsheetId: MATERIAL_SOURCE_SPREADSHEET_ID,
        sheetName: MATERIAL_SOURCE_SHEET_NAME,
        row: sourceRow
      },
      isSynthetic: false
    }];
  });
}

export function mergeMaterialCatalog(existing, incoming) {
  const existingMaterials = Array.isArray(existing) ? existing : [];
  const incomingMaterials = Array.isArray(incoming) ? incoming : [];
  const existingByName = new Map();

  for (const material of existingMaterials) {
    const key = normalizeMatchText(material?.name);
    if (key && !existingByName.has(key)) {
      existingByName.set(key, material);
    }
  }

  const reservedHistoricalIds = new Set(incomingMaterials.flatMap((material) => {
    const previousId = cleanIdentifier(existingByName.get(normalizeMatchText(material?.name))?.id);
    return previousId ? [previousId] : [];
  }));
  const usedIds = new Set(reservedHistoricalIds);
  const usedNames = new Set();
  const addedIds = [];
  const updatedIds = [];
  const materials = incomingMaterials.map((material, index) => {
    const nameKey = normalizeMatchText(material?.name);
    if (!nameKey) {
      throw new Error(`Incoming material at index ${index} has no name.`);
    }
    if (usedNames.has(nameKey)) {
      throw new Error(`Incoming material name is not unique: ${material.name}`);
    }
    usedNames.add(nameKey);

    const previous = existingByName.get(nameKey) ?? null;
    const previousId = cleanIdentifier(previous?.id);
    const id = previousId && reservedHistoricalIds.delete(previousId)
      ? previousId
      : ensureUniqueId(previousId || material?.id || `material-${index + 1}`, usedIds);
    const merged = {
      ...(previous ?? {}),
      ...material,
      id,
      linkedGoodId: material?.linkedGoodId ?? previous?.linkedGoodId ?? null,
      linkedGoodName: material?.linkedGoodName ?? previous?.linkedGoodName ?? null
    };

    if (previous) {
      updatedIds.push(id);
    }
    else {
      addedIds.push(id);
    }

    return merged;
  });

  return { materials, addedIds, updatedIds };
}

export function buildBaseRawMaterialIndex(materials) {
  const toolIdByLabel = new Map(REBREYA_TOOLS.map((tool) => [normalizeMatchText(tool.label), tool.id]));
  const index = new Map();

  for (const material of Array.isArray(materials) ? materials : []) {
    if (!cleanIdentifier(material?.name).startsWith(BASE_RAW_NAME_PREFIX)) {
      continue;
    }

    const application = cleanIdentifier(material?.applications?.crafting);
    if (!application.startsWith(BASE_RAW_APPLICATION_PREFIX)) {
      continue;
    }

    const label = application.slice(BASE_RAW_APPLICATION_PREFIX.length);
    const toolId = toolIdByLabel.get(normalizeMatchText(label));
    const materialId = cleanIdentifier(material?.id);
    if (!toolId || !materialId) {
      continue;
    }
    if (index.has(toolId)) {
      throw new Error(`Multiple base raw materials map to tool '${toolId}'.`);
    }

    index.set(toolId, materialId);
  }

  return index;
}
