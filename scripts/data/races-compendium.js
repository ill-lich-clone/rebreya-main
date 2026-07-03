import {
  FEATS_COMPENDIUM_NAME,
  MODULE_ID,
  RACE_FEATURES_COMPENDIUM_LABEL,
  RACE_FEATURES_COMPENDIUM_NAME,
  RACES_COMPENDIUM_LABEL,
  RACES_COMPENDIUM_NAME
} from "../constants.js";
import {
  buildNamedIconLookup,
  ensureCompendiumFolders,
  ensurePackSidebarFolder,
  normalizeFolderPath,
  resolveNamedIcon
} from "./compendium-utils.js";
import { buildSlug } from "./item-classification.js";

const DND5E_SYSTEM_ID = "dnd5e";
const SOURCE_LABEL = "Расы Тейванкаля V0.1";
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const RACES_DATA_PATH = `modules/${MODULE_ID}/data/races-teyvankal-v01.json`;
const MODULE_ICONS_BASE_PATH = `modules/${MODULE_ID}/templates/icons`;
const RACE_ICON_SEARCH_PATHS = [`${MODULE_ICONS_BASE_PATH}/Races`, MODULE_ICONS_BASE_PATH];

const RACES_PACK_ID = `world.${RACES_COMPENDIUM_NAME}`;
const RACE_FEATURES_PACK_ID = `world.${RACE_FEATURES_COMPENDIUM_NAME}`;
const FEATS_PACK_ID = `world.${FEATS_COMPENDIUM_NAME}`;

const RACE_ROOT_FOLDER = "Расы Тейванкаля V0.1";
const RACE_FEATURE_ROOT_FOLDER = "Расовые умения Тейванкаля V0.1";

const DEFAULT_RACE_ICON = "icons/svg/mystery-man.svg";
const DEFAULT_FEATURE_ICON = "icons/svg/book.svg";

const RACES_TEMPLATE_VERSION = 2;
const RACE_FEATURE_TEMPLATE_VERSION = 1;
const RACE_AUTOMATION_VERSION = "0.1-dnd5e-5.2.5";
export const RACE_HANDS_DEFAULT = 2;

const EFFECT_MODE_ADD = 2;

const NORMALIZED_HUMAN_NAME = "люди";
const NORMALIZED_MINOR_FEATS_SECTION = "младшие черты";
const NORMALIZED_RACIAL_FEATS_SECTION = "расовые черты";

const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const ALL_LANGUAGE_POOL_KEY = "languages:*";
const ELEMENTAL_LANGUAGE_IDS = ["auran", "terran", "ignan", "aquan"];
const STANDARD_LANGUAGE_IDS = new Set([
  "common",
  "draconic",
  "dwarvish",
  "elvish",
  "giant",
  "gnomish",
  "goblin",
  "halfling",
  "orc",
  "sign"
]);

const ABILITY_NAME_PATTERNS = [
  { key: "str", pattern: /сил(?:а|ы|е|у|ой)?/u },
  { key: "dex", pattern: /ловкост(?:ь|и|ью|ю)?/u },
  { key: "con", pattern: /телосложени(?:е|я|ю|ем)?/u },
  { key: "int", pattern: /интеллект(?:а|у|ом)?/u },
  { key: "wis", pattern: /мудрост(?:ь|и|ью|ю)?/u },
  { key: "cha", pattern: /харизм(?:а|ы|е|у|ой)?/u }
];

const LANGUAGE_NAME_PATTERNS = [
  { id: "common", pattern: /(?:всеобщ|общем|общий)/u },
  { id: "dwarvish", pattern: /дварфийск/u },
  { id: "elvish", pattern: /эльфийск/u },
  { id: "halfling", pattern: /полурослик/u },
  { id: "orc", pattern: /ороч/u },
  { id: "goblin", pattern: /гоблин/u },
  { id: "draconic", pattern: /дракон/u },
  { id: "infernal", pattern: /инфернал/u },
  { id: "gnoll", pattern: /гнолл/u },
  { id: "giant", pattern: /великан/u },
  { id: "gnomish", pattern: /гном(?:ь|ий|ийск)/u },
  { id: "auran", pattern: /ауран/u },
  { id: "terran", pattern: /терран/u },
  { id: "ignan", pattern: /игнан/u },
  { id: "aquan", pattern: /акван/u }
];

const RACE_ABILITY_TEXT_OVERRIDES = {
  минотавры: "Ваше значение Силы, Мудрости или Харизмы увеличивается на 2, ваше значение Телосложения увеличивается на 2, значение Интеллекта уменьшается на 1.",
  кентавры: "Ваше значение Силы или Ловкости увеличивается на 2, ваше значение Мудрости увеличивается на 2, значение Интеллекта или Харизмы уменьшается на 2.",
  леониды: "Ваше значение Ловкости или Силы увеличивается на 2, ваше значение Харизмы или Интеллекта увеличивается на 2, значение Мудрости или Телосложения уменьшается на 1.",
  полувеликаны: "Ваше значение Силы увеличивается на 2, ваше значение Телосложения или Мудрости увеличивается на 2, значение Ловкости уменьшается на 2.",
  нефилимы: "Ваше значение Интеллекта или Харизмы увеличивается на 2, ваше значение Ловкости или Силы увеличивается на 1, значение Телосложения или Мудрости уменьшается на 2.",
  пепельные: "Ваше значение Мудрости или Ловкости увеличивается на 2, ваше значение Харизмы увеличивается на 1, значение Телосложения или Силы уменьшается на 2.",
  големы: "Ваше значение Силы, Мудрости или Харизмы и Телосложения увеличивается на 2, значение Интеллекта уменьшается на 1."
};

const RACE_LANGUAGE_RULE_OVERRIDES = {
  люди: {
    grants: ["common"],
    choices: 1
  },
  синтеты: {
    grants: [],
    choices: 2,
    hint: "Синтеты сохраняют языки базовой расы. Выберите языки, соответствующие выбранной базовой расе."
  },
  гении: {
    grants: ["common"],
    choices: 1,
    poolLanguageIds: ELEMENTAL_LANGUAGE_IDS,
    hint: "Выберите один язык стихии: Ауран, Терран, Игнан или Акван."
  },
  дроу: {
    grants: ["common"],
    choices: 1
  },
  ааракокры: {
    grants: ["common"],
    choices: 1
  },
  людоящеры: {
    grants: ["common"],
    choices: 1
  },
  тортлы: {
    grants: ["common"],
    choices: 1
  },
  багбиры: {
    grants: ["common"],
    choices: 1
  },
  кобольды: {
    grants: ["common"],
    choices: 1
  },
  кентавры: {
    grants: ["orc"],
    choices: 1,
    hint: "Язык кентавров отсутствует в базовом списке dnd5e; выберите дополнительный язык из доступных."
  },
  полувеликаны: {
    grants: ["common"],
    choices: 1,
    hint: "Язык полувеликанов отсутствует в базовом списке dnd5e; выберите дополнительный язык из доступных."
  },
  грунги: {
    grants: ["common"],
    choices: 1,
    hint: "Язык грунгов отсутствует в базовом списке dnd5e; выберите дополнительный язык из доступных."
  }
};

const RACE_ABILITY_OVERRIDES = {
  кентавры: [
    {
      fixed: { wis: 2 },
      points: 2,
      cap: 2,
      allowed: ["str", "dex"],
      hint: "Выберите Силу или Ловкость для увеличения на 2. Снижение Интеллекта или Харизмы на 2 нужно применить вручную."
    }
  ],
  леониды: [
    {
      points: 2,
      cap: 2,
      allowed: ["str", "dex"],
      hint: "Выберите Силу или Ловкость для увеличения на 2."
    },
    {
      points: 2,
      cap: 2,
      allowed: ["cha", "int"],
      hint: "Выберите Харизму или Интеллект для увеличения на 2. Снижение Мудрости или Телосложения на 1 нужно применить вручную."
    }
  ],
  нефилимы: [
    {
      points: 2,
      cap: 2,
      allowed: ["int", "cha"],
      hint: "Выберите Интеллект или Харизму для увеличения на 2."
    },
    {
      points: 1,
      cap: 1,
      allowed: ["dex", "str"],
      hint: "Выберите Ловкость или Силу для увеличения на 1. Снижение Телосложения или Мудрости на 2 нужно применить вручную."
    }
  ],
  полуэльфы: [
    {
      points: 2,
      cap: 2,
      hint: "Выберите одну характеристику для увеличения на 2."
    },
    {
      points: 2,
      cap: 1,
      hint: "Распределите два дополнительных пункта по +1."
    }
  ],
  големы: [
    {
      fixed: { con: 2, int: -1 },
      points: 2,
      cap: 2,
      allowed: ["str", "wis", "cha"],
      hint: "Выберите Силу, Мудрость или Харизму для увеличения на 2."
    }
  ]
};

function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function unique(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function cloneData(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['"\u2019\u2018\u02BC\u02B9\u2032\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildAsciiIdentifier(value, fallbackSeed = "entry") {
  const base = String(value ?? "")
    .toLowerCase()
    .replace(/[^\x00-\x7F]+/gu, " ")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");

  if (base) {
    return base.slice(0, 64);
  }

  return `rb_${stableHashId(String(fallbackSeed ?? value ?? "entry"), "identifier")}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function toHtmlParagraphs(value) {
  const text = cleanString(value);
  if (!text) {
    return "";
  }

  return text
    .split(/\n{2,}/gu)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`)
    .join("");
}

function stableHashId(seed, scope = "id") {
  const source = `${scope}:${seed}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (const char of source) {
    const code = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code + ((hashB << 6) >>> 0) + (hashB >>> 2), 0x85ebca6b) >>> 0;
  }

  const token = `${hashA.toString(36)}${hashB.toString(36)}`.replace(/[^a-z0-9]/gu, "");
  return token.padEnd(16, "0").slice(0, 16);
}

function buildRaceDocumentId(race) {
  return stableHashId(`race:${race?.id ?? ""}`, "race-doc");
}

function buildRaceFeatureDocumentId(feature) {
  return stableHashId(`race-feature:${feature?.featureId ?? ""}`, "race-feature-doc");
}

function normalizeSize(value) {
  const token = normalizeMatchText(value);
  if (["tiny", "sm", "med", "lg", "huge", "grg"].includes(token)) {
    return token;
  }

  if (["маленький", "small"].includes(token)) {
    return "sm";
  }

  if (["большой", "large"].includes(token)) {
    return "lg";
  }

  return "med";
}

function isDnd5eWorld() {
  return game.system?.id === DND5E_SYSTEM_ID;
}

function getRaceKey(race) {
  return normalizeMatchText(race?.name || race?.id);
}

function toNormalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/[«»"']/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function createAbilityFixed(initial = {}) {
  return {
    str: Math.floor(parseNumber(initial.str, 0)),
    dex: Math.floor(parseNumber(initial.dex, 0)),
    con: Math.floor(parseNumber(initial.con, 0)),
    int: Math.floor(parseNumber(initial.int, 0)),
    wis: Math.floor(parseNumber(initial.wis, 0)),
    cha: Math.floor(parseNumber(initial.cha, 0))
  };
}

function hasAnyFixedChange(fixed) {
  return ABILITY_KEYS.some((key) => Number(fixed?.[key] ?? 0) !== 0);
}

function extractAbilityKeys(text) {
  const normalized = toNormalizedText(text);
  const keys = [];
  for (const { key, pattern } of ABILITY_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      keys.push(key);
    }
  }

  return unique(keys);
}

function resolveAbilityIncreaseText(race) {
  const raceKey = getRaceKey(race);
  const overrideText = cleanString(RACE_ABILITY_TEXT_OVERRIDES[raceKey]);
  if (overrideText) {
    return overrideText;
  }

  const direct = cleanString(race?.fields?.abilityIncrease);
  if (direct) {
    return direct;
  }

  const abilityText = (race.abilities ?? [])
    .map((ability) => cleanString(ability?.description))
    .find((text) => /изменени[ея]\s+значени[яй]\s+характеристик/u.test(text));
  return cleanString(abilityText);
}

function parseAbilityIncreaseSpecs(race) {
  const raceKey = getRaceKey(race);
  const explicitOverride = RACE_ABILITY_OVERRIDES[raceKey];
  if (Array.isArray(explicitOverride) && explicitOverride.length) {
    return explicitOverride.map((entry) => ({
      fixed: createAbilityFixed(entry.fixed),
      points: Math.max(0, Math.floor(parseNumber(entry.points, 0))),
      cap: Math.max(1, Math.floor(parseNumber(entry.cap, 2))),
      allowed: unique(Array.isArray(entry.allowed) ? entry.allowed : []),
      hint: cleanString(entry.hint)
    }));
  }

  const sourceText = resolveAbilityIncreaseText(race);
  const text = toNormalizedText(sourceText);
  if (!text) {
    return [];
  }

  const fixed = createAbilityFixed();
  const choiceSpecs = [];
  const notes = [];

  const handleClause = (matchText, amount, isDecrease = false) => {
    const keys = extractAbilityKeys(matchText);
    if (!keys.length) {
      return false;
    }

    const parsedAmount = Math.max(0, Math.floor(parseNumber(amount, 0)));
    if (!parsedAmount) {
      return false;
    }

    const hasChoice = /\bили\b/u.test(matchText);
    if (hasChoice) {
      if (isDecrease) {
        notes.push(`Снижение (${keys.join("/")}) на ${parsedAmount} нужно применить вручную.`);
      }
      else {
        choiceSpecs.push({
          fixed: createAbilityFixed(),
          points: parsedAmount,
          cap: parsedAmount,
          allowed: keys,
          hint: ""
        });
      }

      return true;
    }

    for (const abilityKey of keys) {
      fixed[abilityKey] += isDecrease ? -parsedAmount : parsedAmount;
    }

    return true;
  };

  const increaseRegex = /([а-яa-z,\s]+?)\s+увеличива\w*\s+на\s+(\d+)/gu;
  for (const match of text.matchAll(increaseRegex)) {
    handleClause(match[1], match[2], false);
  }

  const decreaseRegex = /([а-яa-z,\s]+?)\s+уменьша\w*\s+на\s+(\d+)/gu;
  for (const match of text.matchAll(decreaseRegex)) {
    handleClause(match[1], match[2], true);
  }

  const genericSpecs = [];
  const fixedPlusTwoKeys = ABILITY_KEYS.filter((key) => fixed[key] >= 2);
  const hasFixedPlusTwo = fixedPlusTwoKeys.length > 0;

  if (/двух характеристик[^.]*на 1[^.]*либо[^.]*на 2/u.test(text)) {
    genericSpecs.push({ points: 2, cap: 2 });
  }
  else if (/выберите один из вариантов/u.test(text) || /выбер[её]те одно из/u.test(text)) {
    genericSpecs.push({ points: 3, cap: 2 });
  }
  else if (/две другие[^.]*на 1/u.test(text) || /двух других[^.]*на 1/u.test(text)) {
    genericSpecs.push({ points: 2, cap: 2 });
    genericSpecs.push({ points: 2, cap: 1 });
  }
  else if (/одна [^.]*(характеристика|характеристик)[^.]*на 2[^.]*друга[яо][^.]*на 1/u.test(text)) {
    if (hasFixedPlusTwo && /другая характеристика/u.test(text)) {
      genericSpecs.push({ points: 1, cap: 1, disallow: fixedPlusTwoKeys });
    }
    else {
      genericSpecs.push({ points: 3, cap: 2 });
    }
  }
  else if (/одна [^.]*(характеристика|характеристик)[^.]*на 2/u.test(text) && !choiceSpecs.length) {
    genericSpecs.push({ points: 2, cap: 2 });
  }

  if (
    !genericSpecs.length
    && hasFixedPlusTwo
    && !choiceSpecs.length
    && /(другая характеристика увеличивается на 1|другой на 1)/u.test(text)
  ) {
    genericSpecs.push({ points: 1, cap: 1, disallow: fixedPlusTwoKeys });
  }

  const specs = [];
  if (hasAnyFixedChange(fixed)) {
    specs.push({
      fixed,
      points: 0,
      cap: 2,
      allowed: [],
      hint: ""
    });
  }

  for (const entry of choiceSpecs) {
    specs.push(entry);
  }

  for (const generic of genericSpecs) {
    const disallow = new Set(Array.isArray(generic.disallow) ? generic.disallow : []);
    const allowed = ABILITY_KEYS.filter((key) => !disallow.has(key));
    specs.push({
      fixed: createAbilityFixed(),
      points: Math.max(0, Math.floor(parseNumber(generic.points, 0))),
      cap: Math.max(1, Math.floor(parseNumber(generic.cap, 2))),
      allowed,
      hint: ""
    });
  }

  if (!specs.length) {
    return [];
  }

  const hintSuffix = notes.length ? ` ${notes.join(" ")}` : "";
  return specs
    .filter((entry) => entry.points > 0 || hasAnyFixedChange(entry.fixed))
    .map((entry) => ({
      fixed: createAbilityFixed(entry.fixed),
      points: Math.max(0, Math.floor(parseNumber(entry.points, 0))),
      cap: Math.max(1, Math.floor(parseNumber(entry.cap, 2))),
      allowed: unique(Array.isArray(entry.allowed) ? entry.allowed : []),
      hint: cleanString(entry.hint || sourceText) + hintSuffix
    }));
}

function buildAbilityIncreaseAdvancement(race, spec, index = 0) {
  const locked = spec.allowed.length
    ? ABILITY_KEYS.filter((abilityKey) => !spec.allowed.includes(abilityKey))
    : [];

  return {
    _id: stableHashId(`${race.id}:asi:${index + 1}`, "adv"),
    type: "AbilityScoreImprovement",
    title: "Повышение характеристик",
    hint: cleanString(spec.hint),
    level: 0,
    configuration: {
      cap: Math.max(1, Math.floor(parseNumber(spec.cap, 2))),
      fixed: createAbilityFixed(spec.fixed),
      locked,
      max: 20,
      points: Math.max(0, Math.floor(parseNumber(spec.points, 0)))
    },
    value: {}
  };
}

function toLanguageTraitKey(languageId) {
  const id = cleanString(languageId).toLowerCase();
  if (!id) {
    return "";
  }

  if (["auran", "terran", "ignan", "aquan"].includes(id)) {
    return `languages:exotic:primordial:${id}`;
  }

  if (STANDARD_LANGUAGE_IDS.has(id)) {
    return `languages:standard:${id}`;
  }

  return `languages:exotic:${id}`;
}

function resolveLanguageOverrideRule(race) {
  const rule = RACE_LANGUAGE_RULE_OVERRIDES[getRaceKey(race)];
  if (!isPlainObject(rule)) {
    return null;
  }

  return {
    grants: unique(Array.isArray(rule.grants) ? rule.grants : []),
    choices: Math.max(0, Math.floor(parseNumber(rule.choices, 0))),
    hint: cleanString(rule.hint),
    poolLanguageIds: unique(Array.isArray(rule.poolLanguageIds) ? rule.poolLanguageIds : [])
  };
}

function parseLanguageRuleFromText(text) {
  const normalized = toNormalizedText(text);
  if (!normalized) {
    return null;
  }

  const grants = new Set();
  for (const { id, pattern } of LANGUAGE_NAME_PATTERNS) {
    if (pattern.test(normalized)) {
      grants.add(id);
    }
  }

  let choices = 0;
  if (/еще одном языке|ещ[её] одном языке|еще одном на ваш выбор|ещ[её] одном на ваш выбор/u.test(normalized)) {
    choices = 1;
  }
  if (/одном языке по вашему/u.test(normalized)) {
    choices = Math.max(choices, 1);
  }
  if (/по одному языку на ваш выбор/u.test(normalized)) {
    choices = Math.max(choices, 1);
  }
  if (/на общем и\.$/u.test(normalized) || /на всеобщем и\.$/u.test(normalized)) {
    grants.add("common");
    choices = Math.max(choices, 1);
  }

  return {
    grants: Array.from(grants),
    choices,
    hint: cleanString(text),
    poolLanguageIds: []
  };
}

function resolveLanguageRule(race) {
  const override = resolveLanguageOverrideRule(race);
  if (override) {
    return override;
  }

  const fromText = parseLanguageRuleFromText(race?.fields?.languages);
  if (fromText) {
    return fromText;
  }

  return null;
}

function buildLanguageAdvancement(race) {
  const rule = resolveLanguageRule(race);
  if (!rule) {
    return null;
  }

  const grants = unique(rule.grants).map((languageId) => toLanguageTraitKey(languageId)).filter(Boolean);
  const pool = rule.poolLanguageIds.length
    ? rule.poolLanguageIds.map((languageId) => toLanguageTraitKey(languageId)).filter(Boolean)
    : [ALL_LANGUAGE_POOL_KEY];

  if (!grants.length && rule.choices <= 0) {
    return null;
  }

  const choices = [];
  if (rule.choices > 0) {
    choices.push({
      count: rule.choices,
      pool
    });
  }

  return {
    _id: stableHashId(`${race.id}:languages`, "adv"),
    type: "Trait",
    title: "Языки",
    hint: cleanString(rule.hint || race?.fields?.languages),
    level: 0,
    configuration: {
      allowReplacements: false,
      mode: "default",
      grants,
      choices
    },
    value: {}
  };
}

function normalizeFields(rawFields) {
  if (!isPlainObject(rawFields)) {
    return {};
  }

  const fields = {};
  for (const [key, value] of Object.entries(rawFields)) {
    const normalizedKey = cleanString(key);
    const normalizedValue = cleanString(value);
    if (normalizedKey && normalizedValue) {
      fields[normalizedKey] = normalizedValue;
    }
  }

  return fields;
}

function uniqueIdentifier(base, usedIds, fallback) {
  const seed = cleanString(base, fallback);
  let identifier = seed;
  let duplicateIndex = 2;

  while (usedIds.has(identifier)) {
    identifier = `${seed}-${duplicateIndex}`;
    duplicateIndex += 1;
  }

  usedIds.add(identifier);
  return identifier;
}

function normalizeAutomationCoverage(value) {
  const coverage = cleanString(value).toLowerCase();
  if (["full", "partial", "manual"].includes(coverage)) {
    return coverage;
  }

  return "";
}

function statusFromAutomationCoverage(coverage) {
  if (coverage === "full") {
    return "automated";
  }

  if (coverage === "partial") {
    return "partial";
  }

  return "manual";
}

function normalizeAutomation(rawAutomation) {
  if (!isPlainObject(rawAutomation)) {
    return null;
  }

  const coverage = normalizeAutomationCoverage(rawAutomation.coverage);
  if (!coverage) {
    return null;
  }

  return {
    version: cleanString(rawAutomation.version, RACE_AUTOMATION_VERSION),
    coverage,
    status: cleanString(rawAutomation.status, statusFromAutomationCoverage(coverage)),
    effects: Array.isArray(rawAutomation.effects) ? cloneData(rawAutomation.effects, []) : [],
    activities: Array.isArray(rawAutomation.activities) ? cloneData(rawAutomation.activities, []) : [],
    uses: isPlainObject(rawAutomation.uses) ? cloneData(rawAutomation.uses) : null,
    advancements: Array.isArray(rawAutomation.advancements) ? cloneData(rawAutomation.advancements, []) : [],
    runtime: isPlainObject(rawAutomation.runtime) ? cloneData(rawAutomation.runtime) : null,
    mechanics: Array.isArray(rawAutomation.mechanics) ? unique(rawAutomation.mechanics.map((entry) => cleanString(entry))) : [],
    manualNotes: Array.isArray(rawAutomation.manualNotes)
      ? rawAutomation.manualNotes.map((entry) => cleanString(entry)).filter(Boolean)
      : [],
    notes: cleanString(rawAutomation.notes),
    sourceRef: isPlainObject(rawAutomation.sourceRef) ? cloneData(rawAutomation.sourceRef) : null
  };
}

function normalizeAbilityOption(rawOption, optionIndex, raceId, abilityId, usedOptionIds) {
  const optionName = cleanString(rawOption?.name, `Вариант ${optionIndex + 1}`);
  const optionBaseId = cleanString(rawOption?.id, buildSlug(optionName, `${abilityId}-option-${optionIndex + 1}`));
  const optionId = uniqueIdentifier(optionBaseId, usedOptionIds, `${abilityId}-option-${optionIndex + 1}`);

  return {
    id: optionId,
    name: optionName,
    description: cleanString(rawOption?.description),
    automation: normalizeAutomation(rawOption?.automation),
    featureId: `${raceId}::${abilityId}::${optionId}`
  };
}

function normalizeAbility(rawAbility, abilityIndex, race, usedAbilityIds) {
  const abilityName = cleanString(rawAbility?.name, `Умение ${abilityIndex + 1}`);
  const abilityBaseId = cleanString(rawAbility?.id, buildSlug(abilityName, `${race.id}-ability-${abilityIndex + 1}`));
  const abilityId = uniqueIdentifier(abilityBaseId, usedAbilityIds, `${race.id}-ability-${abilityIndex + 1}`);
  const usedOptionIds = new Set();

  const options = (Array.isArray(rawAbility?.options) ? rawAbility.options : [])
    .map((option, optionIndex) => normalizeAbilityOption(option, optionIndex, race.id, abilityId, usedOptionIds))
    .filter((option) => option.name);

  return {
    id: abilityId,
    name: abilityName,
    description: cleanString(rawAbility?.description),
    kind: cleanString(rawAbility?.kind, "minor"),
    options,
    automation: normalizeAutomation(rawAbility?.automation),
    featureId: `${race.id}::${abilityId}`
  };
}

function normalizeRace(rawRace, raceIndex, usedRaceIds) {
  const raceName = cleanString(rawRace?.name, `Раса ${raceIndex + 1}`);
  const raceBaseId = cleanString(rawRace?.id, buildSlug(raceName, `race-${raceIndex + 1}`));
  const raceId = uniqueIdentifier(raceBaseId, usedRaceIds, `race-${raceIndex + 1}`);
  const usedAbilityIds = new Set();
  const abilities = (Array.isArray(rawRace?.abilities) ? rawRace.abilities : [])
    .map((ability, abilityIndex) => normalizeAbility(ability, abilityIndex, { id: raceId }, usedAbilityIds))
    .filter((ability) => ability.name);

  const raceFeatNames = unique((Array.isArray(rawRace?.raceFeatNames) ? rawRace.raceFeatNames : [])
    .map((name) => cleanString(name))
    .filter(Boolean));

  return {
    id: raceId,
    name: raceName,
    group: cleanString(rawRace?.group, "Без группы"),
    size: normalizeSize(rawRace?.size),
    speed: Math.max(0, Math.floor(parseNumber(rawRace?.speed, 30))),
    darkvision: Math.max(0, Math.floor(parseNumber(rawRace?.darkvision, 0))),
    fields: normalizeFields(rawRace?.fields),
    abilities,
    automation: normalizeAutomation(rawRace?.automation),
    raceFeatNames
  };
}

function normalizeRaces(rawRaces = []) {
  const usedRaceIds = new Set();
  return (Array.isArray(rawRaces) ? rawRaces : [])
    .map((race, index) => normalizeRace(race, index, usedRaceIds))
    .filter((race) => race.name);
}

function buildRaceDescription(race) {
  const sections = [];
  sections.push("<h2>Особенности расы</h2>");

  const fieldLabels = new Map([
    ["age", "Возраст"],
    ["size", "Размер"],
    ["weight", "Вес"],
    ["abilityIncrease", "Повышение характеристик"],
    ["speed", "Скорость"],
    ["languages", "Языки"],
    ["raceFeat", "Расовые черты"]
  ]);

  for (const [key, label] of fieldLabels.entries()) {
    const value = race.fields?.[key];
    if (!value) {
      continue;
    }

    sections.push(`<h3>${escapeHtml(label)}</h3>`);
    sections.push(toHtmlParagraphs(value));
  }

  if (race.abilities.length) {
    const abilityRows = race.abilities.map((ability) => {
      const optionList = ability.options.length
        ? `<ul>${ability.options.map((option) => (
          `<li><strong>${escapeHtml(option.name)}.</strong> ${escapeHtml(option.description)}</li>`
        )).join("")}</ul>`
        : "";

      return `<li><strong>${escapeHtml(ability.name)}.</strong> ${escapeHtml(ability.description)}${optionList}</li>`;
    }).join("");

    sections.push("<h3>Умения</h3>");
    sections.push(`<ul>${abilityRows}</ul>`);
  }

  return sections.join("\n");
}

function buildFeatureDescription(race, ability, option = null) {
  if (option) {
    const rows = [
      `<p><strong>${escapeHtml(ability.name)}</strong></p>`,
      toHtmlParagraphs(option.description || ability.description)
    ];
    return rows.join("\n");
  }

  const rows = [];
  if (ability.description) {
    rows.push(toHtmlParagraphs(ability.description));
  }

  if (ability.options.length) {
    rows.push("<p><strong>Доступные варианты:</strong></p>");
    rows.push(`<ul>${ability.options.map((entry) => `<li>${escapeHtml(entry.name)}</li>`).join("")}</ul>`);
  }

  return rows.join("\n");
}

function buildFeatureDefinitions(races) {
  const definitions = [];

  for (const race of races) {
    for (const ability of race.abilities) {
      definitions.push({
        featureId: ability.featureId,
        raceId: race.id,
        raceName: race.name,
        group: race.group,
        abilityId: ability.id,
        optionId: null,
        name: ability.name,
        description: buildFeatureDescription(race, ability),
        automation: ability.automation,
        identifier: buildAsciiIdentifier(
          `${race.id}-${ability.id}-${ability.name}`,
          `${race.id}::${ability.id}`
        ),
        folderPath: normalizeFolderPath([RACE_FEATURE_ROOT_FOLDER, race.group, race.name])
      });

      for (const option of ability.options) {
        definitions.push({
          featureId: option.featureId,
          raceId: race.id,
          raceName: race.name,
          group: race.group,
          abilityId: ability.id,
          optionId: option.id,
          name: option.name,
          description: buildFeatureDescription(race, ability, option),
          automation: option.automation,
          identifier: buildAsciiIdentifier(
            `${race.id}-${ability.id}-${option.id}-${option.name}`,
            `${race.id}::${ability.id}::${option.id}`
          ),
          folderPath: normalizeFolderPath([RACE_FEATURE_ROOT_FOLDER, race.group, race.name])
        });
      }
    }
  }

  return definitions;
}

function buildFeatureSignature(feature) {
  return JSON.stringify({
    templateVersion: RACE_FEATURE_TEMPLATE_VERSION,
    featureId: feature.featureId,
    raceId: feature.raceId,
    raceName: feature.raceName,
    group: feature.group,
    abilityId: feature.abilityId,
    optionId: feature.optionId,
    name: feature.name,
    description: feature.description,
    identifier: feature.identifier,
    automation: feature.automation
  });
}

function buildRaceSignature(race, system) {
  return JSON.stringify({
    templateVersion: RACES_TEMPLATE_VERSION,
    raceId: race.id,
    name: race.name,
    group: race.group,
    size: race.size,
    speed: race.speed,
    darkvision: race.darkvision,
    fields: race.fields,
    raceFeatNames: race.raceFeatNames,
    abilities: race.abilities,
    automation: race.automation,
    system
  });
}

function effectDuration(effect) {
  return {
    startTime: null,
    seconds: null,
    combat: null,
    rounds: null,
    turns: null,
    startRound: null,
    startTurn: null,
    ...(isPlainObject(effect?.duration) ? cloneData(effect.duration, {}) : {})
  };
}

function effectChanges(effect) {
  if (Array.isArray(effect?.changes)) {
    return effect.changes
      .filter((entry) => isPlainObject(entry) && cleanString(entry.key))
      .map((entry) => ({
        key: cleanString(entry.key),
        mode: Number.isFinite(Number(entry.mode)) ? Number(entry.mode) : EFFECT_MODE_ADD,
        value: cleanString(entry.value),
        priority: entry.priority === null || entry.priority === undefined ? null : Number(entry.priority)
      }));
  }

  const key = cleanString(effect?.key);
  if (!key) {
    return [];
  }

  return [{
    key,
    mode: Number.isFinite(Number(effect?.mode)) ? Number(effect.mode) : EFFECT_MODE_ADD,
    value: cleanString(effect?.value),
    priority: effect?.priority === null || effect?.priority === undefined ? null : Number(effect.priority)
  }];
}

function buildAutomationEffectFlags(effect) {
  const flags = {
    [MODULE_ID]: {
      managed: true,
      automation: "race-feature-effect"
    }
  };

  if (effect?.specialDuration) {
    flags.dae = {
      specialDuration: Array.isArray(effect.specialDuration)
        ? cloneData(effect.specialDuration, [])
        : [cleanString(effect.specialDuration)]
    };
  }

  const statusId = cleanString(effect?.statusId);
  if (statusId) {
    flags.core = {
      statusId
    };

    if (statusId.startsWith("rebreya-")) {
      flags[MODULE_ID].statusId = statusId;
      flags[MODULE_ID].statusValue = effect.statusValue ?? null;
      flags[MODULE_ID].statusMeta = isPlainObject(effect.statusMeta) ? cloneData(effect.statusMeta) : {};
    }
  }

  return flags;
}

function automationEffectSignature(effect) {
  return JSON.stringify({
    label: cleanString(effect?.label || effect?.name),
    key: cleanString(effect?.key),
    value: cleanString(effect?.value),
    changes: Array.isArray(effect?.changes) ? effect.changes : [],
    statusId: cleanString(effect?.statusId),
    statusValue: effect?.statusValue ?? null
  });
}

function createAutomationEffect(feature, effect, index = 0) {
  const statusId = cleanString(effect?.statusId);
  const name = cleanString(effect?.label || effect?.name, feature.name);
  return {
    _id: stableHashId(`${feature.featureId}:effect:${index}:${automationEffectSignature(effect)}`, "effect"),
    name,
    type: "base",
    img: cleanString(effect?.img, DEFAULT_FEATURE_ICON),
    system: {},
    changes: effectChanges(effect),
    disabled: effect?.disabled === true,
    duration: effectDuration(effect),
    description: toHtmlParagraphs(effect?.note || effect?.description || name),
    origin: null,
    transfer: effect?.transfer !== false,
    statuses: statusId ? [statusId] : [],
    sort: index * 100000,
    flags: buildAutomationEffectFlags(effect)
  };
}

function createRollPart(part = {}) {
  const customFormula = cleanString(part.formula);
  return {
    number: customFormula ? null : (Number.isFinite(Number(part.number)) ? Number(part.number) : null),
    denomination: customFormula ? null : (Number.isFinite(Number(part.denomination)) ? Number(part.denomination) : null),
    bonus: cleanString(part.bonus),
    types: Array.isArray(part.types) ? cloneData(part.types, []) : [],
    custom: {
      enabled: Boolean(customFormula),
      formula: customFormula
    },
    scaling: {
      mode: cleanString(part.scaling?.mode),
      number: Number.isFinite(Number(part.scaling?.number)) ? Number(part.scaling.number) : 1,
      formula: cleanString(part.scaling?.formula)
    }
  };
}

function activityImage(type) {
  if (type === "check") {
    return "systems/dnd5e/icons/svg/activity/check.svg";
  }
  if (type === "save") {
    return "systems/dnd5e/icons/svg/activity/save.svg";
  }
  if (type === "damage") {
    return "systems/dnd5e/icons/svg/activity/damage.svg";
  }
  if (type === "heal") {
    return "systems/dnd5e/icons/svg/activity/heal.svg";
  }

  return "systems/dnd5e/icons/svg/activity/utility.svg";
}

function activationValue(type) {
  return ["action", "bonus", "reaction", "minute", "hour", "day"].includes(type) ? 1 : null;
}

function buildActivityUses(uses) {
  if (!isPlainObject(uses)) {
    return {
      spent: 0,
      max: "",
      recovery: []
    };
  }

  const period = cleanString(uses.period);
  return {
    spent: 0,
    max: cleanString(uses.max),
    recovery: period ? [{
      period,
      type: "recoverAll",
      formula: ""
    }] : []
  };
}

function buildActivityConsumption(uses) {
  return {
    scaling: {
      allowed: false,
      max: ""
    },
    spellSlot: false,
    targets: isPlainObject(uses) ? [{
      type: "activityUses",
      target: "",
      value: "1",
      scaling: {
        mode: "",
        formula: ""
      }
    }] : []
  };
}

function defaultActivityTarget(activity) {
  const hasArea = activity.area === true || activity.template === true;
  const rangeValue = activity.range ?? "";
  return {
    template: {
      contiguous: false,
      units: hasArea ? cleanString(activity.rangeUnits, "ft") : "",
      type: hasArea ? cleanString(activity.templateType, "circle") : "",
      size: hasArea ? cleanString(activity.templateSize, rangeValue) : "",
      count: "",
      width: "",
      height: ""
    },
    affects: {
      type: cleanString(activity.affectsType || activity.targetType || (hasArea ? "creature" : "")),
      count: cleanString(activity.targetCount),
      choice: activity.choice === true,
      special: cleanString(activity.targetSpecial)
    },
    prompt: activity.prompt !== false,
    override: false
  };
}

function createAutomationActivity(feature, activity, index = 0, effectRefs = []) {
  const type = cleanString(activity?.type, "utility");
  const rangeValue = activity?.range ?? null;
  const rangeUnits = cleanString(activity?.rangeUnits, rangeValue ? "ft" : "self");
  const activationType = cleanString(activity?.activation, "special");
  const data = {
    _id: stableHashId(`${feature.featureId}:activity:${index}:${activity?.name}:${activationType}`, "activity"),
    type,
    name: cleanString(activity?.name, feature.name),
    img: cleanString(activity?.img, activityImage(type)),
    sort: index * 100000,
    activation: {
      type: activationType,
      value: activity?.activationValue ?? activationValue(activationType),
      condition: cleanString(activity?.condition),
      override: false
    },
    consumption: buildActivityConsumption(activity?.uses),
    description: {
      chatFlavor: cleanString(activity?.note)
    },
    duration: {
      value: activity?.duration?.value ?? "",
      units: cleanString(activity?.duration?.units, "inst"),
      special: cleanString(activity?.duration?.special),
      concentration: activity?.duration?.concentration === true,
      override: false
    },
    effects: effectRefs,
    flags: {
      [MODULE_ID]: {
        managed: true,
        automation: "race-feature-activity",
        runtime: isPlainObject(activity?.runtime) ? cloneData(activity.runtime) : null
      }
    },
    range: {
      value: rangeValue,
      units: rangeUnits,
      special: cleanString(activity?.rangeSpecial),
      override: false
    },
    target: defaultActivityTarget(activity ?? {}),
    uses: buildActivityUses(activity?.uses)
  };

  if (type === "check") {
    data.check = {
      ability: cleanString(activity?.ability),
      associated: activity?.skill ? [cleanString(activity.skill)] : [],
      dc: {
        calculation: "",
        formula: cleanString(activity?.dc)
      }
    };
  }

  if (type === "save") {
    data.save = {
      ability: Array.isArray(activity?.saveAbility)
        ? activity.saveAbility.map((entry) => cleanString(entry)).filter(Boolean)
        : [cleanString(activity?.saveAbility, "con")],
      dc: {
        calculation: "",
        formula: cleanString(activity?.dc)
      }
    };
    data.damage = {
      onSave: activity?.damage ? cleanString(activity.onSave, "none") : "",
      parts: activity?.damage ? [createRollPart(activity.damage)] : []
    };
  }

  if (type === "damage") {
    data.damage = {
      onSave: cleanString(activity?.onSave),
      parts: activity?.damage ? [createRollPart(activity.damage)] : []
    };
  }

  if (type === "heal") {
    data.healing = createRollPart(activity?.healing ?? { formula: "1", types: ["healing"] });
  }

  return data;
}

function buildFeatureAutomationFlag(automation) {
  if (!automation) {
    return {
      version: RACE_AUTOMATION_VERSION,
      status: "manual",
      coverage: "manual",
      notes: "Автоматизация не описана в данных."
    };
  }

  return {
    version: cleanString(automation.version, RACE_AUTOMATION_VERSION),
    status: cleanString(automation.status, statusFromAutomationCoverage(automation.coverage)),
    coverage: cleanString(automation.coverage, "manual"),
    notes: cleanString(automation.notes),
    manualNotes: Array.isArray(automation.manualNotes) ? cloneData(automation.manualNotes, []) : [],
    runtime: isPlainObject(automation.runtime) ? cloneData(automation.runtime) : null,
    mechanics: Array.isArray(automation.mechanics) ? cloneData(automation.mechanics, []) : []
  };
}

function buildFeatureAutomationBundle(feature) {
  const automation = normalizeAutomation(feature.automation);
  const effects = [];
  const effectIdsBySignature = new Map();

  const addEffect = (effectSpec) => {
    const signature = automationEffectSignature(effectSpec);
    const existingId = effectIdsBySignature.get(signature);
    if (existingId) {
      return existingId;
    }

    const effect = createAutomationEffect(feature, effectSpec, effects.length);
    effects.push(effect);
    effectIdsBySignature.set(signature, effect._id);
    return effect._id;
  };

  for (const effectSpec of automation?.effects ?? []) {
    addEffect(effectSpec);
  }

  const activities = {};
  for (const activitySpec of automation?.activities ?? []) {
    const effectRefs = [];
    for (const effectSpec of activitySpec.appliedEffects ?? []) {
      const effectId = addEffect({
        ...effectSpec,
        transfer: false
      });
      effectRefs.push(activitySpec.type === "save"
        ? { _id: effectId, onSave: effectSpec.onSave === true }
        : { _id: effectId });
    }

    const activity = createAutomationActivity(feature, activitySpec, Object.keys(activities).length, effectRefs);
    activities[activity._id] = activity;
  }

  return {
    automation,
    effects,
    activities,
    uses: buildActivityUses(automation?.uses)
  };
}

function createFeatureSystem(feature, automationBundle = null) {
  const bundle = automationBundle ?? buildFeatureAutomationBundle(feature);
  return {
    description: {
      value: cleanString(feature.description),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    identifier: buildAsciiIdentifier(feature.identifier, feature.featureId),
    type: {
      value: "feat",
      subtype: ""
    },
    requirements: null,
    prerequisites: {
      items: [],
      level: 0,
      repeatable: false
    },
    properties: [],
    activities: foundry.utils.deepClone(bundle.activities ?? {}),
    uses: foundry.utils.deepClone(bundle.uses ?? buildActivityUses(null)),
    advancement: []
  };
}

function createRaceSystem(race, advancement = []) {
  const senses = {};
  if (race.darkvision > 0) {
    senses.darkvision = race.darkvision;
  }
  const normalizedRaceName = normalizeMatchText(race.name);

  return {
    description: {
      value: buildRaceDescription(race),
      chat: ""
    },
    source: {
      custom: SOURCE_LABEL
    },
    movement: {
      walk: Math.max(0, race.speed)
    },
    senses,
    type: {
      value: ["големы", "железорожденные"].includes(normalizedRaceName) ? "construct" : "humanoid"
    },
    advancement: foundry.utils.deepClone(advancement)
  };
}

function createPackMetadata({ name, label, itemTypes = [] }) {
  return {
    label,
    type: "Item",
    name,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: SOURCE_LABEL,
        types: itemTypes
      }
    }
  };
}

async function ensurePack(packId, metadata) {
  let pack = game.packs.get(packId);
  if (pack && pack.documentName !== metadata.type) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (pack && metadata.system && pack.metadata.system !== metadata.system) {
    if (typeof pack.deleteCompendium === "function") {
      await pack.deleteCompendium();
    }
    pack = null;
  }

  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(metadata);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign compendium '${packId}' to sidebar folder '${COMPENDIUM_SIDEBAR_FOLDER.join("/")}'.`, error);
  }

  return pack;
}

async function getPackDocuments(pack) {
  const documents = await pack.getDocuments();
  return Array.isArray(documents) ? documents : [];
}

async function fetchJson(path, { optional = false } = {}) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) {
      return null;
    }

    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function deleteManagedDocuments(pack, documents) {
  const managedIds = documents
    .filter((document) => document.getFlag(MODULE_ID, "managed"))
    .map((document) => document.id);

  if (!managedIds.length) {
    return;
  }

  await Item.implementation.deleteDocuments(managedIds, { pack: pack.collection });
}

async function syncManagedDocumentIcons(pack, documents, resolveIcon) {
  if (typeof resolveIcon !== "function") {
    return;
  }

  const updates = [];
  for (const document of Array.isArray(documents) ? documents : []) {
    if (!document?.getFlag?.(MODULE_ID, "managed")) {
      continue;
    }

    const nextIcon = cleanString(resolveIcon(document));
    if (!nextIcon || nextIcon === cleanString(document.img)) {
      continue;
    }

    updates.push({
      _id: document.id,
      img: nextIcon
    });
  }

  if (!updates.length) {
    return;
  }

  await Item.implementation.updateDocuments(updates, { pack: pack.collection });
}

function getObjectProperty(object, propertyPath) {
  return String(propertyPath ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}

function getDocumentId(document) {
  return cleanString(document?.id ?? document?._id);
}

function getDocumentFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key);
}

function normalizeSyncEntry(entry, sourceIdFlag) {
  return {
    sourceId: cleanString(entry?.[sourceIdFlag]),
    documentId: cleanString(entry?.documentId),
    name: cleanString(entry?.name ?? entry?.race?.name),
    documentType: cleanString(entry?.documentType),
    signature: cleanString(entry?.signature)
  };
}

export function findStaleGeneratedDocumentIds(documents, entries, sourceIdFlag) {
  const normalizedEntries = entries.map((entry) => normalizeSyncEntry(entry, sourceIdFlag));
  const expectedSourceIds = new Set(normalizedEntries.map((entry) => entry.sourceId).filter(Boolean));
  const expectedDocumentIds = new Set(normalizedEntries.map((entry) => entry.documentId).filter(Boolean));
  const expectedNames = new Set(normalizedEntries.map((entry) => entry.name).filter(Boolean));
  const expectedDocumentTypes = new Set(normalizedEntries.map((entry) => entry.documentType).filter(Boolean));
  const staleIds = [];

  for (const document of Array.isArray(documents) ? documents : []) {
    if (getDocumentFlag(document, "managed")) {
      continue;
    }

    const documentId = getDocumentId(document);
    if (!documentId) {
      continue;
    }

    const documentType = cleanString(document?.type);
    if (expectedDocumentTypes.size && !expectedDocumentTypes.has(documentType)) {
      continue;
    }

    const sourceId = cleanString(getDocumentFlag(document, sourceIdFlag));
    const sourceIdMatches = sourceId && expectedSourceIds.has(sourceId);
    const sourceMatches = cleanString(getObjectProperty(document, "system.source.custom")) === SOURCE_LABEL;
    const nameMatches = expectedNames.has(cleanString(document?.name));
    const stableIdMatches = expectedDocumentIds.has(documentId);

    if (sourceIdMatches || (sourceMatches && (nameMatches || stableIdMatches))) {
      staleIds.push(documentId);
    }
  }

  return staleIds;
}

async function deleteStaleGeneratedDocuments(pack, documents, entries, sourceIdFlag) {
  const staleIds = findStaleGeneratedDocumentIds(documents, entries, sourceIdFlag);
  if (!staleIds.length) {
    return [];
  }

  await Item.implementation.deleteDocuments(staleIds, { pack: pack.collection });
  return staleIds;
}

export function shouldRebuildManagedPack(documents, entries, sourceIdFlag) {
  const managedDocuments = documents.filter((document) => document.getFlag(MODULE_ID, "managed"));
  if (managedDocuments.length !== entries.length) {
    return true;
  }

  const normalizedEntries = entries.map((entry) => normalizeSyncEntry(entry, sourceIdFlag));
  const expectedBySourceId = new Map();
  for (const entry of normalizedEntries) {
    if (!entry.sourceId || expectedBySourceId.has(entry.sourceId)) {
      return true;
    }

    expectedBySourceId.set(entry.sourceId, entry);
  }

  const seenSourceIds = new Set();
  for (const document of managedDocuments) {
    const sourceId = cleanString(getDocumentFlag(document, sourceIdFlag));
    if (seenSourceIds.has(sourceId)) {
      return true;
    }

    seenSourceIds.add(sourceId);
    const expected = expectedBySourceId.get(sourceId);
    if (!expected) {
      return true;
    }

    if (expected.documentId && getDocumentId(document) !== expected.documentId) {
      return true;
    }

    if (document.getFlag(MODULE_ID, "signature") !== expected.signature) {
      return true;
    }
  }

  return false;
}

async function createManagedDocuments(pack, entries, createData) {
  if (!entries.length) {
    return;
  }

  let folderIdByPath = new Map();
  try {
    folderIdByPath = await ensureCompendiumFolders(
      pack,
      entries.map((entry) => entry.folderPath)
    );
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to prepare compendium folders for ${pack.collection}.`, error);
  }

  const documentsData = entries.map((entry) => createData(entry, folderIdByPath));
  await Item.implementation.createDocuments(documentsData, { pack: pack.collection });
}

function buildAdvancementSize(race) {
  const sizeChoices = getRaceSizeChoices(race);
  return {
    _id: stableHashId(`${race.id}:size`, "adv"),
    type: "Size",
    title: "Размер",
    hint: "Выберите размер персонажа, если раса допускает несколько вариантов.",
    level: 0,
    configuration: {
      sizes: sizeChoices
    },
    value: {}
  };
}

function getRaceSizeChoices(race) {
  const fallbackSize = normalizeSize(race?.size);
  const text = normalizeMatchText(`${race?.fields?.size ?? ""} ${fallbackSize}`);
  const detectedSizes = [];
  const candidates = [
    ["tiny", /крошечн|tiny|\btiny\b/u],
    ["sm", /маленьк|small|\bsm\b/u],
    ["med", /средн|medium|\bmed\b/u],
    ["lg", /больш|large|\blg\b/u],
    ["huge", /огромн|huge|\bhuge\b/u],
    ["grg", /громадн|gargantuan|\bgrg\b/u]
  ];

  for (const [size, pattern] of candidates) {
    if (pattern.test(text)) {
      detectedSizes.push(size);
    }
  }

  return unique([fallbackSize, ...detectedSizes]);
}

function getFixedRaceSize(race) {
  const sizeChoices = getRaceSizeChoices(race);
  return sizeChoices.length === 1 ? sizeChoices[0] : null;
}

export function buildRaceFlags(race, signature = "") {
  return {
    [MODULE_ID]: {
      managed: true,
      sourceType: "race",
      raceId: race?.id ?? "",
      fixedSize: getFixedRaceSize(race),
      hands: {
        max: RACE_HANDS_DEFAULT
      },
      automation: buildFeatureAutomationFlag(race?.automation),
      signature
    }
  };
}

function buildAdvancementItemGrant(race, itemUuids = []) {
  const items = unique(itemUuids).map((uuid) => ({ uuid, optional: false }));
  return {
    _id: stableHashId(`${race.id}:grant-base`, "adv"),
    type: "ItemGrant",
    title: "Расовые умения",
    hint: "Базовые расовые умения, получаемые автоматически.",
    level: 0,
    configuration: {
      items,
      optional: false,
      spell: null
    },
    value: {}
  };
}

function buildAdvancementItemChoice({
  race,
  seed,
  title,
  hint,
  level = 0,
  count = 1,
  pool = []
}) {
  const normalizedPool = unique(pool).map((uuid) => ({ uuid }));
  return {
    _id: stableHashId(`${race.id}:${seed}`, "adv"),
    type: "ItemChoice",
    title: cleanString(title, "Выбор умения"),
    hint: cleanString(hint),
    configuration: {
      allowDrops: false,
      choices: {
        [String(level)]: {
          count: Math.max(0, Math.floor(parseNumber(count, 1))),
          replacement: false
        }
      },
      pool: normalizedPool,
      restriction: {
        level: "",
        list: [],
        subtype: "",
        type: ""
      },
      spell: null,
      type: "feat"
    },
    value: {}
  };
}

function normalizeFeatIndexRecord(record, pack) {
  const id = record?._id ?? record?.id ?? "";
  const uuid = id ? `Compendium.${pack.collection}.Item.${id}` : "";
  const section = normalizeMatchText(foundry.utils.getProperty(record, "flags.teyvankal.section"));
  const choiceOption = foundry.utils.getProperty(record, `flags.${MODULE_ID}.choiceOption`);

  return {
    id,
    uuid,
    name: cleanString(record?.name),
    normalizedName: normalizeMatchText(record?.name),
    section,
    isChoiceOption: isPlainObject(choiceOption)
  };
}

function pickPreferredFeat(records = [], preferredSection = "") {
  const list = Array.isArray(records) ? records.filter((entry) => entry?.uuid) : [];
  if (!list.length) {
    return null;
  }

  if (preferredSection) {
    const exactSection = list.find((entry) => entry.section === preferredSection);
    if (exactSection) {
      return exactSection;
    }
  }

  return list[0] ?? null;
}

function resolveFeatByName(name, lookupByName, preferredSection = "") {
  const normalizedName = normalizeMatchText(name);
  if (!normalizedName) {
    return null;
  }

  const direct = lookupByName.get(normalizedName);
  if (direct?.length) {
    return pickPreferredFeat(direct, preferredSection);
  }

  for (const [candidateName, records] of lookupByName.entries()) {
    if (candidateName.includes(normalizedName) || normalizedName.includes(candidateName)) {
      return pickPreferredFeat(records, preferredSection);
    }
  }

  return null;
}

function isHumanRace(race) {
  return normalizeMatchText(race.id) === NORMALIZED_HUMAN_NAME
    || normalizeMatchText(race.name) === NORMALIZED_HUMAN_NAME;
}

function buildRaceFeatHint(race, missing = []) {
  const available = race.raceFeatNames.filter((name) => !missing.includes(name));
  const rows = [];
  if (available.length) {
    rows.push(`Доступны следующие расовые черты: ${available.join(", ")}.`);
  }

  if (missing.length) {
    rows.push(`Не найдены в компендиуме черт: ${missing.join(", ")}.`);
  }

  return rows.join(" ");
}

export function buildRaceAdvancement(race, {
  featureUuidById = new Map(),
  minorFeatUuids = [],
  featLookupByName = new Map()
} = {}) {
  const advancement = [];
  if (getRaceSizeChoices(race).length > 1) {
    advancement.push(buildAdvancementSize(race));
  }

  const abilitySpecs = parseAbilityIncreaseSpecs(race);
  if (abilitySpecs.length) {
    abilitySpecs.forEach((spec, index) => {
      advancement.push(buildAbilityIncreaseAdvancement(race, spec, index));
    });
  }

  const languageAdvancement = buildLanguageAdvancement(race);
  if (languageAdvancement) {
    advancement.push(languageAdvancement);
  }

  const baseFeatureUuids = race.abilities
    .map((ability) => featureUuidById.get(ability.featureId))
    .filter(Boolean);
  if (baseFeatureUuids.length) {
    advancement.push(buildAdvancementItemGrant(race, baseFeatureUuids));
  }

  for (const ability of race.abilities) {
    if (!ability.options.length) {
      continue;
    }

    const optionUuids = ability.options
      .map((option) => featureUuidById.get(option.featureId))
      .filter(Boolean);
    if (!optionUuids.length) {
      continue;
    }

    advancement.push(buildAdvancementItemChoice({
      race,
      seed: `choice:${ability.id}`,
      title: ability.name,
      hint: ability.description,
      level: 0,
      count: 1,
      pool: optionUuids
    }));
  }

  if (isHumanRace(race) && minorFeatUuids.length) {
    advancement.push(buildAdvancementItemChoice({
      race,
      seed: "human-level-1-feat",
      title: "Черта 1-го уровня",
      hint: "Выберите одну младшую черту из внутренней библиотеки черт модуля.",
      level: 1,
      count: 1,
      pool: minorFeatUuids
    }));
  }

  if (race.raceFeatNames.length) {
    const resolvedUuids = [];
    const missing = [];

    for (const featName of race.raceFeatNames) {
      const match = resolveFeatByName(featName, featLookupByName, NORMALIZED_RACIAL_FEATS_SECTION);
      if (match?.uuid) {
        resolvedUuids.push(match.uuid);
      }
      else {
        missing.push(featName);
      }
    }

    const uniqueRaceFeatUuids = unique(resolvedUuids);
    if (uniqueRaceFeatUuids.length) {
      advancement.push(buildAdvancementItemChoice({
        race,
        seed: "racial-feat-level-6",
        title: "Расовая черта (6-й уровень)",
        hint: buildRaceFeatHint(race, missing),
        level: 6,
        count: 1,
        pool: uniqueRaceFeatUuids
      }));
    }

    if (missing.length) {
      console.warn(`${MODULE_ID} | Missing racial feats for '${race.name}':`, missing);
    }
  }

  return advancement;
}

async function buildFeatLookup() {
  const pack = game.packs.get(FEATS_PACK_ID);
  if (!pack) {
    return {
      minorFeatUuids: [],
      byName: new Map()
    };
  }

  const index = await pack.getIndex({
    fields: [
      "flags.teyvankal.section",
      `flags.${MODULE_ID}.choiceOption`
    ]
  });
  const byName = new Map();
  const minorFeatUuids = [];

  for (const row of index) {
    const record = normalizeFeatIndexRecord(row, pack);
    if (!record.uuid || !record.normalizedName || record.isChoiceOption) {
      continue;
    }

    if (!byName.has(record.normalizedName)) {
      byName.set(record.normalizedName, []);
    }
    byName.get(record.normalizedName).push(record);

    if (record.section === NORMALIZED_MINOR_FEATS_SECTION) {
      minorFeatUuids.push(record.uuid);
    }
  }

  const normalizedMinorFeatUuids = unique(minorFeatUuids);
  if (!normalizedMinorFeatUuids.length) {
    return {
      minorFeatUuids: unique(Array.from(byName.values()).flat().map((entry) => entry.uuid)),
      byName
    };
  }

  return {
    minorFeatUuids: normalizedMinorFeatUuids,
    byName
  };
}

function createFeatureEntryData(feature, folderIdByPath, iconLookup = null) {
  const folderPath = feature.folderPath.join("/");
  const automationBundle = buildFeatureAutomationBundle(feature);
  return {
    _id: feature.documentId,
    name: feature.name,
    type: "feat",
    img: resolveFeatureIcon(feature.raceName, feature.name, iconLookup, DEFAULT_FEATURE_ICON),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: createFeatureSystem(feature, automationBundle),
    effects: foundry.utils.deepClone(automationBundle.effects),
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "raceFeature",
        raceId: feature.raceId,
        raceName: feature.raceName,
        abilityId: feature.abilityId,
        optionId: feature.optionId,
        featureId: feature.featureId,
        automation: buildFeatureAutomationFlag(automationBundle.automation),
        signature: buildFeatureSignature(feature)
      }
    }
  };
}

function createRaceEntryData(entry, folderIdByPath, iconLookup = null) {
  const folderPath = entry.folderPath.join("/");
  return {
    _id: entry.documentId,
    name: entry.race.name,
    type: "race",
    img: resolveNamedIcon(entry.race.name, iconLookup, DEFAULT_RACE_ICON),
    folder: folderIdByPath.get(folderPath) ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    system: foundry.utils.deepClone(entry.system),
    effects: [],
    flags: buildRaceFlags(entry.race, entry.signature)
  };
}

async function loadRacesData() {
  const rawData = await fetchJson(RACES_DATA_PATH);
  return normalizeRaces(rawData?.races ?? []);
}

function resolveFeatureIcon(raceName, featureName, iconLookup, fallbackIcon = DEFAULT_FEATURE_ICON) {
  const normalizedRaceName = cleanString(raceName);
  const normalizedFeatureName = cleanString(featureName);
  const candidates = [];

  if (normalizedRaceName && normalizedFeatureName) {
    candidates.push(`${normalizedRaceName}__${normalizedFeatureName}`);
    candidates.push(`${normalizedRaceName}_${normalizedFeatureName}`);
    candidates.push(`${normalizedRaceName} ${normalizedFeatureName}`);
  }

  if (normalizedFeatureName) {
    candidates.push(normalizedFeatureName);
  }

  for (const candidate of unique(candidates.map((value) => cleanString(value)).filter(Boolean))) {
    const resolved = resolveNamedIcon(candidate, iconLookup, "");
    if (resolved) {
      return resolved;
    }
  }

  return fallbackIcon;
}

async function syncRaceFeaturePack(featureDefinitions, context = {}) {
  const pack = await ensurePack(RACE_FEATURES_PACK_ID, createPackMetadata({
    name: RACE_FEATURES_COMPENDIUM_NAME,
    label: RACE_FEATURES_COMPENDIUM_LABEL,
    itemTypes: ["feat"]
  }));

  const features = featureDefinitions.map((feature) => ({
    ...feature,
    documentId: buildRaceFeatureDocumentId(feature),
    documentType: "feat",
    signature: buildFeatureSignature(feature)
  }));
  const featureById = new Map(features.map((feature) => [feature.featureId, feature]));
  let documents = await getPackDocuments(pack);
  const staleDocumentIds = await deleteStaleGeneratedDocuments(pack, documents, features, "featureId");
  if (staleDocumentIds.length) {
    documents = await getPackDocuments(pack);
  }

  if (shouldRebuildManagedPack(documents, features, "featureId")) {
    await deleteManagedDocuments(pack, documents);
    await createManagedDocuments(
      pack,
      features,
      (entry, folderIdByPath) => createFeatureEntryData(entry, folderIdByPath, context.iconLookup)
    );
  }

  const activePack = game.packs.get(RACE_FEATURES_PACK_ID) ?? pack;
  const featureDocuments = await getPackDocuments(activePack);
  await syncManagedDocumentIcons(
    activePack,
    featureDocuments,
    (document) => {
      const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
      const feature = featureById.get(featureId);
      const raceName = cleanString(feature?.raceName || document.getFlag(MODULE_ID, "raceName"));
      return resolveFeatureIcon(raceName, document.name, context.iconLookup, DEFAULT_FEATURE_ICON);
    }
  );
  const featureUuidById = new Map();

  for (const document of featureDocuments) {
    if (!document.getFlag(MODULE_ID, "managed")) {
      continue;
    }

    const featureId = cleanString(document.getFlag(MODULE_ID, "featureId"));
    if (!featureId) {
      continue;
    }

    featureUuidById.set(featureId, document.uuid);
  }

  return {
    pack: activePack,
    featureUuidById
  };
}

async function syncRacesPack(races, context) {
  const pack = await ensurePack(RACES_PACK_ID, createPackMetadata({
    name: RACES_COMPENDIUM_NAME,
    label: RACES_COMPENDIUM_LABEL,
    itemTypes: ["race"]
  }));

  const raceEntries = races.map((race) => {
    const advancement = buildRaceAdvancement(race, context);
    const system = createRaceSystem(race, advancement);
    return {
      documentId: buildRaceDocumentId(race),
      documentType: "race",
      race,
      system,
      signature: buildRaceSignature(race, system),
      folderPath: normalizeFolderPath([RACE_ROOT_FOLDER, race.group])
    };
  });

  const documents = await getPackDocuments(pack);
  const entriesForComparison = raceEntries.map((entry) => ({
    raceId: entry.race.id,
    name: entry.race.name,
    documentId: entry.documentId,
    documentType: entry.documentType,
    signature: entry.signature
  }));

  let activeDocuments = documents;
  const staleDocumentIds = await deleteStaleGeneratedDocuments(pack, activeDocuments, entriesForComparison, "raceId");
  if (staleDocumentIds.length) {
    activeDocuments = await getPackDocuments(pack);
  }

  if (shouldRebuildManagedPack(activeDocuments, entriesForComparison, "raceId")) {
    await deleteManagedDocuments(pack, activeDocuments);
    await createManagedDocuments(
      pack,
      raceEntries,
      (entry, folderIdByPath) => createRaceEntryData(entry, folderIdByPath, context.iconLookup)
    );
  }

  const activePack = game.packs.get(RACES_PACK_ID) ?? pack;
  const syncedDocuments = await getPackDocuments(activePack);
  await syncManagedDocumentIcons(
    activePack,
    syncedDocuments,
    (document) => resolveNamedIcon(document.name, context.iconLookup, DEFAULT_RACE_ICON)
  );

  return activePack;
}

export class RacesCompendiumService {
  async sync() {
    if (!game.user?.isGM || !isDnd5eWorld()) {
      return null;
    }

    const iconLookup = await buildNamedIconLookup(RACE_ICON_SEARCH_PATHS, { forceRefresh: true });
    const races = await loadRacesData();
    const featureDefinitions = buildFeatureDefinitions(races);
    const { pack: featuresPack, featureUuidById } = await syncRaceFeaturePack(featureDefinitions, {
      iconLookup
    });
    const featLookup = await buildFeatLookup();
    const racesPack = await syncRacesPack(races, {
      featureUuidById,
      minorFeatUuids: featLookup.minorFeatUuids,
      featLookupByName: featLookup.byName,
      iconLookup
    });

    return {
      racesPack,
      featuresPack
    };
  }
}
