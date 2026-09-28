export const INVENTORY_INGRESS_RULES_VERSION = 1;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS = deepFreeze({
  sourceKind: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceType: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceId: { kind: "identity", operators: ["is", "isNot", "in", "notIn"] },
  documentType: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  systemTypeValue: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  systemTypeSubtype: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  sourceCategory: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  rarity: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  rank: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  durabilityState: { kind: "enum", operators: ["is", "isNot", "in", "notIn"] },
  unitValue: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  unitWeight: { kind: "number", operators: ["lt", "lte", "eq", "gte", "gt", "between"] },
  predominantMaterialId: { kind: "identity", operators: ["is", "isNot", "in", "notIn"] },
  dismantlable: { kind: "boolean", operators: ["is"] }
});

export class InventoryIngressRuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "InventoryIngressRuleError";
    this.code = code;
    this.details = deepFreeze(structuredClone(details));
  }
}

function fail(code, message, details) {
  throw new InventoryIngressRuleError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowed.has(key));
}

function normalizeNonemptyString(value, code, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) fail(code, `${label} must be a non-empty string.`);
  return normalized;
}

function normalizeStringSet(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("invalid-condition-value", "Condition set must contain at least one value.");
  }
  const normalized = value.map((entry) => normalizeNonemptyString(
    entry,
    "invalid-condition-value",
    "Condition value"
  ));
  return Object.freeze([...new Set(normalized)].sort((left, right) => left.localeCompare(right)));
}

function normalizeCondition(condition) {
  if (!hasExactKeys(condition, ["field", "operator", "value"])) {
    fail("invalid-condition-shape", "Condition must use the exact field/operator/value shape.");
  }
  const field = normalizeNonemptyString(condition.field, "unknown-condition-field", "Condition field");
  const definition = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[field];
  if (!definition) fail("unknown-condition-field", `Unknown inventory ingress field: ${field}.`, { field });
  const operator = normalizeNonemptyString(
    condition.operator,
    "invalid-condition-operator",
    "Condition operator"
  );
  if (!definition.operators.includes(operator)) {
    fail("invalid-condition-operator", `Operator ${operator} is invalid for ${field}.`, { field, operator });
  }

  let value;
  if (definition.kind === "enum" || definition.kind === "identity") {
    value = operator === "in" || operator === "notIn"
      ? normalizeStringSet(condition.value)
      : normalizeNonemptyString(condition.value, "invalid-condition-value", "Condition value");
  } else if (definition.kind === "number") {
    if (operator === "between") {
      if (!Array.isArray(condition.value)
        || condition.value.length !== 2
        || !condition.value.every(Number.isFinite)
        || condition.value[0] > condition.value[1]) {
        fail("invalid-condition-value", `Condition ${field} between requires an ascending finite pair.`);
      }
      value = Object.freeze([condition.value[0], condition.value[1]]);
    } else {
      if (!Number.isFinite(condition.value)) {
        fail("invalid-condition-value", `Condition ${field} requires a finite number.`);
      }
      value = condition.value;
    }
  } else {
    if (typeof condition.value !== "boolean") {
      fail("invalid-condition-value", `Condition ${field} requires a boolean.`);
    }
    value = condition.value;
  }
  return deepFreeze({ field, operator, value });
}

function normalizeAction(action) {
  if (!isPlainObject(action) || typeof action.type !== "string") {
    fail("invalid-action-shape", "Rule action must be an object with a supported type.");
  }
  if (action.type === "folder") {
    if (!hasExactKeys(action, ["type", "folderId"])) {
      fail("invalid-action-shape", "Folder action must use the exact type/folderId shape.");
    }
    return deepFreeze({
      type: "folder",
      folderId: normalizeNonemptyString(action.folderId, "invalid-action", "Folder ID")
    });
  }
  if (action.type === "skip" || action.type === "dismantle") {
    if (!hasExactKeys(action, ["type"])) {
      fail("invalid-action-shape", `${action.type} action accepts no additional fields.`);
    }
    return deepFreeze({ type: action.type });
  }
  fail("invalid-action", `Unknown inventory ingress action: ${action.type}.`, { type: action.type });
}

function formatCondition(condition) {
  const value = Array.isArray(condition.value)
    ? condition.operator === "between"
      ? `${condition.value[0]}..${condition.value[1]}`
      : condition.value.join(", ")
    : String(condition.value);
  return `${condition.field} ${condition.operator} ${value}`;
}

function formatAction(action) {
  return action.type === "folder" ? `folder ${action.folderId}` : action.type;
}

function describeNormalizedRule(rule) {
  const conditions = rule.conditions.length > 0
    ? rule.conditions.map(formatCondition).join(" & ")
    : "all items";
  return `${conditions} → ${formatAction(rule.action)}`;
}

export function normalizeInventoryIngressRule(rule) {
  if (!hasExactKeys(rule, ["id", "conditions", "action"], ["name"])) {
    fail("invalid-rule-shape", "Rule must use the exact id/name/conditions/action shape.");
  }
  const id = normalizeNonemptyString(rule.id, "invalid-rule-id", "Rule ID");
  if (!Array.isArray(rule.conditions)) {
    fail("invalid-rule-shape", "Rule conditions must be an array.");
  }
  const conditions = rule.conditions.map(normalizeCondition);
  const seenFields = new Set();
  for (const condition of conditions) {
    if (seenFields.has(condition.field)) {
      fail("duplicate-condition-field", `Rule ${id} constrains ${condition.field} more than once.`, {
        ruleId: id,
        field: condition.field
      });
    }
    seenFields.add(condition.field);
  }
  const action = normalizeAction(rule.action);
  const partial = { id, name: "", conditions: Object.freeze(conditions), action };
  const suppliedName = typeof rule.name === "string" ? rule.name.trim() : "";
  const name = suppliedName || describeNormalizedRule(partial);
  return deepFreeze({ ...partial, name });
}

export function describeInventoryIngressRule(rule) {
  return describeNormalizedRule(normalizeInventoryIngressRule(rule));
}

export function createEmptyInventoryIngressRuleState() {
  return deepFreeze({ version: INVENTORY_INGRESS_RULES_VERSION, revision: 0, rules: [] });
}

export function normalizeInventoryIngressRuleState(rawState) {
  if (rawState == null) return createEmptyInventoryIngressRuleState();
  if (!hasExactKeys(rawState, ["version", "revision", "rules"])) {
    fail("invalid-state-shape", "Inventory ingress rule state has unknown or missing fields.");
  }
  if (rawState.version !== INVENTORY_INGRESS_RULES_VERSION) {
    fail("unsupported-version", `Unsupported inventory ingress rule state version: ${rawState.version}.`);
  }
  if (!Number.isSafeInteger(rawState.revision) || rawState.revision < 0) {
    fail("invalid-revision", "Inventory ingress rule revision must be a non-negative safe integer.");
  }
  if (!Array.isArray(rawState.rules)) fail("invalid-state-shape", "Inventory ingress rules must be an array.");
  const rules = rawState.rules.map(normalizeInventoryIngressRule)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const normalizedRule of rules) {
    if (ids.has(normalizedRule.id)) {
      fail("duplicate-rule-id", `Duplicate inventory ingress rule ID: ${normalizedRule.id}.`, {
        ruleId: normalizedRule.id
      });
    }
    ids.add(normalizedRule.id);
  }
  return deepFreeze({ version: INVENTORY_INGRESS_RULES_VERSION, revision: rawState.revision, rules });
}

function conditionConstraint(condition) {
  const definition = INVENTORY_INGRESS_RULE_FIELD_DEFINITIONS[condition.field];
  if (definition.kind === "enum" || definition.kind === "identity") {
    if (condition.operator === "is" || condition.operator === "in") {
      return { kind: "set", allowed: new Set(Array.isArray(condition.value) ? condition.value : [condition.value]), excluded: new Set() };
    }
    return { kind: "set", allowed: null, excluded: new Set(Array.isArray(condition.value) ? condition.value : [condition.value]) };
  }
  if (definition.kind === "boolean") {
    return { kind: "boolean", value: condition.value };
  }
  if (condition.operator === "between") {
    return {
      kind: "number",
      min: condition.value[0],
      max: condition.value[1],
      minInclusive: true,
      maxInclusive: true
    };
  }
  if (condition.operator === "eq") {
    return { kind: "number", min: condition.value, max: condition.value, minInclusive: true, maxInclusive: true };
  }
  if (condition.operator === "lt" || condition.operator === "lte") {
    return {
      kind: "number",
      min: -Infinity,
      max: condition.value,
      minInclusive: false,
      maxInclusive: condition.operator === "lte"
    };
  }
  return {
    kind: "number",
    min: condition.value,
    max: Infinity,
    minInclusive: condition.operator === "gte",
    maxInclusive: false
  };
}

function buildRuleConstraints(rule) {
  const constraints = new Map(rule.conditions.map((condition) => [
    condition.field,
    conditionConstraint(condition)
  ]));
  let impossible = false;
  if (rule.action.type === "dismantle") {
    const existing = constraints.get("dismantlable");
    if (existing?.kind === "boolean" && existing.value === false) impossible = true;
    else constraints.set("dismantlable", { kind: "boolean", value: true });
  }
  return { constraints, impossible };
}

function setIntersectionPossible(left, right) {
  let allowed = null;
  if (left.allowed && right.allowed) {
    allowed = [...left.allowed].filter((value) => right.allowed.has(value));
  } else if (left.allowed || right.allowed) {
    allowed = [...(left.allowed || right.allowed)];
  }
  if (allowed) {
    return allowed.some((value) => !left.excluded.has(value) && !right.excluded.has(value));
  }
  return true;
}

function numberIntersectionPossible(left, right) {
  const min = Math.max(left.min, right.min);
  const max = Math.min(left.max, right.max);
  if (min < max) return true;
  if (min > max) return false;
  const leftIncludes = (min !== left.min || left.minInclusive) && (min !== left.max || left.maxInclusive);
  const rightIncludes = (min !== right.min || right.minInclusive) && (min !== right.max || right.maxInclusive);
  return leftIncludes && rightIncludes;
}

function constraintIntersectionPossible(left, right) {
  if (!left || !right) return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "set") return setIntersectionPossible(left, right);
  if (left.kind === "boolean") return left.value === right.value;
  return numberIntersectionPossible(left, right);
}

export function findInventoryIngressRuleConflicts(rules) {
  if (!Array.isArray(rules)) fail("invalid-state-shape", "Rules must be an array.");
  const normalized = rules.map(normalizeInventoryIngressRule);
  const compiled = normalized.map((entry) => ({ rule: entry, ...buildRuleConstraints(entry) }));
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < compiled.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < compiled.length; rightIndex += 1) {
      const left = compiled[leftIndex];
      const right = compiled[rightIndex];
      if (left.impossible || right.impossible) continue;
      const fields = [...new Set([
        ...left.constraints.keys(),
        ...right.constraints.keys()
      ])].sort((a, b) => a.localeCompare(b));
      if (fields.some((field) => !constraintIntersectionPossible(
        left.constraints.get(field),
        right.constraints.get(field)
      ))) continue;
      conflicts.push(deepFreeze({
        leftRuleId: left.rule.id,
        rightRuleId: right.rule.id,
        intersectingFields: fields
      }));
    }
  }
  return deepFreeze(conflicts);
}

function matchesConstraint(value, constraint) {
  if (value === undefined || value === null) return false;
  if (constraint.kind === "set") {
    if (typeof value !== "string") return false;
    return (!constraint.allowed || constraint.allowed.has(value)) && !constraint.excluded.has(value);
  }
  if (constraint.kind === "boolean") return typeof value === "boolean" && value === constraint.value;
  if (!Number.isFinite(value)) return false;
  const aboveMin = value > constraint.min || (value === constraint.min && constraint.minInclusive);
  const belowMax = value < constraint.max || (value === constraint.max && constraint.maxInclusive);
  return aboveMin && belowMax;
}

function addIndexEntry(index, field, value, ruleId) {
  if (!index.has(field)) index.set(field, new Map());
  const values = index.get(field);
  if (!values.has(value)) values.set(value, new Set());
  values.get(value).add(ruleId);
}

function chooseRuleIndex(ruleEntry) {
  const sourceType = ruleEntry.constraints.get("sourceType");
  const sourceId = ruleEntry.constraints.get("sourceId");
  if (sourceType?.kind === "set" && sourceType.allowed?.size
    && sourceId?.kind === "set" && sourceId.allowed?.size) {
    return {
      field: "sourceType+sourceId",
      values: [...sourceType.allowed].flatMap((type) => [...sourceId.allowed].map((id) => `${type}\u0000${id}`))
    };
  }
  let selected = null;
  for (const [field, constraint] of ruleEntry.constraints) {
    const values = constraint.kind === "set" && constraint.allowed
      ? [...constraint.allowed]
      : constraint.kind === "boolean"
        ? [String(constraint.value)]
        : null;
    if (values && (!selected || values.length < selected.values.length)) selected = { field, values };
  }
  return selected;
}

export function compileInventoryIngressRules(rawState) {
  const state = normalizeInventoryIngressRuleState(rawState);
  const conflicts = findInventoryIngressRuleConflicts(state.rules);
  if (conflicts.length > 0) {
    fail("rule-conflict", "Inventory ingress rules overlap.", { conflicts });
  }
  const entries = state.rules.map((rule) => ({ rule, ...buildRuleConstraints(rule) }));
  const entryById = new Map(entries.map((entry) => [entry.rule.id, entry]));
  const index = new Map();
  const globalRuleIds = new Set();
  for (const entry of entries) {
    if (entry.impossible) continue;
    const selected = chooseRuleIndex(entry);
    if (!selected) {
      globalRuleIds.add(entry.rule.id);
      continue;
    }
    for (const value of selected.values) addIndexEntry(index, selected.field, value, entry.rule.id);
  }

  function candidateRuleIds(descriptor) {
    const candidates = new Set(globalRuleIds);
    for (const [field, values] of index) {
      const value = field === "sourceType+sourceId"
        ? typeof descriptor?.sourceType === "string" && typeof descriptor?.sourceId === "string"
          ? `${descriptor.sourceType}\u0000${descriptor.sourceId}`
          : undefined
        : field === "dismantlable"
          ? typeof descriptor?.[field] === "boolean" ? String(descriptor[field]) : undefined
          : descriptor?.[field];
      if (value === undefined || value === null) continue;
      for (const ruleId of values.get(value) || []) candidates.add(ruleId);
    }
    return Object.freeze([...candidates].sort((left, right) => left.localeCompare(right)));
  }

  function evaluateMany(descriptors) {
    if (!Array.isArray(descriptors)) fail("invalid-descriptors", "Descriptors must be an array.");
    const decisions = descriptors.map((descriptor) => {
      const matches = [];
      for (const ruleId of candidateRuleIds(descriptor)) {
        const entry = entryById.get(ruleId);
        if (!entry || entry.impossible) continue;
        if ([...entry.constraints].every(([field, constraint]) => matchesConstraint(descriptor?.[field], constraint))) {
          matches.push(entry.rule);
        }
      }
      if (matches.length > 1) {
        fail("runtime-rule-conflict", "More than one inventory ingress rule matched.", {
          ruleIds: matches.map((rule) => rule.id)
        });
      }
      if (matches.length === 0) return null;
      return deepFreeze({ ruleId: matches[0].id, action: structuredClone(matches[0].action) });
    });
    return deepFreeze(decisions);
  }

  return Object.freeze({ candidateRuleIds, evaluateMany });
}

export class InventoryIngressRuleCompilerCache {
  #entries = new Map();

  get(groupActorId, rawState) {
    const normalizedGroupActorId = normalizeNonemptyString(
      groupActorId,
      "invalid-group-actor-id",
      "Group Actor ID"
    );
    const state = normalizeInventoryIngressRuleState(rawState);
    const key = `${normalizedGroupActorId}\u0000${state.revision}`;
    if (!this.#entries.has(key)) this.#entries.set(key, compileInventoryIngressRules(state));
    return this.#entries.get(key);
  }

  clear(groupActorId = "") {
    const normalized = typeof groupActorId === "string" ? groupActorId.trim() : "";
    if (!normalized) {
      this.#entries.clear();
      return;
    }
    const prefix = `${normalized}\u0000`;
    for (const key of this.#entries.keys()) {
      if (key.startsWith(prefix)) this.#entries.delete(key);
    }
  }
}
