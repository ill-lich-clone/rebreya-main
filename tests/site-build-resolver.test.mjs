import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  resolveClass,
  resolveSubclass,
  resolveRace,
  resolveBackground,
  resolveBuildPlan,
  collectGrants,
  hitPointsValue,
  subclassLevel,
  raceSize,
  applyAdvancementValues,
  buildPlaceholderItem,
  toIdentifier,
} from "../scripts/data/site-build-resolver.js";

// Trimmed dumps of dnd5e 5.2.5 SRD pack items (classes/wizard, subclasses/
// school-of-evocation, races/rock-gnome, backgrounds/acolyte).
const SRD = JSON.parse(readFileSync(new URL("./fixtures/dnd5e-srd-build-sample.json", import.meta.url), "utf-8"));
const clone = (v) => JSON.parse(JSON.stringify(v));

test("resolveClass: dnd.su slugs → SRD identifiers; non-SRD official → placeholder", () => {
  assert.deepEqual(resolveClass("105-wizard"), { identifier: "wizard", srd: true, variant: false });
  assert.deepEqual(resolveClass("87-barbarian"), { identifier: "barbarian", srd: true, variant: false });
  const artificer = resolveClass("137-artificer", "Изобретатель");
  assert.equal(artificer.srd, false);
  assert.equal(artificer.identifier, "artificer");
});

test("resolveClass: Rebreya lore classes map to SRD; reworks are flagged; strelok is a placeholder", () => {
  assert.deepEqual(resolveClass("volshebnik"), { identifier: "wizard", srd: true, variant: false, rebreya: true });
  assert.deepEqual(resolveClass("varvar-revork"), { identifier: "barbarian", srd: true, variant: true, rebreya: true });
  const strelok = resolveClass("strelok", "Стрелок");
  assert.equal(strelok.srd, false);
  assert.equal(strelok.identifier, "strelok");
});

test("resolveSubclass: site RU names (incl. case/nbsp) → SRD identifiers, others null", () => {
  assert.equal(resolveSubclass("Школа Воплощения"), "school-of-evocation");
  assert.equal(resolveSubclass("Наследие драконьей крови"), "draconic-bloodline");
  assert.equal(resolveSubclass("Исчадие"), "the-fiend");
  assert.equal(resolveSubclass("Песнь клинка"), null);
});

test("resolveRace / resolveBackground: only official slugs with an SRD item", () => {
  assert.deepEqual(resolveRace("81-human"), { identifier: "human" });
  assert.deepEqual(resolveRace("79-elf"), { identifier: "high-elf", assumedSubrace: true });
  assert.equal(resolveRace("vysshie-elfy"), null); // Rebreya race: own traits
  assert.equal(resolveRace("183-tabaxi"), null);
  assert.equal(resolveBackground("766-acolyte"), "acolyte");
  assert.equal(resolveBackground("762-sage"), null);
});

test("resolveBuildPlan: primary + multiclass levels, total, subclass ids", () => {
  const plan = resolveBuildPlan({
    gameClass: "Волшебник", classSlug: "105-wizard", subclass: "Школа Воплощения", level: 5,
    race: "Эльф", raceSlug: "79-elf", background: "Мудрец", backgroundSlug: "762-sage",
    data: { multiclass: [{ gameClass: "Воин", classSlug: "91-fighter", subclass: "", level: 2 }, { gameClass: "", classSlug: "", level: 3 }] },
  });
  assert.equal(plan.classes.length, 2);
  assert.deepEqual(plan.classes.map((c) => [c.identifier, c.level, c.primary]), [["wizard", 5, true], ["fighter", 2, false]]);
  assert.equal(plan.classes[0].subclass.identifier, "school-of-evocation");
  assert.equal(plan.classes[1].subclass, null);
  assert.equal(plan.totalLevel, 7);
  assert.equal(plan.race.identifier, "high-elf");
  assert.equal(plan.background.identifier, null);
});

test("resolveBuildPlan caps the total at 20 and drops empty classes", () => {
  const plan = resolveBuildPlan({ classSlug: "105-wizard", level: 18, data: { multiclass: [{ classSlug: "91-fighter", gameClass: "Воин", level: 5 }] } });
  assert.deepEqual(plan.classes.map((c) => c.level), [18, 2]);
  assert.equal(plan.totalLevel, 20);
  assert.deepEqual(resolveBuildPlan({}).classes, []);
});

test("collectGrants: wizard features up to level (SRD data)", () => {
  const at1 = collectGrants(SRD.wizard, 1);
  assert.equal(at1.length, 1);
  assert.equal(at1[0].uuids.length, 2); // Spellcasting + Arcane Recovery
  assert.equal(collectGrants(SRD.wizard, 5).length, 2); // + level 2 grant
  assert.equal(collectGrants(SRD.wizard, 20).length, 4);
  assert.equal(collectGrants(SRD.schoolOfEvocation, 5).length, 1);
  assert.equal(collectGrants(SRD.rockGnome, 1)[0].uuids.length, 3);
});

test("collectGrants skips optional grants and optional items", () => {
  const item = { system: { advancement: [
    { _id: "a", type: "ItemGrant", level: 1, configuration: { optional: true, items: [{ uuid: "x" }] } },
    { _id: "b", type: "ItemGrant", level: 1, configuration: { items: [{ uuid: "y", optional: true }, { uuid: "z" }] } },
  ] } };
  assert.deepEqual(collectGrants(item, 1), [{ advancementId: "b", uuids: ["z"] }]);
});

test("subclassLevel / raceSize / hitPointsValue from SRD data", () => {
  assert.equal(subclassLevel(SRD.wizard), 2);
  assert.equal(raceSize(SRD.rockGnome).size, "sm");
  assert.equal(raceSize(SRD.acolyte), null);
  assert.deepEqual(hitPointsValue(3), { 1: "max", 2: "avg", 3: "avg" });
  assert.deepEqual(hitPointsValue(2, { primary: false }), { 1: "avg", 2: "avg" }); // multiclass
});

test("applyAdvancementValues records granted ids and extra values the way dnd5e stores them", () => {
  const wizard = clone(SRD.wizard);
  const grantAdv = collectGrants(wizard, 1)[0].advancementId;
  const hpAdv = wizard.system.advancement.find((a) => a.type === "HitPoints")._id;
  const subAdv = wizard.system.advancement.find((a) => a.type === "Subclass")._id;
  applyAdvancementValues(wizard, { [grantAdv]: { NEWID: "Compendium.x" } }, {
    [hpAdv]: hitPointsValue(2),
    [subAdv]: { document: "SUB", uuid: "Compendium.s" },
  });
  const byId = Object.fromEntries(wizard.system.advancement.map((a) => [a._id, a.value]));
  assert.deepEqual(byId[grantAdv].added, { NEWID: "Compendium.x" });
  assert.deepEqual(byId[hpAdv], { 1: "max", 2: "avg" });
  assert.deepEqual(byId[subAdv], { document: "SUB", uuid: "Compendium.s" });
});

test("toIdentifier: latin-only output (dnd5e rejects Cyrillic identifiers)", () => {
  assert.equal(toIdentifier("762-sage"), "sage");
  assert.equal(toIdentifier("Мудрец"), "mudrets");
  assert.equal(toIdentifier("Песнь клинка"), "pesn-klinka");
  assert.equal(toIdentifier("vysshie-elfy"), "vysshie-elfy");
  assert.equal(toIdentifier("!!!", "class"), "class");
  assert.match(buildPlaceholderItem("background", { name: "Мудрец" }).system.identifier, /^[a-z0-9_-]+$/u);
});

test("buildPlaceholderItem: class keeps level + hit die; description is escaped", () => {
  const cls = buildPlaceholderItem("class", {
    name: "Стрелок", identifier: "strelok", level: 4, hitDie: null,
    description: "<b>x</b>", siteUrl: "https://rebreya.com/dnd-rebreya/classes/strelok",
  });
  assert.equal(cls.type, "class");
  assert.equal(cls.system.levels, 4);
  assert.deepEqual(cls.system.hd, { denomination: "d8", spent: 0 });
  assert.match(cls.system.description.value, /&lt;b&gt;x&lt;\/b&gt;/u);
  assert.match(cls.system.description.value, /dnd-rebreya\/classes\/strelok/u);
  const sub = buildPlaceholderItem("subclass", { name: "Песнь клинка", classIdentifier: "wizard" });
  assert.equal(sub.system.classIdentifier, "wizard");
});

import { matchIndexEntry, findReworkClass, nameKey, buildSlotOverrideUpdate } from "../scripts/data/site-build-resolver.js";

// world.rebreya-races index (type|name|identifier) as built by races-compendium.js,
// read live from the testovyj3 world on 2026-11-22.
const MODULE_RACES = [
  ["Морские эльфы", "morskie-elfy"], ["Дварфы", "dvarfy"], ["Нефилимы", "nefilimy"], ["Железорождённые", "zhelezorozhdyonnye"],
  ["Грунги", "grungi"], ["Высшие эльфы", "vysshie-elfy"], ["Полуорки", "poluorki"], ["Люди", "lyudi"], ["Гении", "genii"],
  ["Драконорождённые", "drakonorozhdyonnye"], ["Табакси", "tabaksi"], ["Тортлы", "tortly"], ["Пепельные", "pepelnye"],
  ["Кирисан", "kirisan"], ["Голиафы", "goliafy"], ["Гоблины", "gobliny"], ["Големы", "golemy"], ["Полуэльфы", "poluelfy"],
  ["Кентавры", "kentavry"], ["Гномы", "gnomy"], ["Синтеты", "sintety"], ["Полувеликаны", "poluvelikany"], ["Кобольды", "koboldy"],
  ["Минотавры", "minotavry"], ["Гноллы", "gnolly"], ["Дроу", "drou"], ["Лесные эльфы", "lesnye-elfy"], ["Полурослики", "polurosliki"],
  ["Людоящеры", "lyudoyashery"], ["Багбиры", "bagbiry"], ["Ааракокры", "aarakokry"], ["Орки", "orki"], ["Таргулы", "targuly"],
  ["Леониды", "leonidy"],
].map(([name, identifier]) => ({ type: "race", name, system: { identifier } }));

// Every dnd-rebreya race on the site (local QA API, 2026-11-22): slug | name.
const SITE_RACES = [
  ["golemy", "Големы"], ["pepelnye", "Пепельные"], ["nefilimy", "Нефилимы"], ["poluvelikany", "Полувеликаны"],
  ["leonidy", "Леониды"], ["kentavry", "Кентавры"], ["minotavry", "Минотавры"], ["tabaksi", "Табакси"], ["gnolly", "Гноллы"],
  ["grungi", "Грунги"], ["koboldy", "Кобольды"], ["bagbiry", "Багбиры"], ["tortly", "Тортлы"], ["lyudoyaschery", "Людоящеры"],
  ["aarakokry", "Ааракокры"], ["drou", "Дроу"], ["sintet", "Синтет"], ["genii", "Гении"],
  ["zhelezorozhdennye", "Железорождённые"], ["drakonorozhdennye", "Драконорождённые"], ["goliafy", "Голиафы"],
  ["gobliny", "Гоблины"], ["gnomy", "Гномы"], ["targuly-tiflingi", "Таргулы (Тифлинги)"],
  ["kirisany-aasimary", "Кирисаны (Аасимары)"], ["morskie-elfy", "Морские эльфы"], ["lesnye-elfy", "Лесные эльфы"],
  ["orki", "Орки"], ["poluorki", "Полуорки"], ["polurosliki", "Полурослики"], ["vysshie-elfy", "Высшие эльфы"],
  ["poluelfy", "Полуэльфы"], ["dvarfy", "Дварфы"], ["lyudi", "Люди"],
];

test("matchIndexEntry: every site Rebreya race finds exactly its module race", () => {
  const used = new Set();
  for (const [slug, name] of SITE_RACES) {
    const hit = matchIndexEntry(MODULE_RACES, { type: "race", identifier: slug, name });
    assert.ok(hit, `no match for ${slug} / ${name}`);
    assert.equal(nameKey(hit.name).slice(0, 5), nameKey(name).slice(0, 5), `${name} → ${hit.name}`);
    used.add(hit.system.identifier);
  }
  assert.equal(used.size, SITE_RACES.length); // one-to-one
});

test("matchIndexEntry: ambiguous or short names do not guess", () => {
  const pool = [{ type: "race", name: "Морские эльфы", system: {} }, { type: "race", name: "Лесные эльфы", system: {} }];
  assert.equal(matchIndexEntry(pool, { type: "race", name: "Эльфы" }), null);
  assert.equal(matchIndexEntry(pool, { type: "race", name: "Орк" }), null);
  assert.equal(matchIndexEntry(pool, { type: "race", name: "" }), null);
});

test("matchIndexEntry: subclass by name within the module class", () => {
  const subs = [
    { type: "subclass", name: "Путь Берсерка", system: { identifier: "barbarian-rework-v012", classIdentifier: "barbarian-rework-v012" } },
    { type: "subclass", name: "Чемпион", system: { identifier: "rb_9dzahr", classIdentifier: "fighter-rework-v028" } },
  ];
  assert.equal(matchIndexEntry(subs, { type: "subclass", name: "Путь берсерка", classIdentifier: "barbarian-rework-v012" }).name, "Путь Берсерка");
  assert.equal(matchIndexEntry(subs, { type: "subclass", name: "Чемпион", classIdentifier: "barbarian-rework-v012" }), null);
});

test("findReworkClass: Rebreya site class → module rework (world.rebreya-classes)", () => {
  const classes = ["paladin-rework-v01", "barbarian-rework-v012", "rogue-rework-v00", "fighter-rework-v028"]
    .map((identifier) => ({ type: "class", name: identifier, system: { identifier } }));
  assert.equal(findReworkClass(classes, resolveClass("varvar-revork").identifier).system.identifier, "barbarian-rework-v012");
  assert.equal(findReworkClass(classes, resolveClass("voin").identifier).system.identifier, "fighter-rework-v028");
  assert.equal(findReworkClass(classes, resolveClass("monah-revork").identifier), null); // no monk rework → SRD
  assert.equal(resolveClass("voin").rebreya, true);
  assert.equal(resolveClass("91-fighter").rebreya, undefined);
});

test("resolveBuildPlan marks Rebreya race/background for the module compendia", () => {
  const plan = resolveBuildPlan({ race: "Люди", raceSlug: "lyudi", background: "Подрывник", backgroundSlug: "podryvnik", classSlug: "voin", gameClass: "Воин", level: 3 });
  assert.equal(plan.race.rebreya, true);
  assert.equal(plan.background.rebreya, true);
  assert.equal(resolveBuildPlan({ race: "Эльф", raceSlug: "79-elf" }).race.rebreya, false);
});

test("buildSlotOverrideUpdate: site spellSlots → overrides; clearing resets all nine", () => {
  const set = buildSlotOverrideUpdate({ 1: 4, 2: "3", 3: 0 }, { apply: true });
  assert.equal(set["system.spells.spell1.override"], 4);
  assert.equal(set["system.spells.spell2.override"], 3);
  assert.equal(set["system.spells.spell3.override"], null);
  assert.equal(Object.keys(set).length, 9);
  assert.deepEqual(buildSlotOverrideUpdate({}, { apply: true }), {});
  const clear = buildSlotOverrideUpdate(null, { apply: false });
  assert.equal(Object.values(clear).every((v) => v === null), true);
  assert.equal(Object.keys(clear).length, 9);
});
