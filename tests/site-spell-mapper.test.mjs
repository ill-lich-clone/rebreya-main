import test from "node:test";
import assert from "node:assert/strict";

import {
  mapSchool,
  parseCastingTime,
  parseRange,
  parseDuration,
  buildProperties,
  buildDescriptionHtml,
  buildIdentifier,
  folderPathForLevel,
  buildSpellItemData,
} from "../scripts/data/site-spell-mapper.js";
import { SiteApiCatalogProvider } from "../scripts/data/catalog-providers/site-api-catalog-provider.js";

// Real records as the site API returns them.
const ACID_SPLASH = {
  id: 13,
  name: "Брызги кислоты",
  slug: "13-acid-splash",
  level: 0,
  school: "Conjuration",
  castingTime: "1 действие",
  spellRange: "60 футов",
  duration: "Мгновенная",
  components: ["V", "S"],
  materialComponent: "",
  ritual: false,
  concentration: false,
  classList: ["Wizard", "Artificer", "Sorcerer"],
  source: "PH14, PH24",
  description: "Вы выпускаете шар кислоты.",
  details: "Вы выпускаете шар кислоты.\n\nЦель должна преуспеть в спасброске Ловкости.",
  higherLevel: "Урон возрастает на 1к6.",
  updated_at: "2026-07-01T10:00:00Z",
  content_hash: "sha256:abc",
};

test("mapSchool maps all eight English school names", () => {
  assert.equal(mapSchool("Conjuration"), "con");
  assert.equal(mapSchool("Evocation"), "evo");
  assert.equal(mapSchool("transmutation"), "trs");
  assert.equal(mapSchool("Illusion"), "ill");
  assert.equal(mapSchool("Unknown"), "");
});

test("parseCastingTime: action / bonus / reaction with condition / minutes / hours", () => {
  assert.deepEqual(parseCastingTime("1 действие"), { type: "action", value: 1, condition: "" });
  assert.deepEqual(parseCastingTime("1 бонусное действие"), { type: "bonus", value: 1, condition: "" });
  const r = parseCastingTime("1 реакция, совершаемая вами, когда вас атакуют");
  assert.equal(r.type, "reaction");
  assert.match(r.condition, /когда вас атакуют/);
  assert.deepEqual(parseCastingTime("10 минут"), { type: "minute", value: 10, condition: "" });
  assert.deepEqual(parseCastingTime("1 час"), { type: "hour", value: 1, condition: "" });
  // alternatives take the first form
  assert.equal(parseCastingTime("1 действие или 8 часов").type, "action");
});

test("parseRange: feet / touch / self with template / miles / special", () => {
  assert.deepEqual(parseRange("60 футов"), { value: 60, units: "ft", special: "" });
  assert.deepEqual(parseRange("Касание"), { value: null, units: "touch", special: "" });
  const self = parseRange("На себя (5-футовый радиус)");
  assert.equal(self.units, "self");
  assert.match(self.special, /5-футовый радиус/);
  assert.deepEqual(parseRange("500 миль"), { value: 500, units: "mi", special: "" });
  const spec = parseRange("В пределах видимости");
  assert.equal(spec.units, "spec");
  assert.equal(spec.special, "В пределах видимости");
});

test("parseDuration: instant / concentration / rounds / dispel variants", () => {
  assert.deepEqual(parseDuration("Мгновенная"), { value: null, units: "inst", concentration: false });
  const conc = parseDuration("Концентрация, вплоть до 1 минуты");
  assert.equal(conc.units, "minute");
  assert.equal(conc.value, 1);
  assert.equal(conc.concentration, true);
  assert.equal(parseDuration("1 раунд").units, "round");
  assert.equal(parseDuration("8 часов").value, 8);
  assert.equal(parseDuration("До рассеивания").units, "disp");
  assert.equal(parseDuration("До рассеивания или срабатывания").units, "dstr");
  // «или»-alternatives take the first
  assert.equal(parseDuration("Мгновенная или 1 час").units, "inst");
});

test("buildProperties: V/S/M + ritual + concentration (also Cyrillic В/С/М)", () => {
  const props = buildProperties(
    { components: ["V", "S", "M"], ritual: true, concentration: false },
    { concentration: true },
  );
  assert.deepEqual([...props].sort(), ["concentration", "material", "ritual", "somatic", "vocal"]);
  const cyr = buildProperties({ components: ["В", "М"], ritual: false }, { concentration: false });
  assert.deepEqual([...cyr].sort(), ["material", "vocal"]);
});

test("buildIdentifier strips the numeric slug prefix", () => {
  assert.equal(buildIdentifier({ slug: "13-acid-splash", id: 13 }), "acid-splash");
  assert.equal(buildIdentifier({ slug: "", id: 7 }), "site-spell-7");
});

test("folderPathForLevel groups by level", () => {
  assert.equal(folderPathForLevel(0), "Заговоры");
  assert.equal(folderPathForLevel(3), "3-й круг");
});

test("buildDescriptionHtml includes body, higher-level, RU classes, source link", () => {
  const html = buildDescriptionHtml(ACID_SPLASH);
  assert.match(html, /шар кислоты/);
  assert.match(html, /На высоких уровнях/);
  assert.match(html, /Волшебник, Изобретатель, Чародей/);
  assert.match(html, /rebreya\.com\/dnd-5e\/spells\/13-acid-splash/);
  assert.match(html, /PH14, PH24/);
});

test("buildSpellItemData produces a coherent dnd5e spell item", () => {
  const data = buildSpellItemData(ACID_SPLASH, { moduleId: "rebreya-main" });
  assert.equal(data.type, "spell");
  assert.equal(data.name, "Брызги кислоты");
  assert.equal(data.system.level, 0);
  assert.equal(data.system.school, "con");
  assert.equal(data.system.activation.type, "action");
  assert.deepEqual(data.system.range, { value: 60, units: "ft", special: "" });
  assert.equal(data.system.duration.units, "inst");
  assert.ok(data.system.properties.includes("vocal"));
  assert.equal(data.system.source.book, "PH14");
  const site = data.flags["rebreya-main"].site;
  assert.equal(site.id, 13);
  assert.equal(site.slug, "13-acid-splash");
  assert.equal(site.contentHash, "sha256:abc");
  assert.equal(data.flags["rebreya-main"].managed, true);
});

test("buildSpellItemData clamps broken levels and survives empty fields", () => {
  const data = buildSpellItemData({ id: 1, name: "X", level: 99, components: null }, {});
  assert.equal(data.system.level, 9);
  assert.equal(data.system.school, "");
  assert.equal(data.system.duration.units, "inst");
  const empty = buildSpellItemData({ id: 2 }, {});
  assert.equal(empty.name, "Заклинание #2");
});

// --- provider ------------------------------------------------------------------

function stubApi(pages) {
  return {
    async *iterate(_resource, params = {}) {
      for (const row of pages(params)) yield row;
    },
    async getBySlug(_resource, slug) {
      if (slug === "13-acid-splash") return ACID_SPLASH;
      throw new Error("404");
    },
  };
}

test("SiteApiCatalogProvider.list collects all rows", async () => {
  const provider = new SiteApiCatalogProvider(stubApi(() => [{ id: 1 }, { id: 2 }]));
  const rows = await provider.list("spells");
  assert.equal(rows.length, 2);
});

test("SiteApiCatalogProvider.changes passes updated_since", async () => {
  let captured = null;
  const provider = new SiteApiCatalogProvider(stubApi((params) => { captured = params; return []; }));
  await provider.changes("spells", "2026-07-01T00:00:00Z");
  assert.equal(captured.updated_since, "2026-07-01T00:00:00Z");
});

test("SiteApiCatalogProvider.get returns null on failure", async () => {
  const provider = new SiteApiCatalogProvider(stubApi(() => []));
  assert.deepEqual(await provider.get("spells", "13-acid-splash"), ACID_SPLASH);
  assert.equal(await provider.get("spells", "missing"), null);
});
