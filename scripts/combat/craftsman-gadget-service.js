import {
  CLASS_FEATURES_COMPENDIUM_NAME,
  CRAFTSMAN_CLASS_IDENTIFIER,
  MODULE_ID
} from "../constants.js";
import {
  buildCraftsmanGadgetItemSource,
  buildCraftsmanGadgetStateUpdate,
  expandCraftsmanGadgetSelection,
  getCraftsmanGadgetQuantity
} from "../data/craftsman-gadget-item-data.js";
import { CRAFTSMAN_GADGET_MUTATION_COMMAND } from "../integrations/craftsman-gadget-socket.js";
import { getCraftsmanSubclasses } from "../integrations/craftsman-subclass-tracks.js";

const MECHANIC_ARCHETYPE_ID = "craftsman-research-mechanic";
const ACTIVATION_CLAIM_TTL_MS = 300_000;

function cleanString(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents.filter(Boolean);
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection?.values === "function") return Array.from(collection.values()).filter(Boolean);
  return [];
}

function moduleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function templateState(document) {
  return moduleFlags(document).craftsmanGadgetTemplate ?? null;
}

function instanceState(document) {
  return moduleFlags(document).craftsmanGadget ?? null;
}

function actorGadgetState(actor) {
  return actor?.flags?.[MODULE_ID]?.craftsmanGadgets ?? null;
}

function activityState(activity) {
  return moduleFlags(activity).craftsmanGadget ?? null;
}

function craftsmanClass(actor) {
  return collectionValues(actor?.items).find((item) => (
    item?.type === "class" && item?.system?.identifier === CRAFTSMAN_CLASS_IDENTIFIER
  )) ?? null;
}

function numericScaleValue(scale) {
  const candidates = [scale?.value, scale?.max, scale];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }
  return null;
}

function defaultRandomId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isLongRest(result = {}, config = {}) {
  if (result?.longRest === true || config?.longRest === true) return true;
  return [result?.type, result?.restType, result?.period, config?.type, config?.restType, config?.period]
    .some((value) => {
      const text = cleanString(value).toLowerCase();
      return text === "long" || text === "lr" || text.includes("продолж");
    });
}

function documentId(document) {
  return cleanString(document?.id ?? document?._id);
}

function actorItems(actor) {
  return collectionValues(actor?.items);
}

function resolveActorItem(actor, item) {
  const id = documentId(item);
  return actor?.items?.get?.(id)
    ?? actorItems(actor).find((candidate) => documentId(candidate) === id)
    ?? item;
}

function applyFlatUpdate(target, update) {
  for (const [path, value] of Object.entries(update)) {
    const keys = path.split(".");
    let destination = target;
    for (const key of keys.slice(0, -1)) destination = destination[key] ??= {};
    destination[keys.at(-1)] = clone(value);
  }
  return target;
}

function embeddedItemSource(item) {
  const source = item?.toObject instanceof Function ? item.toObject() : clone(item);
  for (const key of ["_id", "id", "uuid", "folder", "pack", "parent", "actor", "ownership", "sort"]) {
    delete source[key];
  }
  return source;
}

function getArchetypeId(item) {
  return cleanString(moduleFlags(item).archetypeId);
}

function combatTurnKey(combat) {
  const id = cleanString(combat?.id ?? combat?._id);
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  return id && Number.isFinite(round) && Number.isFinite(turn) ? `${id}:${round}:${turn}` : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getCraftsmanGadgetCapacity(actor) {
  if (!craftsmanClass(actor)) return 0;
  const scale = actor?.system?.scale?.[CRAFTSMAN_CLASS_IDENTIFIER]?.gadgets;
  const scaleValue = numericScaleValue(scale);
  if (scaleValue !== null) return scaleValue;
  const level = Math.max(0, Math.floor(Number(craftsmanClass(actor)?.system?.levels) || 0));
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return level >= 1 ? 2 : 0;
}

export function getPreparedCraftsmanGadgets(actor) {
  return actorItems(actor).filter((item) => instanceState(item)?.managed === true);
}

export class CraftsmanGadgetService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._actorQueues = new Map();
    this._activationClaims = new Map();
    this._knownActors = new Set();
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config) || getCraftsmanGadgetCapacity(actor) <= 0) return true;
    this._knownActors.add(actor);
    return this.#queueActorMutation(actor, () => this.#replaceLoadout(actor));
  }

  async executeAuthoritativeMutation(payload) {
    const actor = await this.#resolveUuid(payload?.actorUuid);
    if (!actor) return false;
    if (payload?.kind !== "use") return false;
    const item = actor?.items?.get?.(cleanString(payload.itemId))
      ?? actorItems(actor).find((candidate) => documentId(candidate) === cleanString(payload.itemId));
    const state = instanceState(item);
    const authorizedTemplates = await this.#resolveAuthorizedTemplates(
      payload.templateUuids,
      actor,
      state,
      payload.operation
    );
    const results = { templates: authorizedTemplates.templates };
    if (!authorizedTemplates.valid) {
      await this.#deleteRejectedTemplates(results);
      return false;
    }
    const actorState = actorGadgetState(actor) ?? {};
    if (
      !item
      || state?.managed !== true
      || cleanString(state.catalogId) !== cleanString(payload.gadgetId)
      || cleanString(state.instanceId) !== cleanString(payload.expectedInstanceId)
      || cleanString(actorState.restGeneration) !== cleanString(payload.expectedRestGeneration)
      || cleanString(actorState.activeInstanceId) !== cleanString(payload.expectedActiveInstanceId)
    ) {
      await this.#deleteRejectedTemplates(results);
      return false;
    }
    const activity = {
      item,
      actor,
      flags: {
        [MODULE_ID]: {
          craftsmanGadget: {
            gadgetId: cleanString(payload.gadgetId),
            operation: cleanString(payload.operation)
          }
        }
      }
    };
    return this.applyDnd5ePostUseActivity(activity, {}, results, {});
  }

  applyDnd5ePreUseActivity(activity) {
    const operation = activityState(activity);
    if (!operation) return true;
    const item = activity?.item;
    const state = instanceState(item);
    if (!state?.managed || state.catalogId !== operation.gadgetId) return false;
    if (state.ownerUuid && cleanString(item?.actor?.uuid) !== cleanString(state.ownerUuid)) return false;
    if (operation.operation === "activate") {
      return state.state === "prepared" && getCraftsmanGadgetQuantity(item) > 0;
    }
    if (operation.operation === "action") {
      return state.state === "active"
        && state.actionUsed !== true
        && this.#worldTime() < Number(state.expiresAtWorldTime ?? Infinity);
    }
    return false;
  }

  async applyDnd5ePostUseActivity(activity, _usageConfig = {}, results = {}, _messageConfig = {}) {
    const operation = activityState(activity);
    if (!operation) return true;
    if (!this.applyDnd5ePreUseActivity(activity)) return false;
    const workflowItem = activity.item;
    const actor = workflowItem?.actor ?? activity?.actor;
    if (!actor) return false;
    const item = resolveActorItem(actor, workflowItem);
    this._knownActors.add(actor);
    if (
      operation.operation === "activate"
      && !this.#claimActivation(actor, activity, workflowItem, instanceState(workflowItem))
    ) return false;
    if (this.#shouldRouteMutation()) {
      const actorState = actorGadgetState(actor) ?? {};
      const payload = {
        kind: "use",
        actorUuid: cleanString(actor?.uuid),
        itemId: documentId(item),
        gadgetId: cleanString(operation.gadgetId),
        operation: cleanString(operation.operation),
        expectedInstanceId: cleanString(instanceState(workflowItem)?.instanceId),
        expectedActiveInstanceId: cleanString(actorState.activeInstanceId),
        expectedRestGeneration: cleanString(actorState.restGeneration),
        templateUuids: this.#placedTemplates(results)
          .map((entry) => cleanString((entry?.document ?? entry)?.uuid))
          .filter(Boolean)
      };
      try {
        const accepted = await this.moduleApi.socketCommandBus.request(
          CRAFTSMAN_GADGET_MUTATION_COMMAND,
          payload
        );
        if (accepted !== true) await this.#deleteRejectedTemplates(results);
        return accepted === true;
      }
      finally {
        if (operation.operation === "activate") this.#releaseActivationClaim(actor, activity);
      }
    }
    if (operation.operation === "activate") {
      const expectedInstanceId = cleanString(instanceState(workflowItem)?.instanceId);
      return this.#queueActorMutation(actor, async () => {
        const currentState = instanceState(item);
        if (
          currentState?.state !== "prepared"
          || cleanString(currentState.instanceId) !== expectedInstanceId
          || getCraftsmanGadgetQuantity(item) < 1
        ) {
          await this.#deleteRejectedTemplates(results);
          return false;
        }

        const previousActive = getPreparedCraftsmanGadgets(actor).filter((other) => (
          other !== item && instanceState(other)?.state === "active"
        ));
        const previousActiveInstanceId = cleanString(actorGadgetState(actor)?.activeInstanceId);
        let activation = null;
        const spentPrevious = [];
        try {
          activation = await this.#activateGadget(actor, item);
          await this.#applyGadgetActivation(actor, activation.activeItem);
          for (const other of previousActive) {
            spentPrevious.push({ item: other, state: clone(instanceState(other)) });
            await this.#spendGadget(actor, other, "replaced");
          }
          await this.#updateActorGadgetState(actor, {
            activeInstanceId: cleanString(instanceState(activation.activeItem)?.instanceId)
          });
          if (instanceState(activation.activeItem)?.catalogId === "smoke-device") {
            const zoneService = this.options.zoneService;
            const placedTemplates = this.#placedTemplates(results);
            for (const template of placedTemplates) {
              zoneService?.registerTemplate?.(template?.document ?? template);
            }
          }
          return true;
        }
        catch (error) {
          if (activation?.activeItem) {
            try {
              await this.#cleanupGadget(actor, activation.activeItem, instanceState(activation.activeItem));
            }
            catch (cleanupError) {
              this.#logError(`${MODULE_ID} | Failed to clean up a rolled-back Craftsman gadget.`, cleanupError);
            }
            try {
              await activation.rollback();
            }
            catch (rollbackError) {
              this.#logError(`${MODULE_ID} | Failed to roll back a Craftsman gadget activation.`, rollbackError);
            }
          }
          for (const previous of spentPrevious) {
            try {
              await this.#restoreActiveGadget(actor, previous.item, previous.state);
            }
            catch (restoreError) {
              this.#logError(`${MODULE_ID} | Failed to restore the previous active Craftsman gadget.`, restoreError);
            }
          }
          try {
            await this.#updateActorGadgetState(actor, { activeInstanceId: previousActiveInstanceId });
          }
          catch (stateError) {
            this.#logError(`${MODULE_ID} | Failed to restore Craftsman gadget actor state.`, stateError);
          }
          await this.#deleteRejectedTemplates(results);
          throw error;
        }
      }).finally(() => this.#releaseActivationClaim(actor, activity));
    }
    const expectedInstanceId = cleanString(instanceState(workflowItem)?.instanceId);
    return this.#queueActorMutation(actor, async () => {
      const currentState = instanceState(item);
      if (
        currentState?.state !== "active"
        || currentState.actionUsed === true
        || cleanString(currentState.instanceId) !== expectedInstanceId
      ) return false;
      await this.#updateGadgetState(item, { actionUsed: true });
      try {
        await this.#applyGadgetAction(actor, item);
      }
      catch (error) {
        await this.#updateGadgetState(item, { actionUsed: false });
        throw error;
      }
      return true;
    });
  }

  applyDnd5ePreCreateActivityTemplate(activity, templateData = {}) {
    const operation = activityState(activity);
    const item = activity?.item;
    const state = instanceState(item);
    if (operation?.operation !== "activate" || state?.catalogId !== "smoke-device") return true;
    if (!this.#claimActivation(item?.actor ?? activity?.actor, activity, item, state)) return false;
    templateData.flags ??= {};
    templateData.flags[MODULE_ID] ??= {};
    templateData.flags[MODULE_ID].craftsmanSmoke = {
      instanceId: state.instanceId,
      ownerActorUuid: cleanString(item?.actor?.uuid),
      craftsmanLevel: this.#craftsmanLevel(item?.actor),
      poisoned: false,
      expiresAtTurnKey: this.#nextOwnerTurnKey(item?.actor)
    };
    return true;
  }

  applyDnd5eAttackRollConfig(config = {}, dialog = {}) {
    const actor = config?.subject?.actor ?? config?.subject?.item?.actor ?? null;
    const targets = collectionValues(
      this.options.attackTargets?.(config)
      ?? globalThis.game?.user?.targets
    );
    const targetToken = targets.length === 1 ? targets[0] : null;
    const targetActor = targetToken?.actor ?? targetToken?.document?.actor ?? null;
    const attackAcBonus = this.getWeaponAttackAcBonus(targetActor, config?.subject);
    if (attackAcBonus && Number.isFinite(Number(config.target)) && config.craftsmanMagneticAcApplied !== true) {
      config.target = Number(config.target) + attackAcBonus;
      config.craftsmanMagneticAcApplied = true;
    }

    const sourceToken = this.options.sourceToken?.(actor, config)
      ?? actor?.getActiveTokens?.(true, true)?.[0]
      ?? actor?.getActiveTokens?.()?.[0]
      ?? null;
    if (sourceToken && targetToken && this.options.zoneService?.isSightObscured?.(sourceToken, targetToken)) {
      dialog.disadvantage = true;
      for (const roll of config.rolls ?? []) {
        roll.options ??= {};
        roll.options.disadvantage = true;
      }
    }

    const gadget = this.#activeGadget(actor, "force-glove");
    if (!gadget || instanceState(gadget)?.forceAdvantageAvailable !== true) return true;
    dialog.advantage = true;
    config.rolls ??= [];
    for (const roll of config.rolls) {
      roll.options ??= {};
      roll.options.advantage = true;
    }
    return true;
  }

  async applyDnd5eRollAttack(rolls = [], context = {}) {
    const actor = context?.subject?.actor ?? context?.subject?.item?.actor ?? null;
    const gadget = this.#activeGadget(actor, "force-glove");
    if (!gadget) return true;
    const state = instanceState(gadget);
    const roll = collectionValues(rolls)[0];
    const total = Number(roll?.total);
    const target = Number(roll?.options?.target);
    const turnKey = this.#turnKey();
    const isEligibleHit = Number.isFinite(total)
      && Number.isFinite(target)
      && total >= target
      && state.forceDamageUsedTurnKey !== turnKey;
    const patch = {
      ...(state.forceAdvantageAvailable === true ? { forceAdvantageAvailable: false } : {}),
      ...(isEligibleHit ? { forceDamagePending: true, forceDamagePendingTurnKey: turnKey } : {})
    };
    const persistence = Object.keys(patch).length ? this.#updateGadgetState(gadget, patch) : Promise.resolve(true);
    if (!isEligibleHit) {
      await persistence;
      return true;
    }
    const confirm = this.options.confirmForceDamage;
    const accepted = typeof confirm === "function" ? await confirm(actor, gadget, roll, context) : true;
    await persistence;
    if (!accepted) {
      await this.#updateGadgetState(gadget, { forceDamagePending: false, forceDamagePendingTurnKey: "" });
    }
    return true;
  }

  applyDnd5ePreRollDamage(config = {}) {
    const actor = config?.subject?.actor ?? config?.subject?.item?.actor ?? null;
    const gadget = this.#activeGadget(actor, "force-glove");
    const state = instanceState(gadget);
    const turnKey = this.#turnKey();
    if (!gadget || state?.forceDamagePending !== true || state.forceDamageUsedTurnKey === turnKey) return true;
    const base = collectionValues(config?.rolls).find((entry) => entry?.base) ?? config?.rolls?.[0];
    if (!base) return true;
    base.parts ??= [];
    if (!base.parts.includes("@abilities.int.mod")) base.parts.push("@abilities.int.mod");
    const next = {
      ...clone(state),
      forceDamagePending: false,
      forceDamagePendingTurnKey: "",
      forceDamageUsedTurnKey: turnKey
    };
    gadget.flags[MODULE_ID].craftsmanGadget = next;
    gadget.update?.({ [`flags.${MODULE_ID}.craftsmanGadget`]: next })?.catch?.((error) => {
      this.#logError(`${MODULE_ID} | Failed to persist Force Glove damage use.`, error);
    });
    return true;
  }

  getWeaponAttackAcBonus(targetActor, attackActivity) {
    if (attackActivity?.item?.type !== "weapon") return 0;
    return this.#activeGadget(targetActor, "magnetic-engine") ? 2 : 0;
  }

  suppressesProvokedAttack(actor) {
    const marker = cleanString(actorGadgetState(actor)?.noProvokedMovementTurnKey);
    return Boolean(marker) && marker === this.#turnKey();
  }

  async handleCombatTurnChange(combat) {
    if (typeof this.options.isActiveGmClient === "function" && !this.options.isActiveGmClient()) return false;
    const currentTurnKey = combatTurnKey(combat);
    for (const actor of this.#actorDocuments()) {
      const marker = cleanString(actorGadgetState(actor)?.noProvokedMovementTurnKey);
      if (marker && marker !== currentTurnKey) {
        await this.#updateActorGadgetState(actor, { noProvokedMovementTurnKey: "" });
      }
      for (const gadget of getPreparedCraftsmanGadgets(actor)) {
        const state = instanceState(gadget);
        if (state?.forceDamageUsedTurnKey && state.forceDamageUsedTurnKey !== currentTurnKey) {
          await this.#updateGadgetState(gadget, {
            forceDamageUsedTurnKey: "",
            forceDamagePending: false,
            forceDamagePendingTurnKey: ""
          });
        }
      }
    }
    return true;
  }

  async handleWorldTime(worldTime = this.#worldTime()) {
    if (typeof this.options.isActiveGmClient === "function" && !this.options.isActiveGmClient()) return false;
    const now = Number(worldTime);
    if (!Number.isFinite(now)) return false;
    let changed = false;
    for (const actor of this.#actorDocuments()) {
      for (const item of getPreparedCraftsmanGadgets(actor)) {
        const state = instanceState(item);
        if (state?.state !== "active" || Number(state.expiresAtWorldTime) > now) continue;
        await this.#spendGadget(actor, item, "expired");
        changed = true;
      }
    }
    return changed;
  }

  async handleDeletedItem(item) {
    const state = instanceState(item);
    if (!state?.managed) return false;
    const actor = item?.actor ?? item?.parent ?? null;
    if (!actor) return false;
    await this.#cleanupGadget(actor, item, state);
    if (cleanString(actorGadgetState(actor)?.activeInstanceId) === cleanString(state.instanceId)) {
      await this.#updateActorGadgetState(actor, { activeInstanceId: "" });
    }
    return true;
  }

  async #replaceLoadout(actor) {
    const oldGadgets = getPreparedCraftsmanGadgets(actor);
    const initialActorState = clone(actorGadgetState(actor) ?? {});
    const savedSelectedIds = Array.isArray(actorGadgetState(actor)?.selectedIds)
      ? actorGadgetState(actor).selectedIds.map(cleanString).filter(Boolean)
      : [];
    const previousSelectedIds = savedSelectedIds.length
      ? savedSelectedIds
      : expandCraftsmanGadgetSelection(oldGadgets);
    const restGeneration = this.#randomId();
    const choices = await this.#availableTemplates(actor);
    if (!choices.length) return false;

    const capacity = getCraftsmanGadgetCapacity(actor);
    const selected = await this.#promptLoadout(actor, choices, capacity, previousSelectedIds);
    const requestedIds = Array.isArray(selected)
      ? selected.map(cleanString).filter(Boolean)
      : previousSelectedIds;
    const byId = new Map(choices.map((entry) => [entry.id, entry]));
    const catalogIds = requestedIds.slice(0, capacity).filter((id) => byId.has(id));
    if (!catalogIds.length) return false;
    if (Array.isArray(selected) && catalogIds.length !== capacity) {
      globalThis.ui?.notifications?.warn?.(`Выберите ${capacity} гаджета.`);
      return false;
    }

    const needsVehicle = catalogIds.some((catalogId) => byId.get(catalogId)?.availability === "mechanic");
    let researchVehicle = needsVehicle
      ? await this.options.vehicleService?.resolveResearchObject?.(actor) ?? null
      : null;
    if (needsVehicle && !researchVehicle) {
      researchVehicle = await this.options.vehicleService?.selectResearchObject?.(actor) ?? null;
    }
    const payload = {
      kind: "rest",
      actorUuid: cleanString(actor?.uuid),
      catalogIds,
      restGeneration,
      expectedRestGeneration: cleanString(initialActorState.restGeneration),
      expectedActiveInstanceId: cleanString(initialActorState.activeInstanceId),
      vehicleUuid: cleanString(researchVehicle?.uuid)
    };
    return this.#commitLoadout(actor, payload, choices);
  }

  async #commitLoadout(actor, payload, suppliedChoices = null) {
    const currentActorState = actorGadgetState(actor) ?? {};
    if (
      cleanString(currentActorState.restGeneration) !== cleanString(payload.expectedRestGeneration)
      || cleanString(currentActorState.activeInstanceId) !== cleanString(payload.expectedActiveInstanceId)
    ) return false;

    const choices = suppliedChoices ?? await this.#availableTemplates(actor);
    const byId = new Map(choices.map((entry) => [entry.id, entry]));
    const capacity = getCraftsmanGadgetCapacity(actor);
    const catalogIds = Array.isArray(payload.catalogIds)
      ? payload.catalogIds.map(cleanString).filter((id) => byId.has(id)).slice(0, capacity)
      : [];
    if (!catalogIds.length || catalogIds.length !== payload.catalogIds.length) return false;

    const oldGadgets = getPreparedCraftsmanGadgets(actor);
    const restGeneration = cleanString(payload.restGeneration);
    const groupedSelections = new Map();
    for (const catalogId of catalogIds) {
      const vehicleUuid = byId.get(catalogId)?.availability === "mechanic"
        ? cleanString(payload.vehicleUuid)
        : "";
      const key = `${catalogId}\u0000${vehicleUuid}`;
      const group = groupedSelections.get(key) ?? { catalogId, vehicleUuid, quantity: 0 };
      group.quantity += 1;
      groupedSelections.set(key, group);
    }
    const createData = Array.from(groupedSelections.values()).map((group) => (
      buildCraftsmanGadgetItemSource(byId.get(group.catalogId).documentData, {
        catalogId: group.catalogId,
        ownerUuid: cleanString(actor?.uuid),
        instanceId: this.#randomId(),
        restGeneration,
        quantity: group.quantity,
        vehicleUuid: group.vehicleUuid
      })
    ));

    try {
      const created = await actor.createEmbeddedDocuments?.("Item", createData) ?? [];
      const createdStates = collectionValues(created).map(instanceState).filter(Boolean);
      if (createdStates.length !== createData.length || new Set(createdStates.map((state) => state.instanceId)).size !== createData.length) {
        throw new Error("Craftsman gadget generation was not created completely");
      }
      for (const oldGadget of oldGadgets) {
        await this.#cleanupGadget(actor, oldGadget, instanceState(oldGadget));
      }
      const oldIds = oldGadgets.map(documentId).filter(Boolean);
      if (oldIds.length) await actor.deleteEmbeddedDocuments?.("Item", oldIds);
      await this.#updateActorGadgetState(actor, {
        restGeneration,
        selectedIds: catalogIds,
        activeInstanceId: ""
      });
      return true;
    }
    catch (error) {
      const partialIds = actorItems(actor)
        .filter((item) => instanceState(item)?.restGeneration === restGeneration)
        .map(documentId)
        .filter(Boolean);
      if (partialIds.length) {
        try {
          await actor.deleteEmbeddedDocuments?.("Item", partialIds);
        }
        catch (rollbackError) {
          this.#logError(`${MODULE_ID} | Failed to roll back partially prepared Craftsman gadgets.`, rollbackError);
        }
      }
      this.#logError(`${MODULE_ID} | Failed to prepare Craftsman gadgets after long rest.`, error);
      return false;
    }
  }

  async #availableTemplates(actor) {
    const level = Math.max(0, Math.floor(Number(craftsmanClass(actor)?.system?.levels) || 0));
    const mechanic = this.#isMechanic(actor);
    const documents = await this.#templateDocuments();
    return documents.flatMap((document) => {
      const state = templateState(document);
      if (!state?.gadgetId) return [];
      if (state.availability === "mechanic" && !mechanic) return [];
      if (Math.max(1, Number(state.requiredLevel) || 1) > level) return [];
      const raw = typeof document?.toObject === "function" ? document.toObject() : clone(document);
      return [{
        id: cleanString(state.gadgetId),
        name: cleanString(document?.name, state.gadgetId),
        availability: cleanString(state.availability, "base"),
        documentData: raw
      }];
    });
  }

  #isMechanic(actor) {
    try {
      const resolver = this.options.getCraftsmanSubclasses ?? getCraftsmanSubclasses;
      return getArchetypeId(resolver(actor)?.research) === MECHANIC_ARCHETYPE_ID;
    }
    catch (error) {
      this.#logError(`${MODULE_ID} | Failed to resolve Craftsman research for gadget choices.`, error);
      return false;
    }
  }

  async #templateDocuments() {
    if (typeof this.options.getTemplateDocuments === "function") {
      return collectionValues(await this.options.getTemplateDocuments());
    }
    const pack = globalThis.game?.packs?.get?.(`world.${CLASS_FEATURES_COMPENDIUM_NAME}`);
    return typeof pack?.getDocuments === "function" ? collectionValues(await pack.getDocuments()) : [];
  }

  async #promptLoadout(actor, choices, capacity, previousSelectedIds) {
    if (typeof this.options.promptLoadout === "function") {
      return this.options.promptLoadout(actor, clone(choices), {
        capacity,
        previous: clone(previousSelectedIds)
      });
    }
    if (!actor?.isOwner && !globalThis.game?.user?.isGM) return null;
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") return null;
    const previous = clone(previousSelectedIds);
    const selects = Array.from({ length: capacity }, (_, index) => {
      const options = choices.map((choice) => (
        `<option value="${escapeHtml(choice.id)}"${previous[index] === choice.id ? " selected" : ""}>${escapeHtml(choice.name)}</option>`
      )).join("");
      return `<div class="form-group"><label>Гаджет ${index + 1}</label><select name="gadget-${index}">${options}</select></div>`;
    }).join("");
    return DialogV2.wait({
      window: { title: "Подготовка гаджетов" },
      content: `<form>${selects}</form>`,
      buttons: [{
        action: "prepare",
        label: "Подготовить",
        default: true,
        callback: (_event, button, dialog) => Array.from(
          dialog?.element?.querySelectorAll?.('select[name^="gadget-"]') ?? []
        ).map((element) => cleanString(element.value))
      }, {
        action: "cancel",
        label: "Отмена",
        callback: () => null
      }],
      close: () => null
    });
  }

  #randomId() {
    return cleanString(this.options.randomId?.() ?? defaultRandomId());
  }

  #shouldRouteMutation() {
    if (typeof this.moduleApi?.socketCommandBus?.request !== "function") return false;
    if (this.options.hasActiveGm?.() === false) return false;
    return this.options.isActiveGmClient?.() === false;
  }

  async #resolveUuid(uuid) {
    const resolver = this.options.fromUuid ?? globalThis.fromUuid;
    if (typeof resolver === "function") {
      const document = await resolver(cleanString(uuid));
      if (document) return document;
    }
    if (cleanString(uuid).startsWith("Actor.")) {
      return globalThis.game?.actors?.get?.(cleanString(uuid).split(".").at(-1)) ?? null;
    }
    return null;
  }

  #actorMutationKey(actor) {
    return cleanString(actor?.uuid ?? actor?.id) || actor;
  }

  #claimActivation(actor, activity, item, state = instanceState(item)) {
    if (!actor || !activity) return false;
    const key = this.#actorMutationKey(actor);
    const now = Date.now();
    const existing = this._activationClaims.get(key);
    if (existing && now - existing.createdAt > ACTIVATION_CLAIM_TTL_MS) {
      this._activationClaims.delete(key);
    }
    const current = this._activationClaims.get(key);
    if (current) {
      return current.activity === activity
        && current.itemId === documentId(item)
        && current.instanceId === cleanString(state?.instanceId);
    }
    this._activationClaims.set(key, {
      activity,
      itemId: documentId(item),
      instanceId: cleanString(state?.instanceId),
      createdAt: now
    });
    return true;
  }

  #releaseActivationClaim(actor, activity) {
    const key = this.#actorMutationKey(actor);
    if (this._activationClaims.get(key)?.activity === activity) {
      this._activationClaims.delete(key);
    }
  }

  async #queueActorMutation(actor, operation) {
    const key = this.#actorMutationKey(actor);
    const previous = this._actorQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this._actorQueues.set(key, current);
    try {
      return await current;
    }
    finally {
      if (this._actorQueues.get(key) === current) this._actorQueues.delete(key);
    }
  }

  async #activateGadget(actor, item) {
    const activatedAtWorldTime = this.#worldTime();
    const lifecycle = {
      activatedAtWorldTime,
      expiresAtWorldTime: activatedAtWorldTime + 60,
      actionUsed: false,
      spentReason: ""
    };
    const quantity = getCraftsmanGadgetQuantity(item);
    if (quantity < 1) {
      throw new Error("Craftsman gadget stack is empty");
    }
    if (quantity === 1) {
      const previous = {
        name: String(item?.name ?? ""),
        activities: clone(item?.system?.activities ?? {}),
        state: clone(instanceState(item) ?? {})
      };
      await this.#updateGadgetLifecycleState(item, "active", lifecycle);
      return {
        activeItem: item,
        rollback: async () => {
          const update = {
            name: previous.name,
            "system.activities": previous.activities,
            [`flags.${MODULE_ID}.craftsmanGadget`]: previous.state
          };
          if (typeof item?.update === "function") await item.update(update);
          else applyFlatUpdate(item, update);
        }
      };
    }

    const originalInstanceId = cleanString(instanceState(item)?.instanceId);
    const activeSource = embeddedItemSource(item);
    applyFlatUpdate(activeSource, buildCraftsmanGadgetStateUpdate(item, "active", {
      ...lifecycle,
      instanceId: originalInstanceId
    }));
    activeSource.system ??= {};
    activeSource.system.quantity = 1;

    let activeItem = null;
    try {
      [activeItem] = collectionValues(await actor.createEmbeddedDocuments?.("Item", [activeSource]));
      if (!activeItem || cleanString(instanceState(activeItem)?.instanceId) !== originalInstanceId) {
        throw new Error("Craftsman active gadget copy was not created completely");
      }
      if (typeof item?.update !== "function") {
        throw new Error("Craftsman gadget stack cannot be updated");
      }
      await item.update({
        "system.quantity": quantity - 1,
        [`flags.${MODULE_ID}.craftsmanGadget.instanceId`]: this.#randomId()
      });
      return {
        activeItem,
        rollback: async () => {
          const activeId = documentId(activeItem);
          if (activeId) await actor.deleteEmbeddedDocuments?.("Item", [activeId]);
          await item.update({
            "system.quantity": quantity,
            [`flags.${MODULE_ID}.craftsmanGadget.instanceId`]: originalInstanceId
          });
        }
      };
    }
    catch (error) {
      const activeId = documentId(activeItem);
      if (activeId) {
        try {
          await actor.deleteEmbeddedDocuments?.("Item", [activeId]);
        }
        catch (rollbackError) {
          this.#logError(`${MODULE_ID} | Failed to roll back an active Craftsman gadget split.`, rollbackError);
        }
      }
      throw error;
    }
  }

  #placedTemplates(results) {
    return collectionValues(results?.templates)
      .flatMap((entry) => collectionValues(entry).length ? collectionValues(entry) : [entry])
      .filter(Boolean);
  }

  async #deleteRejectedTemplates(results) {
    for (const entry of this.#placedTemplates(results)) {
      const template = entry?.document ?? entry;
      this.options.zoneService?.unregisterTemplate?.(template);
      if (typeof template?.delete === "function" && template.deleted !== true) {
        await template.delete();
      }
    }
  }

  async #resolveAuthorizedTemplates(uuids, actor, state, operation) {
    const requested = Array.isArray(uuids) ? uuids : [];
    if (requested.length === 0) return { valid: true, templates: [] };
    if (operation !== "activate" || state?.catalogId !== "smoke-device") {
      return { valid: false, templates: [] };
    }

    const templates = [];
    for (const uuid of requested) {
      const template = await this.#resolveUuid(uuid);
      if (!this.#isAuthorizedSmokeTemplate(template, actor, state)) {
        return { valid: false, templates };
      }
      templates.push(template);
    }
    return { valid: true, templates };
  }

  #isAuthorizedSmokeTemplate(template, actor, state) {
    const document = template?.document ?? template;
    const documentName = cleanString(
      document?.documentName
      ?? document?.constructor?.documentName
      ?? document?.constructor?.metadata?.name
    );
    if (documentName !== "MeasuredTemplate") return false;
    const scene = document?.parent;
    const sceneDocumentName = cleanString(
      scene?.documentName
      ?? scene?.constructor?.documentName
      ?? scene?.constructor?.metadata?.name
    );
    if (sceneDocumentName !== "Scene") return false;
    const currentScene = globalThis.game?.scenes?.current ?? globalThis.canvas?.scene ?? null;
    if (currentScene) {
      const currentSceneId = cleanString(currentScene?.id ?? currentScene?._id);
      const templateSceneId = cleanString(scene?.id ?? scene?._id);
      if (!currentSceneId || currentSceneId !== templateSceneId) return false;
    }
    const smoke = moduleFlags(document).craftsmanSmoke;
    return cleanString(smoke?.ownerActorUuid) === cleanString(actor?.uuid)
      && cleanString(smoke?.instanceId) === cleanString(state?.instanceId);
  }

  #worldTime() {
    const value = this.options.worldTime?.() ?? globalThis.game?.time?.worldTime ?? 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  #turnKey() {
    const injected = cleanString(this.options.turnKey?.());
    return injected || combatTurnKey(globalThis.game?.combat) || `world:${Math.floor(this.#worldTime())}`;
  }

  #activeGadget(actor, catalogId) {
    if (!actor) return null;
    return getPreparedCraftsmanGadgets(actor).find((item) => {
      const state = instanceState(item);
      return state?.catalogId === catalogId && state.state === "active";
    }) ?? null;
  }

  #actorDocuments() {
    const supplied = typeof this.options.actorDocuments === "function"
      ? collectionValues(this.options.actorDocuments())
      : collectionValues(globalThis.game?.actors);
    return Array.from(new Set([...this._knownActors, ...supplied])).filter(Boolean);
  }

  async #spendGadget(actor, item, reason) {
    const state = instanceState(item);
    if (!state) return false;
    await this.#cleanupGadget(actor, item, state);
    await this.#updateGadgetLifecycleState(item, "spent", { spentReason: cleanString(reason) });
    if (cleanString(actorGadgetState(actor)?.activeInstanceId) === cleanString(state.instanceId)) {
      await this.#updateActorGadgetState(actor, { activeInstanceId: "" });
    }
    return true;
  }

  async #cleanupGadget(actor, item, state = instanceState(item)) {
    if (!state?.instanceId) return false;
    if (state.catalogId === "smoke-device") {
      await this.options.zoneService?.deleteByInstanceId?.(state.instanceId);
    }
    if (state.catalogId === "charged-boot" && typeof actor?.deleteEmbeddedDocuments === "function") {
      const effectIds = collectionValues(actor?.effects)
        .filter((effect) => (
          cleanString(moduleFlags(effect).craftsmanGadgetEffect?.instanceId) === cleanString(state.instanceId)
        ))
        .map(documentId)
        .filter(Boolean);
      if (effectIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
    }
    if (["afterburner-injector", "emergency-regulator"].includes(state.catalogId)) {
      const vehicle = await this.#resolveGadgetVehicle(actor, state);
      await this.options.vehicleService?.deactivateGadget?.(vehicle, {
        instanceId: state.instanceId,
        gadgetId: state.catalogId
      });
    }
    return true;
  }

  async #applyGadgetActivation(actor, item) {
    const state = instanceState(item);
    if (["afterburner-injector", "emergency-regulator"].includes(state?.catalogId)) {
      const vehicle = await this.#resolveGadgetVehicle(actor, state);
      if (!vehicle) throw new Error("Craftsman gadget research object is unavailable or changed");
      if (state.catalogId === "afterburner-injector") {
        await this.options.vehicleService?.activateAfterburner?.(vehicle, actor, { instanceId: state.instanceId });
      }
      else {
        await this.options.vehicleService?.activateEmergencyRegulator?.(vehicle, actor, { instanceId: state.instanceId });
      }
      return;
    }
    if (state?.catalogId !== "charged-boot" || typeof actor?.createEmbeddedDocuments !== "function") return;
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: "Заряженный ботинок",
      img: item.img ?? "icons/svg/upgrade.svg",
      transfer: false,
      disabled: false,
      duration: { seconds: 60, startTime: this.#worldTime() },
      changes: [{ key: "system.attributes.movement.walk", mode: 2, value: "10", priority: 20 }],
      flags: {
        [MODULE_ID]: {
          managed: true,
          craftsmanGadgetEffect: {
            instanceId: state.instanceId,
            gadgetId: state.catalogId
          }
        }
      }
    }]);
  }

  async #applyGadgetAction(actor, item) {
    const state = instanceState(item);
    if (state?.catalogId === "force-glove") {
      await this.#updateGadgetState(item, { forceAdvantageAvailable: true });
      return;
    }
    if (state?.catalogId === "charged-boot") {
      await this.#updateActorGadgetState(actor, { noProvokedMovementTurnKey: this.#turnKey() });
      return;
    }
    if (state?.catalogId === "smoke-device") {
      await this.options.zoneService?.poisonTemplate?.(state.instanceId, {
        ownerActorUuid: cleanString(actor?.uuid),
        craftsmanLevel: this.#craftsmanLevel(actor),
        expiresAtTurnKey: this.#nextOwnerTurnKey(actor),
        createPoisonedTemplate: (context) => this.#createSmokeTemplate(item, context)
      });
      return;
    }
    if (state?.catalogId === "afterburner-injector") {
      const vehicle = await this.#resolveGadgetVehicle(actor, state);
      if (!vehicle) throw new Error("Craftsman gadget research object is unavailable or changed");
      await this.options.vehicleService?.useAfterburnerAction?.(vehicle, actor, {
        instanceId: state.instanceId,
        turnKey: this.#turnKey()
      });
    }
  }

  #craftsmanLevel(actor) {
    return Math.max(1, Math.floor(Number(craftsmanClass(actor)?.system?.levels) || 1));
  }

  #nextOwnerTurnKey(_actor) {
    if (typeof this.options.nextOwnerTurnKey === "function") return cleanString(this.options.nextOwnerTurnKey(_actor));
    const combat = globalThis.game?.combat;
    const id = cleanString(combat?.id ?? combat?._id);
    const round = Number(combat?.round);
    const turn = Number(combat?.turn);
    return id && Number.isFinite(round) && Number.isFinite(turn) ? `${id}:${round + 1}:${turn}` : "";
  }

  async #resolveGadgetVehicle(actor, state) {
    const service = this.options.vehicleService;
    if (!service) return null;
    const research = await service.resolveResearchObject?.(actor);
    if (research?.type !== "vehicle") return null;
    return !state?.vehicleUuid || cleanString(research.uuid) === cleanString(state.vehicleUuid)
      ? research
      : null;
  }

  async #createSmokeTemplate(item, context) {
    if (typeof this.options.createSmokeTemplate === "function") {
      return this.options.createSmokeTemplate(item, context);
    }
    const activities = collectionValues(item?.system?.activities);
    let activation = activities.find((entry) => activityState(entry)?.operation === "activate");
    if (!activation) {
      const storedSource = Object.values(moduleFlags(item).craftsmanGadgetActivities ?? {})
        .find((entry) => activityState(entry)?.operation === "activate");
      const ActivityClass = globalThis.CONFIG?.DND5E?.activityTypes?.[storedSource?.type]?.documentClass;
      if (storedSource && typeof ActivityClass === "function") {
        activation = new ActivityClass(clone(storedSource), { parent: item });
      }
      else {
        activation = storedSource;
      }
    }
    const AbilityTemplate = globalThis.dnd5e?.canvas?.AbilityTemplate;
    const previews = AbilityTemplate?.fromActivity?.(activation, {
      flags: {
        [MODULE_ID]: {
          craftsmanSmoke: {
            instanceId: context.instanceId,
            ownerActorUuid: context.ownerActorUuid,
            craftsmanLevel: context.craftsmanLevel,
            poisoned: true,
            expiresAtTurnKey: context.expiresAtTurnKey
          }
        }
      }
    }) ?? [];
    const placed = await previews[0]?.drawPreview?.();
    const document = collectionValues(placed)[0] ?? placed;
    return document?.document ?? document ?? null;
  }

  async #updateActorGadgetState(actor, patch) {
    const next = { ...(clone(actorGadgetState(actor) ?? {})), ...clone(patch) };
    if (typeof actor?.update === "function") {
      await actor.update({ [`flags.${MODULE_ID}.craftsmanGadgets`]: next });
    }
    else {
      actor.flags ??= {};
      actor.flags[MODULE_ID] ??= {};
      actor.flags[MODULE_ID].craftsmanGadgets = next;
    }
    return next;
  }

  async #updateGadgetState(item, patch) {
    const current = instanceState(item);
    if (!current) return false;
    const next = { ...clone(current), ...clone(patch) };
    item.flags ??= {};
    item.flags[MODULE_ID] ??= {};
    item.flags[MODULE_ID].craftsmanGadget = next;
    if (typeof item?.update === "function") {
      await item.update({ [`flags.${MODULE_ID}.craftsmanGadget`]: next });
    }
    return true;
  }

  async #updateGadgetLifecycleState(item, state, patch = {}) {
    const update = buildCraftsmanGadgetStateUpdate(item, state, patch);
    if (typeof item?.update === "function") {
      await item.update(update);
    }
    else {
      applyFlatUpdate(item, update);
    }
    return true;
  }

  async #restoreActiveGadget(actor, item, state) {
    await this.#updateGadgetLifecycleState(item, "active", state);
    await this.#applyGadgetActivation(actor, item);
    return true;
  }

  #logError(message, error) {
    const logger = this.options.logError ?? console.error;
    logger(message, error);
  }
}
