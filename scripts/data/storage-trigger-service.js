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
  if (value?.unsupported === true && value.definition && typeof value.definition === "object") {
    return { unsupported: true, definition: clone(value.definition) };
  }
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

function compareValues(actual, expected, operator) {
  if (operator === "eq") return Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
  if (operator === "ne") return !compareValues(actual, expected, "eq");
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  return false;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function normalizeMacroResult(value, event) {
  if (value === undefined) return { outcome: "continue", variables: {} };
  const source = object(value);
  const keys = Object.keys(source).sort();
  if (!keys.every((key) => ["outcome", "variables"].includes(key))
    || !["continue", "deny"].includes(source.outcome)
    || (source.outcome === "deny" && event !== "beforeOpen")) {
    throw new Error("Macro вернул недопустимый результат триггера.");
  }
  return { outcome: source.outcome, variables: serializableObject(source.variables) };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableFingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function pruneCompletedRuns(runs, maximum = 1000) {
  const completedIds = Object.keys(object(runs)).filter((id) => runs[id]?.status === "complete");
  for (const id of completedIds.slice(0, Math.max(0, completedIds.length - maximum))) delete runs[id];
}

export class StorageTriggerService {
  constructor({
    hasItem = async () => false,
    rollCheck = async () => ({ success: false }),
    consumeItem = async () => ({ success: true }),
    applyDamage = async () => ({ success: true }),
    showDialog = async () => false,
    createChatMessage = async () => {},
    notify = async () => {},
    executeMacro = async () => undefined,
    persistRuntime = async () => {},
    logger = console
  } = {}) {
    Object.assign(this, {
      hasItem, rollCheck, consumeItem, applyDamage, showDialog,
      createChatMessage, notify, executeMacro, persistRuntime, logger
    });
  }

  async #commit(state, context, mutate) {
    mutate(state);
    const persistRuntime = typeof context?.persistRuntime === "function"
      ? context.persistRuntime
      : this.persistRuntime;
    await persistRuntime(context, mutate);
  }

  #repeatKey(event, chain, context) {
    if (chain.repeat === "onceGlobal") return `${event}:${clean(chain.id)}`;
    if (chain.repeat === "oncePerCharacter") {
      const actorUuid = clean(context.characterActorUuid);
      if (!actorUuid) throw new Error("Для триггера требуется персонаж.");
      return `${event}:${clean(chain.id)}:${actorUuid}`;
    }
    return "";
  }

  #wasRepeated(state, chain, repeatKey) {
    if (!repeatKey) return false;
    return chain.repeat === "onceGlobal"
      ? state.executionState.onceGlobal[repeatKey] === true
      : state.executionState.oncePerCharacter[repeatKey] === true;
  }

  async #executeStep(event, step, context, state, priorResults) {
    const config = clone(object(step.config));
    const choose = (success, result = { success }) => ({
      nextStepId: clean(success ? step.successStepId : step.failureStepId),
      result
    });
    switch (step.type) {
      case "conditionItem": {
        const success = Boolean(await this.hasItem(context, config));
        const requiredItemName = !success && config.showItemName === true ? clean(config.itemName) : "";
        const usedItemName = success ? clean(config.itemName) : "";
        return choose(success, {
          success,
          ...(requiredItemName ? { requiredItemName } : {}),
          ...(usedItemName ? { usedItemName } : {})
        });
      }
      case "conditionVariable": {
        const actual = state.variables[clean(config.name)];
        return choose(compareValues(actual, config.value, clean(config.operator) || "eq"), { success: true, value: actual });
      }
      case "conditionResult": {
        const actual = priorResults[clean(config.stepId)];
        const value = Object.hasOwn(config, "value") ? actual?.value : actual?.success;
        const expected = Object.hasOwn(config, "value") ? config.value : config.success !== false;
        return choose(compareValues(value, expected, clean(config.operator) || "eq"), { success: true, value });
      }
      case "abilityCheck":
      case "savingThrow": {
        if (!clean(context.characterActorUuid)) throw new Error("Для проверки требуется персонаж.");
        const result = serializableObject(await this.rollCheck(context, { kind: step.type, ...config }));
        return choose(result.success === true, result);
      }
      case "consumeItem": {
        if (!clean(context.characterActorUuid)) throw new Error("Для расходования предмета требуется персонаж.");
        const result = serializableObject(await this.consumeItem(context, config));
        return { nextStepId: clean(step.nextStepId), result: { success: result.success !== false, ...result } };
      }
      case "damage": {
        if (!clean(context.characterActorUuid)) throw new Error("Для урона требуется персонаж.");
        const result = serializableObject(await this.applyDamage(context, config));
        return { nextStepId: clean(step.nextStepId), result: { success: result.success !== false, ...result } };
      }
      case "requesterDialog": {
        const value = await this.showDialog(context, config);
        return choose(Boolean(value), { success: Boolean(value), value: clone(value) });
      }
      case "chatMessage":
      case "notification": {
        try {
          if (step.type === "chatMessage") await this.createChatMessage(context, config);
          else await this.notify(context, config);
        }
        catch (error) {
          this.logger?.warn?.("Storage trigger presentation failed.", error);
        }
        return { nextStepId: clean(step.nextStepId), result: { success: true } };
      }
      case "setVariable": return {
        nextStepId: clean(step.nextStepId), result: { success: true, value: clone(config.value) },
        variables: { [clean(config.name)]: clone(config.value) }
      };
      case "removeVariable": return {
        nextStepId: clean(step.nextStepId), result: { success: true }, removeVariable: clean(config.name)
      };
      case "branch": {
        const result = priorResults[clean(config.stepId)] ?? Object.values(priorResults).at(-1);
        return choose(result?.success === true, { success: result?.success === true, value: clone(result?.value) });
      }
      case "macro": {
        const targetKind = clean(context.targetKind) || "storage";
        const macroContext = deepFreeze({
          event,
          runId: clean(context.runId),
          stepId: clean(step.id),
          targetKind,
          targetUuid: clean(context.targetUuid) || clean(context.tokenUuid),
          sceneId: clean(context.sceneId),
          senderId: clean(context.senderId),
          characterActorUuid: clean(context.characterActorUuid),
          characterTokenUuid: clean(context.characterTokenUuid),
          ...(targetKind === "storage" ? {
            tokenUuid: clean(context.tokenUuid),
            path: clone(Array.isArray(context.path) ? context.path : []),
            claimSummary: clone(context.claimSummary ?? null)
          } : {}),
          variables: clone(state.variables),
          priorResults: clone(priorResults)
        });
        const raw = await this.executeMacro(macroContext, config);
        const result = normalizeMacroResult(raw, event);
        return {
          nextStepId: clean(step.nextStepId),
          terminal: result.outcome === "deny" ? { allowed: false, message: "Действие запрещено." } : null,
          variables: result.variables,
          result: { success: result.outcome !== "deny", value: result.outcome }
        };
      }
      case "allow": return { terminal: { allowed: true }, result: { success: true } };
      case "deny": {
        const requiredItemName = Object.values(priorResults)
          .map((result) => clean(result?.requiredItemName))
          .filter(Boolean)
          .at(-1) ?? "";
        const message = clean(config.message) || "Действие запрещено.";
        return {
          terminal: {
            allowed: false,
            message: requiredItemName ? `${message} Требуется предмет: «${requiredItemName}».` : message
          },
          result: { success: false }
        };
      }
      case "finish": return { terminal: { allowed: true }, result: { success: true } };
      default: throw new Error(`Исполнитель шага ${step.type} недоступен.`);
    }
  }

  async execute(event, value, context = {}) {
    const state = normalizeStorageTriggerState(value);
    if (!STORAGE_TRIGGER_EVENTS.includes(event)) throw new Error("Неизвестное событие триггера.");
    const runId = clean(context.runId);
    if (!runId) throw new Error("Для триггера требуется run ID.");
    const fingerprint = clean(context.fingerprint) || stableFingerprint({ event, ...context, runId: undefined });
    let run = state.executionState.runs[runId];
    if (run && run.fingerprint !== fingerprint) throw new Error("Trigger run fingerprint нельзя связать с другими параметрами.");
    if (run?.status === "complete") return clone(run.result);
    if (!run) {
      await this.#commit(state, context, (draft) => {
        draft.executionState.runs[runId] = {
          fingerprint, event, status: "pending", steps: {}, completedChainIds: []
        };
      });
      run = state.executionState.runs[runId];
    }
    const usedItemNames = [];

    for (const chain of state.chainsByEvent[event]) {
      if (chain?.enabled !== true) continue;
      if (chain?.unsupported === true) throw new Error("Цепочка триггера использует неподдерживаемое определение.");
      const chainId = clean(chain.id);
      if (run.completedChainIds.includes(chainId)) continue;
      const repeatKey = this.#repeatKey(event, chain, context);
      if (this.#wasRepeated(state, chain, repeatKey)) continue;
      const steps = new Map(chain.steps.map((step) => [clean(step.id), step]));
      const priorResults = {};
      let stepId = clean(chain.entryStepId);
      let terminal = null;
      let guard = 0;
      while (stepId) {
        if (++guard > chain.steps.length + 1) throw new Error("Цепочка триггера не завершилась.");
        const step = steps.get(stepId);
        if (!step) throw new Error("Шаг триггера недоступен.");
        const receiptKey = `${chainId}:${stepId}`;
        let receipt = run.steps[receiptKey];
        if (!receipt) {
          const outcome = await this.#executeStep(event, step, context, state, priorResults);
          receipt = clone({
            result: outcome.result ?? { success: true },
            nextStepId: clean(outcome.nextStepId),
            terminal: outcome.terminal ?? null
          });
          await this.#commit(state, context, (draft) => {
            if (outcome.removeVariable) delete draft.variables[outcome.removeVariable];
            Object.assign(draft.variables, clone(outcome.variables) ?? {});
            draft.executionState.runs[runId].steps[receiptKey] = clone(receipt);
          });
          run = state.executionState.runs[runId];
        }
        priorResults[stepId] = clone(receipt.result);
        const usedItemName = clean(receipt.result?.usedItemName);
        if (receipt.result?.success === true && usedItemName && !usedItemNames.includes(usedItemName)) {
          usedItemNames.push(usedItemName);
        }
        terminal = receipt.terminal;
        if (terminal) break;
        stepId = clean(receipt.nextStepId);
      }
      await this.#commit(state, context, (draft) => {
        const currentRun = draft.executionState.runs[runId];
        if (!currentRun.completedChainIds.includes(chainId)) currentRun.completedChainIds.push(chainId);
        if (repeatKey && terminal?.allowed !== false) {
          const bucket = chain.repeat === "onceGlobal" ? "onceGlobal" : "oncePerCharacter";
          draft.executionState[bucket][repeatKey] = true;
        }
      });
      run = state.executionState.runs[runId];
      if (terminal?.allowed === false) {
        const result = { ...terminal, completedChainIds: clone(run.completedChainIds) };
        await this.#commit(state, context, (draft) => {
          Object.assign(draft.executionState.runs[runId], { status: "complete", result: clone(result) });
          pruneCompletedRuns(draft.executionState.runs);
        });
        return result;
      }
    }
    const result = {
      allowed: true,
      completedChainIds: clone(run.completedChainIds),
      ...(usedItemNames.length > 0 ? { usedItemNames: clone(usedItemNames) } : {})
    };
    await this.#commit(state, context, (draft) => {
      Object.assign(draft.executionState.runs[runId], { status: "complete", result: clone(result) });
      pruneCompletedRuns(draft.executionState.runs);
    });
    return result;
  }
}
