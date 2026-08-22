import { parseDamageFormula, parseInteger } from "../parsers.mjs";
import { ImportDiagnosticError, createImportDiagnostic, throwIfDiagnostics } from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const DAMAGE_TYPES = new Map([
  ["Колющий", "piercing"], ["Огонь", "fire"], ["Огнём", "fire"],
  ["Электричество", "lightning"]
]);
const DEPLOYMENTS = new Map([["Ручная", "hand"], ["Установочная", "placed"]]);
const DELAYS = new Set(["Стандарт", "1 раунд", "Мгновенная"]);
const TRIGGERS = new Set(["Контактный"]);
const DISARM = new Set(["Стандарт"]);

function text(value) { return String(value ?? "").trim(); }
function context(snapshot, row, column) {
  return { sheetKey: snapshot.sheetKey, range: snapshot.range, rowNumber: row.rowNumber, column };
}
function fail(code, value, ctx, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({ code, value, message, ...ctx })]);
}
function optionalToken(raw, allowed, ctx, code, label) {
  const value = text(raw);
  if (!value || DASH.test(value)) return null;
  if (!allowed.has(value)) fail(code, raw, ctx, `Unknown ${label}: ${value}`);
  return value;
}
function distance(raw, ctx, label) {
  const value = text(raw);
  const match = value.match(/^(\d+)\s+футов$/u);
  if (!match) fail("invalid-explosive-distance", raw, ctx, `${label} must be a complete distance in feet`);
  return parseInteger(match[1], ctx, { min: 0, label });
}
function damageTypes(raw, ctx) {
  const value = text(raw);
  if (!value || DASH.test(value)) return [];
  return value.split(/\s+и\s+/u).map((token) => {
    const type = DAMAGE_TYPES.get(token);
    if (!type) fail("unknown-explosive-damage-type", raw, ctx, `Unknown explosive damage type: ${token}`);
    return type;
  });
}
function damageFormulas(raw, ctx) {
  const value = text(raw);
  if (!value || DASH.test(value)) return [];
  return value.split("+").map((token) => parseDamageFormula(token, ctx));
}
function saveAbility(raw, ctx) {
  const value = text(raw);
  const matches = [
    [/(?:спасбросок|спасброска)\s+Ловкости/iu, "dex"],
    [/(?:спасбросок|спасброска)\s+Силы/iu, "str"],
    [/(?:спасбросок|спасброска)\s+Телосложения/iu, "con"]
  ].filter(([pattern]) => pattern.test(value));
  if (matches.length > 1) fail("ambiguous-explosive-save", raw, ctx, "Explosive properties declare multiple save abilities");
  return matches[0]?.[1] ?? null;
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

export function adaptExplosiveProfiles({ snapshot, referenceIndex, diagnostics = [] }) {
  const fragments = new Map();
  for (const row of snapshot.rows ?? []) {
    const cells = row.cells ?? {};
    if (!text(cells.Название) && Object.entries(cells).every(([column, value]) => column === "Название" || !text(value) || DASH.test(text(value)))) continue;
    const stableId = exactReference(snapshot, row, referenceIndex, diagnostics);
    if (!stableId) continue;
    const types = damageTypes(cells["Тип урона"], context(snapshot, row, "Тип урона"));
    const formulas = damageFormulas(cells.Урон, context(snapshot, row, "Урон"));
    if (types.length !== formulas.length) {
      fail("explosive-damage-arity", cells.Урон, context(snapshot, row, "Урон"), "Explosive damage formulas and types must have the same arity");
    }
    const rawDeployment = text(cells["Оружейная группа"]);
    const deployment = DEPLOYMENTS.get(rawDeployment);
    if (!deployment) fail("unknown-explosive-deployment", rawDeployment, context(snapshot, row, "Оружейная группа"), `Unknown explosive deployment: ${rawDeployment}`);
    const propertiesText = text(cells["Дополнительные свойства"]);
    fragments.set(stableId, { explosive: {
      damage: formulas.map((formula, index) => ({ formula, type: types[index] })),
      saveDc: parseInteger(text(cells["Сл взрывчатки"]), context(snapshot, row, "Сл взрывчатки"), { min: 1, max: 30, label: "explosive save DC" }),
      saveAbility: saveAbility(propertiesText, context(snapshot, row, "Дополнительные свойства")),
      radius: distance(cells["Радиус взрыва"], context(snapshot, row, "Радиус взрыва"), "blast radius"),
      range: distance(cells.Дистанция, context(snapshot, row, "Дистанция"), "explosive range"),
      uses: 1,
      deployment,
      delay: optionalToken(cells["Время задержки"], DELAYS, context(snapshot, row, "Время задержки"), "unknown-explosive-delay", "explosive delay"),
      trigger: optionalToken(cells["Механизм срабатывания"], TRIGGERS, context(snapshot, row, "Механизм срабатывания"), "unknown-explosive-trigger", "explosive trigger"),
      disarm: optionalToken(cells.Обезвреживание, DISARM, context(snapshot, row, "Обезвреживание"), "unknown-explosive-disarm", "explosive disarm"),
      propertiesText: propertiesText && !DASH.test(propertiesText) ? propertiesText : ""
    } });
  }
  throwIfDiagnostics(diagnostics, "Explosive profile adaptation failed");
  return fragments;
}
