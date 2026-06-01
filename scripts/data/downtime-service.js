const ACTION_CATALOG = Object.freeze([
  { id: "craft", label: "Craft" },
  { id: "firearm", label: "Firearm" },
  { id: "magicItem", label: "Magic item" },
  { id: "profession", label: "Profession" },
  { id: "rest", label: "Rest" },
  { id: "research", label: "Research" },
  { id: "training", label: "Training" },
  { id: "gambling", label: "Gambling" },
  { id: "tournament", label: "Tournament" },
  { id: "carouse", label: "Carouse" },
  { id: "buyMagicItem", label: "Buy magic item" },
  { id: "changeSubclass", label: "Change subclass" },
  { id: "alchemy", label: "Alchemy" },
  { id: "longProject", label: "Long project" },
  { id: "construct", label: "Construct" },
  { id: "unique", label: "Unique request" }
]);

const ACTION_BY_ID = new Map(ACTION_CATALOG.map((action) => [action.id, action]));
const OPEN_RESERVED_STATUSES = new Set(["pending", "approved"]);
const RELEASED_STATUSES = new Set(["rejected", "returned"]);
const REQUEST_STATUSES = new Set(["pending", "approved", "returned", "rejected", "completed"]);

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

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toWeeks(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
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
  const checkId = cleanId(value.id);
  return {
    id: checkId || `check-${Date.now()}`,
    label: cleanString(value.label) || cleanString(value.title) || "Check",
    dc: toWeeks(value.dc),
    ability: cleanString(value.ability),
    result: value.result === undefined ? null : clone(value.result)
  };
}

function normalizeRequest(value = {}) {
  const actionId = ACTION_BY_ID.has(cleanId(value.actionId)) ? cleanId(value.actionId) : "unique";
  const action = ACTION_BY_ID.get(actionId) ?? ACTION_BY_ID.get("unique");
  const status = REQUEST_STATUSES.has(cleanId(value.status)) ? cleanId(value.status) : "pending";
  return {
    id: cleanId(value.id),
    actorId: cleanId(value.actorId),
    actorName: cleanString(value.actorName),
    actionId,
    actionLabel: cleanString(value.actionLabel) || action.label,
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

  return {
    balancesByActorId,
    requests: asArray(source.requests).map((request) => normalizeRequest(request)).filter((request) => request.id),
    checks: asArray(source.checks).map((check) => normalizeCheck(check)),
    history: clone(asArray(source.history)),
    counter: toWeeks(source.counter)
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
    return ACTION_CATALOG.map((action) => ({ ...action }));
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
      actionCatalog: this.getActionCatalog(),
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

  async createRequest({
    actorId = "",
    actionId = "unique",
    title = "",
    description = "",
    weeks = 1
  } = {}) {
    const context = this.#resolveContext();
    const actor = this.#requireCurrentMemberActor(context, actorId);
    this.#assertCanSubmitForActor(actor, context);
    const safeWeeks = this.#requirePositiveWeeks(weeks);
    const resolvedActionId = ACTION_BY_ID.has(cleanId(actionId)) ? cleanId(actionId) : "unique";
    const action = ACTION_BY_ID.get(resolvedActionId) ?? ACTION_BY_ID.get("unique");
    const safeTitle = cleanString(title) || action.label;
    const userId = cleanId(getCurrentUser()?.id);

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
        checks: [],
        result: "",
        ...audit,
        submittedByUserId: userId,
        reviewedByUserId: ""
      };
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
      const balance = normalizeBalance(state.balancesByActorId[request.actorId] ?? buildDefaultBalance());
      this.#applyStatusAccounting(balance, request.status, nextStatus, request.weeks);
      request.status = nextStatus;
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
      request.checks = asArray(checks).map((check, index) => {
        const normalized = normalizeCheck({
          id: cleanId(check?.id) || `check-${index + 1}`,
          ...asObject(check)
        });
        return normalized;
      });
      request.reviewedByUserId = cleanId(getCurrentUser()?.id);
      request.updatedAt = Date.now();
      return clone(request);
    });
  }

  async recordCheckResult(requestId, checkId, result = {}) {
    const context = this.#resolveContext();
    const safeRequestId = cleanId(requestId);
    const safeCheckId = cleanId(checkId);

    return this.#writeGroupState(context, (state) => {
      const request = this.#findRequest(state, safeRequestId);
      const actor = this.#requireCurrentMemberActor(context, request.actorId);
      if (!this.#canManage(context) && !this.#canSubmitForActor(actor, context)) {
        throw new Error("Players can record results only for an owned character.");
      }

      const check = request.checks.find((entry) => entry.id === safeCheckId);
      if (!check) {
        throw new Error("Downtime check not found.");
      }

      check.result = {
        ...clone(asObject(result)),
        recordedByUserId: cleanId(getCurrentUser()?.id),
        recordedAt: Date.now()
      };
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

  #applyStatusAccounting(balance, currentStatus, nextStatus, weeks) {
    if (currentStatus === nextStatus) {
      return;
    }

    const safeWeeks = Math.max(1, toWeeks(weeks, 1));
    if (OPEN_RESERVED_STATUSES.has(currentStatus) && RELEASED_STATUSES.has(nextStatus)) {
      balance.reservedWeeks = Math.max(0, balance.reservedWeeks - safeWeeks);
      balance.availableWeeks += safeWeeks;
      return;
    }

    if (OPEN_RESERVED_STATUSES.has(currentStatus) && nextStatus === "completed") {
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
      if (balance.availableWeeks < safeWeeks) {
        throw new Error("Not enough available downtime weeks.");
      }

      balance.availableWeeks -= safeWeeks;
      balance.spentWeeks += safeWeeks;
    }
  }
}
