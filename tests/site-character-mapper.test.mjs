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

// Exactly what the site's own form/sheet write (Frontend CharacterForm.tsx,
// CharacterSheet.tsx, lib/dnd.ts SKILLS): free-text speed, RU skill labels,
// {successes, failures} death saves.
const SITE_CHAR = {
  ...CHAR,
  speed: "30 футов",
  data: {
    saveProficiencies: ["intelligence", "wisdom"],
    skillProficiencies: ["Анализ", "Магия", "История", "Уход за животными"],
    skillExpertise: [],
    deathSaves: { successes: 2, failures: 1 },
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

test("details: alignment free text; level is left to class Items", () => {
  const u = buildCharacterActorUpdate(CHAR);
  assert.equal(u.system.details.alignment, "Нейтрально-добрый");
  assert.equal("level" in u.system.details, false);
});

test("site max_hp 0 (not filled) leaves hp.max for dnd5e to compute", () => {
  const u = buildCharacterActorUpdate({ ...CHAR, maxHp: 0 });
  assert.equal("max" in u.system.attributes.hp, false);
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

import { buildStatePatch } from "../scripts/data/site-character-mapper.js";

const SYSTEM = {
  attributes: {
    hp: { value: 12, max: 27 },
    death: { success: 1, failure: 2 },
    inspiration: true,
    exhaustion: 3,
  },
  spells: { spell1: { value: 1, max: 4 }, spell2: { value: 0, max: 3 }, spell3: { value: 2, max: 2 } },
  currency: { gp: 30, sp: 5, cp: 0, xp: 999 },
};

test("buildStatePatch extracts hp/death/inspiration/exhaustion", () => {
  const p = buildStatePatch(SYSTEM);
  assert.equal(p.currentHp, 12);
  assert.equal(p.maxHp, 27);
  assert.deepEqual(p.deathSaves, { successes: 1, failures: 2 });
  assert.equal(p.inspiration, true);
  assert.equal(p.exhaustion, 3);
});

test("buildStatePatch computes spent slots (max-value) per level", () => {
  const p = buildStatePatch(SYSTEM);
  assert.deepEqual(p.usedSlots, { 1: 3, 2: 3, 3: 0 });
});

test("buildStatePatch copies only valid currency keys", () => {
  const p = buildStatePatch(SYSTEM);
  assert.deepEqual(p.currency, { gp: 30, sp: 5, cp: 0 });
  assert.equal("xp" in p.currency, false);
});

test("buildStatePatch carries conditions + clientSync provenance", () => {
  const p = buildStatePatch(SYSTEM, { statuses: ["poisoned", "prone"], moduleVersion: "1.4.84", actorUuid: "Actor.x", previousHash: "sha256:old" });
  assert.deepEqual(p.conditions, ["otravlennyy", "sbityy-s-nog"]); // site catalogue slugs
  assert.equal(p.clientSync.source, "foundry");
  assert.equal(p.clientSync.moduleVersion, "1.4.84");
  assert.equal(p.clientSync.actorUuid, "Actor.x");
  assert.equal(p.clientSync.previousHash, "sha256:old");
});

test("buildStatePatch on an empty system degrades safely", () => {
  const p = buildStatePatch({});
  assert.equal(p.currentHp, undefined);
  assert.equal(p.usedSlots, undefined);
  assert.equal(p.clientSync.source, "foundry");
});

import { detectStateConflict, buildActorStateUpdate } from "../scripts/data/site-character-mapper.js";

test("detectStateConflict: differing hashes conflict, matching / missing do not", () => {
  assert.equal(detectStateConflict("sha256:b", "sha256:a"), true);
  assert.equal(detectStateConflict("sha256:a", "sha256:a"), false);
  assert.equal(detectStateConflict("sha256:b", ""), false); // never acknowledged → no conflict
  assert.equal(detectStateConflict("", "sha256:a"), false); // site has no state → no conflict
  assert.equal(detectStateConflict(null, null), false);
});

test("buildActorStateUpdate is the reverse of buildStatePatch for scalar state", () => {
  const state = {
    currentHp: 8, maxHp: 27,
    deathSaves: { success: 2, failure: 1 },
    inspiration: true, exhaustion: 4,
    currency: { gp: 12, sp: 3, xp: 999 },
    stateHash: "sha256:x",
  };
  const { system } = buildActorStateUpdate(state);
  assert.equal(system.attributes.hp.value, 8);
  assert.equal(system.attributes.hp.max, 27);
  assert.deepEqual(system.attributes.death, { success: 2, failure: 1 });
  assert.equal(system.attributes.inspiration, true);
  assert.equal(system.attributes.exhaustion, 4);
  assert.deepEqual(system.currency, { gp: 12, sp: 3 }); // xp dropped
});

test("buildActorStateUpdate clamps and degrades safely on empty state", () => {
  assert.deepEqual(buildActorStateUpdate({}), { system: {} });
  const { system } = buildActorStateUpdate({ exhaustion: 99, deathSaves: { success: 9, failure: -1 } });
  assert.equal(system.attributes.exhaustion, 10);
  assert.deepEqual(system.attributes.death, { success: 3, failure: 0 });
});

import { readUsedSlots } from "../scripts/data/site-character-mapper.js";

test("site-format character: RU sheet skill labels, free-text speed, {successes,failures}", () => {
  const u = buildCharacterActorUpdate(SITE_CHAR);
  assert.deepEqual(Object.keys(u.system.skills).sort(), ["ani", "arc", "his", "inv"]);
  assert.equal(u.system.attributes.movement.walk, 30);
  assert.deepEqual(u.system.attributes.death, { success: 2, failure: 1 });
});

test("buildActorStateUpdate reads the site's {successes, failures} death saves", () => {
  const { system } = buildActorStateUpdate({ deathSaves: { successes: 2, failures: 1 } });
  assert.deepEqual(system.attributes.death, { success: 2, failure: 1 });
});

test("readUsedSlots accepts site keys (\"1\") and legacy keys (\"spell1\")", () => {
  assert.deepEqual(readUsedSlots({ 1: 2, 3: "1" }), { 1: 2, 3: 1 });
  assert.deepEqual(readUsedSlots({ spell2: 1 }), { 2: 1 });
  assert.deepEqual(readUsedSlots(null), {});
});

import { buildSlotValueUpdate } from "../scripts/data/site-character-mapper.js";

test("buildSlotValueUpdate: max − site spent; fillMissing fills fresh class slots (dnd5e leaves value 0)", () => {
  const spells = { spell1: { max: 4, value: 0 }, spell2: { max: 3, value: 0 }, spell3: { max: 2, value: 0 }, spell4: { max: 0, value: 0 } };
  assert.deepEqual(buildSlotValueUpdate(spells, { 1: 1 }, { fillMissing: true }), {
    spell1: { value: 3 }, spell2: { value: 3 }, spell3: { value: 2 },
  });
  assert.deepEqual(buildSlotValueUpdate(spells, { spell2: 5 }), { spell2: { value: 0 } }); // legacy key, clamped, no fill
  assert.deepEqual(buildSlotValueUpdate({}, {}, { fillMissing: true }), {});
});
