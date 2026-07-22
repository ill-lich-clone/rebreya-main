import {
  CLASS_FEATURES_COMPENDIUM_NAME,
  CRAFTSMAN_CLASS_IDENTIFIER,
  MODULE_ID
} from "../constants.js";
import { getCraftsmanSubclasses } from "../integrations/craftsman-subclass-tracks.js";

const MECHANIC_ARCHETYPE_ID = "craftsman-research-mechanic";

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

function getArchetypeId(item) {
  return cleanString(moduleFlags(item).archetypeId);
}

function combatTurnKey(combat) {
  const id = cleanString(combat?.id ?? combat?._id);
  const round = Number(combat?.round);
  const turn = Number(combat?.turn);
  return id && Number.isFinite(round) && Number.isFinite(turn) ? `${id}:${round}:${turn}` : "";
}

function stripEmbeddedIdentity(data) {
  const copy = clone(data);
  for (const key of ["_id", "id", "uuid", "folder", "pack", "parent"]) delete copy[key];
  return copy;
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
  const currentGeneration = cleanString(actorGadgetState(actor)?.restGeneration);
  return actorItems(actor).filter((item) => {
    const state = instanceState(item);
    return state?.managed === true
      && (!currentGeneration || cleanString(state.restGeneration) === currentGeneration);
  });
}

export class CraftsmanGadgetService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._restQueues = new Map();
    this._knownActors = new Set();
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config) || getCraftsmanGadgetCapacity(actor) <= 0) return true;
    this._knownActors.add(actor);
    const key = cleanString(actor?.uuid ?? actor?.id) || actor;
    const previous = this._restQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => this.#replaceLoadout(actor));
    this._restQueues.set(key, current);
    try {
      return await current;
    }
    finally {
      if (this._restQueues.get(key) === current) this._restQueues.delete(key);
    }
  }

  applyDnd5ePreUseActivity(activity) {
    const operation = activityState(activity);
    if (!operation) return true;
    const item = activity?.item;
    const state = instanceState(item);
    if (!state?.managed || state.catalogId !== operation.gadgetId) return false;
    if (state.ownerUuid && cleanString(item?.actor?.uuid) !== cleanString(state.ownerUuid)) return false;
    if (operation.operation === "activate") return state.state === "prepared";
    if (operation.operation === "action") {
      return state.state === "active"
        && state.actionUsed !== true
        && this.#worldTime() < Number(state.expiresAtWorldTime ?? Infinity);
    }
    return false;
  }

  async applyDnd5ePostUseActivity(activity, _usageConfig = {}, results = {}, _messageConfig = {}) {
    const operation = activityState(activity);
    if (!operation || !this.applyDnd5ePreUseActivity(activity)) return true;
    const item = activity.item;
    const actor = item?.actor ?? activity?.actor;
    if (!actor) return false;
    this._knownActors.add(actor);
    if (operation.operation === "activate") {
      for (const other of getPreparedCraftsmanGadgets(actor)) {
        if (other !== item && instanceState(other)?.state === "active") {
          await this.#updateGadgetState(other, { state: "spent", spentReason: "replaced" });
        }
      }
      const activatedAtWorldTime = this.#worldTime();
      await this.#updateGadgetState(item, {
        state: "active",
        activatedAtWorldTime,
        expiresAtWorldTime: activatedAtWorldTime + 60,
        actionUsed: false,
        spentReason: ""
      });
      await this.#updateActorGadgetState(actor, {
        activeInstanceId: cleanString(instanceState(item)?.instanceId)
      });
      await this.#applyGadgetActivation(actor, item);
      if (instanceState(item)?.catalogId === "smoke-device") {
        const zoneService = this.options.zoneService;
        for (const template of collectionValues(results?.templates)) {
          zoneService?.registerTemplate?.(template?.document ?? template);
        }
      }
      return true;
    }
    await this.#updateGadgetState(item, { actionUsed: true });
    await this.#applyGadgetAction(actor, item);
    return true;
  }

  applyDnd5ePreCreateActivityTemplate(activity, templateData = {}) {
    const operation = activityState(activity);
    const item = activity?.item;
    const state = instanceState(item);
    if (operation?.operation !== "activate" || state?.catalogId !== "smoke-device") return true;
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
    const gadget = this.#activeGadget(actor, "force-glove");
    if (!gadget || instanceState(gadget)?.forceAdvantageAvailable !== true) return true;
    dialog.advantage = true;
    config.rolls ??= [];
    for (const roll of config.rolls) {
      roll.options ??= {};
      roll.options.advantageMode = 1;
    }
    return true;
  }

  async applyDnd5eRollAttack(rolls = [], context = {}) {
    const actor = context?.subject?.actor ?? context?.subject?.item?.actor ?? null;
    const gadget = this.#activeGadget(actor, "force-glove");
    if (!gadget) return true;
    const state = instanceState(gadget);
    if (state.forceAdvantageAvailable === true) {
      await this.#updateGadgetState(gadget, { forceAdvantageAvailable: false });
    }
    const roll = collectionValues(rolls)[0];
    const total = Number(roll?.total);
    const target = Number(roll?.options?.target);
    const turnKey = this.#turnKey();
    if (!Number.isFinite(total) || !Number.isFinite(target) || total < target || state.forceDamageUsedTurnKey === turnKey) {
      return true;
    }
    const confirm = this.options.confirmForceDamage;
    const accepted = typeof confirm === "function" ? await confirm(actor, gadget, roll, context) : true;
    if (accepted) {
      await this.#updateGadgetState(gadget, { forceDamagePending: true, forceDamagePendingTurnKey: turnKey });
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
    const currentTurnKey = combatTurnKey(combat);
    for (const actor of this._knownActors) {
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
    const now = Number(worldTime);
    if (!Number.isFinite(now)) return false;
    let changed = false;
    for (const actor of this._knownActors) {
      for (const item of getPreparedCraftsmanGadgets(actor)) {
        const state = instanceState(item);
        if (state?.state !== "active" || Number(state.expiresAtWorldTime) > now) continue;
        await this.#updateGadgetState(item, { state: "spent", spentReason: "expired" });
        if (cleanString(actorGadgetState(actor)?.activeInstanceId) === cleanString(state.instanceId)) {
          await this.#updateActorGadgetState(actor, { activeInstanceId: "" });
        }
        changed = true;
      }
    }
    return changed;
  }

  async #replaceLoadout(actor) {
    const oldGadgets = getPreparedCraftsmanGadgets(actor);
    const previousSelectedIds = oldGadgets
      .map((item) => cleanString(instanceState(item)?.catalogId))
      .filter(Boolean);
    const restGeneration = this.#randomId();
    await this.#updateActorGadgetState(actor, {
      restGeneration,
      selectedIds: previousSelectedIds,
      activeInstanceId: ""
    });
    const choices = await this.#availableTemplates(actor);
    if (!choices.length) return false;

    const capacity = getCraftsmanGadgetCapacity(actor);
    const selected = await this.#promptLoadout(actor, choices, capacity, oldGadgets);
    const requestedIds = Array.isArray(selected)
      ? selected.map(cleanString).filter(Boolean)
      : oldGadgets.map((item) => cleanString(instanceState(item)?.catalogId)).filter(Boolean);
    const byId = new Map(choices.map((entry) => [entry.id, entry]));
    const catalogIds = requestedIds.slice(0, capacity).filter((id) => byId.has(id));
    if (!catalogIds.length) return false;
    if (Array.isArray(selected) && catalogIds.length !== capacity) {
      globalThis.ui?.notifications?.warn?.(`Выберите ${capacity} гаджета.`);
      return false;
    }

    const needsVehicle = catalogIds.some((catalogId) => byId.get(catalogId)?.availability === "mechanic");
    const researchVehicle = needsVehicle
      ? await this.options.vehicleService?.resolveResearchObject?.(actor) ?? null
      : null;
    const createData = catalogIds.map((catalogId) => {
      const entry = byId.get(catalogId);
      const data = stripEmbeddedIdentity(entry.documentData);
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].craftsmanGadget = {
        managed: true,
        catalogId,
        ownerUuid: cleanString(actor?.uuid),
        instanceId: this.#randomId(),
        restGeneration,
        state: "prepared",
        vehicleUuid: byId.get(catalogId)?.availability === "mechanic"
          ? cleanString(researchVehicle?.uuid)
          : ""
      };
      return data;
    });

    try {
      const created = await actor.createEmbeddedDocuments?.("Item", createData) ?? [];
      const createdStates = collectionValues(created).map(instanceState).filter(Boolean);
      if (createdStates.length !== createData.length || new Set(createdStates.map((state) => state.instanceId)).size !== createData.length) {
        throw new Error("Craftsman gadget generation was not created completely");
      }
      await this.#updateActorGadgetState(actor, {
        restGeneration,
        selectedIds: catalogIds,
        activeInstanceId: ""
      });
      const oldIds = oldGadgets.map(documentId).filter(Boolean);
      if (oldIds.length) await actor.deleteEmbeddedDocuments?.("Item", oldIds);
      return true;
    }
    catch (error) {
      const partialIds = getPreparedCraftsmanGadgets(actor)
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

  async #promptLoadout(actor, choices, capacity, oldGadgets) {
    if (typeof this.options.promptLoadout === "function") {
      return this.options.promptLoadout(actor, clone(choices), {
        capacity,
        previous: oldGadgets.map((item) => cleanString(instanceState(item)?.catalogId)).filter(Boolean)
      });
    }
    if (!actor?.isOwner && !globalThis.game?.user?.isGM) return null;
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (typeof DialogV2?.wait !== "function") return null;
    const previous = oldGadgets.map((item) => cleanString(instanceState(item)?.catalogId));
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

  async #applyGadgetActivation(actor, item) {
    const state = instanceState(item);
    if (["afterburner-injector", "emergency-regulator"].includes(state?.catalogId)) {
      const vehicle = await this.#resolveGadgetVehicle(actor, state);
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
    const exact = await service.resolveVehicle?.(state?.vehicleUuid);
    if (exact) return exact;
    const research = await service.resolveResearchObject?.(actor);
    return !state?.vehicleUuid || cleanString(research?.uuid) === cleanString(state.vehicleUuid) ? research : null;
  }

  async #createSmokeTemplate(item, context) {
    if (typeof this.options.createSmokeTemplate === "function") {
      return this.options.createSmokeTemplate(item, context);
    }
    const activities = collectionValues(item?.system?.activities);
    const activation = activities.find((entry) => activityState(entry)?.operation === "activate");
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
    return placed?.document ?? placed ?? null;
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
    if (typeof item?.update === "function") {
      await item.update({ [`flags.${MODULE_ID}.craftsmanGadget`]: next });
    }
    else {
      item.flags ??= {};
      item.flags[MODULE_ID] ??= {};
      item.flags[MODULE_ID].craftsmanGadget = next;
    }
    return true;
  }

  #logError(message, error) {
    const logger = this.options.logError ?? console.error;
    logger(message, error);
  }
}
