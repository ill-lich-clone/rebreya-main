import { DOWNTIME_COMPENDIUM_NAME, DOWNTIME_ITEM_TYPE, MODULE_ID } from "../constants.js";

const OPEN_RESERVED_STATUSES = new Set(["pending", "approved"]);
const RELEASED_STATUSES = new Set(["rejected", "returned"]);
const REQUEST_STATUSES = new Set(["pending", "approved", "returned", "rejected", "completed"]);
const MAX_TARGET_CHOICES = 5;
const DOWNTIME_TEMPLATE_FLAG = "downtime";
const DOWNTIME_COMPENDIUM_PACK_ID = `world.${DOWNTIME_COMPENDIUM_NAME}`;
const ROLLABLE_DOWNTIME_ACTION_TYPES = new Set(["check", "choice"]);

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectionContents(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return [...collection.values()];
  }

  if (typeof collection === "object") {
    return Object.values(collection);
  }

  return [];
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getObjectPath(source, path) {
  if (globalThis.foundry?.utils?.getProperty) {
    return globalThis.foundry.utils.getProperty(source, path);
  }

  return String(path ?? "").split(".").reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), source);
}

function toWeeks(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
}

function toFiniteNumber(value, fallback = undefined) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeLookupText(value = "") {
  return cleanString(value)
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
  const text = cleanString(value);
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
  return cleanString(item.bargaining)
    || cleanString(item.itemBargaining)
    || cleanString(rebreya.bargaining)
    || cleanString(rebreya.itemBargaining)
    || cleanString(signature.bargaining);
}

function normalizeRarityKey(value = "") {
  return RARITY_KEY_BY_TEXT[normalizeLookupText(value)] || cleanString(value);
}

function getSelectedItemRarityKey(item = {}) {
  const rebreya = asObject(item.rebreya);
  const signature = getItemSignatureData(item);
  return normalizeRarityKey(
    cleanString(item.rarity)
      || cleanString(rebreya.rarity)
      || cleanString(signature.rarity)
      || cleanString(item.documentSnapshot?.system?.rarity)
  );
}

function cleanFormulaText(value = "") {
  const text = cleanString(value)
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

function findSelectedItemAction(selectedActionsById = new Map(), itemActionId = "") {
  const safeItemActionId = cleanId(itemActionId);
  if (safeItemActionId) {
    const action = selectedActionsById.get(safeItemActionId);
    if (action?.selectedItem) {
      return action;
    }
  }

  return [...selectedActionsById.values()].find((action) => action?.selectedItem) ?? null;
}

function resolveBargainingOptionId(options = [], selectedActionsById = new Map()) {
  const itemAction = findSelectedItemAction(selectedActionsById);
  const bargaining = getSelectedItemBargaining(itemAction?.selectedItem);
  if (!bargaining) {
    return "";
  }

  const numericBargaining = toFiniteNumber(bargaining);
  if (numericBargaining !== undefined) {
    const numericOption = options.find((option) => toFiniteNumber(option?.value) === numericBargaining);
    if (numericOption?.id) {
      return cleanId(numericOption.id);
    }
  }

  const mappedId = BARGAINING_OPTION_ID_BY_TEXT[normalizeLookupText(bargaining)];
  if (mappedId && options.some((option) => cleanId(option.id) === mappedId)) {
    return mappedId;
  }

  const bargainingKey = normalizeLookupText(bargaining);
  return cleanId(options.find((option) => normalizeLookupText(option?.label) === bargainingKey)?.id);
}

function resolveFormulaRollFormula(action = {}, selection = {}, selectedActionsById = new Map()) {
  const explicitFormula = cleanFormulaText(selection?.formula)
    || cleanFormulaText(action.selectedFormula)
    || cleanFormulaText(action.formula);
  if (explicitFormula) {
    return explicitFormula;
  }

  const itemAction = findSelectedItemAction(selectedActionsById, action.itemActionId);
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

function buildDefaultBalance() {
  return {
    availableWeeks: 0,
    reservedWeeks: 0,
    spentWeeks: 0,
    totalGrantedWeeks: 0
  };
}

function normalizeBalance(value = {}) {
  return {
    availableWeeks: toWeeks(value.availableWeeks),
    reservedWeeks: toWeeks(value.reservedWeeks),
    spentWeeks: toWeeks(value.spentWeeks),
    totalGrantedWeeks: toWeeks(value.totalGrantedWeeks)
  };
}

function normalizeCheck(value = {}) {
  const source = asObject(value);
  const checkId = cleanId(value.id);
  const normalized = {
    ...clone(source),
    id: checkId || `check-${Date.now()}`,
    label: cleanString(value.label) || cleanString(value.title) || "Check",
    dc: toWeeks(value.dc),
    ability: cleanString(value.ability),
    result: value.result === undefined ? null : clone(value.result)
  };

  if (Array.isArray(source.choices)) {
    normalized.choices = source.choices
      .slice(0, MAX_TARGET_CHOICES)
      .map((choice) => ({
        ...clone(asObject(choice)),
        sourceType: cleanString(choice?.sourceType),
        ability: cleanString(choice?.ability),
        target: cleanString(choice?.target),
        targetLabel: cleanString(choice?.targetLabel),
        rollMode: cleanString(choice?.rollMode),
        label: cleanString(choice?.label)
      }))
      .filter((choice) => choice.label || choice.ability || choice.target || choice.sourceType);
  }

  for (const effectKey of ["checkEffect", "downtimeEffect"]) {
    if (source[effectKey] && typeof source[effectKey] === "object" && !Array.isArray(source[effectKey])) {
      normalized[effectKey] = {
        ...clone(source[effectKey]),
        trigger: cleanString(source[effectKey].trigger),
        adapter: cleanString(source[effectKey].adapter),
        template: cleanString(source[effectKey].template)
      };
    }
  }

  return normalized;
}

function normalizeSelectedItem(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const uuid = cleanId(item.uuid);
  const id = cleanId(item.id);
  const rawName = cleanString(item.name);
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
  const img = cleanString(item.img);
  if (img) {
    selectedItem.img = img;
  }
  const type = cleanString(item.type);
  if (type) {
    selectedItem.type = type;
  }
  const sourceType = cleanString(item.sourceType);
  if (sourceType) {
    selectedItem.sourceType = sourceType;
  }
  const rarity = cleanString(item.rarity);
  if (rarity) {
    selectedItem.rarity = rarity;
  }
  const costText = cleanString(item.costText) || cleanString(item.itemCost);
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
  const selectedSourceType = cleanString(selectedItem.sourceType) || cleanString(selectedItem.rebreya?.sourceType);
  if (selectedSourceType && !selectedItem.sourceType) {
    selectedItem.sourceType = selectedSourceType;
  }
  const sourceId = cleanString(item.sourceId)
    || cleanString(selectedItem.rebreya?.sourceId)
    || cleanString(selectedItem.rebreya?.magicItemId)
    || cleanString(selectedItem.rebreya?.gearId)
    || cleanString(selectedItem.rebreya?.materialId);
  if (sourceId) {
    selectedItem.sourceId = sourceId;
  }
  const magicItemId = cleanString(selectedItem.rebreya?.magicItemId);
  if (magicItemId) {
    selectedItem.magicItemId = magicItemId;
  }
  const gearId = cleanString(selectedItem.rebreya?.gearId);
  if (gearId) {
    selectedItem.gearId = gearId;
  }
  const materialId = cleanString(selectedItem.rebreya?.materialId);
  if (materialId) {
    selectedItem.materialId = materialId;
  }
  const signature = getItemSignatureData(selectedItem);
  const signatureCostText = cleanString(signature.costText) || cleanString(signature.itemCost);
  if (signatureCostText && !selectedItem.costText) {
    selectedItem.costText = signatureCostText;
  }
  if (selectedItem.rebreya && signatureCostText && !cleanString(selectedItem.rebreya.costText)) {
    selectedItem.rebreya.costText = signatureCostText;
  }
  return selectedItem;
}

function normalizeSelectionEntry(entry = {}) {
  const actionId = cleanId(entry?.actionId);
  if (!actionId) {
    return null;
  }

  const selection = {
    actionId
  };
  const choiceId = cleanId(entry?.choiceId);
  const optionId = cleanId(entry?.optionId);
  const optionIds = asArray(entry?.optionIds).map((id) => cleanId(id)).filter(Boolean);
  const value = toFiniteNumber(entry?.value);
  const formula = cleanFormulaText(entry?.formula);
  const result = toFiniteNumber(entry?.result);
  const item = normalizeSelectedItem(entry?.item);
  const hasTitle = Object.hasOwn(entry ?? {}, "title");
  const hasDescription = Object.hasOwn(entry ?? {}, "description");
  const sourceType = cleanId(entry?.sourceType);
  const ability = cleanId(entry?.ability);
  const target = cleanId(entry?.target);
  const targetLabel = cleanString(entry?.targetLabel);
  const dc = toFiniteNumber(entry?.dc);

  if (choiceId) {
    selection.choiceId = choiceId;
  }
  if (optionId) {
    selection.optionId = optionId;
  }
  if (optionIds.length) {
    selection.optionIds = optionIds;
  }
  if (value !== undefined) {
    selection.value = value;
  }
  if (formula) {
    selection.formula = formula;
  }
  if (result !== undefined) {
    selection.result = result;
  }
  if (item) {
    selection.item = item;
  }
  if (sourceType) {
    selection.sourceType = sourceType;
  }
  if (ability) {
    selection.ability = ability;
  }
  if (target) {
    selection.target = target;
  }
  if (targetLabel) {
    selection.targetLabel = targetLabel;
  }
  if (dc !== undefined) {
    selection.dc = dc;
  }
  if (hasTitle) {
    selection.title = cleanString(entry.title);
  }
  if (hasDescription) {
    selection.description = cleanString(entry.description);
  }

  return selection;
}

function normalizeTargetActionSelections(value = []) {
  const selections = new Map();
  for (const entry of asArray(value)) {
    const selection = normalizeSelectionEntry(entry);
    if (selection) {
      selections.set(selection.actionId, selection);
    }
  }
  return selections;
}

function normalizeResourceChoice(choice = {}, index = 0) {
  const source = asObject(choice);
  return {
    ...clone(source),
    id: cleanId(source.id) || `choice-${index + 1}`,
    label: cleanString(source.label) || cleanString(source.name) || `Выбор ${index + 1}`,
    requirement: cleanString(source.requirement)
  };
}

function applySelectedResourceChoice(action = {}, selection = {}) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "resources") {
    return source;
  }

  const resources = asObject(source.resources);
  const choices = asArray(resources.choices).map((choice, index) => normalizeResourceChoice(choice, index));
  if (!choices.length) {
    return source;
  }

  const requestedChoiceId = cleanId(selection?.choiceId);
  const selectedChoice = choices.find((choice) => choice.id === requestedChoiceId) ?? choices[0];
  const selectedCost = selectedChoice.cost && typeof selectedChoice.cost === "object" && !Array.isArray(selectedChoice.cost)
    ? selectedChoice.cost
    : {};
  const selectedResources = {
    ...clone(resources),
    selectedChoice: clone(selectedChoice),
    cost: {
      ...clone(asObject(resources.cost)),
      ...clone(asObject(selectedCost))
    }
  };

  if (selectedChoice.narrative) {
    selectedResources.narrative = cleanString(selectedChoice.narrative);
  }

  return {
    ...clone(source),
    resources: selectedResources,
    selectedChoiceId: selectedChoice.id,
    selectedChoiceLabel: selectedChoice.label
  };
}

function normalizeOptionChoice(option = {}, index = 0) {
  const source = asObject(option);
  return {
    ...clone(source),
    id: cleanId(source.id) || `option-${index + 1}`,
    label: cleanString(source.label) || cleanString(source.name) || `Вариант ${index + 1}`
  };
}

function normalizeRankChoiceRow(row = {}, index = 0) {
  const source = asObject(row);
  const numericRank = toFiniteNumber(source.rank, index);
  const rank = Number.isFinite(numericRank) ? Math.floor(numericRank) : index;
  return {
    ...clone(source),
    id: cleanId(source.id) || `rank-${rank}`,
    label: cleanString(source.label) || `Ранг ${rank}`,
    rank
  };
}

function buildRankChoiceRows(action = {}) {
  const source = asObject(action);
  const rankChoice = asObject(source.rankChoice);
  const configuredRows = asArray(rankChoice.rows).length
    ? asArray(rankChoice.rows)
    : asArray(source.options);
  if (configuredRows.length) {
    return configuredRows.map((row, index) => normalizeRankChoiceRow(row, index));
  }

  const min = Math.max(0, Math.floor(toFiniteNumber(rankChoice.min, 0) ?? 0));
  const max = Math.min(10, Math.floor(toFiniteNumber(rankChoice.max, 10) ?? 10));
  const start = Math.min(min, max);
  const end = Math.max(min, max);
  return Array.from({ length: end - start + 1 }, (_entry, index) => normalizeRankChoiceRow({
    rank: start + index
  }, index));
}

function applySelectedRankChoice(action = {}, selection = {}) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "rankChoice") {
    return source;
  }

  const rows = buildRankChoiceRows(source);
  if (!rows.length) {
    return source;
  }

  const requestedOptionId = cleanId(selection?.optionId);
  const requestedRank = toFiniteNumber(selection?.value);
  const rankChoice = asObject(source.rankChoice);
  const defaultRank = toFiniteNumber(rankChoice.default);
  const selectedRow = rows.find((row) => row.id === requestedOptionId)
    ?? rows.find((row) => requestedRank !== undefined && row.rank === requestedRank)
    ?? rows.find((row) => defaultRank !== undefined && row.rank === defaultRank)
    ?? rows[0];

  return {
    ...clone(source),
    rankChoice: {
      ...clone(rankChoice),
      rows: clone(rows)
    },
    selectedOptionId: selectedRow.id,
    selectedOptionLabel: selectedRow.label,
    selectedOption: clone(selectedRow),
    selectedRank: selectedRow.rank
  };
}

function resolveProjectCounterMax(counter = {}, selectedActionsById = new Map()) {
  const rankSourceActionId = cleanId(counter.rankSourceActionId);
  const rankAction = rankSourceActionId ? selectedActionsById.get(rankSourceActionId) : null;
  const selectedRank = toFiniteNumber(rankAction?.selectedRank, toFiniteNumber(rankAction?.selectedOption?.rank));
  const selectedCounterMax = toFiniteNumber(rankAction?.selectedOption?.counterMax);
  if (selectedCounterMax !== undefined) {
    return Math.max(1, Math.floor(selectedCounterMax));
  }

  const matchedRange = asArray(counter.maxByRank)
    .map((entry) => asObject(entry))
    .find((entry) => {
      if (selectedRank === undefined) {
        return false;
      }
      const from = toFiniteNumber(entry.from, selectedRank) ?? selectedRank;
      const to = toFiniteNumber(entry.to, selectedRank) ?? selectedRank;
      return selectedRank >= from && selectedRank <= to;
    });
  const rangeMax = toFiniteNumber(matchedRange?.max);
  if (rangeMax !== undefined) {
    return Math.max(1, Math.floor(rangeMax));
  }

  return Math.max(1, Math.floor(toFiniteNumber(counter.max, 4) ?? 4));
}

function resolveRankedDc(dcByRank = {}, selectedActionsById = new Map()) {
  const config = asObject(dcByRank);
  const rankSourceActionId = cleanId(config.rankSourceActionId);
  if (!rankSourceActionId) {
    return undefined;
  }

  const rankAction = selectedActionsById.get(rankSourceActionId);
  const selectedRank = toFiniteNumber(rankAction?.selectedRank, toFiniteNumber(rankAction?.selectedOption?.rank));
  if (selectedRank === undefined) {
    return undefined;
  }

  const matchedRow = asArray(config.rows)
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

function applySelectedProjectCounter(action = {}, selection = {}, selectedActionsById = new Map()) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "projectCounter") {
    return source;
  }

  const counter = asObject(source.projectCounter);
  const max = resolveProjectCounterMax(counter, selectedActionsById);
  const fallback = toFiniteNumber(counter.current, 0) ?? 0;
  const current = clampNumber(selection?.value, 0, max, fallback);
  return {
    ...clone(source),
    projectCounter: {
      ...clone(counter),
      current,
      max
    }
  };
}

function applySelectedOptionChoice(action = {}, selection = {}, selectedActionsById = new Map()) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "optionChoice") {
    return source;
  }

  const options = asArray(source.options).map((option, index) => normalizeOptionChoice(option, index));
  if (!options.length) {
    return source;
  }

  const selectionMode = cleanString(source.selectionMode) || "single";
  if (selectionMode === "multiple") {
    const selectedIds = new Set(asArray(selection?.optionIds).map((id) => cleanId(id)).filter(Boolean));
    const selectedOptions = options.filter((option) => selectedIds.has(option.id));
    return {
      ...clone(source),
      selectedOptionIds: selectedOptions.map((option) => option.id),
      selectedOptions: clone(selectedOptions)
    };
  }

  const requestedOptionId = cleanId(selection?.optionId) || resolveBargainingOptionId(options, selectedActionsById);
  const selectedOption = options.find((option) => option.id === requestedOptionId) ?? options[0];
  return {
    ...clone(source),
    selectedOptionId: selectedOption.id,
    selectedOptionLabel: selectedOption.label,
    selectedOption: clone(selectedOption)
  };
}

function applyConfigurableCheckSelection(action = {}, selection = {}, selectedActionsById = new Map()) {
  const source = asObject(action);
  const actionType = cleanId(source.actionType) || "check";
  if (actionType !== "check" || source.configurable !== true) {
    return source;
  }

  const dcByRank = asObject(source.dcByRank);
  const rankedDc = resolveRankedDc(dcByRank, selectedActionsById);
  const isDcLocked = Boolean(dcByRank.locked) && rankedDc !== undefined;
  const sourceType = cleanId(selection?.sourceType) || cleanId(source.sourceType) || "skill";
  const target = cleanId(selection?.target) || cleanId(source.target);
  const ability = cleanId(selection?.ability) || cleanId(source.ability);
  const targetLabel = cleanString(selection?.targetLabel) || cleanString(source.targetLabel) || cleanString(source.label);
  const dc = isDcLocked ? rankedDc : (toFiniteNumber(selection?.dc, toFiniteNumber(source.dc, 0)) ?? 0);
  return {
    ...clone(source),
    actionType,
    sourceType,
    ability,
    target,
    targetLabel,
    dc: Math.max(0, Math.floor(dc)),
    dcLocked: isDcLocked
  };
}

function applySelectedNumericInput(action = {}, selection = {}) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "numericInput") {
    return source;
  }

  const input = asObject(source.input);
  const fallbackValue = toFiniteNumber(input.default);
  let value = toFiniteNumber(selection?.value, fallbackValue);
  if (value === undefined) {
    return source;
  }

  const min = toFiniteNumber(input.min);
  const max = toFiniteNumber(input.max);
  if (min !== undefined) {
    value = Math.max(min, value);
  }
  if (max !== undefined) {
    value = Math.min(max, value);
  }

  return {
    ...clone(source),
    numericValue: value
  };
}

function clampNumber(value, min = undefined, max = undefined, fallback = 0) {
  let numericValue = toFiniteNumber(value, fallback);
  if (numericValue === undefined) {
    numericValue = fallback;
  }
  if (min !== undefined) {
    numericValue = Math.max(min, numericValue);
  }
  if (max !== undefined) {
    numericValue = Math.min(max, numericValue);
  }
  return numericValue;
}

function resolveSelectedRank(resources = {}, selectedActionsById = new Map()) {
  const rankSourceActionId = cleanId(resources.rankSourceActionId);
  if (!rankSourceActionId) {
    return undefined;
  }

  const sourceAction = selectedActionsById.get(rankSourceActionId);
  const selectedRank = toFiniteNumber(sourceAction?.selectedRank);
  if (selectedRank !== undefined) {
    return selectedRank;
  }

  return toFiniteNumber(sourceAction?.selectedOption?.rank);
}

function resolveRankCostRow(resources = {}, selectedRank = undefined) {
  const rows = asArray(resources.rankCosts).map((row) => asObject(row));
  if (!rows.length) {
    return {};
  }
  if (selectedRank !== undefined) {
    return rows.find((row) => toFiniteNumber(row.rank) === selectedRank) ?? rows[0];
  }
  return rows[0];
}

function applyResourceQuantity(action = {}, selection = {}, selectedActionsById = new Map()) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "resources") {
    return source;
  }

  const resources = asObject(source.resources);
  const quantity = asObject(resources.quantity);
  if (!Object.keys(quantity).length && !asArray(resources.rankCosts).length) {
    return source;
  }

  const selectedRank = resolveSelectedRank(resources, selectedActionsById);
  const rankCost = resolveRankCostRow(resources, selectedRank);
  const min = toFiniteNumber(rankCost.min, toFiniteNumber(quantity.min, 0));
  const max = toFiniteNumber(rankCost.max, toFiniteNumber(quantity.max));
  const fallback = toFiniteNumber(quantity.default, min ?? 0);
  const value = clampNumber(selection?.value, min, max, fallback);
  const baseCost = toFiniteNumber(rankCost.baseCost, toFiniteNumber(resources.cost?.amount, 0)) ?? 0;
  const unitCost = toFiniteNumber(rankCost.unitCost, toFiniteNumber(rankCost.stepCost, toFiniteNumber(quantity.unitCost, 0))) ?? 0;
  const currency = cleanString(resources.cost?.currency) || "gp";
  const total = baseCost + (value * unitCost);
  const resourceQuantity = {
    value,
    min: min ?? "",
    max: max ?? "",
    step: toFiniteNumber(quantity.step, 1) ?? 1,
    unit: cleanString(quantity.unit),
    label: cleanString(resources.resourceName) || cleanString(source.label)
  };
  const computedCost = {
    rank: selectedRank,
    quantity: value,
    baseCost,
    unitCost,
    total,
    currency
  };

  return {
    ...clone(source),
    resources: {
      ...clone(resources),
      quantity: {
        ...clone(quantity),
        ...resourceQuantity
      },
      cost: {
        ...clone(asObject(resources.cost)),
        amount: total,
        currency
      }
    },
    resourceQuantity,
    computedCost
  };
}

function applySelectedItemChoice(action = {}, selection = {}) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "itemChoice") {
    return source;
  }

  const selectedItem = normalizeSelectedItem(selection?.item);
  if (!selectedItem) {
    return source;
  }

  return {
    ...clone(source),
    selectedItem
  };
}

function applySelectedFormulaRoll(action = {}, selection = {}, selectedActionsById = new Map()) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "formulaRoll") {
    return source;
  }

  const formula = resolveFormulaRollFormula(source, selection, selectedActionsById);
  const result = toFiniteNumber(selection?.result);
  if (!formula && result === undefined) {
    return source;
  }

  const nextAction = {
    ...clone(source)
  };
  if (formula) {
    nextAction.selectedFormula = formula;
  }
  if (result !== undefined) {
    nextAction.formulaResult = result;
  }
  return nextAction;
}

function matchesFormulaRule(rule = {}, selection = {}) {
  const source = asObject(rule);
  const value = toFiniteNumber(selection?.value);
  const min = toFiniteNumber(source.min);
  const max = toFiniteNumber(source.max);
  if ((min !== undefined || max !== undefined) && value === undefined) {
    return false;
  }
  if (value !== undefined) {
    if (min !== undefined && value < min) {
      return false;
    }
    if (max !== undefined && value > max) {
      return false;
    }
  }

  const optionId = cleanId(selection?.optionId);
  if (cleanId(source.optionId) && !optionId) {
    return false;
  }
  if (cleanId(source.optionId) && source.optionId !== optionId) {
    return false;
  }

  const choiceId = cleanId(selection?.choiceId);
  if (cleanId(source.choiceId) && !choiceId) {
    return false;
  }
  if (cleanId(source.choiceId) && source.choiceId !== choiceId) {
    return false;
  }

  return true;
}

function applySelectionDrivenFormula(action = {}, selections = new Map()) {
  const source = asObject(action);
  const config = asObject(source.dcFormulaBySelection);
  const sourceActionId = cleanId(config.actionId);
  if (!sourceActionId) {
    return source;
  }

  const selection = selections.get(sourceActionId);
  const rules = asArray(config.rules);
  const matchedRule = rules.find((rule) => matchesFormulaRule(rule, selection)) ?? null;
  const formula = cleanString(matchedRule?.formula) || cleanString(config.defaultFormula);
  if (!formula) {
    return source;
  }

  return {
    ...clone(source),
    dcFormula: formula
  };
}

function applyDescriptionBlockSelection(action = {}, selection = {}) {
  const source = asObject(action);
  if (cleanId(source.actionType) !== "descriptionBlock") {
    return source;
  }

  const block = asObject(source.descriptionBlock);
  return {
    ...clone(source),
    descriptionBlock: {
      ...clone(block),
      title: Object.hasOwn(selection ?? {}, "title") ? cleanString(selection.title) : cleanString(block.title),
      description: Object.hasOwn(selection ?? {}, "description") ? cleanString(selection.description) : cleanString(block.description)
    }
  };
}

function applyTargetActionSelection(action = {}, selections = new Map(), selectedActionsById = new Map()) {
  const source = asObject(action);
  const selection = selections.get(cleanId(source.id)) ?? {};
  const actionType = cleanId(source.actionType);
  let selectedAction = source;
  if (actionType === "resources") {
    selectedAction = applySelectedResourceChoice(source, selection);
    selectedAction = applyResourceQuantity(selectedAction, selection, selectedActionsById);
  }
  else if (actionType === "rankChoice") {
    selectedAction = applySelectedRankChoice(source, selection);
  }
  else if (actionType === "projectCounter") {
    selectedAction = applySelectedProjectCounter(source, selection, selectedActionsById);
  }
  else if (actionType === "optionChoice") {
    selectedAction = applySelectedOptionChoice(source, selection, selectedActionsById);
  }
  else if (actionType === "check") {
    selectedAction = applyConfigurableCheckSelection(source, selection, selectedActionsById);
  }
  else if (actionType === "numericInput") {
    selectedAction = applySelectedNumericInput(source, selection);
  }
  else if (actionType === "itemChoice") {
    selectedAction = applySelectedItemChoice(source, selection);
  }
  else if (actionType === "formulaRoll") {
    selectedAction = applySelectedFormulaRoll(source, selection, selectedActionsById);
  }
  else if (actionType === "descriptionBlock") {
    selectedAction = applyDescriptionBlockSelection(source, selection);
  }
  return applySelectionDrivenFormula(selectedAction, selections);
}

function isDowntimeTemplateActionId(actionId = "") {
  const safeActionId = cleanId(actionId);
  return Boolean(safeActionId) && (
    safeActionId.includes(".Item.")
    || safeActionId.startsWith("Item.")
    || safeActionId.startsWith("Compendium.")
  );
}

function isDowntimeTemplateItem(item) {
  return item?.type === DOWNTIME_ITEM_TYPE;
}

function getDowntimeTemplateConfig(item) {
  const flagValue = typeof item?.getFlag === "function"
    ? item.getFlag(MODULE_ID, DOWNTIME_TEMPLATE_FLAG)
    : undefined;
  return asObject(flagValue
    ?? getObjectPath(item, `flags.${MODULE_ID}.${DOWNTIME_TEMPLATE_FLAG}`)
    ?? getObjectPath(item, "system.rebreyaDowntime"));
}

function normalizeTemplateTargetActions(value = []) {
  return asArray(value)
    .map((action, index) => {
      const source = asObject(action);
      return {
        ...clone(source),
        id: cleanId(source.id) || `check-${index + 1}`,
        label: cleanString(source.label) || cleanString(source.title) || `Действие ${index + 1}`
      };
    })
    .filter((action) => action.label || action.actionType || action.sourceType);
}

function normalizeRankTable(value = []) {
  return asArray(value)
    .map((entry) => clone(asObject(entry)))
    .filter((entry) => Object.keys(entry).length > 0);
}

function normalizeStringList(value = []) {
  return asArray(value).map((entry) => cleanString(entry)).filter(Boolean);
}

function buildDowntimeTemplateActionFromItem(item) {
  if (!isDowntimeTemplateItem(item)) {
    return null;
  }

  const templateUuid = cleanId(item.uuid) || (cleanId(item.id) ? `Item.${cleanId(item.id)}` : "");
  if (!templateUuid) {
    return null;
  }

  const config = getDowntimeTemplateConfig(item);
  const descriptionHtml = cleanString(config.descriptionHtml)
    || cleanString(getObjectPath(item, "system.description.value"));
  const downtimeId = cleanId(config.downtimeId);
  return {
    id: templateUuid,
    label: cleanString(item.name) || "Простой",
    source: "item",
    templateUuid,
    templateItemId: cleanId(item.id),
    ...(downtimeId ? { downtimeId } : {}),
    rank: cleanString(config.rank),
    duration: cleanString(config.duration),
    summary: cleanString(config.summary),
    descriptionHtml,
    requirements: normalizeStringList(config.requirements),
    defaultWeeks: toWeeks(config.defaultWeeks, 1),
    rankMode: cleanString(config.rankMode),
    rankTable: normalizeRankTable(config.rankTable),
    targetActions: normalizeTemplateTargetActions(config.targetActions)
  };
}

function getDowntimeCompendiumPack() {
  return globalThis.game?.packs?.get?.(DOWNTIME_COMPENDIUM_PACK_ID) ?? null;
}

function getCompendiumDocumentIdFromUuid(value = "") {
  const safeValue = cleanId(value);
  const prefix = `Compendium.${DOWNTIME_COMPENDIUM_PACK_ID}.Item.`;
  return safeValue.startsWith(prefix) ? cleanId(safeValue.slice(prefix.length)) : "";
}

function getCompendiumRowDocumentId(row = {}) {
  return cleanId(row._id) || cleanId(row.id);
}

function getCompendiumRowDowntimeId(row = {}) {
  return cleanId(getObjectPath(row, `flags.${MODULE_ID}.downtimeId`))
    || cleanId(getObjectPath(row, `flags.${MODULE_ID}.${DOWNTIME_TEMPLATE_FLAG}.downtimeId`));
}

async function getDowntimeCompendiumIndex(pack) {
  if (!pack || typeof pack.getIndex !== "function") {
    return [];
  }

  const index = await pack.getIndex({
    fields: [
      `flags.${MODULE_ID}.downtimeId`,
      `flags.${MODULE_ID}.${DOWNTIME_TEMPLATE_FLAG}`,
      "system.description.value"
    ]
  });
  return collectionContents(index);
}

async function getDowntimeCompendiumDocument(pack, documentId = "") {
  const safeDocumentId = cleanId(documentId);
  if (!pack || !safeDocumentId || typeof pack.getDocument !== "function") {
    return null;
  }

  try {
    return await pack.getDocument(safeDocumentId);
  }
  catch (_error) {
    return null;
  }
}

async function resolveDowntimeCompendiumAction(actionId = "") {
  const safeActionId = cleanId(actionId);
  if (!safeActionId) {
    return null;
  }

  const pack = getDowntimeCompendiumPack();
  if (!pack) {
    return null;
  }

  const explicitDocumentId = getCompendiumDocumentIdFromUuid(safeActionId);
  if (explicitDocumentId) {
    const document = await getDowntimeCompendiumDocument(pack, explicitDocumentId);
    return buildDowntimeTemplateActionFromItem(document);
  }

  if (safeActionId.startsWith("Compendium.") && typeof globalThis.fromUuid === "function") {
    try {
      const document = await globalThis.fromUuid(safeActionId);
      const action = buildDowntimeTemplateActionFromItem(document);
      if (action) {
        return action;
      }
    }
    catch (_error) {
      return null;
    }
  }

  const index = await getDowntimeCompendiumIndex(pack);
  const row = index.find((entry) => getCompendiumRowDowntimeId(entry) === safeActionId) ?? null;
  if (!row) {
    return null;
  }

  const document = await getDowntimeCompendiumDocument(pack, getCompendiumRowDocumentId(row));
  return buildDowntimeTemplateActionFromItem(document);
}

function normalizeRequest(value = {}) {
  const requestedActionId = cleanId(value.actionId);
  const actionId = requestedActionId || cleanId(value.templateUuid);
  const status = REQUEST_STATUSES.has(cleanId(value.status)) ? cleanId(value.status) : "pending";
  const normalized = {
    id: cleanId(value.id),
    actorId: cleanId(value.actorId),
    actorName: cleanString(value.actorName),
    actionId,
    actionLabel: cleanString(value.actionLabel) || cleanString(value.title) || actionId,
    title: cleanString(value.title),
    description: cleanString(value.description),
    weeks: Math.max(1, toWeeks(value.weeks, 1)),
    status,
    checks: asArray(value.checks).map((check) => normalizeCheck(check)),
    result: cleanString(value.result),
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
    submittedByUserId: cleanId(value.submittedByUserId),
    reviewedByUserId: cleanId(value.reviewedByUserId)
  };
  if (isDowntimeTemplateActionId(actionId) || cleanId(value.templateUuid)) {
    normalized.templateUuid = cleanId(value.templateUuid) || actionId;
    normalized.templateItemId = cleanId(value.templateItemId);
    normalized.templateSource = cleanString(value.templateSource) || "item";
    normalized.templateRank = cleanString(value.templateRank);
    normalized.templateDuration = cleanString(value.templateDuration);
    normalized.templateSummary = cleanString(value.templateSummary);
    normalized.templateDescriptionHtml = cleanString(value.templateDescriptionHtml);
    normalized.templateRequirements = normalizeStringList(value.templateRequirements);
    normalized.templateRankTable = normalizeRankTable(value.templateRankTable);
  }
  return normalized;
}

function hasRecordedResult(check = {}) {
  const result = check?.result;
  return Boolean(result && typeof result === "object" && Object.keys(result).length > 0);
}

function isRollableDowntimeCheck(check = {}) {
  const actionType = cleanString(check?.actionType) || "check";
  return ROLLABLE_DOWNTIME_ACTION_TYPES.has(actionType);
}

function hasCompletedRollTargets(request = {}) {
  const rollableChecks = asArray(request.checks).filter((check) => isRollableDowntimeCheck(check));
  return rollableChecks.length > 0 && rollableChecks.every((check) => hasRecordedResult(check));
}

function getOptionalNumber(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
  return toFiniteNumber(value);
}

function evaluateThresholdResult(check = {}, result = {}) {
  const total = toFiniteNumber(result?.total);
  if (total === undefined) {
    return null;
  }

  const thresholds = asArray(check.thresholds);
  for (const [index, threshold] of thresholds.entries()) {
    const source = asObject(threshold);
    const from = getOptionalNumber(source.from);
    const to = getOptionalNumber(source.to);
    if (from !== undefined && total < from) {
      continue;
    }
    if (to !== undefined && total > to) {
      continue;
    }

    const outcome = cleanId(source.outcome) || cleanId(source.id) || `threshold-${index + 1}`;
    return {
      thresholdOutcome: outcome,
      thresholdLabel: cleanString(source.label) || outcome,
      thresholdFrom: from,
      thresholdTo: to
    };
  }

  return null;
}

function enrichResultWithThreshold(check = {}, result = {}) {
  const actionOutcomeMode = cleanId(check.outcomeMode);
  const actionRecordMode = cleanId(check.recordMode);
  if (actionOutcomeMode !== "thresholds" && actionRecordMode !== "pass-thresholds") {
    return result;
  }

  const thresholdResult = evaluateThresholdResult(check, result);
  if (!thresholdResult) {
    return result;
  }

  return {
    ...result,
    ...thresholdResult
  };
}

function enrichResultWithDc(check = {}, result = {}) {
  const outcomeMode = cleanId(result?.outcomeMode) || cleanId(check.outcomeMode);
  if (!["dc", "dc-sum"].includes(outcomeMode)) {
    return result;
  }

  const total = toFiniteNumber(result?.total);
  const dc = toFiniteNumber(result?.dc, toFiniteNumber(check.dc));
  if (total === undefined || dc === undefined || dc <= 0) {
    return result;
  }

  return {
    ...result,
    dc: Math.max(0, Math.floor(dc)),
    success: total >= dc
  };
}

function getResultFieldValue(result = {}, field = "") {
  const safeField = cleanId(field) || "thresholdOutcome";
  if (safeField in asObject(result)) {
    return result[safeField];
  }
  return getObjectPath(result, safeField);
}

function getFormulaSourceFieldValue(sourceAction = {}, field = "total") {
  const safeField = cleanId(field) || "total";
  const result = asObject(sourceAction?.result);

  if (safeField === "success") {
    if (result.success === true) {
      return 1;
    }
    if (result.success === false) {
      return 0;
    }
    return undefined;
  }

  if (safeField === "successes") {
    return getFormulaSourceFieldValue(sourceAction, "success");
  }

  if (safeField === "dcProgressSteps") {
    const total = toFiniteNumber(result.total);
    const dc = toFiniteNumber(result.dc, toFiniteNumber(sourceAction?.dc));
    if (total === undefined || dc === undefined || dc <= 0 || total < dc) {
      return 0;
    }
    return 1 + Math.floor((total - dc) / 5);
  }

  if (safeField === "quantity") {
    return toFiniteNumber(sourceAction?.resourceQuantity?.value, toFiniteNumber(sourceAction?.numericValue));
  }

  if (safeField === "computedTotal") {
    return toFiniteNumber(sourceAction?.computedCost?.total);
  }

  if (safeField === "formulaResult") {
    return toFiniteNumber(sourceAction?.formulaResult);
  }

  if (safeField === "selectedValue") {
    return toFiniteNumber(sourceAction?.selectedOption?.value);
  }

  if (safeField in result) {
    return toFiniteNumber(result[safeField]);
  }

  const nestedResultValue = toFiniteNumber(getObjectPath(result, safeField));
  if (nestedResultValue !== undefined) {
    return nestedResultValue;
  }

  return toFiniteNumber(sourceAction?.[safeField]);
}

function computeFormulaDowntimeResult(action = {}, checks = []) {
  if (cleanId(action.actionType) !== "downtimeResult") {
    return null;
  }

  const formula = asObject(action.resultFormula);
  const terms = asArray(formula.terms)
    .map((term) => asObject(term))
    .filter((term) => cleanId(term.actionId));
  if (!terms.length) {
    return null;
  }

  let total = 0;
  const sourceActionIds = [];
  const sourceFields = [];
  for (const [index, term] of terms.entries()) {
    const sourceActionId = cleanId(term.actionId);
    const sourceAction = checks.find((entry) => cleanId(entry?.id) === sourceActionId);
    if (!sourceAction) {
      return null;
    }

    const field = cleanId(term.field) || "total";
    const rawValue = getFormulaSourceFieldValue(sourceAction, field);
    if (rawValue === undefined) {
      return null;
    }

    const multiplier = toFiniteNumber(term.multiplier, 1) ?? 1;
    const value = rawValue * multiplier;
    const operator = cleanId(term.operator) === "-" ? "-" : "+";
    total += index === 0 || operator === "+" ? value : -value;
    sourceActionIds.push(sourceActionId);
    sourceFields.push(field);
  }

  const outputField = cleanId(formula.outputField) || cleanId(action.outputField) || "value";
  const computed = {
    total,
    value: total,
    [outputField]: total,
    outputField,
    sourceActionIds,
    sourceFields
  };
  const thresholdResult = evaluateThresholdResult(action, computed);
  if (thresholdResult) {
    computed.thresholdOutcome = thresholdResult.thresholdOutcome;
    computed.thresholdLabel = thresholdResult.thresholdLabel;
    computed.thresholdFrom = thresholdResult.thresholdFrom;
    computed.thresholdTo = thresholdResult.thresholdTo;
    computed.label = thresholdResult.thresholdLabel;
  }
  else if (cleanString(formula.label)) {
    computed.label = cleanString(formula.label);
  }

  return computed;
}

function computeMappedDowntimeResult(action = {}, checks = []) {
  if (cleanId(action.actionType) !== "downtimeResult") {
    return null;
  }

  const mapping = asObject(action.resultMapping);
  const sourceActionId = cleanId(mapping.sourceActionId);
  if (!sourceActionId) {
    return null;
  }

  const sourceAction = checks.find((entry) => cleanId(entry?.id) === sourceActionId);
  const sourceResult = asObject(sourceAction?.result);
  if (!Object.keys(sourceResult).length) {
    return null;
  }

  const sourceField = cleanId(mapping.sourceField) || "thresholdOutcome";
  const sourceValue = cleanId(getResultFieldValue(sourceResult, sourceField));
  if (!sourceValue) {
    return null;
  }

  const rows = asArray(mapping.rows).map((row) => asObject(row));
  const matchedRow = rows.find((row) => (
    cleanId(row.sourceOutcome) === sourceValue
    || cleanId(row.match) === sourceValue
  ));
  if (!matchedRow) {
    return null;
  }

  const value = toFiniteNumber(matchedRow.value);
  const label = cleanString(matchedRow.label)
    || (value !== undefined ? String(value) : cleanString(matchedRow.outcome) || sourceValue);
  const outputField = cleanId(mapping.outputField) || "value";
  const computed = {
    label,
    sourceActionId,
    sourceField,
    sourceOutcome: sourceValue,
    sourceLabel: cleanString(sourceResult.thresholdLabel),
    outputField
  };
  if (value !== undefined) {
    computed.value = value;
    computed[outputField] = value;
  }
  const outcome = cleanId(matchedRow.outcome);
  if (outcome) {
    computed.outcome = outcome;
  }
  if (sourceResult.total !== undefined) {
    computed.sourceTotal = sourceResult.total;
  }
  return computed;
}

function refreshMappedDowntimeResults(request = {}) {
  const checks = asArray(request.checks);
  for (const action of checks) {
    const computedResult = computeMappedDowntimeResult(action, checks) ?? computeFormulaDowntimeResult(action, checks);
    if (computedResult) {
      action.result = computedResult;
    }
  }
}

function getMaxRequestCounter(requests = []) {
  return asArray(requests).reduce((maxCounter, request) => {
    const match = /^downtime-(\d+)$/u.exec(cleanId(request?.id));
    if (!match) {
      return maxCounter;
    }

    return Math.max(maxCounter, Math.floor(Number(match[1]) || 0));
  }, 0);
}

function normalizeDowntimeState(value = {}) {
  const source = asObject(value);
  const balancesByActorId = {};
  for (const [rawActorId, rawBalance] of Object.entries(asObject(source.balancesByActorId))) {
    const actorId = cleanId(rawActorId);
    if (actorId) {
      balancesByActorId[actorId] = normalizeBalance(rawBalance);
    }
  }

  const requests = asArray(source.requests).map((request) => normalizeRequest(request)).filter((request) => request.id);
  const counter = Math.max(toWeeks(source.counter), getMaxRequestCounter(requests));

  return {
    balancesByActorId,
    requests,
    checks: asArray(source.checks).map((check) => normalizeCheck(check)),
    history: clone(asArray(source.history)),
    counter
  };
}

function getCurrentUser() {
  return globalThis.game?.user ?? null;
}

function isActorOwnedByCurrentUser(actor) {
  const user = getCurrentUser();
  if (!user || !actor || actor.type !== "character") {
    return false;
  }

  if (user.isGM) {
    return true;
  }

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true;
  }

  if (actor.isOwner === true) {
    return true;
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

function buildAuditFields(existing = {}) {
  const now = Date.now();
  return {
    createdAt: Number(existing.createdAt) || now,
    updatedAt: now
  };
}

export class DowntimeService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  getActionCatalog() {
    let context = null;
    try {
      context = this.#resolveContext();
    }
    catch (_error) {
      context = null;
    }

    return this.#getActionCatalog(context);
  }

  getSnapshot({ actorId = "" } = {}) {
    const context = this.#resolveContext();
    const state = normalizeDowntimeState(context.groupState?.downtimeState);
    const selectedActorId = cleanId(actorId);
    const memberActorIds = new Set(context.memberActorIds ?? []);
    const currentMembers = asArray(context.members).filter((actor) => memberActorIds.has(actor?.id));

    const members = currentMembers.map((actor) => ({
      actorId: actor.id,
      actorName: actor.name ?? actor.id,
      actorImg: actor.img ?? "",
      selected: selectedActorId ? actor.id === selectedActorId : false,
      canSubmit: this.#canSubmitForActor(actor, context),
      balance: normalizeBalance(state.balancesByActorId[actor.id] ?? buildDefaultBalance())
    }));

    if (members.length && selectedActorId && !members.some((member) => member.selected)) {
      members[0].selected = true;
    }

    return {
      groupId: context.groupId,
      canManage: this.#canManage(context),
      canSubmit: members.some((member) => member.canSubmit),
      members,
      balancesByActorId: clone(state.balancesByActorId),
      requests: state.requests.map((request) => clone(request)),
      actionCatalog: this.#getActionCatalog(context),
      counter: state.counter
    };
  }

  async grantWeeks({ actorIds = [], weeks = 0, reason = "" } = {}) {
    const context = this.#resolveContext();
    this.#assertCanManage(context);
    const safeWeeks = this.#requirePositiveWeeks(weeks);
    const memberActorIds = this.#getMemberActorIds(context);
    const requestedActorIds = asArray(actorIds).map((actorId) => cleanId(actorId)).filter(Boolean);
    const targetActorIds = requestedActorIds.length
      ? requestedActorIds.filter((actorId) => memberActorIds.has(actorId))
      : [...memberActorIds];

    if (!targetActorIds.length) {
      throw new Error("No current group members selected.");
    }

    return this.#writeGroupState(context, (state) => {
      for (const actorId of targetActorIds) {
        const balance = normalizeBalance(state.balancesByActorId[actorId] ?? buildDefaultBalance());
        balance.availableWeeks += safeWeeks;
        balance.totalGrantedWeeks += safeWeeks;
        state.balancesByActorId[actorId] = balance;
      }

      state.history.push({
        id: `downtime-history-${Date.now()}`,
        type: "grant",
        actorIds: [...targetActorIds],
        weeks: safeWeeks,
        reason: cleanString(reason),
        userId: cleanId(getCurrentUser()?.id),
        createdAt: Date.now()
      });

      return {
        actorIds: [...targetActorIds],
        weeks: safeWeeks,
        reason: cleanString(reason)
      };
    });
  }

  async revokeWeeks({ actorIds = [], weeks = 0, reason = "" } = {}) {
    const context = this.#resolveContext();
    this.#assertCanManage(context);
    const safeWeeks = this.#requirePositiveWeeks(weeks);
    const memberActorIds = this.#getMemberActorIds(context);
    const requestedActorIds = asArray(actorIds).map((actorId) => cleanId(actorId)).filter(Boolean);
    const hasExplicitTargets = requestedActorIds.length > 0;
    const targetActorIds = requestedActorIds.length
      ? requestedActorIds.filter((actorId) => memberActorIds.has(actorId))
      : [...memberActorIds];

    if (!targetActorIds.length) {
      throw new Error("No current group members selected.");
    }

    return this.#writeGroupState(context, (state) => {
      const revocations = [];
      const skippedActorIds = [];

      for (const actorId of targetActorIds) {
        const balance = normalizeBalance(state.balancesByActorId[actorId] ?? buildDefaultBalance());
        if (hasExplicitTargets && balance.availableWeeks < safeWeeks) {
          throw new Error("Not enough available downtime weeks.");
        }

        const revokedWeeks = hasExplicitTargets ? safeWeeks : Math.min(balance.availableWeeks, safeWeeks);
        if (revokedWeeks <= 0) {
          skippedActorIds.push(actorId);
          continue;
        }

        revocations.push({
          actorId,
          weeks: revokedWeeks
        });
      }

      for (const revocation of revocations) {
        const balance = normalizeBalance(state.balancesByActorId[revocation.actorId] ?? buildDefaultBalance());
        balance.availableWeeks -= revocation.weeks;
        balance.totalGrantedWeeks = Math.max(
          balance.availableWeeks + balance.reservedWeeks + balance.spentWeeks,
          balance.totalGrantedWeeks - revocation.weeks
        );
        state.balancesByActorId[revocation.actorId] = balance;
      }

      const revokedActorIds = revocations.map((revocation) => revocation.actorId);
      const totalRevokedWeeks = revocations.reduce((total, revocation) => total + revocation.weeks, 0);
      if (revocations.length) {
        state.history.push({
          id: `downtime-history-${Date.now()}`,
          type: "revoke",
          actorIds: revokedActorIds,
          skippedActorIds,
          weeks: safeWeeks,
          totalRevokedWeeks,
          reason: cleanString(reason),
          userId: cleanId(getCurrentUser()?.id),
          createdAt: Date.now()
        });
      }

      return {
        actorIds: revokedActorIds,
        skippedActorIds,
        weeks: safeWeeks,
        totalRevokedWeeks,
        reason: cleanString(reason)
      };
    });
  }

  async clearHistory() {
    const context = this.#resolveContext();
    this.#assertCanManage(context);

    return this.#writeGroupState(context, (state) => {
      let releasedWeeks = 0;
      for (const request of state.requests) {
        if (!OPEN_RESERVED_STATUSES.has(request.status)) {
          continue;
        }

        const balance = normalizeBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
        const requestWeeks = Math.max(1, toWeeks(request.weeks, 1));
        const released = Math.min(balance.reservedWeeks, requestWeeks);
        balance.reservedWeeks = Math.max(0, balance.reservedWeeks - released);
        balance.availableWeeks += released;
        releasedWeeks += released;
        state.balancesByActorId[request.actorId] = balance;
      }

      const removedRequests = state.requests.length;
      const actorIds = [
        ...new Set([
          ...Object.keys(state.balancesByActorId),
          ...state.requests.map((request) => cleanId(request.actorId)).filter(Boolean)
        ])
      ];
      state.requests = [];
      state.checks = [];
      state.history = [];
      state.counter = 0;

      return {
        actorIds,
        removedRequests,
        releasedWeeks
      };
    });
  }

  async createRequest({
    groupId = "",
    actorId = "",
    actionId = "",
    title = "",
    description = "",
    weeks = 1,
    targetActionSelections = [],
    submittedByUserId = ""
  } = {}) {
    const context = cleanId(groupId)
      ? this.moduleApi?.groupContextService?.resolveForGroup?.(cleanId(groupId))
      : this.#resolveContext();
    const actor = this.#requireCurrentMemberActor(context, actorId);
    this.#assertCanSubmitForActor(actor, context);
    const safeWeeks = this.#requirePositiveWeeks(weeks);
    const action = await this.#resolveAction(context, actionId);
    const resolvedActionId = action.id;
    const safeTitle = cleanString(title) || action.label;
    const userId = cleanId(submittedByUserId) || cleanId(getCurrentUser()?.id);
    const actionSelections = normalizeTargetActionSelections(targetActionSelections);

    return this.#writeGroupState(context, (state) => {
      const balance = normalizeBalance(state.balancesByActorId[actor.id] ?? buildDefaultBalance());
      if (balance.availableWeeks < safeWeeks) {
        throw new Error("Not enough available downtime weeks.");
      }

      balance.availableWeeks -= safeWeeks;
      balance.reservedWeeks += safeWeeks;
      state.balancesByActorId[actor.id] = balance;
      state.counter += 1;
      const audit = buildAuditFields();
      const checks = [];
      const selectedActionsById = new Map();
      for (const [index, targetAction] of asArray(action.targetActions).entries()) {
        const selectedTargetAction = applyTargetActionSelection(targetAction, actionSelections, selectedActionsById);
        const normalizedCheck = normalizeCheck({
          id: cleanId(selectedTargetAction?.id) || `check-${index + 1}`,
          ...asObject(selectedTargetAction)
        });
        selectedActionsById.set(normalizedCheck.id, normalizedCheck);
        checks.push(normalizedCheck);
      }

      const request = {
        id: `downtime-${state.counter}`,
        actorId: actor.id,
        actorName: actor.name ?? actor.id,
        actionId: resolvedActionId,
        actionLabel: action.label,
        title: safeTitle,
        description: cleanString(description),
        weeks: safeWeeks,
        status: "pending",
        checks,
        result: "",
        ...audit,
        submittedByUserId: userId,
        reviewedByUserId: ""
      };
      if (action.source === "item") {
        request.templateUuid = cleanId(action.templateUuid) || resolvedActionId;
        request.templateItemId = cleanId(action.templateItemId);
        request.templateSource = "item";
        request.templateRank = cleanString(action.rank);
        request.templateDuration = cleanString(action.duration);
        request.templateSummary = cleanString(action.summary);
        request.templateDescriptionHtml = cleanString(action.descriptionHtml);
        request.templateRequirements = normalizeStringList(action.requirements);
        request.templateRankTable = normalizeRankTable(action.rankTable);
      }
      refreshMappedDowntimeResults(request);
      state.requests.push(request);
      return clone(request);
    });
  }

  async setRequestStatus(requestId, status, { result = "" } = {}) {
    const context = this.#resolveContext();
    this.#assertCanManage(context);
    const safeRequestId = cleanId(requestId);
    const nextStatus = cleanId(status);
    if (!REQUEST_STATUSES.has(nextStatus)) {
      throw new Error("Unknown downtime request status.");
    }

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      this.#assertRequestIsMutable(request);

      const effectiveStatus = nextStatus === "approved" && hasCompletedRollTargets(request)
        ? "completed"
        : nextStatus;
      const balance = normalizeBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
      this.#applyStatusAccounting(balance, request.status, effectiveStatus, request.weeks);
      request.status = effectiveStatus;
      request.result = cleanString(result);
      request.reviewedByUserId = cleanId(getCurrentUser()?.id);
      request.updatedAt = Date.now();
      state.balancesByActorId[request.actorId] = balance;
      return clone(request);
    });
  }

  async setRequestChecks(requestId, checks = []) {
    const context = this.#resolveContext();
    this.#assertCanManage(context);
    const safeRequestId = cleanId(requestId);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      this.#assertRequestIsMutable(request);
      request.checks = asArray(checks).map((check, index) => {
        const normalized = normalizeCheck({
          id: cleanId(check?.id) || `check-${index + 1}`,
          ...asObject(check)
        });
        return normalized;
      });
      refreshMappedDowntimeResults(request);
      request.reviewedByUserId = cleanId(getCurrentUser()?.id);
      request.updatedAt = Date.now();
      return clone(request);
    });
  }

  async recordCheckResult(requestId, checkId, result = {}, { groupId = "", actorId = "" } = {}) {
    const context = cleanId(groupId)
      ? this.moduleApi?.groupContextService?.resolveForGroup?.(cleanId(groupId))
      : this.#resolveContext();
    const safeRequestId = cleanId(requestId);
    const safeCheckId = cleanId(checkId);
    const safeActorId = cleanId(actorId);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      this.#assertRequestIsMutable(request);
      if (safeActorId && request.actorId !== safeActorId) {
        throw new Error("Downtime request does not belong to this character.");
      }
      if (!this.#canManage(context)) {
        const actor = this.#requireCurrentMemberActor(context, request.actorId);
        if (!this.#canSubmitForActor(actor, context)) {
          throw new Error("Players can record results only for an owned character.");
        }
      }

      const check = request.checks.find((entry) => entry.id === safeCheckId);
      if (!check) {
        throw new Error("Downtime check not found.");
      }

      const enrichedResult = enrichResultWithThreshold(check, enrichResultWithDc(check, clone(asObject(result))));
      check.result = {
        ...enrichedResult,
        recordedByUserId: cleanId(asObject(result).recordedByUserId) || cleanId(getCurrentUser()?.id),
        recordedAt: Date.now()
      };
      refreshMappedDowntimeResults(request);
      request.updatedAt = Date.now();
      return clone(request);
    });
  }

  #resolveContext() {
    const context = this.moduleApi?.groupContextService?.resolveForCurrentUser?.();
    if (!context?.groupId) {
      throw new Error("Downtime requires an active group context.");
    }

    return context;
  }

  #getMemberActorIds(context) {
    return new Set(asArray(context.memberActorIds).map((actorId) => cleanId(actorId)).filter(Boolean));
  }

  #canManage(context) {
    return Boolean(getCurrentUser()?.isGM) && Boolean(context?.groupId);
  }

  #assertCanManage(context) {
    if (!this.#canManage(context)) {
      throw new Error("Only a GM can manage downtime for the active group.");
    }
  }

  #canSubmitForActor(actor, context) {
    if (this.#canManage(context)) {
      return true;
    }

    return this.#getMemberActorIds(context).has(actor?.id) && isActorOwnedByCurrentUser(actor);
  }

  #getDowntimeTemplateActions(context) {
    return collectionContents(context?.groupActor?.items)
      .map((item) => buildDowntimeTemplateActionFromItem(item))
      .filter(Boolean);
  }

  #getActionCatalog(context = null) {
    const templateActions = this.#getDowntimeTemplateActions(context);
    return templateActions.map((action) => clone(action));
  }

  async #resolveAction(context, actionId) {
    const safeActionId = cleanId(actionId);
    const templateAction = this.#getDowntimeTemplateActions(context)
      .find((action) => action.id === safeActionId
        || action.templateUuid === safeActionId
        || action.templateItemId === safeActionId
        || action.downtimeId === safeActionId);
    if (templateAction) {
      return templateAction;
    }

    const compendiumAction = await resolveDowntimeCompendiumAction(safeActionId);
    if (compendiumAction) {
      return compendiumAction;
    }

    throw new Error("Downtime action not found.");
  }

  #assertCanSubmitForActor(actor, context) {
    if (!this.#canSubmitForActor(actor, context)) {
      throw new Error("Players can act only for an owned character.");
    }
  }

  #requireCurrentMemberActor(context, actorId) {
    const safeActorId = cleanId(actorId);
    if (!safeActorId) {
      throw new Error("Choose a current group member.");
    }

    const memberActorIds = this.#getMemberActorIds(context);
    if (!memberActorIds.has(safeActorId)) {
      throw new Error("Actor must be a current group member.");
    }

    const actor = asArray(context.members).find((memberActor) => memberActor?.id === safeActorId) ?? null;
    if (!actor) {
      throw new Error("Actor must be a current group member.");
    }

    return actor;
  }

  #requirePositiveWeeks(value) {
    const weeks = toWeeks(value);
    if (weeks <= 0) {
      throw new Error("Downtime weeks must be greater than zero.");
    }

    return weeks;
  }

  async #writeGroupState(context, mutator) {
    const registry = this.moduleApi?.groupContextService?.getRegistry?.();
    if (!registry || typeof registry !== "object") {
      throw new Error("Downtime registry is unavailable.");
    }

    registry.groupsById ??= {};
    registry.groupsById[context.groupId] ??= {
      version: 1,
      groupActorId: context.groupId
    };
    const groupState = registry.groupsById[context.groupId];
    groupState.groupActorId = context.groupId;
    const state = normalizeDowntimeState(groupState.downtimeState);
    const result = await mutator(state);
    groupState.downtimeState = state;
    await this.moduleApi.groupContextService.setRegistry(registry);
    return result;
  }

  #findRequest(state, requestId) {
    const request = state.requests.find((entry) => entry.id === requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    return request;
  }

  #assertRequestIsMutable(request) {
    if (request?.status === "completed") {
      throw new Error("A completed request is terminal for this downtime slice.");
    }
  }

  #applyStatusAccounting(balance, currentStatus, nextStatus, weeks) {
    if (currentStatus === nextStatus) {
      return;
    }

    const safeWeeks = Math.max(1, toWeeks(weeks, 1));
    if (OPEN_RESERVED_STATUSES.has(currentStatus) && RELEASED_STATUSES.has(nextStatus)) {
      if (balance.reservedWeeks < safeWeeks) {
        throw new Error("Reserved downtime weeks are lower than the request cost.");
      }

      balance.reservedWeeks = Math.max(0, balance.reservedWeeks - safeWeeks);
      balance.availableWeeks += safeWeeks;
      return;
    }

    if (OPEN_RESERVED_STATUSES.has(currentStatus) && nextStatus === "completed") {
      if (balance.reservedWeeks < safeWeeks) {
        throw new Error("Reserved downtime weeks are lower than the request cost.");
      }

      balance.reservedWeeks = Math.max(0, balance.reservedWeeks - safeWeeks);
      balance.spentWeeks += safeWeeks;
      return;
    }

    if (RELEASED_STATUSES.has(currentStatus) && OPEN_RESERVED_STATUSES.has(nextStatus)) {
      if (balance.availableWeeks < safeWeeks) {
        throw new Error("Not enough available downtime weeks.");
      }

      balance.availableWeeks -= safeWeeks;
      balance.reservedWeeks += safeWeeks;
      return;
    }

    if (RELEASED_STATUSES.has(currentStatus) && nextStatus === "completed") {
      throw new Error("A downtime request must be reserved before completion.");
    }
  }
}
