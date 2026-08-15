import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicCitySnapshot,
  buildPublicEconomySnapshot,
  buildPublicFilterOptions,
  selectPublicCityRows
} from "../scripts/application/public-economy-read-model.js";

function fixture() {
  const material = { id: "iron", name: "Железо", priceGold: 10, weight: 1, linkedGoodId: "zhelezo" };
  const city = {
    id: "city-a", name: "Город А", state: "Страна", regionId: "region-a", regionName: "Регион",
    cityType: "Промышленный", type: "Город", population: 10,
    production: 99, demand: 88, totalDeficit: 77,
    goodsRows: [{ goodId: "zhelezo", priceModifierPercent: 0.25, production: 3, demand: 8 }]
  };
  return {
    material,
    city,
    model: {
      materials: [material],
      cities: [city],
      materialById: new Map([[material.id, material]]),
      overview: { deficitGoods: [{ goodId: "zhelezo", deficit: 5 }] }
    }
  };
}

test("public city snapshot exposes final material price without mechanics", () => {
  const { model, city } = fixture();
  const snapshot = buildPublicCitySnapshot({
    model,
    city,
    presentation: { description: "Текст", image: "assets/city.webp" },
    traders: []
  });
  assert.deepEqual(snapshot.materialRows, [{
    materialId: "iron", name: "Железо", finalPriceGold: 12.5, finalWeight: 1
  }]);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["priceModifierPercent", "production", "demand", "balance", "surplus", "deficit", "importSources"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("public city snapshot preserves the actual minimum-price selling weight", () => {
  const { model, city, material } = fixture();
  material.priceGold = 0.01;
  city.goodsRows[0].priceModifierPercent = -0.8;
  const snapshot = buildPublicCitySnapshot({ model, city, presentation: {}, traders: [] });
  assert.deepEqual(snapshot.materialRows[0], {
    materialId: "iron", name: "Железо", finalPriceGold: 0.01, finalWeight: 5
  });
});

test("public economy exposes base prices and world deficit only", () => {
  const { model } = fixture();
  const snapshot = buildPublicEconomySnapshot(model, {
    "city-a": { description: "Public", image: "worlds/override.webp" }
  });
  assert.deepEqual(snapshot.materialRows, [{
    materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true
  }]);
  assert.equal(snapshot.cities[0].image, "worlds/override.webp");
  assert.equal(JSON.stringify(snapshot).includes("priceModifierPercent"), false);
});

test("public city filters sort by name without mechanical sort keys", () => {
  const rows = [
    { id: "b", name: "Бета", state: "S", regionId: "r", regionName: "R", cityType: "Порт" },
    { id: "a", name: "Альфа", state: "S", regionId: "r", regionName: "R", cityType: "Порт" }
  ];
  assert.deepEqual(selectPublicCityRows(rows, { search: "аль" }).map((row) => row.id), ["a"]);
  assert.deepEqual(selectPublicCityRows(rows, {}).map((row) => row.id), ["a", "b"]);
  assert.deepEqual(buildPublicFilterOptions(rows, "S"), {
    stateOptions: [{ value: "S", label: "S" }],
    regionOptions: [{ value: "r", label: "R (S)" }],
    cityTypeOptions: [{ value: "Порт", label: "Порт" }]
  });
});
