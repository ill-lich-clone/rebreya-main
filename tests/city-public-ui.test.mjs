import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  openCityImagePicker,
  promptCityDescription,
  resolveCityViewMode
} from "../scripts/ui/city-presentation-ui.js";

test("players are locked to public city mode", () => {
  assert.equal(resolveCityViewMode({ isGM: false, requestedMode: "admin" }), "public");
  assert.equal(resolveCityViewMode({ isGM: true, requestedMode: "admin" }), "admin");
  assert.equal(resolveCityViewMode({ isGM: true, requestedMode: "public" }), "public");
});

test("city image picker delegates the selected path without writing settings", async () => {
  let options;
  class Picker { constructor(value) { options = value; } render() {} }
  const selected = [];
  openCityImagePicker({ current: "base.webp", pickerClass: Picker, onSelected: async (path) => selected.push(path) });
  await options.callback(" worlds/city.webp ");
  assert.deepEqual(selected, ["worlds/city.webp"]);
});

test("city description prompt escapes source text and returns trimmed input", async () => {
  let options;
  const result = await promptCityDescription({
    city: { name: "Город", description: "<старое>" },
    dialogClass: {
      async prompt(value) {
        options = value;
        return value.ok.callback(null, {
          form: { elements: { description: { value: "  Новый текст  " } } }
        });
      }
    }
  });
  assert.equal(result, "Новый текст");
  assert.match(options.content, /maxlength="5000"/u);
  assert.match(options.content, /&lt;старое&gt;/u);
  assert.equal(options.rejectClose, false);
});

test("player CityEconomyApp prepares only the public snapshot", async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  class TestApplication { constructor() {} async _onRender() {} }
  globalThis.foundry = {
    applications: { api: { ApplicationV2: TestApplication, HandlebarsApplicationMixin: (Base) => Base, DialogV2: {} } },
    utils: { getRoute: (path) => `/foundry/${path}` }
  };
  globalThis.game = {
    user: { isGM: false },
    settings: { get: () => false },
    modules: new Map([["rebreya-main", { version: "1.4.136" }]])
  };
  const calls = [];
  try {
    const { CityEconomyApp } = await import(`../scripts/ui/city-app.js?public-player=${Date.now()}`);
    const app = new CityEconomyApp({
      async getPublicCitySnapshot(cityId) {
        calls.push(["public", cityId]);
        return {
          id: cityId,
          image: "modules/rebreya-main/assets/cities/Город.webp",
          materialRows: [],
          traders: []
        };
      },
      getCitySnapshot() { throw new Error("player must not request the mechanical city snapshot"); }
    }, "city-a");
    const context = await app._prepareContext();
    assert.equal(context.isPublicView, true);
    assert.equal(context.canEditPresentation, false);
    assert.equal(context.publicCityImageUrl, "/foundry/modules/rebreya-main/assets/cities/Город.webp?v=1.4.136");
    assert.deepEqual(calls, [["public", "city-a"]]);

    const missing = new CityEconomyApp({ async getPublicCitySnapshot() { return null; } }, "missing");
    const missingContext = await missing._prepareContext();
    assert.equal(missingContext.hasError, true);
    assert.match(missingContext.errorMessage, /Город не найден/u);
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
  }
});

test("CityEconomyApp retains GM analytics and exposes only planned public controls", async () => {
  const [source, template, mainSource] = await Promise.all([
    readFile(new URL("../scripts/ui/city-app.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/city-app.hbs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8")
  ]);
  assert.match(source, /resolveCityViewMode/u);
  assert.match(source, /this\.moduleApi\.getCitySnapshot\(this\.cityId\)/u);
  assert.doesNotMatch(template, /rm-public-city-hero__image/u);
  assert.match(template, /data-city-image-url="\{\{publicCityImageUrl\}\}"/u);
  assert.match(source, /dataset\.cityImageUrl[\s\S]*style\.setProperty\("background-image"/u);
  assert.match(mainSource, /import\("\.\/ui\/city-app\.js\?v=1\.4\.136-public-city-background"\)/u);
  assert.doesNotMatch(source, /travelState|originCityId|destinationCityId/u);
  for (const action of [
    "city-public-tab",
    "toggle-city-view",
    "open-trader",
    "edit-city-description",
    "edit-city-image",
    "reset-city-description",
    "reset-city-image"
  ]) {
    assert.match(template, new RegExp(`data-action="${action}"`, "u"), action);
  }
  assert.match(template, /\{\{#if canEditPresentation\}\}[\s\S]*data-action="edit-city-description"[\s\S]*\{\{\/if\}\}/u);

  const start = template.indexOf("<!-- public-city:start -->");
  const end = template.indexOf("<!-- public-city:end -->", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const publicBranch = template.slice(start, end);
  assert.equal(
    publicBranch.match(/\{\{publicCity\.description\}\}/gu)?.length,
    1,
    "public description must be rendered only in the City tab"
  );
  const heroEnd = publicBranch.indexOf("</header>");
  assert.equal(publicBranch.slice(0, heroEnd).includes("{{publicCity.description}}"), false);
  for (const forbidden of ["priceModifierPercent", "production", "demand", "balance", "surplus", "deficit", "selfSufficiencyRate"]) {
    assert.equal(publicBranch.includes(forbidden), false, forbidden);
  }
});
