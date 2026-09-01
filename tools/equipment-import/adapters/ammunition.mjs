import { parseDamageFormula, parseInteger } from "../parsers.mjs";
import { buildCanonicalEquipmentSourceKey } from "../overrides.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const FOOTNOTE = "*Пулевой патрон также лишает оружия свойство разброс и удваивет дальность стрельбы.";
const STANDARD_COMPATIBILITY = new Map([
  ["Мушкеты, кремнивые пистолеты, многоствольные кремнивые пистолеты, аркебузы, колесцовые оружия", ["musket", "flintlock-pistol", "multibarrel-flintlock-pistol", "arquebus", "wheellock"]],
  ["Винтовки, карабины", ["rifle", "carbine"]],
  ["Дробовики, мушкетроны", ["shotgun", "musketoon"]],
  ["Дробовики", ["shotgun"]],
  ["Огнемёты", ["flamethrower"]],
  ["Гранатомёты и ракетные пусковые установки", ["grenade-launcher", "rocket-launcher"]],
  ["пистолеты", ["pistol"]],
  ["Гаусс винтовка. Одной батареи достаточно для совершения 4-х выстрелов", ["gauss-rifle"]],
  ["Гаусс винтовка, Гаусс пулемёт", ["gauss-rifle", "gauss-machine-gun"]],
  ["Антиматериальное оружие(Из сферы аннигиляции)", ["antimatter-weapon"]],
  ["Лазерное оружие(Из посоха огня)", ["laser-weapon"]],
  ["Переносная пушка", ["portable-cannon"]],
  ["Тесла винтовка, Гаусс винтовка, Гаусс пулемёт", ["tesla-rifle", "gauss-rifle", "gauss-machine-gun"]],
  ["Антиматериальное оружие", ["antimatter-weapon"]],
  ["Лазерное оружие", ["laser-weapon"]],
  ["Ручной гранатомёт, ручница", ["hand-grenade-launcher", "hand-cannon"]],
  ["Луки", ["bow"]],
  ["Арбалеты", ["crossbow"]],
  ["Духовая трубка", ["blowgun"]],
  ["Праща", ["sling"]],
  ["Оружие, использующее физические боеприпасы", ["all"]],
  ["Луки, арбалеты", ["bow", "crossbow"]]
]);
const REPLACEMENTS = new Map([
  ["Мушкетный и Винтовочные", ["musket", "rifle"]],
  ["Все", ["all"]]
]);
const DAMAGE_TYPE_BY_SOURCE = new Map([
  ["Колющий", "piercing"], ["колющий", "piercing"], ["дробящий", "bludgeoning"],
  ["рубящий", "slashing"], ["огонь", "fire"], ["огнём", "fire"], ["разброс", "scatter"]
]);

function text(value) { return String(value ?? "").trim(); }
function context(sheet, rowNumber, column) {
  return { sheetKey: sheet.sheetKey, range: sheet.range, rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}
function rowAt(sheet, rowNumber) { return sheet.values?.[rowNumber - 1] ?? []; }
function parseQuantity(name, ctx) {
  const matches = [...name.matchAll(/\((\d+)\)/gu)];
  if (matches.length !== 1) fail("invalid-ammunition-quantity", name, ctx, `Ammunition name must contain exactly one quantity: ${name}`);
  return parseInteger(matches[0][1], ctx, { min: 1, label: "ammunition quantity" });
}
function resolveReference(sheet, rowNumber, referenceIndex, diagnostics) {
  const sourceRef = `${sheet.sheetTitle}!B${rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference", sheetKey: sheet.sheetKey, range: sheet.range,
      rowNumber, column: "Боеприпас", value: rowAt(sheet, rowNumber)[0] ?? "",
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  return referenceIndex.resolveStableGearId(reference);
}
function parseStandardDamageType(name, ctx) {
  const suffix = name.match(/\)\s*(?:(Колющий|колющий|дробящий)\s+урон|урон\s+(огнём))\s*$/u);
  if (suffix) return DAMAGE_TYPE_BY_SOURCE.get(suffix[1] ?? suffix[2]);
  if (/^(?:Батарея|Стальной болт|Заряд антиматерии|Тепловая батарея|Ядро)\s*\(/u.test(name)) return null;
  fail("unknown-ammunition-damage-type", name, ctx, `Unknown ammunition damage suffix: ${name}`);
}
function parseDamageModifiers(effect, ctx) {
  if (/^(?:не|Нет)\s+(?:наносит\s+)?урона/iu.test(effect)) return [];
  const terms = [];
  const tokenPattern = /(\d+[dкК]\d+(?:(?:kh|kl)\d+)?)\s+(колющий|дробящий|рубящий|огонь|огнём|разброс)/giu;
  for (const match of effect.matchAll(tokenPattern)) {
    terms.push({
      formula: parseDamageFormula(match[1], ctx),
      type: DAMAGE_TYPE_BY_SOURCE.get(match[2].toLocaleLowerCase("ru-RU"))
    });
  }
  if (!terms.length && /^разброс\s+\(/iu.test(effect)) return [];
  if (!terms.length) fail("invalid-ammunition-effect", effect, ctx, `Ammunition effect has no complete damage modifier: ${effect}`);
  if (/^\d+[dкК]\d+\s+мусор$/iu.test(effect)) fail("invalid-ammunition-effect", effect, ctx, `Unknown ammunition effect token: ${effect}`);
  return terms;
}
function profile(kind, quantity, fields = {}) {
  return {
    kind, quantity, damageModifiers: [], damageType: null, compatibility: [], replaces: [],
    propertiesText: "", craftMisfire: null, handCannonDamageDieStep: 0, ...fields
  };
}

function parseUnifiedQuantity(name, ctx) {
  const matches = [...name.matchAll(/\((\d+)\)/gu)];
  if (!matches.length) return 1;
  if (matches.length !== 1) fail("invalid-ammunition-quantity", name, ctx, `Ammunition name must contain at most one quantity: ${name}`);
  return parseInteger(matches[0][1], ctx, { min: 1, label: "ammunition quantity" });
}

function unifiedDamageTerm(formulaRaw, typeRaw, ctx) {
  const formula = text(formulaRaw);
  const type = text(typeRaw);
  if (!formula || DASH.test(formula) || formula === "0" || !type || DASH.test(type)) return null;
  if (!/^\d+[dкК]\d+(?:(?:kh|kl)\d+)?$/u.test(formula)) return null;
  const damageType = DAMAGE_TYPE_BY_SOURCE.get(type) ?? DAMAGE_TYPE_BY_SOURCE.get(type.toLocaleLowerCase("ru-RU"));
  if (!damageType) fail("unknown-ammunition-damage-type", typeRaw, ctx, `Unknown ammunition damage type: ${type}`);
  return { formula: parseDamageFormula(formula, ctx), type: damageType };
}

function unifiedUnsupportedDamageText(formulaRaw, typeRaw) {
  const formula = text(formulaRaw);
  const type = text(typeRaw);
  if (!formula || DASH.test(formula) || formula === "0" || !type || DASH.test(type)) return "";
  if (/^\d+[dкК]\d+(?:(?:kh|kl)\d+)?$/u.test(formula)) return "";
  return `${formula} ${type}`;
}

function adaptUnifiedAmmunitionProfiles({ standard, referenceIndex, diagnostics }) {
  const fragments = new Map();
  for (const row of standard.rows ?? []) {
    const cells = row.cells ?? {};
    const name = text(cells.Название);
    if (!name) continue;
    const sourceRef = `${standard.sheetTitle}!A${row.rowNumber}`;
    const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
    if (!reference) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-equipment-reference", sheetKey: standard.sheetKey, range: standard.range,
        rowNumber: row.rowNumber, column: "Название", value: name,
        message: `Missing exact equipment reference for ${sourceRef}`
      }));
      continue;
    }
    const compatibilitySource = text(cells["Подходящее оружие"]);
    const compatibility = STANDARD_COMPATIBILITY.get(compatibilitySource);
    if (!compatibility) fail("unknown-ammunition-compatibility", compatibilitySource, context(standard, row.rowNumber, "Подходящее оружие"), `Unknown ammunition compatibility: ${compatibilitySource}`);
    const terms = [
      unifiedDamageTerm(cells["Урон 1"], cells["Тип урона"], context(standard, row.rowNumber, "Урон 1")),
      unifiedDamageTerm(cells["Урон 2"], cells["Тип урона 2"], context(standard, row.rowNumber, "Урон 2"))
    ].filter(Boolean);
    const propertiesText = [
      text(cells.Эффект),
      unifiedUnsupportedDamageText(cells["Урон 1"], cells["Тип урона"]),
      unifiedUnsupportedDamageText(cells["Урон 2"], cells["Тип урона 2"])
    ].filter(Boolean).join(" ");
    const handCannon = compatibilitySource === "Ручной гранатомёт, ручница";
    const stableId = referenceIndex.resolveStableGearId(reference);
    fragments.set(stableId, { ammunition: profile(handCannon ? "handCannon" : "standard", parseUnifiedQuantity(name, context(standard, row.rowNumber, "Название")), {
      damageModifiers: terms,
      damageType: terms.length ? null : (DAMAGE_TYPE_BY_SOURCE.get(text(cells["Тип урона"])) ?? DAMAGE_TYPE_BY_SOURCE.get(text(cells["Тип урона"]).toLocaleLowerCase("ru-RU")) ?? null),
      compatibility: [...compatibility],
      propertiesText,
      handCannonDamageDieStep: handCannon ? -1 : 0
    }) });
  }
  return fragments;
}

function appendSpecialAmmunitionProfiles({ special, referenceIndex, diagnostics, fragments }) {
  for (const row of special?.rows ?? []) {
    const cells = row.cells ?? {};
    const name = text(cells.Боеприпас);
    const sourceKey = buildCanonicalEquipmentSourceKey({ equipmentType: "Боеприпас", name });
    const sourceRef = `${special.sheetTitle}!B${row.rowNumber}`;
    const legacyReference = `Боеприпасы!H${row.rowNumber - 1}`;
    const reference = referenceIndex?.gearByKey?.get(sourceKey)
      ?? referenceIndex?.gearBySourceRef?.get(legacyReference)
      ?? referenceIndex?.gearBySourceRef?.get(sourceRef);
    if (!reference) {
      diagnostics.push(createImportDiagnostic({
        code: "missing-equipment-reference", sheetKey: special.sheetKey, range: special.range,
        rowNumber: row.rowNumber, column: "Боеприпас", value: name,
        message: `Missing exact equipment reference for ${sourceRef} (declared legacy coordinate ${legacyReference})`
      }));
      continue;
    }
    const replacements = REPLACEMENTS.get(text(cells.Заменяет));
    if (!replacements) fail("unknown-ammunition-replacement", cells.Заменяет, context(special, row.rowNumber, "Заменяет"), `Unknown ammunition replacement: ${text(cells.Заменяет)}`);
    const rawRank = text(cells.Ранг);
    if (rawRank && !DASH.test(rawRank)) parseInteger(rawRank, context(special, row.rowNumber, "Ранг"), { min: 0, label: "ammunition rank" });
    fragments.set(referenceIndex.resolveStableGearId(reference), { ammunition: profile("special", parseQuantity(name, context(special, row.rowNumber, "Боеприпас")), {
      replaces: [...replacements],
      propertiesText: text(cells.Свойства),
      craftMisfire: parseInteger(text(cells["Осечка при крафте"]), context(special, row.rowNumber, "Осечка при крафте"), { min: 0, label: "craft misfire" })
    }) });
  }
}

export function adaptAmmunitionProfiles({ snapshot, referenceIndex, diagnostics = [] }) {
  const standard = snapshot?.ammunition ?? snapshot;
  const special = snapshot?.specialAmmunition ?? null;
  if (standard?.layout !== "raw" && Array.isArray(standard?.rows)) {
    const fragments = adaptUnifiedAmmunitionProfiles({ standard, referenceIndex, diagnostics });
    appendSpecialAmmunitionProfiles({ special, referenceIndex, diagnostics, fragments });
    throwIfDiagnostics(diagnostics, "Ammunition profile adaptation failed");
    return fragments;
  }
  if (!standard || standard.layout !== "raw") fail("missing-ammunition-snapshot", "", {}, "Ammunition snapshot is required");
  const fragments = new Map();

  for (let rowNumber = 4; rowNumber <= 17; rowNumber += 1) {
    const row = rowAt(standard, rowNumber);
    const name = text(row[0]);
    if (!name || name === FOOTNOTE) continue;
    const compatibility = STANDARD_COMPATIBILITY.get(text(row[3]));
    if (!compatibility) fail("unknown-ammunition-compatibility", row[3], context(standard, rowNumber, "Используется"), `Unknown ammunition compatibility: ${text(row[3])}`);
    const stableId = resolveReference(standard, rowNumber, referenceIndex, diagnostics);
    if (!stableId) continue;
    fragments.set(stableId, { ammunition: profile("standard", parseQuantity(name, context(standard, rowNumber, "Боеприпас")), {
      damageType: parseStandardDamageType(name, context(standard, rowNumber, "Боеприпас")),
      compatibility: [...compatibility]
    }) });
  }

  for (let rowNumber = 20; rowNumber <= (standard.values?.length ?? 0); rowNumber += 1) {
    const row = rowAt(standard, rowNumber);
    const name = text(row[0]);
    if (!name) continue;
    const effect = text(row[3]);
    const stableId = resolveReference(standard, rowNumber, referenceIndex, diagnostics);
    if (!stableId) continue;
    fragments.set(stableId, { ammunition: profile("handCannon", parseQuantity(name, context(standard, rowNumber, "Боеприпас")), {
      damageModifiers: parseDamageModifiers(effect, context(standard, rowNumber, "Эффект")),
      compatibility: ["hand-grenade-launcher", "hand-cannon"],
      propertiesText: effect,
      handCannonDamageDieStep: -1
    }) });
  }

  appendSpecialAmmunitionProfiles({ special, referenceIndex, diagnostics, fragments });
  throwIfDiagnostics(diagnostics, "Ammunition profile adaptation failed");
  return fragments;
}
