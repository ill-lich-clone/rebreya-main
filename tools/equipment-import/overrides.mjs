import {
  ImportDiagnosticError,
  createImportDiagnostic
} from "./validation.mjs";

export const EQUIPMENT_OVERRIDE_SCHEMA_VERSION = 1;

export const DEFAULT_ENRICHMENT_FIELDS = Object.freeze({
  gear: Object.freeze([
    "foundryType",
    "foundrySubtype",
    "foundrySubtypeExtra",
    "foundryBaseItem",
    "foundryFolder",
    "itemSlot",
    "heroDollSlots",
    "containerCapacity",
    "containerContents"
  ]),
  implants: Object.freeze([
    "foundryType",
    "foundrySubtype",
    "foundrySubtypeExtra",
    "foundryBaseItem",
    "foundryFolder",
    "itemSlot",
    "heroDollSlots"
  ]),
  materials: Object.freeze(["linkedGoodId", "linkedGoodName"]),
  transport: Object.freeze(["documentId"]),
  magicItems: Object.freeze([])
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizedSlug(value, fallback = "entry") {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/["'`«»]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    || fallback;
}

function normalizeSourceComponent(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");
}

export function buildCanonicalEquipmentSourceKey({ equipmentType, name }) {
  const normalizedType = normalizeSourceComponent(equipmentType);
  const normalizedName = normalizeSourceComponent(name);
  return normalizedType && normalizedName ? `${normalizedType}|${normalizedName}` : "";
}

export function buildMagicItemSourceKey({ sourceNumber, index = 0 }) {
  const normalizedNumber = normalizeSourceComponent(sourceNumber || index + 1);
  return normalizedNumber ? `магический-предмет|${normalizedNumber}` : "";
}

function fail(code, message, { catalog = null, sourceKey = null, stableId = null } = {}) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({
    code,
    sheetKey: catalog,
    column: sourceKey,
    value: stableId,
    message
  })]);
}

function normalizeIdentityEntry(rawEntry, catalog, sourceKey) {
  const entry = typeof rawEntry === "string" ? { id: rawEntry, aliases: [] } : rawEntry;
  if (!isPlainObject(entry)) {
    fail("invalid-identity", `Identity ${catalog}:${sourceKey} must be a string or object`, { catalog, sourceKey });
  }
  const id = String(entry.id ?? "").trim();
  if (!id) fail("missing-stable-id", `Identity ${catalog}:${sourceKey} is missing stable id`, { catalog, sourceKey });
  const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((alias) => String(alias).trim()) : [];
  if (aliases.some((alias) => !alias)) {
    fail("invalid-alias", `Identity ${catalog}:${sourceKey} contains a blank alias`, { catalog, sourceKey, stableId: id });
  }
  if (new Set(aliases).size !== aliases.length) {
    fail("duplicate-alias", `Identity ${catalog}:${sourceKey} contains a duplicate alias`, { catalog, sourceKey, stableId: id });
  }
  return { id, aliases };
}

function allowedFieldsFor(catalog, allowedEnrichmentFields) {
  const source = allowedEnrichmentFields?.[catalog] ?? DEFAULT_ENRICHMENT_FIELDS[catalog] ?? [];
  return new Set(source);
}

export function validateEquipmentOverrides(rawOverrides, {
  allowedEnrichmentFields = DEFAULT_ENRICHMENT_FIELDS,
  knownSourceKeys = null
} = {}) {
  if (!isPlainObject(rawOverrides)) fail("invalid-overrides", "Equipment overrides must be an object");
  if (rawOverrides.schemaVersion !== EQUIPMENT_OVERRIDE_SCHEMA_VERSION) {
    fail("invalid-schema-version", `Equipment override schemaVersion must be ${EQUIPMENT_OVERRIDE_SCHEMA_VERSION}`);
  }
  const rawIdentities = rawOverrides.identities ?? {};
  const rawEnrichment = rawOverrides.enrichment ?? {};
  if (!isPlainObject(rawIdentities) || !isPlainObject(rawEnrichment)) {
    fail("invalid-overrides", "Equipment override identities and enrichment must be objects");
  }

  const identities = {};
  const enrichment = {};
  const catalogs = new Set([...Object.keys(rawIdentities), ...Object.keys(rawEnrichment)]);
  for (const catalog of [...catalogs].sort()) {
    const catalogIdentities = rawIdentities[catalog] ?? {};
    const catalogEnrichment = rawEnrichment[catalog] ?? {};
    if (!isPlainObject(catalogIdentities) || !isPlainObject(catalogEnrichment)) {
      fail("invalid-catalog-overrides", `Overrides for ${catalog} must be objects`, { catalog });
    }
    identities[catalog] = {};
    enrichment[catalog] = {};
    const stableOwners = new Map();
    const sourceOwners = new Map();
    const known = knownSourceKeys?.[catalog];

    for (const sourceKey of Object.keys(catalogIdentities).sort()) {
      if (known && !known.has(sourceKey)) {
        fail("orphaned-override", `Orphaned override source identity ${catalog}:${sourceKey}`, { catalog, sourceKey });
      }
      const entry = normalizeIdentityEntry(catalogIdentities[sourceKey], catalog, sourceKey);
      if (stableOwners.has(entry.id)) {
        fail(
          "duplicate-stable-id",
          `Duplicate stable id ${entry.id} for ${stableOwners.get(entry.id)} and ${sourceKey}`,
          { catalog, sourceKey, stableId: entry.id }
        );
      }
      stableOwners.set(entry.id, sourceKey);
      for (const candidate of [sourceKey, ...entry.aliases]) {
        if (sourceOwners.has(candidate)) {
          fail(
            "ambiguous-source-alias",
            `Source identity or alias ${candidate} belongs to multiple overrides`,
            { catalog, sourceKey: candidate, stableId: entry.id }
          );
        }
        sourceOwners.set(candidate, sourceKey);
      }
      identities[catalog][sourceKey] = entry;
    }

    const allowed = allowedFieldsFor(catalog, allowedEnrichmentFields);
    for (const stableId of Object.keys(catalogEnrichment).sort()) {
      if (!stableOwners.has(stableId)) {
        fail("orphaned-enrichment", `Orphaned enrichment stable id ${catalog}:${stableId}`, { catalog, stableId });
      }
      const fields = catalogEnrichment[stableId];
      if (!isPlainObject(fields)) {
        fail("invalid-enrichment", `Enrichment ${catalog}:${stableId} must be an object`, { catalog, stableId });
      }
      const normalizedFields = {};
      for (const field of Object.keys(fields).sort()) {
        if (!allowed.has(field)) {
          fail(
            "sheet-owned-enrichment",
            `Enrichment field ${catalog}.${field} is sheet-owned or not allowed`,
            { catalog, stableId }
          );
        }
        normalizedFields[field] = structuredClone(fields[field]);
      }
      enrichment[catalog][stableId] = normalizedFields;
    }
  }

  return deepFreeze({
    schemaVersion: EQUIPMENT_OVERRIDE_SCHEMA_VERSION,
    identities,
    enrichment
  });
}

export function resolveStableIdentity({ catalog, sourceKey, sourceName, overrides }) {
  const identities = overrides?.identities?.[catalog] ?? {};
  if (identities[sourceKey]) return identities[sourceKey].id;
  for (const entry of Object.values(identities)) {
    if (entry.aliases.includes(sourceKey)) return entry.id;
  }
  const generated = normalizedSlug(sourceName || sourceKey, `${catalog}-entry`);
  const owner = Object.entries(identities).find(([, entry]) => entry.id === generated);
  if (owner) {
    fail(
      "generated-id-collision",
      `Generated stable id ${generated} collides with override ${catalog}:${owner[0]}`,
      { catalog, sourceKey, stableId: generated }
    );
  }
  return generated;
}

export function applyManualEnrichment({ catalog, stableId, generated, overrides, allowedFields }) {
  const fields = overrides?.enrichment?.[catalog]?.[stableId];
  if (!fields) return { ...generated };
  const allowed = new Set(allowedFields ?? DEFAULT_ENRICHMENT_FIELDS[catalog] ?? []);
  for (const field of Object.keys(fields)) {
    if (!allowed.has(field)) {
      fail("sheet-owned-enrichment", `Enrichment field ${catalog}.${field} is sheet-owned or not allowed`, { catalog, stableId });
    }
  }
  return { ...generated, ...structuredClone(fields) };
}

function addMigratedRecord({ catalog, sourceKey, stableId, record, result, seenSources, seenIds, fields }) {
  if (!sourceKey) fail("missing-source-identity", `Migration record in ${catalog} is missing source identity`, { catalog });
  if (!stableId) fail("missing-stable-id", `Migration record ${catalog}:${sourceKey} is missing stable id`, { catalog, sourceKey });
  if (seenSources.has(sourceKey)) fail("duplicate-source-identity", `Duplicate source identity ${catalog}:${sourceKey}`, { catalog, sourceKey });
  if (seenIds.has(stableId)) fail("duplicate-stable-id", `Duplicate stable id ${catalog}:${stableId}`, { catalog, sourceKey, stableId });
  seenSources.add(sourceKey);
  seenIds.add(stableId);
  result.identities[catalog][sourceKey] = { id: stableId, aliases: [] };

  const enrichment = {};
  for (const field of fields) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== "") {
      enrichment[field] = structuredClone(record[field]);
    }
  }
  if (Object.keys(enrichment).length) result.enrichment[catalog][stableId] = enrichment;
}

export function buildInitialEquipmentOverrides({
  gear = [],
  implants = [],
  materials = [],
  transport = [],
  magicItems = []
} = {}) {
  const result = {
    schemaVersion: EQUIPMENT_OVERRIDE_SCHEMA_VERSION,
    identities: { gear: {}, implants: {}, materials: {}, transport: {}, magicItems: {} },
    enrichment: { gear: {}, implants: {}, materials: {}, transport: {}, magicItems: {} }
  };
  const definitions = [
    {
      catalog: "gear",
      records: gear,
      sourceKey: (record) => buildCanonicalEquipmentSourceKey(record),
      id: (record) => record.id,
      fields: DEFAULT_ENRICHMENT_FIELDS.gear
    },
    {
      catalog: "implants",
      records: implants,
      sourceKey: (record) => String(record?.name ?? "").trim(),
      id: (record) => record.id,
      fields: DEFAULT_ENRICHMENT_FIELDS.implants
    },
    {
      catalog: "materials",
      records: materials,
      sourceKey: (record) => String(record?.name ?? "").trim(),
      id: (record) => record.id,
      fields: DEFAULT_ENRICHMENT_FIELDS.materials
    },
    {
      catalog: "transport",
      records: transport,
      sourceKey: (record) => String(record?.name ?? "").trim(),
      id: (record) => record.sourceId,
      fields: DEFAULT_ENRICHMENT_FIELDS.transport
    },
    {
      catalog: "magicItems",
      records: magicItems,
      sourceKey: (record, index) => buildMagicItemSourceKey({
        sourceNumber: record?.sourceNumber ?? record?.["№"],
        index
      }),
      id: (record, index, seenIds) => {
        if (record.id) return record.id;
        const baseId = normalizedSlug(record.name, "magic-item");
        let candidate = baseId;
        let duplicateIndex = 2;
        while (seenIds.has(candidate)) {
          candidate = `${baseId}-${duplicateIndex}`;
          duplicateIndex += 1;
        }
        return candidate;
      },
      fields: []
    }
  ];

  for (const definition of definitions) {
    const seenSources = new Set();
    const seenIds = new Set();
    for (let index = 0; index < definition.records.length; index += 1) {
      const record = definition.records[index];
      const sourceKey = definition.sourceKey(record, index);
      const stableId = String(definition.id(record, index, seenIds) ?? "").trim();
      addMigratedRecord({
        catalog: definition.catalog,
        sourceKey,
        stableId,
        record,
        result,
        seenSources,
        seenIds,
        fields: definition.fields
      });
    }
  }

  return validateEquipmentOverrides(result, { allowedEnrichmentFields: DEFAULT_ENRICHMENT_FIELDS });
}
