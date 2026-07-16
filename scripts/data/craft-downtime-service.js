const CRAFT_ACTIVITY_ID = "craft";
const REQUIRED_CRAFTING_METHODS = Object.freeze([
  "getSnapshot",
  "getQuote",
  "approveRequest",
  "pauseProject",
  "resumeProject",
  "cancelProject",
  "reconcileProject",
  "processProjectWorkday"
]);
const SNAPSHOT_KEYS = new Set(["search", "crafterActorId"]);
const APPROVAL_QUOTE_KEYS = new Set(["requestId"]);
const APPROVAL_KEYS = new Set(["requestId", "mutationId"]);
const PAUSE_KEYS = new Set(["mutationId", "reason"]);
const MUTATION_KEYS = new Set(["mutationId"]);
const RECONCILE_KEYS = new Set(["mutationId", "note", "resume"]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireMethod(service, method, label) {
  if (typeof service?.[method] !== "function") {
    throw new TypeError(`${label} must implement ${method}().`);
  }
}

function requireId(value, label) {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) {
    throw new Error(`${label} requires a stable nonempty ID.`);
  }
  return id;
}

function assertOnlyKeys(value, allowedKeys, label) {
  const unsupported = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unsupported.length) {
    throw new Error(`${label} cannot include unsupported fields: ${unsupported.join(", ")}.`);
  }
}

function requireHours(value, label) {
  const hours = Number(value);
  if (!Number.isInteger(hours) || hours < 8 || hours > 16) {
    throw new Error(`${label} requires whole work hours from 8 to 16.`);
  }
  return hours;
}

function requireIsoDate(value, label) {
  const isoDate = typeof value === "string" ? value.trim() : "";
  const match = /^(\d{1,6})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!match) {
    throw new Error(`${label} requires an ISO calendar date.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`${label} requires a valid ISO calendar date.`);
  }
  return isoDate;
}

function assertIdentity(actual, expected, label) {
  if (actual !== undefined && actual !== null && requireId(actual, label) !== expected) {
    throw new Error(`${label} does not match the requested link.`);
  }
}

function requireMatchingId(actual, expected, label) {
  const id = requireId(actual, label);
  if (id !== expected) {
    throw new Error(`${label} does not match the requested link.`);
  }
  return id;
}

function optionalText(value, label) {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }
  return value.trim();
}

function requireProjectResult(value, projectId, label) {
  const project = requireObject(value, label);
  requireMatchingId(project.id, projectId, `${label} project ID`);
  return project;
}

export class CraftDowntimeService {
  constructor({ craftingService, downtimeService } = {}) {
    requireObject(craftingService, "craftingService");
    requireObject(downtimeService, "downtimeService");
    for (const method of REQUIRED_CRAFTING_METHODS) {
      requireMethod(craftingService, method, "craftingService");
    }
    requireMethod(downtimeService, "linkCraftProject", "downtimeService");

    this.craftingService = craftingService;
    this.downtimeService = downtimeService;
  }

  async getSnapshot(options = {}) {
    const source = requireObject(options, "Craft snapshot options");
    assertOnlyKeys(source, SNAPSHOT_KEYS, "Craft snapshot options");
    return this.craftingService.getSnapshot({ ...source });
  }

  async getApprovalQuote(input = {}) {
    const source = requireObject(input, "Craft approval quote input");
    assertOnlyKeys(source, APPROVAL_QUOTE_KEYS, "Craft approval quote input");
    const requestId = requireId(source.requestId, "Craft approval quote request");
    const quote = requireObject(
      await this.craftingService.getQuote({ requestId }),
      "Craft approval quote"
    );
    requireMatchingId(quote.requestId, requestId, "Craft approval quote request ID");
    requireId(quote.signature, "Craft approval quote signature");
    return quote;
  }

  async approveRequest(input = {}) {
    const source = requireObject(input, "Craft approval input");
    assertOnlyKeys(
      source,
      APPROVAL_KEYS,
      "Craft approval input"
    );
    const requestId = requireId(source.requestId, "Craft approval request");
    const mutationId = requireId(source.mutationId, "Craft approval mutation");
    const quote = requireObject(
      await this.craftingService.getQuote({ requestId }),
      "Craft approval quote"
    );
    requireMatchingId(quote.requestId, requestId, "Craft approval quote request ID");
    const expectedQuoteSignature = requireId(
      quote.signature,
      "Craft approval quote signature"
    );
    const project = requireObject(await this.craftingService.approveRequest({
      requestId,
      expectedQuoteSignature,
      mutationId
    }), "Approved craft project");
    const projectId = requireId(project.id, "Approved craft project");
    requireMatchingId(project.requestId, requestId, "Approved craft project request ID");
    const hoursPerDay = requireHours(project.hoursPerDay, "Approved craft project");
    if (typeof project.ownedWorkshop !== "boolean") {
      throw new Error("Approved craft project must preserve its ownedWorkshop selection.");
    }

    const linkedRequest = requireObject(await this.downtimeService.linkCraftProject(requestId, {
      projectId,
      hoursPerDay,
      ownedWorkshop: project.ownedWorkshop,
      mutationId
    }), "Linked downtime request");
    assertIdentity(
      requireId(linkedRequest.id, "Linked downtime request ID"),
      requestId,
      "Linked downtime request ID"
    );
    assertIdentity(
      requireId(linkedRequest.craftProjectId, "Linked craft project ID"),
      projectId,
      "Linked craft project ID"
    );
    assertIdentity(
      requireId(
        linkedRequest.craftApprovalMutationId,
        "Linked craft approval mutation ID"
      ),
      mutationId,
      "Linked craft approval mutation ID"
    );

    return project;
  }

  async pause(projectId, options = {}) {
    const safeProjectId = requireId(projectId, "Craft pause project");
    const source = requireObject(options, "Craft pause options");
    assertOnlyKeys(source, PAUSE_KEYS, "Craft pause options");
    const mutationId = requireId(source.mutationId, "Craft pause mutation");
    const reason = optionalText(source.reason, "Craft pause reason");
    return requireProjectResult(
      await this.craftingService.pauseProject(safeProjectId, { mutationId, reason }),
      safeProjectId,
      "Paused craft project"
    );
  }

  async resume(projectId, options = {}) {
    const safeProjectId = requireId(projectId, "Craft resume project");
    const source = requireObject(options, "Craft resume options");
    assertOnlyKeys(source, MUTATION_KEYS, "Craft resume options");
    const mutationId = requireId(source.mutationId, "Craft resume mutation");
    return requireProjectResult(
      await this.craftingService.resumeProject(safeProjectId, { mutationId }),
      safeProjectId,
      "Resumed craft project"
    );
  }

  async cancel(projectId, options = {}) {
    const safeProjectId = requireId(projectId, "Craft cancellation project");
    const source = requireObject(options, "Craft cancellation options");
    assertOnlyKeys(source, MUTATION_KEYS, "Craft cancellation options");
    const mutationId = requireId(source.mutationId, "Craft cancellation mutation");
    return requireProjectResult(
      await this.craftingService.cancelProject(safeProjectId, { mutationId }),
      safeProjectId,
      "Cancelled craft project"
    );
  }

  async reconcile(projectId, options = {}) {
    const safeProjectId = requireId(projectId, "Craft reconciliation project");
    const source = requireObject(options, "Craft reconciliation options");
    assertOnlyKeys(source, RECONCILE_KEYS, "Craft reconciliation options");
    const mutationId = requireId(source.mutationId, "Craft reconciliation mutation");
    const note = optionalText(source.note, "Craft reconciliation note");
    if (source.resume !== undefined && typeof source.resume !== "boolean") {
      throw new TypeError("Craft reconciliation resume must be a boolean.");
    }
    const resume = source.resume === true;
    return requireProjectResult(
      await this.craftingService.reconcileProject(safeProjectId, {
        mutationId,
        note,
        resume
      }),
      safeProjectId,
      "Reconciled craft project"
    );
  }

  async processScheduledSlot(slot, context = {}) {
    const sourceSlot = requireObject(slot, "Craft downtime slot");
    const sourceContext = requireObject(context, "Craft downtime processing context");
    requireId(sourceSlot.id, "Craft downtime slot");
    requireId(sourceSlot.requestId, "Craft downtime slot request");
    const activityId = requireId(sourceSlot.activityId, "Craft downtime slot activity");
    if (activityId !== CRAFT_ACTIVITY_ID) {
      throw new Error("Craft downtime service cannot process a non-craft activity link.");
    }
    const projectId = requireId(sourceSlot.projectId, "Craft downtime slot project");
    const isoDate = requireIsoDate(sourceSlot.isoDate, "Craft downtime slot");
    const contextIsoDate = requireIsoDate(sourceContext.isoDate, "Craft downtime context");
    if (contextIsoDate !== isoDate) {
      throw new Error("Craft downtime slot date does not match its processing context.");
    }
    const transitionId = requireId(
      sourceContext.transitionId,
      "Craft downtime transition"
    );
    const operationId = requireId(
      sourceContext.operationId,
      "Craft downtime operation"
    );
    const hours = requireHours(sourceSlot.hours, "Craft downtime slot");
    const outcome = requireObject(await this.craftingService.processProjectWorkday(projectId, {
      isoDate,
      transitionId,
      mutationId: operationId
    }), "Craft workday outcome");
    requireMatchingId(outcome.projectId, projectId, "Craft workday project ID");
    assertIdentity(outcome.activityId, CRAFT_ACTIVITY_ID, "Craft workday activity ID");
    if (!["processed", "blocked"].includes(outcome.status)) {
      throw new Error(`Craft workday returned unsupported status '${String(outcome.status ?? "")}'.`);
    }
    if (outcome.hours !== undefined && requireHours(outcome.hours, "Craft workday") !== hours) {
      throw new Error("Craft workday hours do not match the linked downtime slot.");
    }

    const receipt = {
      activityId: CRAFT_ACTIVITY_ID,
      projectId,
      hours,
      status: outcome.status,
      result: outcome.result ?? null
    };
    if (outcome.status === "blocked") {
      receipt.blockReason = requireId(outcome.blockReason, "Blocked craft workday reason");
    }
    return receipt;
  }
}

export { CRAFT_ACTIVITY_ID };
