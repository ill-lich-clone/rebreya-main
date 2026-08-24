import { captureInventoryIngressIdentity } from "../data/inventory-ingress-descriptor.js";

export const INVENTORY_INGRESS_PLAN_VERSION = 1;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function nullableId(value) {
  return value === null || cleanId(value) === value;
}

function wireId(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && cleanId(value) === value;
}

function validWireAction(action) {
  if (hasExactKeys(action, ["type"])) {
    return action.type === "skip" || action.type === "dismantle";
  }
  return hasExactKeys(action, ["folderId", "type"])
    && (action.type === "folder" || action.type === "legacy")
    && (action.folderId === null || wireId(action.folderId));
}

function validWireIdentity(identity, quantity) {
  return hasExactKeys(identity, [
    "documentType", "durabilityState", "quantity", "sourceId", "sourceType"
  ])
    && [identity.documentType, identity.durabilityState, identity.sourceId, identity.sourceType]
      .every((value) => typeof value === "string" && cleanId(value) === value)
    && Number.isFinite(identity.quantity)
    && identity.quantity > 0
    && identity.quantity === quantity;
}

export function isValidSerializedInventoryIngressPlan(plan) {
  if (!hasExactKeys(plan, [
    "groupActorId", "requestedFolderId", "rootOverrideSourceKeys", "rows", "rulesRevision", "version"
  ])
    || plan.version !== INVENTORY_INGRESS_PLAN_VERSION
    || !wireId(plan.groupActorId)
    || !Number.isSafeInteger(plan.rulesRevision)
    || plan.rulesRevision < 0
    || !(plan.requestedFolderId === null || wireId(plan.requestedFolderId))
    || !Array.isArray(plan.rows)
    || !Array.isArray(plan.rootOverrideSourceKeys)) {
    return false;
  }
  const sourceKeys = new Set();
  const actionableKeys = new Set();
  for (const row of plan.rows) {
    if (!hasExactKeys(row, ["action", "identity", "matchedRuleId", "quantity", "sourceKey"])
      || !wireId(row.sourceKey)
      || sourceKeys.has(row.sourceKey)
      || !Number.isFinite(row.quantity)
      || row.quantity <= 0
      || !(row.matchedRuleId === null || wireId(row.matchedRuleId))
      || !validWireAction(row.action)
      || !validWireIdentity(row.identity, row.quantity)) {
      return false;
    }
    sourceKeys.add(row.sourceKey);
    if (row.action.type === "skip" || row.action.type === "dismantle") actionableKeys.add(row.sourceKey);
  }
  const overrides = new Set();
  for (const sourceKey of plan.rootOverrideSourceKeys) {
    if (!wireId(sourceKey) || overrides.has(sourceKey) || !actionableKeys.has(sourceKey)) return false;
    overrides.add(sourceKey);
  }
  return true;
}

export class InventoryIngressPlanError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryIngressPlanError";
    this.code = code;
    this.details = deepFreeze(clone(details));
  }
}

function fail(code, message, details) {
  throw new InventoryIngressPlanError(code, message, details);
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) fail("invalid-rows", "Inventory ingress rows must be an array.");
  const sourceKeys = new Set();
  return rows.map((row) => {
    if (!hasExactKeys(row, ["sourceKey", "quantity", "itemData", "legacyFolderId", "container"])) {
      fail("invalid-row", "Inventory ingress row must use the exact detached shape.");
    }
    const sourceKey = cleanId(row.sourceKey);
    if (!sourceKey || sourceKey !== row.sourceKey
      || !Number.isFinite(row.quantity) || row.quantity <= 0
      || !isPlainObject(row.itemData)
      || !nullableId(row.legacyFolderId)) {
      fail("invalid-row", `Inventory ingress row '${sourceKey}' is invalid.`);
    }
    if (sourceKeys.has(sourceKey)) {
      fail("duplicate-source-key", `Duplicate inventory ingress source key: ${sourceKey}.`, { sourceKey });
    }
    sourceKeys.add(sourceKey);
    return {
      sourceKey,
      quantity: row.quantity,
      itemData: clone(row.itemData),
      legacyFolderId: row.legacyFolderId,
      container: clone(row.container)
    };
  });
}

function previewAction(decision, legacyFolderId) {
  if (!decision) return deepFreeze({ type: "legacy", folderId: legacyFolderId });
  if (decision.action?.type === "folder") {
    return deepFreeze({ type: "folder", folderId: cleanId(decision.action.folderId) });
  }
  if (decision.action?.type === "skip" || decision.action?.type === "dismantle") {
    return deepFreeze({ type: decision.action.type });
  }
  fail("invalid-decision", "Compiled inventory ingress rule returned an unsupported action.");
}

function canonicalOverrideKeys(preview, values) {
  if (!Array.isArray(values)) fail("invalid-root-override", "Root overrides must be an array.");
  const requested = new Set();
  for (const value of values) {
    const sourceKey = cleanId(value);
    if (!sourceKey || sourceKey !== value || requested.has(sourceKey)) {
      fail("invalid-root-override", "Root override source keys must be unique trimmed IDs.");
    }
    requested.add(sourceKey);
  }
  const actionable = new Set(preview.rows
    .filter((row) => row.action.type === "skip" || row.action.type === "dismantle")
    .map((row) => row.sourceKey));
  for (const sourceKey of requested) {
    if (!actionable.has(sourceKey)) {
      fail("invalid-root-override", `Source '${sourceKey}' cannot be overridden to root.`, { sourceKey });
    }
  }
  return Object.freeze(preview.rows
    .map((row) => row.sourceKey)
    .filter((sourceKey) => requested.has(sourceKey)));
}

export class InventoryIngressPlanner {
  constructor({ readRules, buildDescriptor, resolveDismantleOutputs, compilerCache, confirm } = {}) {
    if (typeof readRules !== "function"
      || typeof buildDescriptor !== "function"
      || typeof resolveDismantleOutputs !== "function"
      || typeof compilerCache?.get !== "function"
      || typeof confirm !== "function") {
      throw new TypeError("InventoryIngressPlanner requires rule, descriptor, compiler and confirmation dependencies.");
    }
    this.readRules = readRules;
    this.buildDescriptor = buildDescriptor;
    this.resolveDismantleOutputs = resolveDismantleOutputs;
    this.compilerCache = compilerCache;
    this.confirm = confirm;
  }

  async preview({ groupActorId, requestedFolderId = null, rows, batch = false } = {}) {
    const safeGroupActorId = cleanId(groupActorId);
    if (!safeGroupActorId || safeGroupActorId !== groupActorId || !nullableId(requestedFolderId)) {
      fail("invalid-request", "Inventory ingress preview group or folder target is invalid.");
    }
    const detachedRows = normalizeRows(rows);
    const ruleState = await this.readRules(safeGroupActorId);
    const compiled = this.compilerCache.get(safeGroupActorId, ruleState);
    const descriptors = await Promise.all(detachedRows.map((row) => this.buildDescriptor(row.itemData)));
    const decisions = compiled.evaluateMany(descriptors);
    if (!Array.isArray(decisions) || decisions.length !== detachedRows.length) {
      fail("invalid-decisions", "Compiled inventory ingress decisions do not match the requested rows.");
    }
    const previewRows = await Promise.all(detachedRows.map(async (row, index) => {
      const descriptor = descriptors[index];
      const decision = decisions[index];
      const action = previewAction(decision, row.legacyFolderId);
      const dismantlePreview = action.type === "dismantle"
        ? clone(await this.resolveDismantleOutputs(row.itemData, row.quantity))
        : [];
      return deepFreeze({
        sourceKey: row.sourceKey,
        displayName: cleanId(row.itemData.name) || row.sourceKey,
        identity: captureInventoryIngressIdentity(descriptor, row.quantity),
        quantity: row.quantity,
        matchedRuleId: decision ? cleanId(decision.ruleId) : null,
        action,
        dismantlePreview
      });
    }));
    return deepFreeze({
      version: INVENTORY_INGRESS_PLAN_VERSION,
      groupActorId: safeGroupActorId,
      rulesRevision: ruleState.revision,
      requestedFolderId,
      batch: batch === true,
      rows: previewRows
    });
  }

  async collectChoices(preview) {
    const needsDismantleConfirmation = preview.rows.some((row) => row.action.type === "dismantle");
    const needsSingleSkipConfirmation = preview.batch !== true
      && preview.rows.length === 1
      && preview.rows[0].action.type === "skip";
    if (!needsDismantleConfirmation && !needsSingleSkipConfirmation) {
      return deepFreeze({ rootOverrideSourceKeys: [] });
    }
    const result = await this.confirm(preview);
    if (result == null) return null;
    if (!hasExactKeys(result, ["rootOverrideSourceKeys"])) {
      fail("invalid-confirmation", "Inventory ingress confirmation returned an invalid choice.");
    }
    return deepFreeze({
      rootOverrideSourceKeys: canonicalOverrideKeys(preview, result.rootOverrideSourceKeys)
    });
  }

  serialize(preview, { rootOverrideSourceKeys = [] } = {}) {
    const overrides = canonicalOverrideKeys(preview, rootOverrideSourceKeys);
    return deepFreeze({
      version: INVENTORY_INGRESS_PLAN_VERSION,
      groupActorId: preview.groupActorId,
      rulesRevision: preview.rulesRevision,
      requestedFolderId: preview.requestedFolderId,
      rows: preview.rows.map((row) => ({
        sourceKey: row.sourceKey,
        identity: clone(row.identity),
        quantity: row.quantity,
        matchedRuleId: row.matchedRuleId,
        action: clone(row.action)
      })),
      rootOverrideSourceKeys: overrides
    });
  }

  assertParity(serializedPlan, authoritativePreview) {
    try {
      const authoritative = this.serialize(authoritativePreview, {
        rootOverrideSourceKeys: serializedPlan?.rootOverrideSourceKeys
      });
      if (JSON.stringify(serializedPlan) !== JSON.stringify(authoritative)) {
        fail("plan-stale", "Inventory ingress plan no longer matches authoritative state.");
      }
      return true;
    }
    catch (error) {
      if (error instanceof InventoryIngressPlanError && error.code === "plan-stale") throw error;
      throw new InventoryIngressPlanError(
        "plan-stale",
        "Inventory ingress plan no longer matches authoritative state.",
        { causeCode: error?.code ?? "invalid-plan" }
      );
    }
  }
}
