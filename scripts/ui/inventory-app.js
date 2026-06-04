import { MODULE_ID } from "../constants.js";
import { REBREYA_TOOLS } from "../constants.js";
import { GROUP_CONTEXT_ERRORS } from "../data/group-context-service.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const KNOWN_GROUP_CONTEXT_ERROR_MESSAGES = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP
]);

const DOWNTIME_STATUS_META = Object.freeze({
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

const MAX_DOWNTIME_TARGET_ACTIONS = 5;
const MAX_DOWNTIME_THRESHOLDS = 5;
const DOWNTIME_TARGET_DIALOG_DIMENSIONS = Object.freeze({
  basis: { width: 620, height: 360 },
  variants: { width: 820, height: 560 },
  outcome: { width: 720, height: 520 },
  effects: { width: 720, height: 560 }
});

const DOWNTIME_ACTION_TYPE_OPTIONS = Object.freeze([
  { value: "check", label: "Проверка", help: "Одна проверка характеристики, навыка, инструмента, действия или атаки." },
  { value: "choice", label: "Выбор проверки", help: "Мастер задаёт допустимые варианты, игрок выбирает один перед броском." },
  { value: "downtimeResult", label: "Итог простоя", help: "Общий итог по всем проверкам заявки: сумма, успехи, пороги и итоговые эффекты." },
  { value: "tool", label: "Инструмент", help: "Запрос владения инструментом из листа персонажа." },
  { value: "sheetAction", label: "Действие листа", help: "Запрос готового действия с листа персонажа." },
  { value: "attack", label: "Атака листа", help: "Запрос атаки из листа персонажа; позже выполняется через dnd5e/Midi workflow." },
  { value: "freeform", label: "Свободный итог", help: "Задача без фиксированного броска; мастер оценивает итог вручную." }
]);

const DOWNTIME_ACTION_TYPE_SELECT_OPTIONS = Object.freeze([
  DOWNTIME_ACTION_TYPE_OPTIONS[0],
  DOWNTIME_ACTION_TYPE_OPTIONS[2],
  DOWNTIME_ACTION_TYPE_OPTIONS[6]
]);

const DOWNTIME_SOURCE_TYPE_OPTIONS = Object.freeze([
  { value: "ability", label: "Характеристика", help: "Чистая проверка характеристики без навыка." },
  { value: "skill", label: "Навык", help: "Навык из листа, включая замену характеристики." },
  { value: "tool", label: "Инструмент", help: "Инструмент или владение с листа персонажа." },
  { value: "save", label: "Спасбросок", help: "Спасбросок выбранной характеристики." },
  { value: "sheetAction", label: "Действие", help: "Действие, уже существующее на листе персонажа." },
  { value: "attack", label: "Атака", help: "Атака оружием, заклинанием или другим атакующим действием листа." }
]);

const DOWNTIME_REBREYA_TOOL_OPTIONS = Object.freeze(REBREYA_TOOLS.map((tool) => ({
  value: tool.id,
  label: tool.label,
  sourceType: "tool",
  help: `Проверка владения инструментом Ребреи: ${tool.label}.`
})));

const DOWNTIME_TARGET_OPTION_GROUPS = Object.freeze([
  {
    label: "Навыки",
    options: [
      { value: "acr", label: "Акробатика", sourceType: "skill", ability: "dex", help: "Ловкость (Акробатика)." },
      { value: "ani", label: "Уход за животными", sourceType: "skill", ability: "wis", help: "Мудрость (Уход за животными)." },
      { value: "arc", label: "Магия", sourceType: "skill", ability: "int", help: "Интеллект (Магия)." },
      { value: "ath", label: "Атлетика", sourceType: "skill", ability: "str", help: "Сила (Атлетика)." },
      { value: "dec", label: "Обман", sourceType: "skill", ability: "cha", help: "Харизма (Обман)." },
      { value: "his", label: "История", sourceType: "skill", ability: "int", help: "Интеллект (История)." },
      { value: "ins", label: "Проницательность", sourceType: "skill", ability: "wis", help: "Мудрость (Проницательность)." },
      { value: "itm", label: "Запугивание", sourceType: "skill", ability: "cha", help: "Харизма (Запугивание); характеристику можно заменить." },
      { value: "inv", label: "Расследование", sourceType: "skill", ability: "int", help: "Интеллект (Расследование)." },
      { value: "med", label: "Медицина", sourceType: "skill", ability: "wis", help: "Мудрость (Медицина)." },
      { value: "nat", label: "Природа", sourceType: "skill", ability: "int", help: "Интеллект (Природа)." },
      { value: "prc", label: "Восприятие", sourceType: "skill", ability: "wis", help: "Мудрость (Восприятие)." },
      { value: "prf", label: "Выступление", sourceType: "skill", ability: "cha", help: "Харизма (Выступление)." },
      { value: "per", label: "Убеждение", sourceType: "skill", ability: "cha", help: "Харизма (Убеждение)." },
      { value: "rel", label: "Религия", sourceType: "skill", ability: "int", help: "Интеллект (Религия)." },
      { value: "slt", label: "Ловкость рук", sourceType: "skill", ability: "dex", help: "Ловкость (Ловкость рук)." },
      { value: "ste", label: "Скрытность", sourceType: "skill", ability: "dex", help: "Ловкость (Скрытность)." },
      { value: "sur", label: "Выживание", sourceType: "skill", ability: "wis", help: "Мудрость (Выживание)." }
    ]
  },
  {
    label: "Характеристики",
    options: [
      { value: "str", label: "Сила", sourceType: "ability", ability: "str", help: "Чистая проверка Силы." },
      { value: "dex", label: "Ловкость", sourceType: "ability", ability: "dex", help: "Чистая проверка Ловкости." },
      { value: "con", label: "Телосложение", sourceType: "ability", ability: "con", help: "Чистая проверка Телосложения." },
      { value: "int", label: "Интеллект", sourceType: "ability", ability: "int", help: "Чистая проверка Интеллекта." },
      { value: "wis", label: "Мудрость", sourceType: "ability", ability: "wis", help: "Чистая проверка Мудрости." },
      { value: "cha", label: "Харизма", sourceType: "ability", ability: "cha", help: "Чистая проверка Харизмы." }
    ]
  },
  {
    label: "Спасброски",
    options: [
      { value: "save-str", label: "Спасбросок Силы", sourceType: "save", ability: "str", help: "Спасбросок Силы." },
      { value: "save-dex", label: "Спасбросок Ловкости", sourceType: "save", ability: "dex", help: "Спасбросок Ловкости." },
      { value: "save-con", label: "Спасбросок Телосложения", sourceType: "save", ability: "con", help: "Спасбросок Телосложения." },
      { value: "save-int", label: "Спасбросок Интеллекта", sourceType: "save", ability: "int", help: "Спасбросок Интеллекта." },
      { value: "save-wis", label: "Спасбросок Мудрости", sourceType: "save", ability: "wis", help: "Спасбросок Мудрости." },
      { value: "save-cha", label: "Спасбросок Харизмы", sourceType: "save", ability: "cha", help: "Спасбросок Харизмы." },
      { value: "death", label: "Спасбросок смерти", sourceType: "save", ability: "death", help: "Спасбросок смерти из чарника." }
    ]
  },
  {
    label: "Инструменты",
    options: DOWNTIME_REBREYA_TOOL_OPTIONS
  },
  {
    label: "Лист персонажа",
    options: [
      { value: "sheet-action", label: "Действие из листа", sourceType: "sheetAction", help: "Готовое действие из чарника; точный список будет расширяться из данных актёра." },
      { value: "sheet-attack", label: "Атака из листа", sourceType: "attack", help: "Атака оружием, заклинанием или другим действием атаки." }
    ]
  }
]);

const DOWNTIME_ABILITY_OPTIONS = Object.freeze([
  { value: "", label: "Из листа", help: "Использовать характеристику, заданную системой или выбранным действием." },
  { value: "str", label: "Сила", help: "СИЛ" },
  { value: "dex", label: "Ловкость", help: "ЛОВ" },
  { value: "con", label: "Телосложение", help: "ТЕЛ; можно сочетать с навыками вроде Запугивания." },
  { value: "int", label: "Интеллект", help: "ИНТ" },
  { value: "wis", label: "Мудрость", help: "МДР" },
  { value: "cha", label: "Харизма", help: "ХАР" }
]);

const DOWNTIME_OUTCOME_MODE_OPTIONS = Object.freeze([
  { value: "dc", label: "DC", help: "Сравнить total с порогом сложности." },
  { value: "sum", label: "Сумма", help: "Сохранить total для накопления суммы." },
  { value: "dc-sum", label: "DC + сумма", help: "Одновременно проверить DC и сохранить total в сумму." },
  { value: "thresholds", label: "Пороги", help: "Сравнить общий итог простоя с несколькими порогами или диапазонами." },
  { value: "freeform", label: "Свободный", help: "Сохранить результат без автоматической оценки успеха." }
]);

const DOWNTIME_RECORD_MODE_OPTIONS = Object.freeze([
  { value: "total-success", label: "Total и успех", help: "Сохранить total и отметку успеха/провала." },
  { value: "total", label: "Только total", help: "Сохранить только число броска." },
  { value: "group-sum", label: "Сумма группы", help: "Добавить результат к общей сумме заявки." },
  { value: "gm", label: "Решение мастера", help: "Оставить итог на ручное решение мастера." }
]);

const DOWNTIME_THRESHOLD_OUTCOME_OPTIONS = Object.freeze([
  { value: "failure", label: "Провал", help: "Итог считается провалом." },
  { value: "partial", label: "Частично", help: "Итог даёт частичный результат." },
  { value: "success", label: "Успех", help: "Итог считается успехом." },
  { value: "great-success", label: "Сильный успех", help: "Итог даёт улучшенный результат." },
  { value: "gm", label: "Решение мастера", help: "Мастер решает последствия вручную." }
]);

const DOWNTIME_EFFECT_TRIGGER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Ничего не запускать автоматически." },
  { value: "success", label: "После успеха", help: "Запустить эффект только после успешной проверки." },
  { value: "failure", label: "После провала", help: "Запустить эффект только после провала." },
  { value: "any", label: "После любого результата", help: "Запустить эффект после любого результата проверки." }
]);

const DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Ничего не запускать при закрытии заявки." },
  { value: "complete", label: "При завершении заявки", help: "Запустить эффект, когда мастер завершит простой." },
  { value: "failure", label: "При провале заявки", help: "Запустить эффект при итоговом провале или отклонении." },
  { value: "manual", label: "При ручном решении", help: "Запустить эффект после явного решения мастера." }
]);

const DOWNTIME_EFFECT_ADAPTER_OPTIONS = Object.freeze([
  { value: "none", label: "Без эффекта", help: "Слот эффекта выключен." },
  { value: "rebreya", label: "Rebreya Main", help: "Изменить состояние Rebreya: прогресс, торговцы, события, награды." },
  { value: "dae", label: "DAE", help: "Выдать или снять Active Effect через DAE." },
  { value: "midi", label: "Midi-QOL", help: "Запустить Midi/dnd5e workflow или макрос." }
]);

const DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS = Object.freeze([
  { value: "none", label: "Без шаблона", help: "Не выполнять шаблон." },
  { value: "project-progress", label: "Записать прогресс", help: "Добавить успех или total к прогрессу проекта." },
  { value: "active-effect", label: "Выдать Active Effect", help: "Создать эффект на персонаже или цели." },
  { value: "workflow", label: "Запустить workflow", help: "Передать событие в Midi/dnd5e workflow." },
  { value: "gm-note", label: "Создать запись мастеру", help: "Оставить структурную запись для мастера." }
]);

const DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS = Object.freeze([
  { value: "none", label: "Без шаблона", help: "Не выполнять шаблон." },
  { value: "reward", label: "Выдать награду", help: "Выдать предмет, ресурс или отметку прогресса." },
  { value: "trader-stock", label: "Добавить товар торговцу", help: "Изменить ассортимент торговца группы." },
  { value: "group-event", label: "Изменить событие группы", help: "Запустить, завершить или отметить активный ивент." },
  { value: "active-effect", label: "Выдать Active Effect", help: "Создать эффект после завершения простоя." }
]);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function getOptionLabel(options, value, fallback = "") {
  const safeValue = cleanText(value);
  if (!safeValue) {
    return fallback;
  }

  return options.find((option) => option.value === safeValue)?.label ?? (fallback || safeValue);
}

function createSelectedOptions(options, selectedValue) {
  const safeSelectedValue = cleanText(selectedValue);
  return options.map((option) => ({
    ...option,
    selected: option.value === safeSelectedValue
  }));
}

function renderSelectOptions(options, selectedValue) {
  return createSelectedOptions(options, selectedValue).map((option) => {
    const selected = option.selected ? " selected" : "";
    const title = option.help ? ` title="${foundry.utils.escapeHTML(option.help)}"` : "";
    return `<option value="${foundry.utils.escapeHTML(option.value)}"${selected}${title}>${foundry.utils.escapeHTML(option.label)}</option>`;
  }).join("");
}

function getTargetOption(value, sourceType = "", actor = null) {
  const safeValue = cleanText(value);
  if (!safeValue) {
    return null;
  }

  const groups = cleanText(sourceType)
    ? getTargetOptionGroupsForSourceType(sourceType, actor)
    : DOWNTIME_TARGET_OPTION_GROUPS;
  for (const group of groups) {
    const option = group.options.find((entry) => entry.value === safeValue);
    if (option) {
      return option;
    }
  }
  return null;
}

function getTargetOptionLabel(value, sourceType = "", actor = null) {
  return getTargetOption(value, sourceType, actor)?.label ?? cleanText(value);
}

function renderGroupedSelectOptions(groups, selectedValue) {
  return groups.map((group) => {
    const label = foundry.utils.escapeHTML(group.label);
    return `<optgroup label="${label}">${renderSelectOptions(group.options, selectedValue)}</optgroup>`;
  }).join("");
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  if (typeof collection === "object") {
    return Object.values(collection);
  }
  return [];
}

function getGameActorById(actorId) {
  const safeActorId = cleanText(actorId);
  if (!safeActorId) {
    return null;
  }
  return globalThis.game?.actors?.get?.(safeActorId)
    ?? collectionValues(globalThis.game?.actors).find((actor) => actor?.id === safeActorId)
    ?? null;
}

function getActivityType(activity) {
  return cleanText(activity?.type)
    || cleanText(activity?._source?.type)
    || cleanText(activity?.constructor?.metadata?.type)
    || cleanText(activity?.system?.type);
}

function getActivityName(activity) {
  return cleanText(activity?.name)
    || cleanText(activity?.label)
    || cleanText(activity?.title)
    || cleanText(activity?.type);
}

function getActivityId(activity) {
  return cleanText(activity?.id)
    || cleanText(activity?._id)
    || cleanText(activity?.key)
    || cleanText(activity?.uuid);
}

function isAttackActivity(activity, item = null) {
  const activityType = getActivityType(activity);
  const actionType = cleanText(activity?.actionType)
    || cleanText(activity?.system?.actionType)
    || cleanText(item?.system?.actionType);
  return activityType === "attack"
    || Boolean(activity?.attack || activity?.system?.attack)
    || ["mwak", "rwak", "msak", "rsak"].includes(actionType);
}

function buildActorActivityOptions(actor, sourceType) {
  const options = [];
  for (const item of collectionValues(actor?.items)) {
    const itemId = cleanText(item?.id);
    const itemName = cleanText(item?.name) || itemId;
    const activities = collectionValues(item?.system?.activities);
    if (!activities.length) {
      const actionType = cleanText(item?.system?.actionType);
      const hasActivation = Boolean(cleanText(item?.system?.activation?.type));
      const attackLike = ["mwak", "rwak", "msak", "rsak"].includes(actionType);
      if ((sourceType === "attack" && attackLike) || (sourceType === "sheetAction" && hasActivation && !attackLike)) {
        options.push({
          value: itemId,
          label: itemName,
          sourceType,
          help: itemName
        });
      }
      continue;
    }

    for (const activity of activities) {
      const activityId = getActivityId(activity);
      const attackLike = isAttackActivity(activity, item);
      if ((sourceType === "attack" && !attackLike) || (sourceType === "sheetAction" && attackLike)) {
        continue;
      }
      const activityName = getActivityName(activity);
      const value = itemId && activityId ? `${itemId}:${activityId}` : (activityId || itemId);
      if (!value) {
        continue;
      }
      options.push({
        value,
        label: activityName && activityName !== itemName ? `${itemName}: ${activityName}` : itemName,
        sourceType,
        help: itemName
      });
    }
  }
  return options;
}

function getTargetOptionGroupsForSourceType(sourceType, actor = null) {
  const safeSourceType = cleanText(sourceType) || "skill";
  if (safeSourceType === "sheetAction" || safeSourceType === "attack") {
    const actorOptions = buildActorActivityOptions(actor, safeSourceType);
    if (actorOptions.length) {
      return [{
        label: safeSourceType === "attack" ? "Атаки листа" : "Действия листа",
        options: actorOptions
      }];
    }
  }

  return DOWNTIME_TARGET_OPTION_GROUPS
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => option.sourceType === safeSourceType)
    }))
    .filter((group) => group.options.length);
}

function getTargetOptionForSourceType(value, sourceType = "", actor = null) {
  const safeValue = cleanText(value);
  if (!safeValue) {
    return null;
  }
  const groups = cleanText(sourceType)
    ? getTargetOptionGroupsForSourceType(sourceType, actor)
    : DOWNTIME_TARGET_OPTION_GROUPS;
  for (const group of groups) {
    const option = group.options.find((entry) => entry.value === safeValue);
    if (option) {
      return option;
    }
  }
  return null;
}

function getDefaultTargetOption(sourceType = "skill", actor = null) {
  return getTargetOptionGroupsForSourceType(sourceType, actor)[0]?.options?.[0] ?? null;
}

function readSelectedOptionLabel(root, fieldName, { sourceType = "", actor = null } = {}) {
  const field = root?.querySelector?.(`[data-field='${fieldName}']`);
  const selectedOption = field?.selectedOptions?.[0];
  return cleanText(selectedOption?.textContent ?? selectedOption?.label)
    || getTargetOptionLabel(field?.value, sourceType, actor)
    || cleanText(field?.value);
}

function readFieldValue(root, fieldName) {
  return cleanText(root?.querySelector(`[data-field='${fieldName}']`)?.value);
}

function buildNextTargetActionId(actions = []) {
  const usedIds = new Set(actions.map((action) => cleanText(action?.id)).filter(Boolean));
  for (let index = 1; index <= MAX_DOWNTIME_TARGET_ACTIONS; index += 1) {
    const candidate = `check-${index}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }
  return `check-${Date.now()}`;
}

function getSelectableDowntimeActionType(actionType = "") {
  const safeActionType = cleanText(actionType);
  return DOWNTIME_ACTION_TYPE_SELECT_OPTIONS.some((option) => option.value === safeActionType)
    ? safeActionType
    : "check";
}

function normalizeDowntimeTargetChoice(choice = {}, fallback = {}, actor = null) {
  const sourceType = cleanText(choice.sourceType)
    || cleanText(fallback.sourceType)
    || "skill";
  const requestedTarget = cleanText(choice.target) || cleanText(fallback.target);
  const targetOption = getTargetOption(requestedTarget, sourceType, actor) ?? getDefaultTargetOption(sourceType, actor);
  const target = targetOption?.value ?? requestedTarget;
  const ability = cleanText(choice.ability)
    || cleanText(fallback.ability)
    || targetOption?.ability
    || "";
  const targetLabel = cleanText(choice.targetLabel)
    || cleanText(choice.label)
    || getTargetOptionLabel(target, sourceType, actor);
  const rollMode = cleanText(choice.rollMode)
    || cleanText(fallback.rollMode)
    || "normal";

  return {
    sourceType,
    ability,
    target,
    targetLabel,
    rollMode,
    label: targetLabel
  };
}

function buildDowntimeTargetChoices(action = {}, actor = null) {
  const fallback = normalizeDowntimeTargetChoice({
    sourceType: action.sourceType,
    ability: action.ability,
    target: action.target,
    targetLabel: action.targetLabel,
    rollMode: action.rollMode
  }, {}, actor);
  const choices = Array.isArray(action.choices) && action.choices.length
    ? action.choices.map((choice) => normalizeDowntimeTargetChoice(choice, fallback, actor))
    : [fallback];

  return choices.slice(0, MAX_DOWNTIME_TARGET_ACTIONS);
}

function buildDowntimeTargetChoiceSummary(choice = {}) {
  const sourceType = cleanText(choice.sourceType) || "skill";
  const targetLabel = cleanText(choice.targetLabel) || getTargetOptionLabel(choice.target, sourceType);
  if (sourceType === "skill" || sourceType === "tool") {
    const abilityLabel = getOptionLabel(DOWNTIME_ABILITY_OPTIONS, choice.ability, "Из листа");
    return [abilityLabel, targetLabel].filter(Boolean).join(" · ");
  }
  return targetLabel || getOptionLabel(DOWNTIME_SOURCE_TYPE_OPTIONS, sourceType, sourceType);
}

function buildDowntimeTargetChoiceFields(choice = {}, actor = null) {
  const safeChoice = normalizeDowntimeTargetChoice(choice, {}, actor);
  const targetGroups = getTargetOptionGroupsForSourceType(safeChoice.sourceType, actor);
  const targetLabel = safeChoice.sourceType === "skill"
    ? "Навык"
    : (safeChoice.sourceType === "tool"
      ? "Инструмент"
      : (safeChoice.sourceType === "attack"
        ? "Атака"
        : (safeChoice.sourceType === "sheetAction" ? "Действие" : "Цель")));

  if (safeChoice.sourceType === "ability") {
    return `
      <div class="rm-field">
        <label title="Характеристика из листа персонажа.">Характеристика</label>
        <select data-field="target-choice-target" data-target-choice-target="ability">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
      </div>
    `;
  }

  if (safeChoice.sourceType === "skill" || safeChoice.sourceType === "tool") {
    return `
      <div class="rm-field">
        <label title="Характеристика броска. «Из листа» берёт системную характеристику выбранного пункта.">Характеристика</label>
        <select data-field="target-choice-ability">${renderSelectOptions(DOWNTIME_ABILITY_OPTIONS, safeChoice.ability)}</select>
      </div>
      <div class="rm-field">
        <label title="Конкретный ${safeChoice.sourceType === "skill" ? "навык" : "инструмент"} из доступного списка.">${targetLabel}</label>
        <select data-field="target-choice-target" data-target-choice-target="${foundry.utils.escapeHTML(safeChoice.sourceType)}">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
      </div>
    `;
  }

  return `
    <div class="rm-field">
      <label title="Конкретный пункт из листа персонажа или системного списка.">${targetLabel}</label>
      <select data-field="target-choice-target" data-target-choice-target="${foundry.utils.escapeHTML(safeChoice.sourceType)}">${renderGroupedSelectOptions(targetGroups, safeChoice.target)}</select>
    </div>
  `;
}

function buildDowntimeTargetChoiceHeading(choiceCount = 1) {
  return choiceCount > 1 ? "Персонаж выбирает одно из" : "Персонаж должен";
}

function buildDowntimeTargetChoiceRow(choice = {}, index = 0, { visible = true, actor = null } = {}) {
  const safeChoice = normalizeDowntimeTargetChoice(choice, {}, actor);
  const hidden = visible ? "" : " hidden";
  const open = index === 0 ? " open" : "";
  const summary = foundry.utils.escapeHTML(buildDowntimeTargetChoiceSummary(safeChoice));

  return `
    <details class="rm-downtime-target-choice"${open}${hidden} data-target-choice data-choice-index="${index}">
      <summary class="rm-downtime-target-choice__summary" title="Нажмите, чтобы раскрыть настройки варианта.">
        <strong data-target-choice-summary>${summary}</strong>
        <span class="rm-downtime-target-choice__actions">
          <button type="button" class="rm-icon-button" data-action="target-choice-edit" title="Редактировать вариант" aria-label="Редактировать вариант">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button type="button" class="rm-icon-button rm-icon-button--danger" data-action="target-choice-remove" title="Удалить вариант" aria-label="Удалить вариант">
            <i class="fa-solid fa-trash"></i>
          </button>
        </span>
      </summary>
      <div class="rm-downtime-target-choice__body">
        <div class="rm-field rm-downtime-target-choice__source">
          <label title="Откуда брать механику броска или действия.">Что бросать</label>
          <select data-field="target-choice-source-type">${renderSelectOptions(DOWNTIME_SOURCE_TYPE_OPTIONS, safeChoice.sourceType)}</select>
        </div>
        <div class="rm-downtime-target-choice__fields" data-target-choice-fields>
          ${buildDowntimeTargetChoiceFields(safeChoice, actor)}
        </div>
      </div>
    </details>
  `;
}

function normalizeDowntimeThreshold(threshold = {}, index = 0) {
  const defaults = [
    { from: 0, to: 9, outcome: "failure" },
    { from: 10, to: 20, outcome: "partial" },
    { from: 21, to: "", outcome: "success" }
  ];
  const fallback = defaults[index] ?? { from: "", to: "", outcome: "gm" };
  return {
    from: cleanText(threshold.from) || cleanText(fallback.from),
    to: cleanText(threshold.to) || cleanText(fallback.to),
    outcome: cleanText(threshold.outcome) || fallback.outcome
  };
}

function buildDowntimeThresholdRow(threshold = {}, index = 0) {
  const safeThreshold = normalizeDowntimeThreshold(threshold, index);
  return `
    <div class="rm-downtime-threshold-row" data-threshold-row>
      <div class="rm-field">
        <label title="Нижняя граница общего итога простоя.">От</label>
        <input type="number" step="1" value="${foundry.utils.escapeHTML(safeThreshold.from)}" data-field="target-threshold-from">
      </div>
      <div class="rm-field">
        <label title="Верхняя граница. Пусто означает значение и выше.">До</label>
        <input type="number" step="1" value="${foundry.utils.escapeHTML(safeThreshold.to)}" data-field="target-threshold-to">
      </div>
      <div class="rm-field">
        <label title="Какой итог применить при попадании в этот диапазон.">Итог</label>
        <select data-field="target-threshold-outcome">${renderSelectOptions(DOWNTIME_THRESHOLD_OUTCOME_OPTIONS, safeThreshold.outcome)}</select>
      </div>
    </div>
  `;
}

function buildDowntimeThresholdRows(thresholds = []) {
  const safeThresholds = Array.isArray(thresholds) ? thresholds.slice(0, MAX_DOWNTIME_THRESHOLDS) : [];
  const rows = safeThresholds.length ? safeThresholds : [{}, {}, {}];
  return rows.map((threshold, index) => buildDowntimeThresholdRow(threshold, index)).join("");
}

function readDowntimeThreshold(row) {
  return {
    from: readFieldValue(row, "target-threshold-from"),
    to: readFieldValue(row, "target-threshold-to"),
    outcome: readFieldValue(row, "target-threshold-outcome") || "gm"
  };
}

function readDowntimeTargetChoice(row, actor = null) {
  const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
  const defaultTarget = getDefaultTargetOption(sourceType, actor);
  const target = readFieldValue(row, "target-choice-target") || defaultTarget?.value || "prc";
  const targetOption = getTargetOption(target, sourceType, actor) ?? defaultTarget;
  const targetLabel = readSelectedOptionLabel(row, "target-choice-target", { sourceType, actor }) || targetOption?.label || target;
  let ability = readFieldValue(row, "target-choice-ability") || targetOption?.ability || "";
  if (sourceType === "ability") {
    ability = target;
  }
  else if (sourceType === "save") {
    ability = targetOption?.ability || (target.startsWith("save-") ? target.slice(5) : target);
  }
  const rollMode = "normal";

  return {
    sourceType,
    ability,
    target,
    targetLabel,
    rollMode,
    label: targetLabel
  };
}

function isKnownGroupContextError(error) {
  return KNOWN_GROUP_CONTEXT_ERROR_MESSAGES.has(error?.message);
}

function buildEmptyDowntimeContext({ warning = "", grantWeeks = 1, grantActorId = "all", requestActorId = "", requestActionId = "unique", requestWeeks = 1, requestTitle = "", requestDescription = "" } = {}) {
  const safeWarning = cleanText(warning);
  return {
    members: [],
    requests: [],
    actionOptions: [],
    grantActorOptions: [{
      value: "all",
      label: "Всем участникам",
      selected: true
    }],
    requestActorOptions: [],
    canManage: false,
    canSubmit: false,
    warning: safeWarning,
    grantWeeks,
    grantActorId,
    requestActorId,
    requestActionId,
    requestWeeks,
    requestTitle,
    requestDescription,
    grantDisabled: true,
    grantDisabledReason: safeWarning || "Нет участников для выдачи простоя.",
    submitDisabled: true,
    submitDisabledReason: safeWarning || "Нет доступных персонажей для заявки.",
    emptyMembers: true,
    emptyRequests: true
  };
}

function buildCheckSummary(check) {
  const abilityLabel = getOptionLabel(DOWNTIME_ABILITY_OPTIONS, check?.ability, cleanText(check?.ability));
  const parts = [
    cleanText(check?.label),
    cleanText(check?.dc) ? `DC ${cleanText(check.dc).replace(/^dc\s*/iu, "")}` : "",
    abilityLabel
  ].filter(Boolean);
  return parts.join(" | ");
}

function buildEffectLabel(effect, { downtime = false } = {}) {
  const safeEffect = effect && typeof effect === "object" && !Array.isArray(effect) ? effect : {};
  const triggerOptions = downtime ? DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS : DOWNTIME_EFFECT_TRIGGER_OPTIONS;
  const trigger = cleanText(safeEffect.trigger);
  const adapter = cleanText(safeEffect.adapter);
  const template = cleanText(safeEffect.template);
  if (!trigger || trigger === "none" || !adapter || adapter === "none") {
    return "";
  }

  const templateOptions = downtime ? DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS : DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS;
  return [
    getOptionLabel(triggerOptions, trigger, trigger),
    [
      getOptionLabel(DOWNTIME_EFFECT_ADAPTER_OPTIONS, adapter, adapter),
      getOptionLabel(templateOptions, template, template)
    ].filter(Boolean).join(" / ")
  ].filter(Boolean).join(": ");
}

function buildOutcomeSummary(check, outcomeMode) {
  const numericDc = Number(check?.dc);
  const hasDc = Number.isFinite(numericDc) && numericDc > 0;
  switch (outcomeMode) {
    case "dc":
      return hasDc ? `DC ${numericDc}` : "DC";
    case "sum":
    case "total":
      return "Сумма";
    case "dc-sum":
    case "dc-total":
      return hasDc ? `DC ${numericDc} + сумма` : "DC + сумма";
    case "thresholds":
      return "Пороги";
    case "freeform":
      return "Свободный";
    default:
      return getOptionLabel(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode, outcomeMode);
  }
}

function mapDowntimeTargetAction(check, index) {
  const actionType = cleanText(check?.actionType) || "check";
  const sourceType = cleanText(check?.sourceType) || "skill";
  const outcomeMode = cleanText(check?.outcomeMode) || (cleanText(check?.dc) ? "dc" : "freeform");
  const recordMode = cleanText(check?.recordMode) || "total-success";
  const checkEffectLabel = buildEffectLabel(check?.checkEffect);
  const downtimeEffectLabel = buildEffectLabel(check?.downtimeEffect, { downtime: true });
  return {
    ...check,
    number: index + 1,
    summary: buildCheckSummary(check),
    actionType,
    sourceType,
    outcomeMode,
    recordMode,
    actionTypeLabel: getOptionLabel(DOWNTIME_ACTION_TYPE_OPTIONS, actionType, actionType),
    sourceTypeLabel: getOptionLabel(DOWNTIME_SOURCE_TYPE_OPTIONS, sourceType, sourceType),
    abilityLabel: getOptionLabel(DOWNTIME_ABILITY_OPTIONS, check?.ability, cleanText(check?.ability)),
    outcomeModeLabel: getOptionLabel(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode, outcomeMode),
    outcomeSummary: buildOutcomeSummary(check, outcomeMode),
    recordModeLabel: getOptionLabel(DOWNTIME_RECORD_MODE_OPTIONS, recordMode, recordMode),
    targetLabel: cleanText(check?.targetLabel) || cleanText(check?.target),
    checkEffectLabel,
    downtimeEffectLabel,
    hasCheckEffect: Boolean(checkEffectLabel),
    hasDowntimeEffect: Boolean(downtimeEffectLabel),
    hasChoices: Array.isArray(check?.choices) && check.choices.length > 1
  };
}

function mapDowntimeRequest(request) {
  const status = cleanText(request?.status) || "pending";
  const statusMeta = DOWNTIME_STATUS_META[status] ?? {
    label: status || "Заявка",
    type: "info"
  };
  const checks = (request?.checks ?? []).map((check, index) => mapDowntimeTargetAction(check, index));

  return {
    ...request,
    status,
    statusLabel: statusMeta.label,
    statusType: statusMeta.type,
    statusClass: `rm-status-badge--${statusMeta.type}`,
    checks,
    targetActions: checks,
    targetActionCount: checks.length,
    targetActionLimit: MAX_DOWNTIME_TARGET_ACTIONS,
    targetActionLimitReached: checks.length >= MAX_DOWNTIME_TARGET_ACTIONS,
    hasChecks: checks.length > 0,
    hasTargetActions: checks.length > 0,
    hasResult: Boolean(cleanText(request?.result)),
    canApprove: status === "pending" || status === "returned",
    canReturn: status === "pending" || status === "approved",
    canReject: status === "pending" || status === "approved" || status === "returned",
    canComplete: status === "approved"
  };
}

function shouldPromptDowntimeResult(status) {
  return ["returned", "rejected", "completed"].includes(status);
}

function normalizeInventorySourceType(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/gu, "");

  if (["material", "materials", "материал", "материалы"].includes(text)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(text)) {
    return "gear";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(text)) {
    return "magicItem";
  }

  if (["supply", "supplies", "resource", "resources", "запасы"].includes(text)) {
    return "supply";
  }

  return text || "";
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function resolveCapacitySeverity(freeCapacityLb, usedPercentRaw) {
  if (toNumber(freeCapacityLb, 0) < 0) {
    return "danger";
  }
  if (toNumber(usedPercentRaw, 0) >= 90) {
    return "warning";
  }
  return "good";
}

function resolveSupplySeverity(daysLeft, hasEstimate) {
  if (!hasEstimate) {
    return "info";
  }
  const safeDays = toNumber(daysLeft, 0);
  if (safeDays <= 0) {
    return "danger";
  }
  if (safeDays <= 1) {
    return "warning";
  }
  return "good";
}

function resolveEnergySeverity(current, max) {
  const safeMax = toNumber(max, 0);
  if (safeMax <= 0) {
    return "info";
  }
  const ratioPercent = (toNumber(current, 0) / safeMax) * 100;
  if (ratioPercent <= 30) {
    return "danger";
  }
  if (ratioPercent <= 60) {
    return "warning";
  }
  return "good";
}

function toStateClass(severity) {
  const safeSeverity = ["danger", "warning", "good", "info"].includes(severity) ? severity : "info";
  return `rm-state-${safeSeverity}`;
}

function toStatusBadgeType(severity) {
  if (severity === "danger" || severity === "warning" || severity === "good") {
    return severity;
  }
  return "info";
}

function getDialogRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

function readCurrencyValuesFromRoot(root) {
  return {
    pp: toInteger(root?.querySelector("[data-field='currency-pp']")?.value, 0),
    gp: toInteger(root?.querySelector("[data-field='currency-gp']")?.value, 0),
    sp: toInteger(root?.querySelector("[data-field='currency-sp']")?.value, 0),
    cp: toInteger(root?.querySelector("[data-field='currency-cp']")?.value, 0)
  };
}

async function promptNumericValue({ title, label, value = "", min = 0, step = "0.01", confirmLabel = "Сохранить" }) {
  return new Promise((resolve) => {
    let settled = false;

    const dialog = new Dialog({
      title,
      content: `
        <form class="rm-purchase-dialog">
          <div class="rm-field">
            <label for="rm-number-prompt">${foundry.utils.escapeHTML(label)}</label>
            <input
              id="rm-number-prompt"
              type="number"
              min="${foundry.utils.escapeHTML(String(min))}"
              step="${foundry.utils.escapeHTML(String(step))}"
              value="${foundry.utils.escapeHTML(String(value ?? ""))}"
              data-field="numeric-value"
            >
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: confirmLabel,
          callback: (html) => {
            const root = getDialogRoot(html);
            const input = root?.querySelector("[data-field='numeric-value']");
            settled = true;
            resolve(input?.value ?? null);
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => {
            settled = true;
            resolve(null);
          }
        }
      },
      default: "confirm",
      render: (html) => {
        const root = getDialogRoot(html);
        const input = root?.querySelector("[data-field='numeric-value']");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      },
      close: () => {
        if (!settled) {
          resolve(null);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog"]
    });

    dialog.render(true);
  });
}

async function confirmAction(title, content) {
  const dialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof dialogV2?.confirm === "function") {
    return dialogV2.confirm({
      window: {
        title
      },
      content
    });
  }

  return new Promise((resolve) => {
    Dialog.confirm({
      title,
      content,
      yes: () => resolve(true),
      no: () => resolve(false),
      defaultYes: false,
      close: () => resolve(false)
    });
  });
}

async function promptCurrencyDialog(currency = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const safeCurrency = {
      pp: toInteger(currency.pp, 0),
      gp: toInteger(currency.gp, 0),
      sp: toInteger(currency.sp, 0),
      cp: toInteger(currency.cp, 0)
    };

    const resolveWith = (payload) => {
      settled = true;
      resolve(payload);
    };

    const dialog = new Dialog({
      title: "Монеты склада",
      content: `
        <form class="rm-purchase-dialog rm-currency-dialog">
          <div class="rm-currency-dialog__grid">
            <div class="rm-field rm-field--narrow">
              <label>Пм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.pp}" data-field="currency-pp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Зм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.gp}" data-field="currency-gp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>См</label>
              <input type="number" min="0" step="1" value="${safeCurrency.sp}" data-field="currency-sp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Мм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.cp}" data-field="currency-cp">
            </div>
          </div>
          <p class="rm-muted">Сначала отредактируйте значения, затем при необходимости примените конвертацию.</p>
        </form>
      `,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "save",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        normalized: {
          label: "Нормализация",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "normalized",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toGold: {
          label: "В золото",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "gp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toSilver: {
          label: "В серебро",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "sp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toCopper: {
          label: "В медь",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "cp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => resolveWith(null)
        }
      },
      default: "save",
      close: () => {
        if (!settled) {
          resolve(null);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog"]
    });

    dialog.render(true);
  });
}

export class InventoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-inventory-app"],
    window: {
      title: "Партийный инвентарь",
      icon: "fa-solid fa-box-open",
      resizable: true
    },
    position: {
      width: 1320,
      height: 900
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/inventory-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.activeTab = "inventory";
    this.search = "";
    this.typeFilter = "all";
    this.selectedNewMemberId = "";
    this.newMemberQuery = "";
    this.availablePartyActors = [];
    this.craftSearch = "";
    this.craftCrafterActorId = "";
    this.downtimeGrantWeeks = 1;
    this.downtimeGrantActorId = "all";
    this.downtimeRequestActorId = "";
    this.downtimeRequestActionId = "unique";
    this.downtimeRequestWeeks = 1;
    this.downtimeRequestTitle = "";
    this.downtimeRequestDescription = "";
    this.expandedPartyMembers = new Set();
    this.searchRenderTimeout = null;
    this.craftSearchRenderTimeout = null;
    this.actionFeedbackTimeout = null;
    this.contextMenuCleanup = null;
    this.focusRestore = null;
    this.renderListenersAbortController = null;
    this.actionFeedback = null;
    this.canManage = false;
    this.partyMembershipManagedByNativeGroup = false;
  }

  get id() {
    return `${MODULE_ID}-inventory-app`;
  }

  setActiveTab(tab, { render = true } = {}) {
    const allowedTabs = new Set(["inventory", "party", "craft", "calendar", "downtime"]);
    const nextTab = allowedTabs.has(tab) ? tab : "inventory";
    if (this.activeTab === nextTab) {
      return;
    }

    this.activeTab = nextTab;
    if (render) {
      this.render({ force: true });
    }
  }

  #setActionFeedback(type, message) {
    const safeType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
    const safeMessage = String(message ?? "").trim();
    if (!safeMessage) {
      return;
    }

    this.actionFeedback = {
      type: safeType,
      message: safeMessage
    };

    window.clearTimeout(this.actionFeedbackTimeout);
    const feedbackMarker = `${safeType}:${safeMessage}`;
    this.actionFeedbackTimeout = window.setTimeout(() => {
      const currentMarker = this.actionFeedback
        ? `${this.actionFeedback.type}:${this.actionFeedback.message}`
        : "";
      if (currentMarker !== feedbackMarker) {
        return;
      }

      this.actionFeedback = null;
      this.actionFeedbackTimeout = null;
      if (getAppElement(this)) {
        this.render({ force: true });
      }
    }, 3500);
  }

  #resolveAvailableActorIdByName(query, availableActors = null) {
    const source = Array.isArray(availableActors) ? availableActors : this.availablePartyActors;
    const safeQuery = normalizeLookupText(query);
    if (!safeQuery || !source.length) {
      return "";
    }

    const exactMatch = source.find((actor) => normalizeLookupText(actor.name) === safeQuery) ?? null;
    if (exactMatch) {
      return exactMatch.id;
    }

    const startsWithMatches = source.filter((actor) => normalizeLookupText(actor.name).startsWith(safeQuery));
    if (startsWithMatches.length === 1) {
      return startsWithMatches[0].id;
    }

    return "";
  }

  #closeContextMenu() {
    if (typeof this.contextMenuCleanup === "function") {
      this.contextMenuCleanup();
    }
    this.contextMenuCleanup = null;
  }

  #openContextMenu({ x, y, title = "", actions = [] }) {
    this.#closeContextMenu();
    if (!Array.isArray(actions) || !actions.length) {
      return;
    }

    const menuRoot = document.createElement("div");
    menuRoot.className = "rm-context-menu";
    menuRoot.setAttribute("role", "menu");

    if (title) {
      const titleNode = document.createElement("p");
      titleNode.className = "rm-context-menu__title";
      titleNode.textContent = title;
      menuRoot.appendChild(titleNode);
    }

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rm-context-menu__item${action.danger ? " is-danger" : ""}`;
      if (action.icon) {
        const iconNode = document.createElement("i");
        iconNode.className = action.icon;
        button.appendChild(iconNode);
      }

      const labelNode = document.createElement("span");
      labelNode.textContent = action.label ?? "";
      button.appendChild(labelNode);

      button.addEventListener("click", () => {
        this.#closeContextMenu();
        try {
          action.callback?.();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Context menu action failed.`, error);
        }
      });
      menuRoot.appendChild(button);
    }

    document.body.appendChild(menuRoot);

    const bounds = menuRoot.getBoundingClientRect();
    const maxLeft = window.innerWidth - bounds.width - 8;
    const maxTop = window.innerHeight - bounds.height - 8;
    const safeLeft = Math.max(8, Math.min(x, maxLeft));
    const safeTop = Math.max(8, Math.min(y, maxTop));

    menuRoot.style.left = `${safeLeft}px`;
    menuRoot.style.top = `${safeTop}px`;

    const handlePointerDown = (event) => {
      if (!menuRoot.contains(event.target)) {
        this.#closeContextMenu();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        this.#closeContextMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    this.contextMenuCleanup = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      menuRoot.remove();
    };
  }

  async #openPartyMemberSheet(actorId, actorName = "участника") {
    const safeActorId = String(actorId ?? "").trim();
    const safeActorName = String(actorName ?? "участника").trim() || "участника";
    if (!safeActorId) {
      return;
    }

    try {
      const actor = game.actors?.get(safeActorId) ?? null;
      if (!actor) {
        ui.notifications?.warn(`Лист участника «${safeActorName}» не найден.`);
        return;
      }

      await actor.sheet?.render?.(true);
      bringAppToFront(actor.sheet);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open party member sheet.`, error);
      ui.notifications?.error(error.message || "Не удалось открыть лист участника.");
    }
  }

  async #removePartyMember(actorId, actorName, element) {
    const safeActorId = String(actorId ?? "").trim();
    const safeActorName = String(actorName ?? "участника").trim() || "участника";
    if (!safeActorId) {
      return;
    }

    const confirmed = await confirmAction(
      "Удалить из группы",
      `<p>Удалить «${foundry.utils.escapeHTML(safeActorName)}» из состава группы?</p>`
    );
    if (!confirmed) {
      return;
    }

    try {
      this.#rememberExpandedPartyMembers(element);
      await this.moduleApi.removePartyMember(safeActorId);
      this.#setActionFeedback("success", `Участник «${safeActorName}» удалён из группы.`);
      ui.notifications?.info(`Участник «${safeActorName}» удалён из группы.`);
      bringAppToFront(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to remove party member.`, error);
      const message = error.message || "Не удалось удалить участника группы.";
      this.#setActionFeedback("error", message);
      this.render({ force: true });
      ui.notifications?.error(message);
    }
  }

  async #resolveDroppedActor(dragData) {
    if (!dragData || typeof dragData !== "object") {
      return null;
    }

    const droppedDocument = dragData.uuid ? await fromUuid(dragData.uuid) : null;
    if (droppedDocument instanceof Actor) {
      return droppedDocument;
    }

    if (droppedDocument?.actor instanceof Actor) {
      return droppedDocument.actor;
    }

    if (dragData.type === "Actor" && dragData.id) {
      return game.actors.get(dragData.id) ?? null;
    }

    return null;
  }

  #prepareDowntimeContext(snapshot = {}, warning = "") {
    if (!snapshot || warning) {
      return buildEmptyDowntimeContext({
        warning,
        grantWeeks: this.downtimeGrantWeeks,
        grantActorId: this.downtimeGrantActorId,
        requestActorId: this.downtimeRequestActorId,
        requestActionId: this.downtimeRequestActionId,
        requestWeeks: this.downtimeRequestWeeks,
        requestTitle: this.downtimeRequestTitle,
        requestDescription: this.downtimeRequestDescription
      });
    }

    const members = (snapshot.members ?? []).map((member) => {
      const balance = member.balance ?? {};
      return {
        ...member,
        availableWeeks: toInteger(balance.availableWeeks, 0),
        reservedWeeks: toInteger(balance.reservedWeeks, 0),
        spentWeeks: toInteger(balance.spentWeeks, 0),
        totalGrantedWeeks: toInteger(balance.totalGrantedWeeks, 0)
      };
    });
    const grantActorIds = new Set(members.map((member) => member.actorId));
    if (this.downtimeGrantActorId !== "all" && !grantActorIds.has(this.downtimeGrantActorId)) {
      this.downtimeGrantActorId = "all";
    }

    const requestMembers = members.filter((member) => member.canSubmit);
    if (!requestMembers.some((member) => member.actorId === this.downtimeRequestActorId)) {
      this.downtimeRequestActorId = requestMembers[0]?.actorId ?? "";
    }

    const actionCatalog = snapshot.actionCatalog ?? [];
    if (!actionCatalog.some((action) => action.id === this.downtimeRequestActionId)) {
      this.downtimeRequestActionId = actionCatalog[0]?.id ?? "unique";
    }

    const canManageDowntime = Boolean(snapshot.canManage);
    const canSubmitDowntime = Boolean(snapshot.canSubmit && requestMembers.length);
    const grantDisabled = !canManageDowntime || members.length === 0;
    const submitDisabled = !canSubmitDowntime || !this.downtimeRequestActorId || actionCatalog.length === 0;

    const requests = (snapshot.requests ?? []).map((request) => mapDowntimeRequest(request));

    return {
      members,
      requests,
      actionOptions: actionCatalog.map((action) => ({
        value: action.id,
        label: action.label ?? action.id,
        selected: action.id === this.downtimeRequestActionId
      })),
      grantActorOptions: [
        {
          value: "all",
          label: "Всем участникам",
          selected: this.downtimeGrantActorId === "all"
        },
        ...members.map((member) => ({
          value: member.actorId,
          label: member.actorName,
          selected: member.actorId === this.downtimeGrantActorId
        }))
      ],
      requestActorOptions: requestMembers.map((member) => ({
        value: member.actorId,
        label: member.actorName,
        selected: member.actorId === this.downtimeRequestActorId
      })),
      canManage: canManageDowntime,
      canSubmit: canSubmitDowntime,
      warning: "",
      grantWeeks: this.downtimeGrantWeeks,
      grantActorId: this.downtimeGrantActorId,
      requestActorId: this.downtimeRequestActorId,
      requestActionId: this.downtimeRequestActionId,
      requestWeeks: this.downtimeRequestWeeks,
      requestTitle: this.downtimeRequestTitle,
      requestDescription: this.downtimeRequestDescription,
      grantDisabled,
      grantDisabledReason: grantDisabled
        ? (canManageDowntime ? "Нет участников для выдачи простоя." : "Только мастер может выдавать недели простоя.")
        : "",
      submitDisabled,
      submitDisabledReason: submitDisabled
        ? (canSubmitDowntime ? "Заполните персонажа и действие." : "Нет доступных персонажей для заявки.")
        : "",
      emptyMembers: members.length === 0,
      emptyRequests: requests.length === 0
    };
  }

  async _prepareContext() {
    try {
      const inventorySnapshot = await this.moduleApi.getInventorySnapshot({
        search: this.search,
        typeFilter: this.typeFilter,
        createActor: true
      });
      let group = null;
      let groupContextError = String(inventorySnapshot.groupContextError ?? "").trim();
      try {
        const groupContext = this.moduleApi.getGroupContext?.() ?? null;
        const groupActor = groupContext?.groupActor ?? null;
        if (groupActor) {
          group = {
            id: groupContext.groupId ?? groupActor.id ?? "",
            name: groupActor.name ?? "Группа",
            memberCount: toInteger(
              groupContext.memberActorIds?.length
                ?? groupContext.members?.length
                ?? groupActor.system?.members?.length,
              0
            )
          };
          groupContextError = "";
        }
      }
      catch (error) {
        if (![
          GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
          GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP
        ].includes(error?.message)) {
          throw error;
        }

        groupContextError = groupContextError || error.message || "Не удалось определить группу Rebreya.";
      }
      const partySnapshot = await this.moduleApi.getPartySnapshot();
      const craftSnapshot = await this.moduleApi.getCraftSnapshot({
        search: this.craftSearch,
        crafterActorId: this.craftCrafterActorId
      });
      const calendarSnapshot = this.moduleApi.getCalendarSnapshot();
      let downtimeSnapshot = null;
      let downtimeWarning = "";
      try {
        downtimeSnapshot = await this.moduleApi.getDowntimeSnapshot();
      }
      catch (error) {
        if (!isKnownGroupContextError(error)) {
          throw error;
        }

        downtimeWarning = error.message || "Не удалось определить группу Rebreya.";
      }
      const availableActors = partySnapshot.availableActors ?? [];
      this.availablePartyActors = availableActors.map((actor) => ({
        id: actor.id,
        name: actor.name
      }));
      const totalCapacityLb = toNumber(partySnapshot.totalCapacityLb, 0);
      const inventoryWeight = toNumber(partySnapshot.inventoryWeight, 0);
      const freeCapacityLb = roundNumber(toNumber(partySnapshot.freeCapacityLb, 0), 2);
      const capacityUsedRawPercent = totalCapacityLb > 0
        ? roundNumber((inventoryWeight / totalCapacityLb) * 100, 1)
        : 0;
      const capacityUsedPercent = totalCapacityLb > 0
        ? Math.min(100, Math.max(0, capacityUsedRawPercent))
        : 0;
      const hasFoodEstimate = partySnapshot.foodDaysLeft !== null;
      const hasWaterEstimate = partySnapshot.waterDaysLeft !== null;
      const foodDaysLeft = hasFoodEstimate ? roundNumber(toNumber(partySnapshot.foodDaysLeft, 0), 1) : null;
      const waterDaysLeft = hasWaterEstimate ? roundNumber(toNumber(partySnapshot.waterDaysLeft, 0), 1) : null;
      const totalFoodPerDay = roundNumber(toNumber(partySnapshot.totalFoodPerDay, 0), 2);
      const totalWaterPerDay = roundNumber(toNumber(partySnapshot.totalWaterGalPerDay, 0), 2);
      const totalEnergyCurrent = toNumber(partySnapshot.totalEnergyCurrent, 0);
      const totalEnergyMax = toNumber(partySnapshot.totalEnergyMax, 0);
      const energyPercent = totalEnergyMax > 0
        ? Math.max(0, Math.min(100, roundNumber((totalEnergyCurrent / totalEnergyMax) * 100, 0)))
        : 0;

      const weightSeverity = resolveCapacitySeverity(freeCapacityLb, capacityUsedRawPercent);
      const foodSeverity = resolveSupplySeverity(foodDaysLeft, hasFoodEstimate);
      const waterSeverity = resolveSupplySeverity(waterDaysLeft, hasWaterEstimate);
      const energySeverity = resolveEnergySeverity(totalEnergyCurrent, totalEnergyMax);
      const overloadLb = roundNumber(Math.abs(freeCapacityLb), 2);

      const dashboard = {
        weight: {
          className: toStateClass(weightSeverity),
          badgeType: toStatusBadgeType(weightSeverity),
          badgeLabel: freeCapacityLb < 0
            ? `Перегруз ${overloadLb} фнт.`
            : `Загрузка ${roundNumber(capacityUsedRawPercent, 1)}%`,
          note: freeCapacityLb < 0
            ? `Свободно: -${overloadLb} фнт.`
            : `Свободно: ${roundNumber(freeCapacityLb, 2)} фнт.`,
          meterClass: `is-${weightSeverity}`,
          meterPercent: capacityUsedPercent
        },
        food: {
          className: toStateClass(foodSeverity),
          badgeType: toStatusBadgeType(foodSeverity),
          daysLabel: hasFoodEstimate ? `${foodDaysLeft} дн.` : "Без нормы",
          note: hasFoodEstimate
            ? (foodDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalFoodPerDay} / день`)
            : "Задайте расход в группе"
        },
        water: {
          className: toStateClass(waterSeverity),
          badgeType: toStatusBadgeType(waterSeverity),
          daysLabel: hasWaterEstimate ? `${waterDaysLeft} дн.` : "Без нормы",
          note: hasWaterEstimate
            ? (waterDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalWaterPerDay} / день`)
            : "Задайте расход в группе"
        },
        energy: {
          className: toStateClass(energySeverity),
          badgeType: toStatusBadgeType(energySeverity),
          ratioLabel: `${roundNumber(totalEnergyCurrent, 0)} / ${roundNumber(totalEnergyMax, 0)}`,
          note: totalEnergyMax > 0
            ? `Готовность ${energyPercent}%`
            : "Нет участников"
        }
      };

      const currency = inventorySnapshot.summary.currency ?? {
        pp: 0,
        gp: 0,
        sp: 0,
        cp: 0,
        totalCopper: 0,
        label: inventorySnapshot.summary.currencyLabel
      };
      const partyMembers = (partySnapshot.members ?? []).map((member) => ({
        ...member,
        expanded: this.expandedPartyMembers.has(member.actorId)
      }));
      const membershipManagedByNativeGroup = Boolean(partySnapshot.membershipManagedByNativeGroup);
      const addMemberDisabled = membershipManagedByNativeGroup || availableActors.length === 0;
      const consumeDayDisabled = toInteger(partySnapshot.memberCount, 0) <= 0;
      const craftHasCrafters = (craftSnapshot.crafters ?? []).length > 0;
      const processDayDisabled = (craftSnapshot.queue ?? []).length === 0;
      const partyAlerts = [];
      if (freeCapacityLb < 0) {
        partyAlerts.push({
          type: "danger",
          message: `Перегруз: ${overloadLb} фнт.`
        });
      }
      if (hasFoodEstimate && toNumber(foodDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Еда закончилась: пополните запас."
        });
      }
      if (hasWaterEstimate && toNumber(waterDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Вода закончилась: пополните запас."
        });
      }
      const actionFeedback = this.actionFeedback
        ? {
            ...this.actionFeedback,
            className: `rm-inline-status rm-inline-status--${this.actionFeedback.type}`
          }
        : null;
      const canManage = Boolean(partySnapshot.canManage || inventorySnapshot.actor?.canEdit);
      this.canManage = canManage;
      this.partyMembershipManagedByNativeGroup = membershipManagedByNativeGroup;

      if (!availableActors.some((actor) => actor.id === this.selectedNewMemberId)) {
        this.selectedNewMemberId = "";
      }

      const resolvedActorIdByQuery = this.#resolveAvailableActorIdByName(this.newMemberQuery, this.availablePartyActors);
      if (resolvedActorIdByQuery) {
        this.selectedNewMemberId = resolvedActorIdByQuery;
      }

      if (!String(this.newMemberQuery ?? "").trim() && this.selectedNewMemberId) {
        const selectedActor = availableActors.find((actor) => actor.id === this.selectedNewMemberId) ?? null;
        this.newMemberQuery = selectedActor?.name ?? "";
      }

      if (!craftSnapshot.crafters?.some((entry) => entry.actorId === this.craftCrafterActorId)) {
        this.craftCrafterActorId = craftSnapshot.crafters?.[0]?.actorId ?? "";
      }

      const downtime = this.#prepareDowntimeContext(downtimeSnapshot, downtimeWarning);

      return {
        hasError: false,
        actor: inventorySnapshot.actor ?? {
          id: "",
          name: "Партийный инвентарь",
          img: "icons/svg/item-bag.svg",
          currencyLabel: inventorySnapshot.summary.currencyLabel,
          canEdit: false
        },
        activeTab: this.activeTab,
        appDomId: this.id,
        search: this.search,
        typeFilter: this.typeFilter,
        craftSearch: this.craftSearch,
        craftCrafterActorId: this.craftCrafterActorId,
        group,
        groupContextError,
        inventory: inventorySnapshot.items,
        inventoryCount: inventorySnapshot.items.length,
        emptyInventory: inventorySnapshot.emptyInventory,
        summary: {
          ...inventorySnapshot.summary,
          currency,
          partyCapacityLb: partySnapshot.totalCapacityLb,
          freeCapacityLb,
          freeCapacityClass: freeCapacityLb < 0 ? "rm-negative" : "rm-positive"
        },
        party: {
          ...partySnapshot,
          freeCapacityLb,
          foodDaysLeft,
          waterDaysLeft,
          members: partyMembers,
          capacityUsedPercent,
          capacityUsedRawPercent,
          alerts: partyAlerts,
          dashboard,
          membershipManagedByNativeGroup,
          addMemberDisabled,
          addMemberDisabledReason: membershipManagedByNativeGroup
            ? "Состав управляется листом группы dnd5e."
            : (addMemberDisabled
              ? "Нет доступных актёров для добавления в группу."
              : ""),
          consumeDayDisabled,
          consumeDayDisabledReason: consumeDayDisabled
            ? "Добавьте хотя бы одного участника, чтобы списать день."
            : "",
          availableActors: availableActors.map((actor) => ({
            ...actor,
            selected: actor.id === this.selectedNewMemberId
          })),
          addMemberQuery: this.newMemberQuery,
          hasFoodEstimate,
          hasWaterEstimate
        },
        craft: {
          ...craftSnapshot,
          crafters: (craftSnapshot.crafters ?? []).map((entry) => ({
            ...entry,
            selected: entry.actorId === this.craftCrafterActorId
          })),
          hasQueue: (craftSnapshot.queue ?? []).length > 0,
          hasCrafters: craftHasCrafters,
          queueDisabledReason: craftHasCrafters
            ? ""
            : "Добавьте участника в группу, чтобы запустить крафт.",
          processDayDisabled,
          processDayDisabledReason: processDayDisabled
            ? "Очередь крафта пуста."
            : ""
        },
        calendar: {
          ...calendarSnapshot,
          yearValue: calendarSnapshot.year,
          monthValue: calendarSnapshot.month,
          dayValue: calendarSnapshot.day
        },
        downtime,
        typeOptions: [
          { value: "all", label: "Все", selected: this.typeFilter === "all" },
          { value: "gear", label: "Снаряжение", selected: this.typeFilter === "gear" },
          { value: "material", label: "Материалы", selected: this.typeFilter === "material" },
          { value: "supply", label: "Запасы", selected: this.typeFilter === "supply" },
          { value: "custom", label: "Прочее", selected: this.typeFilter === "custom" }
        ],
        tabs: {
          isInventory: this.activeTab === "inventory",
          isParty: this.activeTab === "party",
          isCraft: this.activeTab === "craft",
          isCalendar: this.activeTab === "calendar",
          isDowntime: this.activeTab === "downtime"
        },
        actionFeedback,
        canManage
      };
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to prepare inventory app.`, error);
      return {
        hasError: true,
        errorMessage: error.message || "Не удалось подготовить партийный инвентарь."
      };
    }
  }

  async #openItemSheet(itemId) {
    const actor = await this.moduleApi.inventoryService.getInventoryActor({ create: true });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет уже не найден в складе.");
    }

    await item.sheet?.render?.(true);
    bringAppToFront(item.sheet);
  }

  async #promptSupply(resourceKey) {
    const quantity = await promptNumericValue({
      title: resourceKey === "water" ? "Добавить воду" : "Добавить еду",
      label: resourceKey === "water" ? "Сколько галлонов добавить" : "Сколько фунтов добавить",
      value: "0",
      min: 0,
      step: "0.01",
      confirmLabel: "Добавить"
    });

    if (quantity === null) {
      return;
    }

    await this.moduleApi.addPartySupply(resourceKey, quantity);
    const successMessage = resourceKey === "water"
      ? "Запас воды обновлён."
      : "Запас еды обновлён.";
    this.#setActionFeedback("success", successMessage);
    ui.notifications?.info(successMessage);
    bringAppToFront(this);
  }

  #readCurrencyFromElement(element) {
    const root = element.querySelector("[data-action='edit-currency-root']");
    return {
      pp: toInteger(root?.dataset.currencyPp, 0),
      gp: toInteger(root?.dataset.currencyGp, 0),
      sp: toInteger(root?.dataset.currencySp, 0),
      cp: toInteger(root?.dataset.currencyCp, 0)
    };
  }

  #rememberExpandedPartyMembers(element) {
    const rows = element.querySelectorAll(".rm-party-row[data-actor-id]");
    if (!rows.length) {
      return;
    }

    const expanded = new Set();
    rows.forEach((row) => {
      const actorId = String(row.dataset.actorId ?? "").trim();
      if (actorId && row.open) {
        expanded.add(actorId);
      }
    });
    this.expandedPartyMembers = expanded;
  }

  #restoreFocusToInput(element) {
    const focus = this.focusRestore;
    this.focusRestore = null;
    if (!focus?.action) {
      return;
    }

    const selector = focus.action === "craft-search"
      ? "[data-action='craft-search']"
      : "[data-action='search']";
    const input = element.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.focus();
    const start = Math.max(0, Math.min(toInteger(focus.start, input.value.length), input.value.length));
    const end = Math.max(start, Math.min(toInteger(focus.end, input.value.length), input.value.length));
    input.setSelectionRange(start, end);
  }

  async #notifyAdvanceResult(result) {
    const supplyTotals = result?.cycles?.supplyTotals ?? {};
    const craftCompleted = Number(result?.cycles?.craft?.completedCount ?? 0);
    const shortageParts = [];
    const traderReset = result?.traderReset ?? {};

    if (toNumber(supplyTotals.foodShortage, 0) > 0) {
      shortageParts.push(`еда: нехватка ${roundNumber(supplyTotals.foodShortage, 2)}`);
    }
    if (toNumber(supplyTotals.waterShortage, 0) > 0) {
      shortageParts.push(`вода: нехватка ${roundNumber(supplyTotals.waterShortage, 2)}`);
    }

    const shortageText = shortageParts.length ? ` (${shortageParts.join(", ")})` : "";
    const dateLabel = result?.to?.dateLabel ? ` Текущая дата: ${result.to.dateLabel}.` : "";
    const traderResetText = traderReset?.triggered
      ? ` Ассортименты торговцев обновлены (${toInteger(traderReset.monthResetCount, 0)} мес. переходов).`
      : "";
    const eventActivation = result?.eventActivation ?? {};
    const eventText = (toNumber(eventActivation?.started?.length, 0) > 0 || toNumber(eventActivation?.ended?.length, 0) > 0)
      ? ` Ивенты: старт ${toInteger(eventActivation?.started?.length, 0)}, завершение ${toInteger(eventActivation?.ended?.length, 0)}.`
      : "";
    const message = `Пропущено ${result.daysAdvanced} дн.: еда -${roundNumber(supplyTotals.foodSpent ?? 0, 2)}, вода -${roundNumber(supplyTotals.waterSpent ?? 0, 2)}, завершено крафта ${craftCompleted}.${shortageText}${dateLabel}${traderResetText}${eventText}`;
    this.#setActionFeedback("success", message);
    ui.notifications?.info(message);
  }

  async #promptDowntimeText(title, message, initialValue = "") {
    const DialogClass = globalThis.Dialog;
    if (typeof DialogClass !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const safeTitle = foundry.utils.escapeHTML(title);
      const safeMessage = foundry.utils.escapeHTML(message);
      const safeInitialValue = foundry.utils.escapeHTML(String(initialValue ?? ""));
      const content = `
        <form class="rm-purchase-dialog rm-downtime-text-dialog">
          <div class="rm-field">
            <label>${safeMessage}</label>
            <textarea rows="4" data-field="downtime-text">${safeInitialValue}</textarea>
          </div>
        </form>
      `;

      const dialog = new DialogClass({
        title: safeTitle,
        content,
        buttons: {
          confirm: {
            label: "Сохранить",
            callback: (html) => {
              const root = getDialogRoot(html);
              const input = root?.querySelector("[data-field='downtime-text']");
              settled = true;
              resolve(input?.value ?? "");
            }
          },
          cancel: {
            label: "Отмена",
            callback: () => {
              settled = true;
              resolve(null);
            }
          }
        },
        default: "confirm",
        render: (html) => {
          const root = getDialogRoot(html);
          const input = root?.querySelector("[data-field='downtime-text']");
          if (input instanceof HTMLElement) {
            input.focus();
          }
        },
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog"]
      });

      dialog.render(true);
    });
  }

  async #getDowntimeRequestById(requestId) {
    const snapshot = await this.moduleApi.getDowntimeSnapshot();
    return (snapshot?.requests ?? []).find((request) => cleanText(request?.id) === requestId) ?? null;
  }

  #buildDowntimeTargetActionDialogContent(action = {}, actor = null) {
    const safeDc = foundry.utils.escapeHTML(cleanText(action.dc));
    const choices = buildDowntimeTargetChoices(action, actor);
    const visibleChoiceCount = Math.max(1, choices.length);
    const selectedActionType = getSelectableDowntimeActionType(action.actionType);
    const choiceRows = Array.from({ length: MAX_DOWNTIME_TARGET_ACTIONS }, (_entry, index) =>
      buildDowntimeTargetChoiceRow(choices[index] ?? {}, index, { visible: index < visibleChoiceCount, actor }));
    const checkEffect = action.checkEffect && typeof action.checkEffect === "object" ? action.checkEffect : {};
    const downtimeEffect = action.downtimeEffect && typeof action.downtimeEffect === "object" ? action.downtimeEffect : {};
    const outcomeMode = action.outcomeMode || (cleanText(action.dc) ? "dc" : "freeform");
    const recordMode = action.recordMode || (outcomeMode === "freeform" ? "gm" : "total-success");
    const showDc = ["dc", "dc-sum"].includes(outcomeMode);
    const showThresholds = outcomeMode === "thresholds";
    const checkEffectActive = cleanText(checkEffect.trigger) && checkEffect.trigger !== "none";
    const downtimeEffectActive = cleanText(downtimeEffect.trigger) && downtimeEffect.trigger !== "none";

    return `
      <form class="rm-purchase-dialog rm-downtime-target-action-dialog">
        <nav class="rm-downtime-target-dialog__steps" aria-label="Этапы настройки целевого действия" role="tablist">
          <button type="button" class="is-active" data-action="target-action-step" data-step="basis" title="Тип задачи и общий сценарий." aria-selected="true">1. Основа</button>
          <button type="button" data-action="target-action-step" data-step="variants" title="Один основной вариант и, при необходимости, альтернативы для игрока." aria-selected="false">2. Варианты</button>
          <button type="button" data-action="target-action-step" data-step="outcome" title="Как считать результат броска." aria-selected="false">3. Итог</button>
          <button type="button" data-action="target-action-step" data-step="effects" title="Что запустить после проверки или всего простоя." aria-selected="false">4. Эффекты</button>
        </nav>

        <section class="rm-downtime-target-dialog__section rm-downtime-target-dialog__section--compact" data-step-panel="basis">
          <header>
            <h4>Основа</h4>
          </header>
          <div class="rm-downtime-target-dialog__grid rm-downtime-target-dialog__grid--compact">
            <div class="rm-field">
              <label title="Определяет, какой тип задачи получит игрок.">Тип действия</label>
              <select data-field="target-action-type">${renderSelectOptions(DOWNTIME_ACTION_TYPE_SELECT_OPTIONS, selectedActionType)}</select>
            </div>
          </div>
        </section>

        <section class="rm-downtime-target-dialog__section" data-step-panel="variants" hidden>
          <header>
            <h4 data-target-choice-heading>${buildDowntimeTargetChoiceHeading(visibleChoiceCount)}</h4>
          </header>
          <div class="rm-downtime-target-choice-list">
            ${choiceRows.join("")}
          </div>
          <button
            type="button"
            class="rm-button rm-downtime-add-alternative"
            data-action="target-action-add-alternative"
            title="Добавляет ещё один структурный вариант, который игрок сможет выбрать вместо основного."
            ${visibleChoiceCount >= MAX_DOWNTIME_TARGET_ACTIONS ? "disabled" : ""}
          >
            + Добавить альтернативу
          </button>
        </section>

        <section class="rm-downtime-target-dialog__section" data-step-panel="outcome" hidden>
          <header>
            <h4>Итог</h4>
          </header>
          <div class="rm-downtime-target-dialog__grid">
            <div class="rm-field">
              <label title="Как трактовать результат броска.">Режим</label>
              <select data-field="target-action-outcome-mode">${renderSelectOptions(DOWNTIME_OUTCOME_MODE_OPTIONS, outcomeMode)}</select>
            </div>
            <div class="rm-field" data-outcome-dc-field${showDc ? "" : " hidden"}>
              <label title="Порог сложности для режимов DC и DC + сумма.">DC</label>
              <input type="number" min="0" step="1" value="${safeDc}" data-field="target-action-dc">
            </div>
            <div class="rm-field">
              <label title="Как сохранить результат после броска.">Записать</label>
              <select data-field="target-action-record-mode">${renderSelectOptions(DOWNTIME_RECORD_MODE_OPTIONS, recordMode)}</select>
            </div>
          </div>
          <div class="rm-downtime-thresholds" data-outcome-thresholds-field${showThresholds ? "" : " hidden"}>
            ${buildDowntimeThresholdRows(action.thresholds)}
          </div>
        </section>

        <section class="rm-downtime-target-dialog__section" data-step-panel="effects" hidden>
          <div class="rm-downtime-effect-block">
            <header>
              <h4>Эффект проверки</h4>
            </header>
            <div class="rm-field">
              <label title="Когда запускать эффект этой проверки. Остальные поля появляются только если эффект включён.">Триггер</label>
              <select data-field="target-action-check-effect-trigger">${renderSelectOptions(DOWNTIME_EFFECT_TRIGGER_OPTIONS, checkEffect.trigger || "none")}</select>
            </div>
            <div class="rm-downtime-target-dialog__grid" data-effect-fields="check"${checkEffectActive ? "" : " hidden"}>
              <div class="rm-field">
                <label title="Кто исполняет эффект: Rebreya Main, DAE или Midi-QOL.">Исполнитель</label>
                <select data-field="target-action-check-effect-adapter">${renderSelectOptions(DOWNTIME_EFFECT_ADAPTER_OPTIONS, checkEffect.adapter || "none")}</select>
              </div>
              <div class="rm-field">
                <label title="Что именно сделать после срабатывания эффекта.">Шаблон</label>
                <select data-field="target-action-check-effect-template">${renderSelectOptions(DOWNTIME_CHECK_EFFECT_TEMPLATE_OPTIONS, checkEffect.template || "none")}</select>
              </div>
            </div>
          </div>

          <div class="rm-downtime-effect-block">
            <header>
              <h4>Эффект простоя</h4>
            </header>
            <div class="rm-field">
              <label title="Когда запускать эффект всей заявки. Остальные поля появляются только если эффект включён.">Когда</label>
              <select data-field="target-action-downtime-effect-trigger">${renderSelectOptions(DOWNTIME_DOWNTIME_EFFECT_TRIGGER_OPTIONS, downtimeEffect.trigger || "none")}</select>
            </div>
            <div class="rm-downtime-target-dialog__grid" data-effect-fields="downtime"${downtimeEffectActive ? "" : " hidden"}>
              <div class="rm-field">
                <label title="Кто исполняет эффект простоя.">Исполнитель</label>
                <select data-field="target-action-downtime-effect-adapter">${renderSelectOptions(DOWNTIME_EFFECT_ADAPTER_OPTIONS, downtimeEffect.adapter || "none")}</select>
              </div>
              <div class="rm-field">
                <label title="Что сделать при завершении/решении заявки.">Шаблон</label>
                <select data-field="target-action-downtime-effect-template">${renderSelectOptions(DOWNTIME_REQUEST_EFFECT_TEMPLATE_OPTIONS, downtimeEffect.template || "none")}</select>
              </div>
            </div>
          </div>
        </section>

        <footer class="rm-downtime-target-dialog__footer">
          <button
            type="button"
            class="rm-button rm-button--secondary"
            data-action="target-action-previous"
            title="Вернуться к предыдущему шагу."
            hidden
            disabled
          >Назад</button>
          <span class="rm-downtime-target-dialog__footer-spacer"></span>
          <button
            type="button"
            class="rm-button rm-button--primary"
            data-action="target-action-next"
            title="Перейти к следующему шагу без сохранения."
          >Далее</button>
          <button
            type="button"
            class="rm-button rm-button--primary"
            data-action="target-action-save"
            title="Сохранить целевое действие."
            hidden
            disabled
          >Сохранить</button>
          <button
            type="button"
            class="rm-button rm-button--secondary"
            data-action="target-action-cancel"
            title="Закрыть окно без сохранения изменений."
          >Отмена</button>
        </footer>
      </form>
    `;
  }

  #readDowntimeTargetActionDialog(root, existingAction = {}, existingActions = [], actor = null) {
    const choiceRows = Array.from(root?.querySelectorAll?.("[data-target-choice]:not([hidden])") ?? []);
    const choices = choiceRows.length
      ? choiceRows.map((row) => readDowntimeTargetChoice(row, actor))
      : [normalizeDowntimeTargetChoice(existingAction, {}, actor)];
    const primaryChoice = choices[0] ?? normalizeDowntimeTargetChoice(existingAction);
    const checkEffect = {
      trigger: readFieldValue(root, "target-action-check-effect-trigger") || "none",
      adapter: readFieldValue(root, "target-action-check-effect-adapter") || "none",
      template: readFieldValue(root, "target-action-check-effect-template") || "none"
    };
    const downtimeEffect = {
      trigger: readFieldValue(root, "target-action-downtime-effect-trigger") || "none",
      adapter: readFieldValue(root, "target-action-downtime-effect-adapter") || "none",
      template: readFieldValue(root, "target-action-downtime-effect-template") || "none"
    };
    const outcomeMode = readFieldValue(root, "target-action-outcome-mode") || "dc";
    const thresholds = Array.from(root?.querySelectorAll?.("[data-threshold-row]") ?? [])
      .map((row) => readDowntimeThreshold(row))
      .filter((threshold) => threshold.from || threshold.to || threshold.outcome !== "gm");

    const selectedActionType = getSelectableDowntimeActionType(readFieldValue(root, "target-action-type"));
    const action = {
      id: cleanText(existingAction.id) || buildNextTargetActionId(existingActions),
      label: primaryChoice.label || primaryChoice.targetLabel || "Целевое действие",
      actionType: selectedActionType === "check" && choices.length > 1 ? "choice" : selectedActionType,
      sourceType: primaryChoice.sourceType,
      ability: primaryChoice.ability,
      target: primaryChoice.target,
      targetLabel: primaryChoice.targetLabel,
      outcomeMode,
      dc: toInteger(readFieldValue(root, "target-action-dc"), 0),
      rollMode: primaryChoice.rollMode || "normal",
      recordMode: readFieldValue(root, "target-action-record-mode") || "total-success",
      choices,
      checkEffect,
      downtimeEffect
    };

    if (action.checkEffect.trigger === "none" || action.checkEffect.adapter === "none") {
      delete action.checkEffect;
    }
    if (action.downtimeEffect.trigger === "none" || action.downtimeEffect.adapter === "none") {
      delete action.downtimeEffect;
    }
    if (outcomeMode === "thresholds" && thresholds.length) {
      action.thresholds = thresholds;
    }
    return action;
  }

  #wireDowntimeTargetActionDialog(root, { onSave, onCancel, actor = null, dialog = null } = {}) {
    const rows = Array.from(root?.querySelectorAll?.("[data-target-choice]") ?? []);
    const addButton = root?.querySelector?.("[data-action='target-action-add-alternative']");
    const choiceHeading = root?.querySelector?.("[data-target-choice-heading]");
    const stepButtons = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? []);
    const stepPanels = Array.from(root?.querySelectorAll?.("[data-step-panel]") ?? []);
    const previousButton = root?.querySelector?.("[data-action='target-action-previous']");
    const nextButton = root?.querySelector?.("[data-action='target-action-next']");
    const saveButton = root?.querySelector?.("[data-action='target-action-save']");
    const cancelButton = root?.querySelector?.("[data-action='target-action-cancel']");
    const outcomeSelect = root?.querySelector?.("[data-field='target-action-outcome-mode']");
    const dcField = root?.querySelector?.("[data-outcome-dc-field]");
    const thresholdsField = root?.querySelector?.("[data-outcome-thresholds-field]");
    const checkEffectTrigger = root?.querySelector?.("[data-field='target-action-check-effect-trigger']");
    const downtimeEffectTrigger = root?.querySelector?.("[data-field='target-action-downtime-effect-trigger']");
    const checkEffectFields = root?.querySelector?.("[data-effect-fields='check']");
    const downtimeEffectFields = root?.querySelector?.("[data-effect-fields='downtime']");

    root?.addEventListener?.("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      if (cleanText(event.target?.tagName).toLowerCase() === "textarea") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });

    if (stepButtons.length && stepPanels.length) {
      stepButtons.forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          this.#setDowntimeTargetActionStep(root, button.dataset?.step, dialog);
        });
      });
      this.#setDowntimeTargetActionStep(root, stepButtons.find((button) => button.classList?.contains?.("is-active"))?.dataset?.step ?? "basis", dialog);
    }

    previousButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      this.#moveDowntimeTargetActionStep(root, -1, dialog);
    });
    nextButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      this.#moveDowntimeTargetActionStep(root, 1, dialog);
    });
    saveButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      onSave?.(root);
    });
    cancelButton?.addEventListener?.("click", (event) => {
      event.preventDefault();
      onCancel?.();
    });

    const getVisibleChoiceRows = () => rows.filter((row) => row.hidden !== true);
    const updateChoiceListState = () => {
      const visibleRows = getVisibleChoiceRows();
      if (choiceHeading) {
        choiceHeading.textContent = buildDowntimeTargetChoiceHeading(Math.max(1, visibleRows.length));
      }
      if (addButton) {
        addButton.disabled = visibleRows.length >= Math.min(rows.length, MAX_DOWNTIME_TARGET_ACTIONS);
      }
      rows.forEach((row) => {
        const hidden = row.hidden === true;
        const editButton = row?.querySelector?.("[data-action='target-choice-edit']");
        const removeButton = row?.querySelector?.("[data-action='target-choice-remove']");
        if (editButton) {
          editButton.disabled = hidden;
        }
        if (removeButton) {
          removeButton.disabled = hidden || visibleRows.length <= 1;
        }
      });
    };

    if (addButton && rows.length) {
      addButton.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        const nextRow = rows.find((row) => row.hidden === true);
        if (!nextRow) {
          updateChoiceListState();
          return;
        }
        nextRow.hidden = false;
        nextRow.open = true;
        updateChoiceListState();
      });
    }

    const updateOutcomeFields = () => {
      if (dcField) {
        dcField.hidden = !["dc", "dc-sum"].includes(cleanText(outcomeSelect?.value));
      }
      if (thresholdsField) {
        thresholdsField.hidden = cleanText(outcomeSelect?.value) !== "thresholds";
      }
    };
    outcomeSelect?.addEventListener?.("change", updateOutcomeFields);
    updateOutcomeFields();

    const updateEffectFields = (trigger, fields) => {
      if (fields) {
        fields.hidden = !cleanText(trigger?.value) || trigger.value === "none";
      }
    };
    checkEffectTrigger?.addEventListener?.("change", () => updateEffectFields(checkEffectTrigger, checkEffectFields));
    downtimeEffectTrigger?.addEventListener?.("change", () => updateEffectFields(downtimeEffectTrigger, downtimeEffectFields));
    updateEffectFields(checkEffectTrigger, checkEffectFields);
    updateEffectFields(downtimeEffectTrigger, downtimeEffectFields);

    const updateChoiceSummary = (row) => {
      const summary = row?.querySelector?.("[data-target-choice-summary]");
      if (summary) {
        summary.textContent = buildDowntimeTargetChoiceSummary(readDowntimeTargetChoice(row, actor));
      }
    };
    const bindChoiceFieldListeners = (row) => {
      const targetField = row?.querySelector?.("[data-field='target-choice-target']");
      const abilityField = row?.querySelector?.("[data-field='target-choice-ability']");
      targetField?.addEventListener?.("change", () => syncChoiceTarget(row));
      abilityField?.addEventListener?.("change", () => updateChoiceSummary(row));
    };
    const renderChoiceFields = (row) => {
      const fields = row?.querySelector?.("[data-target-choice-fields]");
      if (!fields) {
        return;
      }
      const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
      const nextChoice = normalizeDowntimeTargetChoice({
        ...readDowntimeTargetChoice(row, actor),
        sourceType
      }, {}, actor);
      fields.innerHTML = buildDowntimeTargetChoiceFields(nextChoice, actor);
      if (row?.dataset) {
        row.dataset.previousTarget = nextChoice.target;
      }
      bindChoiceFieldListeners(row);
      updateChoiceSummary(row);
    };
    const syncChoiceTarget = (row) => {
      const targetField = row?.querySelector?.("[data-field='target-choice-target']");
      const abilityField = row?.querySelector?.("[data-field='target-choice-ability']");
      const sourceType = readFieldValue(row, "target-choice-source-type") || "skill";
      const previousTargetOption = getTargetOption(row?.dataset?.previousTarget, sourceType, actor);
      const targetOption = getTargetOption(targetField?.value, sourceType, actor);
      if (abilityField && targetOption?.ability && (!abilityField.value || abilityField.value === previousTargetOption?.ability)) {
        abilityField.value = targetOption.ability;
      }
      if (row?.dataset) {
        row.dataset.previousTarget = cleanText(targetField?.value);
      }
      updateChoiceSummary(row);
    };
    rows.forEach((row) => {
      if (row?.dataset && !row.dataset.previousTarget) {
        row.dataset.previousTarget = readFieldValue(row, "target-choice-target");
      }
      const sourceField = row?.querySelector?.("[data-field='target-choice-source-type']");
      const editButton = row?.querySelector?.("[data-action='target-choice-edit']");
      const removeButton = row?.querySelector?.("[data-action='target-choice-remove']");
      sourceField?.addEventListener?.("change", () => renderChoiceFields(row));
      editButton?.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        if (row.hidden !== true) {
          row.open = true;
        }
      });
      removeButton?.addEventListener?.("click", (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        if (row.hidden === true || getVisibleChoiceRows().length <= 1) {
          updateChoiceListState();
          return;
        }
        row.hidden = true;
        row.open = false;
        updateChoiceListState();
      });
      bindChoiceFieldListeners(row);
      updateChoiceSummary(row);
    });
    if (rows.length) {
      updateChoiceListState();
    }
  }

  #setDowntimeTargetActionStep(root, step = "basis", dialog = null) {
    const stepOrder = ["basis", "variants", "outcome", "effects"];
    const safeStep = stepOrder.includes(cleanText(step)) ? cleanText(step) : "basis";
    const stepButtons = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? []);
    const stepPanels = Array.from(root?.querySelectorAll?.("[data-step-panel]") ?? []);
    stepButtons.forEach((button) => {
      const active = button.dataset?.step === safeStep;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute?.("aria-selected", active ? "true" : "false");
    });
    stepPanels.forEach((panel) => {
      panel.hidden = panel.dataset?.stepPanel !== safeStep;
    });
    this.#updateDowntimeTargetActionDialogButtons(root, safeStep);
    this.#resizeDowntimeTargetActionDialog(root, safeStep, dialog);
  }

  #moveDowntimeTargetActionStep(root, direction = 1, dialog = null) {
    const stepOrder = ["basis", "variants", "outcome", "effects"];
    const activeButton = Array.from(root?.querySelectorAll?.("[data-action='target-action-step']") ?? [])
      .find((button) => button.classList?.contains?.("is-active") || button.getAttribute?.("aria-selected") === "true");
    const activeStep = cleanText(activeButton?.dataset?.step) || "basis";
    const activeIndex = Math.max(0, stepOrder.indexOf(activeStep));
    const nextIndex = Math.max(0, Math.min(stepOrder.length - 1, activeIndex + direction));
    this.#setDowntimeTargetActionStep(root, stepOrder[nextIndex], dialog);
  }

  #resizeDowntimeTargetActionDialog(root, activeStep = "basis", dialog = null) {
    const dimensions = DOWNTIME_TARGET_DIALOG_DIMENSIONS[activeStep] ?? DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis;
    root?.style?.setProperty?.("--rm-downtime-target-dialog-width", `${dimensions.width}px`);
    root?.style?.setProperty?.("--rm-downtime-target-dialog-height", `${dimensions.height}px`);
    const shell = root?.closest?.(".rm-downtime-target-action-window, .window-app, .application");
    shell?.style?.setProperty?.("--rm-downtime-target-dialog-width", `${dimensions.width}px`);
    shell?.style?.setProperty?.("--rm-downtime-target-dialog-height", `${dimensions.height}px`);
    if (typeof dialog?.setPosition === "function") {
      dialog.setPosition(dimensions);
    }
  }

  #updateDowntimeTargetActionDialogButtons(root, activeStep = "basis") {
    const stepOrder = ["basis", "variants", "outcome", "effects"];
    const index = Math.max(0, stepOrder.indexOf(activeStep));
    const previous = root?.querySelector?.("[data-action='target-action-previous']");
    const next = root?.querySelector?.("[data-action='target-action-next']");
    const confirm = root?.querySelector?.("[data-action='target-action-save']");
    if (previous) {
      previous.hidden = index === 0;
      previous.disabled = index === 0;
    }
    if (next) {
      next.hidden = index >= stepOrder.length - 1;
      next.disabled = index >= stepOrder.length - 1;
    }
    if (confirm) {
      confirm.hidden = index < stepOrder.length - 1;
      confirm.disabled = index < stepOrder.length - 1;
    }
  }

  async #promptDowntimeTargetAction(existingAction = {}, existingActions = [], actor = null) {
    const DialogClass = globalThis.Dialog;
    if (typeof DialogClass !== "function") {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const dialog = new DialogClass({
        title: "Целевое действие",
        content: this.#buildDowntimeTargetActionDialogContent(existingAction, actor),
        buttons: {},
        render: (html) => {
          const root = getDialogRoot(html);
          this.#wireDowntimeTargetActionDialog(root, {
            actor,
            dialog,
            onSave: (dialogRoot) => {
              settled = true;
              resolve(this.#readDowntimeTargetActionDialog(dialogRoot, existingAction, existingActions, actor));
              dialog.close?.();
            },
            onCancel: () => {
              settled = true;
              resolve(null);
              dialog.close?.();
            }
          });
          const firstControl = root?.querySelector("[data-field='target-action-type']");
          if (firstControl instanceof HTMLElement && typeof firstControl.focus === "function") {
            firstControl.focus();
          }
        },
        close: () => {
          if (!settled) {
            resolve(null);
          }
        }
      }, {
        classes: ["rebreya-main", "rebreya-trader-dialog", "rm-downtime-target-action-window"],
        width: DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis.width,
        height: DOWNTIME_TARGET_DIALOG_DIMENSIONS.basis.height
      });

      dialog.render(true);
    });
  }

  async #handleDowntimeGrant(element) {
    const actorId = cleanText(element.querySelector("[data-action='downtime-grant-actor']")?.value) || "all";
    const weeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-grant-weeks']")?.value, 1));
    this.downtimeGrantActorId = actorId;
    this.downtimeGrantWeeks = weeks;

    const actorIds = actorId === "all" ? [] : [actorId];
    await this.moduleApi.grantDowntimeWeeks({
      actorIds,
      weeks,
      reason: ""
    });

    this.#setActionFeedback("success", `Выдано недель простоя: ${weeks}.`);
    ui.notifications?.info(`Выдано недель простоя: ${weeks}.`);
    bringAppToFront(this);
  }

  async #handleDowntimeRevoke(element) {
    const actorId = cleanText(element.querySelector("[data-action='downtime-grant-actor']")?.value) || "all";
    const weeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-grant-weeks']")?.value, 1));
    this.downtimeGrantActorId = actorId;
    this.downtimeGrantWeeks = weeks;

    const actorIds = actorId === "all" ? [] : [actorId];
    const result = await this.moduleApi.revokeDowntimeWeeks({
      actorIds,
      weeks,
      reason: ""
    });

    const revokedActorCount = Array.isArray(result?.actorIds) ? result.actorIds.length : actorIds.length;
    const skippedActorCount = Array.isArray(result?.skippedActorIds) ? result.skippedActorIds.length : 0;
    const totalRevokedWeeks = Math.max(0, toInteger(result?.totalRevokedWeeks, weeks * Math.max(1, revokedActorCount)));
    const message = totalRevokedWeeks > 0
      ? `Забрано недель простоя: ${totalRevokedWeeks}${skippedActorCount ? `, без свободных недель: ${skippedActorCount}` : ""}.`
      : "Свободных недель для списания нет.";
    this.#setActionFeedback("success", message);
    ui.notifications?.info(message);
    bringAppToFront(this);
  }

  async #handleDowntimeClearHistory() {
    const confirmed = await confirmAction(
      "Очистить историю простоя",
      "<p>Удалить все заявки, целевые действия и записи решений мастера? Резерв открытых заявок вернётся в свободные недели.</p>"
    );
    if (!confirmed) {
      return;
    }

    const result = await this.moduleApi.clearDowntimeHistory();
    const removedRequests = toInteger(result?.removedRequests, 0);
    this.#setActionFeedback("success", `История простоя очищена. Удалено заявок: ${removedRequests}.`);
    ui.notifications?.info("История простоя очищена.");
    bringAppToFront(this);
  }

  async #handleDowntimeSubmit(element) {
    this.downtimeRequestActorId = cleanText(element.querySelector("[data-action='downtime-request-actor']")?.value);
    this.downtimeRequestActionId = cleanText(element.querySelector("[data-action='downtime-request-action']")?.value) || "unique";
    this.downtimeRequestWeeks = Math.max(1, toInteger(element.querySelector("[data-action='downtime-request-weeks']")?.value, 1));
    this.downtimeRequestTitle = cleanText(element.querySelector("[data-action='downtime-request-title']")?.value);
    this.downtimeRequestDescription = cleanText(element.querySelector("[data-action='downtime-request-description']")?.value);

    await this.moduleApi.createDowntimeRequest({
      actorId: this.downtimeRequestActorId,
      actionId: this.downtimeRequestActionId,
      title: this.downtimeRequestTitle,
      description: this.downtimeRequestDescription,
      weeks: this.downtimeRequestWeeks
    });

    this.downtimeRequestTitle = "";
    this.downtimeRequestDescription = "";
    this.#setActionFeedback("success", "Заявка на простой отправлена.");
    ui.notifications?.info("Заявка на простой отправлена.");
    bringAppToFront(this);
  }

  async #handleDowntimeStatus(button) {
    const requestId = cleanText(button.dataset.requestId);
    const status = cleanText(button.dataset.status);
    if (!requestId || !status) {
      return;
    }

    let result = "";
    if (shouldPromptDowntimeResult(status)) {
      const prompted = await this.#promptDowntimeText(
        "Результат простоя",
        "Короткий комментарий для заявки:",
        button.dataset.result ?? ""
      );
      if (prompted === null) {
        return;
      }
      result = cleanText(prompted);
    }

    await this.moduleApi.setDowntimeRequestStatus(requestId, status, { result });
    this.#setActionFeedback("success", "Статус заявки обновлён.");
    ui.notifications?.info("Статус заявки обновлён.");
    bringAppToFront(this);
  }

  async #handleDowntimeTargetAction(button) {
    const requestId = cleanText(button.dataset.requestId);
    if (!requestId) {
      return;
    }

    const request = await this.#getDowntimeRequestById(requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    const existingActions = Array.isArray(request.checks) ? request.checks : [];
    const checkId = cleanText(button.dataset.checkId);
    const existingAction = existingActions.find((action) => cleanText(action?.id) === checkId) ?? null;
    if (!existingAction && existingActions.length >= MAX_DOWNTIME_TARGET_ACTIONS) {
      throw new Error(`Можно назначить не больше ${MAX_DOWNTIME_TARGET_ACTIONS} целевых действий.`);
    }

    const actor = getGameActorById(request.actorId);
    const nextAction = await this.#promptDowntimeTargetAction(existingAction ?? {}, existingActions, actor);
    if (!nextAction) {
      return;
    }

    const nextActions = existingAction
      ? existingActions.map((action) => cleanText(action?.id) === checkId ? nextAction : action)
      : [...existingActions, nextAction];
    await this.moduleApi.setDowntimeRequestChecks(requestId, nextActions);
    this.#setActionFeedback("success", "Целевые действия заявки обновлены.");
    ui.notifications?.info("Целевые действия заявки обновлены.");
    bringAppToFront(this);
  }

  async #handleDowntimeRemoveTargetAction(button) {
    const requestId = cleanText(button.dataset.requestId);
    const checkId = cleanText(button.dataset.checkId);
    if (!requestId || !checkId) {
      return;
    }

    const request = await this.#getDowntimeRequestById(requestId);
    if (!request) {
      throw new Error("Downtime request not found.");
    }

    const nextActions = (Array.isArray(request.checks) ? request.checks : [])
      .filter((action) => cleanText(action?.id) !== checkId);
    await this.moduleApi.setDowntimeRequestChecks(requestId, nextActions);
    this.#setActionFeedback("success", "Целевое действие удалено.");
    ui.notifications?.info("Целевое действие удалено.");
    bringAppToFront(this);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    this.#closeContextMenu();
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const listenerOptions = { signal: this.renderListenersAbortController.signal };

    this.#rememberExpandedPartyMembers(element);

    element.querySelectorAll(".rm-party-row[data-actor-id]").forEach((row) => {
      row.addEventListener("toggle", (event) => {
        const actorId = String(event.currentTarget.dataset.actorId ?? "").trim();
        if (!actorId) {
          return;
        }

        if (event.currentTarget.open) {
          this.expandedPartyMembers.add(actorId);
        }
        else {
          this.expandedPartyMembers.delete(actorId);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-item-drag]").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const uuid = event.currentTarget.dataset.itemUuid;
        if (!uuid || !event.dataTransfer) {
          return;
        }

        event.dataTransfer.effectAllowed = "all";
        const payload = JSON.stringify({
          type: "Item",
          uuid
        });

        for (const mimeType of ["text/plain", "text", "application/json", "text/uri-list"]) {
          try {
            event.dataTransfer.setData(mimeType, payload);
          }
          catch (_error) {
            // Ignore unsupported mime types
          }
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='switch-tab']").forEach((button) => {
      button.addEventListener("click", (event) => {
        this.setActiveTab(event.currentTarget.dataset.tab || "inventory");
      }, listenerOptions);
    });

    const bindDowntimeField = (selector, assign) => {
      element.querySelector(selector)?.addEventListener("change", (event) => {
        assign(event.currentTarget.value ?? "");
      }, listenerOptions);
    };
    bindDowntimeField("[data-action='downtime-grant-actor']", (value) => {
      this.downtimeGrantActorId = cleanText(value) || "all";
    });
    bindDowntimeField("[data-action='downtime-grant-weeks']", (value) => {
      this.downtimeGrantWeeks = Math.max(1, toInteger(value, 1));
    });
    bindDowntimeField("[data-action='downtime-request-actor']", (value) => {
      this.downtimeRequestActorId = cleanText(value);
    });
    bindDowntimeField("[data-action='downtime-request-action']", (value) => {
      this.downtimeRequestActionId = cleanText(value) || "unique";
    });
    bindDowntimeField("[data-action='downtime-request-weeks']", (value) => {
      this.downtimeRequestWeeks = Math.max(1, toInteger(value, 1));
    });
    bindDowntimeField("[data-action='downtime-request-title']", (value) => {
      this.downtimeRequestTitle = String(value ?? "");
    });
    bindDowntimeField("[data-action='downtime-request-description']", (value) => {
      this.downtimeRequestDescription = String(value ?? "");
    });

    element.querySelectorAll("[data-action='downtime-grant']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeGrant(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to grant downtime weeks.`, error);
          const message = error.message || "Не удалось выдать недели простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-revoke']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeRevoke(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to revoke downtime weeks.`, error);
          const message = error.message || "Не удалось забрать недели простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-clear-history']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeClearHistory();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to clear downtime history.`, error);
          const message = error.message || "Не удалось очистить историю простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-submit']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await this.#handleDowntimeSubmit(element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to submit downtime request.`, error);
          const message = error.message || "Не удалось отправить заявку на простой.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-status']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeStatus(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update downtime request status.`, error);
          const message = error.message || "Не удалось обновить заявку простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-target-action']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeTargetAction(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update downtime target actions.`, error);
          const message = error.message || "Не удалось обновить целевые действия простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='downtime-remove-target-action']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#handleDowntimeRemoveTargetAction(event.currentTarget);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to remove downtime target action.`, error);
          const message = error.message || "Не удалось удалить целевое действие простоя.";
          this.#setActionFeedback("error", message);
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='open-actor-sheet']")?.addEventListener("click", async () => {
      try {
        const actor = await this.moduleApi.openPartyInventorySheet();
        bringAppToFront(actor?.sheet);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to open party inventory sheet.`, error);
        ui.notifications?.error(error.message || "Не удалось открыть лист партийного инвентаря.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='add-food']")?.addEventListener("click", async () => {
      try {
        await this.#promptSupply("food");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party food.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить запас еды.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='add-water']")?.addEventListener("click", async () => {
      try {
        await this.#promptSupply("water");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party water.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить запас воды.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='search']")?.addEventListener("input", (event) => {
      this.search = event.currentTarget.value ?? "";
      this.focusRestore = {
        action: "search",
        start: event.currentTarget.selectionStart ?? this.search.length,
        end: event.currentTarget.selectionEnd ?? this.search.length
      };
      window.clearTimeout(this.searchRenderTimeout);
      this.searchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='type-filter']")?.addEventListener("change", (event) => {
      this.typeFilter = event.currentTarget.value || "all";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='edit-currency']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const currentCurrency = this.#readCurrencyFromElement(element);
          const action = await promptCurrencyDialog(currentCurrency);
          if (!action) {
            return;
          }

          if (action.values) {
            await this.moduleApi.updatePartyCurrency(action.values);
          }

          if (action.action === "convert") {
            await this.moduleApi.convertPartyCurrency(action.mode || "normalized");
            ui.notifications?.info("Монеты конвертированы.");
          }
          else {
            ui.notifications?.info("Монеты обновлены.");
          }
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to edit currency.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить монеты.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-compendium-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const { sourceType, sourceId, sourceName } = event.currentTarget.dataset;
        const normalizedSourceType = normalizeInventorySourceType(sourceType);
        try {
          const document = await this.moduleApi.openTradeEntry(normalizedSourceType, sourceId, sourceName);
          bringAppToFront(document?.sheet);
          if (!document) {
            ui.notifications?.warn("Не удалось найти запись в компендии.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory compendium entry '${normalizedSourceType}:${sourceId}'.`, error);
          ui.notifications?.error("Не удалось открыть запись предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-item-sheet']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#openItemSheet(event.currentTarget.dataset.itemId);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item sheet.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть лист предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='edit-item-quantity']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const currentQuantity = event.currentTarget.dataset.quantity ?? "0";
        const itemName = event.currentTarget.dataset.itemName ?? "Предмет";

        try {
          const nextQuantity = await promptNumericValue({
            title: `Количество: ${itemName}`,
            label: "Новое количество",
            value: currentQuantity,
            min: 0,
            step: "0.01",
            confirmLabel: "Сохранить"
          });

          if (nextQuantity === null) {
            return;
          }

          await this.moduleApi.updateInventoryItemQuantity(itemId, nextQuantity);
          ui.notifications?.info(`Количество предмета «${itemName}» обновлено.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update inventory item quantity.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить количество предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='break-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const maxQuantity = Math.max(1, toInteger(event.currentTarget.dataset.quantity, 1));
        try {
          const quantity = await promptNumericValue({
            title: `Разбор: ${itemName}`,
            label: `Сколько разбирать (1-${maxQuantity})`,
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Разобрать"
          });
          if (quantity === null) {
            return;
          }

          const safeQuantity = Math.max(1, Math.min(maxQuantity, toInteger(quantity, 1)));
          const result = await this.moduleApi.breakInventoryItemToMaterial(itemId, safeQuantity);
          ui.notifications?.info(`Разобрано: ${result.breakQuantity} x ${result.itemName} -> ${result.materialWeight} фнт. (${result.materialName}).`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to break inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось разобрать предмет.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='delete-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const confirmed = await confirmAction(
          "Удалить предмет",
          `<p>Удалить «${foundry.utils.escapeHTML(itemName)}» из партийного склада?</p>`
        );
        if (!confirmed) {
          return;
        }

        try {
          await this.moduleApi.deleteInventoryItem(itemId);
          ui.notifications?.info(`Предмет «${itemName}» удалён из партийного склада.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to delete inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось удалить предмет.");
        }
      }, listenerOptions);
    });

    const dropzone = element.querySelector("[data-action='inventory-dropzone']");
    if (dropzone) {
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");

        try {
          const dragData = TextEditor.getDragEventData(event);
          await this.moduleApi.importInventoryDrop(dragData);
          ui.notifications?.info("Предмет перенесён в партийный склад.");
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to import dropped inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось перенести предмет в склад.");
        }
      }, listenerOptions);
    }

    const addMemberQueryInput = element.querySelector("[data-action='add-member-query']");
    const syncAddMemberSelection = () => {
      const query = addMemberQueryInput?.value ?? "";
      this.newMemberQuery = query;
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(query);
    };

    addMemberQueryInput?.addEventListener("input", syncAddMemberSelection, listenerOptions);
    addMemberQueryInput?.addEventListener("change", syncAddMemberSelection, listenerOptions);

    element.querySelector("[data-action='add-member']")?.addEventListener("click", async () => {
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(this.newMemberQuery);
      if (!this.selectedNewMemberId) {
        this.#setActionFeedback("warning", "Введите имя участника и выберите актёра из доступных.");
        this.render({ force: true });
        ui.notifications?.warn("Выберите доступного актёра по имени.");
        return;
      }

      try {
        const actorName = this.availablePartyActors.find((actor) => actor.id === this.selectedNewMemberId)?.name ?? "участник";
        await this.moduleApi.addPartyMember(this.selectedNewMemberId);
        this.newMemberQuery = "";
        this.selectedNewMemberId = "";
        this.#setActionFeedback("success", "Участник добавлен в группу.");
        ui.notifications?.info(`Участник «${actorName}» добавлен в группу.`);
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party member.`, error);
        const message = error.message || "Не удалось добавить участника группы.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    const partyDropzone = this.partyMembershipManagedByNativeGroup
      ? null
      : element.querySelector("[data-action='party-dropzone']");
    if (partyDropzone) {
      partyDropzone.addEventListener("dragover", (event) => {
        let dragData = null;
        try {
          dragData = TextEditor.getDragEventData(event);
        }
        catch (_error) {
          return;
        }

        const isActorDrag = dragData?.type === "Actor" || String(dragData?.uuid ?? "").includes("Actor.");
        if (!isActorDrag) {
          return;
        }

        event.preventDefault();
        partyDropzone.classList.add("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("dragleave", () => {
        partyDropzone.classList.remove("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        partyDropzone.classList.remove("is-dragover");

        try {
          const dragData = TextEditor.getDragEventData(event);
          const actorDocument = await this.#resolveDroppedActor(dragData);
          if (!(actorDocument instanceof Actor)) {
            ui.notifications?.warn("Перетащите лист персонажа или актёра.");
            return;
          }

          const isAvailable = this.availablePartyActors.some((actor) => actor.id === actorDocument.id);
          if (!isAvailable) {
            ui.notifications?.warn(`«${actorDocument.name}» нельзя добавить: актёр недоступен или уже в группе.`);
            return;
          }

          const confirmed = await confirmAction(
            "Добавить участника",
            `<p>Добавить «${foundry.utils.escapeHTML(actorDocument.name)}» в группу?</p>`
          );
          if (!confirmed) {
            return;
          }

          await this.moduleApi.addPartyMember(actorDocument.id);
          this.newMemberQuery = "";
          this.selectedNewMemberId = "";
          this.#setActionFeedback("success", `Участник «${actorDocument.name}» добавлен в группу.`);
          ui.notifications?.info(`Участник «${actorDocument.name}» добавлен в группу.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to add party member by drop.`, error);
          ui.notifications?.error(error.message || "Не удалось добавить участника из перетаскивания.");
        }
      }, listenerOptions);
    }

    element.querySelectorAll("[data-action='party-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const fieldName = event.currentTarget.dataset.field;
        const nextValue = event.currentTarget.value ?? "";
        if (!actorId || !fieldName) {
          return;
        }

        const patch = {};
        patch[fieldName] = nextValue;

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMember(actorId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member field '${fieldName}'.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить участника группы.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-energy-current']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const currentEnergy = event.currentTarget.value;
        if (!actorId) {
          return;
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.setPartyMemberEnergy(actorId, currentEnergy);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to set party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить энергию участника.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-restore-energy']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const actorName = event.currentTarget.dataset.actorName ?? "участник";
        if (!actorId) {
          return;
        }

        try {
          const daysValue = await promptNumericValue({
            title: `Восстановить энергию: ${actorName}`,
            label: "На сколько дней восстановить энергию",
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Восстановить"
          });
          if (daysValue === null) {
            return;
          }

          const days = Math.max(1, toInteger(daysValue, 1));
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.restorePartyMemberEnergy(actorId, days);
          ui.notifications?.info(`Энергия ${actorName} восстановлена на ${days} дн.`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to restore party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось восстановить энергию.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-tool-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const toolId = event.currentTarget.dataset.toolId;
        const fieldName = event.currentTarget.dataset.field;
        if (!actorId || !toolId || !fieldName) {
          return;
        }

        const patch = {};
        if (fieldName === "owned" || fieldName === "prof") {
          patch[fieldName] = Boolean(event.currentTarget.checked);
        }
        else {
          patch[fieldName] = toNumber(event.currentTarget.value, 0);
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMemberTool(actorId, toolId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member tool state.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить инструмент участника.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='consume-day']")?.addEventListener("click", async () => {
      try {
        const result = await this.moduleApi.advanceCalendarDays(1, {
          consumeSupplies: true,
          applyEnergy: true,
          processCraft: true
        });
        await this.#notifyAdvanceResult(result);
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to consume party day.`, error);
        const message = error.message || "Не удалось списать день группы.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    element.querySelector("[data-action='craft-search']")?.addEventListener("input", (event) => {
      this.craftSearch = event.currentTarget.value ?? "";
      this.focusRestore = {
        action: "craft-search",
        start: event.currentTarget.selectionStart ?? this.craftSearch.length,
        end: event.currentTarget.selectionEnd ?? this.craftSearch.length
      };
      window.clearTimeout(this.craftSearchRenderTimeout);
      this.craftSearchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='craft-crafter']")?.addEventListener("change", (event) => {
      this.craftCrafterActorId = event.currentTarget.value || "";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='craft-queue']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const gearId = event.currentTarget.dataset.gearId;
        const gearName = event.currentTarget.dataset.gearName ?? "предмет";
        try {
          const quantityValue = await promptNumericValue({
            title: `Крафт: ${gearName}`,
            label: "Сколько единиц поставить в крафт",
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Запустить"
          });
          if (quantityValue === null) {
            return;
          }

          await this.moduleApi.queueCraftTask({
            gearId,
            quantity: Math.max(1, toInteger(quantityValue, 1)),
            crafterActorId: this.craftCrafterActorId
          });
          this.#setActionFeedback("success", `Крафт «${gearName}» добавлен в очередь.`);
          ui.notifications?.info(`Крафт «${gearName}» добавлен в очередь.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to queue craft task.`, error);
          const message = error.message || "Не удалось запустить крафт.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll(".rm-party-row__summary").forEach((summaryNode) => {
      summaryNode.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-party-row[data-actor-id]");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const actorId = String(row.dataset.actorId ?? "").trim();
        const actorName = String(row.dataset.actorName ?? "").trim() || "участника";
        if (!actorId) {
          return;
        }

        const actions = [{
          label: "Открыть лист",
          icon: "fa-solid fa-user",
          callback: () => {
            void this.#openPartyMemberSheet(actorId, actorName);
          }
        }];
        if (this.canManage && !this.partyMembershipManagedByNativeGroup) {
          actions.push({
            label: "Удалить из группы",
            icon: "fa-solid fa-user-minus",
            danger: true,
            callback: async () => {
              await this.#removePartyMember(actorId, actorName, element);
            }
          });
        }

        this.#openContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: actorName,
          actions
        });
      }, listenerOptions);
    });

    element.querySelectorAll(".rm-compact-item").forEach((itemRow) => {
      itemRow.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-compact-item");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const itemName = String(row.dataset.itemName ?? "Предмет").trim() || "Предмет";
        const actionButtons = {
          openCompendium: row.querySelector("[data-action='open-compendium-entry']"),
          openItemSheet: row.querySelector("[data-action='open-item-sheet']"),
          editQuantity: row.querySelector("[data-action='edit-item-quantity']"),
          breakItem: row.querySelector("[data-action='break-item']"),
          deleteItem: row.querySelector("[data-action='delete-item']")
        };

        const actions = [];
        if (actionButtons.openCompendium) {
          actions.push({
            label: "Открыть запись",
            icon: "fa-solid fa-circle-question",
            callback: () => actionButtons.openCompendium.click()
          });
        }
        if (actionButtons.openItemSheet) {
          actions.push({
            label: "Лист предмета",
            icon: "fa-solid fa-file-lines",
            callback: () => actionButtons.openItemSheet.click()
          });
        }
        if (actionButtons.editQuantity) {
          actions.push({
            label: "Изменить количество",
            icon: "fa-solid fa-pen",
            callback: () => actionButtons.editQuantity.click()
          });
        }
        if (actionButtons.breakItem) {
          actions.push({
            label: "Разобрать",
            icon: "fa-solid fa-hammer",
            callback: () => actionButtons.breakItem.click()
          });
        }
        if (actionButtons.deleteItem) {
          actions.push({
            label: "Удалить",
            icon: "fa-solid fa-trash",
            danger: true,
            callback: () => actionButtons.deleteItem.click()
          });
        }

        this.#openContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: itemName,
          actions
        });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='craft-cancel']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const taskId = event.currentTarget.dataset.taskId;
        const taskName = event.currentTarget.dataset.taskName ?? "задача";
        const confirmed = await confirmAction(
          "Отменить крафт",
          `<p>Отменить «${foundry.utils.escapeHTML(taskName)}»?</p>`
        );
        if (!confirmed) {
          return;
        }

        try {
          await this.moduleApi.cancelCraftTask(taskId);
          ui.notifications?.info("Задача крафта отменена.");
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to cancel craft task.`, error);
          ui.notifications?.error(error.message || "Не удалось отменить крафт.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='craft-process-day']")?.addEventListener("click", async () => {
      try {
        const result = await this.moduleApi.processCraftOneDay();
        this.#setActionFeedback("success", `Продвинут день крафта. Завершено: ${result.completedCount}.`);
        ui.notifications?.info(`Продвинут день крафта. Завершено: ${result.completedCount}.`);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to process craft day.`, error);
        const message = error.message || "Не удалось продвинуть крафт на день.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    element.querySelector("[data-action='calendar-set']")?.addEventListener("click", async () => {
      try {
        const year = toInteger(element.querySelector("[data-field='calendar-year']")?.value, 1);
        const month = toInteger(element.querySelector("[data-field='calendar-month']")?.value, 1);
        const day = toInteger(element.querySelector("[data-field='calendar-day']")?.value, 1);
        await this.moduleApi.setCalendarDate(year, month, day);
        ui.notifications?.info("Календарь обновлён.");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to set calendar date.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить дату календаря.");
      }
    }, listenerOptions);

    element.querySelectorAll("[data-action='calendar-pick-day']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          const year = toInteger(event.currentTarget.dataset.year, 1);
          const month = toInteger(event.currentTarget.dataset.month, 1);
          const day = toInteger(event.currentTarget.dataset.day, 1);
          await this.moduleApi.setCalendarDate(year, month, day);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to pick calendar day.`, error);
          ui.notifications?.error(error.message || "Не удалось выбрать дату календаря.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='calendar-advance']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const unit = event.currentTarget.dataset.unit || "day";
        const value = Math.max(1, toInteger(event.currentTarget.dataset.value, 1));
        try {
          let result = null;
          if (unit === "week") {
            result = await this.moduleApi.advanceCalendarWeeks(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }
          else if (unit === "month") {
            result = await this.moduleApi.advanceCalendarMonths(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }
          else {
            result = await this.moduleApi.advanceCalendarDays(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }

          await this.#notifyAdvanceResult(result);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to advance calendar.`, error);
          const message = error.message || "Не удалось продвинуть календарь.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    this.#restoreFocusToInput(element);
  }

  async _preClose(options) {
    this.#closeContextMenu();
    window.clearTimeout(this.searchRenderTimeout);
    window.clearTimeout(this.craftSearchRenderTimeout);
    window.clearTimeout(this.actionFeedbackTimeout);
    this.searchRenderTimeout = null;
    this.craftSearchRenderTimeout = null;
    this.actionFeedbackTimeout = null;
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    return super._preClose ? super._preClose(options) : undefined;
  }
}

