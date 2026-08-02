import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTransportFuelConsumption,
  resolveTransportFuelConsumption
} from "../scripts/data/transport-fuel-consumption.js";

test("fuel consumption accepts only positive lb or gal rates", () => {
  assert.deepEqual(normalizeTransportFuelConsumption({ amount: "0,125", unit: "gal" }), {
    amount: 0.125,
    unit: "gal"
  });
  assert.throws(
    () => normalizeTransportFuelConsumption({ amount: 0, unit: "lb" }),
    /больше нуля/u
  );
  assert.throws(
    () => normalizeTransportFuelConsumption({ amount: 1, unit: "kg" }),
    /фунты или галлоны/u
  );
});

test("effective consumption prefers the instance override and otherwise uses imported per-mile fuel", () => {
  assert.deepEqual(resolveTransportFuelConsumption(
    { amount: 120, unit: "lb" },
    { kind: "fuel", amount: 0.125, unit: "gal", cadence: "mile" }
  ), { amount: 120, unit: "lb", source: "override" });
  assert.deepEqual(resolveTransportFuelConsumption(null, {
    kind: "fuel", amount: 0.125, unit: "gal", cadence: "mile"
  }), { amount: 0.125, unit: "gal", source: "transport" });
  assert.deepEqual(resolveTransportFuelConsumption(null, {
    kind: "feed", amount: 4, unit: "lb", cadence: "day"
  }), { amount: 0, unit: "", source: "none" });
});
