import {
  parseAttachmentWeightModifier,
  parseCurrency,
  parseInteger,
  parseOptionalText,
  parseRequiredText,
  parseWeight
} from "../parsers.mjs";
import {
  DEFAULT_ENRICHMENT_FIELDS,
  applyManualEnrichment,
  buildCanonicalEquipmentSourceKey,
  resolveStableIdentity
} from "../overrides.mjs";
import {
  ImportDiagnosticError,
  createImportDiagnostic,
  throwIfDiagnostics
} from "../validation.mjs";

function contextFor(snapshot, row, column) {
  return {
    sheetKey: snapshot.sheetKey,
    range: snapshot.range,
    rowNumber: row.rowNumber,
    column
  };
}

function fail(code, message, details = {}) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, message, ...details })]);
}

function sourceReference(value, sourceKey, rowNumber) {
  const match = String(value ?? "").trim().match(/^(.+)!([A-Z]+)(\d+)$/u);
  if (!match) fail("invalid-source-reference", `Invalid source reference for ${sourceKey}`, { rowNumber, value });
  return { sourceRef: value.trim(), sheetTitle: match[1], rowNumber: Number(match[3]) };
}

export function buildEquipmentReferenceIndex({ snapshots, overrides }) {
  const snapshot = snapshots?.equipmentReferences;
  if (!snapshot || snapshot.layout !== "raw" || !Array.isArray(snapshot.values)) {
    fail("missing-reference-snapshot", "Missing raw equipment reference snapshot");
  }
  const [header = [], ...rows] = snapshot.values;
  const expectedColumns = [[0, "Ключ"], [1, "Тип"], [2, "Каноническое название"], [8, "Статус"], [9, "ID источника"], [20, "Ключ ручной позиции"], [22, "Тип"], [23, "Название"], [28, "Строка каталога"]];
  for (const [index, required] of expectedColumns) {
    if (String(header[index] ?? "").trim() !== required) fail("missing-reference-header", `Missing equipment reference header at column ${index + 1}: ${required}`);
  }
  const gearByKey = new Map();
  const gearBySourceRef = new Map();
  function addReference(sourceKey, reference) {
    if (gearByKey.has(sourceKey)) fail("duplicate-reference-key", `Duplicate equipment reference key: ${sourceKey}`);
    if (gearBySourceRef.has(reference.sourceRef)) {
      fail("duplicate-source-reference", `Duplicate equipment source reference: ${reference.sourceRef}`);
    }
    gearByKey.set(sourceKey, reference);
    gearBySourceRef.set(reference.sourceRef, reference);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sourceKey = String(row[0] ?? "").trim();
    if (sourceKey) {
      const reference = sourceReference(row[9], sourceKey, index + 2);
      addReference(sourceKey, {
        sourceKey,
        canonicalName: String(row[2] ?? "").trim(),
        equipmentType: String(row[1] ?? "").trim(),
        ...reference
      });
    }
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const manualKey = String(row[20] ?? "").trim();
    if (manualKey) {
      const manualType = String(row[22] ?? "").trim();
      const manualName = String(row[23] ?? "").trim();
      const canonical = gearByKey.get(manualKey);
      if (canonical && canonical.equipmentType === manualType && canonical.canonicalName === manualName) {
        continue;
      }
      const catalogRow = Number(row[28]);
      if (!Number.isInteger(catalogRow) || catalogRow < 1) {
        fail("invalid-source-reference", `Invalid manual catalog row for ${manualKey}`, { rowNumber: index + 2 });
      }
      addReference(manualKey, {
        sourceKey: manualKey,
        canonicalName: manualName,
        equipmentType: manualType,
        sourceRef: `Общий компендиум снаряжения V0.1!A${catalogRow}`,
        sheetTitle: "Общий компендиум снаряжения V0.1",
        rowNumber: catalogRow
      });
    }
  }
  for (const [canonicalKey, entry] of Object.entries(overrides?.identities?.gear ?? {})) {
    const reference = gearByKey.get(canonicalKey);
    if (!reference) continue;
    for (const alias of entry.aliases ?? []) {
      if (gearByKey.has(alias) && gearByKey.get(alias) !== reference) {
        fail("duplicate-reference-key", `Duplicate equipment reference key: ${alias}`);
      }
      gearByKey.set(alias, reference);
    }
  }
  return Object.freeze({
    gearByKey,
    gearBySourceRef,
    resolveStableGearId(reference) {
      return resolveStableIdentity({
        catalog: "gear",
        sourceKey: reference.sourceKey,
        sourceName: reference.canonicalName,
        overrides
      });
    }
  });
}

function optionalRank(raw, context) {
  const text = String(raw ?? "").trim();
  return !text || /^(?:-|–|—)$/u.test(text) ? null : parseInteger(text, context, { min: 0, max: 20, label: "rank" });
}

function optionalSourceText(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

function normalizeMaterialName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

function buildMaterialIdByName(materials) {
  const result = new Map();
  for (const material of materials ?? []) {
    const name = normalizeMaterialName(material?.name);
    const id = String(material?.id ?? "").trim();
    if (!name || !id) continue;
    if (result.has(name) && result.get(name) !== id) {
      fail("duplicate-material-name", `Material name resolves to multiple stable IDs: ${material.name}`);
    }
    result.set(name, id);
  }
  return result;
}

export function adaptBaseGear({ snapshot, referenceIndex, overrides, materials = [], diagnostics = [] }) {
  const materialIdByName = buildMaterialIdByName(materials);
  const items = [];
  const transportRows = [];
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    const name = parseRequiredText(cells["Название"], contextFor(snapshot, row, "Название"));
    const equipmentType = parseRequiredText(cells["Тип снаряжения"], contextFor(snapshot, row, "Тип снаряжения"));
    const normalizedEquipmentType = equipmentType.toLocaleLowerCase("ru-RU");
    if (["транспорт", "скакуны и транспорт"].includes(normalizedEquipmentType)) {
      transportRows.push(row);
      continue;
    }
    const sourceKey = buildCanonicalEquipmentSourceKey({ equipmentType, name });
    const reviewedIdentity = overrides?.identities?.gear?.[sourceKey];
    const reference = referenceIndex.gearByKey.get(sourceKey) ?? (reviewedIdentity ? {
      sourceKey,
      canonicalName: name,
      equipmentType,
      sourceRef: `${snapshot.sheetTitle}!A${row.rowNumber}`,
      sheetTitle: snapshot.sheetTitle,
      rowNumber: row.rowNumber
    } : null);
    if (!reference) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-equipment-reference",
        sheetKey: snapshot.sheetKey,
        range: snapshot.range,
        rowNumber: row.rowNumber,
        column: "Название",
        value: name,
        message: `Missing exact equipment reference for ${sourceKey}`
      }));
      continue;
    }
    const priceRaw = cells["Цена"] ?? "";
    const price = parseCurrency(priceRaw, contextFor(snapshot, row, "Цена"));
    const materialName = optionalSourceText(cells["Преобладающий материал (источник)"]);
    const materialId = materialIdByName.get(normalizeMaterialName(materialName)) ?? null;
    const stableId = resolveStableIdentity({ catalog: "gear", sourceKey, sourceName: name, overrides });
    const generated = {
      id: stableId,
      name,
      equipmentType,
      shopSubtype: optionalSourceText(cells["Подтип (магазин)"]),
      priceText: priceRaw,
      priceValue: price?.kind === "fixed" ? price.value : null,
      priceDenomination: price?.kind === "fixed" ? price.denomination : "gp",
      priceGoldEquivalent: price?.kind === "fixed" ? price.goldEquivalent : null,
      rank: optionalRank(cells["Ранг"], contextFor(snapshot, row, "Ранг")),
      weight: normalizedEquipmentType === "обвес"
        ? parseAttachmentWeightModifier(cells["Вес"] || "—", contextFor(snapshot, row, "Вес"))
        : parseWeight(cells["Вес"] || "—", contextFor(snapshot, row, "Вес")),
      volume: optionalSourceText(cells["Объем"]),
      capacity: optionalSourceText(cells["Вместимость"]),
      description: parseOptionalText(cells["Описание"] ?? "", contextFor(snapshot, row, "Описание")) ?? "",
      predominantMaterialId: materialId,
      predominantMaterialName: materialName,
      linkedTool: optionalSourceText(cells["Связанный инструмент"]),
      value: optionalSourceText(cells.Value),
      multipleAppearance: optionalSourceText(cells["Множественное появление"]),
      source: "equipment-google-sheet",
      sourceIdentity: sourceKey,
      sourceRef: reference.sourceRef,
      itemSlot: "",
      heroDollSlots: ""
    };
    items.push(applyManualEnrichment({
      catalog: "gear",
      stableId,
      generated,
      overrides,
      allowedFields: DEFAULT_ENRICHMENT_FIELDS.gear
    }));
  }
  throwIfDiagnostics(diagnostics, "Base equipment adaptation failed");
  return { items, transportRows };
}

export function mergeGearFragments({ baseItems, fragmentsByAdapter, diagnostics = [] }) {
  const byId = new Map(baseItems.map((item) => [item.id, { ...item }]));
  const owners = new Map();
  for (const [adapter, fragments] of Object.entries(fragmentsByAdapter ?? {})) {
    for (const [stableId, fragment] of fragments) {
      const item = byId.get(stableId);
      if (!item) {
        diagnostics.push(createImportDiagnostic({
          code: "orphan-gear-fragment",
          sheetKey: adapter,
          value: stableId,
          message: `Gear fragment ${adapter}:${stableId} has no base item`
        }));
        continue;
      }
      for (const [field, value] of Object.entries(fragment)) {
        const ownerKey = `${stableId}:${field}`;
        if (owners.has(ownerKey) || Object.hasOwn(item, field)) {
          diagnostics.push(createImportDiagnostic({
            code: "gear-field-ownership-conflict",
            sheetKey: adapter,
            column: field,
            value: stableId,
            message: `Gear field ownership conflict for ${stableId}.${field}`
          }));
          continue;
        }
        owners.set(ownerKey, adapter);
        item[field] = structuredClone(value);
      }
    }
  }
  throwIfDiagnostics(diagnostics, "Gear fragment merge failed");
  return baseItems.map((item) => byId.get(item.id));
}
