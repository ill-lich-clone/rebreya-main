import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const CITY_ART_PREFIX = "modules/rebreya-main/assets/cities/";

test("all economy cities declare a canonical panorama path", async () => {
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  assert.equal(cities.length, 300);
  assert.deepEqual(
    cities.filter((city) => city.image !== `${CITY_ART_PREFIX}${city.name}.webp`).map((city) => city.id),
    []
  );
});

test("declared city panoramas are shipped inside the module without duplicates", async () => {
  const cities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const declaredFiles = cities.map((city) => `${city.name}.webp`);
  const files = (await readdir(new URL("../assets/cities/", import.meta.url)))
    .filter((file) => file.endsWith(".webp"));

  assert.equal(new Set(declaredFiles).size, cities.length, "each city must map to a unique panorama filename");
  assert.deepEqual(files.sort(), declaredFiles.sort());
  assert.equal(JSON.stringify(cities).includes("Data/assets"), false);
});

test("city importer preserves the canonical panorama convention", async () => {
  const importer = await readFile(new URL("../tools/import-xlsx.ps1", import.meta.url), "utf8");
  assert.match(importer, /image\s*=\s*"modules\/rebreya-main\/assets\/cities\/\$name\.webp"/u);
});
