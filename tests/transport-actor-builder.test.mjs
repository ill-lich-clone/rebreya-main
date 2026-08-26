import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildTransportActorData,
  normalizeTransportEntry,
  parseTransportCapacity,
  parseTransportSpeed,
  parseTransportWeight
} from "../scripts/data/transport-actor-builder.js";

const catalog = JSON.parse(await readFile(
  new URL("../data/rebreya-transport-v01.json", import.meta.url),
  "utf8"
));

test("transport catalog contains 62 stable unique entries", () => {
  assert.equal(catalog.length, 62);
  assert.equal(new Set(catalog.map((row) => row.sourceId)).size, 62);
  assert.equal(new Set(catalog.map((row) => row.documentId)).size, 62);
  assert.ok(catalog.every((row) => /^lchtransport\d{4}$/u.test(row.documentId)));
  assert.deepEqual(
    catalog.map((row) => row.sourceRow).toSorted((left, right) => left - right),
    Array.from({ length: 62 }, (_, index) => index + 3)
  );
});

test("transport normalizer keeps source text and does not invent dashed stats", () => {
  const mount = normalizeTransportEntry(catalog.find((row) => row.name === "Боевой конь"), 0);

  assert.equal(mount.typeLabel, "Скакун");
  assert.equal(mount.defaultGroupRole, "mount");
  assert.equal(mount.hpMax, null);
  assert.equal(mount.source.hp, "—");
  assert.equal(mount.feedOrFuel.kind, "feed");
  assert.equal(mount.feedOrFuel.amount, 4);
  assert.equal(mount.feedOrFuel.unit, "lb");
});

test("transport consumption exposes a machine-readable fractional per-mile rate", () => {
  const vehicle = normalizeTransportEntry({
    ...catalog.find((row) => row.name === "Гражданский автомобиль"),
    consumption: "Жидкий уголь 1/8 галлона"
  });

  assert.deepEqual(vehicle.feedOrFuel, {
    kind: "fuel",
    resource: "Жидкий уголь",
    amount: 0.125,
    unit: "gal",
    cadence: "mile",
    raw: "Жидкий уголь 1/8 галлона"
  });
});

test("locomotive capacity retains own and towed tonnage", () => {
  assert.deepEqual(parseTransportCapacity("5/500 тонн"), {
    cargoCapacityLb: 10000,
    towedCapacityLb: 1000000,
    raw: "5/500 тонн"
  });
});

test("weight parser normalizes source tonnage to pounds", () => {
  assert.deepEqual(parseTransportWeight("50 тонн"), {
    value: 100000,
    units: "lb",
    raw: "50 тонн"
  });
  assert.deepEqual(parseTransportWeight("—"), {
    value: null,
    units: "lb",
    raw: "—"
  });
});

test("two-mode combat speed retains both values", () => {
  assert.deepEqual(parseTransportSpeed("40/80 футов"), {
    primaryFt: 40,
    secondaryFt: 80,
    raw: "40/80 футов"
  });
});

test("vehicle builder writes native and Rebreya fields", () => {
  const source = {
    ...catalog.find((row) => row.name === "Гражданский автомобиль"),
    consumption: "Бензин, 1/16 галлона/милю",
    fuelTank: "16 галлонов",
    range: "256 миль"
  };
  const actor = buildTransportActorData(source);

  assert.equal(actor._id, source.documentId);
  assert.equal(actor.name, source.name);
  assert.equal(actor.type, "vehicle");
  assert.equal(actor.system.attributes.hp.max, 150);
  assert.equal(actor.system.attributes.hp.value, 150);
  assert.equal(actor.system.attributes.ac.flat, 14);
  assert.equal(actor.system.attributes.capacity.cargo.value, 1800);
  assert.equal(actor.system.attributes.capacity.cargo.units, "lb");
  assert.equal(actor.system.attributes.movement.walk, 250);
  assert.equal(actor.system.attributes.movement.units, "ft");
  assert.equal(actor.system.attributes.travel.units, "mph");
  assert.equal(actor.system.details.type, "land");
  assert.deepEqual(actor.system.crew.value, []);
  assert.deepEqual(actor.system.passengers.value, []);
  assert.equal(actor.system.crew.max, 1);
  assert.equal(actor.system.passengers.max, 4);
  assert.equal(actor.flags["rebreya-main"].transport.sourceId, source.sourceId);
  assert.equal(actor.flags["rebreya-main"].transport.version, 4);
  assert.match(actor.flags["rebreya-main"].signature, /^transport-v4:/u);
  assert.equal(actor.flags["rebreya-main"].transport.instance, false);
  assert.equal(actor.flags["rebreya-main"].transport.defaultGroupRole, "transport");
  assert.equal(actor.flags["rebreya-main"].transport.sourceType, "Механический транспорт");
  assert.deepEqual(actor.flags["rebreya-main"].transport.consumption, {
    kind: "fuel", resource: "Бензин", amount: 0.0625, unit: "gal", cadence: "mile",
    raw: "Бензин, 1/16 галлона/милю"
  });
  assert.deepEqual(actor.flags["rebreya-main"].transport.fuelTank, {
    value: 16, unit: "gal", raw: "16 галлонов"
  });
  assert.deepEqual(actor.flags["rebreya-main"].transport.range, {
    value: 256, unit: "mi", raw: "256 миль"
  });
  assert.equal(actor.flags["rebreya-main"].transport.raw.cargoCapacity, source.cargoCapacity);
  assert.equal(actor.prototypeToken.actorLink, true);
});

test("transport actor builder prefers a module-owned icon matched by vehicle name", () => {
  const source = catalog.find((row) => row.name === "Линкор");
  const iconPath = "modules/rebreya-main/templates/icons/Transport/%D0%9B%D0%B8%D0%BD%D0%BA%D0%BE%D1%80.webp";
  const actor = buildTransportActorData(source, new Map([["линкор", iconPath]]));

  assert.equal(actor.img, iconPath);
});
