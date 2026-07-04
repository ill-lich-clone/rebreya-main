import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAbility,
  normalizeSkill,
  buildCharacterActorUpdate,
  buildBiographyHtml,
  buildSiteCharacterFlags,
} from "../scripts/data/site-character-mapper.js";

const CHAR = {
  id: 7,
  name: "Тайрен",
  race: "Человек",
  gameClass: "Волшебник",
  background: "Мудрец",
  level: 5,
  alignment: "Нейтрально-добрый",
  strength: 8,
  dexterity: 14,
  constitution: 13,
  intelligence: 17,
  wisdom: 12,
  charisma: 10,
  armorClass: 15,
  currentHp: 22,
  maxHp: 27,
  speed: 30,
  proficiencies: "Кинжалы, лёгкие арбалеты",
  languages: "Общий, эльфийский",
  equipment: "Книга заклинаний",
  notes: "Ищет древние тайны.",
  updated_at: "2026-07-03T12:00:00Z",
  content_hash: "sha256:xyz",
  data: {
    saveProficiencies: ["intelligence", "wisdom"],
    skillProficiencies: ["Тайная магия", "history"],
    skillExpertise: ["Расследование"],
    currency: { gp: 25, sp: 4, cp: 0, xp: 999 },
    deathSaves: { success: 1, failure: 2 },
    inspiration: true,
    exhaustion: 1,
  },
};

test("normalizeAbility accepts code / EN / RU", () => {
  assert.equal(normalizeAbility("int"), "int");
  assert.equal(normalizeAbility("Intelligence"), "int");
  assert.equal(normalizeAbility("интеллект"), "int");
  assert.equal(normalizeAbility("Мудрость"), "wis");
  assert.equal(normalizeAbility("bogus"), null);
});

test("normalizeSkill accepts code / EN / RU (incl. ё→е)", () => {
  assert.equal(normalizeSkill("arc"), "arc");
  assert.equal(normalizeSkill("Тайная магия"), "arc");
  assert.equal(normalizeSkill("history"), "his");
  assert.equal(normalizeSkill("Расследование"), "inv");
  assert.equal(normalizeSkill("nope"), null);
});

test("abilities map by name and clamp to 1..30", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.abilities.int.value, 17);
  assert.equal(u.system.abilities.str.value, 8);
  const clamped = buildCharacterActorUpdate({ strength: 99, charisma: 0 });
  assert.equal(clamped.system.abilities.str.value, 30);
  assert.equal(clamped.system.abilities.cha.value, 1);
});

test("save proficiencies set ability.proficient", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.abilities.int.proficient, 1);
  assert.equal(u.system.abilities.wis.proficient, 1);
  assert.equal(u.system.abilities.str.proficient, 0);
});

test("skills: proficiency 1, expertise 2, keyed by dnd5e code", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.skills.arc.value, 1);
  assert.equal(u.system.skills.his.value, 1);
  assert.equal(u.system.skills.inv.value, 2); // expertise overrides
});

test("hp / speed / death / inspiration / exhaustion map correctly", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.attributes.hp.value, 22);
  assert.equal(u.system.attributes.hp.max, 27);
  assert.equal(u.system.attributes.movement.walk, 30);
  assert.equal(u.system.attributes.movement.units, "ft");
  assert.deepEqual(u.system.attributes.death, { success: 1, failure: 2 });
  assert.equal(u.system.attributes.inspiration, true);
  assert.equal(u.system.attributes.exhaustion, 1);
});

test("AC is NOT overridden by default, but is when overrideAc=true", () => {
  const off = buildCharacterActorUpdate(CHAR);
  assert.equal(off.system.attributes.ac, undefined);
  const on = buildCharacterActorUpdate(CHAR, { overrideAc: true });
  assert.deepEqual(on.system.attributes.ac, { calc: "flat", flat: 15 });
});

test("currency copies only valid dnd5e keys (drops xp)", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.deepEqual(u.system.currency, { gp: 25, sp: 4, cp: 0 });
  assert.equal("xp" in u.system.currency, false);
});

test("details: alignment free text + clamped level", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.details.alignment, "Нейтрально-добрый");
  assert.equal(u.system.details.level, 5);
  assert.equal(buildCharacterActorUpdate({ level: 99 }).system.details.level, 20);
});

test("biography rolls up proficiencies/languages/equipment/notes + site link", () => {
  const html = buildBiographyHtml(CHAR);
  assert.match(html, /Владения/);
  assert.match(html, /эльфийский/);
  assert.match(html, /древние тайны/);
  assert.match(html, /rebreya\.com\/characters\/7/);
});

test("empty character degrades to safe defaults, never throws", () => {
  const u = buildCharacterActorUpdate({});
  assert.equal(u.name, "Персонаж Ребреи");
  assert.equal(u.system.abilities.str.value, 10);
  assert.equal(u.system.attributes.inspiration, false);
  assert.equal(u.system.skills, undefined);
  assert.equal(u.system.currency, undefined);
});

test("identity flags stamp site linkage", () => {
  const flags = buildSiteCharacterFlags(CHAR, { ownerUserId: "u1" });
  const f = flags["rebreya-main"].siteCharacter;
  assert.equal(f.id, 7);
  assert.equal(f.lastSyncHash, "sha256:xyz");
  assert.equal(f.lastSiteUpdatedAt, "2026-07-03T12:00:00Z");
  assert.equal(f.ownerUserId, "u1");
  assert.equal(f.syncMode, "manual-state-push");
});
