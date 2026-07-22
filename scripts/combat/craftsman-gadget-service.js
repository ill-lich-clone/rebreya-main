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
  return actorItems(actor).filter((item) => instanceState(item)?.managed === true);
}

export class CraftsmanGadgetService {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this._restQueues = new Map();
  }

  async handleRestCompleted(actor, result = {}, config = {}) {
    if (!isLongRest(result, config) || getCraftsmanGadgetCapacity(actor) <= 0) return true;
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

  async #replaceLoadout(actor) {
    const oldGadgets = getPreparedCraftsmanGadgets(actor);
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

    const restGeneration = this.#randomId();
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
        vehicleUuid: ""
      };
      return data;
    });

    try {
      await actor.createEmbeddedDocuments?.("Item", createData);
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

  #logError(message, error) {
    const logger = this.options.logError ?? console.error;
    logger(message, error);
  }
}
