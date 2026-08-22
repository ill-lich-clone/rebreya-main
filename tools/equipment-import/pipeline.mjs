import { adaptAmmunitionProfiles } from "./adapters/ammunition.mjs";
import { adaptArmorProfiles } from "./adapters/armor.mjs";
import { adaptAttachmentProfiles } from "./adapters/attachments.mjs";
import {
  adaptBaseGear,
  buildEquipmentReferenceIndex,
  mergeGearFragments
} from "./adapters/base-gear.mjs";
import { adaptExplosiveProfiles } from "./adapters/explosives.mjs";
import { adaptImplantsCatalog } from "./adapters/implants.mjs";
import { adaptMagicItemsCatalog } from "./adapters/magic-items.mjs";
import { adaptMaterialsCatalog } from "./adapters/materials.mjs";
import { adaptTransportCatalog } from "./adapters/transport.mjs";
import { adaptUpgradeCatalog } from "./adapters/upgrades.mjs";
import { adaptWeaponProfiles } from "./adapters/weapons.mjs";
import { validateEquipmentOverrides } from "./overrides.mjs";
import {
  ImportDiagnosticError,
  createImportDiagnostic,
  throwIfDiagnostics
} from "./validation.mjs";

export const GENERATED_CATALOG_PATHS = Object.freeze({
  gear: "data/gear.json",
  upgrades: "data/upgrades.json",
  materials: "data/materials.json",
  implants: "data/implants.json",
  transport: "data/rebreya-transport-v01.json",
  magicItems: "magicItem.js"
});

const REQUIRED_SHEETS = Object.freeze([
  "baseGear",
  "equipmentReferences",
  "weapons",
  "firearms",
  "attachments",
  "ammunition",
  "specialAmmunition",
  "armor",
  "explosives",
  "implants",
  "upgrades",
  "materials",
  "magicItems",
  "transport"
]);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, child] of value) {
      deepFreeze(key, seen);
      deepFreeze(child, seen);
    }
  } else {
    for (const child of Object.values(value)) deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function requireWorkbookSnapshot(workbookSnapshot) {
  const diagnostics = [];
  if (!workbookSnapshot || typeof workbookSnapshot !== "object") {
    diagnostics.push(createImportDiagnostic({
      code: "missing-workbook-snapshot",
      message: "Equipment workbook snapshot is required"
    }));
  }
  if (!String(workbookSnapshot?.spreadsheetId ?? "").trim()) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-spreadsheet-id",
      message: "Workbook snapshot is missing spreadsheetId"
    }));
  }
  if (!/^[a-f0-9]{64}$/iu.test(String(workbookSnapshot?.fingerprint ?? ""))) {
    diagnostics.push(createImportDiagnostic({
      code: "invalid-workbook-fingerprint",
      value: workbookSnapshot?.fingerprint,
      message: "Workbook snapshot fingerprint must be SHA-256"
    }));
  }
  for (const sheetKey of REQUIRED_SHEETS) {
    if (workbookSnapshot?.sheets?.[sheetKey]) continue;
    diagnostics.push(createImportDiagnostic({
      code: "missing-sheet-snapshot",
      sheetKey,
      message: `Workbook snapshot is missing required sheet ${sheetKey}`
    }));
  }
  throwIfDiagnostics(diagnostics, "Invalid equipment workbook snapshot");
}

function collectAdapterDiagnostics(target, operation, fallback, { failures = null, label = "" } = {}) {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof ImportDiagnosticError)) throw error;
    if (failures && label) failures.add(label);
    target.push(...error.diagnostics);
    if (error.suppressedCount > 0) {
      target.push(createImportDiagnostic({
        code: "suppressed-adapter-diagnostics",
        value: error.suppressedCount,
        message: `${error.suppressedCount} additional adapter diagnostics were suppressed`
      }));
    }
    return fallback;
  }
}

function catalogId(catalog, entry) {
  switch (catalog) {
    case "gear": return entry?.id;
    case "upgrades": return entry?.productId;
    case "materials": return entry?.id;
    case "implants": return entry?.id;
    case "transport": return entry?.sourceId;
    case "magicItems": return entry?.id;
    default: return null;
  }
}

function sourceIdentity(catalog, entry) {
  switch (catalog) {
    case "gear": return entry?.sourceRef;
    case "upgrades": return entry?.upgrade?.sourceSheet && entry?.upgrade?.sourceSheetRow
      ? `${entry.upgrade.sourceSheet}!${entry.upgrade.sourceSheetRow}`
      : "";
    case "materials": return entry?.source?.sheetName && entry?.source?.row
      ? `${entry.source.sheetName}!${entry.source.row}`
      : "";
    case "implants": return entry?.implant?.sourceSheet && entry?.implant?.sourceSheetRow
      ? `${entry.implant.sourceSheet}!${entry.implant.sourceSheetRow}`
      : "";
    case "transport": return entry?.sourceRow ? `transport!${entry.sourceRow}` : "";
    default: return "";
  }
}

function validateCatalogRecords(bundle, diagnostics) {
  for (const catalog of Object.keys(GENERATED_CATALOG_PATHS)) {
    const records = bundle?.catalogs?.[catalog];
    if (!Array.isArray(records)) {
      diagnostics.push(createImportDiagnostic({
        code: "invalid-catalog-contract",
        sheetKey: catalog,
        value: records,
        message: `Generated catalog ${catalog} must be an array`
      }));
      continue;
    }
    const ids = new Map();
    const sources = new Map();
    for (let index = 0; index < records.length; index += 1) {
      const entry = records[index];
      const id = String(catalogId(catalog, entry) ?? "").trim();
      if (!id) {
        diagnostics.push(createImportDiagnostic({
          code: "missing-catalog-id",
          sheetKey: catalog,
          rowNumber: index + 1,
          message: `Generated ${catalog} record is missing its stable ID`
        }));
      } else if (ids.has(id)) {
        diagnostics.push(createImportDiagnostic({
          code: "duplicate-catalog-id",
          sheetKey: catalog,
          rowNumber: index + 1,
          value: id,
          message: `Duplicate generated ${catalog} ID ${id}; first seen at record ${ids.get(id) + 1}`
        }));
      } else {
        ids.set(id, index);
      }
      const source = sourceIdentity(catalog, entry);
      if (!source) continue;
      if (sources.has(source) && sources.get(source) !== id) {
        diagnostics.push(createImportDiagnostic({
          code: "source-row-multiple-ids",
          sheetKey: catalog,
          rowNumber: index + 1,
          value: source,
          message: `Source row ${source} produced multiple stable IDs`
        }));
      } else {
        sources.set(source, id);
      }
    }
  }
}

function validateCrossCatalogReferences(bundle, diagnostics) {
  const gearIds = new Set(bundle.catalogs.gear.map((entry) => entry.id));
  const materialIds = new Set(bundle.catalogs.materials.map((entry) => entry.id));
  for (const item of bundle.catalogs.gear) {
    if (item.predominantMaterialId && !materialIds.has(item.predominantMaterialId)) {
      diagnostics.push(createImportDiagnostic({
        code: "dangling-material-reference",
        sheetKey: "gear",
        value: item.predominantMaterialId,
        message: `Gear ${item.id} references missing material ${item.predominantMaterialId}`
      }));
    }
  }
  for (const item of bundle.catalogs.upgrades) {
    if (!gearIds.has(item.productId)) {
      diagnostics.push(createImportDiagnostic({
        code: "dangling-upgrade-product",
        sheetKey: "upgrades",
        value: item.productId,
        message: `Upgrade references missing product ${item.productId}`
      }));
    }
    if (item.upgrade?.sourceMaterialId && !materialIds.has(item.upgrade.sourceMaterialId)) {
      diagnostics.push(createImportDiagnostic({
        code: "dangling-upgrade-material",
        sheetKey: "upgrades",
        value: item.upgrade.sourceMaterialId,
        message: `Upgrade references missing material ${item.upgrade.sourceMaterialId}`
      }));
    }
  }
}

export function validateEquipmentBundle({ bundle, workbookSnapshot }) {
  const diagnostics = [];
  if (bundle?.schemaVersion !== 1) {
    diagnostics.push(createImportDiagnostic({
      code: "invalid-bundle-schema",
      value: bundle?.schemaVersion,
      message: "Equipment bundle schemaVersion must be 1"
    }));
  }
  if (bundle?.source?.spreadsheetId !== workbookSnapshot?.spreadsheetId
    || bundle?.source?.fingerprint !== workbookSnapshot?.fingerprint) {
    diagnostics.push(createImportDiagnostic({
      code: "bundle-source-mismatch",
      message: "Equipment bundle source metadata does not match the workbook snapshot"
    }));
  }
  if (!bundle?.catalogs || typeof bundle.catalogs !== "object") {
    diagnostics.push(createImportDiagnostic({
      code: "missing-bundle-catalogs",
      message: "Equipment bundle catalogs are required"
    }));
  } else {
    validateCatalogRecords(bundle, diagnostics);
    if (Object.values(GENERATED_CATALOG_PATHS).length === Object.keys(bundle.catalogs).length) {
      validateCrossCatalogReferences(bundle, diagnostics);
    }
  }
  throwIfDiagnostics(diagnostics, "Invalid generated equipment bundle");
  return deepFreeze(bundle);
}

export function buildEquipmentBundle({ workbookSnapshot, overrides }) {
  requireWorkbookSnapshot(workbookSnapshot);
  const sheets = deepFreeze(structuredClone(workbookSnapshot.sheets));
  const validatedOverrides = validateEquipmentOverrides(overrides);
  const diagnostics = [];
  const failures = new Set();
  const referenceIndex = buildEquipmentReferenceIndex({ snapshots: sheets, overrides: validatedOverrides });
  const materials = collectAdapterDiagnostics(
    diagnostics,
    () => adaptMaterialsCatalog({ snapshot: sheets.materials, overrides: validatedOverrides, diagnostics: [] }),
    []
  );

  const base = collectAdapterDiagnostics(
    diagnostics,
    () => adaptBaseGear({
      snapshot: sheets.baseGear,
      referenceIndex,
      overrides: validatedOverrides,
      materials,
      diagnostics: []
    }),
    { items: [], transportRows: [] },
    { failures, label: "baseGear" }
  );
  const weapons = collectAdapterDiagnostics(
    diagnostics,
    () => adaptWeaponProfiles({ snapshots: sheets, referenceIndex, diagnostics: [] }),
    new Map()
  );
  const armor = collectAdapterDiagnostics(
    diagnostics,
    () => adaptArmorProfiles({ snapshot: sheets.armor, referenceIndex, diagnostics: [] }),
    new Map()
  );
  const ammunition = collectAdapterDiagnostics(
    diagnostics,
    () => adaptAmmunitionProfiles({ snapshot: sheets, referenceIndex, diagnostics: [] }),
    new Map()
  );
  const explosives = collectAdapterDiagnostics(
    diagnostics,
    () => adaptExplosiveProfiles({ snapshot: sheets.explosives, referenceIndex, diagnostics: [] }),
    new Map()
  );
  const attachments = collectAdapterDiagnostics(
    diagnostics,
    () => adaptAttachmentProfiles({ snapshot: sheets.attachments, referenceIndex, diagnostics: [] }),
    new Map()
  );
  const gear = failures.has("baseGear")
    ? []
    : collectAdapterDiagnostics(
      diagnostics,
      () => mergeGearFragments({
        baseItems: base.items,
        fragmentsByAdapter: { weapons, armor, ammunition, explosives, attachments },
        diagnostics: []
      }),
      []
    );
  const upgrades = collectAdapterDiagnostics(
    diagnostics,
    () => adaptUpgradeCatalog({
      snapshot: sheets.upgrades,
      referenceIndex,
      overrides: validatedOverrides,
      materials,
      diagnostics: []
    }),
    []
  );
  const implants = collectAdapterDiagnostics(
    diagnostics,
    () => adaptImplantsCatalog({ snapshot: sheets.implants, referenceIndex, overrides: validatedOverrides, diagnostics: [] }),
    []
  );
  const transport = collectAdapterDiagnostics(
    diagnostics,
    () => adaptTransportCatalog({ snapshots: sheets, referenceIndex, overrides: validatedOverrides, diagnostics: [] }),
    []
  );
  const magicItems = collectAdapterDiagnostics(
    diagnostics,
    () => adaptMagicItemsCatalog({ snapshots: sheets, referenceIndex, overrides: validatedOverrides, diagnostics: [] }),
    []
  );

  throwIfDiagnostics(diagnostics, "Equipment bundle adaptation failed");
  const bundle = {
    schemaVersion: 1,
    source: {
      spreadsheetId: workbookSnapshot.spreadsheetId,
      fingerprint: workbookSnapshot.fingerprint
    },
    catalogs: { gear, upgrades, materials, implants, transport, magicItems },
    diagnostics: []
  };
  return validateEquipmentBundle({ bundle, workbookSnapshot, overrides: validatedOverrides });
}
