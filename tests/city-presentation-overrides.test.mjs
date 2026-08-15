import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeCityPresentation,
  normalizeCityPresentationOverrides,
  patchCityPresentationOverrides
} from "../scripts/data/city-presentation-overrides.js";
import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { registerSettings } from "../scripts/settings.js";

test("city presentation overrides keep only known cities and supported fields", () => {
  const normalized = normalizeCityPresentationOverrides({
    known: { description: "  Новый текст  ", image: " worlds/a.webp ", leaked: 7 },
    missing: { description: "Скрыть" }
  }, new Set(["known"]));
  assert.deepEqual(normalized, {
    known: { description: "Новый текст", image: "worlds/a.webp" }
  });
});

test("null patch fields reset to the base city presentation", () => {
  const current = { known: { description: "Override", image: "worlds/custom.webp" } };
  const next = patchCityPresentationOverrides(current, "known", { description: null }, new Set(["known"]));
  assert.deepEqual(next, { known: { image: "worlds/custom.webp" } });
  assert.deepEqual(mergeCityPresentation({
    id: "known", description: "Base", image: "assets/base.webp"
  }, next), {
    cityId: "known",
    baseDescription: "Base",
    baseImage: "assets/base.webp",
    description: "Base",
    image: "worlds/custom.webp",
    descriptionOverridden: false,
    imageOverridden: true
  });
});

test("unknown city presentation patches fail closed", () => {
  assert.throws(
    () => patchCityPresentationOverrides({}, "missing", { description: "x" }, new Set(["known"])),
    /Unknown city/u
  );
});

test("city presentation setting key is stable", () => {
  assert.equal(SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES, "cityPresentationOverrides");
  assert.equal(MODULE_ID, "rebreya-main");
});

test("city presentation overrides register as hidden world state", () => {
  const previousGame = globalThis.game;
  const registered = [];
  globalThis.game = { settings: { register(moduleId, key, config) { registered.push({ moduleId, key, config }); } } };
  try {
    registerSettings();
    const entry = registered.find((candidate) => candidate.key === SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES);
    assert.equal(entry?.moduleId, MODULE_ID);
    assert.deepEqual({
      scope: entry?.config.scope,
      config: entry?.config.config,
      type: entry?.config.type,
      default: entry?.config.default
    }, { scope: "world", config: false, type: Object, default: {} });
  }
  finally {
    globalThis.game = previousGame;
  }
});
