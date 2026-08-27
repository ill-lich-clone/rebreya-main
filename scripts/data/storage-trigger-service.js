export const STORAGE_TRIGGER_EVENTS = Object.freeze([
  "beforeOpen", "afterOpen", "afterClaim", "emptied"
]);

export const STORAGE_TRIGGER_REPEAT_MODES = Object.freeze([
  "always", "onceGlobal", "oncePerCharacter"
]);

const SUPPORTED_STEP_TYPES = new Set([
  "conditionItem", "conditionVariable", "conditionResult",
  "abilityCheck", "savingThrow", "consumeItem", "damage",
  "requesterDialog", "chatMessage", "notification",
  "setVariable", "removeVariable", "branch", "allow", "deny", "finish", "macro"
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function serializableObject(value) {
  try {
    const cloned = clone(object(value));
    return cloned && typeof cloned === "object" && !Array.isArray(cloned) ? cloned : {};
  }
  catch (_error) {
    return {};
  }
}

export function createEmptyStorageTriggerState() {
  return {
    version: 1,
    revision: 0,
    chainsByEvent: Object.fromEntries(STORAGE_TRIGGER_EVENTS.map((event) => [event, []])),
    variables: {},
    executionState: { onceGlobal: {}, oncePerCharacter: {}, runs: {} }
  };
}

function chainUnsupported(chain) {
  if (!clean(chain?.id) || !STORAGE_TRIGGER_REPEAT_MODES.includes(chain?.repeat)) return true;
  if (!Array.isArray(chain?.steps) || !clean(chain?.entryStepId)) return true;
  return chain.steps.some((step) => !SUPPORTED_STEP_TYPES.has(clean(step?.type)));
}

function normalizeChain(value) {
  const chain = clone(object(value));
  if (chainUnsupported(chain)) return { unsupported: true, definition: chain };
  return chain;
}

export function normalizeStorageTriggerState(value) {
  const source = object(value);
  const empty = createEmptyStorageTriggerState();
  const chains = object(source.chainsByEvent);
  return {
    version: 1,
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    chainsByEvent: Object.fromEntries(STORAGE_TRIGGER_EVENTS.map((event) => [
      event,
      (Array.isArray(chains[event]) ? chains[event] : []).map(normalizeChain)
    ])),
    variables: serializableObject(source.variables),
    executionState: {
      onceGlobal: serializableObject(source.executionState?.onceGlobal),
      oncePerCharacter: serializableObject(source.executionState?.oncePerCharacter),
      runs: serializableObject(source.executionState?.runs)
    },
    ...(source.version !== undefined && source.version !== 1
      ? { unsupportedVersion: clone(source) }
      : {})
  };
}

function issue(code, event, chainId = "", stepId = "", details = {}) {
  return { code, event, chainId, stepId, ...details };
}

function validateChainGraph(event, chain, issues) {
  const chainId = clean(chain.id);
  const counts = new Map();
  for (const step of chain.steps) {
    const id = clean(step?.id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    if (!id) issues.push(issue("missing-step-id", event, chainId));
    else if (count > 1) issues.push(issue("duplicate-step-id", event, chainId, id));
  }
  const steps = new Map();
  for (const step of chain.steps) {
    const id = clean(step?.id);
    if (!steps.has(id)) steps.set(id, step);
  }
  const targets = (step) => [step?.nextStepId, step?.successStepId, step?.failureStepId]
    .map(clean).filter(Boolean);
  if (!steps.has(clean(chain.entryStepId))) {
    issues.push(issue("missing-entry", event, chainId, clean(chain.entryStepId)));
  }
  for (const step of chain.steps) {
    const stepId = clean(step?.id);
    if (clean(step?.type) === "deny" && event !== "beforeOpen") {
      issues.push(issue("deny-not-allowed", event, chainId, stepId));
    }
    for (const target of targets(step)) {
      if (!steps.has(target)) issues.push(issue("missing-target", event, chainId, stepId, { target }));
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) {
      issues.push(issue("cycle", event, chainId, id));
      return;
    }
    if (visited.has(id) || !steps.has(id)) return;
    visiting.add(id);
    for (const target of targets(steps.get(id))) visit(target);
    visiting.delete(id);
    visited.add(id);
  };
  visit(clean(chain.entryStepId));
}

export function validateStorageTriggerDefinitions(value) {
  const state = normalizeStorageTriggerState(value);
  const issues = [];
  if (state.unsupportedVersion) issues.push(issue("unsupported-version", ""));
  for (const event of STORAGE_TRIGGER_EVENTS) {
    const chainIds = new Set();
    for (const entry of state.chainsByEvent[event]) {
      if (entry?.unsupported === true) {
        const definition = object(entry.definition);
        issues.push(issue("unsupported-step", event, clean(definition.id)));
        continue;
      }
      const chainId = clean(entry.id);
      if (chainIds.has(chainId)) issues.push(issue("duplicate-chain-id", event, chainId));
      chainIds.add(chainId);
      validateChainGraph(event, entry, issues);
    }
  }
  return issues;
}
