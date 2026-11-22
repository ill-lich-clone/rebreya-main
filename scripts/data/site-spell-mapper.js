/**
 * Site spell record → dnd5e Item "spell" data (dnd5e 5.x, Foundry 13).
 *
 * Pure functions only — no Foundry imports — so the whole mapping is unit
 * tested under `node --test`. The acceptance bar (integration ТЗ §7.6): the
 * produced item must open in the standard dnd5e spell sheet without errors.
 * Fields we cannot parse reliably degrade to `spec`/description text, never to
 * broken data.
 */

// English school names as the site stores them → dnd5e school codes.
const SCHOOL_CODES = {
  abjuration: "abj",
  conjuration: "con",
  divination: "div",
  enchantment: "enc",
  evocation: "evo",
  illusion: "ill",
  necromancy: "nec",
  transmutation: "trs",
};

// English class identifiers from the site's classList → RU display names.
const CLASS_NAMES_RU = {
  artificer: "Изобретатель",
  barbarian: "Варвар",
  bard: "Бард",
  cleric: "Жрец",
  druid: "Друид",
  fighter: "Воин",
  monk: "Монах",
  paladin: "Паладин",
  ranger: "Следопыт",
  rogue: "Плут",
  sorcerer: "Чародей",
  warlock: "Колдун",
  wizard: "Волшебник",
};

const clean = (value) => String(value ?? "").trim();

export function mapSchool(school) {
  return SCHOOL_CODES[clean(school).toLowerCase()] ?? "";
}

/** «1 действие» / «1 бонусное действие» / «1 реакция, …» / «10 минут» / «1 час» */
export function parseCastingTime(text) {
  const raw = clean(text);
  if (!raw) return { type: "action", value: 1, condition: "" };
  // Alternatives («1 действие или 8 часов») → the first, shortest form.
  const first = raw.split(/\s+или\s+/iu)[0];
  const lower = first.toLowerCase();

  if (lower.includes("бонусн")) return { type: "bonus", value: 1, condition: "" };
  if (lower.includes("реакци")) {
    const comma = raw.indexOf(",");
    return { type: "reaction", value: 1, condition: comma >= 0 ? clean(raw.slice(comma + 1)) : "" };
  }
  const num = Number((lower.match(/(\d+)/) ?? [])[1] ?? 1) || 1;
  if (lower.includes("минут")) return { type: "minute", value: num, condition: "" };
  if (lower.includes("час")) return { type: "hour", value: num, condition: "" };
  if (lower.includes("действ")) return { type: "action", value: 1, condition: "" };
  return { type: "action", value: 1, condition: raw };
}

/** «60 футов» / «Касание» / «На себя (5-футовый радиус)» / «1 миля» / «Особая» */
export function parseRange(text) {
  const raw = clean(text);
  const lower = raw.toLowerCase();
  if (!raw) return { value: null, units: "", special: "" };

  if (lower.startsWith("касание")) return { value: null, units: "touch", special: "" };
  if (lower.startsWith("на себя")) {
    // Template info in parens («(5-футовый радиус)») is kept as special text.
    const parens = raw.match(/\(([^)]+)\)/u);
    return { value: null, units: "self", special: parens ? clean(parens[1]) : "" };
  }
  const feet = lower.match(/(\d+)\s*фут/u);
  if (feet) return { value: Number(feet[1]), units: "ft", special: "" };
  const miles = lower.match(/(\d+)\s*мил/u);
  if (miles) return { value: Number(miles[1]), units: "mi", special: "" };
  if (lower.includes("неограничен")) return { value: null, units: "any", special: "" };
  return { value: null, units: "spec", special: raw };
}

/** «Мгновенная» / «Концентрация, вплоть до 1 минуты» / «8 часов» / «До рассеивания» */
export function parseDuration(text) {
  const raw = clean(text);
  const rawLower = raw.toLowerCase();
  // «До рассеивания или срабатывания» is ONE unit, not two alternatives —
  // detect it on the full string before the «или»-splitting below.
  if (rawLower.includes("рассеива") && rawLower.includes("срабатыв")) {
    return { value: null, units: "dstr", concentration: false };
  }
  const first = raw.split(/\s+или\s+/iu)[0];
  const lower = first.toLowerCase();
  const num = Number((lower.match(/(\d+)/) ?? [])[1] ?? null);
  const result = { value: null, units: "inst", concentration: lower.includes("концентрац") };

  if (!raw || lower.includes("мгновен")) return result;
  if (lower.includes("рассеива") || lower.includes("рассеет")) return { ...result, units: "disp" };
  if (lower.includes("особая")) return { ...result, units: "spec" };
  if (lower.includes("раунд")) return { ...result, value: num || 1, units: "round" };
  if (lower.includes("минут")) return { ...result, value: num || 1, units: "minute" };
  if (lower.includes("час")) return { ...result, value: num || 1, units: "hour" };
  if (lower.includes("недел")) return { ...result, value: num || 1, units: "week" };
  if (lower.includes("дн") || lower.includes("сут")) return { ...result, value: num || 1, units: "day" };
  if (lower.includes("год") || lower.includes("лет")) return { ...result, value: num || 1, units: "year" };
  return { ...result, units: "spec" };
}

/** ["V","S","M"] + ritual/concentration flags → dnd5e properties set. */
export function buildProperties(record, duration) {
  const props = new Set();
  const components = Array.isArray(record.components) ? record.components : [];
  for (const c of components) {
    const code = clean(c).toUpperCase();
    if (code === "V" || code === "В") props.add("vocal");
    if (code === "S" || code === "С") props.add("somatic");
    if (code === "M" || code === "М") props.add("material");
  }
  if (record.ritual) props.add("ritual");
  if (record.concentration || duration?.concentration) props.add("concentration");
  return [...props];
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

export function toHtmlParagraphs(value) {
  const text = clean(value);
  if (!text) return "";
  return text
    .split(/\n{2,}/gu)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/gu, "<br>")}</p>`)
    .join("");
}

export function buildDescriptionHtml(record, { baseUrl = "https://rebreya.com" } = {}) {
  const parts = [];
  const body = clean(record.details) || clean(record.description);
  if (body) parts.push(toHtmlParagraphs(body));
  const higher = clean(record.higherLevel);
  if (higher) parts.push(`<p><strong>На высоких уровнях.</strong> ${escapeHtml(higher)}</p>`);
  const classes = (Array.isArray(record.classList) ? record.classList : [])
    .map((c) => CLASS_NAMES_RU[clean(c).toLowerCase()] ?? clean(c))
    .filter(Boolean);
  if (classes.length) parts.push(`<p><strong>Классы:</strong> ${escapeHtml(classes.join(", "))}</p>`);
  const source = clean(record.source);
  const url = record.slug ? `${baseUrl}/dnd-5e/spells/${record.slug}` : "";
  const link = url ? ` · <a href="${url}">Открыть на сайте</a>` : "";
  if (source || link) parts.push(`<p><em>Источник: ${escapeHtml(source || "rebreya.com")}</em>${link}</p>`);
  return parts.join("");
}

/** slug «13-acid-splash» → dnd5e identifier «acid-splash». */
export function buildIdentifier(record) {
  const slug = clean(record.slug).replace(/^\d+-/u, "");
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return safe || `site-spell-${record.id}`;
}

export const DEFAULT_SPELL_ICON = "systems/dnd5e/icons/svg/items/spell.svg";

/** Folder name inside the pack, grouped by spell level. */
export function folderPathForLevel(level) {
  const n = Number(level) || 0;
  return n === 0 ? "Заговоры" : `${n}-й круг`;
}

/**
 * Full mapping: site record → Foundry Item data (without _id/folder — the
 * service injects those). `moduleId` scopes the identity flags.
 */
export function buildSpellItemData(record, { moduleId = "rebreya-main", baseUrl = "https://rebreya.com" } = {}) {
  const duration = parseDuration(record.duration);
  const activation = parseCastingTime(record.castingTime);
  const range = parseRange(record.spellRange);
  const properties = buildProperties(record, duration);
  const sourceBooks = clean(record.source);

  return {
    name: clean(record.name) || `Заклинание #${record.id}`,
    type: "spell",
    img: DEFAULT_SPELL_ICON,
    system: {
      description: { value: buildDescriptionHtml(record, { baseUrl }) },
      identifier: buildIdentifier(record),
      level: Math.max(0, Math.min(9, Number(record.level) || 0)),
      school: mapSchool(record.school),
      activation,
      duration: { value: duration.value, units: duration.units },
      range,
      properties,
      materials: {
        value: clean(record.materialComponent),
        consumed: false,
        cost: 0,
        supply: 0,
      },
      source: { book: sourceBooks.split(/[,;]/u)[0]?.trim() ?? "", custom: sourceBooks },
    },
    flags: {
      [moduleId]: {
        managed: true,
        sourceType: "site-api",
        site: {
          baseUrl,
          entity: "spells",
          id: record.id,
          slug: clean(record.slug),
          updatedAt: clean(record.updated_at),
          contentHash: clean(record.content_hash),
        },
      },
    },
  };
}
