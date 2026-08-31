import {
  createEmptyStorageTriggerState,
  normalizeStorageTriggerState,
  validateStorageTriggerDefinitions
} from "./storage-trigger-service.js";

const MODULE_ID = "rebreya-main";

export const DOOR_TRIGGER_EVENTS = Object.freeze(["beforeOpen", "afterOpen"]);
export const DOOR_TRIGGER_TARGET_FLAG = "doorTriggerTarget";

const FORBIDDEN_EVENTS = Object.freeze(["afterClaim", "emptied"]);
const FLAG_PATH = `flags.${MODULE_ID}.${DOOR_TRIGGER_TARGET_FLAG}`;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function validationError(issues) {
  const error = new Error("Конфигурация триггеров двери содержит ошибки.");
  error.code = "DOOR_TRIGGER_VALIDATION";
  error.issues = clone(issues);
  return error;
}

function unsupportedVersionError() {
  const error = new Error("Конфигурация двери создана более новой версией модуля.");
  error.code = "DOOR_TRIGGER_UNSUPPORTED_VERSION";
  return error;
}

function revisionConflictError() {
  const error = new Error("Конфигурация триггеров двери уже изменена: revision conflict.");
  error.code = "DOOR_TRIGGER_REVISION_CONFLICT";
  return error;
}

function normalizeDoorTriggers(value) {
  const normalized = normalizeStorageTriggerState(value);
  for (const event of FORBIDDEN_EVENTS) normalized.chainsByEvent[event] = [];
  return normalized;
}

function opaqueDefinitionCounts(state) {
  const counts = new Map();
  for (const event of DOOR_TRIGGER_EVENTS) {
    for (const chain of state.triggers.chainsByEvent[event]) {
      if (chain?.unsupported !== true) continue;
      const key = `${event}:${JSON.stringify(chain.definition)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function changedOpaqueIssues(current, candidate) {
  const counts = opaqueDefinitionCounts(current);
  const issues = [];
  for (const event of DOOR_TRIGGER_EVENTS) {
    for (const chain of candidate.chainsByEvent[event]) {
      if (chain?.unsupported !== true) continue;
      const key = `${event}:${JSON.stringify(chain.definition)}`;
      const remaining = counts.get(key) ?? 0;
      if (remaining > 0) counts.set(key, remaining - 1);
      else issues.push({
        code: "unsupported-step",
        event,
        chainId: String(chain.definition?.id ?? "")
      });
    }
  }
  return issues;
}

export function createEmptyDoorTriggerTargetState() {
  return {
    version: 1,
    enabled: false,
    triggers: createEmptyStorageTriggerState()
  };
}

export function normalizeDoorTriggerTargetState(value) {
  const source = object(value);
  if (source.version !== undefined && source.version !== 1) {
    return {
      ...createEmptyDoorTriggerTargetState(),
      unsupported: true,
      unsupportedVersion: clone(source)
    };
  }
  const triggers = normalizeDoorTriggers(source.triggers);
  const unsupported = triggers.unsupportedVersion !== undefined;
  return {
    version: 1,
    enabled: unsupported ? false : source.enabled === true,
    triggers,
    unsupported
  };
}

export function readDoorTriggerTarget(wall) {
  const raw = wall?.flags?.[MODULE_ID]?.[DOOR_TRIGGER_TARGET_FLAG];
  return {
    configured: raw !== undefined && raw !== null,
    ...normalizeDoorTriggerTargetState(raw)
  };
}

export class DoorTriggerTargetRepository {
  read(wall) {
    return readDoorTriggerTarget(wall);
  }

  async #write(wall, state) {
    if (wall?.documentName !== "Wall" || typeof wall?.update !== "function") {
      throw new TypeError("DoorTriggerTargetRepository requires a WallDocument.");
    }
    const normalized = normalizeDoorTriggerTargetState(state);
    if (normalized.unsupported) throw unsupportedVersionError();
    const persisted = {
      version: 1,
      enabled: normalized.enabled,
      triggers: normalized.triggers
    };
    await wall.update({ [FLAG_PATH]: clone(persisted) });
    return { configured: true, unsupported: false, ...clone(persisted) };
  }

  async saveDefinitions(wall, {
    enabled = false,
    definitions = {},
    expectedRevision = 0
  } = {}) {
    const current = readDoorTriggerTarget(wall);
    if (current.unsupported) throw unsupportedVersionError();
    const revision = Number(expectedRevision);
    if (!Number.isSafeInteger(revision) || revision !== current.triggers.revision) {
      throw revisionConflictError();
    }
    const chainsByEvent = object(definitions?.chainsByEvent);
    const forbiddenIssues = FORBIDDEN_EVENTS
      .filter((event) => Array.isArray(chainsByEvent[event]) && chainsByEvent[event].length > 0)
      .map((event) => ({ code: "event-not-allowed", event }));
    if (forbiddenIssues.length) throw validationError(forbiddenIssues);
    const candidate = normalizeDoorTriggers({
      ...current.triggers,
      chainsByEvent,
      revision: revision + 1
    });
    const issues = validateStorageTriggerDefinitions(candidate)
      .filter((entry) => entry.code !== "unsupported-step")
      .concat(changedOpaqueIssues(current, candidate));
    if (issues.length) throw validationError(issues);
    return this.#write(wall, {
      version: 1,
      enabled: enabled === true,
      triggers: candidate
    });
  }

  async updateRuntime(wall, mutate) {
    if (typeof mutate !== "function") throw new TypeError("Door trigger runtime mutation must be a function.");
    const current = readDoorTriggerTarget(wall);
    if (current.unsupported) throw unsupportedVersionError();
    const draft = clone(current.triggers);
    await mutate(draft);
    const next = normalizeDoorTriggers({
      ...draft,
      revision: current.triggers.revision,
      chainsByEvent: current.triggers.chainsByEvent
    });
    return this.#write(wall, {
      version: 1,
      enabled: current.enabled,
      triggers: next
    });
  }

  async resetExecutions(wall) {
    return this.updateRuntime(wall, (draft) => {
      draft.executionState = { onceGlobal: {}, oncePerCharacter: {}, runs: {} };
    });
  }
}
