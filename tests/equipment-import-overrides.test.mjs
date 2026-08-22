import test from "node:test";
import assert from "node:assert/strict";

import {
  EQUIPMENT_OVERRIDE_SCHEMA_VERSION,
  applyManualEnrichment,
  buildInitialEquipmentOverrides,
  resolveStableIdentity,
  validateEquipmentOverrides
} from "../tools/equipment-import/overrides.mjs";

const allowedEnrichmentFields = Object.freeze({
  gear: ["foundryType", "foundrySubtype", "foundryBaseItem", "foundryFolder", "containerCapacity"],
  implants: ["foundryType", "foundrySubtype", "foundryFolder"],
  transport: ["documentId"],
  magicItems: []
});

function validOverrides() {
  return {
    schemaVersion: 1,
    identities: {
      gear: {
        "Оружие V0.36!A4": {
          id: "boevoy-posoh",
          aliases: ["Оружие V0.35!A4"]
        }
      }
    },
    enrichment: {
      gear: {
        "boevoy-posoh": {
          foundryBaseItem: "quarterstaff",
          foundryFolder: "Оружие"
        }
      }
    }
  };
}

test("override validation normalizes stable identities and reviewed aliases", () => {
  const normalized = validateEquipmentOverrides(validOverrides(), {
    allowedEnrichmentFields,
    knownSourceKeys: { gear: new Set(["Оружие V0.36!A4"]) }
  });

  assert.equal(normalized.schemaVersion, EQUIPMENT_OVERRIDE_SCHEMA_VERSION);
  assert.deepEqual(normalized.identities.gear["Оружие V0.36!A4"], {
    id: "boevoy-posoh",
    aliases: ["Оружие V0.35!A4"]
  });
  assert.equal(Object.isFrozen(normalized), true);
});

test("duplicate stable IDs and orphaned source identities are rejected", () => {
  const duplicate = validOverrides();
  duplicate.identities.gear["Оружие V0.36!A5"] = "boevoy-posoh";
  assert.throws(
    () => validateEquipmentOverrides(duplicate, { allowedEnrichmentFields }),
    /duplicate stable id/i
  );

  assert.throws(
    () => validateEquipmentOverrides(validOverrides(), {
      allowedEnrichmentFields,
      knownSourceKeys: { gear: new Set(["Оружие V0.36!A99"]) }
    }),
    /orphaned override/i
  );
});

test("stable identity resolution uses only exact source keys and reviewed aliases", () => {
  const overrides = validateEquipmentOverrides(validOverrides(), { allowedEnrichmentFields });

  assert.equal(resolveStableIdentity({
    catalog: "gear",
    sourceKey: "Оружие V0.36!A4",
    sourceName: "Боевой посох",
    overrides
  }), "boevoy-posoh");
  assert.equal(resolveStableIdentity({
    catalog: "gear",
    sourceKey: "Оружие V0.35!A4",
    sourceName: "Боевой посох",
    overrides
  }), "boevoy-posoh");
  assert.equal(resolveStableIdentity({
    catalog: "gear",
    sourceKey: "Оружие V0.36!A40",
    sourceName: "Новое копьё",
    overrides
  }), "новое-копье");
  assert.notEqual(resolveStableIdentity({
    catalog: "gear",
    sourceKey: "Оружие V0.36!A40",
    sourceName: "Переименованный боевой посох",
    overrides
  }), "boevoy-posoh");
});

test("manual enrichment permits only adapter-owned non-sheet fields", () => {
  const overrides = validateEquipmentOverrides(validOverrides(), { allowedEnrichmentFields });
  assert.deepEqual(applyManualEnrichment({
    catalog: "gear",
    stableId: "boevoy-posoh",
    generated: { id: "boevoy-posoh", name: "Боевой посох", weight: 4 },
    overrides,
    allowedFields: allowedEnrichmentFields.gear
  }), {
    id: "boevoy-posoh",
    name: "Боевой посох",
    weight: 4,
    foundryBaseItem: "quarterstaff",
    foundryFolder: "Оружие"
  });

  const sheetOwned = validOverrides();
  sheetOwned.enrichment.gear["boevoy-posoh"].weight = 14;
  assert.throws(
    () => validateEquipmentOverrides(sheetOwned, { allowedEnrichmentFields }),
    /sheet-owned|not allowed/i
  );
});

test("initial migration preserves current IDs and extracts only whitelisted enrichment", () => {
  const migrated = buildInitialEquipmentOverrides({
    gear: [{
      id: "dart",
      name: "Дротик",
      equipmentType: "Оружие",
      weight: 14,
      foundryBaseItem: "dart",
      foundryFolder: "Оружие",
      weapon: { damageFormula: "1d4" }
    }],
    implants: [{
      id: "implant-eye",
      name: "Механический глаз",
      foundryType: "equipment",
      foundrySubtype: "wondrous",
      implant: { effect: "Sheet-owned effect" }
    }],
    materials: [{
      id: "steel",
      name: "Сталь",
      linkedGoodId: "steel",
      linkedGoodName: "Сталь",
      weight: 1
    }],
    transport: [{
      sourceId: "transport-cart",
      documentId: "lchtransport0001",
      name: "Телега",
      ac: "12"
    }],
    magicItems: [{ name: "Аметистовый магнетит", description: "Sheet-owned description" }]
  });

  assert.deepEqual(migrated.identities.gear["оружие|дротик"], { id: "dart", aliases: [] });
  assert.deepEqual(migrated.identities.implants["Механический глаз"], { id: "implant-eye", aliases: [] });
  assert.deepEqual(migrated.identities.materials.Сталь, { id: "steel", aliases: [] });
  assert.deepEqual(migrated.identities.transport.Телега, { id: "transport-cart", aliases: [] });
  assert.deepEqual(migrated.identities.magicItems["магический-предмет|1"], {
    id: "аметистовый-магнетит",
    aliases: []
  });
  assert.deepEqual(migrated.enrichment.gear.dart, {
    foundryBaseItem: "dart",
    foundryFolder: "Оружие"
  });
  assert.deepEqual(migrated.enrichment.transport["transport-cart"], {
    documentId: "lchtransport0001"
  });
  assert.deepEqual(migrated.enrichment.materials.steel, {
    linkedGoodId: "steel",
    linkedGoodName: "Сталь"
  });
  assert.equal(JSON.stringify(migrated).includes("damageFormula"), false);
  assert.equal(JSON.stringify(migrated).includes("Sheet-owned"), false);
  assert.equal(JSON.stringify(migrated).includes('"weight"'), false);
});

test("initial gear migration uses the canonical type and name key for duplicate display names", () => {
  const migrated = buildInitialEquipmentOverrides({
    gear: [
      { id: "claw-implant", name: "Коготь чудовища", equipmentType: "Имплант" },
      { id: "claw-upgrade", name: "Коготь чудовища", equipmentType: "Усовершенствование" }
    ],
    implants: [],
    transport: [],
    magicItems: []
  });

  assert.deepEqual(migrated.identities.gear["имплант|коготь чудовища"], {
    id: "claw-implant",
    aliases: []
  });
  assert.deepEqual(migrated.identities.gear["усовершенствование|коготь чудовища"], {
    id: "claw-upgrade",
    aliases: []
  });
});

test("initial magic-item migration keys duplicate names by stable source number", () => {
  const migrated = buildInitialEquipmentOverrides({
    gear: [],
    implants: [],
    transport: [],
    magicItems: [
      { name: "Жезл бдительности", costText: "—" },
      { name: "Жезл бдительности", costText: "5000 зм" }
    ]
  });

  assert.deepEqual(migrated.identities.magicItems["магический-предмет|1"], {
    id: "жезл-бдительности",
    aliases: []
  });
  assert.deepEqual(migrated.identities.magicItems["магический-предмет|2"], {
    id: "жезл-бдительности-2",
    aliases: []
  });
});

test("initial migration rejects duplicate names or stable IDs instead of overwriting them", () => {
  assert.throws(
    () => buildInitialEquipmentOverrides({
      gear: [
        { id: "one", name: "Дубликат", equipmentType: "Оружие" },
        { id: "two", name: "Дубликат", equipmentType: "Оружие" }
      ],
      implants: [],
      transport: [],
      magicItems: []
    }),
    /duplicate source identity/i
  );
  assert.throws(
    () => buildInitialEquipmentOverrides({
      gear: [
        { id: "same", name: "Первый", equipmentType: "Оружие" },
        { id: "same", name: "Второй", equipmentType: "Оружие" }
      ],
      implants: [],
      transport: [],
      magicItems: []
    }),
    /duplicate stable id/i
  );
});
