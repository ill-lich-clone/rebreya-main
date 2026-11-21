/**
 * Site character record → dnd5e Actor update data (dnd5e 5.x, Foundry 13).
 *
 * Pure functions — no Foundry imports — so the whole mapping is unit tested.
 * Produces a partial `{ name, system, flags }` object suitable for
 * `actor.update(...)`. Embedded items (race/class/background/spells) are handled
 * separately by the sync service (they need compendium lookups); this file owns
 * the scalar build: abilities, hp, speed, saves, skills, currency, status.
 *
 * AC is NEVER overwritten unless `overrideAc` is set — the site sends only a
 * final number and dnd5e computes AC from armor, so a silent override would be
 * wrong (integration ТЗ §8.2).
 */

const ABILITY_BY_ALIAS = {};
for (const [code, aliases] of Object.entries({
  str: ["str", "strength", "сила"],
  dex: ["dex", "dexterity", "ловкость"],
  con: ["con", "constitution", "телосложение"],
  int: ["int", "intelligence", "интеллект"],
  wis: ["wis", "wisdom", "мудрость"],
  cha: ["cha", "charisma", "харизма"],
})) {
  for (const alias of aliases) ABILITY_BY_ALIAS[alias] = code;
}

const SKILL_BY_ALIAS = {};
for (const [code, aliases] of Object.entries({
  acr: ["acr", "acrobatics", "акробатика"],
  ani: ["ani", "animal handling", "обращение с животными", "уход за животными"],
  arc: ["arc", "arcana", "тайная магия", "магия"],
  ath: ["ath", "athletics", "атлетика"],
  dec: ["dec", "deception", "обман"],
  his: ["his", "history", "история"],
  ins: ["ins", "insight", "проницательность"],
  itm: ["itm", "intimidation", "запугивание"],
  inv: ["inv", "investigation", "расследование", "анализ"],
  med: ["med", "medicine", "медицина"],
  nat: ["nat", "nature", "природа"],
  prc: ["prc", "perception", "восприятие"],
  prf: ["prf", "performance", "выступление"],
  per: ["per", "persuasion", "убеждение"],
  rel: ["rel", "religion", "религия"],
  slt: ["slt", "sleight of hand", "ловкость рук"],
  ste: ["ste", "stealth", "скрытность"],
  sur: ["sur", "survival", "выживание"],
})) {
  for (const alias of aliases) SKILL_BY_ALIAS[alias] = code;
}

const CURRENCY_KEYS = ["pp", "gp", "ep", "sp", "cp"];

const norm = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е"); // ё → е

export function normalizeAbility(value) {
  return ABILITY_BY_ALIAS[norm(value)] ?? null;
}

export function normalizeSkill(value) {
  return SKILL_BY_ALIAS[norm(value)] ?? null;
}

const toInt = (value, fallback = null) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/** Leading integer of a free-text value ("30 футов" → 30); null if none. */
const leadingInt = (value) => {
  if (typeof value === "number") return toInt(value);
  const match = String(value ?? "").match(/-?\d+/u);
  return match ? toInt(match[0]) : null;
};

/**
 * Death saves arrive as `{successes, failures}` from the site's own sheet
 * (Frontend CharacterSheet.tsx) and as `{success, failure}` from older pushes.
 */
const readDeathSaves = (raw) => ({
  success: Math.max(0, Math.min(3, toInt(raw?.successes ?? raw?.success, 0) ?? 0)),
  failure: Math.max(0, Math.min(3, toInt(raw?.failures ?? raw?.failure, 0) ?? 0)),
});

/**
 * Spent slots per level. The site keys them by bare level ("1".."9"); early
 * module pushes used "spell1".."spell9". Returns {1..9: n} for present levels.
 */
export function readUsedSlots(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (let level = 1; level <= 9; level += 1) {
    const v = toInt(raw[level] ?? raw[String(level)] ?? raw[`spell${level}`]);
    if (v != null) out[level] = Math.max(0, v);
  }
  return out;
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

/** Roll free-text fields (proficiencies/languages/equipment/notes) into a biography. */
export function buildBiographyHtml(character, { baseUrl = "https://rebreya.com" } = {}) {
  const sections = [
    ["Владения", character.proficiencies],
    ["Языки", character.languages],
    ["Снаряжение", character.equipment],
    ["Заметки", character.notes],
  ];
  const parts = [];
  for (const [label, value] of sections) {
    const text = String(value ?? "").trim();
    if (text) parts.push(`<p><strong>${label}.</strong> ${escapeHtml(text).replace(/\n/gu, "<br>")}</p>`);
  }
  if (character.slug || character.id != null) {
    const url = `${baseUrl}/characters/${character.id ?? ""}`;
    parts.push(`<p><em><a href="${url}">Открыть персонажа на сайте</a></em></p>`);
  }
  return parts.join("");
}

/**
 * @param {object} character site character record
 * @param {object} [opts]
 * @param {boolean} [opts.overrideAc=false] set a flat AC from the site value
 * @param {boolean} [opts.includeBiography=true]
 * @returns {{name:string, system:object}} partial Actor update
 */
export function buildCharacterActorUpdate(character = {}, opts = {}) {
  const { overrideAc = false, includeBiography = true, baseUrl = "https://rebreya.com" } = opts;
  const data = character.data ?? {};

  const abilities = {};
  const abilityFields = {
    str: character.strength, dex: character.dexterity, con: character.constitution,
    int: character.intelligence, wis: character.wisdom, cha: character.charisma,
  };
  for (const [code, raw] of Object.entries(abilityFields)) {
    const value = toInt(raw);
    abilities[code] = { value: value == null ? 10 : Math.max(1, Math.min(30, value)), proficient: 0 };
  }
  // Saving-throw proficiencies.
  for (const entry of Array.isArray(data.saveProficiencies) ? data.saveProficiencies : []) {
    const code = normalizeAbility(entry);
    if (code && abilities[code]) abilities[code].proficient = 1;
  }

  // Skills: proficiency 1, expertise 2.
  const skills = {};
  for (const entry of Array.isArray(data.skillProficiencies) ? data.skillProficiencies : []) {
    const code = normalizeSkill(entry);
    if (code) skills[code] = { value: 1 };
  }
  for (const entry of Array.isArray(data.skillExpertise) ? data.skillExpertise : []) {
    const code = normalizeSkill(entry);
    if (code) skills[code] = { value: 2 };
  }

  const hpMax = toInt(character.maxHp);
  const hpValue = toInt(character.currentHp);
  const speed = leadingInt(character.speed);

  const attributes = {
    hp: {
      ...(hpValue != null ? { value: hpValue } : {}),
      ...(hpMax != null ? { max: hpMax } : {}),
    },
    movement: { ...(speed != null ? { walk: speed } : {}), units: "ft" },
    death: readDeathSaves(data.deathSaves),
    inspiration: Boolean(data.inspiration),
    exhaustion: Math.max(0, Math.min(10, toInt(data.exhaustion, 0) ?? 0)),
  };
  if (overrideAc) {
    const ac = toInt(character.armorClass);
    if (ac != null) attributes.ac = { calc: "flat", flat: ac };
  }

  const currency = {};
  const srcCurrency = data.currency ?? {};
  for (const key of CURRENCY_KEYS) {
    const v = toInt(srcCurrency[key]);
    if (v != null) currency[key] = Math.max(0, v);
  }

  const details = {
    ...(character.alignment ? { alignment: String(character.alignment).trim() } : {}),
    ...(toInt(character.level) != null ? { level: Math.max(1, Math.min(20, toInt(character.level))) } : {}),
  };
  if (includeBiography) {
    const bio = buildBiographyHtml(character, { baseUrl });
    if (bio) details.biography = { value: bio };
  }

  const system = { abilities, attributes, details };
  if (Object.keys(skills).length) system.skills = skills;
  if (Object.keys(currency).length) system.currency = currency;

  return { name: String(character.name ?? "").trim() || "Персонаж Ребреи", system };
}

/** Identity flags stamped on the linked Actor (integration ТЗ §8.1). */
export function buildSiteCharacterFlags(character = {}, { moduleId = "rebreya-main", baseUrl = "https://rebreya.com", syncMode = "manual-state-push", ownerUserId = "" } = {}) {
  return {
    [moduleId]: {
      siteCharacter: {
        baseUrl,
        id: character.id ?? null,
        slug: character.slug ?? "",
        lastSyncAt: new Date().toISOString(),
        lastSiteUpdatedAt: character.updated_at ?? character.updatedAt ?? "",
        lastSyncHash: character.content_hash ?? "",
        syncMode,
        ownerUserId,
      },
    },
  };
}

/**
 * Extract the mutable in-session state from a dnd5e Actor's system data into the
 * shape the site's PATCH /characters/{id}/state/ endpoint accepts (Foundry →
 * site push, ТЗ §9.2). Pure over `system` + an optional list of active status
 * ids, so it is unit tested with a fake system object.
 */
export function buildStatePatch(system = {}, { statuses = [], moduleId = "rebreya-main", moduleVersion = "", actorUuid = "", previousHash = "" } = {}) {
  const attrs = system.attributes ?? {};
  const patch = {};

  if (attrs.hp) {
    if (attrs.hp.value != null) patch.currentHp = toInt(attrs.hp.value, 0) ?? 0;
    if (attrs.hp.max != null) patch.maxHp = Math.max(0, toInt(attrs.hp.max, 0) ?? 0);
  }
  if (attrs.death) {
    // Site sheet format (Frontend CharacterSheet.tsx): {successes, failures}.
    patch.deathSaves = {
      successes: Math.max(0, Math.min(3, toInt(attrs.death.success, 0) ?? 0)),
      failures: Math.max(0, Math.min(3, toInt(attrs.death.failure, 0) ?? 0)),
    };
  }
  if ("inspiration" in attrs) patch.inspiration = Boolean(attrs.inspiration);
  if ("exhaustion" in attrs) patch.exhaustion = Math.max(0, Math.min(10, toInt(attrs.exhaustion, 0) ?? 0));

  // Spent spell slots per level: dnd5e stores {value=available, max}; used = max-value.
  // Keyed by bare level ("1".."9") — the format the site's sheet reads.
  const spells = system.spells ?? {};
  const usedSlots = {};
  for (let level = 1; level <= 9; level += 1) {
    const slot = spells[`spell${level}`];
    if (slot && Number(slot.max) > 0) {
      usedSlots[String(level)] = Math.max(0, (toInt(slot.max, 0) ?? 0) - (toInt(slot.value, 0) ?? 0));
    }
  }
  if (Object.keys(usedSlots).length) patch.usedSlots = usedSlots;

  const currency = {};
  for (const key of CURRENCY_KEYS) {
    const v = toInt(system.currency?.[key]);
    if (v != null) currency[key] = Math.max(0, v);
  }
  if (Object.keys(currency).length) patch.currency = currency;

  if (Array.isArray(statuses) && statuses.length) patch.conditions = [...statuses];

  patch.clientSync = {
    source: "foundry",
    moduleId,
    moduleVersion,
    actorUuid,
    ...(previousHash ? { previousHash } : {}),
  };
  return patch;
}

/**
 * Conflict test for the state push (integration ТЗ §9.3): the site's current
 * `stateHash` differs from the one we last acknowledged, i.e. someone changed
 * the site character since our last sync. No baseline (never pushed) or the site
 * has no state yet → not a conflict, the push proceeds.
 * @param {string} remoteHash the site's current stateHash
 * @param {string} lastStateHash the stateHash this Actor last acknowledged
 */
export function detectStateConflict(remoteHash, lastStateHash) {
  const remote = String(remoteHash ?? "").trim();
  const known = String(lastStateHash ?? "").trim();
  if (!remote || !known) return false;
  return remote !== known;
}

/**
 * Reverse of buildStatePatch: the site's mutable state → a dnd5e Actor `system`
 * update, for «Принять сайт» (pull the fresher site state into Foundry, ТЗ
 * §9.3). Pure over the state object — spell slots (need the Actor's slot max)
 * and conditions (need status-effect toggles) are applied by the service.
 */
export function buildActorStateUpdate(state = {}) {
  const attributes = {};
  if (state.currentHp != null || state.maxHp != null) {
    attributes.hp = {
      ...(state.currentHp != null ? { value: Math.max(0, toInt(state.currentHp, 0) ?? 0) } : {}),
      ...(state.maxHp != null ? { max: Math.max(0, toInt(state.maxHp, 0) ?? 0) } : {}),
    };
  }
  if (state.deathSaves) attributes.death = readDeathSaves(state.deathSaves);
  if ("inspiration" in state) attributes.inspiration = Boolean(state.inspiration);
  if ("exhaustion" in state) attributes.exhaustion = Math.max(0, Math.min(10, toInt(state.exhaustion, 0) ?? 0));

  const currency = {};
  for (const key of CURRENCY_KEYS) {
    const v = toInt(state.currency?.[key]);
    if (v != null) currency[key] = Math.max(0, v);
  }

  const system = {};
  if (Object.keys(attributes).length) system.attributes = attributes;
  if (Object.keys(currency).length) system.currency = currency;
  return { system };
}

export { CURRENCY_KEYS };
