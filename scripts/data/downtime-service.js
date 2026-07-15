import { DOWNTIME_COMPENDIUM_NAME, DOWNTIME_ITEM_TYPE, MODULE_ID } from "../constants.js";
import {
  cloneFoundryValue as clone,
  collectionValues as collectionContents
} from "../shared/foundry-values.js";
import {
  allocateRequestSlots,
  buildGrantSlots,
  nearestMonday,
  releaseFutureRequestSlots,
  summarizeScheduleByDate
} from "./downtime-scheduler.js";

const OPEN_RESERVED_STATUSES = new Set(["pending", "approved"]);
const RELEASED_STATUSES = new Set(["rejected", "returned", "cancelled"]);
const REQUEST_STATUSES = new Set(["pending", "approved", "returned", "rejected", "cancelled", "completed"]);
const MAX_TARGET_CHOICES = 5;
const DOWNTIME_TEMPLATE_FLAG = "downtime";
const DOWNTIME_COMPENDIUM_PACK_ID = `world.${DOWNTIME_COMPENDIUM_NAME}`;
const ROLLABLE_DOWNTIME_ACTION_TYPES = new Set(["check", "choice"]);
const WORKDAYS_PER_WEEK = 5;
const DOWNTIME_STATE_VERSION = 2;
const DOWNTIME_V2_MIGRATION_ID = "downtime-v1-to-v2";
const DOWNTIME_V2_ENVELOPE_ID = "downtime-state-v2-envelope";
const PROCESSABLE_SLOT_STATUSES = new Set(["approved", "blocked"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
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
    availableWorkdays: 0,
    reservedWorkdays: 0,
    spentWorkdays: 0,
    totalGrantedWorkdays: 0
  };
}

function normalizeWorkdayBalance(value = {}, { legacyWeeks = false } = {}) {
  const multiplier = legacyWeeks ? WORKDAYS_PER_WEEK : 1;
  return {
    availableWorkdays: toWeeks(legacyWeeks ? value.availableWeeks : value.availableWorkdays) * multiplier,
    reservedWorkdays: toWeeks(legacyWeeks ? value.reservedWeeks : value.reservedWorkdays) * multiplier,
    spentWorkdays: toWeeks(legacyWeeks ? value.spentWeeks : value.spentWorkdays) * multiplier,
    totalGrantedWorkdays: toWeeks(legacyWeeks ? value.totalGrantedWeeks : value.totalGrantedWorkdays) * multiplier
  };
}

function buildBalanceView(value = {}) {
  const balance = normalizeWorkdayBalance(value);
  return {
    ...balance,
    availableWeeks: Math.floor(balance.availableWorkdays / WORKDAYS_PER_WEEK),
    reservedWeeks: Math.floor(balance.reservedWorkdays / WORKDAYS_PER_WEEK),
    spentWeeks: Math.floor(balance.spentWorkdays / WORKDAYS_PER_WEEK),
    totalGrantedWeeks: Math.floor(balance.totalGrantedWorkdays / WORKDAYS_PER_WEEK)
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

function buildSelectedRequestChecks(action = {}, actionSelections = new Map()) {
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
  return checks;
}

function applyRequestTemplateMetadata(request = {}, action = {}, resolvedActionId = "") {
  for (const key of [
    "templateUuid",
    "templateItemId",
    "templateSource",
    "templateRank",
    "templateDuration",
    "templateSummary",
    "templateDescriptionHtml",
    "templateRequirements",
    "templateRankTable"
  ]) {
    delete request[key];
  }

  if (action.source !== "item") {
    return;
  }

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

function templateActionMatchesLegacyId(action = {}, actionId = "") {
  const safeActionId = cleanId(actionId);
  if (!safeActionId) {
    return false;
  }

  return asArray(action.targetActions)
    .some((targetAction) => cleanId(targetAction?.id).startsWith(`${safeActionId}-`));
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

  const documentById = await getDowntimeCompendiumDocument(pack, safeActionId);
  const documentByIdAction = buildDowntimeTemplateActionFromItem(documentById);
  if (documentByIdAction) {
    return documentByIdAction;
  }

  const index = await getDowntimeCompendiumIndex(pack);
  const row = index.find((entry) => getCompendiumRowDowntimeId(entry) === safeActionId
    || getCompendiumRowDocumentId(entry) === safeActionId) ?? null;
  if (!row) {
    return null;
  }

  const document = await getDowntimeCompendiumDocument(pack, getCompendiumRowDocumentId(row));
  return buildDowntimeTemplateActionFromItem(document);
}

function normalizeRequest(value = {}) {
  const source = asObject(value);
  const requestedActionId = cleanId(value.actionId);
  const actionId = requestedActionId || cleanId(value.templateUuid);
  const status = REQUEST_STATUSES.has(cleanId(value.status)) ? cleanId(value.status) : "pending";
  const weeks = Math.max(1, toWeeks(value.weeks, 1));
  const normalized = {
    ...clone(source),
    id: cleanId(value.id),
    actorId: cleanId(value.actorId),
    actorName: cleanString(value.actorName),
    actionId,
    actionLabel: cleanString(value.actionLabel) || cleanString(value.title) || actionId,
    title: cleanString(value.title),
    description: cleanString(value.description),
    weeks,
    workdays: Math.max(1, toWeeks(value.workdays, weeks * WORKDAYS_PER_WEEK)),
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
  if (value.projectClosed === true) {
    normalized.projectClosed = true;
    normalized.projectClosedAt = Number(value.projectClosedAt) || 0;
    normalized.projectClosedByUserId = cleanId(value.projectClosedByUserId);
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

function hasAnyRecordedResult(request = {}) {
  return asArray(request.checks).some((check) => hasRecordedResult(check));
}

function getProjectCounterCheck(checks = []) {
  return asArray(checks).find((check) => cleanId(check?.actionType) === "projectCounter") ?? null;
}

function getProjectProgressSteps(checks = []) {
  const resultAction = asArray(checks)
    .find((check) => cleanId(check?.actionType) === "downtimeResult"
      && asObject(check?.result).progressSteps !== undefined);
  const result = asObject(resultAction?.result);
  return Math.max(0, toWeeks(result.progressSteps, toWeeks(result.value, toWeeks(result.total, 0))));
}

function getProjectCounterState(checks = []) {
  const counterCheck = getProjectCounterCheck(checks);
  if (!counterCheck) {
    return null;
  }

  const counter = asObject(counterCheck.projectCounter);
  const max = Math.max(1, toWeeks(counter.max, toWeeks(counterCheck.max, 0)));
  if (max <= 0) {
    return null;
  }

  const current = Math.min(max, toWeeks(counter.current, toWeeks(counter.value, 0)) + getProjectProgressSteps(checks));
  return {
    check: counterCheck,
    counter,
    current,
    max
  };
}

function clearWeeklyProjectResults(request = {}) {
  for (const check of asArray(request.checks)) {
    const actionType = cleanId(check?.actionType);
    if (actionType === "downtimeResult" || isRollableDowntimeCheck(check)) {
      check.result = null;
    }
  }
}

function applyCheckResultToRequest(request = {}, checkId = "", result = {}) {
  const safeCheckId = cleanId(checkId);
  const check = asArray(request.checks).find((entry) => entry.id === safeCheckId);
  if (!check) {
    throw new Error("Downtime check not found.");
  }

  const sourceResult = clone(asObject(result));
  const enrichedResult = enrichResultWithThreshold(check, enrichResultWithDc(check, sourceResult));
  check.result = {
    ...enrichedResult,
    recordedByUserId: cleanId(sourceResult.recordedByUserId) || cleanId(getCurrentUser()?.id),
    recordedAt: Date.now()
  };
  refreshMappedDowntimeResults(request);
  request.updatedAt = Date.now();
  return check;
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

function normalizeGrant(value = {}) {
  const source = asObject(value);
  return {
    ...clone(source),
    id: cleanId(source.id),
    actorId: cleanId(source.actorId),
    workdays: toWeeks(source.workdays),
    anchorMonday: cleanString(source.anchorMonday),
    createdAt: Number(source.createdAt) || 0,
    reason: cleanString(source.reason)
  };
}

function normalizeScheduleSlot(value = {}) {
  const source = asObject(value);
  const status = ["free", "pending", "approved", "processed", "blocked"].includes(cleanId(source.status))
    ? cleanId(source.status)
    : "free";
  return {
    ...clone(source),
    id: cleanId(source.id),
    actorId: cleanId(source.actorId),
    isoDate: cleanString(source.isoDate),
    status,
    grantId: cleanId(source.grantId),
    requestId: cleanId(source.requestId) || null,
    projectId: cleanId(source.projectId) || null,
    activityId: cleanId(source.activityId) || null,
    hours: source.hours == null ? null : toFiniteNumber(source.hours, null),
    blockReason: cleanString(source.blockReason) || null,
    processedTransitionId: cleanId(source.processedTransitionId) || null,
    processingTransitionId: cleanId(source.processingTransitionId) || null
  };
}

function normalizeWorkLogEntry(value = {}) {
  const source = asObject(value);
  return {
    ...clone(source),
    id: cleanId(source.id),
    actorId: cleanId(source.actorId),
    isoDate: cleanString(source.isoDate),
    requestId: cleanId(source.requestId) || null,
    projectId: cleanId(source.projectId) || null,
    transitionId: cleanId(source.transitionId),
    createdAt: Number(source.createdAt) || 0
  };
}

function normalizeTransitionJournalEntry(value = {}) {
  const source = asObject(value);
  const status = ["processing", "completed", "reconciliation-required"].includes(cleanId(source.status))
    ? cleanId(source.status)
    : "reconciliation-required";
  return {
    ...clone(source),
    transitionId: cleanId(source.transitionId),
    isoDate: cleanString(source.isoDate),
    slotIds: asArray(source.slotIds).map((slotId) => cleanId(slotId)).filter(Boolean),
    status,
    resultsBySlotId: clone(asObject(source.resultsBySlotId)),
    createdAt: Number(source.createdAt) || 0,
    updatedAt: Number(source.updatedAt) || 0
  };
}

function hasMeaningfulValue(value) {
  if (value == null || value === false || value === 0 || value === "") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulValue(entry));
  }
  if (typeof value === "object") {
    return Object.values(value).some((entry) => hasMeaningfulValue(entry));
  }
  return true;
}

function hasResourceMutationEvidence(outcome) {
  if (Array.isArray(outcome)) {
    return outcome.some((entry) => hasResourceMutationEvidence(entry));
  }
  if (!outcome || typeof outcome !== "object") {
    return false;
  }
  return Object.entries(outcome).some(([key, value]) => (
    (/(?:receipt|spend|spent|debit|consum)/iu.test(key) && hasMeaningfulValue(value))
    || hasResourceMutationEvidence(value)
  ));
}

function buildDowntimeOperationId(transitionId, slotId) {
  return `downtime:${transitionId}:${slotId}`;
}

function findTransitionJournalEntry(state, isoDate, transitionId) {
  return state.transitionJournal.find((entry) => (
    entry.isoDate === isoDate && entry.transitionId === transitionId
  ));
}

function isTerminalTransitionResult(result) {
  return ["processed", "blocked"].includes(cleanId(result?.status));
}

function findNonterminalSlotClaim(state, slotId, { excludeTransitionId = "" } = {}) {
  const safeSlotId = cleanId(slotId);
  const excludedId = cleanId(excludeTransitionId);
  return state.transitionJournal.find((journal) => (
    journal.transitionId !== excludedId
    && journal.status !== "completed"
    && journal.slotIds.includes(safeSlotId)
    && !isTerminalTransitionResult(journal.resultsBySlotId[safeSlotId])
  )) ?? null;
}

function buildSlotClaimMetadata(slot) {
  return {
    claimedActorId: cleanId(slot?.actorId),
    claimedRequestId: cleanId(slot?.requestId),
    claimedStatus: cleanId(slot?.status)
  };
}

function getDowntimeStateSource(value = {}) {
  const raw = asObject(value);
  const history = asArray(raw.history);
  const envelope = history.find((entry) => entry?.id === DOWNTIME_V2_ENVELOPE_ID);
  if (!envelope) {
    return raw;
  }

  return {
    ...clone(raw),
    version: Number(envelope.version) || DOWNTIME_STATE_VERSION,
    grants: clone(asArray(envelope.grants)),
    scheduleSlots: clone(asArray(envelope.scheduleSlots)),
    transitionJournal: clone(asArray(envelope.transitionJournal)),
    workLog: clone(asArray(envelope.workLog)),
    history: clone(history.filter((entry) => entry?.id !== DOWNTIME_V2_ENVELOPE_ID))
  };
}

function buildPersistedDowntimeStateV2(state) {
  const source = clone(asObject(state));
  const history = asArray(source.history)
    .filter((entry) => entry?.id !== DOWNTIME_V2_ENVELOPE_ID);
  return {
    ...source,
    history: [
      ...history,
      {
        id: DOWNTIME_V2_ENVELOPE_ID,
        type: "state-envelope",
        version: DOWNTIME_STATE_VERSION,
        grants: clone(asArray(source.grants)),
        scheduleSlots: clone(asArray(source.scheduleSlots)),
        transitionJournal: clone(asArray(source.transitionJournal)),
        workLog: clone(asArray(source.workLog))
      }
    ]
  };
}

function migrateLegacySchedule(state, currentIsoDate, legacyActorIds) {
  for (const actorId of legacyActorIds) {
    const balance = state.balancesByActorId[actorId];
    const unspentWorkdays = balance.availableWorkdays + balance.reservedWorkdays;
    if (unspentWorkdays <= 0) {
      continue;
    }

    const grantId = `downtime-migration-${actorId}`;
    const actorSlots = state.scheduleSlots.filter((slot) => slot.actorId === actorId);
    const occupiedDates = new Set(actorSlots
      .map((slot) => slot.isoDate));
    const existingUnspentWorkdays = actorSlots.filter((slot) => slot.status !== "processed").length;
    const missingWorkdays = Math.max(0, unspentWorkdays - existingUnspentWorkdays);
    const generatedSlots = buildGrantSlots({
      actorId,
      grantId,
      weeks: Math.ceil(missingWorkdays / WORKDAYS_PER_WEEK),
      fromIsoDate: currentIsoDate,
      occupiedDates
    }).slice(0, missingWorkdays);
    state.scheduleSlots.push(...generatedSlots);

    if (!state.grants.some((grant) => grant.id === grantId)) {
      const firstActualSlotDate = generatedSlots[0]?.isoDate
        ?? actorSlots.map((slot) => slot.isoDate).sort()[0]
        ?? nearestMonday(currentIsoDate);
      state.grants.push({
        id: grantId,
        actorId,
        workdays: balance.totalGrantedWorkdays,
        anchorMonday: firstActualSlotDate,
        createdAt: 0,
        reason: "Migrated from downtime state v1"
      });
    }

    let reservedSlots = state.scheduleSlots.filter((slot) => (
      slot.actorId === actorId && slot.requestId && slot.status !== "processed"
    )).length;

    for (const request of state.requests.filter((entry) => (
      entry.actorId === actorId && OPEN_RESERVED_STATUSES.has(entry.status)
    ))) {
      const processedSlots = state.scheduleSlots.filter((slot) => (
        slot.requestId === request.id && slot.status === "processed"
      )).length;
      const existingReservedSlots = state.scheduleSlots.filter((slot) => (
        slot.requestId === request.id && slot.status !== "processed"
      )).length;
      const requestWorkdays = Math.max(1, toWeeks(request.workdays, request.weeks * WORKDAYS_PER_WEEK));
      const missingRequestSlots = Math.max(0, requestWorkdays - processedSlots - existingReservedSlots);
      const allocationCount = Math.min(
        missingRequestSlots,
        Math.max(0, balance.reservedWorkdays - reservedSlots)
      );
      if (allocationCount > 0) {
        state.scheduleSlots = allocateRequestSlots({
          slots: state.scheduleSlots,
          actorId,
          requestId: request.id,
          workdays: allocationCount,
          ownedWorkshop: request.ownedWorkshop === true
        });
        reservedSlots += allocationCount;
      }
      state.scheduleSlots = state.scheduleSlots.map((slot) => (
        slot.requestId === request.id && slot.status !== "processed"
          ? { ...slot, status: request.status }
          : slot
      ));
    }
  }
}

function normalizeDowntimeStateV2(value = {}, currentIsoDate) {
  const source = getDowntimeStateSource(value);
  const sourceBalances = asObject(source.balancesByActorId);
  const balancesByActorId = {};
  const legacyActorIds = new Set();
  for (const [rawActorId, rawBalance] of Object.entries(sourceBalances)) {
    const actorId = cleanId(rawActorId);
    if (actorId) {
      const balance = asObject(rawBalance);
      const hasWorkdayBalance = [
        "availableWorkdays",
        "reservedWorkdays",
        "spentWorkdays",
        "totalGrantedWorkdays"
      ].some((field) => Object.hasOwn(balance, field));
      const hasLegacyWeekBalance = [
        "availableWeeks",
        "reservedWeeks",
        "spentWeeks",
        "totalGrantedWeeks"
      ].some((field) => Object.hasOwn(balance, field));
      const legacyWeeks = !hasWorkdayBalance
        && (hasLegacyWeekBalance || Number(source.version) < DOWNTIME_STATE_VERSION);
      balancesByActorId[actorId] = normalizeWorkdayBalance(balance, { legacyWeeks });
      if (legacyWeeks) {
        legacyActorIds.add(actorId);
      }
    }
  }

  const requests = asArray(source.requests).map((request) => normalizeRequest(request)).filter((request) => request.id);
  const counter = Math.max(toWeeks(source.counter), getMaxRequestCounter(requests));
  const history = clone(asArray(source.history));
  if (legacyActorIds.size && !history.some((entry) => entry?.migrationId === DOWNTIME_V2_MIGRATION_ID)) {
    history.push({
      id: "downtime-history-migration-v2",
      type: "migration",
      migrationId: DOWNTIME_V2_MIGRATION_ID,
      fromVersion: Number(source.version) || 1,
      toVersion: DOWNTIME_STATE_VERSION,
      createdAt: Date.now()
    });
  }

  const state = {
    ...clone(source),
    version: DOWNTIME_STATE_VERSION,
    balancesByActorId,
    grants: asArray(source.grants).map((grant) => normalizeGrant(grant)).filter((grant) => grant.id),
    requests,
    checks: asArray(source.checks).map((check) => normalizeCheck(check)),
    scheduleSlots: asArray(source.scheduleSlots)
      .map((slot) => normalizeScheduleSlot(slot))
      .filter((slot) => slot.id && slot.actorId && slot.isoDate),
    transitionJournal: asArray(source.transitionJournal)
      .map((entry) => normalizeTransitionJournalEntry(entry))
      .filter((entry) => entry.transitionId && entry.isoDate),
    workLog: asArray(source.workLog).map((entry) => normalizeWorkLogEntry(entry)).filter((entry) => entry.id),
    history,
    counter
  };

  if (legacyActorIds.size) {
    migrateLegacySchedule(state, currentIsoDate, legacyActorIds);
  }
  return state;
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
    const state = normalizeDowntimeStateV2(
      context.groupState?.downtimeState,
      this.#resolveCurrentIsoDate()
    );
    const selectedActorId = cleanId(actorId);
    const memberActorIds = new Set(context.memberActorIds ?? []);
    const currentMembers = asArray(context.members).filter((actor) => memberActorIds.has(actor?.id));

    const members = currentMembers.map((actor) => ({
      actorId: actor.id,
      actorName: actor.name ?? actor.id,
      actorImg: actor.img ?? "",
      selected: selectedActorId ? actor.id === selectedActorId : false,
      canSubmit: this.#canSubmitForActor(actor, context),
      balance: buildBalanceView(state.balancesByActorId[actor.id] ?? buildDefaultBalance())
    }));

    if (members.length && selectedActorId && !members.some((member) => member.selected)) {
      members[0].selected = true;
    }

    const selectedMember = members.find((member) => member.selected) ?? members[0] ?? null;
    const calendarByIsoDate = Object.fromEntries(summarizeScheduleByDate(state.scheduleSlots));
    return {
      version: state.version,
      groupId: context.groupId,
      canManage: this.#canManage(context),
      canSubmit: members.some((member) => member.canSubmit),
      members,
      balance: selectedMember?.balance ?? buildBalanceView(),
      balancesByActorId: Object.fromEntries(Object.entries(state.balancesByActorId)
        .map(([balanceActorId, balance]) => [balanceActorId, buildBalanceView(balance)])),
      grants: clone(state.grants),
      requests: state.requests.map((request) => clone(request)),
      scheduleSlots: clone(state.scheduleSlots),
      calendarByIsoDate: clone(calendarByIsoDate),
      transitionJournal: clone(state.transitionJournal),
      workLog: clone(state.workLog),
      checks: clone(state.checks),
      history: clone(state.history),
      actionCatalog: this.#getActionCatalog(context),
      counter: state.counter
    };
  }

  async grantWeeks({ actorIds = [], weeks = 0, reason = "", fromIsoDate = "" } = {}) {
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

    const grantFromIsoDate = this.#resolveCurrentIsoDate(fromIsoDate);
    return this.#writeGroupState(context, (state) => {
      for (const actorId of targetActorIds) {
        const grantId = `downtime-grant-${Date.now()}-${actorId}-${state.grants.length + 1}`;
        const workdays = safeWeeks * WORKDAYS_PER_WEEK;
        const occupiedDates = new Set(state.scheduleSlots
          .filter((slot) => slot.actorId === actorId)
          .map((slot) => slot.isoDate));
        const grantSlots = buildGrantSlots({
          actorId,
          grantId,
          weeks: safeWeeks,
          fromIsoDate: grantFromIsoDate,
          occupiedDates
        });
        const balance = normalizeWorkdayBalance(state.balancesByActorId[actorId] ?? buildDefaultBalance());
        balance.availableWorkdays += workdays;
        balance.totalGrantedWorkdays += workdays;
        state.balancesByActorId[actorId] = balance;
        state.grants.push({
          id: grantId,
          actorId,
          workdays,
          anchorMonday: grantSlots[0]?.isoDate ?? nearestMonday(grantFromIsoDate),
          createdAt: Date.now(),
          reason: cleanString(reason)
        });
        state.scheduleSlots.push(...grantSlots);
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
        workdays: safeWeeks * WORKDAYS_PER_WEEK,
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
      const requestedWorkdays = safeWeeks * WORKDAYS_PER_WEEK;

      for (const actorId of targetActorIds) {
        const balance = normalizeWorkdayBalance(state.balancesByActorId[actorId] ?? buildDefaultBalance());
        if (hasExplicitTargets && balance.availableWorkdays < requestedWorkdays) {
          throw new Error("Not enough available downtime weeks.");
        }

        const revokedWorkdays = hasExplicitTargets
          ? requestedWorkdays
          : Math.min(balance.availableWorkdays, requestedWorkdays);
        if (revokedWorkdays <= 0) {
          skippedActorIds.push(actorId);
          continue;
        }

        revocations.push({
          actorId,
          weeks: revokedWorkdays / WORKDAYS_PER_WEEK,
          workdays: revokedWorkdays
        });
      }

      for (const revocation of revocations) {
        const freeSlots = state.scheduleSlots
          .filter((slot) => slot.actorId === revocation.actorId && slot.status === "free")
          .sort((left, right) => right.isoDate.localeCompare(left.isoDate));
        if (freeSlots.length < revocation.workdays) {
          throw new Error("Available downtime workdays have no matching free schedule slots.");
        }
        const removedSlotIds = new Set(freeSlots.slice(0, revocation.workdays).map((slot) => slot.id));
        state.scheduleSlots = state.scheduleSlots.filter((slot) => !removedSlotIds.has(slot.id));

        const balance = normalizeWorkdayBalance(state.balancesByActorId[revocation.actorId] ?? buildDefaultBalance());
        balance.availableWorkdays -= revocation.workdays;
        balance.totalGrantedWorkdays = Math.max(
          balance.availableWorkdays + balance.reservedWorkdays + balance.spentWorkdays,
          balance.totalGrantedWorkdays - revocation.workdays
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
          workdays: requestedWorkdays,
          totalRevokedWeeks,
          totalRevokedWorkdays: revocations.reduce((total, revocation) => total + revocation.workdays, 0),
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

        this.#assertRequestAccountingAvailable(state, request.id);
        const balance = normalizeWorkdayBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
        const released = state.scheduleSlots.filter((slot) => (
          slot.requestId === request.id && slot.status !== "processed"
        )).length;
        if (balance.reservedWorkdays < released) {
          throw new Error("Reserved downtime workdays are lower than the request cost.");
        }
        balance.reservedWorkdays -= released;
        balance.availableWorkdays += released;
        releasedWeeks += released / WORKDAYS_PER_WEEK;
        state.balancesByActorId[request.actorId] = balance;
      }

      state.scheduleSlots = state.scheduleSlots.map((slot) => (
        slot.status !== "processed" && slot.requestId
          ? { ...slot, status: "free", requestId: null, projectId: null, activityId: null, hours: null, blockReason: null, processedTransitionId: null }
          : slot
      ));

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
    const workdays = safeWeeks * WORKDAYS_PER_WEEK;
    const action = await this.#resolveAction(context, actionId);
    const resolvedActionId = action.id;
    const safeTitle = cleanString(title) || action.label;
    const userId = cleanId(submittedByUserId) || cleanId(getCurrentUser()?.id);
    const actionSelections = normalizeTargetActionSelections(targetActionSelections);

    return this.#writeGroupState(context, (state) => {
      const balance = normalizeWorkdayBalance(state.balancesByActorId[actor.id] ?? buildDefaultBalance());
      if (balance.availableWorkdays < workdays) {
        throw new Error("Not enough available downtime weeks.");
      }

      state.counter += 1;
      const audit = buildAuditFields();
      const checks = buildSelectedRequestChecks(action, actionSelections);

      const request = {
        id: `downtime-${state.counter}`,
        actorId: actor.id,
        actorName: actor.name ?? actor.id,
        actionId: resolvedActionId,
        actionLabel: action.label,
        title: safeTitle,
        description: cleanString(description),
        weeks: safeWeeks,
        workdays,
        status: "pending",
        checks,
        result: "",
        ...audit,
        submittedByUserId: userId,
        reviewedByUserId: ""
      };
      applyRequestTemplateMetadata(request, action, resolvedActionId);
      refreshMappedDowntimeResults(request);
      state.scheduleSlots = allocateRequestSlots({
        slots: state.scheduleSlots,
        actorId: actor.id,
        requestId: request.id,
        workdays,
        ownedWorkshop: request.ownedWorkshop === true
      });
      balance.availableWorkdays -= workdays;
      balance.reservedWorkdays += workdays;
      state.balancesByActorId[actor.id] = balance;
      state.requests.push(request);
      return clone(request);
    });
  }

  async updateRequest({
    groupId = "",
    requestId = "",
    actorId = "",
    actionId = "",
    title = "",
    description = "",
    weeks = 1,
    targetActionSelections = []
  } = {}) {
    const context = cleanId(groupId)
      ? this.moduleApi?.groupContextService?.resolveForGroup?.(cleanId(groupId))
      : this.#resolveContext();
    const actor = this.#requireCurrentMemberActor(context, actorId);
    this.#assertCanSubmitForActor(actor, context);
    const safeRequestId = cleanId(requestId);
    const safeWeeks = this.#requirePositiveWeeks(weeks);
    const workdays = safeWeeks * WORKDAYS_PER_WEEK;
    const action = await this.#resolveAction(context, actionId);
    const resolvedActionId = action.id;
    const safeTitle = cleanString(title) || action.label;
    const actionSelections = normalizeTargetActionSelections(targetActionSelections);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      this.#assertRequestAccountingAvailable(state, request.id);
      if (request.actorId !== actor.id) {
        throw new Error("Downtime request does not belong to this character.");
      }
      if (request.status !== "pending") {
        throw new Error("Only pending downtime requests can be edited.");
      }
      if (hasAnyRecordedResult(request)) {
        throw new Error("Downtime request already has recorded results.");
      }

      const previousWorkdays = Math.max(1, toWeeks(request.workdays, request.weeks * WORKDAYS_PER_WEEK));
      const balance = normalizeWorkdayBalance(state.balancesByActorId[actor.id] ?? buildDefaultBalance());
      if (balance.reservedWorkdays < previousWorkdays) {
        throw new Error("Reserved downtime weeks are lower than the request cost.");
      }
      const workdayDelta = workdays - previousWorkdays;
      if (workdayDelta > 0 && balance.availableWorkdays < workdayDelta) {
        throw new Error("Not enough available downtime weeks.");
      }

      const currentIsoDate = this.#resolveCurrentIsoDate();
      state.scheduleSlots = releaseFutureRequestSlots({
        slots: state.scheduleSlots,
        requestId: request.id,
        currentIsoDate
      });
      const retainedWorkdays = state.scheduleSlots.filter((slot) => (
        slot.requestId === request.id && slot.status !== "processed"
      )).length;
      state.scheduleSlots = allocateRequestSlots({
        slots: state.scheduleSlots,
        actorId: actor.id,
        requestId: request.id,
        workdays: Math.max(0, workdays - retainedWorkdays),
        ownedWorkshop: request.ownedWorkshop === true
      });
      balance.availableWorkdays -= workdayDelta;
      balance.reservedWorkdays += workdayDelta;
      state.balancesByActorId[actor.id] = balance;

      request.actionId = resolvedActionId;
      request.actionLabel = action.label;
      request.title = safeTitle;
      request.description = cleanString(description);
      request.weeks = safeWeeks;
      request.workdays = workdays;
      request.checks = buildSelectedRequestChecks(action, actionSelections);
      request.result = "";
      request.reviewedByUserId = "";
      request.updatedAt = Date.now();
      applyRequestTemplateMetadata(request, action, resolvedActionId);
      refreshMappedDowntimeResults(request);
      return clone(request);
    });
  }

  async closeProject(requestId, { groupId = "", actorId = "" } = {}) {
    const context = cleanId(groupId)
      ? this.moduleApi?.groupContextService?.resolveForGroup?.(cleanId(groupId))
      : this.#resolveContext();
    const safeRequestId = cleanId(requestId);
    const safeActorId = cleanId(actorId);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      if (safeActorId && request.actorId !== safeActorId) {
        throw new Error("Downtime request does not belong to this character.");
      }
      if (!this.#canManage(context)) {
        const actor = this.#requireCurrentMemberActor(context, request.actorId);
        if (!this.#canSubmitForActor(actor, context)) {
          throw new Error("Players can close projects only for an owned character.");
        }
      }
      if (!asArray(request.checks).some((check) => cleanId(check?.actionType) === "projectCounter")) {
        throw new Error("Downtime project counter not found.");
      }

      request.projectClosed = true;
      request.projectClosedAt = Date.now();
      request.projectClosedByUserId = cleanId(getCurrentUser()?.id);
      request.updatedAt = Date.now();
      return clone(request);
    });
  }

  async continueProject(requestId, { groupId = "", actorId = "", checkId = "", result = {} } = {}) {
    const context = cleanId(groupId)
      ? this.moduleApi?.groupContextService?.resolveForGroup?.(cleanId(groupId))
      : this.#resolveContext();
    const safeRequestId = cleanId(requestId);
    const safeActorId = cleanId(actorId);
    const safeCheckId = cleanId(checkId);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      if (safeActorId && request.actorId !== safeActorId) {
        throw new Error("Downtime request does not belong to this character.");
      }
      if (!this.#canManage(context)) {
        const actor = this.#requireCurrentMemberActor(context, request.actorId);
        if (!this.#canSubmitForActor(actor, context)) {
          throw new Error("Players can continue projects only for an owned character.");
        }
      }
      if (request.projectClosed === true) {
        throw new Error("Downtime project is closed.");
      }
      if (request.status !== "completed") {
        throw new Error("Only completed project weeks can be continued.");
      }

      const projectCounter = getProjectCounterState(request.checks);
      if (!projectCounter) {
        throw new Error("Downtime project counter not found.");
      }
      if (projectCounter.current >= projectCounter.max) {
        throw new Error("Downtime project counter is already complete.");
      }
      if (!safeCheckId) {
        throw new Error("Downtime project check not found.");
      }

      const balance = normalizeWorkdayBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
      if (balance.availableWorkdays < WORKDAYS_PER_WEEK) {
        throw new Error("Not enough available downtime weeks.");
      }

      const freeSlots = state.scheduleSlots
        .filter((slot) => slot.actorId === request.actorId && slot.status === "free")
        .sort((left, right) => left.isoDate.localeCompare(right.isoDate));
      if (freeSlots.length < WORKDAYS_PER_WEEK) {
        throw new Error("Available downtime workdays have no matching free schedule slots.");
      }
      const spentSlotIds = new Set(freeSlots.slice(0, WORKDAYS_PER_WEEK).map((slot) => slot.id));
      state.scheduleSlots = state.scheduleSlots.map((slot) => (
        spentSlotIds.has(slot.id)
          ? {
            ...slot,
            status: "processed",
            requestId: request.id,
            processedTransitionId: `legacy-continue-${request.id}-${Date.now()}`
          }
          : slot
      ));
      balance.availableWorkdays -= WORKDAYS_PER_WEEK;
      balance.spentWorkdays += WORKDAYS_PER_WEEK;
      state.balancesByActorId[request.actorId] = balance;

      projectCounter.check.projectCounter = {
        ...clone(projectCounter.counter),
        current: projectCounter.current,
        max: projectCounter.max
      };
      clearWeeklyProjectResults(request);
      applyCheckResultToRequest(request, safeCheckId, result);
      request.status = "completed";
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
      const currentStatus = request.status;
      if (currentStatus !== effectiveStatus) {
        this.#assertRequestAccountingAvailable(state, request.id);
      }
      const balance = normalizeWorkdayBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
      const requestWorkdays = Math.max(1, toWeeks(request.workdays, request.weeks * WORKDAYS_PER_WEEK));
      const requestSlots = state.scheduleSlots.filter((slot) => slot.requestId === request.id);
      const processedWorkdays = requestSlots.filter((slot) => slot.status === "processed").length;
      const reservedWorkdays = requestSlots.filter((slot) => slot.status !== "processed").length;
      const expectedReservedWorkdays = processedWorkdays > 0 ? reservedWorkdays : requestWorkdays;

      if (OPEN_RESERVED_STATUSES.has(currentStatus) && RELEASED_STATUSES.has(effectiveStatus)) {
        if (balance.reservedWorkdays < expectedReservedWorkdays) {
          throw new Error("Reserved downtime weeks are lower than the request cost.");
        }
        const beforeRelease = reservedWorkdays;
        state.scheduleSlots = releaseFutureRequestSlots({
          slots: state.scheduleSlots,
          requestId: request.id,
          currentIsoDate: this.#resolveCurrentIsoDate()
        });
        const retained = state.scheduleSlots.filter((slot) => (
          slot.requestId === request.id && slot.status !== "processed"
        )).length;
        this.#applyStatusAccounting(balance, currentStatus, effectiveStatus, beforeRelease - retained);
      }
      else if (OPEN_RESERVED_STATUSES.has(currentStatus) && effectiveStatus === "completed") {
        if (balance.reservedWorkdays < expectedReservedWorkdays) {
          throw new Error("Reserved downtime weeks are lower than the request cost.");
        }
        this.#applyStatusAccounting(balance, currentStatus, effectiveStatus, reservedWorkdays);
        const transitionId = `legacy-status-${request.id}-${Date.now()}`;
        state.scheduleSlots = state.scheduleSlots.map((slot) => (
          slot.requestId === request.id && slot.status !== "processed"
            ? { ...slot, status: "processed", blockReason: null, processedTransitionId: transitionId }
            : slot
        ));
      }
      else if (RELEASED_STATUSES.has(currentStatus) && OPEN_RESERVED_STATUSES.has(effectiveStatus)) {
        const retainedUnprocessedSlots = requestSlots.filter((slot) => slot.status !== "processed").length;
        const workdaysToReserve = Math.max(
          0,
          requestWorkdays - processedWorkdays - retainedUnprocessedSlots
        );
        this.#applyStatusAccounting(balance, currentStatus, effectiveStatus, workdaysToReserve);
        state.scheduleSlots = allocateRequestSlots({
          slots: state.scheduleSlots,
          actorId: request.actorId,
          requestId: request.id,
          workdays: workdaysToReserve,
          ownedWorkshop: request.ownedWorkshop === true
        });
      }
      else {
        this.#applyStatusAccounting(balance, currentStatus, effectiveStatus, requestWorkdays);
      }

      if (OPEN_RESERVED_STATUSES.has(effectiveStatus)) {
        state.scheduleSlots = state.scheduleSlots.map((slot) => (
          slot.requestId === request.id && slot.status !== "processed"
            ? { ...slot, status: effectiveStatus, blockReason: null, processedTransitionId: null }
            : slot
        ));
      }
      request.status = effectiveStatus;
      request.result = cleanString(result);
      request.reviewedByUserId = cleanId(getCurrentUser()?.id);
      request.updatedAt = Date.now();
      state.balancesByActorId[request.actorId] = balance;
      return clone(request);
    });
  }

  async processScheduledDate(isoDate, { transitionId, activityProcessor } = {}) {
    const context = this.#resolveContext();
    this.#assertCanManage(context);
    const safeIsoDate = cleanString(isoDate);
    nearestMonday(safeIsoDate);
    const safeTransitionId = cleanId(transitionId);
    if (!safeTransitionId) {
      throw new Error("Downtime processing requires a transition ID.");
    }
    const processor = typeof activityProcessor === "function"
      ? activityProcessor
      : async () => ({ result: null });

    const preparation = await this.#writeGroupState(context, (state) => {
      let journal = findTransitionJournalEntry(state, safeIsoDate, safeTransitionId);
      const now = Date.now();
      if (!journal) {
        const slots = state.scheduleSlots
          .filter((slot) => (
            slot.isoDate === safeIsoDate
            && PROCESSABLE_SLOT_STATUSES.has(slot.status)
            && !findNonterminalSlotClaim(state, slot.id)
          ))
          .sort((left, right) => left.actorId.localeCompare(right.actorId) || left.id.localeCompare(right.id))
        const slotIds = slots.map((slot) => slot.id);
        journal = {
          transitionId: safeTransitionId,
          isoDate: safeIsoDate,
          slotIds,
          status: "processing",
          resultsBySlotId: {},
          createdAt: now,
          updatedAt: now
        };
        state.transitionJournal.push(journal);
        for (const slot of slots) {
          slot.processingTransitionId = safeTransitionId;
        }
      }

      if (journal.status !== "completed") {
        journal.status = "processing";
        journal.updatedAt = now;
      }
      for (const slotId of journal.slotIds) {
        if (!isTerminalTransitionResult(journal.resultsBySlotId[slotId])) {
          const slot = state.scheduleSlots.find((entry) => entry.id === slotId);
          const previousResult = asObject(journal.resultsBySlotId[slotId]);
          const competingClaim = findNonterminalSlotClaim(state, slotId, {
            excludeTransitionId: safeTransitionId
          });
          const previousRequestId = cleanId(previousResult.claimedRequestId);
          const previousActorId = cleanId(previousResult.claimedActorId);
          const previousStatus = cleanId(previousResult.claimedStatus);
          const claimMismatch = !slot
            || Boolean(competingClaim)
            || !PROCESSABLE_SLOT_STATUSES.has(slot.status)
            || (slot.processingTransitionId && slot.processingTransitionId !== safeTransitionId)
            || (previousRequestId && slot.requestId !== previousRequestId)
            || (previousActorId && slot.actorId !== previousActorId)
            || (previousStatus && slot.status !== previousStatus);
          if (claimMismatch) {
            journal.resultsBySlotId[slotId] = {
              ...clone(previousResult),
              status: "reconciliation-required",
              operationId: buildDowntimeOperationId(safeTransitionId, slotId),
              reason: "Downtime slot claim changed before processing could resume.",
              updatedAt: now
            };
            journal.status = "reconciliation-required";
            continue;
          }

          slot.processingTransitionId = safeTransitionId;
          journal.resultsBySlotId[slotId] = {
            ...clone(previousResult),
            ...buildSlotClaimMetadata(slot),
            status: "processing",
            operationId: buildDowntimeOperationId(safeTransitionId, slotId),
            updatedAt: now
          };
        }
      }

      return {
        slotIds: clone(journal.slotIds),
        slotsById: Object.fromEntries(state.scheduleSlots
          .filter((slot) => journal.slotIds.includes(slot.id))
          .map((slot) => [slot.id, clone(slot)])),
        resultsBySlotId: clone(journal.resultsBySlotId)
      };
    });

    const processed = [];
    const blocked = [];
    const reconciliation = [];
    const skipped = [];

    for (const slotId of preparation.slotIds) {
      const slotSnapshot = preparation.slotsById[slotId] ?? { id: slotId };
      if (isTerminalTransitionResult(preparation.resultsBySlotId[slotId])) {
        skipped.push(clone(slotSnapshot));
        continue;
      }

      const operationId = buildDowntimeOperationId(safeTransitionId, slotId);
      if (cleanId(preparation.resultsBySlotId[slotId]?.status) !== "processing") {
        reconciliation.push({ slot: clone(slotSnapshot), operationId });
        continue;
      }
      let classification = "reconciliation-required";
      let outcome = null;
      let reconciliationReason = "Downtime processor returned an ambiguous result.";
      try {
        const rawOutcome = await processor(clone(slotSnapshot), {
          isoDate: safeIsoDate,
          transitionId: safeTransitionId,
          operationId
        });
        if (rawOutcome && typeof rawOutcome === "object" && !Array.isArray(rawOutcome)) {
          outcome = clone(rawOutcome);
          const explicitBlocked = outcome.blocked === true || cleanId(outcome.status) === "blocked";
          if (explicitBlocked && !hasResourceMutationEvidence(outcome)) {
            classification = "blocked";
          }
          else if (explicitBlocked) {
            reconciliationReason = "Blocked downtime result included resource mutation evidence.";
          }
          else if (cleanId(outcome.status) === "processed" || Object.hasOwn(outcome, "result")) {
            classification = "processed";
          }
        }
      }
      catch (error) {
        reconciliationReason = cleanString(error?.message) || "Downtime activity processor failed.";
      }

      const finalized = await this.#writeGroupState(context, (state) => {
        const journal = findTransitionJournalEntry(state, safeIsoDate, safeTransitionId);
        if (!journal || !journal.slotIds.includes(slotId)) {
          throw new Error("Downtime transition journal is unavailable for finalization.");
        }
        if (isTerminalTransitionResult(journal.resultsBySlotId[slotId])) {
          return { kind: "skipped", slot: clone(state.scheduleSlots.find((slot) => slot.id === slotId) ?? slotSnapshot) };
        }

        const now = Date.now();
        const slot = state.scheduleSlots.find((entry) => entry.id === slotId);
        const claimResult = asObject(journal.resultsBySlotId[slotId]);
        const claimedActorId = cleanId(claimResult.claimedActorId);
        const claimedRequestId = cleanId(claimResult.claimedRequestId);
        const claimedStatus = cleanId(claimResult.claimedStatus);
        const claimedRequest = state.requests.find((entry) => entry.id === claimedRequestId);
        if (classification !== "reconciliation-required") {
          if (!slot) {
            classification = "reconciliation-required";
            reconciliationReason = "Snapshotted downtime slot is missing.";
          }
          else if (slot.processingTransitionId !== safeTransitionId) {
            classification = "reconciliation-required";
            reconciliationReason = "Downtime slot is no longer claimed by this transition.";
          }
          else if (!PROCESSABLE_SLOT_STATUSES.has(claimedStatus) || slot.status !== claimedStatus) {
            classification = "reconciliation-required";
            reconciliationReason = "Downtime slot status changed after the transition claim.";
          }
          else if (
            !claimedRequestId
            || slot.requestId !== claimedRequestId
            || !claimedRequest
            || !OPEN_RESERVED_STATUSES.has(claimedRequest.status)
          ) {
            classification = "reconciliation-required";
            reconciliationReason = "Downtime slot request changed after the transition claim.";
          }
          else if (!claimedActorId || slot.actorId !== claimedActorId || claimedRequest.actorId !== claimedActorId) {
            classification = "reconciliation-required";
            reconciliationReason = "Downtime slot actor changed after the transition claim.";
          }
        }

        if (classification === "reconciliation-required") {
          journal.resultsBySlotId[slotId] = {
            ...clone(claimResult),
            status: "reconciliation-required",
            operationId,
            reason: reconciliationReason,
            ...(outcome == null ? {} : { activityResult: clone(outcome) }),
            updatedAt: now
          };
          journal.status = "reconciliation-required";
          journal.updatedAt = now;
          return { kind: "reconciliation-required", slot: clone(slot ?? slotSnapshot), operationId };
        }

        const logEntry = {
          id: `downtime-work-${slot.id}-${safeTransitionId}`,
          slotId: slot.id,
          actorId: slot.actorId,
          isoDate: safeIsoDate,
          requestId: slot.requestId,
          projectId: cleanId(outcome?.projectId) || slot.projectId || null,
          result: null,
          transitionId: safeTransitionId,
          operationId,
          createdAt: now
        };

        if (classification === "blocked") {
          slot.status = "blocked";
          slot.blockReason = cleanString(outcome?.blockReason) || "Downtime activity blocked.";
          slot.processedTransitionId = safeTransitionId;
          slot.processingTransitionId = null;
          logEntry.result = {
            status: "blocked",
            blockReason: slot.blockReason,
            ...(outcome?.result === undefined ? {} : { activityResult: clone(outcome.result) })
          };
          if (!state.workLog.some((entry) => entry.id === logEntry.id)) {
            state.workLog.push(logEntry);
          }
          journal.resultsBySlotId[slotId] = {
            ...clone(claimResult),
            status: "blocked",
            operationId,
            blockReason: slot.blockReason,
            updatedAt: now
          };
          journal.updatedAt = now;
          return { kind: "blocked", slot: clone(slot) };
        }

        const balance = normalizeWorkdayBalance(state.balancesByActorId[slot.actorId] ?? buildDefaultBalance());
        if (balance.reservedWorkdays < 1) {
          journal.resultsBySlotId[slotId] = {
            ...clone(claimResult),
            status: "reconciliation-required",
            operationId,
            reason: "Reserved downtime workdays are lower than the scheduled cost.",
            activityResult: clone(outcome),
            updatedAt: now
          };
          journal.status = "reconciliation-required";
          journal.updatedAt = now;
          return { kind: "reconciliation-required", slot: clone(slot), operationId };
        }

        balance.reservedWorkdays -= 1;
        balance.spentWorkdays += 1;
        state.balancesByActorId[slot.actorId] = balance;
        slot.status = "processed";
        slot.projectId = cleanId(outcome?.projectId) || slot.projectId || null;
        slot.activityId = cleanId(outcome?.activityId) || slot.activityId || null;
        slot.hours = toFiniteNumber(outcome?.hours, slot.hours);
        slot.blockReason = null;
        slot.processedTransitionId = safeTransitionId;
        slot.processingTransitionId = null;
        logEntry.projectId = slot.projectId;
        logEntry.result = {
          status: "processed",
          activityResult: outcome?.result === undefined ? null : clone(outcome.result)
        };
        if (!state.workLog.some((entry) => entry.id === logEntry.id)) {
          state.workLog.push(logEntry);
        }
        journal.resultsBySlotId[slotId] = {
          ...clone(claimResult),
          status: "processed",
          operationId,
          updatedAt: now
        };
        journal.updatedAt = now;

        const request = claimedRequest;
        if (request && !state.scheduleSlots.some((entry) => (
          entry.requestId === request.id && entry.status !== "processed"
        ))) {
          request.status = "completed";
          request.updatedAt = now;
        }
        return { kind: "processed", slot: clone(slot) };
      });

      if (finalized.kind === "processed") {
        processed.push(finalized.slot);
      }
      else if (finalized.kind === "blocked") {
        blocked.push(finalized.slot);
      }
      else if (finalized.kind === "reconciliation-required") {
        reconciliation.push(finalized);
      }
      else {
        skipped.push(finalized.slot);
      }
    }

    const journalStatus = await this.#writeGroupState(context, (state) => {
      const journal = findTransitionJournalEntry(state, safeIsoDate, safeTransitionId);
      if (!journal) {
        throw new Error("Downtime transition journal is unavailable for completion.");
      }
      const completed = journal.slotIds.every((slotId) => isTerminalTransitionResult(journal.resultsBySlotId[slotId]));
      journal.status = completed ? "completed" : "reconciliation-required";
      journal.updatedAt = Date.now();
      return journal.status;
    });

    return {
      isoDate: safeIsoDate,
      transitionId: safeTransitionId,
      journalStatus,
      processed,
      blocked,
      reconciliation,
      skipped
    };
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

      applyCheckResultToRequest(request, safeCheckId, result);
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

  #resolveCurrentIsoDate(explicitIsoDate = "") {
    const isoDate = cleanString(explicitIsoDate)
      || cleanString(this.moduleApi?.getCalendarSnapshot?.()?.isoDate)
      || cleanString(this.#resolveContext()?.groupState?.calendar?.isoDate)
      || new Date().toISOString().slice(0, 10);
    nearestMonday(isoDate);
    return isoDate;
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
        || action.downtimeId === safeActionId
        || templateActionMatchesLegacyId(action, safeActionId));
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
    const groupContextService = this.moduleApi?.groupContextService;
    const applyMutation = async (groupState) => {
      groupState.groupActorId = context.groupId;
      const state = normalizeDowntimeStateV2(
        groupState.downtimeState,
        this.#resolveCurrentIsoDate()
      );
      const result = await mutator(state);
      groupState.downtimeState = buildPersistedDowntimeStateV2(state);
      return result;
    };

    if (typeof groupContextService?.mutateGroupState !== "function") {
      throw new Error("Downtime writes require groupContextService.mutateGroupState.");
    }
    return groupContextService.mutateGroupState(context.groupId, applyMutation);
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

  #assertRequestAccountingAvailable(state, requestId) {
    const claimed = state.scheduleSlots.some((slot) => (
      slot.requestId === requestId
      && findNonterminalSlotClaim(state, slot.id)
    ));
    if (claimed) {
      throw new Error("Downtime request is busy processing scheduled work; retry after processing or reconciliation completes.");
    }
  }

  #applyStatusAccounting(balance, currentStatus, nextStatus, workdays) {
    if (currentStatus === nextStatus) {
      return;
    }

    const safeWorkdays = toWeeks(workdays);
    if (OPEN_RESERVED_STATUSES.has(currentStatus) && RELEASED_STATUSES.has(nextStatus)) {
      if (balance.reservedWorkdays < safeWorkdays) {
        throw new Error("Reserved downtime weeks are lower than the request cost.");
      }

      balance.reservedWorkdays -= safeWorkdays;
      balance.availableWorkdays += safeWorkdays;
      return;
    }

    if (OPEN_RESERVED_STATUSES.has(currentStatus) && nextStatus === "completed") {
      if (balance.reservedWorkdays < safeWorkdays) {
        throw new Error("Reserved downtime weeks are lower than the request cost.");
      }

      balance.reservedWorkdays -= safeWorkdays;
      balance.spentWorkdays += safeWorkdays;
      return;
    }

    if (RELEASED_STATUSES.has(currentStatus) && OPEN_RESERVED_STATUSES.has(nextStatus)) {
      if (balance.availableWorkdays < safeWorkdays) {
        throw new Error("Not enough available downtime weeks.");
      }

      balance.availableWorkdays -= safeWorkdays;
      balance.reservedWorkdays += safeWorkdays;
      return;
    }

    if (RELEASED_STATUSES.has(currentStatus) && nextStatus === "completed") {
      throw new Error("A downtime request must be reserved before completion.");
    }
  }
}
