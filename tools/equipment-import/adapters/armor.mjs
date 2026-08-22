import { parseInteger, parseRequiredText } from "../parsers.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const SECTIONS = new Map([
  ["Лёгкие доспехи", "light"], ["Соверменные легкие доспехи", "light"],
  ["Средний доспех", "medium"], ["Современные средние доспехи", "medium"],
  ["Тяжелый доспех", "heavy"], ["Современные тяжёлые доспехи", "heavy"],
  ["Щиты", "shield"], ["Современные щиты", "shield"]
]);
const BASE_ITEMS = new Map(Object.entries({
  "Стёганый доспех": "padded", "Кожаный доспех": "leather",
  "Проклёпанный кожаный доспех": "studded", "Боевая броня шеф-повара": "",
  "Шкурный доспех": "hide", "Кольчужная рубаха": "chainshirt",
  "Чешуйчатый доспех": "scalemail", "Кираса": "breastplate", "Полулаты": "halfplate",
  "Импровизированный доспех": "", "Колечный доспех": "ringmail", "Кольчуга": "chainmail",
  "Наборный доспех": "splint", "Латы": "plate", "Панцирь тортла": "",
  "Щит": "shield", "Баклер": "", "Башенный щит": "", "Тяжелый плащ": "",
  "Кожаная куртка": "", "Защитная рубашка": "", "Листовой жилет": "",
  "Укрепленный плащ": "", "Многослойный бронежилет": "", "Лёгкая служебная броня": "",
  "Тактическая броня": "", "Пехотная штурмовая броня": "", "Тяжелая служебная броня": "",
  "Сверхтяжелая штурмовая броня": "", "Укрепленный щит": "", "Баллистический щит": ""
}));
const DASH = /^(?:-|–|—)$/u;

function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}

function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}

function exactReference(snapshot, row, referenceIndex, diagnostics) {
  const sourceRef = `${snapshot.sheetTitle}!A${row.rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference", sheetKey: snapshot.sheetKey, range: snapshot.range,
      rowNumber: row.rowNumber, column: "Название", value: row.cells?.Название,
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  return referenceIndex.resolveStableGearId(reference);
}

function parseArmorClass(raw, ctx) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^([+]?[0-9]+)(?:\s*\+\s*модификатор ЛОВ)?(?:\s*\(макс\.?\s*([0-9]+)\))?(?:\s*\((БУ|БС)\s*([0-9]+)\))?$/u);
  if (!match) fail("malformed-armor-class", raw, ctx, `Malformed armor class: ${value}`);
  const dex = match[2] ? parseInteger(match[2], ctx, { min: 0, max: 10, label: "dexterity cap" }) : null;
  const result = { value: Number(match[1].replace("+", "")), dex };
  if (match[3]) result.sourceModifier = { type: match[3], value: Number(match[4]) };
  return result;
}

export function adaptArmorProfiles({ snapshot, referenceIndex, diagnostics = [] }) {
  const fragments = new Map();
  let armorType = null;
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    const name = parseRequiredText(cells.Название, context(snapshot, row, "Название"));
    if (!String(cells["Класс доспеха (КД)"] ?? "").trim()) {
      armorType = SECTIONS.get(name);
      if (!armorType) fail("unknown-armor-type", name, context(snapshot, row, "Название"), `Unknown armor section: ${name}`);
      continue;
    }
    if (!armorType) fail("missing-armor-type", name, context(snapshot, row, "Название"), "Armor row appears before an armor section");
    if (!BASE_ITEMS.has(name)) fail("dangling-armor-base-item", name, context(snapshot, row, "Название"), `Armor base-item mapping is missing for ${name}`);
    const stableId = exactReference(snapshot, row, referenceIndex, diagnostics);
    if (!stableId) continue;
    const ac = parseArmorClass(cells["Класс доспеха (КД)"], context(snapshot, row, "Класс доспеха (КД)"));
    const rawStrength = String(cells.Сила ?? "").trim();
    const strength = !rawStrength || DASH.test(rawStrength)
      ? 0
      : parseInteger(rawStrength, context(snapshot, row, "Сила"), { min: 0, max: 30, label: "armor strength" });
    const stealth = String(cells.Скрытность ?? "").trim();
    if (stealth && !DASH.test(stealth) && stealth !== "Помеха") {
      fail("unknown-armor-property", stealth, context(snapshot, row, "Скрытность"), `Unknown armor stealth property: ${stealth}`);
    }
    const armor = {
      type: armorType,
      baseItem: BASE_ITEMS.get(name),
      value: ac.value,
      dex: ac.dex,
      strength,
      properties: stealth === "Помеха" ? ["stealthDisadvantage"] : []
    };
    if (ac.sourceModifier) armor.sourceModifier = ac.sourceModifier;
    const additional = String(cells["Дополнительные свойства"] ?? "").trim();
    if (additional && !DASH.test(additional)) armor.additionalProperties = additional;
    fragments.set(stableId, { armor });
  }
  throwIfDiagnostics(diagnostics, "Armor profile adaptation failed");
  return fragments;
}
