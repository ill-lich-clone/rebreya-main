import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value)
  }
};

test("economy normalization preserves the authored city panorama", async () => {
  const cities = JSON.parse(
    await readFile(new URL("../data/cities.json", import.meta.url), "utf8")
  );
  const authoredCity = cities.find(({ name }) => name === "Цугенгрим");

  const dataset = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [authoredCity],
    reference: {},
    materials: [],
    gear: []
  });

  assert.equal(
    dataset.cities[0].image,
    "modules/rebreya-main/assets/cities/Цугенгрим.webp"
  );
});
