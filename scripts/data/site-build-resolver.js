/**
 * Site character build → dnd5e Item plan (class / subclass / race / background).
 *
 * Pure functions — no Foundry globals — so the mapping and the advancement
 * bookkeeping are unit tested. The Foundry side (compendium lookups, document
 * creation) lives in integrations/site-build-importer.js.
 *
 * Why this exists: dnd5e derives a character's level, proficiency bonus, hit
 * dice and spell slots from embedded `class` Items (dnd5e.mjs CharacterData
 * prepareBaseData: `details.level = 0` then sums class levels). Without them an
 * imported Actor is level 0 with +1 proficiency and no features.
 *
 * Content sources:
 *  - The site stores dnd.su slugs for official content ("105-wizard") and
 *    transliterated slugs for Rebreya content ("volshebnik").
 *  - We match against the dnd5e system SRD packs (2014 rules — the site carries
 *    the PHB 2014 translation): dnd5e.classes / subclasses / races / backgrounds.
 *  - Anything without an SRD match gets a placeholder Item so the sheet still
 *    shows the right name, level and hit die; the import reports it.
 */

/** dnd5e system packs searched, in order, per item kind. */
export const SRD_PACKS = {
  class: ["dnd5e.classes"],
  subclass: ["dnd5e.subclasses"],
  race: ["dnd5e.races"],
  background: ["dnd5e.backgrounds"],
};

export const stripSlugPrefix = (slug) => String(slug ?? "").trim().toLowerCase().replace(/^\d+-/u, "");

const norm = (value) =>
  String(value ?? "")
    .replace(/ /gu, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ");

/** dnd.su class slug suffix → SRD class identifier (only the 12 SRD classes). */
const SRD_CLASS_IDS = new Set([
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
]);

/**
 * Rebreya-mode class slugs. Most are setting lore pages for a standard class
 * (empty mechanics on the site), so they use the SRD class. Reworks/variants are
 * flagged so the import warns that the SRD features may differ.
 */
const REBREYA_CLASS_MAP = {
  volshebnik: { identifier: "wizard" },
  voin: { identifier: "fighter" },
  bard: { identifier: "bard" },
  druid: { identifier: "druid" },
  zhrets: { identifier: "cleric" },
  koldun: { identifier: "warlock" },
  paladin: { identifier: "paladin" },
  plut: { identifier: "rogue" },
  charodey: { identifier: "sorcerer" },
  "varvar-revork": { identifier: "barbarian", variant: true },
  "monah-revork": { identifier: "monk", variant: true },
  "eger-sledopyt": { identifier: "ranger", variant: true },
};

/** Hit die by class identifier, for placeholder classes (site: lib/dnd.ts HIT_DIE_BY_CLASS). */
const HIT_DIE_BY_IDENTIFIER = {
  barbarian: "d12",
  fighter: "d10", paladin: "d10", ranger: "d10",
  bard: "d8", cleric: "d8", druid: "d8", monk: "d8", rogue: "d8", warlock: "d8", artificer: "d8",
  sorcerer: "d6", wizard: "d6",
};

/** Site (RU, PHB-2014 translation) subclass names that exist in the SRD packs. */
const SRD_SUBCLASS_BY_NAME = {
  "путь берсерка": "path-of-the-berserker",
  "коллегия знаний": "college-of-lore",
  "домен жизни": "life-domain",
  "круг земли": "circle-of-the-land",
  "чемпион": "champion",
  "путь открытой ладони": "way-of-the-open-hand",
  "клятва преданности": "oath-of-devotion",
  "охотник": "hunter",
  "вор": "thief",
  "наследие драконьей крови": "draconic-bloodline",
  "исчадие": "the-fiend",
  "школа воплощения": "school-of-evocation",
};

/**
 * Official (dnd-5e mode) race slug suffix → SRD race identifier. Elf, dwarf,
 * gnome and halfling only have one subrace in the SRD; `assumedSubrace` makes
 * the import say so.
 */
const SRD_RACE_BY_SLUG = {
  human: { identifier: "human" },
  "half-elf": { identifier: "half-elf" },
  "half-orc": { identifier: "half-orc" },
  tiefling: { identifier: "tiefling" },
  dragonborn: { identifier: "dragonborn" },
  elf: { identifier: "high-elf", assumedSubrace: true },
  dwarf: { identifier: "hill-dwarf", assumedSubrace: true },
  gnome: { identifier: "rock-gnome", assumedSubrace: true },
  halfling: { identifier: "lightfoot-halfling", assumedSubrace: true },
};

const SRD_BACKGROUND_BY_SLUG = { acolyte: "acolyte" };

/** A slug that looks like a dnd.su (official) entry: "105-wizard". */
const isOfficialSlug = (slug) => /^\d+-/u.test(String(slug ?? "").trim());

const TRANSLIT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Turn a free-form name/slug into a dnd5e identifier. dnd5e only accepts
 * [a-z0-9_-] (an invalid one makes Foundry silently drop the Item from a batch),
 * so Cyrillic is transliterated.
 */
export function toIdentifier(value, fallback = "item") {
  const latin = [...stripSlugPrefix(value)].map((ch) => TRANSLIT[ch] ?? ch).join("");
  const id = latin.replace(/[^a-z0-9_-]+/gu, "-").replace(/-{2,}/gu, "-").replace(/^-+|-+$/gu, "");
  return id || fallback;
}

/**
 * Resolve a site class (slug + RU name) to an SRD identifier.
 * @returns {{identifier:string, srd:boolean, variant:boolean}}
 */
export function resolveClass(classSlug, className = "") {
  const raw = String(classSlug ?? "").trim().toLowerCase();
  const suffix = stripSlugPrefix(raw);
  if (isOfficialSlug(raw) && SRD_CLASS_IDS.has(suffix)) {
    return { identifier: suffix, srd: true, variant: false };
  }
  const rebreya = REBREYA_CLASS_MAP[raw];
  if (rebreya) return { identifier: rebreya.identifier, srd: true, variant: Boolean(rebreya.variant) };
  return { identifier: toIdentifier(suffix || className, "class"), srd: false, variant: false };
}

/** @returns {string|null} SRD subclass identifier for a site subclass name. */
export function resolveSubclass(subclassName) {
  return SRD_SUBCLASS_BY_NAME[norm(subclassName)] ?? null;
}

/** @returns {{identifier:string, assumedSubrace:boolean}|null} */
export function resolveRace(raceSlug) {
  const raw = String(raceSlug ?? "").trim().toLowerCase();
  if (!isOfficialSlug(raw)) return null; // Rebreya races carry their own traits
  return SRD_RACE_BY_SLUG[stripSlugPrefix(raw)] ?? null;
}

/** @returns {string|null} */
export function resolveBackground(backgroundSlug) {
  const raw = String(backgroundSlug ?? "").trim().toLowerCase();
  if (!isOfficialSlug(raw)) return null;
  return SRD_BACKGROUND_BY_SLUG[stripSlugPrefix(raw)] ?? null;
}

export function hitDieFor(identifier) {
  return HIT_DIE_BY_IDENTIFIER[identifier] ?? null;
}

const clampLevel = (value) => Math.max(1, Math.min(20, Math.trunc(Number(value)) || 1));

/**
 * Everything the importer needs to create, derived from the site record.
 * The site's `level` is the primary class level; `data.multiclass[]` adds
 * further classes (site CharacterSheet.tsx: total = level + Σ multiclass).
 */
export function resolveBuildPlan(character = {}) {
  const data = character.data ?? {};
  const classes = [];
  const pushClass = (slug, name, level, subclass, primary) => {
    if (!String(slug ?? "").trim() && !String(name ?? "").trim()) return;
    const resolved = resolveClass(slug, name);
    const subName = String(subclass ?? "").trim();
    classes.push({
      slug: String(slug ?? ""),
      name: String(name ?? "").trim(),
      level: clampLevel(level),
      primary,
      ...resolved,
      subclass: subName ? { name: subName, identifier: resolved.srd ? resolveSubclass(subName) : null } : null,
    });
  };
  pushClass(character.classSlug, character.gameClass, character.level, character.subclass, true);
  for (const extra of Array.isArray(data.multiclass) ? data.multiclass : []) {
    pushClass(extra?.classSlug, extra?.gameClass, extra?.level, extra?.subclass, false);
  }

  // dnd5e caps total level at 20; trim the last classes if the site exceeds it.
  let remaining = 20;
  for (const cls of classes) {
    cls.level = Math.min(cls.level, remaining);
    remaining -= cls.level;
  }
  const kept = classes.filter((c) => c.level > 0);

  const raceName = String(character.race ?? "").trim();
  const race = raceName || character.raceSlug
    ? { slug: String(character.raceSlug ?? ""), name: raceName, ...(resolveRace(character.raceSlug) ?? { identifier: null, assumedSubrace: false }) }
    : null;
  const backgroundName = String(character.background ?? "").trim();
  const background = backgroundName || character.backgroundSlug
    ? { slug: String(character.backgroundSlug ?? ""), name: backgroundName, identifier: resolveBackground(character.backgroundSlug) }
    : null;

  return {
    classes: kept,
    totalLevel: kept.reduce((sum, c) => sum + c.level, 0),
    race,
    background,
  };
}

/**
 * Non-optional ItemGrant entries an item's advancement hands out up to `level`
 * (what dnd5e's AdvancementManager would apply automatically). Optional grants
 * and choices are left for the player.
 * @param {object} itemData item source (toObject())
 * @param {number} level class level, or 0+ for race/background
 * @returns {{advancementId:string, uuids:string[]}[]}
 */
export function collectGrants(itemData, level) {
  const out = [];
  for (const adv of itemData?.system?.advancement ?? []) {
    if (adv?.type !== "ItemGrant") continue;
    const advLevel = Number(adv.level ?? 0) || 0;
    if (advLevel > level) continue;
    const config = adv.configuration ?? {};
    if (config.optional) continue;
    const uuids = (config.items ?? []).filter((i) => i?.uuid && !i.optional).map((i) => i.uuid);
    if (uuids.length) out.push({ advancementId: adv._id, uuids });
  }
  return out;
}

/**
 * HitPoints advancement value: max at the character's very first level (the
 * primary class), average for every other level — multiclass level 1 included.
 */
export function hitPointsValue(level, { primary = true } = {}) {
  const value = {};
  for (let lvl = 1; lvl <= clampLevel(level); lvl += 1) value[String(lvl)] = lvl === 1 && primary ? "max" : "avg";
  return value;
}

/** Level at which a class's Subclass advancement triggers (null if none). */
export function subclassLevel(classData) {
  const adv = (classData?.system?.advancement ?? []).find((a) => a?.type === "Subclass");
  return adv ? Number(adv.level ?? 0) || 0 : null;
}

/** Single fixed size granted by a race's Size advancement, else null. */
export function raceSize(raceData) {
  const adv = (raceData?.system?.advancement ?? []).find((a) => a?.type === "Size");
  const sizes = adv?.configuration?.sizes ?? [];
  return sizes.length === 1 ? { advancementId: adv._id, size: sizes[0] } : null;
}

/**
 * Write advancement bookkeeping into an item source in place, so dnd5e treats
 * the import as if its AdvancementManager had applied it.
 * @param {object} itemData item source
 * @param {Record<string, Record<string,string>>} grantedByAdvancement advId → {itemId: uuid}
 * @param {object} [extra] advId → value object merged as-is (HitPoints/Subclass/Size)
 */
export function applyAdvancementValues(itemData, grantedByAdvancement = {}, extra = {}) {
  for (const adv of itemData?.system?.advancement ?? []) {
    if (grantedByAdvancement[adv._id]) {
      adv.value = { ...(adv.value ?? {}), added: { ...(adv.value?.added ?? {}), ...grantedByAdvancement[adv._id] } };
    }
    if (extra[adv._id]) adv.value = { ...(adv.value ?? {}), ...extra[adv._id] };
  }
  return itemData;
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");

/**
 * Minimal Item source for content with no SRD match (Rebreya races, homebrew
 * subclasses, non-SRD classes). Keeps name/level/hit die so dnd5e derives level,
 * proficiency and hit dice; features stay on the site page.
 */
export function buildPlaceholderItem(kind, { name, identifier, level = 1, hitDie = null, classIdentifier = null, description = "", siteUrl = "" } = {}) {
  const parts = [];
  if (description) parts.push(`<p>${escapeHtml(description).replace(/\n+/gu, "</p><p>")}</p>`);
  if (siteUrl) parts.push(`<p><em><a href="${escapeHtml(siteUrl)}">Описание на rebreya.com</a></em></p>`);
  const system = { description: { value: parts.join("") }, identifier: toIdentifier(identifier || name, kind) };
  if (kind === "class") {
    system.levels = clampLevel(level);
    system.hd = { denomination: hitDie ?? "d8", spent: 0 };
  }
  if (kind === "subclass") system.classIdentifier = classIdentifier ?? "";
  return { name: String(name ?? "").trim() || kind, type: kind, system };
}
