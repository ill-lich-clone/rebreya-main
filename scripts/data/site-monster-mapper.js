/**
 * Site bestiary record → dnd5e Actor "npc" data (dnd5e 5.x, Foundry 13).
 *
 * Pure functions only — no Foundry imports — so the whole mapping is unit
 * tested under `node --test`. Acceptance bar (integration ТЗ §7.6): the produced
 * Actor must open in the standard dnd5e NPC sheet without errors. The clean
 * summary fields (armorClass / hitPoints / speed / challengeRating / type /
 * size / alignment) provide the reliable numbers; the `details` markdown is the
 * ONLY source of ability scores, senses, skills, saves and the traits/actions.
 * Anything we cannot parse degrades to biography / feat description text — never
 * to broken data.
 */
import { toHtmlParagraphs } from "./site-spell-mapper.js";

const clean = (value) => String(value ?? "").trim();

// RU creature type (first word) → dnd5e type code.
const TYPE_CODES = {
  "аберрация": "aberration",
  "зверь": "beast",
  "небожитель": "celestial",
  "конструкт": "construct",
  "дракон": "dragon",
  "элементаль": "elemental",
  "фея": "fey",
  "исчадие": "fiend",
  "великан": "giant",
  "гуманоид": "humanoid",
  "монстр": "monstrosity",
  "чудовище": "monstrosity",
  "слизь": "ooze",
  "растение": "plant",
  "нежить": "undead",
};

// RU size → dnd5e size code.
const SIZE_CODES = {
  "крошечный": "tiny",
  "маленький": "sm",
  "небольшой": "sm",
  "средний": "med",
  "большой": "lg",
  "огромный": "huge",
  "громадный": "grg",
  "исполинский": "grg",
};

// RU ability abbreviation (as dnd.su prints it) → dnd5e ability key.
const ABILITY_ABBR = [
  ["сил", "str"],
  ["лов", "dex"],
  ["тел", "con"],
  ["инт", "int"],
  ["мдр", "wis"],
  ["хар", "cha"],
];

// RU full ability name (used in the «Спасброски» line) → dnd5e key.
const ABILITY_FULL = [
  ["сила", "str"],
  ["ловкость", "dex"],
  ["телосложение", "con"],
  ["интеллект", "int"],
  ["мудрость", "wis"],
  ["харизма", "cha"],
];

// RU skill name → dnd5e skill code.
const SKILL_CODES = [
  ["акробатика", "acr"],
  ["уход за животными", "ani"],
  ["магия", "arc"],
  ["атлетика", "ath"],
  ["обман", "dec"],
  ["история", "his"],
  ["проницательность", "ins"],
  ["запугивание", "itm"],
  ["анализ", "inv"],
  ["расследование", "inv"],
  ["медицина", "med"],
  ["природа", "nat"],
  ["внимательность", "prc"],
  ["восприятие", "prc"],
  ["выступление", "prf"],
  ["убеждение", "per"],
  ["религия", "rel"],
  ["ловкость рук", "slt"],
  ["скрытность", "ste"],
  ["выживание", "sur"],
];

// Header labels we consume into structured fields; everything else on a
// «**Label:**» line falls through to the biography.
const KNOWN_HEADER_LABELS = new Set([
  "характеристики",
  "класс доспеха",
  "хиты",
  "скорость",
  "чувства",
  "навыки",
  "спасброски",
  "опасность",
  "иммунитет к урону",
  "иммунитеты к урону",
  "сопротивление урону",
  "сопротивление к урону",
  "уязвимость к урону",
  "уязвимость",
  "иммунитет к состоянию",
  "иммунитет к состояниям",
  "иммунитеты к состояниям",
  "языки",
  "бонус мастерства",
]);

export const DEFAULT_NPC_ICON = "icons/svg/mystery-man.svg";

/** «1/4» → 0.25, «1/8» → 0.125, «5» → 5, «0» → 0. */
export function parseChallengeRating(value) {
  const raw = clean(value);
  const frac = raw.match(/^(\d+)\s*\/\s*(\d+)/u);
  if (frac) {
    const denom = Number(frac[2]) || 1;
    return denom ? Number(frac[1]) / denom : 0;
  }
  const num = raw.match(/-?\d+(?:[.,]\d+)?/u);
  return num ? Number(num[0].replace(",", ".")) : 0;
}

/** «14 (природный доспех)» → 14; «12 (15 с доспехом мага)» → 12. */
export function parseArmorClass(value) {
  const m = clean(value).match(/\d+/u);
  return m ? Number(m[0]) : 10;
}

/** «88 ( 16к8 + 16 )» → { value: 88, formula: "16d8 + 16" }. */
export function parseHitPoints(value) {
  const raw = clean(value);
  const lead = raw.match(/\d+/u);
  const val = lead ? Number(lead[0]) : 0;
  const paren = raw.match(/\(([^)]*)\)/u);
  let formula = "";
  if (paren) {
    formula = paren[1]
      .replace(/к/gu, "d") // Cyrillic dice «к» → «d»
      .replace(/\s+/gu, " ")
      .trim();
  }
  return { value: val, formula };
}

const SPEED_MODES = [
  [/полёт|полет|лета/u, "fly"],
  [/плав/u, "swim"],
  [/лаз/u, "climb"],
  [/копа|рыть|роя/u, "burrow"],
];

/** «30 футов, полёт 50 футов» → { walk: 30, fly: 50, units: "ft", hover }. */
export function parseSpeed(value) {
  const raw = clean(value);
  const movement = { walk: 0, fly: 0, swim: 0, climb: 0, burrow: 0, hover: false, units: "ft" };
  if (!raw) return movement;
  const segments = raw.split(",");
  let walkAssigned = false;
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    const numMatch = lower.match(/\d+/u);
    const num = numMatch ? Number(numMatch[0]) : 0;
    if (lower.includes("парит") || lower.includes("парение")) movement.hover = true;
    let mode = null;
    for (const [re, key] of SPEED_MODES) {
      if (re.test(lower)) { mode = key; break; }
    }
    if (mode) {
      movement[mode] = num;
    } else if (!walkAssigned) {
      movement.walk = num;
      walkAssigned = true;
    }
  }
  return movement;
}

// Distinctive Cyrillic stems (JS \w does not match Cyrillic, so match by stem).
const SENSE_KEYS = [
  [/т[её]мн/u, "darkvision"],
  [/слеп/u, "blindsight"],
  [/вибрац/u, "tremorsense"],
  [/истинн/u, "truesight"],
];

/** «тёмное зрение 120 футов, пассивное Восприятие 11» → { darkvision: 120 }. */
export function parseSenses(value) {
  const senses = { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, units: "ft", special: "" };
  const raw = clean(value);
  if (!raw) return senses;
  const extras = [];
  for (const seg of raw.split(",")) {
    const lower = seg.toLowerCase();
    if (lower.includes("пассивн")) continue; // dnd5e derives passive perception
    const numMatch = lower.match(/\d+/u);
    const num = numMatch ? Number(numMatch[0]) : 0;
    let key = null;
    for (const [re, k] of SENSE_KEYS) {
      if (re.test(lower)) { key = k; break; }
    }
    if (key) senses[key] = num;
    else extras.push(clean(seg));
  }
  senses.special = extras.join(", ");
  return senses;
}

/** «Сил 16 (+3) · Лов 14 (+2) · …» → { str: 16, dex: 14, … }. */
export function parseAbilities(value) {
  const raw = clean(value);
  const out = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  if (!raw) return out;
  // dnd.su separates abilities with «·» / «•»; fall back to a positional split.
  const tokens = raw.split(/[·•]/u).map((t) => t.trim()).filter(Boolean);
  const positional = ["str", "dex", "con", "int", "wis", "cha"];
  tokens.forEach((token, index) => {
    const scoreMatch = token.match(/(-?\d+)/u);
    if (!scoreMatch) return;
    const score = Number(scoreMatch[1]);
    const lower = token.toLowerCase();
    const abbr = ABILITY_ABBR.find(([ru]) => lower.startsWith(ru));
    const key = abbr ? abbr[1] : positional[index];
    if (key) out[key] = score;
  });
  return out;
}

/** «Сила +6, Ловкость +6» → Set{ "str", "dex" } of proficient saves. */
export function parseSaveProficiencies(value) {
  const raw = clean(value).toLowerCase();
  const set = new Set();
  if (!raw) return set;
  for (const [ru, key] of ABILITY_FULL) {
    if (raw.includes(ru)) set.add(key);
  }
  return set;
}

/** «Атлетика +6, Восприятие +5» → Set{ "ath", "prc" } of proficient skills. */
export function parseSkillProficiencies(value) {
  const raw = clean(value).toLowerCase();
  const set = new Set();
  if (!raw) return set;
  for (const [ru, code] of SKILL_CODES) {
    if (raw.includes(ru)) set.add(code);
  }
  return set;
}

export function mapCreatureType(value) {
  const raw = clean(value).toLowerCase();
  const first = raw.replace(/\(.*$/u, "").trim().split(/\s+/u)[0] ?? "";
  return TYPE_CODES[first] ?? "";
}

export function mapSize(value) {
  const first = clean(value).toLowerCase().split(/\s+/u)[0] ?? "";
  return SIZE_CODES[first] ?? "med";
}

function sectionKind(title) {
  const lower = clean(title).toLowerCase();
  if (lower.includes("реакц")) return "reaction";
  if (lower.includes("легендарн")) return "legendary";
  if (lower.includes("логов")) return "lair";
  if (lower.includes("бонусн")) return "bonus";
  return "action";
}

/**
 * Parse the RU statblock markdown into { labels, traits, actions }.
 * labels: { «характеристики»: "…", … } (lower-cased keys, sans colon)
 * traits: [{ name, text }] — the «### …» special-ability blocks
 * actions: [{ section, name, text }] — «**Name.**» entries under «## …»
 */
export function parseStatblock(markdown) {
  const md = String(markdown ?? "");
  const labels = {};
  const traits = [];
  const actions = [];

  let currentSection = null; // null until the first «## …»
  let currentTrait = null;
  let currentAction = null;

  const flushTrait = () => {
    if (currentTrait) {
      traits.push({ name: currentTrait.name, text: currentTrait.lines.join("\n").trim() });
      currentTrait = null;
    }
  };
  const flushAction = () => {
    if (currentAction) {
      actions.push({
        section: currentSection?.kind ?? "action",
        name: currentAction.name,
        text: currentAction.lines.join("\n").trim(),
      });
      currentAction = null;
    }
  };

  for (const line of md.split(/\r?\n/u)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/u);
    if (h2) {
      flushTrait();
      flushAction();
      currentSection = { title: h2[1], kind: sectionKind(h2[1]) };
      currentTrait = null;
      continue;
    }
    const h3 = line.match(/^###\s+(.+?)\s*$/u);
    if (h3) {
      flushTrait();
      flushAction();
      currentTrait = { name: h3[1].trim(), lines: [] };
      continue;
    }
    // Header label «**Характеристики:**» (colon) — only before any section.
    if (currentSection === null && currentTrait === null) {
      const lbl = line.match(/^\*\*([^*]+?):\*\*\s*(.*)$/u);
      if (lbl) {
        labels[lbl[1].trim().toLowerCase()] = lbl[2].trim();
        continue;
      }
    }
    // Action entry «**Name.**» (period, optional) inside a «## …» section.
    if (currentSection) {
      const act = line.match(/^\*\*(.+?)\.?\*\*\s*(.*)$/u);
      if (act) {
        flushAction();
        currentAction = { name: act[1].trim().replace(/\.$/u, ""), lines: [act[2]] };
        continue;
      }
    }
    // Continuation of the current block.
    if (currentAction) currentAction.lines.push(line);
    else if (currentTrait) currentTrait.lines.push(line);
  }
  flushTrait();
  flushAction();

  return { labels, traits, actions };
}

/** slug «7056-venom_troll» → dnd5e identifier «venom-troll». */
export function buildIdentifier(record) {
  const slug = clean(record.slug).replace(/^\d+-/u, "");
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return safe || `site-monster-${record.id}`;
}

/** Folder name inside the pack, grouped by (localised) creature type. */
export function folderPathForType(record) {
  const raw = clean(record.type).replace(/\(.*$/u, "").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Прочее";
}

// Section → dnd5e activation type, so actions land on the right sheet tab.
const ACTIVATION_BY_SECTION = {
  action: "action",
  bonus: "bonus",
  reaction: "reaction",
  legendary: "legendary",
  lair: "lair",
};

function buildFeatItem(entry, { moduleId, kind }) {
  const activationType = ACTIVATION_BY_SECTION[kind];
  const system = {
    description: { value: toHtmlParagraphs(entry.text) },
    type: { value: "monster", subtype: "" },
  };
  // Best-effort activation; harmless if the running dnd5e schema ignores it.
  if (activationType) system.activation = { type: activationType, cost: 1, condition: "" };
  return {
    name: clean(entry.name) || "Способность",
    type: "feat",
    img: DEFAULT_NPC_ICON,
    system,
    flags: { [moduleId]: { managed: true, sourceType: "site-api", section: kind } },
  };
}

function buildBiographyHtml(record, labels, { baseUrl }) {
  const parts = [];
  const flavor = clean(record.description);
  if (flavor) parts.push(toHtmlParagraphs(flavor));
  // Any «**Label:**» line we did not fold into a structured field.
  for (const [label, value] of Object.entries(labels)) {
    if (KNOWN_HEADER_LABELS.has(label) || !value) continue;
    const title = label.charAt(0).toUpperCase() + label.slice(1);
    parts.push(`<p><strong>${title}:</strong> ${toHtmlParagraphs(value).replace(/^<p>|<\/p>$/gu, "")}</p>`);
  }
  const source = clean(record.source);
  const url = record.slug ? `${baseUrl}/dnd-5e/bestiary/${record.slug}` : "";
  const link = url ? ` · <a href="${url}">Открыть на сайте</a>` : "";
  if (source || link) parts.push(`<p><em>Источник: ${source || "rebreya.com"}</em>${link}</p>`);
  return parts.join("");
}

/**
 * Full mapping: site bestiary record → Foundry Actor data (without _id/folder —
 * the compendium service injects those). `moduleId` scopes the identity flags.
 */
export function buildNpcActorData(record, { moduleId = "rebreya-main", baseUrl = "https://rebreya.com" } = {}) {
  const { labels, traits, actions } = parseStatblock(record.details);

  const abilityScores = parseAbilities(labels["характеристики"]);
  const saves = parseSaveProficiencies(labels["спасброски"]);
  const skills = parseSkillProficiencies(labels["навыки"]);
  const senses = parseSenses(labels["чувства"]);
  const movement = parseSpeed(record.speed);
  const hp = parseHitPoints(record.hitPoints);
  const ac = parseArmorClass(record.armorClass);
  const cr = parseChallengeRating(record.challengeRating);

  const abilities = {};
  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    abilities[key] = { value: abilityScores[key], proficient: saves.has(key) ? 1 : 0 };
  }

  const skillData = {};
  for (const code of skills) skillData[code] = { value: 1 };

  const items = [
    ...traits.map((t) => buildFeatItem(t, { moduleId, kind: "trait" })),
    ...actions.map((a) => buildFeatItem(a, { moduleId, kind: a.section })),
  ];

  const dr = clean(labels["сопротивление урону"] || labels["сопротивление к урону"]);
  const di = clean(labels["иммунитет к урону"] || labels["иммунитеты к урону"]);
  const dv = clean(labels["уязвимость к урону"] || labels["уязвимость"]);
  const ci = clean(labels["иммунитет к состоянию"] || labels["иммунитет к состояниям"] || labels["иммунитеты к состояниям"]);
  const languages = clean(labels["языки"]);

  return {
    name: clean(record.name) || `Существо #${record.id}`,
    type: "npc",
    img: DEFAULT_NPC_ICON,
    system: {
      abilities,
      attributes: {
        ac: { calc: "flat", flat: ac },
        hp: { value: hp.value, max: hp.value, formula: hp.formula },
        movement,
        senses,
      },
      details: {
        cr,
        type: { value: mapCreatureType(record.type), subtype: "", custom: clean(record.type) },
        alignment: clean(record.alignment),
        source: { custom: clean(record.source), book: clean(record.source).split(/[,;]/u)[0]?.trim() ?? "" },
        biography: { value: buildBiographyHtml(record, labels, { baseUrl }) },
      },
      traits: {
        size: mapSize(record.size),
        languages: { value: [], custom: languages },
        dr: { value: [], custom: dr },
        di: { value: [], custom: di },
        dv: { value: [], custom: dv },
        ci: { value: [], custom: ci },
      },
      skills: skillData,
    },
    items,
    flags: {
      [moduleId]: {
        managed: true,
        sourceType: "site-api",
        site: {
          baseUrl,
          entity: "bestiary",
          id: record.id,
          slug: clean(record.slug),
          updatedAt: clean(record.updated_at),
          contentHash: clean(record.content_hash),
        },
      },
    },
  };
}
