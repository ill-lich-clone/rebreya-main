import { MODULE_ID, REBREYA_TOOLS } from "../constants.js";
import { GROUP_CONTEXT_ERRORS } from "./group-context-service.js";

const KNOWN_GROUP_CONTEXT_ERROR_MESSAGES = new Set(Object.values(GROUP_CONTEXT_ERRORS));

const STATUS_META = Object.freeze({
  pending: {
    label: "Ожидает",
    type: "info"
  },
  approved: {
    label: "Одобрено",
    type: "good"
  },
  returned: {
    label: "Возвращено",
    type: "warning"
  },
  rejected: {
    label: "Отклонено",
    type: "danger"
  },
  completed: {
    label: "Завершено",
    type: "good"
  }
});

const ABILITY_LABELS = Object.freeze({
  str: "Сила",
  dex: "Ловкость",
  con: "Телосложение",
  int: "Интеллект",
  wis: "Мудрость",
  cha: "Харизма"
});

const ROLLABLE_SOURCE_TYPES = new Set(["skill", "ability", "save", "tool"]);
const ARCHIVED_REQUEST_STATUSES = new Set(["completed", "rejected"]);
const REQUEST_PAGE_SIZE = 5;
const NON_CHECK_ACTION_TYPES = new Set(["resources", "itemChoice", "numericInput", "optionChoice", "rankChoice", "formulaRoll", "projectCounter", "downtimeResult"]);
const NON_CHECK_ACTION_SUMMARY_LABELS = Object.freeze({
  resources: "Ресурсы",
  itemChoice: "Предмет",
  numericInput: "Числовой ресурс",
  optionChoice: "Выбор",
  rankChoice: "Выбор ранга",
  formulaRoll: "Формула",
  projectCounter: "Счётчик",
  downtimeResult: "Итог"
});

const CURRENCY_LABELS = Object.freeze({
  gp: "зм",
  sp: "см",
  cp: "мм",
  pp: "пм"
});

const CHECK_SOURCE_OPTIONS = Object.freeze([
  { value: "skill", label: "Навык" },
  { value: "ability", label: "Характеристика" },
  { value: "tool", label: "Инструмент" }
]);

const CHECK_ABILITY_OPTIONS = Object.freeze([
  { value: "", label: "Из листа" },
  { value: "str", label: "Сила" },
  { value: "dex", label: "Ловкость" },
  { value: "con", label: "Телосложение" },
  { value: "int", label: "Интеллект" },
  { value: "wis", label: "Мудрость" },
  { value: "cha", label: "Харизма" }
]);

const CHECK_SKILL_OPTIONS = Object.freeze([
  { value: "acr", label: "Акробатика", ability: "dex" },
  { value: "ani", label: "Уход за животными", ability: "wis" },
  { value: "arc", label: "Магия", ability: "int" },
  { value: "ath", label: "Атлетика", ability: "str" },
  { value: "dec", label: "Обман", ability: "cha" },
  { value: "his", label: "История", ability: "int" },
  { value: "ins", label: "Проницательность", ability: "wis" },
  { value: "itm", label: "Запугивание", ability: "cha" },
  { value: "inv", label: "Расследование", ability: "int" },
  { value: "med", label: "Медицина", ability: "wis" },
  { value: "nat", label: "Природа", ability: "int" },
  { value: "prc", label: "Восприятие", ability: "wis" },
  { value: "prf", label: "Выступление", ability: "cha" },
  { value: "per", label: "Убеждение", ability: "cha" },
  { value: "rel", label: "Религия", ability: "int" },
  { value: "slt", label: "Ловкость рук", ability: "dex" },
  { value: "ste", label: "Скрытность", ability: "dex" },
  { value: "sur", label: "Выживание", ability: "wis" }
]);

const CHECK_ABILITY_TARGET_OPTIONS = Object.freeze(CHECK_ABILITY_OPTIONS
  .filter((option) => option.value)
  .map((option) => ({ value: option.value, label: option.label, ability: option.value })));

const CHECK_TOOL_OPTIONS = Object.freeze(REBREYA_TOOLS.map((tool) => ({
  value: tool.id,
  label: tool.label,
  ability: ""
})));

function cleanText(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveTemplateDescriptionHtml(action = {}) {
  return cleanText(action.descriptionHtml)
    || cleanText(action.description?.value)
    || cleanText(action.system?.description?.value);
}

function toInteger(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
}

function toFiniteNumber(value, fallback = undefined) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function createSelectedOptions(options = [], selectedValue = "") {
  const safeSelectedValue = cleanText(selectedValue);
  return options.map((option) => ({
    ...option,
    selected: cleanText(option.value) === safeSelectedValue
  }));
}

function getCheckTargetOptions(sourceType = "skill") {
  const safeSourceType = cleanText(sourceType) || "skill";
  if (safeSourceType === "ability") {
    return CHECK_ABILITY_TARGET_OPTIONS;
  }
  if (safeSourceType === "tool") {
    return CHECK_TOOL_OPTIONS;
  }
  return CHECK_SKILL_OPTIONS;
}

function getCheckTargetOption(value = "", sourceType = "skill") {
  const safeValue = cleanText(value);
  return getCheckTargetOptions(sourceType).find((option) => option.value === safeValue) ?? null;
}

function getDefaultCheckTargetOption(sourceType = "skill") {
  return getCheckTargetOptions(sourceType)[0] ?? null;
}

function normalizeLookupText(value = "") {
  return cleanText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[^a-zа-я0-9+-]+/giu, "");
}

const BARGAINING_OPTION_ID_BY_TEXT = Object.freeze({
  [normalizeLookupText("Запрещённые")]: "forbidden",
  [normalizeLookupText("Запрещенные")]: "forbidden",
  [normalizeLookupText("Невозможные")]: "impossible",
  [normalizeLookupText("Провальные")]: "failed",
  [normalizeLookupText("Невыгодные")]: "bad",
  [normalizeLookupText("Нормальные")]: "normal",
  [normalizeLookupText("Выгодные")]: "favorable",
  [normalizeLookupText("Удачные")]: "good"
});

const RARITY_KEY_BY_TEXT = Object.freeze({
  [normalizeLookupText("Обычный")]: "common",
  [normalizeLookupText("Обычная")]: "common",
  [normalizeLookupText("common")]: "common",
  [normalizeLookupText("Необычный")]: "uncommon",
  [normalizeLookupText("Необычная")]: "uncommon",
  [normalizeLookupText("uncommon")]: "uncommon",
  [normalizeLookupText("Редкий")]: "rare",
  [normalizeLookupText("Редкая")]: "rare",
  [normalizeLookupText("rare")]: "rare",
  [normalizeLookupText("Очень редкий")]: "veryRare",
  [normalizeLookupText("Очень редкая")]: "veryRare",
  [normalizeLookupText("veryRare")]: "veryRare",
  [normalizeLookupText("very rare")]: "veryRare",
  [normalizeLookupText("Легендарный")]: "legendary",
  [normalizeLookupText("Легендарная")]: "legendary",
  [normalizeLookupText("legendary")]: "legendary"
});

function parseRebreyaSignature(value = "") {
  const text = cleanText(value);
  if (!text.startsWith("{")) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }
  catch (_error) {
    return {};
  }
}

function getItemSignatureData(item = {}) {
  const rebreya = asObject(item.rebreya);
  const flags = asObject(item.documentSnapshot?.flags?.[MODULE_ID]);
  return {
    ...parseRebreyaSignature(flags.signature),
    ...parseRebreyaSignature(rebreya.signature)
  };
}

function getSelectedItemBargaining(item = {}) {
  const rebreya = asObject(item.rebreya);
  const signature = getItemSignatureData(item);
  return cleanText(item.bargaining)
    || cleanText(item.itemBargaining)
    || cleanText(rebreya.bargaining)
    || cleanText(rebreya.itemBargaining)
    || cleanText(signature.bargaining);
}

function normalizeRarityKey(value = "") {
  return RARITY_KEY_BY_TEXT[normalizeLookupText(value)] || cleanText(value);
}

function getSelectedItemRarityKey(item = {}) {
  const rebreya = asObject(item.rebreya);
  const signature = getItemSignatureData(item);
  return normalizeRarityKey(
    cleanText(item.rarity)
      || cleanText(rebreya.rarity)
      || cleanText(signature.rarity)
      || cleanText(item.documentSnapshot?.system?.rarity)
  );
}

function cleanFormulaText(value = "") {
  const text = cleanText(value)
    .replace(/\s*(зм|gp)\.?\s*$/iu, "")
    .trim();
  return text && text !== "-" && text !== "—" ? text : "";
}

function getSelectedItemCostFormula(item = {}) {
  const rebreya = asObject(item.rebreya);
  const signature = getItemSignatureData(item);
  return cleanFormulaText(item.costText)
    || cleanFormulaText(item.itemCost)
    || cleanFormulaText(rebreya.costText)
    || cleanFormulaText(rebreya.itemCost)
    || cleanFormulaText(signature.costText)
    || cleanFormulaText(signature.itemCost);
}

function findSelectedItemAction(mappedActionsById = new Map(), itemActionId = "") {
  const safeItemActionId = cleanText(itemActionId);
  if (safeItemActionId) {
    const action = mappedActionsById.get(safeItemActionId);
    if (action?.selectedItem) {
      return action;
    }
  }

  return [...mappedActionsById.values()].find((action) => action?.selectedItem) ?? null;
}

function resolveBargainingOptionId(options = [], mappedActionsById = new Map()) {
  const itemAction = findSelectedItemAction(mappedActionsById);
  const bargaining = getSelectedItemBargaining(itemAction?.selectedItem);
  if (!bargaining) {
    return "";
  }

  const numericBargaining = toFiniteNumber(bargaining);
  if (numericBargaining !== undefined) {
    const numericOption = options.find((option) => toFiniteNumber(option?.value) === numericBargaining);
    if (numericOption?.id) {
      return cleanText(numericOption.id);
    }
  }

  const mappedId = BARGAINING_OPTION_ID_BY_TEXT[normalizeLookupText(bargaining)];
  if (mappedId && options.some((option) => cleanText(option.id) === mappedId)) {
    return mappedId;
  }

  const bargainingKey = normalizeLookupText(bargaining);
  return cleanText(options.find((option) => normalizeLookupText(option?.label) === bargainingKey)?.id);
}

function resolveFormulaRollFormula(action = {}, selection = {}, mappedActionsById = new Map()) {
  const explicitFormula = cleanFormulaText(selection?.formula)
    || cleanFormulaText(action.selectedFormula)
    || cleanFormulaText(action.formula);
  if (explicitFormula) {
    return explicitFormula;
  }

  const itemAction = findSelectedItemAction(mappedActionsById, action.itemActionId);
  const selectedItem = itemAction?.selectedItem;
  if (!selectedItem) {
    return "";
  }

  const itemFormula = getSelectedItemCostFormula(selectedItem);
  if (itemFormula) {
    return itemFormula;
  }

  const rarityKey = getSelectedItemRarityKey(selectedItem);
  const formulaByRarity = asObject(action.formulaByRarity);
  return cleanFormulaText(formulaByRarity[rarityKey]);
}

function normalizeWeeks(value, fallback = 1) {
  return Math.max(1, toInteger(value, fallback));
}

function isKnownGroupContextError(error) {
  return KNOWN_GROUP_CONTEXT_ERROR_MESSAGES.has(error?.message);
}

function buildBalance(value = {}) {
  return {
    availableWeeks: toInteger(value.availableWeeks, 0),
    reservedWeeks: toInteger(value.reservedWeeks, 0),
    spentWeeks: toInteger(value.spentWeeks, 0),
    totalGrantedWeeks: toInteger(value.totalGrantedWeeks, 0)
  };
}

function buildCheckSummary(check = {}) {
  const actionType = cleanText(check.actionType);
  if (NON_CHECK_ACTION_TYPES.has(actionType)) {
    const prefix = NON_CHECK_ACTION_SUMMARY_LABELS[actionType] ?? "Целевое действие";
    const label = cleanText(check.label);
    return label ? `${prefix}: ${label}` : prefix;
  }
  const dc = cleanText(check.dc);
  const outcomeMode = cleanText(check.outcomeMode) || (dc ? "dc" : "freeform");
  const numericDc = Number(dc.replace(/^dc\s*/iu, ""));
  const shouldShowDc = ["dc", "dc-sum"].includes(outcomeMode)
    && dc
    && (!Number.isFinite(numericDc) || numericDc > 0);
  const ability = cleanText(check.ability);
  const abilityLabel = ABILITY_LABELS[ability] ?? ability;
  const sourceType = cleanText(check.sourceType) || "skill";
  const targetLabel = cleanText(check.targetLabel) || cleanText(check.label) || cleanText(check.target);
  let summary = cleanText(check.label) || "Проверка";

  if (sourceType === "save") {
    summary = ability === "death" ? "Спасбросок смерти" : `Спасбросок: ${abilityLabel}`;
  }
  else if (sourceType === "ability") {
    summary = `Проверка: ${abilityLabel}`;
  }
  else if (sourceType === "tool") {
    summary = abilityLabel && targetLabel
      ? `Инструмент: ${abilityLabel} (${targetLabel})`
      : `Инструмент: ${targetLabel || abilityLabel || cleanText(check.label) || "проверка"}`;
  }
  else if (abilityLabel && targetLabel) {
    summary = `Проверка: ${abilityLabel} (${targetLabel})`;
  }
  else if (targetLabel) {
    summary = `Проверка: ${targetLabel}`;
  }

  return [
    summary,
    shouldShowDc ? `DC ${dc.replace(/^dc\s*/iu, "")}` : ""
  ].filter(Boolean).join(" | ");
}

function buildResourceSummary(check = {}) {
  const resources = check?.resources && typeof check.resources === "object" && !Array.isArray(check.resources)
    ? check.resources
    : {};
  const cost = resources.cost && typeof resources.cost === "object" && !Array.isArray(resources.cost)
    ? resources.cost
    : {};
  const amount = toInteger(cost.amount, 0);
  const currency = CURRENCY_LABELS[cleanText(cost.currency)] ?? cleanText(cost.currency);
  if (amount > 0 && currency) {
    return `${amount} ${currency}`;
  }
  return cleanText(cost.formula) || cleanText(resources.narrative) || "Ресурсы";
}

function buildResourceChoiceSummary(choice = {}) {
  return buildResourceSummary({
    resources: {
      narrative: choice.narrative,
      cost: choice.cost
    }
  });
}

function buildSubmittedActionOutcomeSummary(check = {}) {
  const actionType = cleanText(check.actionType);
  if (actionType === "rankChoice") {
    return cleanText(check.selectedOptionLabel)
      || (check.selectedRank !== undefined ? `Ранг ${check.selectedRank}` : "");
  }
  if (actionType === "resources") {
    if (cleanText(check.computedCost?.label)) {
      return cleanText(check.computedCost.label);
    }
    if (check.computedCost?.total !== undefined) {
      const currency = CURRENCY_LABELS[cleanText(check.computedCost.currency)] ?? cleanText(check.computedCost.currency);
      return [check.computedCost.total, currency].filter(Boolean).join(" ");
    }
    return buildResourceSummary(check);
  }
  if (actionType === "projectCounter") {
    const counter = asObject(check.projectCounter);
    const current = toFiniteNumber(counter.current, toFiniteNumber(counter.value));
    const max = toFiniteNumber(counter.max);
    return current !== undefined && max !== undefined ? `${current} / ${max}` : cleanText(check.label);
  }
  if (actionType === "numericInput") {
    return check.numericValue !== undefined
      ? [check.numericValue, cleanText(check.input?.unit)].filter(Boolean).join(" ")
      : "";
  }
  if (actionType === "optionChoice") {
    return cleanText(check.selectedOptionLabel);
  }
  if (actionType === "downtimeResult") {
    return buildResultLabel(check.result) || cleanText(check.label);
  }
  return buildResultLabel(check.result);
}

function normalizeSelectedItem(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const uuid = cleanText(item.uuid);
  const id = cleanText(item.id);
  const rawName = cleanText(item.name);
  if (!uuid && !id && !rawName) {
    return null;
  }

  const selectedItem = {
    name: rawName || "Предмет"
  };
  if (uuid) {
    selectedItem.uuid = uuid;
  }
  if (id) {
    selectedItem.id = id;
  }
  const img = cleanText(item.img);
  if (img) {
    selectedItem.img = img;
  }
  const type = cleanText(item.type);
  if (type) {
    selectedItem.type = type;
  }
  const sourceType = cleanText(item.sourceType);
  if (sourceType) {
    selectedItem.sourceType = sourceType;
  }
  const rarity = cleanText(item.rarity);
  if (rarity) {
    selectedItem.rarity = rarity;
  }
  const costText = cleanText(item.costText) || cleanText(item.itemCost);
  if (costText) {
    selectedItem.costText = costText;
  }
  const priceGold = toFiniteNumber(item.priceGold);
  if (priceGold !== undefined) {
    selectedItem.priceGold = priceGold;
  }
  const rebreya = asObject(item.rebreya);
  if (Object.keys(rebreya).length) {
    selectedItem.rebreya = clone(rebreya);
  }
  else {
    const flags = asObject(item.flags);
    const moduleFlags = asObject(flags[MODULE_ID]);
    if (Object.keys(moduleFlags).length) {
      selectedItem.rebreya = clone(moduleFlags);
    }
  }
  const documentSnapshot = asObject(item.documentSnapshot);
  if (Object.keys(documentSnapshot).length) {
    selectedItem.documentSnapshot = clone(documentSnapshot);
  }
  else {
    const itemData = asObject(item.itemData);
    if (Object.keys(itemData).length) {
      selectedItem.documentSnapshot = clone(itemData);
    }
  }
  const selectedSourceType = cleanText(selectedItem.sourceType) || cleanText(selectedItem.rebreya?.sourceType);
  if (selectedSourceType && !selectedItem.sourceType) {
    selectedItem.sourceType = selectedSourceType;
  }
  const sourceId = cleanText(item.sourceId)
    || cleanText(selectedItem.rebreya?.sourceId)
    || cleanText(selectedItem.rebreya?.magicItemId)
    || cleanText(selectedItem.rebreya?.gearId)
    || cleanText(selectedItem.rebreya?.materialId);
  if (sourceId) {
    selectedItem.sourceId = sourceId;
  }
  const magicItemId = cleanText(selectedItem.rebreya?.magicItemId);
  if (magicItemId) {
    selectedItem.magicItemId = magicItemId;
  }
  const gearId = cleanText(selectedItem.rebreya?.gearId);
  if (gearId) {
    selectedItem.gearId = gearId;
  }
  const materialId = cleanText(selectedItem.rebreya?.materialId);
  if (materialId) {
    selectedItem.materialId = materialId;
  }
  const signature = getItemSignatureData(selectedItem);
  const signatureCostText = cleanText(signature.costText) || cleanText(signature.itemCost);
  if (signatureCostText && !selectedItem.costText) {
    selectedItem.costText = signatureCostText;
  }
  if (selectedItem.rebreya && signatureCostText && !cleanText(selectedItem.rebreya.costText)) {
    selectedItem.rebreya.costText = signatureCostText;
  }
  return selectedItem;
}

function normalizeSelectionEntry(entry = {}) {
  const actionId = cleanText(entry?.actionId);
  if (!actionId) {
    return null;
  }

  const selection = {
    actionId
  };
  const choiceId = cleanText(entry?.choiceId);
  const optionId = cleanText(entry?.optionId);
  const optionIds = Array.isArray(entry?.optionIds)
    ? entry.optionIds.map((id) => cleanText(id)).filter(Boolean)
    : [];
  const numericValue = toFiniteNumber(entry?.value);
  const formula = cleanFormulaText(entry?.formula);
  const result = toFiniteNumber(entry?.result);
  const item = normalizeSelectedItem(entry?.item);

  if (choiceId) {
    selection.choiceId = choiceId;
  }
  if (optionId) {
    selection.optionId = optionId;
  }
  if (optionIds.length) {
    selection.optionIds = optionIds;
  }
  if (numericValue !== undefined) {
    selection.value = numericValue;
  }
  if (formula) {
    selection.formula = formula;
  }
  if (result !== undefined) {
    selection.result = result;
  }
  const sourceType = cleanText(entry?.sourceType);
  if (sourceType) {
    selection.sourceType = sourceType;
  }
  const ability = cleanText(entry?.ability);
  if (ability) {
    selection.ability = ability;
  }
  const target = cleanText(entry?.target);
  if (target) {
    selection.target = target;
  }
  const targetLabel = cleanText(entry?.targetLabel);
  if (targetLabel) {
    selection.targetLabel = targetLabel;
  }
  const dc = toFiniteNumber(entry?.dc);
  if (dc !== undefined) {
    selection.dc = dc;
  }
  if (item) {
    selection.item = item;
  }

  return selection;
}

function normalizeTargetActionSelections(value = []) {
  const selections = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const selection = normalizeSelectionEntry(entry);
    if (selection) {
      selections.set(selection.actionId, selection);
    }
  }
  return selections;
}

function buildResourceChoices(action = {}, selectedChoiceId = "") {
  const resources = action?.resources && typeof action.resources === "object" && !Array.isArray(action.resources)
    ? action.resources
    : {};
  return (Array.isArray(resources.choices) ? resources.choices : [])
    .map((choice, index) => {
      const id = cleanText(choice?.id) || `choice-${index + 1}`;
      const label = cleanText(choice?.label) || cleanText(choice?.name) || `Выбор ${index + 1}`;
      return {
        ...choice,
        id,
        label,
        outcomeSummary: buildResourceChoiceSummary(choice),
        requirement: cleanText(choice?.requirement),
        selected: id === selectedChoiceId
      };
    })
    .filter((choice) => choice.id && choice.label);
}

function buildOptionChoices(action = {}, selection = {}, mappedActionsById = new Map()) {
  const rawOptions = Array.isArray(action?.options) ? action.options : [];
  const inferredOptionId = cleanText(selection?.optionId) || resolveBargainingOptionId(rawOptions, mappedActionsById);
  const selectedIds = new Set([
    inferredOptionId,
    ...(Array.isArray(selection?.optionIds) ? selection.optionIds.map((id) => cleanText(id)) : [])
  ].filter(Boolean));
  const selectionMode = cleanText(action?.selectionMode) || "single";
  const options = rawOptions
    .map((option, index) => {
      const id = cleanText(option?.id) || `option-${index + 1}`;
      const label = cleanText(option?.label) || cleanText(option?.name) || `Вариант ${index + 1}`;
      return {
        ...option,
        id,
        label,
        displayLabel: option?.value !== undefined && toFiniteNumber(option.value) !== undefined
          ? `${label} (${toFiniteNumber(option.value) > 0 ? "+" : ""}${toFiniteNumber(option.value)})`
          : label,
        selected: selectedIds.has(id)
      };
    })
    .filter((option) => option.id && option.label);

  if (selectionMode !== "multiple" && options.length && !options.some((option) => option.selected)) {
    options[0].selected = true;
  }

  return options;
}

function buildRankChoices(action = {}, selection = {}) {
  const rankChoice = action?.rankChoice && typeof action.rankChoice === "object" && !Array.isArray(action.rankChoice)
    ? action.rankChoice
    : {};
  const configuredRows = Array.isArray(rankChoice.rows) && rankChoice.rows.length
    ? rankChoice.rows
    : (Array.isArray(action.options) ? action.options : []);
  const rows = configuredRows.length
    ? configuredRows
    : Array.from({
      length: Math.max(0, Math.min(10, toInteger(rankChoice.max, 10)) - Math.max(0, toInteger(rankChoice.min, 0)) + 1)
    }, (_entry, index) => ({
      rank: Math.max(0, toInteger(rankChoice.min, 0)) + index
    }));
  const selectedId = cleanText(selection?.optionId);
  const selectedValue = toFiniteNumber(selection?.value);
  const defaultRank = toFiniteNumber(rankChoice.default);
  const mapped = rows.map((row, index) => {
    const rank = toInteger(row?.rank, index);
    const id = cleanText(row?.id) || `rank-${rank}`;
    return {
      ...row,
      id,
      rank,
      label: cleanText(row?.label) || `Ранг ${rank}`,
      selected: id === selectedId || (selectedValue !== undefined && rank === selectedValue)
    };
  }).filter((row) => row.id && row.label);

  if (mapped.length && !mapped.some((row) => row.selected)) {
    const defaultRow = mapped.find((row) => defaultRank !== undefined && row.rank === defaultRank) ?? mapped[0];
    defaultRow.selected = true;
  }

  return mapped;
}

function getSelectedOptionSummary(options = []) {
  return options
    .filter((option) => option.selected)
    .map((option) => cleanText(option.label))
    .filter(Boolean)
    .join(", ");
}

function getSelectedRankSummary(options = []) {
  return options.find((option) => option.selected) ?? null;
}

function buildNumericInput(action = {}, selection = {}) {
  const input = action?.input && typeof action.input === "object" && !Array.isArray(action.input)
    ? action.input
    : {};
  const selectedValue = toFiniteNumber(selection?.value, toFiniteNumber(input.default));
  return {
    ...input,
    value: selectedValue,
    displayValue: selectedValue === undefined ? "" : String(selectedValue),
    unit: cleanText(input.unit),
    min: input.min ?? "",
    max: input.max ?? "",
    step: input.step ?? 1
  };
}

function buildFormulaRoll(action = {}, selection = {}, mappedActionsById = new Map()) {
  const selectedFormula = resolveFormulaRollFormula(action, selection, mappedActionsById);
  const result = toFiniteNumber(selection?.result, toFiniteNumber(action.formulaResult));
  const formulaByRarity = asObject(action.formulaByRarity);
  return {
    ...action,
    selectedFormula,
    formulaResult: result,
    formulaByRarityJson: Object.keys(formulaByRarity).length ? JSON.stringify(formulaByRarity) : "",
    summary: selectedFormula || cleanText(action.label)
  };
}

function resolveProjectCounterMax(counter = {}, mappedActionsById = new Map()) {
  const explicitMax = toFiniteNumber(counter.max);
  if (explicitMax !== undefined && explicitMax > 0) {
    return Math.floor(explicitMax);
  }

  const rankSourceActionId = cleanText(counter.rankSourceActionId);
  const selectedRank = rankSourceActionId
    ? toFiniteNumber(mappedActionsById.get(rankSourceActionId)?.selectedRank)
    : undefined;
  const rankRows = Array.isArray(counter.maxByRank) ? counter.maxByRank : [];
  const rankRow = selectedRank === undefined
    ? null
    : rankRows.find((row) => selectedRank >= toFiniteNumber(row?.from, Number.NEGATIVE_INFINITY)
      && selectedRank <= toFiniteNumber(row?.to, Number.POSITIVE_INFINITY));
  const rankedMax = toFiniteNumber(rankRow?.max);
  if (rankedMax !== undefined && rankedMax > 0) {
    return Math.floor(rankedMax);
  }

  return Math.max(0, toInteger(counter.defaultMax, 0));
}

function buildProjectCounter(action = {}, selection = {}, mappedActionsById = new Map()) {
  const counter = asObject(action.projectCounter);
  const max = resolveProjectCounterMax(counter, mappedActionsById);
  const current = Math.min(max || Number.POSITIVE_INFINITY, toInteger(selection?.value, toInteger(counter.current, 0)));
  return {
    ...counter,
    current,
    value: current,
    max,
    label: cleanText(counter.label) || cleanText(action.label)
  };
}

function resolveRankedCheckDc(dcByRank = {}, mappedActionsById = new Map()) {
  const config = asObject(dcByRank);
  const rankSourceActionId = cleanText(config.rankSourceActionId);
  if (!rankSourceActionId) {
    return undefined;
  }

  const rankAction = mappedActionsById.get(rankSourceActionId);
  const selectedRank = toFiniteNumber(rankAction?.selectedRank, toFiniteNumber(rankAction?.selectedOption?.rank));
  if (selectedRank === undefined) {
    return undefined;
  }

  const matchedRow = (Array.isArray(config.rows) ? config.rows : [])
    .map((row) => asObject(row))
    .find((row) => {
      const exactRank = toFiniteNumber(row.rank);
      if (exactRank !== undefined) {
        return exactRank === selectedRank;
      }

      const from = toFiniteNumber(row.from);
      const to = toFiniteNumber(row.to);
      return (from === undefined || selectedRank >= from) && (to === undefined || selectedRank <= to);
    });
  const dc = toFiniteNumber(matchedRow?.dc);
  return dc === undefined ? undefined : Math.max(0, Math.floor(dc));
}

function buildConfigurableCheck(action = {}, selection = {}, mappedActionsById = new Map()) {
  const sourceType = cleanText(selection.sourceType) || cleanText(action.sourceType) || "skill";
  const targetOptions = getCheckTargetOptions(sourceType);
  const defaultTarget = getDefaultCheckTargetOption(sourceType);
  const selectedTarget = getCheckTargetOption(selection.target || action.target, sourceType) ?? defaultTarget;
  const target = cleanText(selectedTarget?.value) || cleanText(selection.target) || cleanText(action.target);
  const targetLabel = cleanText(selection.targetLabel)
    || cleanText(selectedTarget?.label)
    || cleanText(action.targetLabel)
    || target;
  const inferredAbility = sourceType === "ability"
    ? target
    : (cleanText(selection.ability)
      || cleanText(action.ability)
      || cleanText(selectedTarget?.ability));
  const dcByRank = asObject(action.dcByRank);
  const rankedDc = resolveRankedCheckDc(dcByRank, mappedActionsById);
  const isDcLocked = Boolean(dcByRank.locked) && rankedDc !== undefined;
  const dc = isDcLocked ? rankedDc : (toFiniteNumber(selection.dc, toFiniteNumber(action.dc, 0)) ?? 0);

  return {
    sourceType,
    ability: inferredAbility,
    target,
    targetLabel,
    dc,
    isDcLocked,
    sourceTypeOptions: createSelectedOptions(CHECK_SOURCE_OPTIONS, sourceType),
    abilityOptions: createSelectedOptions(CHECK_ABILITY_OPTIONS, inferredAbility),
    targetOptions: createSelectedOptions(targetOptions, target),
    hasAbilitySelect: sourceType !== "ability",
    isAbilityOnly: sourceType === "ability"
  };
}

function resolveResourceRank(resources = {}, mappedActionsById = new Map()) {
  const rankSourceActionId = cleanText(resources.rankSourceActionId);
  if (!rankSourceActionId) {
    return undefined;
  }

  const rankAction = mappedActionsById.get(rankSourceActionId);
  return toFiniteNumber(rankAction?.selectedRank);
}

function buildResourceQuantity(action = {}, selection = {}, mappedActionsById = new Map()) {
  const resources = action?.resources && typeof action.resources === "object" && !Array.isArray(action.resources)
    ? action.resources
    : {};
  const quantity = resources.quantity && typeof resources.quantity === "object" && !Array.isArray(resources.quantity)
    ? resources.quantity
    : {};
  if (!Object.keys(quantity).length && !(Array.isArray(resources.rankCosts) && resources.rankCosts.length)) {
    return null;
  }

  const selectedRank = resolveResourceRank(resources, mappedActionsById);
  const rankCosts = Array.isArray(resources.rankCosts) ? resources.rankCosts : [];
  const rankCost = rankCosts.find((row) => toFiniteNumber(row?.rank) === selectedRank) ?? rankCosts[0] ?? {};
  const min = toFiniteNumber(rankCost.min, toFiniteNumber(quantity.min, 0));
  const max = toFiniteNumber(rankCost.max, toFiniteNumber(quantity.max));
  const fallback = toFiniteNumber(quantity.default, min ?? 0);
  let value = toFiniteNumber(selection?.value, fallback);
  if (value === undefined) {
    value = fallback ?? 0;
  }
  if (min !== undefined) {
    value = Math.max(min, value);
  }
  if (max !== undefined) {
    value = Math.min(max, value);
  }

  return {
    value,
    displayValue: String(value),
    min: min ?? "",
    max: max ?? "",
    step: toFiniteNumber(quantity.step, 1) ?? 1,
    unit: cleanText(quantity.unit),
    label: cleanText(resources.resourceName) || cleanText(action.label)
  };
}

function buildComputedResourceCost(action = {}, resourceQuantity = null, mappedActionsById = new Map()) {
  const resources = action?.resources && typeof action.resources === "object" && !Array.isArray(action.resources)
    ? action.resources
    : {};
  if (!resourceQuantity) {
    return null;
  }

  const selectedRank = resolveResourceRank(resources, mappedActionsById);
  const rankCosts = Array.isArray(resources.rankCosts) ? resources.rankCosts : [];
  const rankCost = rankCosts.find((row) => toFiniteNumber(row?.rank) === selectedRank) ?? rankCosts[0] ?? {};
  const baseCost = toFiniteNumber(rankCost.baseCost, toInteger(resources.cost?.amount, 0)) ?? 0;
  const quantity = resources.quantity && typeof resources.quantity === "object" && !Array.isArray(resources.quantity)
    ? resources.quantity
    : {};
  const unitCost = toFiniteNumber(rankCost.unitCost, toFiniteNumber(rankCost.stepCost, toFiniteNumber(quantity.unitCost, 0))) ?? 0;
  const total = baseCost + (toFiniteNumber(resourceQuantity.value, 0) * unitCost);
  const currency = cleanText(resources.cost?.currency) || "gp";
  return {
    rank: selectedRank,
    quantity: resourceQuantity.value,
    baseCost,
    unitCost,
    total,
    currency,
    label: total > 0 ? `${total} ${CURRENCY_LABELS[currency] ?? currency}` : ""
  };
}

function mapTemplateTargetAction(action = {}, index = 0, selections = new Map(), mappedActionsById = new Map()) {
  const actionType = cleanText(action.actionType) || "check";
  const actionId = cleanText(action.id);
  const selection = selections.get(actionId) ?? {};
  const resourceChoices = actionType === "resources"
    ? buildResourceChoices(action, cleanText(selection.choiceId))
    : [];
  if (resourceChoices.length && !resourceChoices.some((choice) => choice.selected)) {
    resourceChoices[0].selected = true;
  }
  const selectedResourceChoice = resourceChoices.find((choice) => choice.selected) ?? null;
  const optionChoices = actionType === "optionChoice" ? buildOptionChoices(action, selection, mappedActionsById) : [];
  const rankChoices = actionType === "rankChoice" ? buildRankChoices(action, selection) : [];
  const selectedRankChoice = getSelectedRankSummary(rankChoices);
  const selectedItem = actionType === "itemChoice" ? normalizeSelectedItem(selection.item) : null;
  const numericInput = actionType === "numericInput" ? buildNumericInput(action, selection) : null;
  const formulaRoll = actionType === "formulaRoll" ? buildFormulaRoll(action, selection, mappedActionsById) : null;
  const resourceQuantity = actionType === "resources" ? buildResourceQuantity(action, selection, mappedActionsById) : null;
  const computedCost = actionType === "resources" ? buildComputedResourceCost(action, resourceQuantity, mappedActionsById) : null;
  const projectCounter = actionType === "projectCounter" ? buildProjectCounter(action, selection, mappedActionsById) : null;
  const configurableCheck = actionType === "check" && action.configurable === true
    ? buildConfigurableCheck(action, selection, mappedActionsById)
    : null;
  const selectedOptionSummary = getSelectedOptionSummary(optionChoices);
  const checkSummarySource = configurableCheck
    ? {
      ...action,
      sourceType: configurableCheck.sourceType,
      ability: configurableCheck.ability,
      target: configurableCheck.target,
      targetLabel: configurableCheck.targetLabel,
      dc: configurableCheck.dc
    }
    : action;
  const mapped = {
    ...action,
    ...(configurableCheck ? {
      sourceType: configurableCheck.sourceType,
      ability: configurableCheck.ability,
      target: configurableCheck.target,
      targetLabel: configurableCheck.targetLabel,
      dc: configurableCheck.dc
    } : {}),
    number: index + 1,
    actionType,
    resourceChoices,
    optionChoices,
    rankChoices,
    options: actionType === "rankChoice" ? rankChoices : optionChoices,
    selectedItem,
    selectedItemName: selectedItem?.name ?? "",
    selectedItemPriceLabel: selectedItem?.priceGold !== undefined ? `${selectedItem.priceGold} ${CURRENCY_LABELS.gp}` : cleanText(selectedItem?.costText),
    selectedItemJson: selectedItem ? JSON.stringify(selectedItem) : "",
    numericInput,
    resourceQuantity,
    computedCost,
    projectCounter,
    configurableCheck,
    value: numericInput?.value,
    selectedFormula: formulaRoll?.selectedFormula ?? "",
    formulaResult: formulaRoll?.formulaResult,
    formulaByRarityJson: formulaRoll?.formulaByRarityJson ?? "",
    displayValue: numericInput?.displayValue ?? "",
    selectedResourceChoiceId: selectedResourceChoice?.id ?? "",
    selectedResourceChoiceLabel: selectedResourceChoice?.label ?? "",
    selectedOptionLabel: selectedOptionSummary,
    selectedRank: selectedRankChoice?.rank,
    selectedRankLabel: selectedRankChoice?.label ?? "",
    selectionMode: cleanText(action.selectionMode) || "single",
    summary: actionType === "formulaRoll" ? (formulaRoll?.summary || buildCheckSummary(checkSummarySource)) : buildCheckSummary(checkSummarySource),
    outcomeSummary: actionType === "resources"
      ? (computedCost?.label || selectedResourceChoice?.outcomeSummary || buildResourceSummary(action))
      : (actionType === "rankChoice"
        ? (selectedRankChoice?.label || cleanText(action.label))
        : (actionType === "projectCounter"
          ? [projectCounter?.current, projectCounter?.max].filter((entry) => entry !== undefined && entry !== "").join(" / ")
          : (actionType === "optionChoice"
          ? (selectedOptionSummary || cleanText(action.label))
          : (actionType === "itemChoice"
            ? (selectedItem?.name || cleanText(action.label))
            : (actionType === "numericInput"
              ? [numericInput?.displayValue, numericInput?.unit].filter(Boolean).join(" ") || cleanText(action.label)
              : (actionType === "formulaRoll"
                ? (formulaRoll?.summary || cleanText(action.label))
                : buildCheckSummary(checkSummarySource)))))))
      ,
    hasResourceChoices: resourceChoices.length > 0,
    hasResourceQuantity: Boolean(resourceQuantity),
    hasOptionChoices: optionChoices.length > 0,
    hasRankChoices: rankChoices.length > 0,
    isMultipleChoice: (cleanText(action.selectionMode) || "single") === "multiple",
    hasSelectedItem: Boolean(selectedItem),
    isResourceAction: actionType === "resources",
    isItemChoiceAction: actionType === "itemChoice",
    isNumericAction: actionType === "numericInput",
    isOptionAction: actionType === "optionChoice",
    isRankAction: actionType === "rankChoice",
    isFormulaAction: actionType === "formulaRoll",
    isProjectCounterAction: actionType === "projectCounter",
    isConfigurableCheckAction: Boolean(configurableCheck)
  };
  return mapped;
}

function buildTemplateView(action = null, formState = {}) {
  if (!action) {
    return null;
  }

  const selections = normalizeTargetActionSelections(formState.targetActionSelections);
  const mappedActionsById = new Map();
  const targetActions = [];
  for (const [index, entry] of (Array.isArray(action.targetActions) ? action.targetActions : []).entries()) {
    const mappedAction = mapTemplateTargetAction(entry, index, selections, mappedActionsById);
    mappedActionsById.set(mappedAction.id, mappedAction);
    targetActions.push(mappedAction);
  }
  const resourceActions = targetActions.filter((entry) => entry.actionType === "resources");
  const itemChoiceActions = targetActions.filter((entry) => entry.actionType === "itemChoice");
  const numericActions = targetActions.filter((entry) => entry.actionType === "numericInput");
  const optionActions = targetActions.filter((entry) => entry.actionType === "optionChoice");
  const rankActions = targetActions.filter((entry) => entry.actionType === "rankChoice");
  const formulaActions = targetActions.filter((entry) => entry.actionType === "formulaRoll");
  const counterActions = targetActions.filter((entry) => entry.actionType === "projectCounter");
  const configurableCheckActions = targetActions.filter((entry) => entry.configurableCheck);
  const interactiveActionTypes = new Set(["resources", "itemChoice", "numericInput", "optionChoice", "rankChoice", "formulaRoll", "projectCounter"]);
  const checkActions = targetActions.filter((entry) => !interactiveActionTypes.has(entry.actionType)
    && entry.actionType !== "downtimeResult"
    && !entry.configurableCheck);
  const resultActions = targetActions.filter((entry) => entry.actionType === "downtimeResult");
  const interactiveActions = targetActions.filter((entry) => interactiveActionTypes.has(entry.actionType));
  const descriptionHtml = resolveTemplateDescriptionHtml(action);
  return {
    id: cleanText(action.id),
    label: cleanText(action.label) || cleanText(action.name) || "Простой",
    rank: cleanText(action.rank),
    duration: cleanText(action.duration),
    summary: cleanText(action.summary),
    descriptionHtml,
    requirements: Array.isArray(action.requirements) ? action.requirements.map((entry) => cleanText(entry)).filter(Boolean) : [],
    rankTable: Array.isArray(action.rankTable) ? action.rankTable : [],
    targetActions,
    resourceActions,
    itemChoiceActions,
    numericActions,
    optionActions,
    rankActions,
    formulaActions,
    counterActions,
    configurableCheckActions,
    interactiveActions,
    checkActions,
    resultActions,
    hasRank: Boolean(cleanText(action.rank)),
    hasDuration: Boolean(cleanText(action.duration)),
    hasSummary: Boolean(cleanText(action.summary)),
    hasDescriptionHtml: Boolean(descriptionHtml),
    hasRequirements: Array.isArray(action.requirements) && action.requirements.length > 0,
    hasResourceActions: resourceActions.length > 0,
    hasItemChoiceActions: itemChoiceActions.length > 0,
    hasNumericActions: numericActions.length > 0,
    hasOptionActions: optionActions.length > 0,
    hasRankActions: rankActions.length > 0,
    hasFormulaActions: formulaActions.length > 0,
    hasCounterActions: counterActions.length > 0,
    hasConfigurableCheckActions: configurableCheckActions.length > 0,
    hasInteractiveActions: interactiveActions.length > 0,
    hasCheckActions: checkActions.length > 0,
    hasResultActions: resultActions.length > 0,
    hasTargetActions: targetActions.length > 0
  };
}

function paginate(items = [], page = 1, pageSize = REQUEST_PAGE_SIZE) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalPages = Math.max(1, Math.ceil(safeItems.length / pageSize));
  const current = Math.min(Math.max(1, toInteger(page, 1)), totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: safeItems.slice(start, start + pageSize),
    current,
    total: totalPages,
    hasPrevious: current > 1,
    hasNext: current < totalPages,
    count: safeItems.length
  };
}

function buildResultLabel(result) {
  if (!result || typeof result !== "object") {
    return "";
  }

  const parts = [];
  if (result.total !== undefined && result.total !== null && cleanText(result.total) !== "") {
    parts.push(cleanText(result.total));
  }
  if (cleanText(result.label)) {
    parts.push(cleanText(result.label));
  }
  else if (result.value !== undefined && result.value !== null && cleanText(result.value) !== "") {
    parts.push(cleanText(result.value));
  }
  else if (cleanText(result.thresholdLabel)) {
    parts.push(cleanText(result.thresholdLabel));
  }
  if (result.success === true) {
    parts.push("успех");
  }
  else if (result.success === false) {
    parts.push("провал");
  }
  if (cleanText(result.note)) {
    parts.push(cleanText(result.note));
  }

  return parts.join(", ");
}

function normalizeRollAbility(value = "") {
  const cleaned = cleanText(value);
  return cleaned.startsWith("save-") ? cleaned.slice(5) : cleaned;
}

function buildRollTarget(
  check = {},
  choice = {},
  { canRollRequest = false, choiceIndex = 0, hasChoices = false, resultLabel = "", resolvedChoiceIndex = 0 } = {}
) {
  const sourceType = cleanText(choice.sourceType) || cleanText(check.sourceType) || "skill";
  const target = cleanText(choice.target) || cleanText(check.target);
  const ability = normalizeRollAbility(choice.ability) || normalizeRollAbility(check.ability) || normalizeRollAbility(target);
  const label = cleanText(choice.targetLabel)
    || cleanText(choice.label)
    || cleanText(check.targetLabel)
    || cleanText(check.label)
    || target
    || ability;
  const dc = toInteger(check.dc, 0);
  const dcFormula = cleanText(choice.dcFormula) || cleanText(check.dcFormula);
  const effectiveOutcomeMode = cleanText(check.outcomeMode) || (dc > 0 || dcFormula ? "dc" : "freeform");
  const hasResult = Boolean(resultLabel);
  const isResolvedChoice = hasResult && choiceIndex === resolvedChoiceIndex;
  const isDisabledChoice = hasResult && hasChoices && !isResolvedChoice;
  const canRoll = !hasResult
    && Boolean(canRollRequest)
    && ROLLABLE_SOURCE_TYPES.has(sourceType)
    && Boolean(sourceType === "ability" ? ability : (target || ability));

  return {
    choiceIndex,
    hasChoices,
    sourceType,
    ability,
    target,
    label,
    dc,
    dcFormula,
    outcomeMode: effectiveOutcomeMode,
    canRoll,
    hasResult,
    isResolvedChoice,
    isDisabledChoice,
    buttonLabel: isResolvedChoice && resultLabel ? resultLabel : (hasChoices ? label : "Кинуть"),
    rollTitle: isResolvedChoice && resultLabel
      ? "Результат уже записан"
      : (isDisabledChoice
        ? "Выбран другой вариант этого действия"
        : (canRoll
          ? `Кинуть ${label || "проверку"}`
          : "Этот тип целевого действия пока не бросается из чарника"))
  };
}

function buildRollTargets(check = {}, { canRollRequest = false, resultLabel = "" } = {}) {
  if (NON_CHECK_ACTION_TYPES.has(cleanText(check.actionType))) {
    return [];
  }

  const choices = Array.isArray(check.choices) ? check.choices : [];
  const resultChoiceIndex = toFiniteNumber(check?.result?.choiceIndex);
  const resolvedChoiceIndex = resultChoiceIndex === undefined ? 0 : Math.max(0, Math.floor(resultChoiceIndex));
  if (choices.length) {
    return choices.map((choice, index) => buildRollTarget(check, choice, {
      canRollRequest,
      choiceIndex: index,
      hasChoices: choices.length > 1,
      resultLabel,
      resolvedChoiceIndex
    }));
  }

  return [buildRollTarget(check, {}, {
    canRollRequest,
    choiceIndex: 0,
    hasChoices: false,
    resultLabel,
    resolvedChoiceIndex: 0
  })];
}

function buildProjectCounterImagePath(max = 0, value = 0) {
  const safeMax = toInteger(max, 0);
  if (![4, 6, 8].includes(safeMax)) {
    return "";
  }

  const safeValue = Math.max(0, Math.min(safeMax, toInteger(value, 0)));
  return `modules/${MODULE_ID}/templates/counters/progress-${safeMax}/progress_${safeValue}.png`;
}

function getProjectCounterProgressSteps(actions = []) {
  const resultAction = actions.find((action) => cleanText(action.actionType) === "downtimeResult"
    && toFiniteNumber(action?.result?.progressSteps) !== undefined);
  if (resultAction) {
    return toInteger(resultAction.result.progressSteps, 0);
  }

  const fallbackResult = actions.find((action) => cleanText(action.actionType) === "downtimeResult"
    && toFiniteNumber(action?.result?.value) !== undefined);
  return fallbackResult ? toInteger(fallbackResult.result.value, 0) : 0;
}

function buildContinuationSelection(action = {}, counterValue = undefined) {
  const actionType = cleanText(action.actionType);
  const entry = {
    actionId: cleanText(action.id)
  };
  if (!entry.actionId) {
    return null;
  }

  if (actionType === "rankChoice") {
    const optionId = cleanText(action.selectedOptionId);
    if (optionId) {
      entry.optionId = optionId;
    }
    const rank = toFiniteNumber(action.selectedRank);
    if (rank !== undefined) {
      entry.value = rank;
    }
  }
  else if (actionType === "projectCounter") {
    entry.value = counterValue ?? toFiniteNumber(action.projectCounter?.current, toFiniteNumber(action.projectCounter?.value, 0)) ?? 0;
  }
  else if (actionType === "resources") {
    const choiceId = cleanText(action.selectedChoiceId) || cleanText(action.selectedResourceChoiceId);
    if (choiceId) {
      entry.choiceId = choiceId;
    }
    const quantity = toFiniteNumber(action.resourceQuantity?.value, toFiniteNumber(action.computedCost?.quantity));
    if (quantity !== undefined) {
      entry.value = quantity;
    }
  }
  else if (actionType === "itemChoice") {
    const selectedItem = normalizeSelectedItem(action.selectedItem);
    if (selectedItem) {
      entry.item = selectedItem;
    }
  }
  else if (actionType === "optionChoice") {
    const optionId = cleanText(action.selectedOptionId);
    if (optionId) {
      entry.optionId = optionId;
    }
    if (Array.isArray(action.selectedOptionIds) && action.selectedOptionIds.length) {
      entry.optionIds = action.selectedOptionIds.map((id) => cleanText(id)).filter(Boolean);
    }
  }
  else if (actionType === "numericInput") {
    const value = toFiniteNumber(action.numericValue, toFiniteNumber(action.value));
    if (value !== undefined) {
      entry.value = value;
    }
  }
  else if (actionType === "formulaRoll") {
    const formula = cleanFormulaText(action.selectedFormula) || cleanFormulaText(action.formula);
    if (formula) {
      entry.formula = formula;
    }
    const result = toFiniteNumber(action.formulaResult, toFiniteNumber(action.result?.total, toFiniteNumber(action.result?.value)));
    if (result !== undefined) {
      entry.result = result;
    }
  }
  else if (actionType === "check") {
    for (const key of ["sourceType", "ability", "target", "targetLabel"]) {
      const value = cleanText(action[key]);
      if (value) {
        entry[key] = value;
      }
    }
    const dc = toFiniteNumber(action.dc);
    if (dc !== undefined) {
      entry.dc = dc;
    }
  }
  else {
    return null;
  }

  return Object.keys(entry).length > 1 ? entry : null;
}

function buildProjectContinuationPayload(request = {}, actions = [], counterValue = 0) {
  const actionId = cleanText(request.templateUuid) || cleanText(request.actionId);
  if (!actionId) {
    return "";
  }

  const targetActionSelections = actions
    .map((action) => buildContinuationSelection(action, counterValue))
    .filter(Boolean);
  return JSON.stringify({
    actionId,
    weeks: 1,
    title: cleanText(request.title),
    description: cleanText(request.description),
    targetActionSelections
  });
}

function buildRequestProjectCounter(request = {}, actions = [], { availableWeeks = 0 } = {}) {
  const counterAction = actions.find((action) => cleanText(action.actionType) === "projectCounter");
  if (!counterAction) {
    return null;
  }

  const counter = asObject(counterAction.projectCounter);
  const max = toInteger(counter.max, toInteger(counterAction.max, 0));
  if (max <= 0) {
    return null;
  }

  const previousValue = Math.min(max, toInteger(counter.current, toInteger(counter.value, 0)));
  const gained = Math.max(0, getProjectCounterProgressSteps(actions));
  const value = Math.min(max, previousValue + gained);
  const imagePath = buildProjectCounterImagePath(max, value);
  const canContinue = value < max && toInteger(availableWeeks, 0) > 0 && Boolean(cleanText(request.templateUuid) || cleanText(request.actionId));
  return {
    ...counter,
    previousValue,
    value,
    current: value,
    max,
    gained,
    hasWeekResult: gained > 0,
    imagePath,
    hasImagePath: Boolean(imagePath),
    canContinue,
    continuePayloadJson: canContinue ? buildProjectContinuationPayload(request, actions, value) : ""
  };
}

function mapRequest(request = {}, { groupId = "", availableWeeks = 0 } = {}) {
  const status = cleanText(request.status) || "pending";
  const meta = STATUS_META[status] ?? {
    label: status || "Заявка",
    type: "info"
  };
  const canRollRequest = status === "pending" || status === "approved";
  const checks = (Array.isArray(request.checks) ? request.checks : []).map((check) => {
    const resultLabel = buildResultLabel(check?.result);
    const outcomeSummary = buildSubmittedActionOutcomeSummary(check);
    const rollTargets = buildRollTargets(check, {
      canRollRequest,
      resultLabel
    });
    return {
      ...check,
      summary: buildCheckSummary(check),
      outcomeSummary,
      hasOutcomeSummary: Boolean(outcomeSummary && outcomeSummary !== resultLabel),
      resultLabel,
      hasResult: Boolean(resultLabel),
      rollTargets,
      hasRollTargets: rollTargets.some((target) => target.canRoll || target.hasResult)
    };
  });
  const projectCounter = buildRequestProjectCounter(request, checks, { availableWeeks });
  const isArchived = ARCHIVED_REQUEST_STATUSES.has(status);
  const isCurrentProject = Boolean(projectCounter && projectCounter.value < projectCounter.max && isArchived);

  return {
    ...request,
    groupId: cleanText(request.groupId) || cleanText(groupId),
    status,
    statusLabel: meta.label,
    statusClass: `rm-status-badge--${meta.type}`,
    weeks: normalizeWeeks(request.weeks, 1),
    checks,
    targetActions: checks,
    resourceActions: checks.filter((check) => cleanText(check.actionType) === "resources"),
    checkActions: checks.filter((check) => !NON_CHECK_ACTION_TYPES.has(cleanText(check.actionType))),
    projectCounter,
    hasProjectCounter: Boolean(projectCounter),
    hasChecks: checks.length > 0,
    hasResult: Boolean(cleanText(request.result)),
    isArchived,
    isCurrentProject
  };
}

function buildEmptyContext(actor, {
  warning = "",
  formState = {}
} = {}) {
  const actionId = cleanText(formState.actionId);
  const weeks = normalizeWeeks(formState.weeks, 1);
  const selectedTemplate = buildTemplateView(formState.selectedTemplate, formState);
  return {
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    hasGroup: false,
    warning: cleanText(warning),
    canSubmit: false,
    balance: buildBalance(),
    actionOptions: [],
    libraryDisabled: true,
    selectedActionLabel: selectedTemplate?.label || "Выбрать простой",
    selectedTemplate,
    requests: [],
    currentProjects: [],
    archiveRequests: [],
    requestPage: paginate([]),
    currentProjectPage: paginate([]),
    archivePage: paginate([]),
    hasCurrentProjects: false,
    hasArchiveRequests: false,
    currentProjectCount: 0,
    emptyRequests: true,
    form: {
      actionId,
      weeks,
      title: cleanText(formState.title),
      description: cleanText(formState.description),
      targetActionSelections: Array.isArray(formState.targetActionSelections)
        ? formState.targetActionSelections
        : []
    },
    submitDisabled: true,
    submitDisabledReason: cleanText(warning) || "Персонаж не найден в группе Rebreya."
  };
}

export class CharacterDowntimeService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  getActorContext(actor, formState = {}) {
    if (!actor?.id || actor.type !== "character") {
      return buildEmptyContext(actor, {
        warning: "Простой доступен только персонажам.",
        formState
      });
    }

    let snapshot = null;
    try {
      snapshot = this.moduleApi?.getDowntimeSnapshot?.({ actorId: actor.id });
    }
    catch (error) {
      if (isKnownGroupContextError(error)) {
        return buildEmptyContext(actor, {
          warning: error.message,
          formState
        });
      }

      throw error;
    }

    const members = Array.isArray(snapshot?.members) ? snapshot.members : [];
    const member = members.find((entry) => entry?.actorId === actor.id) ?? null;
    if (!member) {
      return buildEmptyContext(actor, {
        warning: "Персонаж не найден в зарегистрированной группе Rebreya.",
        formState
      });
    }

    const actionCatalog = Array.isArray(snapshot?.actionCatalog) ? snapshot.actionCatalog : [];
    const actionId = cleanText(formState.actionId);

    const weeks = normalizeWeeks(formState.weeks, 1);
    const balance = buildBalance(member.balance ?? member);
    const canSubmit = Boolean(member.canSubmit && snapshot?.canSubmit);
    const submitDisabled = !canSubmit || !actionId || balance.availableWeeks < weeks;
    const submitDisabledReason = submitDisabled
      ? (!canSubmit
        ? "У вас нет прав отправлять заявки за этого персонажа."
        : (!actionId
          ? "Выберите простой из библиотеки."
          : "Недостаточно свободных недель простоя."))
      : "";
    const requests = (Array.isArray(snapshot?.requests) ? snapshot.requests : [])
      .filter((request) => request?.actorId === actor.id)
      .map((request) => mapRequest(request, { groupId: snapshot.groupId, availableWeeks: balance.availableWeeks }));
    const currentProjects = requests.filter((request) => request.isCurrentProject);
    const activeRequests = requests.filter((request) => !request.isArchived && !request.isCurrentProject);
    const archivedRequests = requests.filter((request) => request.isArchived && !request.isCurrentProject);
    const activePage = paginate(activeRequests, formState.requestPage);
    const currentProjectPage = paginate(currentProjects, formState.currentProjectPage);
    const archivePage = paginate(archivedRequests, formState.archivePage);

    const selectedAction = actionCatalog.find((action) => action.id === actionId) ?? null;
    const selectedTemplate = buildTemplateView(selectedAction, formState) ?? buildTemplateView(formState.selectedTemplate, formState);
    const actionOptions = actionCatalog.map((action) => ({
      value: action.id,
      label: action.label ?? action.id,
      selected: action.id === actionId
    }));

    return {
      groupId: snapshot.groupId ?? "",
      actorId: actor.id,
      actorName: actor.name ?? actor.id,
      hasGroup: true,
      warning: "",
      canSubmit,
      balance,
      actionOptions,
      libraryDisabled: !canSubmit,
      selectedActionLabel: selectedTemplate?.label || cleanText(selectedAction?.label) || "Выбрать простой",
      selectedTemplate,
      requests: activePage.items,
      currentProjects: currentProjectPage.items,
      archiveRequests: archivePage.items,
      requestPage: activePage,
      currentProjectPage,
      archivePage,
      hasCurrentProjects: currentProjects.length > 0,
      hasArchiveRequests: archivedRequests.length > 0,
      requestCount: activeRequests.length,
      currentProjectCount: currentProjects.length,
      archiveCount: archivedRequests.length,
      emptyRequests: activeRequests.length === 0,
      form: {
        actionId,
        weeks,
        title: cleanText(formState.title),
        description: cleanText(formState.description),
        targetActionSelections: Array.isArray(formState.targetActionSelections)
          ? formState.targetActionSelections
          : []
      },
      submitDisabled,
      submitDisabledReason
    };
  }

  async createRequest(actor, payload = {}) {
    if (!actor?.id) {
      throw new Error("Персонаж для заявки простоя не найден.");
    }

    let groupId = "";
    try {
      groupId = cleanText(this.moduleApi?.getDowntimeSnapshot?.({ actorId: actor.id })?.groupId);
    }
    catch (_error) {
      groupId = "";
    }

    const targetActionSelections = Array.isArray(payload.targetActionSelections)
      ? payload.targetActionSelections.map((entry) => normalizeSelectionEntry(entry)).filter(Boolean)
      : [];
    const requestPayload = {
      groupId,
      actorId: actor.id,
      actionId: cleanText(payload.actionId),
      weeks: normalizeWeeks(payload.weeks, 1),
      title: cleanText(payload.title),
      description: cleanText(payload.description)
    };
    if (targetActionSelections.length) {
      requestPayload.targetActionSelections = targetActionSelections;
    }
    return this.moduleApi.createDowntimeRequest(requestPayload);
  }
}
