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

const CURRENCY_LABELS = Object.freeze({
  gp: "зм",
  sp: "см",
  cp: "мм",
  pp: "пм"
});

function cleanText(value) {
  return String(value ?? "").trim();
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
  if (["resources", "itemChoice", "numericInput", "optionChoice", "formulaRoll"].includes(actionType)) {
    return cleanText(check.label) || "Ресурсы";
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
  const priceGold = toFiniteNumber(item.priceGold);
  if (priceGold !== undefined) {
    selectedItem.priceGold = priceGold;
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

function buildOptionChoices(action = {}, selection = {}) {
  const rawOptions = Array.isArray(action?.options) ? action.options : [];
  const selectedIds = new Set([
    cleanText(selection?.optionId),
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
  const unitCost = toFiniteNumber(rankCost.unitCost, toFiniteNumber(rankCost.stepCost, 0)) ?? 0;
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
  const optionChoices = actionType === "optionChoice" ? buildOptionChoices(action, selection) : [];
  const rankChoices = actionType === "rankChoice" ? buildRankChoices(action, selection) : [];
  const selectedRankChoice = getSelectedRankSummary(rankChoices);
  const selectedItem = actionType === "itemChoice" ? normalizeSelectedItem(selection.item) : null;
  const numericInput = actionType === "numericInput" ? buildNumericInput(action, selection) : null;
  const resourceQuantity = actionType === "resources" ? buildResourceQuantity(action, selection, mappedActionsById) : null;
  const computedCost = actionType === "resources" ? buildComputedResourceCost(action, resourceQuantity, mappedActionsById) : null;
  const selectedOptionSummary = getSelectedOptionSummary(optionChoices);
  const mapped = {
    ...action,
    number: index + 1,
    actionType,
    resourceChoices,
    optionChoices,
    rankChoices,
    options: actionType === "rankChoice" ? rankChoices : optionChoices,
    selectedItem,
    selectedItemName: selectedItem?.name ?? "",
    numericInput,
    resourceQuantity,
    computedCost,
    value: numericInput?.value,
    displayValue: numericInput?.displayValue ?? "",
    selectedResourceChoiceId: selectedResourceChoice?.id ?? "",
    selectedResourceChoiceLabel: selectedResourceChoice?.label ?? "",
    selectedOptionLabel: selectedOptionSummary,
    selectedRank: selectedRankChoice?.rank,
    selectedRankLabel: selectedRankChoice?.label ?? "",
    selectionMode: cleanText(action.selectionMode) || "single",
    summary: buildCheckSummary(action),
    outcomeSummary: actionType === "resources"
      ? (computedCost?.label || selectedResourceChoice?.outcomeSummary || buildResourceSummary(action))
      : (actionType === "rankChoice"
        ? (selectedRankChoice?.label || cleanText(action.label))
        : (actionType === "optionChoice"
        ? (selectedOptionSummary || cleanText(action.label))
        : (actionType === "itemChoice"
          ? (selectedItem?.name || cleanText(action.label))
          : (actionType === "numericInput"
            ? [numericInput?.displayValue, numericInput?.unit].filter(Boolean).join(" ") || cleanText(action.label)
            : buildCheckSummary(action)))))
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
    isFormulaAction: actionType === "formulaRoll"
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
  const interactiveActionTypes = new Set(["resources", "itemChoice", "numericInput", "optionChoice", "rankChoice", "formulaRoll"]);
  const checkActions = targetActions.filter((entry) => !interactiveActionTypes.has(entry.actionType) && entry.actionType !== "downtimeResult");
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

function mapRequest(request = {}, { groupId = "" } = {}) {
  const status = cleanText(request.status) || "pending";
  const meta = STATUS_META[status] ?? {
    label: status || "Заявка",
    type: "info"
  };
  const canRollRequest = status === "pending" || status === "approved";
  const checks = (Array.isArray(request.checks) ? request.checks : []).map((check) => {
    const resultLabel = buildResultLabel(check?.result);
    const rollTargets = buildRollTargets(check, {
      canRollRequest,
      resultLabel
    });
    return {
      ...check,
      summary: buildCheckSummary(check),
      resultLabel,
      hasResult: Boolean(resultLabel),
      rollTargets,
      hasRollTargets: rollTargets.some((target) => target.canRoll || target.hasResult)
    };
  });

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
    checkActions: checks.filter((check) => !["resources", "downtimeResult"].includes(cleanText(check.actionType))),
    hasChecks: checks.length > 0,
    hasResult: Boolean(cleanText(request.result)),
    isArchived: ARCHIVED_REQUEST_STATUSES.has(status)
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
    archiveRequests: [],
    requestPage: paginate([]),
    archivePage: paginate([]),
    hasArchiveRequests: false,
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
      .map((request) => mapRequest(request, { groupId: snapshot.groupId }));
    const activeRequests = requests.filter((request) => !request.isArchived);
    const archivedRequests = requests.filter((request) => request.isArchived);
    const activePage = paginate(activeRequests, formState.requestPage);
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
      archiveRequests: archivePage.items,
      requestPage: activePage,
      archivePage,
      hasArchiveRequests: archivedRequests.length > 0,
      requestCount: activeRequests.length,
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
