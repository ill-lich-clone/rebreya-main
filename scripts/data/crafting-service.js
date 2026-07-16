import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

import { DurableMutationJournal } from "../application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { processCraftProjectWorkday } from "./craft-project-processor.js";
import {
  buildCraftBatch,
  calculateMaterialReservation,
  resolveDailyProgressGold,
  validateCraftEligibility
} from "./crafting-rules.js";
import { buildBaseRawMaterialIndex } from "./material-catalog-sync.js";

const CRAFT_STATE_VERSION = 2;
const PROJECT_STATUSES = new Set([
  "draft",
  "submitted",
  "approved",
  "in-progress",
  "completed",
  "cancelled"
]);
const PROJECT_OPERATIONAL_STATUSES = new Set(["active", "blocked", "paused", "inactive"]);
const LEGACY_OPERATIONAL_STATUSES = new Set(["active", "blocked", "paused"]);
const PROJECT_PROFILES = new Set(["mundane", "firearm", "legacy"]);
const CITY_ISO_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);
const OWNED_WORKSHOP_ISO_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5, 6, 7]);

function cloneValue(value) {
  return value == null ? value : foundry.utils.deepClone(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNonnegativeNumber(value, fallback = 0) {
  return Math.max(0, toFiniteNumber(value, fallback));
}

function roundFive(value) {
  return Math.round((toFiniteNumber(value, 0) + Number.EPSILON) * 100000) / 100000;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function createMutationId(prefix, requestedId = "") {
  const explicit = cleanText(requestedId);
  if (explicit) {
    return explicit;
  }
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function requireMutationId(value, operation) {
  const mutationId = cleanText(value);
  if (!mutationId) {
    throw new Error(`${operation} requires a stable nonempty mutation ID.`);
  }
  return mutationId;
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableSignature(value) {
  const source = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `craft-quote-v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeCraftMutationJournal(value) {
  return {
    version: 1,
    records: asArray(value?.records).map((record) => cloneValue(record))
  };
}

export function buildDefaultCraftStateV2() {
  return {
    version: CRAFT_STATE_VERSION,
    counter: 0,
    projects: [],
    audit: [],
    migrationAudit: []
  };
}

function normalizeWorkdaySelection(value, { hoursPerDay = 8, ownedWorkshop = false } = {}) {
  const source = asObject(value);
  const hours = Math.max(8, Math.min(16, Math.floor(toFiniteNumber(
    source.hoursPerDay,
    hoursPerDay
  ))));
  const fallbackWeekdays = ownedWorkshop
    ? OWNED_WORKSHOP_ISO_WEEKDAYS
    : CITY_ISO_WEEKDAYS;
  const sourceWeekdays = asArray(source.isoWeekdays)
    .map((weekday) => Math.floor(toFiniteNumber(weekday, 0)))
    .filter((weekday) => weekday >= 1 && weekday <= 7);
  return {
    hoursPerDay: hours,
    isoWeekdays: [...new Set(sourceWeekdays.length ? sourceWeekdays : fallbackWeekdays)]
  };
}

function normalizeReservation(value = {}) {
  const source = asObject(value);
  const predominantReserved = roundFive(toNonnegativeNumber(
    source.predominantMaterialLbReserved ?? source.predominantMaterialLb,
    0
  ));
  const baseRawReserved = roundFive(toNonnegativeNumber(
    source.baseRawQuantityReserved
      ?? source.baseRawMaterialQuantityReserved
      ?? source.baseRawQuantity,
    0
  ));
  return {
    ...cloneValue(source),
    predominantMaterialId: cleanText(source.predominantMaterialId),
    predominantMaterialLbReserved: predominantReserved,
    predominantMaterialLbSpent: roundFive(toNonnegativeNumber(
      source.predominantMaterialLbSpent,
      0
    )),
    baseRawMaterialId: cleanText(source.baseRawMaterialId),
    baseRawQuantityReserved: baseRawReserved,
    baseRawQuantitySpent: roundFive(toNonnegativeNumber(
      source.baseRawQuantitySpent ?? source.baseRawMaterialQuantitySpent,
      0
    )),
    baseRawWeightLbReserved: roundFive(toNonnegativeNumber(source.baseRawWeightLbReserved, 0)),
    baseRawWeightLbSpent: roundFive(toNonnegativeNumber(source.baseRawWeightLbSpent, 0)),
    receipts: asArray(source.receipts).map((receipt) => cloneValue(receipt))
  };
}

function normalizeProjectOutput(value = {}) {
  const source = asObject(value);
  return {
    ...cloneValue(source),
    sourceType: "gear",
    sourceId: cleanText(source.sourceId ?? source.gearId ?? source.id),
    name: cleanText(source.name),
    quantity: Math.max(1, Math.floor(toFiniteNumber(source.quantity, 1))),
    unitPriceGold: roundFive(toNonnegativeNumber(source.unitPriceGold ?? source.priceGold, 0)),
    unitWeightLb: roundFive(toNonnegativeNumber(source.unitWeightLb ?? source.weightLb, 0))
  };
}

function normalizeProject(value = {}, groupId = "") {
  const source = asObject(value);
  const ownedWorkshop = source.ownedWorkshop === true;
  const hoursPerDay = Math.max(8, Math.min(16, Math.floor(toFiniteNumber(source.hoursPerDay, 8))));
  const rawStatus = cleanText(source.status);
  const processedWorkdays = asArray(source.processedWorkdays);
  const hasProgress = processedWorkdays.length > 0
    || toNonnegativeNumber(source.progressGold ?? source.progress, 0) > 0;
  const status = PROJECT_STATUSES.has(rawStatus)
    ? rawStatus
    : rawStatus === "completed" || rawStatus === "cancelled"
      ? rawStatus
      : LEGACY_OPERATIONAL_STATUSES.has(rawStatus)
        ? (hasProgress ? "in-progress" : "approved")
        : "draft";
  const operationalStatus = ["completed", "cancelled"].includes(status)
    ? "inactive"
    : PROJECT_OPERATIONAL_STATUSES.has(cleanText(source.operationalStatus))
      ? cleanText(source.operationalStatus)
      : LEGACY_OPERATIONAL_STATUSES.has(rawStatus)
        ? rawStatus
        : ["draft", "submitted"].includes(status)
          ? "paused"
          : "active";
  const profile = PROJECT_PROFILES.has(cleanText(source.profile)) ? cleanText(source.profile) : "legacy";
  const reconciliation = asObject(source.reconciliation);
  const reservation = normalizeReservation(source.reservation);
  const reservationConflict = (
    reservation.predominantMaterialLbSpent > reservation.predominantMaterialLbReserved
    || reservation.baseRawQuantitySpent > reservation.baseRawQuantityReserved
  );
  const completedAt = source.completedAt == null ? null : toFiniteNumber(source.completedAt, 0);
  return {
    ...cloneValue(source),
    id: cleanText(source.id),
    groupId: cleanText(groupId),
    requestId: cleanText(source.requestId) || null,
    crafterActorId: cleanText(source.crafterActorId),
    status,
    operationalStatus,
    profile,
    outputs: asArray(source.outputs).map((output) => normalizeProjectOutput(output)),
    targetGold: roundFive(toNonnegativeNumber(source.targetGold ?? source.progressTarget, 0)),
    progressGold: roundFive(toNonnegativeNumber(source.progressGold ?? source.progress, 0)),
    hoursPerDay,
    ownedWorkshop,
    workdaySelection: normalizeWorkdaySelection(source.workdaySelection, {
      hoursPerDay,
      ownedWorkshop
    }),
    requiredRank: Math.max(0, Math.floor(toFiniteNumber(source.requiredRank, 0))),
    requiredToolId: cleanText(source.requiredToolId),
    requiredToolRank: Math.max(0, Math.floor(toFiniteNumber(
      source.requiredToolRank,
      source.requiredRank ?? 0
    ))),
    workshopApproval: cloneValue(asObject(source.workshopApproval)),
    reservation,
    processedWorkdays: processedWorkdays.map((entry) => cloneValue(entry)),
    revision: Math.max(0, Math.floor(toFiniteNumber(source.revision, 0))),
    audit: asArray(source.audit).map((entry) => cloneValue(entry)),
    reconciliation: {
      ...cloneValue(reconciliation),
      required: reconciliation.required === true || reservationConflict,
      ...(reservationConflict && !cleanText(reconciliation.reason)
        ? { reason: "reservation-spend-exceeds-reserved" }
        : {})
    },
    createdAt: toFiniteNumber(source.createdAt, 0),
    updatedAt: toFiniteNumber(source.updatedAt, 0),
    completedAt
  };
}

function getMaximumProjectCounter(projects) {
  return asArray(projects).reduce((maximum, project) => {
    const match = /^craft-project-(\d+)$/u.exec(cleanText(project?.id));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
}

function legacyProjectId(task, index, usedIds) {
  const taskId = cleanText(task?.id) || `task-${index + 1}`;
  let candidate = `legacy-${taskId}`;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `legacy-${taskId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function migrateLegacyCraftState(value, { groupId = "", now = Date.now(), sourceScope = "group" } = {}) {
  const source = asObject(value);
  const usedIds = new Set();
  const projects = asArray(source.queue).map((task, index) => {
    const materialReserved = roundFive(toNonnegativeNumber(task?.materialSpentLb, 0));
    const quantity = Math.max(1, Math.floor(toFiniteNumber(task?.quantity, 1)));
    const targetGold = roundFive(toNonnegativeNumber(task?.progressTarget, 0));
    const projectId = legacyProjectId(task, index, usedIds);
    const migrationMutationId = `migration:${groupId}:${cleanText(task?.id) || index + 1}`;
    return normalizeProject({
      id: projectId,
      groupId,
      requestId: null,
      crafterActorId: cleanText(task?.crafterActorId),
      crafterName: cleanText(task?.crafterName),
      status: "approved",
      operationalStatus: "paused",
      profile: "legacy",
      outputs: [{
        sourceType: "gear",
        sourceId: cleanText(task?.gearId),
        name: cleanText(task?.gearName),
        quantity,
        unitPriceGold: quantity > 0 ? roundFive(targetGold / quantity) : 0,
        unitWeightLb: 0
      }],
      targetGold,
      progressGold: roundFive(toNonnegativeNumber(task?.progress, 0)),
      hoursPerDay: 8,
      ownedWorkshop: false,
      requiredRank: 0,
      requiredToolId: cleanText(task?.requiredToolId),
      requiredToolRank: 0,
      workshopApproval: {},
      reservation: {
        predominantMaterialId: cleanText(task?.materialId),
        predominantMaterialLbReserved: materialReserved,
        predominantMaterialLbSpent: 0,
        baseRawMaterialId: "",
        baseRawQuantityReserved: 0,
        baseRawQuantitySpent: 0,
        baseRawWeightLbReserved: 0,
        baseRawWeightLbSpent: 0,
        receipts: materialReserved > 0 ? [{
          kind: "legacy-debit",
          mutationId: migrationMutationId,
          sourceType: "material",
          sourceId: cleanText(task?.materialId),
          quantity: materialReserved
        }] : []
      },
      processedWorkdays: [],
      revision: 1,
      audit: [{
        id: migrationMutationId,
        type: "legacy-migrated",
        mutationId: migrationMutationId,
        fromStatus: "submitted",
        toStatus: "approved",
        userId: cleanText(globalThis.game?.user?.id),
        createdAt: now
      }],
      reconciliation: { required: false },
      legacySource: {
        taskId: cleanText(task?.id),
        materialName: cleanText(task?.materialName),
        progressPerDay: toNonnegativeNumber(task?.progressPerDay, 0)
      },
      createdAt: toFiniteNumber(task?.createdAt, now),
      updatedAt: toFiniteNumber(task?.updatedAt, now),
      completedAt: null
    }, groupId);
  });
  const migrationId = `craft-state-v1-to-v2:${groupId}`;
  const auditEntry = {
    id: migrationId,
    type: "state-migrated",
    fromVersion: 1,
    toVersion: CRAFT_STATE_VERSION,
    sourceScope,
    projectIds: projects.map((project) => project.id),
    sourceSnapshot: cloneValue(source),
    createdAt: now
  };
  return {
    version: CRAFT_STATE_VERSION,
    counter: Math.max(
      Math.max(0, Math.floor(toFiniteNumber(source.counter, 0))),
      getMaximumProjectCounter(projects)
    ),
    projects,
    audit: [cloneValue(auditEntry)],
    migrationAudit: [auditEntry]
  };
}

export function normalizeCraftStateV2(value = {}, {
  groupId = "",
  legacyState = null,
  now = Date.now()
} = {}) {
  const source = asObject(value);
  if (Number(source.version) === CRAFT_STATE_VERSION || Array.isArray(source.projects)) {
    const projects = asArray(source.projects)
      .map((project) => normalizeProject(project, groupId))
      .filter((project) => project.id);
    return {
      version: CRAFT_STATE_VERSION,
      counter: Math.max(
        Math.max(0, Math.floor(toFiniteNumber(source.counter, 0))),
        getMaximumProjectCounter(projects)
      ),
      projects,
      audit: asArray(source.audit).map((entry) => cloneValue(entry)),
      migrationAudit: asArray(source.migrationAudit).map((entry) => cloneValue(entry))
    };
  }

  if (Array.isArray(source.queue)) {
    return migrateLegacyCraftState(source, { groupId, now, sourceScope: "group" });
  }
  const legacy = asObject(legacyState);
  if (Array.isArray(legacy.queue)) {
    return migrateLegacyCraftState(legacy, { groupId, now, sourceScope: "world-setting" });
  }
  return buildDefaultCraftStateV2();
}

function buildAuditEntry(type, {
  mutationId,
  fromStatus = null,
  toStatus = null,
  reason = "",
  details = null,
  now = Date.now()
} = {}) {
  return {
    id: cleanText(mutationId) || createMutationId(`craft-audit-${type}`),
    type,
    mutationId: cleanText(mutationId),
    fromStatus,
    toStatus,
    userId: cleanText(globalThis.game?.user?.id),
    createdAt: now,
    ...(cleanText(reason) ? { reason: cleanText(reason) } : {}),
    ...(details == null ? {} : { details: cloneValue(details) })
  };
}

function buildWorkdaySelection(hoursPerDay, ownedWorkshop) {
  return {
    hoursPerDay,
    isoWeekdays: cloneValue(ownedWorkshop
      ? OWNED_WORKSHOP_ISO_WEEKDAYS
      : CITY_ISO_WEEKDAYS)
  };
}

const APPROVAL_COMMAND_KEYS = new Set([
  "requestId",
  "mutationId",
  "expectedQuoteSignature",
  "quoteSignature"
]);

function normalizeApprovalInput(value = {}, { strict = false } = {}) {
  const source = asObject(value);
  if (strict) {
    const selectionKeys = Object.keys(source).filter((key) => !APPROVAL_COMMAND_KEYS.has(key));
    if (selectionKeys.length) {
      throw codedError(
        "invalid-craft-approval-command",
        `Craft approval cannot override submitted selections: ${selectionKeys.join(", ")}.`
      );
    }
  }
  return {
    requestId: cleanText(source.requestId),
    expectedQuoteSignature: cleanText(
      source.expectedQuoteSignature
        ?? source.quoteSignature
    )
  };
}

function normalizeWorkdayInput(value = {}) {
  const source = asObject(value);
  return {
    isoDate: cleanText(source.isoDate),
    transitionId: cleanText(source.transitionId),
    mutationId: cleanText(source.mutationId)
  };
}

function projectReservationRemaining(project) {
  const reservation = normalizeReservation(project?.reservation);
  return {
    predominantMaterialId: reservation.predominantMaterialId,
    predominantMaterialLb: roundFive(Math.max(
      0,
      reservation.predominantMaterialLbReserved - reservation.predominantMaterialLbSpent
    )),
    baseRawMaterialId: reservation.baseRawMaterialId,
    baseRawQuantity: roundFive(Math.max(
      0,
      reservation.baseRawQuantityReserved - reservation.baseRawQuantitySpent
    ))
  };
}

function projectMatchesIdentity(left, right) {
  return cleanText(left?.id) === cleanText(right?.id)
    && cleanText(left?.groupId) === cleanText(right?.groupId)
    && cleanText(left?.requestId) === cleanText(right?.requestId)
    && cleanText(left?.quoteSignature) === cleanText(right?.quoteSignature);
}

function outputDocumentIdentity(value) {
  return cleanText(value?.id ?? value?._id ?? value?.itemId);
}

export class CraftingService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this.mutationCoordinator = moduleApi.worldMutationCoordinator ?? new WorldMutationCoordinator();
    this.mutationJournal = new DurableMutationJournal({
      readState: () => game.settings.get(MODULE_ID, SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL),
      writeState: (state) => {
        this.#assertCanManage();
        return game.settings.set(MODULE_ID, SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL, state);
      },
      normalizeState: normalizeCraftMutationJournal
    });
  }

  #resolveContext() {
    const context = this.moduleApi.groupContextService?.resolveForCurrentUser?.();
    if (!context?.groupId) {
      throw new Error("Crafting requires an active group context.");
    }
    return context;
  }

  #assertCanManage() {
    const canManageInventory = this.moduleApi.inventoryService?.canManagePartyInventory?.() === true;
    if (!isActiveGmClient(globalThis.game) || !canManageInventory) {
      throw new Error("Only the active GM who can manage the group inventory may mutate craft projects.");
    }
  }

  #canManage() {
    return isActiveGmClient(globalThis.game)
      && this.moduleApi.inventoryService?.canManagePartyInventory?.() === true;
  }

  #assertCapturedExecutionContext(groupId, userId) {
    this.#assertCanManage();
    const capturedGroupId = cleanText(groupId);
    if (!capturedGroupId || cleanText(globalThis.game?.user?.id) !== cleanText(userId)) {
      throw codedError("reconciliation-required", "Craft execution authority changed during mutation.");
    }
    const currentContext = this.moduleApi.groupContextService?.resolveForCurrentUser?.();
    if (cleanText(currentContext?.groupId) !== capturedGroupId) {
      throw codedError("reconciliation-required", "The active craft group changed during mutation.");
    }
    return true;
  }

  #inventoryExecutionOptions(groupId) {
    const capturedGroupId = cleanText(groupId);
    const capturedUserId = cleanText(globalThis.game?.user?.id);
    const assertExecutionContext = () => this.#assertCapturedExecutionContext(
      capturedGroupId,
      capturedUserId
    );
    assertExecutionContext();
    return Object.freeze({
      groupId: capturedGroupId,
      guard: assertExecutionContext,
      assertExecutionContext
    });
  }

  #legacyCraftState() {
    return cloneValue(game.settings.get(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE) ?? {});
  }

  #legacyMigrationTargetGroupId(fallbackGroupId) {
    const groupIds = asArray(globalThis.game?.actors?.contents)
      .filter((actor) => actor?.type === "group")
      .map((actor) => cleanText(actor?.id))
      .filter(Boolean)
      .sort();
    return groupIds[0] ?? cleanText(fallbackGroupId);
  }

  #normalizedState(context, groupState = context?.groupState, now = Date.now(), legacyState = null) {
    return normalizeCraftStateV2(groupState?.craftState, {
      groupId: context.groupId,
      legacyState,
      now
    });
  }

  async #claimLegacyCraftState(groupId) {
    return this.mutationCoordinator.run(
      "crafting-legacy-migration",
      () => this.#claimLegacyCraftStateUncoordinated(groupId)
    );
  }

  async #claimLegacyCraftStateUncoordinated(groupId) {
    const source = asObject(this.#legacyCraftState());
    if (!Array.isArray(source.queue)) {
      return null;
    }
    const sourceSignature = stableSignature({
      version: Number(source.version) || 1,
      counter: source.counter,
      queue: source.queue
    });
    const claim = asObject(source.migrationClaim);
    const claimedGroupId = cleanText(claim.groupId);
    if (claimedGroupId) {
      if (claimedGroupId !== cleanText(groupId)) {
        return null;
      }
      if (cleanText(claim.sourceSignature) && cleanText(claim.sourceSignature) !== sourceSignature) {
        throw codedError(
          "reconciliation-required",
          "The claimed legacy craft queue changed after migration was claimed."
        );
      }
      return source;
    }

    if (this.#legacyMigrationTargetGroupId(groupId) !== cleanText(groupId)) {
      return null;
    }

    this.#assertCanManage();
    const migrationClaim = {
      id: `legacy-craft-migration:${sourceSignature}`,
      groupId: cleanText(groupId),
      sourceSignature,
      claimedByUserId: cleanText(globalThis.game?.user?.id),
      claimedAt: Date.now()
    };
    const nextState = {
      ...cloneValue(source),
      migrationClaim
    };
    try {
      await game.settings.set(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE, cloneValue(nextState));
    }
    catch (error) {
      const observed = asObject(this.#legacyCraftState());
      if (
        cleanText(observed.migrationClaim?.groupId) === migrationClaim.groupId
        && cleanText(observed.migrationClaim?.sourceSignature) === sourceSignature
      ) {
        return observed;
      }
      throw error;
    }
    const observed = asObject(this.#legacyCraftState());
    if (
      cleanText(observed.migrationClaim?.groupId) !== migrationClaim.groupId
      || cleanText(observed.migrationClaim?.sourceSignature) !== sourceSignature
    ) {
      throw codedError("reconciliation-required", "Legacy craft migration claim was lost.");
    }
    return observed;
  }

  #resolveFreshContext(groupId) {
    const service = this.moduleApi.groupContextService;
    const context = typeof service?.resolveForGroup === "function"
      ? service.resolveForGroup(groupId)
      : service?.resolveForCurrentUser?.();
    if (!context?.groupId || context.groupId !== groupId) {
      throw codedError("reconciliation-required", "The active craft group changed during mutation.");
    }
    return context;
  }

  async #ensureState() {
    const context = this.#resolveContext();
    const normalizationNow = Date.now();
    const localCraftState = asObject(context.groupState?.craftState);
    const hasLocalState = Number(localCraftState.version) === CRAFT_STATE_VERSION
      || Array.isArray(localCraftState.projects)
      || Array.isArray(localCraftState.queue);
    const legacyState = !hasLocalState && this.#canManage()
      ? await this.#claimLegacyCraftState(context.groupId)
      : null;
    const normalized = this.#normalizedState(
      context,
      context.groupState,
      normalizationNow,
      legacyState
    );
    if (valuesEqual(context.groupState?.craftState ?? {}, normalized)) {
      return { context, state: normalized };
    }

    if (!this.#canManage()) {
      return { context, state: normalized };
    }
    this.#assertCanManage();

    const groupContextService = this.moduleApi.groupContextService;
    if (typeof groupContextService?.mutateGroupState !== "function") {
      throw new Error("Craft project writes require groupContextService.mutateGroupState.");
    }
    try {
      const state = await groupContextService.mutateGroupState(context.groupId, (groupState) => {
        this.#assertCanManage();
        const nextState = this.#normalizedState(context, groupState, normalizationNow, legacyState);
        groupState.craftState = cloneValue(nextState);
        return cloneValue(nextState);
      });
      return {
        context: this.#resolveFreshContext(context.groupId),
        state: normalizeCraftStateV2(state, { groupId: context.groupId })
      };
    }
    catch (error) {
      const observedContext = this.#resolveFreshContext(context.groupId);
      const observed = this.#normalizedState(
        observedContext,
        observedContext.groupState,
        normalizationNow,
        legacyState
      );
      if (valuesEqual(observed, normalized)) {
        return { context: observedContext, state: observed };
      }
      throw error;
    }
  }

  async #mutateState(context, mutator) {
    this.#assertCanManage();
    const groupContextService = this.moduleApi.groupContextService;
    if (typeof groupContextService?.mutateGroupState !== "function") {
      throw new Error("Craft project writes require groupContextService.mutateGroupState.");
    }
    return groupContextService.mutateGroupState(context.groupId, async (groupState) => {
      this.#assertCanManage();
      const state = this.#normalizedState(context, groupState);
      const result = await mutator(state, groupState);
      groupState.craftState = cloneValue(state);
      return cloneValue(result);
    });
  }

  #requireProject(state, projectId) {
    const safeProjectId = cleanText(projectId);
    const project = state.projects.find((entry) => entry.id === safeProjectId) ?? null;
    if (!project) {
      throw new Error("Craft project was not found in the active group.");
    }
    return project;
  }

  async #readProject(groupId, projectId) {
    const context = this.#resolveFreshContext(groupId);
    return this.#requireProject(this.#normalizedState(context), projectId);
  }

  #findDowntimeRequest(context, requestId) {
    const safeRequestId = cleanText(requestId);
    const request = asArray(context.groupState?.downtimeState?.requests)
      .find((entry) => cleanText(entry?.id) === safeRequestId) ?? null;
    if (!request) {
      throw new Error("Craft approval requires a downtime request from the active group.");
    }
    const status = cleanText(request.status) || "pending";
    if (!["pending", "submitted"].includes(status)) {
      throw new Error(`Downtime request '${safeRequestId}' must be pending before craft approval.`);
    }
    return request;
  }

  #requestCraftPayload(request) {
    return asObject(
      request?.craftProject
        ?? request?.craft
        ?? request?.payload?.craftProject
        ?? request?.payload
        ?? request
    );
  }

  async #buildQuote(context, rawInput = {}) {
    const input = normalizeApprovalInput(rawInput);
    if (!input.requestId) {
      throw new Error("Craft approval requires a downtime request ID.");
    }
    const request = this.#findDowntimeRequest(context, input.requestId);
    const requestPayload = this.#requestCraftPayload(request);
    const crafterActorId = cleanText(request.actorId);
    const memberActorIds = new Set(asArray(context.memberActorIds).map((actorId) => cleanText(actorId)));
    if (!crafterActorId || !memberActorIds.has(crafterActorId)) {
      throw new Error("The craft request actor must be a current group member.");
    }

    const outputs = asArray(requestPayload.outputs).map((output) => ({
      sourceType: "gear",
      sourceId: cleanText(output?.sourceId ?? output?.gearId ?? output?.id),
      quantity: Number(output?.quantity ?? 1)
    }));
    const predominantMaterialId = cleanText(requestPayload.predominantMaterialId);
    if (!predominantMaterialId) {
      throw new Error("A predominant craft material is required.");
    }
    const hoursPerDay = Number(requestPayload.hoursPerDay ?? 8);
    const ownedWorkshop = requestPayload.ownedWorkshop === true;

    // Validate the selected hour row even before effects are resolved.
    resolveDailyProgressGold({ hours: hoursPerDay, profile: "mundane", effectiveBaseGold: 5 });
    const model = await this.moduleApi.getModel();
    const inventoryService = this.moduleApi.inventoryService;
    const sourceGear = asArray(model?.gear).map((gear) => ({
      ...gear,
      requiredToolId: inventoryService.resolveRebreyaToolId(
        gear?.requiredToolId ?? gear?.toolId ?? gear?.linkedTool
      )
    }));
    const sourceGearById = new Map(sourceGear.map((gear) => [cleanText(gear.id), gear]));
    const batch = buildCraftBatch(outputs, sourceGearById);
    const predominantMaterial = model?.materialById?.get?.(predominantMaterialId)
      ?? asArray(model?.materials).find((material) => cleanText(material?.id) === predominantMaterialId)
      ?? null;
    if (!predominantMaterial) {
      throw new Error(`Predominant material '${predominantMaterialId}' was not found.`);
    }
    const baseRawByTool = buildBaseRawMaterialIndex(model?.materials);
    const baseRawMaterialId = baseRawByTool.get(batch.requiredToolId) ?? "";
    const baseRawMaterial = model?.materialById?.get?.(baseRawMaterialId)
      ?? asArray(model?.materials).find((material) => cleanText(material?.id) === baseRawMaterialId)
      ?? null;
    if (!baseRawMaterial) {
      throw new Error(`Base raw material mapping is missing for tool '${batch.requiredToolId || "unknown"}'.`);
    }

    const reservationQuote = calculateMaterialReservation({
      totalPriceGold: batch.totalPriceGold,
      totalWeightLb: batch.totalWeightLb,
      predominantMaterial,
      baseRawMaterial
    });
    const toolAccess = await inventoryService.resolveMemberToolAccess(
      crafterActorId,
      batch.requiredToolId
    );
    const workshopApproval = {
      confirmedByUserId: isActiveGmClient(globalThis.game)
        ? cleanText(globalThis.game?.user?.id)
        : ""
    };
    const blueprintIds = asArray(requestPayload.blueprintIds);
    const eligibility = validateCraftEligibility({
      batch,
      toolAccess,
      workshopApproved: Boolean(workshopApproval.confirmedByUserId),
      blueprintIds
    });
    const normalizedOutputs = batch.outputs.map((output) => ({
      sourceType: "gear",
      sourceId: output.sourceId,
      name: output.name,
      quantity: output.quantity,
      unitPriceGold: output.priceGold,
      unitWeightLb: output.weightLb
    }));
    const signaturePayload = {
      groupId: context.groupId,
      requestId: input.requestId,
      crafterActorId,
      outputs: normalizedOutputs,
      targetGold: batch.totalPriceGold,
      totalWeightLb: batch.totalWeightLb,
      profile: batch.profile,
      requiredRank: batch.requiredRank,
      requiredToolId: batch.requiredToolId,
      toolAccess: toolAccess ? {
        rank: toNonnegativeNumber(toolAccess.rank, 0),
        source: cleanText(toolAccess.source),
        itemUuid: cleanText(toolAccess.itemUuid)
      } : null,
      hoursPerDay,
      ownedWorkshop,
      predominantMaterial: {
        id: cleanText(predominantMaterial.id),
        priceGold: predominantMaterial.priceGold,
        weight: predominantMaterial.weightLb ?? predominantMaterial.weight
      },
      baseRawMaterial: {
        id: cleanText(baseRawMaterial.id),
        priceGold: baseRawMaterial.priceGold,
        weight: baseRawMaterial.weightLb ?? baseRawMaterial.weight
      },
      reservationQuote,
      workshopConfirmedByUserId: workshopApproval.confirmedByUserId,
      blueprintIds: blueprintIds.map((id) => cleanText(id)).sort()
    };

    return {
      groupId: context.groupId,
      requestId: input.requestId,
      crafterActorId,
      outputs: normalizedOutputs,
      targetGold: batch.totalPriceGold,
      totalWeightLb: batch.totalWeightLb,
      profile: batch.profile,
      requiredRank: batch.requiredRank,
      requiredToolId: batch.requiredToolId,
      requiredToolRank: batch.requiredRank,
      toolAccess: cloneValue(toolAccess),
      hoursPerDay,
      ownedWorkshop,
      workdaySelection: buildWorkdaySelection(hoursPerDay, ownedWorkshop),
      workshopApproval,
      reservation: {
        predominantMaterialId: cleanText(predominantMaterial.id),
        predominantMaterialLbReserved: reservationQuote.predominantMaterialLb,
        predominantMaterialLbSpent: 0,
        baseRawMaterialId: cleanText(baseRawMaterial.id),
        baseRawQuantityReserved: reservationQuote.baseRawMaterialQuantity,
        baseRawQuantitySpent: 0,
        baseRawWeightLbReserved: reservationQuote.baseRawWeightLb,
        baseRawWeightLbSpent: 0,
        receipts: []
      },
      eligibility,
      signature: stableSignature(signaturePayload)
    };
  }

  async getQuote(input = {}) {
    const context = this.#resolveContext();
    return cloneValue(await this.#buildQuote(context, input));
  }

  #buildCraftableEntries(model, search = "") {
    const normalizedSearch = normalizeText(search);
    return asArray(model?.gear)
      .map((gear) => {
        const requiredToolId = this.moduleApi.inventoryService.resolveRebreyaToolId(
          gear?.requiredToolId ?? gear?.toolId ?? gear?.linkedTool
        );
        return {
          id: cleanText(gear?.id),
          name: cleanText(gear?.name),
          rank: Math.max(0, Math.floor(toFiniteNumber(gear?.rank, 0))),
          priceGold: roundFive(toNonnegativeNumber(
            gear?.priceGoldEquivalent ?? gear?.priceGold ?? gear?.priceValue,
            0
          )),
          weight: roundFive(toNonnegativeNumber(gear?.weightLb ?? gear?.weight, 0)),
          requiredToolId,
          requiredToolLabel: this.moduleApi.inventoryService.getRebreyaToolLabel(requiredToolId)
            || cleanText(gear?.linkedTool),
          materialId: cleanText(gear?.predominantMaterialId),
          materialName: cleanText(gear?.predominantMaterialName),
          description: cleanText(gear?.description)
        };
      })
      .filter((entry) => !normalizedSearch || normalizeText([
        entry.name,
        entry.requiredToolLabel,
        entry.materialName
      ].join(" ")).includes(normalizedSearch))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }

  async getSnapshot({ search = "", crafterActorId = "" } = {}) {
    const { state } = await this.#ensureState();
    const model = await this.moduleApi.getModel();
    const partySnapshot = await this.moduleApi.getPartySnapshot();
    const crafters = asArray(partySnapshot?.members).map((member) => ({
      actorId: cleanText(member?.actorId),
      actorName: cleanText(member?.actorName),
      actorImg: cleanText(member?.actorImg),
      selected: cleanText(member?.actorId) === cleanText(crafterActorId)
    }));
    if (crafters.length && !crafters.some((entry) => entry.selected)) {
      crafters[0].selected = true;
    }
    const normalizedSearch = normalizeText(search);
    const projects = state.projects
      .filter((project) => !crafterActorId || project.crafterActorId === crafterActorId)
      .filter((project) => !normalizedSearch || normalizeText([
        project.id,
        project.requestId,
        ...project.outputs.map((output) => output.name)
      ].join(" ")).includes(normalizedSearch))
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((project) => ({
        ...cloneValue(project),
        reservationSummary: {
          ...projectReservationRemaining(project),
          predominantMaterialLbSpent: project.reservation.predominantMaterialLbSpent,
          baseRawQuantitySpent: project.reservation.baseRawQuantitySpent
        }
      }));

    return {
      version: CRAFT_STATE_VERSION,
      projects,
      projectCount: projects.length,
      migrationAudit: cloneValue(state.migrationAudit),
      reconciliation: projects
        .filter((project) => project.reconciliation?.required === true)
        .map((project) => ({ projectId: project.id, ...cloneValue(project.reconciliation) })),
      craftableEntries: this.#buildCraftableEntries(model, search),
      crafters,
      hasCrafters: crafters.length > 0,
      queue: [],
      queueCount: 0,
      legacyQueueReadOnly: true
    };
  }

  #assertJournalIdentity(record, kind, groupId, request) {
    if (
      record?.kind === kind
      && cleanText(record.groupId) === cleanText(groupId)
      && valuesEqual(record.request, request)
    ) {
      return;
    }
    throw codedError("mutation-conflict", `Craft mutation '${record?.id ?? ""}' conflicts with this request.`);
  }

  #readTerminal(record) {
    if (record?.terminal !== true) {
      return { terminal: false, value: undefined };
    }
    if (record.result?.ok === false) {
      throw codedError(
        record.result.code || "craft-mutation-failed",
        record.result.error || "Craft mutation failed."
      );
    }
    return { terminal: true, value: cloneValue(record.result?.value) };
  }

  #buildProjectFromQuote(quote, projectId, mutationId, now) {
    return normalizeProject({
      id: projectId,
      groupId: quote.groupId,
      requestId: quote.requestId,
      crafterActorId: quote.crafterActorId,
      status: "approved",
      operationalStatus: "active",
      profile: quote.profile,
      outputs: quote.outputs,
      targetGold: quote.targetGold,
      progressGold: 0,
      hoursPerDay: quote.hoursPerDay,
      ownedWorkshop: quote.ownedWorkshop,
      workdaySelection: quote.workdaySelection,
      requiredRank: quote.requiredRank,
      requiredToolId: quote.requiredToolId,
      requiredToolRank: quote.requiredToolRank,
      workshopApproval: {
        confirmedByUserId: quote.workshopApproval.confirmedByUserId,
        confirmedAt: now
      },
      quoteSignature: quote.signature,
      reservation: quote.reservation,
      processedWorkdays: [],
      revision: 1,
      audit: [buildAuditEntry("approved", {
        mutationId,
        fromStatus: "submitted",
        toStatus: "approved",
        now
      })],
      reconciliation: { required: false },
      createdAt: now,
      updatedAt: now,
      completedAt: null
    }, quote.groupId);
  }

  async #persistNewProject(record) {
    const context = this.#resolveFreshContext(record.groupId);
    try {
      return await this.#mutateState(context, (state) => {
        const existingById = state.projects.find((project) => project.id === record.project.id) ?? null;
        if (existingById) {
          if (projectMatchesIdentity(existingById, record.project)) {
            return cloneValue(existingById);
          }
          throw codedError("reconciliation-required", "Craft project ID was reused by another approval.");
        }
        const existingByRequest = state.projects.find((project) => (
          project.requestId && project.requestId === record.project.requestId
        )) ?? null;
        if (existingByRequest) {
          throw codedError("request-already-linked", "The downtime request already has a craft project.");
        }
        if (state.counter !== record.counterBefore) {
          throw codedError("reconciliation-required", "Craft project counter changed during approval.");
        }
        state.counter = record.projectCounter;
        state.projects.push(cloneValue(record.project));
        state.audit.push(cloneValue(record.project.audit[0]));
        return cloneValue(record.project);
      });
    }
    catch (error) {
      const observed = await this.#readProject(record.groupId, record.project.id).catch(() => null);
      if (observed && projectMatchesIdentity(observed, record.project)) {
        return observed;
      }
      throw error;
    }
  }

  approveRequest(input = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#approveRequest(input));
  }

  async #approveRequest(rawInput = {}) {
    this.#assertCanManage();
    const input = normalizeApprovalInput(rawInput, { strict: true });
    const operationId = requireMutationId(rawInput.mutationId, "Craft approval");
    if (!input.expectedQuoteSignature) {
      throw codedError(
        "craft-quote-signature-required",
        "Craft approval requires the expected quote signature."
      );
    }
    const { context, state } = await this.#ensureState();
    let record = await this.mutationJournal.find(operationId);
    if (record) {
      this.#assertJournalIdentity(record, "approve-project", context.groupId, input);
    }
    else {
      const existingProject = state.projects.find((project) => (
        project.requestId && project.requestId === input.requestId
      )) ?? null;
      if (existingProject) {
        if (cleanText(existingProject.quoteSignature) !== input.expectedQuoteSignature) {
          throw codedError("stale-craft-quote", "The approved craft project has a different quote signature.");
        }
        return cloneValue(existingProject);
      }
      const quote = await this.#buildQuote(context, { requestId: input.requestId });
      if (!quote.eligibility.valid) {
        const [firstError] = quote.eligibility.errors;
        throw codedError(firstError?.code || "craft-ineligible", firstError?.message || "Craft request is not eligible.");
      }
      if (input.expectedQuoteSignature !== quote.signature) {
        throw codedError("stale-craft-quote", "The craft quote changed; refresh approval before reserving resources.");
      }
      const projectCounter = state.counter + 1;
      const projectId = `craft-project-${projectCounter}`;
      const now = Date.now();
      const project = this.#buildProjectFromQuote(quote, projectId, operationId, now);
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "approve-project",
        phase: "prepared",
        groupId: context.groupId,
        request: input,
        counterBefore: state.counter,
        projectCounter,
        project,
        reservationRequest: {
          projectId,
          predominantMaterialId: project.reservation.predominantMaterialId,
          predominantMaterialLb: project.reservation.predominantMaterialLbReserved,
          baseRawMaterialId: project.reservation.baseRawMaterialId,
          baseRawQuantity: project.reservation.baseRawQuantityReserved
        }
      });
    }

    const terminal = this.#readTerminal(record);
    if (terminal.terminal) {
      return this.#readProject(record.groupId, terminal.value.projectId);
    }
    if (record.phase === "reconciliation-required") {
      throw codedError("reconciliation-required", "Craft approval requires reconciliation.");
    }

    if (record.phase === "prepared") {
      const inventoryOptions = this.#inventoryExecutionOptions(record.groupId);
      const receipts = await this.moduleApi.inventoryService.reserveCraftResourcesOnce(
        record.reservationRequest,
        `${operationId}:reserve`,
        inventoryOptions
      );
      inventoryOptions.assertExecutionContext();
      const nextProject = cloneValue(record.project);
      nextProject.reservation.receipts = cloneValue(receipts);
      record = await this.mutationJournal.checkpoint(
        operationId,
        "prepared",
        "resources-reserved",
        { project: nextProject, reservationReceipts: cloneValue(receipts) }
      );
    }

    if (record.phase === "resources-reserved") {
      try {
        await this.#persistNewProject(record);
      }
      catch (error) {
        try {
          const inventoryOptions = this.#inventoryExecutionOptions(record.groupId);
          await this.moduleApi.inventoryService.releaseCraftReservationOnce(
            record.project.id,
            projectReservationRemaining(record.project),
            `${operationId}:compensate-reservation`,
            inventoryOptions
          );
          inventoryOptions.assertExecutionContext();
          record = await this.mutationJournal.checkpoint(
            operationId,
            "resources-reserved",
            "compensated",
            { failure: { code: error.code || "craft-project-write-failed", message: error.message } }
          );
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code || "craft-project-write-failed",
            error: error.message
          });
        }
        catch (compensationError) {
          try {
            await this.mutationJournal.checkpoint(
              operationId,
              record.phase,
              "reconciliation-required",
              {
                failure: { code: error.code || "craft-project-write-failed", message: error.message },
                compensationFailure: {
                  code: compensationError.code || "craft-compensation-failed",
                  message: compensationError.message
                }
              }
            );
          }
          catch {
            // Keep the original persistence and compensation errors below.
          }
          throw new AggregateError([error, compensationError], "Craft approval persistence and compensation failed.");
        }
        throw error;
      }
      record = await this.mutationJournal.checkpoint(
        operationId,
        "resources-reserved",
        "project-persisted"
      );
    }
    if (record.phase === "project-persisted") {
      record = await this.mutationJournal.checkpoint(operationId, "project-persisted", "committed");
    }
    await this.mutationJournal.finish(operationId, {
      ok: true,
      value: { projectId: record.project.id }
    });
    return this.#readProject(record.groupId, record.project.id);
  }

  async #persistReplacement(groupId, expectedProject, nextProject) {
    const context = this.#resolveFreshContext(groupId);
    try {
      return await this.#mutateState(context, (state) => {
        const project = this.#requireProject(state, expectedProject.id);
        if (valuesEqual(project, nextProject)) {
          return cloneValue(project);
        }
        if (project.revision !== expectedProject.revision) {
          throw codedError("reconciliation-required", "Craft project changed during a durable mutation.");
        }
        const index = state.projects.findIndex((entry) => entry.id === project.id);
        state.projects[index] = cloneValue(nextProject);
        const newAuditIds = new Set(project.audit.map((entry) => cleanText(entry?.id)));
        state.audit.push(...nextProject.audit
          .filter((entry) => !newAuditIds.has(cleanText(entry?.id)))
          .map((entry) => cloneValue(entry)));
        return cloneValue(nextProject);
      });
    }
    catch (error) {
      const observed = await this.#readProject(groupId, expectedProject.id).catch(() => null);
      if (observed && valuesEqual(observed, nextProject)) {
        return observed;
      }
      throw error;
    }
  }

  async #blockProject(project, reason, mutationId) {
    if (project.operationalStatus === "blocked" && project.blockReason === reason) {
      return cloneValue(project);
    }
    const now = Date.now();
    const nextProject = normalizeProject({
      ...cloneValue(project),
      operationalStatus: "blocked",
      blockReason: cleanText(reason),
      revision: project.revision + 1,
      updatedAt: now,
      audit: [...project.audit, buildAuditEntry("blocked", {
        mutationId,
        fromStatus: project.status,
        toStatus: project.status,
        details: {
          fromOperationalStatus: project.operationalStatus,
          toOperationalStatus: "blocked"
        },
        reason,
        now
      })]
    }, project.groupId);
    return this.#persistReplacement(project.groupId, project, nextProject);
  }

  async #preflightProjectWorkday(project, operationId) {
    if (
      !["approved", "in-progress"].includes(project.status)
      || project.operationalStatus !== "active"
    ) {
      return { project, blockReason: "" };
    }
    if (!cleanText(project.workshopApproval?.confirmedByUserId)) {
      const reason = "The craft project has no approved workshop.";
      return {
        project: await this.#blockProject(project, reason, `${operationId}:block`),
        blockReason: reason
      };
    }
    const actor = game.actors?.get?.(project.crafterActorId)
      ?? asArray(game.actors?.contents).find((entry) => entry?.id === project.crafterActorId)
      ?? null;
    if (!actor) {
      const reason = "The craft project actor is unavailable.";
      return {
        project: await this.#blockProject(project, reason, `${operationId}:block`),
        blockReason: reason
      };
    }
    const toolAccess = await this.moduleApi.inventoryService.resolveMemberToolAccess(
      project.crafterActorId,
      project.requiredToolId
    );
    if (!toolAccess || toNonnegativeNumber(toolAccess.rank, 0) < project.requiredToolRank) {
      const reason = `Tool rank ${project.requiredToolRank} is required for this craft project.`;
      return {
        project: await this.#blockProject(project, reason, `${operationId}:block`),
        blockReason: reason
      };
    }
    return { project, actor, toolAccess, blockReason: "" };
  }

  #buildProcessedResult(project, processResult, spendReceipt = null) {
    return {
      status: "processed",
      projectId: project.id,
      activityId: "craft",
      hours: project.hoursPerDay,
      result: {
        projectId: project.id,
        status: project.status,
        progressGold: project.progressGold,
        appliedProgressGold: toNonnegativeNumber(
          processResult?.project?.processedWorkdays?.at?.(-1)?.progressGold,
          0
        ),
        spend: cloneValue(processResult?.spend ?? { predominantMaterialLb: 0, baseRawQuantity: 0 }),
        spendReceipt: cloneValue(spendReceipt),
        completion: processResult?.completion === true,
        alreadyProcessed: processResult?.alreadyProcessed === true,
        alreadyCompleted: processResult?.alreadyCompleted === true
      }
    };
  }

  processProjectWorkday(projectId, options = {}) {
    return this.mutationCoordinator.run(
      "crafting",
      () => this.#processProjectWorkday(projectId, options)
    );
  }

  async #processProjectWorkday(projectId, rawOptions = {}) {
    this.#assertCanManage();
    const input = normalizeWorkdayInput(rawOptions);
    if (!input.isoDate || !input.transitionId || !input.mutationId) {
      throw new Error("Craft workday processing requires stable isoDate, transitionId, and mutationId values.");
    }
    const operationId = input.mutationId;
    const { context, state } = await this.#ensureState();
    let record = await this.mutationJournal.find(operationId);
    if (record) {
      this.#assertJournalIdentity(record, "process-project-workday", context.groupId, {
        projectId: cleanText(projectId),
        isoDate: input.isoDate,
        transitionId: input.transitionId
      });
    }
    else {
      const project = cloneValue(this.#requireProject(state, projectId));
      if (project.status === "completed") {
        return this.#buildProcessedResult(project, {
          spend: { predominantMaterialLb: 0, baseRawQuantity: 0 },
          completion: false,
          alreadyCompleted: true
        });
      }
      const preflight = await this.#preflightProjectWorkday(project, operationId);
      if (
        preflight.blockReason
        || preflight.project.status === "cancelled"
        || !["approved", "in-progress"].includes(preflight.project.status)
        || ["paused", "blocked", "inactive"].includes(preflight.project.operationalStatus)
      ) {
        return {
          status: "blocked",
          blocked: true,
          projectId: preflight.project.id,
          blockReason: preflight.blockReason
            || cleanText(preflight.project.blockReason)
            || (preflight.project.status === "cancelled" ? "Craft project is cancelled." : "")
            || `Craft project is ${preflight.project.operationalStatus || preflight.project.status}.`
        };
      }
      const effectiveBaseResult = typeof this.moduleApi.resolveCraftProgressBase === "function"
        ? await this.moduleApi.resolveCraftProgressBase(preflight.actor, preflight.project)
        : 5;
      const effectiveBaseGold = typeof effectiveBaseResult === "object"
        ? toFiniteNumber(effectiveBaseResult?.effectiveBaseGold ?? effectiveBaseResult?.value, 5)
        : toFiniteNumber(effectiveBaseResult, 5);
      const dailyProgressGold = resolveDailyProgressGold({
        hours: preflight.project.hoursPerDay,
        profile: preflight.project.profile,
        effectiveBaseGold
      });
      const processResult = processCraftProjectWorkday({
        ...preflight.project,
        status: "active"
      }, {
        isoDate: input.isoDate,
        transitionId: input.transitionId,
        dailyProgressGold
      });
      if (processResult.alreadyProcessed || processResult.alreadyCompleted) {
        return this.#buildProcessedResult(preflight.project, processResult);
      }
      const now = Date.now();
      const nextProject = normalizeProject({
        ...processResult.project,
        status: processResult.completion ? "completed" : "in-progress",
        operationalStatus: processResult.completion ? "inactive" : "active",
        revision: preflight.project.revision + 1,
        updatedAt: now,
        completedAt: processResult.completion ? now : preflight.project.completedAt,
        completion: processResult.completion ? {
          outputStatus: "pending",
          outputMutationId: `${operationId}:outputs`,
          outputItemIds: [],
          outputItemUuids: []
        } : preflight.project.completion,
        audit: [...preflight.project.audit, buildAuditEntry("workday-processed", {
          mutationId: operationId,
          fromStatus: preflight.project.status,
          toStatus: processResult.completion ? "completed" : "in-progress",
          details: {
            isoDate: input.isoDate,
            transitionId: input.transitionId,
            progressGold: processResult.project.processedWorkdays.at(-1)?.progressGold ?? 0,
            spend: processResult.spend
          },
          now
        })]
      }, context.groupId);
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "process-project-workday",
        phase: "prepared",
        groupId: context.groupId,
        request: {
          projectId: cleanText(projectId),
          isoDate: input.isoDate,
          transitionId: input.transitionId
        },
        projectBefore: preflight.project,
        project: nextProject,
        spend: processResult.spend,
        completion: processResult.completion,
        processResult
      });
    }

    const terminal = this.#readTerminal(record);
    if (terminal.terminal) {
      return cloneValue(terminal.value);
    }
    if (record.phase === "reconciliation-required") {
      throw codedError("reconciliation-required", "Craft workday requires reconciliation.");
    }
    if (record.phase === "prepared") {
      const inventoryOptions = this.#inventoryExecutionOptions(record.groupId);
      const spendReceipt = await this.moduleApi.inventoryService.spendCraftReservationOnce(
        record.project.id,
        record.spend,
        `${operationId}:spend`,
        inventoryOptions
      );
      inventoryOptions.assertExecutionContext();
      record = await this.mutationJournal.checkpoint(
        operationId,
        "prepared",
        "resources-spent",
        { spendReceipt: cloneValue(spendReceipt) }
      );
    }
    if (record.phase === "resources-spent") {
      await this.#persistReplacement(record.groupId, record.projectBefore, record.project);
      record = await this.mutationJournal.checkpoint(
        operationId,
        "resources-spent",
        "project-persisted"
      );
    }
    if (record.phase === "project-persisted") {
      const inventoryOptions = this.#inventoryExecutionOptions(record.groupId);
      const outputItems = record.completion
        ? await this.moduleApi.inventoryService.createCraftOutputsOnce(
          record.project.outputs,
          `${operationId}:outputs`,
          inventoryOptions
        )
        : [];
      inventoryOptions.assertExecutionContext();
      record = await this.mutationJournal.checkpoint(
        operationId,
        "project-persisted",
        "output-created",
        {
          outputReceipts: asArray(outputItems).map((item) => ({
            itemId: outputDocumentIdentity(item),
            itemUuid: cleanText(item?.uuid)
          }))
        }
      );
    }
    if (record.phase === "output-created" && record.completion) {
      const persisted = await this.#readProject(record.groupId, record.project.id);
      const outputMutationId = `${operationId}:outputs`;
      let finalizedProject = persisted;
      if (
        persisted.completion?.outputStatus !== "created"
        || cleanText(persisted.completion?.outputMutationId) !== outputMutationId
      ) {
        const now = Date.now();
        finalizedProject = normalizeProject({
          ...persisted,
          revision: persisted.revision + 1,
          updatedAt: now,
          completion: {
            ...asObject(persisted.completion),
            outputStatus: "created",
            outputMutationId,
            outputItemIds: asArray(record.outputReceipts).map((receipt) => receipt.itemId).filter(Boolean),
            outputItemUuids: asArray(record.outputReceipts).map((receipt) => receipt.itemUuid).filter(Boolean)
          },
          audit: [...persisted.audit, buildAuditEntry("outputs-created", {
            mutationId: outputMutationId,
            fromStatus: "completed",
            toStatus: "completed",
            now
          })]
        }, record.groupId);
        await this.#persistReplacement(record.groupId, persisted, finalizedProject);
      }
      record = await this.mutationJournal.checkpoint(
        operationId,
        "output-created",
        "completion-persisted",
        { finalProject: finalizedProject }
      );
    }
    if (record.phase === "output-created" && !record.completion) {
      record = await this.mutationJournal.checkpoint(
        operationId,
        "output-created",
        "completion-persisted",
        { finalProject: record.project }
      );
    }
    if (record.phase === "completion-persisted") {
      record = await this.mutationJournal.checkpoint(operationId, "completion-persisted", "committed");
    }
    const finalProject = record.finalProject
      ?? await this.#readProject(record.groupId, record.project.id);
    const result = this.#buildProcessedResult(finalProject, record.processResult, record.spendReceipt);
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return cloneValue(result);
  }

  cancelProject(projectId, options = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#cancelProject(projectId, options));
  }

  async #cancelProject(projectId, { mutationId = "" } = {}) {
    this.#assertCanManage();
    const operationId = requireMutationId(mutationId, "Craft cancellation");
    const { context, state } = await this.#ensureState();
    const request = { projectId: cleanText(projectId) };
    let record = await this.mutationJournal.find(operationId);
    if (record) {
      this.#assertJournalIdentity(record, "cancel-project", context.groupId, request);
    }
    else {
      const project = cloneValue(this.#requireProject(state, projectId));
      if (project.status === "cancelled") {
        if (cleanText(project.cancellation?.releaseStatus) === "released") {
          return project;
        }
        throw codedError(
          "reconciliation-required",
          `Craft cancellation must be resumed with mutation '${cleanText(project.cancellation?.mutationId)}'.`
        );
      }
      if (project.status === "completed") {
        throw new Error("A completed craft project cannot be cancelled.");
      }
      const now = Date.now();
      const nextProject = normalizeProject({
        ...project,
        status: "cancelled",
        operationalStatus: "inactive",
        cancellation: {
          mutationId: operationId,
          releaseMutationId: `${operationId}:release`,
          releaseStatus: "pending",
          startedAt: now,
          releasedAt: null,
          releaseReceipts: []
        },
        cancelledAt: now,
        completedAt: null,
        blockReason: "",
        revision: project.revision + 1,
        updatedAt: now,
        audit: [...project.audit, buildAuditEntry("cancelled", {
          mutationId: operationId,
          fromStatus: project.status,
          toStatus: "cancelled",
          now
        })]
      }, context.groupId);
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "cancel-project",
        phase: "prepared",
        groupId: context.groupId,
        request,
        projectBefore: project,
        project: nextProject,
        remaining: projectReservationRemaining(project)
      });
    }

    const terminal = this.#readTerminal(record);
    if (terminal.terminal) {
      return this.#readProject(record.groupId, terminal.value.projectId);
    }
    if (record.phase === "prepared") {
      await this.#persistReplacement(record.groupId, record.projectBefore, record.project);
      record = await this.mutationJournal.checkpoint(
        operationId,
        "prepared",
        "cancellation-persisted"
      );
    }
    if (record.phase === "cancellation-persisted") {
      const inventoryOptions = this.#inventoryExecutionOptions(record.groupId);
      const releaseReceipts = await this.moduleApi.inventoryService.releaseCraftReservationOnce(
        record.project.id,
        record.remaining,
        `${operationId}:release`,
        inventoryOptions
      );
      inventoryOptions.assertExecutionContext();
      record = await this.mutationJournal.checkpoint(
        operationId,
        "cancellation-persisted",
        "resources-released",
        { releaseReceipts: cloneValue(releaseReceipts) }
      );
    }
    if (record.phase === "resources-released") {
      const persisted = await this.#readProject(record.groupId, record.project.id);
      let finalProject = persisted;
      if (
        cleanText(persisted.cancellation?.mutationId) !== operationId
        || cleanText(persisted.cancellation?.releaseStatus) !== "released"
      ) {
        const now = Date.now();
        finalProject = normalizeProject({
          ...persisted,
          revision: persisted.revision + 1,
          updatedAt: now,
          cancellation: {
            ...asObject(persisted.cancellation),
            mutationId: operationId,
            releaseMutationId: `${operationId}:release`,
            releaseStatus: "released",
            releasedAt: now,
            releaseReceipts: cloneValue(record.releaseReceipts)
          },
          audit: [...persisted.audit, buildAuditEntry("cancellation-resources-released", {
            mutationId: `${operationId}:release-persisted`,
            fromStatus: "cancelled",
            toStatus: "cancelled",
            now
          })]
        }, record.groupId);
        await this.#persistReplacement(record.groupId, persisted, finalProject);
      }
      record = await this.mutationJournal.checkpoint(
        operationId,
        "resources-released",
        "release-persisted",
        { finalProject }
      );
    }
    if (record.phase === "release-persisted") {
      record = await this.mutationJournal.checkpoint(operationId, "release-persisted", "committed");
    }
    await this.mutationJournal.finish(operationId, {
      ok: true,
      value: { projectId: record.project.id }
    });
    return this.#readProject(record.groupId, record.project.id);
  }

  async #lifecycleTransition(projectId, {
    mutationId,
    type,
    allowedStatuses,
    nextStatus,
    reason = "",
    transform = null
  }) {
    this.#assertCanManage();
    const operationId = requireMutationId(mutationId, `Craft ${type}`);
    const { context } = await this.#ensureState();
    const apply = async () => this.#mutateState(context, (state) => {
      const project = this.#requireProject(state, projectId);
      const existingAudit = project.audit.find((entry) => cleanText(entry?.mutationId) === operationId);
      if (existingAudit) {
        return cloneValue(project);
      }
      if (!allowedStatuses.includes(project.operationalStatus)) {
        throw new Error(
          `Craft project cannot be ${type} from operational status '${project.operationalStatus}'.`
        );
      }
      const now = Date.now();
      const nextProject = normalizeProject({
        ...project,
        ...(typeof transform === "function" ? transform(project) : {}),
        status: project.status,
        operationalStatus: nextStatus ?? project.operationalStatus,
        blockReason: nextStatus === "active" ? "" : project.blockReason,
        revision: project.revision + 1,
        updatedAt: now,
        audit: [...project.audit, buildAuditEntry(type, {
          mutationId: operationId,
          fromStatus: project.status,
          toStatus: project.status,
          reason,
          details: {
            fromOperationalStatus: project.operationalStatus,
            toOperationalStatus: nextStatus ?? project.operationalStatus
          },
          now
        })]
      }, context.groupId);
      const index = state.projects.findIndex((entry) => entry.id === project.id);
      state.projects[index] = nextProject;
      state.audit.push(cloneValue(nextProject.audit.at(-1)));
      return cloneValue(nextProject);
    });
    try {
      return await apply();
    }
    catch (error) {
      const observed = await this.#readProject(context.groupId, projectId).catch(() => null);
      if (observed?.audit.some((entry) => cleanText(entry?.mutationId) === operationId)) {
        return observed;
      }
      throw error;
    }
  }

  pauseProject(projectId, { mutationId = "", reason = "" } = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#lifecycleTransition(projectId, {
      mutationId,
      type: "paused",
      allowedStatuses: ["active", "blocked"],
      nextStatus: "paused",
      reason
    }));
  }

  resumeProject(projectId, { mutationId = "" } = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#lifecycleTransition(projectId, {
      mutationId,
      type: "resumed",
      allowedStatuses: ["paused", "blocked"],
      nextStatus: "active",
      transform(project) {
        if (project.reconciliation?.required === true) {
          throw new Error("Reconcile the craft project before resuming it.");
        }
        return {};
      }
    }));
  }

  reconcileProject(projectId, {
    mutationId = "",
    note = "",
    resume = false
  } = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#lifecycleTransition(projectId, {
      mutationId,
      type: "reconciled",
      allowedStatuses: ["paused", "blocked", "active"],
      nextStatus: resume ? "active" : undefined,
      reason: note,
      transform(project) {
        if (project.reconciliation?.required !== true) {
          throw new Error("Craft project does not require reconciliation.");
        }
        return {
          reconciliation: {
            ...asObject(project.reconciliation),
            required: false,
            resolvedByUserId: cleanText(game.user?.id),
            resolvedAt: Date.now(),
            note: cleanText(note)
          }
        };
      }
    }));
  }

  getLegacyQueueSnapshot() {
    const source = asObject(this.#legacyCraftState());
    return {
      deprecated: true,
      readOnly: true,
      version: Number(source.version) || 1,
      queue: cloneValue(asArray(source.queue))
    };
  }

  #deprecatedQueueMutation() {
    return Promise.reject(codedError(
      "deprecated-craft-queue",
      "The legacy craft queue is read-only; use v2 craft projects and scheduled workdays."
    ));
  }

  queueTask() {
    return this.#deprecatedQueueMutation();
  }

  cancelTask() {
    return this.#deprecatedQueueMutation();
  }

  processOneDay() {
    return this.#deprecatedQueueMutation();
  }
}
