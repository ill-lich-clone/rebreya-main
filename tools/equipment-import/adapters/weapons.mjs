import {
  parseDamageFormula,
  parseDelimitedList,
  parseEnum,
  parseInteger,
  parseRange,
  parseRequiredText
} from "../parsers.mjs";
import {
  ImportDiagnosticError,
  createImportDiagnostic,
  throwIfDiagnostics
} from "../validation.mjs";

const DASH = /^(?:-|–|—)$/u;
const DAMAGE_TYPES = Object.freeze({
  "дробящий": "bludgeoning",
  "колющий": "piercing",
  "рубящий": "slashing",
  "огонь": "fire",
  "огнём": "fire",
  "огнем": "fire",
  "огненный": "fire",
  "холод": "cold",
  "кислота": "acid",
  "электричество": "lightning",
  "электричеством": "lightning",
  "яд": "poison",
  "чистая сила": "force",
  "особое": ""
});
const WEAPON_GROUPS = new Set([
  "Древковое", "Грубое", "Разбойничье", "Молоты", "Особое", "Топоры",
  "Арбалеты", "Луки", "Мечи", "Верховой бой", "Цепное"
]);
const WEAPON_SECTION_HEADINGS = new Set([
  "Простое рукопашное оружие", "Простое дальнобойное оружие",
  "Воинское рукопашное оружие", "Воинское дальнобойное оружие"
]);
const FIREARM_GROUPS = new Set(["Пистолетное", "Дробовики", "Винтовочное", "Специальное"]);
const FIREARM_CLASSES = new Map([
  ["примитивное", "primitive"],
  ["примитивное огнестрельное оружие", "primitive"],
  ["стандартное", "advanced"],
  ["продвинутое", "advanced"]
]);
const FIREARM_SUBHEADINGS = new Set(["короткоствольное", "длинноствольное"]);
const AMMUNITION_FAMILIES = new Set([
  "Мушкетные", "Картечный", "Картечные", "Пистолетные", "Ракетные", "Винтовочный",
  "Топливный бак", "Ядра", "Батарея", "Стальной болт + батарея", "Ракетный",
  "Заряды антиматерии", "Тепловая батарея"
]);
const FIREARM_ONLY_HEADERS = Object.freeze([
  "Год изобретения (распространения)", "Дальность", "Руки", "Осечка", "Боеприпасы",
  "Свойство боеприпасов", "Тип стрельбы", "Перезарядка", "Различие конструкции", "Внезапность"
]);
const ROCKET_LAUNCHER_RULE = "Ручница использует ракетные боеприпасы, урон и цена которых зависит от типа боеприпаса";
const FIREARM_SPECIAL_RULES = new Set([
  "Особое",
  "Особое (вместо совершения атаки выстреливает дробью в виде линии шириной 5 футов в пределах дистанции. Сл спасброска расчитывается как для автоматического огня)",
  "Особое(Каждый следующий выстрел по одному и тому же существу в течение минуты наносит на 1к4 урона больше)"
]);

const WEAPON_ADDITIONAL_PROPERTIES = new Map([
  ["Смена хвата: (1d6 Колющий, лишается толкающее), Толкающее", ["lchGrip", "lchPush"]],
  ["Смена хвата: (1d6 Рубящий, лишается Досягаемость 5)", ["lchGrip"]],
  ["Нельзя обезоружить. Скрытное ношение", []],
  ["Силовой удар", ["lchPowerStrike"]],
  ["Перезарядка, прицеливание", ["lod", "lchAim"]],
  ["Смена хвата (1d8 колющий, Толкающее, Наскок 1к2)", ["lchGrip", "lchPush"]],
  ["Смена хвата (Рубящий 1d8, лишается Досягаемость 5, Круговая атака)", ["lchGrip"]],
  ["Особое: (Вы совершаете с помехой атаки длинным копьём по существам, находящимся в пределах 5 футов от вас. Кроме того, если вы не находитесь верхом, длинное копьё используется двумя руками), Толкающее, Верховой бой", ["lchPush", "lchMounted"]],
  ["Смена хвата ( 1d6 колющий, универсальное 1d8)", ["lchGrip"]],
  ["Смена хвата (Мешающее, досягаемость 5), опрокидывающие", ["lchGrip", "lchTrip"]],
  ["Смена хвата (1d6 рубящий, Лишается МКУ)", ["lchGrip"]],
  ["Силовой удар, Толкающее", ["lchPowerStrike", "lchPush"]],
  ["Смена хвата (1d8 Колющий, наскок 3)", ["lchGrip"]],
  ["Смена хвата (1d4 колющий урон, РКУ 1), Толкающее", ["lchGrip", "lchPush"]],
  ["Особое: (Цепи нужно свободное пространство. Если в пределах вашей досягаемости находится больше одного существа, то вы получаете штраф к броскам атаки цепью -2)", ["spc"]],
  ["Верховой бой", ["lchMounted"]],
  ["Толкающее", ["lchPush"]],
  ["Смена хвата (1d10 Рубящий, лишается Досягаемость 5)", ["lchGrip"]],
  ["Особое: (После атаки таким кинжалом, вам нужно Бонусным действием либо одной из доступных атак притянуть кинжал к себе)", ["spc"]],
  ["Нельзя обезоружить", []],
  ["Стрельба навесом", ["lchArcShot"]],
  ["Особое. Существа Большого и меньше размеров, по которым попала атака сетью, становятся опутанными, пока не высвободятся. Сеть не оказывает эффекта на бесформенных существ и тех, чей размер Огромный или ещё больше. Существо может действием совершить проверку Силы Сл 10, чтобы высвободиться самому или освободить другое существо, находящееся в пределах его досягаемости. Причинение сети 5 единиц рубящего урона (КД 10) тоже освобождает существо, не причиняя ему вреда, оканчивая эффект и уничтожая сеть.", ["spc"]],
  ["Верховой бой, Стрельба навесом", ["lchMounted", "lchArcShot"]],
  ["Особое (Этот арбалет использует правила огнестрела со Сменой магазина и имеет 12 болтов)", ["spc"]]
]);

function contextFor(snapshot, row, column) {
  return {
    sheetKey: snapshot.sheetKey,
    range: snapshot.range,
    rowNumber: row.rowNumber,
    column
  };
}

function withColumn(context, column) {
  return { ...context, column };
}

function fail(code, raw, context, message) {
  throw new ImportDiagnosticError(message, [createImportDiagnostic({
    code,
    value: raw,
    message,
    sheetKey: context?.sheetKey ?? null,
    range: context?.range ?? null,
    rowNumber: context?.rowNumber ?? null,
    column: context?.column ?? null
  })]);
}

function text(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

function present(raw) {
  const value = text(raw);
  return value && !DASH.test(value) ? value : "";
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function addProperties(list, values) {
  for (const value of values) addUnique(list, value);
}

function parseParenthesizedFormula(raw, context) {
  const match = text(raw).match(/\(([^()]*)\)/u);
  if (!match) fail("invalid-property-formula", raw, context, "Property must contain one complete parenthesized formula");
  return parseDamageFormula(match[1], context);
}

function parseTrailingInteger(raw, context, label) {
  const match = text(raw).match(/(\d+)\s*$/u);
  if (!match) fail("invalid-property-value", raw, context, `${label} must end with an integer`);
  return parseInteger(match[1], context, { min: 0, label });
}

function parseOptionalInteger(raw, context, label, { min = 0 } = {}) {
  const value = present(raw);
  return value ? parseInteger(value, context, { min, label }) : null;
}

function assertExactToken(raw, expected, context, property) {
  const value = present(raw);
  if (!value) return false;
  if (value !== expected) fail("unknown-weapon-property", raw, context, `Unknown ${property} property: ${value}`);
  return true;
}

function parseDistanceProperty(raw, context) {
  const value = present(raw);
  if (!value) return null;
  const match = value.match(/^(?:Дис\.|Дис|дис\.)\s*(.+)$/u);
  if (!match) fail("invalid-range", raw, context, `Unknown distance property: ${value}`);
  return parseRange(match[1], context);
}

function parseDamageType(raw, context, { optional = false } = {}) {
  const value = present(raw);
  if (!value && optional) return { label: "", id: "" };
  const label = parseRequiredText(raw, context);
  return {
    label,
    id: parseEnum(label, context, { values: DAMAGE_TYPES, label: "damage type" })
  };
}

function assertGroup(raw, allowed, context, label) {
  const value = parseRequiredText(raw, context);
  if (!allowed.has(value)) fail("unknown-weapon-group", raw, context, `Unknown ${label}: ${value}`);
  return value;
}

export function parseWeaponProperties(raw, context = {}) {
  const properties = [];
  const labels = [];
  const values = {};
  let versatileDamageFormula = null;

  const hands = present(raw["Количество рук"]);
  if (!hands) fail("missing-weapon-property", raw["Количество рук"], withColumn(context, "Количество рук"), "Weapon hands property is required");
  {
    const versatile = hands.match(/^Универсальное\s*\(([^()]*)\)$/u);
    if (versatile) {
      versatileDamageFormula = parseDamageFormula(versatile[1], withColumn(context, "Количество рук"));
      addUnique(properties, "ver");
    } else {
      const handsProperty = new Map([["Одноручное", null], ["Двуручное", "two"], ["Особое", "spc"]]).get(hands);
      if (handsProperty === undefined) fail("unknown-weapon-property", hands, withColumn(context, "Количество рук"), `Unknown hands property: ${hands}`);
      addUnique(properties, handsProperty);
    }
    addUnique(labels, hands);
  }

  if (assertExactToken(raw["Смена хвата"], "Смена хвата - См доп. свойства", withColumn(context, "Смена хвата"), "grip")) {
    addUnique(properties, "lchGrip");
    addUnique(labels, text(raw["Смена хвата"]));
  }

  const weightType = present(raw["Тип по весу"]);
  if (weightType) {
    const token = new Map([["Лёгкое", "lgt"], ["Тяжёлое", "hvy"], ["Особое", "spc"]]).get(weightType);
    if (!token) fail("unknown-weapon-property", weightType, withColumn(context, "Тип по весу"), `Unknown weight property: ${weightType}`);
    addUnique(properties, token);
    addUnique(labels, weightType);
  }

  const dash = present(raw.Наскок);
  if (dash) {
    const match = dash.match(/^(?:Наскок|Насок)\s+(\d+)к2$/u);
    if (!match) fail("unknown-weapon-property", dash, withColumn(context, "Наскок"), `Unknown dash property: ${dash}`);
    addUnique(properties, "lchDash");
    values.dashDice = parseDamageFormula(`${match[1]}к2`, withColumn(context, "Наскок"));
    addUnique(labels, dash);
  }

  const exactColumns = [
    ["Фехтовальное", "Фехтовальное", ["fin"]],
    ["Силовое", "Силовое", ["lchPower"]],
    ["Размах", "Размах", ["lchSwing"]],
    ["Обратный замах", "Обратный замах", ["lchBackswing"]],
    ["Мешающее", "Мешающее", ["lchInterfere"]],
    ["Круговая атака", "Круговая атака", ["lchWhirl"]],
    ["Метательное", "Метательное", ["thr"]],
    ["Боеприпас", "Боеприпас", ["amm"]],
    ["Смертельное", "Смертельное", ["lchDeadly"]]
  ];
  for (const [column, expected, tokens] of exactColumns) {
    if (!assertExactToken(raw[column], expected, withColumn(context, column), column)) continue;
    addProperties(properties, tokens);
    addUnique(labels, expected);
    if (column === "Смертельное") values.deadly = 1;
  }

  const reach = present(raw.Досягаемость);
  if (reach) {
    if (!/^Досягаемость\s+\d+$/u.test(reach)) fail("unknown-weapon-property", reach, withColumn(context, "Досягаемость"), `Unknown reach property: ${reach}`);
    addProperties(properties, ["lchReach", "rch"]);
    values.reachBonus = parseTrailingInteger(reach, withColumn(context, "Досягаемость"), "reach bonus");
    addUnique(labels, reach);
  }

  for (const [column, prefix, token, valueKey] of [
    ["Расширенный критический удар", "РКУ", "lchRku", "rku"],
    ["Множитель критического удара", "МКУ", "lchMku", "mku"]
  ]) {
    const value = present(raw[column]);
    if (!value) continue;
    if (!new RegExp(`^${prefix}\\s+\\d+$`, "u").test(value)) fail("unknown-weapon-property", value, withColumn(context, column), `Unknown ${prefix} property: ${value}`);
    addUnique(properties, token);
    values[valueKey] = parseTrailingInteger(value, withColumn(context, column), prefix);
    addUnique(labels, value);
  }

  const distance = parseDistanceProperty(raw["Дистанция. (Дис.)"], withColumn(context, "Дистанция. (Дис.)"));
  if (distance) addUnique(labels, text(raw["Дистанция. (Дис.)"]));

  const minStrength = parseOptionalInteger(raw["Минимальная сила"], withColumn(context, "Минимальная сила"), "minimum strength", { min: 1 });
  if (minStrength !== null) {
    addUnique(properties, "lchStrReq");
    values.minStrength = minStrength;
    addUnique(labels, text(raw["Минимальная сила"]));
  }

  const additional = present(raw["Дополнительные свойства"]);
  if (additional) {
    const extraProperties = WEAPON_ADDITIONAL_PROPERTIES.get(additional);
    if (!extraProperties) fail("unknown-weapon-property", additional, withColumn(context, "Дополнительные свойства"), `Unknown additional weapon property set: ${additional}`);
    addProperties(properties, extraProperties);
    addUnique(labels, additional);
    if (extraProperties.includes("lchGrip")) {
      values.gripModes = [present(raw["Смена хвата"]), additional].filter(Boolean).join("; ");
    }
  }

  return {
    properties,
    labels,
    values,
    distance,
    versatileDamageFormula
  };
}

function parseFirearmAdditional(raw, context, properties, labels, values) {
  const value = present(raw);
  if (!value) return;
  if (value === ROCKET_LAUNCHER_RULE) {
    for (const token of value.split(",").map((part) => part.trim())) addUnique(labels, token);
    return;
  }
  const tokens = parseDelimitedList(value, context, { delimiters: /,/u });
  for (const token of tokens) {
    addUnique(labels, token);
    if (token === "Лёгкое") addUnique(properties, "lgt");
    else if (token === "Тяжелое" || token === "Тяжёлое") addUnique(properties, "hvy");
    else if (token === "Верховой бой") addUnique(properties, "lchMounted");
    else if (token === "Лежачий огонь") addUnique(properties, "lchFirearmProneFire");
    else if (token === "Затворное") addUnique(properties, "lchFirearmBoltAction");
    else if (token === "Пулемёт") addUnique(properties, "lchFirearmMachineGun");
    else if (FIREARM_SPECIAL_RULES.has(token)) addUnique(properties, "spc");
    else if (/^Перегрев \(\d+\)$/u.test(token)) {
      addUnique(properties, "lchFirearmOverheat");
      values.overheat = parseTrailingInteger(token.slice(0, -1), context, "overheat");
    } else if (/^МКУ \d+$/u.test(token)) {
      addUnique(properties, "lchMku");
      values.mku = parseTrailingInteger(token, context, "MKU");
    } else {
      fail("unknown-firearm-property", token, context, `Unknown additional firearm property: ${token}`);
    }
  }
}

export function parseFirearmProfile(row, context = {}) {
  const cells = row.cells ?? row;
  const rowContext = { ...context, rowNumber: row.rowNumber ?? context.rowNumber };
  const properties = ["amm", "lchFirearmWaterVulnerability"];
  const labels = [];
  const values = {};
  const firearmClass = parseEnum(context.firearmClass ?? "", withColumn(rowContext, "Название"), {
    values: { primitive: "primitive", advanced: "advanced" },
    label: "firearm class"
  });

  assertGroup(cells["Оружейная группа"], FIREARM_GROUPS, withColumn(rowContext, "Оружейная группа"), "firearm group");
  const inventionYear = parseOptionalInteger(cells["Год изобретения (распространения)"], withColumn(rowContext, "Год изобретения (распространения)"), "invention year");
  if (inventionYear !== null) values.inventionYear = inventionYear;

  const hands = parseEnum(cells.Руки, withColumn(rowContext, "Руки"), {
    values: { "одноручное": null, "двуручное": "two" },
    label: "firearm hands"
  });
  addUnique(properties, hands);
  addUnique(labels, text(cells.Руки));

  const sourceRange = text(cells.Дальность) === "Особое"
    ? null
    : parseRange(cells.Дальность, withColumn(rowContext, "Дальность"));
  addUnique(labels, `Дальность ${text(cells.Дальность)}`);

  const misfire = parseOptionalInteger(cells.Осечка, withColumn(rowContext, "Осечка"), "misfire", { min: 1 });
  if (misfire !== null) {
    addUnique(properties, "lchFirearmMisfire");
    values.misfire = misfire;
    addUnique(labels, `Осечка ${misfire}`);
  }

  const ammunition = present(cells.Боеприпасы);
  if (!ammunition || !AMMUNITION_FAMILIES.has(ammunition)) {
    fail("unknown-ammunition-family", cells.Боеприпасы, withColumn(rowContext, "Боеприпасы"), `Unknown firearm ammunition family: ${ammunition || "<blank>"}`);
  }
  addUnique(properties, "lchFirearmAmmunition");
  values.ammunition = ammunition;
  addUnique(labels, `Боеприпасы: ${ammunition}`);

  const ammoProperty = present(cells["Свойство боеприпасов"]);
  if (ammoProperty) {
    addUnique(properties, "lchFirearmAmmoProperty");
    values.ammoProperty = ammoProperty;
    addUnique(labels, ammoProperty);
    if (/^Разброс \([^()]+\)$/u.test(ammoProperty)) {
      addUnique(properties, "lchFirearmScatter");
      values.scatterDamage = parseParenthesizedFormula(ammoProperty, withColumn(rowContext, "Свойство боеприпасов"));
    } else if (ammoProperty === "Взрывное") addUnique(properties, "lchFirearmExplosive");
    else if (ammoProperty === "Особое") addUnique(properties, "spc");
    else fail("unknown-firearm-property", ammoProperty, withColumn(rowContext, "Свойство боеприпасов"), `Unknown ammunition property: ${ammoProperty}`);
  }

  const fireMode = present(cells["Тип стрельбы"]);
  const fireModeDefinition = new Map([
    ["Одиночные", []], ["Одиночный", []], ["Особый", []], ["Одиночные/особый", []],
    ["Автоматический (6d4)", ["automatic"]], ["Автоматический (4d8)", ["automatic"]],
    ["Полуавтоматический (2d12)", ["automatic", "semiAutomatic"]]
  ]).get(fireMode);
  if (!fireMode || !fireModeDefinition) fail("unknown-firearm-mode", fireMode, withColumn(rowContext, "Тип стрельбы"), `Unknown firearm mode: ${fireMode || "<blank>"}`);
  addUnique(properties, "lchFirearmFireMode");
  values.fireMode = fireMode;
  addUnique(labels, fireMode);
  for (const mode of fireModeDefinition) {
    if (mode === "automatic") {
      addUnique(properties, "lchFirearmAutomatic");
      values.automaticDamage = parseParenthesizedFormula(fireMode, withColumn(rowContext, "Тип стрельбы"));
    } else {
      addUnique(properties, "lchFirearmSemiAutomatic");
      values.semiAutomaticDamage = parseParenthesizedFormula(fireMode, withColumn(rowContext, "Тип стрельбы"));
    }
  }

  const reload = present(cells.Перезарядка);
  if (!/^(?:Перезарядка|Долгая перезарядка|Смена магазина|Долгая смена магазина|Безмагазиное|Безмагазинное) \d+$/u.test(reload)) {
    fail("unknown-firearm-reload", reload, withColumn(rowContext, "Перезарядка"), `Unknown firearm reload: ${reload || "<blank>"}`);
  }
  addUnique(properties, "lchFirearmReload");
  values.reload = reload;
  addUnique(labels, reload);

  const minStrength = parseOptionalInteger(cells["Минимальная сила"], withColumn(rowContext, "Минимальная сила"), "minimum strength", { min: 1 });
  if (minStrength !== null) {
    addUnique(properties, "lchStrReq");
    values.minStrength = minStrength;
    addUnique(labels, `Мин. сила ${minStrength}`);
  }

  const construction = present(cells["Различие конструкции"]);
  if (construction) {
    if (construction !== "Громоздкое") fail("unknown-firearm-property", construction, withColumn(rowContext, "Различие конструкции"), `Unknown firearm construction: ${construction}`);
    addProperties(properties, ["lchFirearmConstruction", "lchFirearmBulky"]);
    values.construction = construction;
    addUnique(labels, construction);
  }

  const surprise = present(cells.Внезапность);
  if (surprise) {
    addUnique(properties, "lchFirearmSurprise");
    values.surpriseDamage = parseDamageFormula(surprise, withColumn(rowContext, "Внезапность"));
    addUnique(labels, `Внезапность ${values.surpriseDamage}`);
  }

  parseFirearmAdditional(cells["Дополнительные свойства"], withColumn(rowContext, "Дополнительные свойства"), properties, labels, values);
  const damage = parseDamageType(cells["Тип урона"], withColumn(rowContext, "Тип урона"));
  const rawDamage = text(cells.Урон);
  const damageFormula = rawDamage === "Особое"
    ? ""
    : parseDamageFormula(cells.Урон, withColumn(rowContext, "Урон"));
  if (rawDamage === "Особое" && damage.label !== "Особое") {
    fail("invalid-special-damage", rawDamage, withColumn(rowContext, "Урон"), "Special firearm damage requires the Особое damage type");
  }
  const propertiesText = labels.join("; ");
  return {
    damageFormula,
    damageTypeLabel: damage.label,
    damageType: damage.id,
    propertiesText,
    properties,
    range: sourceRange
      ? { value: sourceRange.normal, long: sourceRange.long ?? 0, reach: 0, units: "ft" }
      : null,
    attackTraitsText: propertiesText,
    attackTraits: {},
    lichWeaponPropertyValues: values,
    firearmAttackType: "firearm",
    firearmClass
  };
}

function exactReference(snapshot, row, referenceIndex, diagnostics) {
  const sourceRef = `${snapshot.sheetTitle}!A${row.rowNumber}`;
  const reference = referenceIndex?.gearBySourceRef?.get(sourceRef);
  if (!reference) {
    diagnostics.push(createImportDiagnostic({
      code: "missing-equipment-reference",
      sheetKey: snapshot.sheetKey,
      range: snapshot.range,
      rowNumber: row.rowNumber,
      column: "Название",
      value: row.cells?.Название ?? "",
      message: `Missing exact equipment reference for ${sourceRef}`
    }));
    return null;
  }
  const stableId = referenceIndex.resolveStableGearId?.(reference);
  if (!stableId) fail("missing-stable-identity", sourceRef, contextFor(snapshot, row, "Название"), `Missing stable identity for ${sourceRef}`);
  return stableId;
}

function adaptOrdinaryWeapon(snapshot, row) {
  const cells = row.cells ?? {};
  for (const header of FIREARM_ONLY_HEADERS) {
    if (!present(cells[header])) continue;
    fail("firearm-field-on-weapon", cells[header], contextFor(snapshot, row, header), `${header} is valid only for a firearm row`);
  }
  assertGroup(cells["Оружейная группа"], WEAPON_GROUPS, contextFor(snapshot, row, "Оружейная группа"), "weapon group");
  const parsed = parseWeaponProperties(cells, contextFor(snapshot, row, null));
  const damage = parseDamageType(cells["Тип урона"], contextFor(snapshot, row, "Тип урона"), { optional: true });
  const damageFormula = parseDamageFormula(cells.Урон, contextFor(snapshot, row, "Урон"), { optional: true }) ?? "";
  const propertiesText = parsed.labels.join("; ");
  const weapon = {
    damageFormula,
    damageType: damage.id,
    damageTypeLabel: damage.label,
    properties: parsed.properties,
    propertiesText,
    range: {
      value: parsed.distance?.normal ?? 0,
      long: parsed.distance?.long ?? 0,
      reach: 5,
      units: "ft"
    }
  };
  if (parsed.versatileDamageFormula) weapon.versatileDamageFormula = parsed.versatileDamageFormula;
  if (Object.keys(parsed.values).length) weapon.lichWeaponPropertyValues = parsed.values;
  weapon.attackTraitsText = propertiesText;
  return weapon;
}

export function adaptWeaponProfiles({ snapshots, referenceIndex, diagnostics = [] }) {
  const fragments = new Map();
  const weapons = snapshots?.weapons;
  const firearms = snapshots?.firearms;
  if (!weapons || !firearms) fail("missing-weapon-snapshot", "", {}, "Weapon and firearm snapshots are required");

  for (const row of weapons.rows ?? []) {
    if (!text(row.cells?.Урон)) {
      const heading = text(row.cells?.Название);
      if (!WEAPON_SECTION_HEADINGS.has(heading)) {
        fail("unknown-weapon-section", heading, contextFor(weapons, row, "Название"), `Unknown weapon section: ${heading}`);
      }
      continue;
    }
    const stableId = exactReference(weapons, row, referenceIndex, diagnostics);
    if (!stableId) continue;
    fragments.set(stableId, { weapon: adaptOrdinaryWeapon(weapons, row) });
  }

  let firearmClass = null;
  for (const row of firearms.rows ?? []) {
    const cells = row.cells ?? {};
    if (!text(cells.Урон)) {
      const heading = text(cells.Название).toLocaleLowerCase("ru-RU");
      if (FIREARM_CLASSES.has(heading)) firearmClass = FIREARM_CLASSES.get(heading);
      else if (!FIREARM_SUBHEADINGS.has(heading)) fail("unknown-firearm-section", cells.Название, contextFor(firearms, row, "Название"), `Unknown firearm section: ${cells.Название}`);
      continue;
    }
    if (!firearmClass) fail("missing-firearm-class", cells.Название, contextFor(firearms, row, "Название"), "Firearm row appears before a declared firearm class");
    const stableId = exactReference(firearms, row, referenceIndex, diagnostics);
    if (!stableId) continue;
    const weapon = parseFirearmProfile(row, {
      sheetKey: firearms.sheetKey,
      range: firearms.range,
      firearmClass
    });
    fragments.set(stableId, { weapon, firearmClass });
  }

  throwIfDiagnostics(diagnostics, "Weapon profile adaptation failed");
  return fragments;
}
