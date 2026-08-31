import { createTriggerTargetRef } from "./trigger-target-coordinator.js";
import { MAX_DOOR_DISTANCE_FEET } from "../data/door-access.js";

const MODULE_ID = "rebreya-main";
const MAX_DEFINITIONS_LENGTH = 500_000;
const MAX_OPERATION_CACHE = 500;

export const DOOR_ERROR_CODES = Object.freeze({
  CHARACTER_REQUIRED: "DOOR_CHARACTER_REQUIRED",
  CHARACTER_UNAVAILABLE: "DOOR_CHARACTER_UNAVAILABLE",
  SCENE_MISMATCH: "DOOR_SCENE_MISMATCH",
  DISTANCE: "DOOR_DISTANCE",
  UNAVAILABLE: "DOOR_UNAVAILABLE",
  DISABLED: "DOOR_DISABLED",
  STATE_CHANGED: "DOOR_STATE_CHANGED",
  LOCKED: "DOOR_LOCKED",
  TRIGGER_DENIED: "DOOR_TRIGGER_DENIED"
});

function clean(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validString(value, { max = 512 } = {}) {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= max;
}

function validDefinitions(value) {
  if (!hasExactKeys(value, ["chainsByEvent"])) return false;
  const chains = object(value.chainsByEvent);
  const events = ["afterClaim", "afterOpen", "beforeOpen", "emptied"];
  if (!hasExactKeys(chains, events)) return false;
  if (!events.every((event) => Array.isArray(chains[event]) && chains[event].length <= 100)) return false;
  try {
    return JSON.stringify(value).length <= MAX_DEFINITIONS_LENGTH;
  }
  catch (_error) {
    return false;
  }
}

export function isValidDoorOpenPayload(payload) {
  return hasExactKeys(payload, ["wallUuid", "characterTokenUuid", "mutationId"])
    && validString(payload.wallUuid)
    && validString(payload.characterTokenUuid)
    && validString(payload.mutationId, { max: 160 });
}

export function isValidDoorTriggerReadPayload(payload) {
  return hasExactKeys(payload, ["wallUuid"]) && validString(payload.wallUuid);
}

export function isValidDoorTriggerSavePayload(payload) {
  return hasExactKeys(payload, ["wallUuid", "enabled", "definitions", "expectedRevision", "operationId"])
    && validString(payload.wallUuid)
    && typeof payload.enabled === "boolean"
    && Number.isSafeInteger(payload.expectedRevision)
    && payload.expectedRevision >= 0
    && validString(payload.operationId, { max: 160 })
    && validDefinitions(payload.definitions);
}

export function isValidDoorTriggerResetPayload(payload) {
  return hasExactKeys(payload, ["wallUuid", "operationId"])
    && validString(payload.wallUuid)
    && validString(payload.operationId, { max: 160 });
}

function errorWithCode(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function wallDoorStates() {
  return {
    closed: Number(globalThis.CONST?.WALL_DOOR_STATES?.CLOSED ?? 0),
    open: Number(globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1),
    locked: Number(globalThis.CONST?.WALL_DOOR_STATES?.LOCKED ?? 2)
  };
}

function sceneId(document) {
  return clean(document?.parent?.id);
}

function activeSupportedChains(triggers, event) {
  return (Array.isArray(triggers?.chainsByEvent?.[event]) ? triggers.chainsByEvent[event] : [])
    .filter((chain) => chain?.enabled === true && chain?.unsupported !== true);
}

export class DoorTriggerCommandService {
  constructor({ coordinator, resolveDocument, measureDistance, logger = console } = {}) {
    if (!coordinator || typeof coordinator.execute !== "function") {
      throw new TypeError("DoorTriggerCommandService requires TriggerTargetCoordinator.");
    }
    if (typeof resolveDocument !== "function" || typeof measureDistance !== "function") {
      throw new TypeError("DoorTriggerCommandService requires document and distance resolvers.");
    }
    this.coordinator = coordinator;
    this.resolveDocument = resolveDocument;
    this.measureDistance = measureDistance;
    this.logger = logger;
    this.queues = new Map();
    this.tasks = new Map();
    this.results = new Map();
    this.fingerprints = new Map();
  }

  async #resolveWall(wallUuid) {
    const wall = await this.resolveDocument(clean(wallUuid));
    const none = Number(globalThis.CONST?.WALL_DOOR_TYPES?.NONE ?? 0);
    if (wall?.documentName !== "Wall" || !sceneId(wall) || Number(wall?.door) === none) {
      throw errorWithCode(DOOR_ERROR_CODES.UNAVAILABLE, "Дверь недоступна.");
    }
    return wall;
  }

  async #resolveAdmin(payload, sender) {
    if (sender?.isGM !== true) throw new Error("Настраивать триггеры двери может только мастер.");
    return this.#resolveWall(payload?.wallUuid);
  }

  async #resolveDoorAndCharacter(payload, sender) {
    const wall = await this.#resolveWall(payload?.wallUuid);
    const secret = Number(globalThis.CONST?.WALL_DOOR_TYPES?.SECRET ?? 2);
    if (sender?.isGM !== true && Number(wall.door) === secret) {
      throw errorWithCode(DOOR_ERROR_CODES.UNAVAILABLE, "Дверь недоступна.");
    }
    const target = createTriggerTargetRef("door", wall.uuid);
    const snapshot = await this.coordinator.read(target, { document: wall });
    if (snapshot?.unsupported === true || snapshot?.enabled !== true) {
      throw errorWithCode(DOOR_ERROR_CODES.DISABLED, "Механика двери Rebreya выключена.");
    }
    const tokenUuid = clean(payload?.characterTokenUuid);
    if (!tokenUuid) {
      throw errorWithCode(DOOR_ERROR_CODES.CHARACTER_REQUIRED, "Выберите своего персонажа.");
    }
    const token = await this.resolveDocument(tokenUuid);
    const actor = token?.actor;
    if (token?.documentName !== "Token" || actor?.type !== "character"
      || token?.hidden === true || actor.testUserPermission?.(sender, "OWNER") !== true) {
      throw errorWithCode(DOOR_ERROR_CODES.CHARACTER_UNAVAILABLE, "Выбранный персонаж недоступен.");
    }
    if (!sceneId(token) || sceneId(token) !== sceneId(wall)) {
      throw errorWithCode(DOOR_ERROR_CODES.SCENE_MISMATCH, "Персонаж должен находиться на сцене с дверью.");
    }
    const distance = Number(await this.measureDistance(token, wall));
    if (!Number.isFinite(distance) || distance > MAX_DOOR_DISTANCE_FEET) {
      throw errorWithCode(DOOR_ERROR_CODES.DISTANCE, "Подойдите к двери на расстояние не более 10 футов.");
    }
    return { wall, target, snapshot, characterToken: token, character: actor, distance };
  }

  #triggerContext(event, payload, sender, access) {
    const runId = `${clean(payload.mutationId)}:${event}`;
    const requestFingerprint = fingerprint({
      event,
      wallUuid: clean(access.wall.uuid),
      characterTokenUuid: clean(access.characterToken.uuid),
      characterActorUuid: clean(access.character.uuid),
      senderId: clean(sender?.id)
    });
    return {
      targetKind: "door",
      targetUuid: clean(access.wall.uuid),
      wallUuid: clean(access.wall.uuid),
      sceneId: sceneId(access.wall),
      characterActorUuid: clean(access.character.uuid),
      characterTokenUuid: clean(access.characterToken.uuid),
      senderId: clean(sender?.id),
      runId,
      fingerprint: requestFingerprint
    };
  }

  #assertOpenableState(wall) {
    const { closed, locked } = wallDoorStates();
    if (![closed, locked].includes(Number(wall?.ds))) {
      throw errorWithCode(DOOR_ERROR_CODES.STATE_CHANGED, "Состояние двери уже изменилось.");
    }
  }

  #matchingBeforeOpenRun(access, payload, sender) {
    const context = this.#triggerContext("beforeOpen", payload, sender, access);
    const run = access.snapshot?.triggers?.executionState?.runs?.[context.runId];
    return run?.status === "complete" && run?.fingerprint === context.fingerprint;
  }

  async #executeAfterOpen(access, payload, sender) {
    try {
      await this.coordinator.execute(
        access.target,
        "afterOpen",
        this.#triggerContext("afterOpen", payload, sender, access),
        { document: access.wall }
      );
      return false;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Door afterOpen trigger failed after commit.`, error);
      return true;
    }
  }

  #assertFingerprint(key, value) {
    const existing = this.fingerprints.get(key);
    if (existing !== undefined && existing !== value) {
      throw new Error("Один mutationId нельзя повторно использовать с другими параметрами операции.");
    }
    if (existing === undefined) this.fingerprints.set(key, value);
  }

  async #enqueue(key, operation) {
    const previous = this.queues.get(key)?.catch(() => {}) ?? Promise.resolve();
    const queued = previous.then(operation);
    this.queues.set(key, queued);
    return queued.finally(() => {
      if (this.queues.get(key) === queued) this.queues.delete(key);
    });
  }

  async #runMutation(queueKey, mutationKey, operation, { requestFingerprint, authorize } = {}) {
    this.#assertFingerprint(mutationKey, requestFingerprint);
    if (this.results.has(mutationKey)) {
      await authorize?.();
      return clone(this.results.get(mutationKey));
    }
    if (this.tasks.has(mutationKey)) {
      await authorize?.();
      return this.tasks.get(mutationKey);
    }
    let started = false;
    const task = Promise.resolve()
      .then(() => authorize?.())
      .then(() => {
        started = true;
        return this.#enqueue(queueKey, operation);
      })
      .then((result) => {
        if (result?.postCommitWarning !== true) {
          this.results.set(mutationKey, clone(result));
          while (this.results.size > MAX_OPERATION_CACHE) this.results.delete(this.results.keys().next().value);
        }
        return result;
      })
      .catch((error) => {
        if (!started && this.fingerprints.get(mutationKey) === requestFingerprint) {
          this.fingerprints.delete(mutationKey);
        }
        throw error;
      })
      .finally(() => this.tasks.delete(mutationKey));
    this.tasks.set(mutationKey, task);
    return task;
  }

  async readTriggers(payload = {}, { sender } = {}) {
    const wallUuid = clean(payload.wallUuid);
    return this.#enqueue(`door:${wallUuid}`, async () => {
      const wall = await this.#resolveAdmin(payload, sender);
      const snapshot = await this.coordinator.read(createTriggerTargetRef("door", wall.uuid), { document: wall });
      return { wallUuid, enabled: snapshot.enabled === true, triggers: clone(snapshot.triggers) };
    });
  }

  async saveTriggers(payload = {}, { sender } = {}) {
    const wallUuid = clean(payload.wallUuid);
    const mutationKey = `door:triggers:save:${clean(payload.operationId)}`;
    const requestFingerprint = fingerprint({ payload, senderId: clean(sender?.id) });
    return this.#runMutation(`door:${wallUuid}`, mutationKey, async () => {
      const wall = await this.#resolveAdmin(payload, sender);
      const snapshot = await this.coordinator.saveDefinitions(
        createTriggerTargetRef("door", wall.uuid),
        {
          enabled: payload.enabled,
          definitions: payload.definitions,
          expectedRevision: payload.expectedRevision
        },
        { document: wall }
      );
      return { wallUuid, enabled: snapshot.enabled === true, triggers: clone(snapshot.triggers) };
    }, {
      requestFingerprint,
      authorize: () => this.#resolveAdmin(payload, sender)
    });
  }

  async resetTriggers(payload = {}, { sender } = {}) {
    const wallUuid = clean(payload.wallUuid);
    const mutationKey = `door:triggers:reset:${clean(payload.operationId)}`;
    const requestFingerprint = fingerprint({ payload, senderId: clean(sender?.id) });
    return this.#runMutation(`door:${wallUuid}`, mutationKey, async () => {
      const wall = await this.#resolveAdmin(payload, sender);
      const snapshot = await this.coordinator.resetExecutions(
        createTriggerTargetRef("door", wall.uuid),
        { document: wall }
      );
      return { wallUuid, enabled: snapshot.enabled === true, triggers: clone(snapshot.triggers) };
    }, {
      requestFingerprint,
      authorize: () => this.#resolveAdmin(payload, sender)
    });
  }

  async open(payload = {}, { sender } = {}) {
    const wallUuid = clean(payload.wallUuid);
    const mutationKey = `door:open:${clean(payload.mutationId)}`;
    const requestFingerprint = fingerprint({ payload, senderId: clean(sender?.id) });
    return this.#runMutation(`door:${wallUuid}`, mutationKey, async () => {
      let access = await this.#resolveDoorAndCharacter(payload, sender);
      const states = wallDoorStates();
      if (Number(access.wall.ds) === states.open) {
        if (!this.#matchingBeforeOpenRun(access, payload, sender)) this.#assertOpenableState(access.wall);
        const postCommitWarning = await this.#executeAfterOpen(access, payload, sender);
        return { wallUuid, state: states.open, opened: true, replayed: true, postCommitWarning };
      }
      this.#assertOpenableState(access.wall);
      if (Number(access.wall.ds) === states.locked
        && activeSupportedChains(access.snapshot.triggers, "beforeOpen").length === 0) {
        throw errorWithCode(DOOR_ERROR_CODES.LOCKED, "Дверь заперта.");
      }
      const gate = await this.coordinator.execute(
        access.target,
        "beforeOpen",
        this.#triggerContext("beforeOpen", payload, sender, access),
        { document: access.wall }
      );
      if (gate?.allowed === false) {
        throw errorWithCode(
          DOOR_ERROR_CODES.TRIGGER_DENIED,
          clean(gate.message) || "Действие запрещено."
        );
      }
      access = await this.#resolveDoorAndCharacter(payload, sender);
      this.#assertOpenableState(access.wall);
      await access.wall.update(
        { ds: states.open },
        { sound: true, rebreyaDoorTriggerBypass: true }
      );
      const postCommitWarning = await this.#executeAfterOpen(access, payload, sender);
      return { wallUuid, state: states.open, opened: true, replayed: false, postCommitWarning };
    }, {
      requestFingerprint,
      authorize: () => this.#resolveDoorAndCharacter(payload, sender)
    });
  }
}
