import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseChallengeRating,
  parseArmorClass,
  parseHitPoints,
  parseSpeed,
  parseSenses,
  parseAbilities,
  parseSaveProficiencies,
  parseSkillProficiencies,
  parseStatblock,
  mapCreatureType,
  mapSize,
  buildIdentifier,
  folderPathForType,
  buildNpcActorData,
} from "../scripts/data/site-monster-mapper.js";

const FIXTURES = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/bestiary-fixtures.json", import.meta.url)), "utf-8")
);

const DND5E_TYPES = new Set([
  "aberration", "beast", "celestial", "construct", "dragon", "elemental",
  "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead", "",
]);
const DND5E_SIZES = new Set(["tiny", "sm", "med", "lg", "huge", "grg"]);

test("parseChallengeRating handles integers, zero and fractions", () => {
  assert.equal(parseChallengeRating("5"), 5);
  assert.equal(parseChallengeRating("0"), 0);
  assert.equal(parseChallengeRating("1/4"), 0.25);
  assert.equal(parseChallengeRating("1/8"), 0.125);
  assert.equal(parseChallengeRating("1/2"), 0.5);
  assert.equal(parseChallengeRating("17"), 17);
});

test("parseArmorClass takes the leading number, ignoring the note", () => {
  assert.equal(parseArmorClass("14 (природный доспех)"), 14);
  assert.equal(parseArmorClass("12 (15 с доспехом мага)"), 12);
  assert.equal(parseArmorClass("8"), 8);
});

test("parseHitPoints splits value and dice formula (Cyrillic к → d)", () => {
  assert.deepEqual(parseHitPoints("88 ( 16к8 + 16 )"), { value: 88, formula: "16d8 + 16" });
  assert.deepEqual(parseHitPoints("2 ( 1к4 )"), { value: 2, formula: "1d4" });
  assert.deepEqual(parseHitPoints("40 (9к8)"), { value: 40, formula: "9d8" });
});

test("parseSpeed maps walk plus extra movement modes", () => {
  assert.deepEqual(parseSpeed("30 футов"), { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0, hover: false, units: "ft" });
  const flyer = parseSpeed("30 футов, полёт 50 футов");
  assert.equal(flyer.walk, 30);
  assert.equal(flyer.fly, 50);
  const swimmer = parseSpeed("5 футов, плавая 5 футов");
  assert.equal(swimmer.walk, 5);
  assert.equal(swimmer.swim, 5);
  const climber = parseSpeed("30 футов, лазая 30 футов");
  assert.equal(climber.climb, 30);
});

test("parseSenses extracts darkvision and drops passive perception", () => {
  const s = parseSenses("тёмное зрение 120 футов, пассивное Восприятие 11");
  assert.equal(s.darkvision, 120);
  assert.equal(s.blindsight, 0);
  const trem = parseSenses("тёмное зрение 60 футов, чувство вибрации 60 футов, пассивное Восприятие 10");
  assert.equal(trem.tremorsense, 60);
  assert.equal(trem.darkvision, 60);
});

test("parseAbilities reads six scores by RU abbreviation", () => {
  const a = parseAbilities("Сил 16 (+3) · Лов 14 (+2) · Тел 13 (+1) · Инт 14 (+2) · Мдр 12 (+1) · Хар 16 (+3)");
  assert.deepEqual(a, { str: 16, dex: 14, con: 13, int: 14, wis: 12, cha: 16 });
});

test("parseSaveProficiencies / parseSkillProficiencies map RU names to codes", () => {
  assert.deepEqual([...parseSaveProficiencies("Интеллект +6, Мудрость +6")].sort(), ["int", "wis"]);
  assert.deepEqual([...parseSkillProficiencies("Атлетика +6, Восприятие +5")].sort(), ["ath", "prc"]);
});

test("parseStatblock separates header labels, traits and actions", () => {
  const md = [
    "**Характеристики:** Сил 18 (+4) · Лов 13 (+1) · Тел 20 (+5) · Инт 7 (-2) · Мдр 9 (-1) · Хар 7 (-2)",
    "",
    "**Опасность:** 7 (2900 опыта)",
    "",
    "### Регенерация",
    "Тролль восстанавливает 10 хитов в начале каждого своего хода.",
    "",
    "## Действия",
    "",
    "**Мультиатака.** Тролль совершает одну атаку Укусом и две Когтями.",
    "",
    "**Укус.** Рукопашная атака: +7 к попаданию.",
    "",
    "## Реакции",
    "",
    "**Парирование.** Тролль добавляет 3 к своему КД.",
  ].join("\n");
  const { labels, traits, actions } = parseStatblock(md);
  assert.ok(labels["характеристики"].startsWith("Сил 18"));
  assert.equal(labels["опасность"], "7 (2900 опыта)");
  assert.equal(traits.length, 1);
  assert.equal(traits[0].name, "Регенерация");
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((a) => a.name), ["Мультиатака", "Укус", "Парирование"]);
  assert.equal(actions[0].section, "action");
  assert.equal(actions[2].section, "reaction");
});

test("mapCreatureType and mapSize resolve RU words (with subtype in parens)", () => {
  assert.equal(mapCreatureType("Великан"), "giant");
  assert.equal(mapCreatureType("Гуманоид (эльф)"), "humanoid");
  assert.equal(mapCreatureType("Нежить"), "undead");
  assert.equal(mapSize("Большой"), "lg");
  assert.equal(mapSize("Крошечный"), "tiny");
  assert.equal(mapSize("Средний"), "med");
});

test("buildIdentifier strips the numeric prefix and sanitises", () => {
  assert.equal(buildIdentifier({ slug: "7056-venom_troll", id: 1 }), "venom-troll");
  assert.equal(buildIdentifier({ slug: "", id: 42 }), "site-monster-42");
});

test("folderPathForType groups by capitalised creature type", () => {
  assert.equal(folderPathForType({ type: "Великан" }), "Великан");
  assert.equal(folderPathForType({ type: "Гуманоид (эльф)" }), "Гуманоид");
  assert.equal(folderPathForType({ type: "" }), "Прочее");
});

// ---- Whole-record mapping against real fixtures -------------------------

const leadingInt = (s) => Number((String(s).match(/\d+/) ?? [0])[0]);

test("every fixture maps to a schema-valid dnd5e NPC actor", () => {
  assert.ok(FIXTURES.length >= 8, "expected a diverse fixture set");
  for (const record of FIXTURES) {
    const actor = buildNpcActorData(record, { moduleId: "rebreya-main" });
    const label = `${record.id} ${record.name}`;

    assert.equal(actor.type, "npc", label);
    assert.ok(actor.name.length > 0, label);

    // Abilities: six scores, each a sane integer.
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      const v = actor.system.abilities[key].value;
      assert.ok(Number.isFinite(v) && v >= 1 && v <= 30, `${label} ability ${key}=${v}`);
    }

    // AC / HP / CR agree with the clean summary fields.
    assert.equal(actor.system.attributes.ac.flat, leadingInt(record.armorClass), `${label} AC`);
    assert.equal(actor.system.attributes.hp.value, leadingInt(record.hitPoints), `${label} HP`);
    assert.equal(actor.system.attributes.hp.max, actor.system.attributes.hp.value, `${label} HP max`);
    assert.equal(actor.system.details.cr, parseChallengeRating(record.challengeRating), `${label} CR`);

    // Movement: a positive walk unless the statblock genuinely has none.
    assert.ok(actor.system.attributes.movement.walk >= 0, `${label} walk`);
    assert.equal(actor.system.attributes.movement.units, "ft", label);

    // HP formula uses dice, never the Cyrillic «к».
    if (actor.system.attributes.hp.formula) {
      assert.ok(/d/.test(actor.system.attributes.hp.formula), `${label} formula ${actor.system.attributes.hp.formula}`);
      assert.ok(!/к/.test(actor.system.attributes.hp.formula), `${label} formula has Cyrillic к`);
    }

    // Type / size resolve to known dnd5e codes.
    assert.ok(DND5E_TYPES.has(actor.system.details.type.value), `${label} type ${actor.system.details.type.value}`);
    assert.ok(DND5E_SIZES.has(actor.system.traits.size), `${label} size ${actor.system.traits.size}`);

    // Every statblock produces at least one feat item (an action or trait).
    assert.ok(Array.isArray(actor.items) && actor.items.length >= 1, `${label} has items`);
    for (const item of actor.items) {
      assert.equal(item.type, "feat", `${label} item type`);
      assert.ok(item.name.length > 0, `${label} item name`);
      assert.equal(item.system.type.value, "monster", `${label} item monster type`);
    }

    // Identity flags for hash-gated sync.
    const site = actor.flags["rebreya-main"].site;
    assert.equal(site.entity, "bestiary", label);
    assert.equal(site.id, record.id, label);
    assert.equal(actor.flags["rebreya-main"].managed, true, label);
  }
});

test("multiattack and named actions survive into feat items", () => {
  const troll = FIXTURES.find((m) => /\bатак/i.test(m.details || ""));
  if (!troll) return;
  const actor = buildNpcActorData(troll, { moduleId: "rebreya-main" });
  const names = actor.items.map((i) => i.name);
  assert.ok(names.length >= 1);
  // Action feat items carry an activation of type action/legendary/etc.
  const withActivation = actor.items.filter((i) => i.system.activation?.type);
  assert.ok(withActivation.length >= 1, "at least one action-activated feat");
});
