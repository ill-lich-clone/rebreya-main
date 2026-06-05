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

function cleanText(value) {
  return String(value ?? "").trim();
}

function toInteger(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
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
  const dc = cleanText(check.dc);
  const outcomeMode = cleanText(check.outcomeMode) || (dc ? "dc" : "freeform");
  const numericDc = Number(dc.replace(/^dc\s*/iu, ""));
  const shouldShowDc = ["dc", "dc-sum"].includes(outcomeMode)
    && dc
    && (!Number.isFinite(numericDc) || numericDc > 0);
  const ability = cleanText(check.ability);
  return [
    cleanText(check.label),
    shouldShowDc ? `DC ${dc.replace(/^dc\s*/iu, "")}` : "",
    ABILITY_LABELS[ability] ?? ability
  ].filter(Boolean).join(" | ");
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

function buildRollTarget(check = {}, choice = {}, { canRollRequest = false, choiceIndex = 0, hasChoices = false } = {}) {
  const sourceType = cleanText(choice.sourceType) || cleanText(check.sourceType) || "skill";
  const target = cleanText(choice.target) || cleanText(check.target);
  const ability = normalizeRollAbility(choice.ability) || normalizeRollAbility(check.ability) || normalizeRollAbility(target);
  const outcomeMode = cleanText(check.outcomeMode) || (cleanText(check.dc) ? "dc" : "freeform");
  const label = cleanText(choice.targetLabel)
    || cleanText(choice.label)
    || cleanText(check.targetLabel)
    || cleanText(check.label)
    || target
    || ability;
  const dc = toInteger(check.dc, 0);
  const canRoll = Boolean(canRollRequest)
    && ROLLABLE_SOURCE_TYPES.has(sourceType)
    && Boolean(sourceType === "ability" ? ability : (target || ability));

  return {
    choiceIndex,
    sourceType,
    ability,
    target,
    label,
    dc,
    outcomeMode,
    canRoll,
    buttonLabel: hasChoices ? label : "Кинуть",
    rollTitle: canRoll
      ? `Кинуть ${label || "проверку"}`
      : "Этот тип целевого действия пока не бросается из чарника"
  };
}

function buildRollTargets(check = {}, { canRollRequest = false } = {}) {
  const choices = Array.isArray(check.choices) ? check.choices : [];
  if (choices.length) {
    return choices.map((choice, index) => buildRollTarget(check, choice, {
      canRollRequest,
      choiceIndex: index,
      hasChoices: choices.length > 1
    }));
  }

  return [buildRollTarget(check, {}, { canRollRequest, choiceIndex: 0, hasChoices: false })];
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
      canRollRequest: canRollRequest && !resultLabel
    });
    return {
      ...check,
      summary: buildCheckSummary(check),
      resultLabel,
      hasResult: Boolean(resultLabel),
      rollTargets,
      hasRollTargets: rollTargets.some((target) => target.canRoll)
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
    hasChecks: checks.length > 0,
    hasResult: Boolean(cleanText(request.result))
  };
}

function buildEmptyContext(actor, {
  warning = "",
  formState = {}
} = {}) {
  const actionId = cleanText(formState.actionId) || "unique";
  const weeks = normalizeWeeks(formState.weeks, 1);
  return {
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    hasGroup: false,
    warning: cleanText(warning),
    canSubmit: false,
    balance: buildBalance(),
    actionOptions: [],
    selectedActionLabel: "Выбрать простой",
    requests: [],
    emptyRequests: true,
    form: {
      actionId,
      weeks,
      title: cleanText(formState.title),
      description: cleanText(formState.description)
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
    let actionId = cleanText(formState.actionId) || "unique";
    if (actionCatalog.length && !actionCatalog.some((action) => action.id === actionId)) {
      actionId = actionCatalog[0].id;
    }

    const weeks = normalizeWeeks(formState.weeks, 1);
    const balance = buildBalance(member.balance ?? member);
    const canSubmit = Boolean(member.canSubmit && snapshot?.canSubmit);
    const submitDisabled = !canSubmit || !actionCatalog.length || balance.availableWeeks < weeks;
    const submitDisabledReason = submitDisabled
      ? (!canSubmit
        ? "У вас нет прав отправлять заявки за этого персонажа."
        : (!actionCatalog.length
          ? "Нет доступных действий простоя."
          : "Недостаточно свободных недель простоя."))
      : "";
    const requests = (Array.isArray(snapshot?.requests) ? snapshot.requests : [])
      .filter((request) => request?.actorId === actor.id)
      .map((request) => mapRequest(request, { groupId: snapshot.groupId }));

    const selectedAction = actionCatalog.find((action) => action.id === actionId) ?? null;
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
      selectedActionLabel: cleanText(selectedAction?.label) || "Выбрать простой",
      requests,
      emptyRequests: requests.length === 0,
      form: {
        actionId,
        weeks,
        title: cleanText(formState.title),
        description: cleanText(formState.description)
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

    return this.moduleApi.createDowntimeRequest({
      groupId,
      actorId: actor.id,
      actionId: cleanText(payload.actionId) || "unique",
      weeks: normalizeWeeks(payload.weeks, 1),
      title: cleanText(payload.title),
      description: cleanText(payload.description)
    });
  }
}
