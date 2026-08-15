import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const CITY_ART_PREFIX = "assets/Карты/Карты городов/Пейзажи 2x1/";

test("all economy cities declare a canonical panorama path", async () => {
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  assert.equal(cities.length, 300);
  assert.deepEqual(
    cities.filter((city) => city.image !== `${CITY_ART_PREFIX}${city.name}.webp`).map((city) => city.id),
    []
  );
});

test("declared city panoramas match the Foundry Data asset folder when it is available", async (context) => {
  const assetUrl = new URL("../../../assets/Карты/Карты городов/Пейзажи 2x1/", import.meta.url);
  const assetPath = fileURLToPath(assetUrl);
  if (!existsSync(assetPath)) {
    context.skip("Foundry Data city panorama folder is not mounted");
    return;
  }
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const files = new Set(await readdir(assetPath));
  assert.deepEqual(cities.filter((city) => !files.has(`${city.name}.webp`)).map((city) => city.name), []);
});

test("city importer preserves the canonical panorama convention", async () => {
  const importer = await readFile(new URL("../tools/import-xlsx.ps1", import.meta.url), "utf8");
  assert.match(importer, /image\s*=\s*"assets\/Карты\/Карты городов\/Пейзажи 2x1\/\$name\.webp"/u);
});
