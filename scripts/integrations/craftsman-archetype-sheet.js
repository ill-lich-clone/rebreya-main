import {
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../constants.js";
import {
  getCraftsmanSubclassTrack,
  getCraftsmanSubclasses,
  isCraftsmanClass
} from "./craftsman-subclass-tracks.js";
import { openCraftsmanSubclassChoice } from "./craftsman-multi-subclass.js";

const CRAFTSMAN_FEATURES_TEMPLATE = `modules/${MODULE_ID}/templates/craftsman-character-features.hbs`;
const CRAFTSMAN_SHARED_TEMPLATE = `modules/${MODULE_ID}/templates/craftsman-archetypes.hbs`;
const CRAFTSMAN_TIDY_TEMPLATE = `/${CRAFTSMAN_SHARED_TEMPLATE}`;
const PREPARE_FEATURES_TARGET = "game.dnd5e.applications.actor.CharacterActorSheet.prototype._prepareFeaturesContext";
const TIDY_FEATURES_SELECTOR = "[data-tab-contents-for='features']";
const TIDY_ROW_SELECTOR = "[data-action='openCraftsmanArchetype'][data-item-id]";
const TRACK_DEFINITIONS = Object.freeze({
  [CRAFTSMAN_TRACKS.RESEARCH]: Object.freeze({ label: "Исследование", requiredLevel: 2 }),
  [CRAFTSMAN_TRACKS.SPECIALTY]: Object.freeze({ label: "Специальность", requiredLevel: 3 })
});
const tidyHookRegistrations = new WeakSet();
const tidyApiRegistrations = new WeakSet();
const tidyClickListeners = new WeakMap();

let classCardRegistration = null;

function getActorItems(actor) {
  const collection = actor?.items;
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (collection?.values instanceof Function) return Array.from(collection.values());
  return [];
}

function getActorItem(actor, itemId) {
  const cleanItemId = String(itemId ?? "").trim();
  if (!cleanItemId) return null;
  return actor?.items?.get?.(cleanItemId)
    ?? getActorItems(actor).find((item) => (item?.id ?? item?._id) === cleanItemId)
    ?? null;
}

function getItemId(item) {
  return String(item?.id ?? item?._id ?? "").trim();
}

function makeAxisViewModel(item, track, classLevel) {
  const definition = TRACK_DEFINITIONS[track];
  return {
    track,
    label: definition.label,
    name: item?.name ?? "Не выбрано",
    img: item?.img ?? "",
    uuid: item?.uuid ?? "",
    itemId: getItemId(item),
    requiredLevel: definition.requiredLevel,
    needsSelection: !item && classLevel >= definition.requiredLevel
  };
}

function makeLegacyTidyAxisState(item, track) {
  const definition = TRACK_DEFINITIONS[track];
  return {
    label: definition.label,
    name: item?.name ?? "Не выбрано",
    itemId: getItemId(item),
    itemUuid: item?.uuid ?? "",
    requiredLevel: definition.requiredLevel,
    selected: Boolean(item)
  };
}

function findCraftsmanClass(items) {
  return items.find((item) => isCraftsmanClass(item)) ?? null;
}

function reorderCraftsmanSubclasses(context) {
  const subclasses = context?.itemCategories?.subclasses;
  if (!Array.isArray(subclasses)) return;

  const trackedPositions = [];
  const trackedSubclasses = [];
  for (let index = 0; index < subclasses.length; index += 1) {
    const track = getCraftsmanSubclassTrack(subclasses[index]);
    if (!track) continue;
    trackedPositions.push(index);
    trackedSubclasses.push(subclasses[index]);
  }
  if (trackedSubclasses.length < 2) return;

  const order = {
    [CRAFTSMAN_TRACKS.RESEARCH]: 0,
    [CRAFTSMAN_TRACKS.SPECIALTY]: 1
  };
  trackedSubclasses.sort((left, right) => (
    order[getCraftsmanSubclassTrack(left)] - order[getCraftsmanSubclassTrack(right)]
  ));
  trackedPositions.forEach((position, index) => {
    subclasses[position] = trackedSubclasses[index];
  });
}

function removeItemFromPreparedSections(sections, itemId) {
  if (!itemId || !sections) return;
  const sectionList = Array.isArray(sections) ? sections : Object.values(sections);
  for (const section of sectionList) {
    if (!section || typeof section !== "object") continue;
    if (Array.isArray(section.items)) {
      section.items = section.items.filter((item) => getItemId(item) !== itemId);
    }
    if (section.sections) removeItemFromPreparedSections(section.sections, itemId);
  }
}

/**
 * Extend the already-prepared native Standard-sheet context with two plain Craftsman axis models.
 * The native method has already linked Research to the class; Specialty is removed from every
 * remaining feature collection so it cannot render as an unrelated loose subclass.
 */
export function prepareCraftsmanClassCardContext(context) {
  const classes = context?.classes ?? context?.itemCategories?.classes ?? [];
  const craftsmanClass = classes.find((item) => isCraftsmanClass(item));
  if (!craftsmanClass) return context;

  const actor = craftsmanClass.actor ?? craftsmanClass.parent ?? context?.actor;
  const { research, specialty } = getCraftsmanSubclasses(actor ?? craftsmanClass);
  const classLevel = Number(craftsmanClass.system?.levels ?? 0);
  context.itemContext ??= {};
  const classContext = context.itemContext[getItemId(craftsmanClass)] ??= {};
  delete classContext.needsSubclass;
  classContext.craftsmanSubclasses = {
    [CRAFTSMAN_TRACKS.RESEARCH]: makeAxisViewModel(
      research,
      CRAFTSMAN_TRACKS.RESEARCH,
      classLevel
    ),
    [CRAFTSMAN_TRACKS.SPECIALTY]: makeAxisViewModel(
      specialty,
      CRAFTSMAN_TRACKS.SPECIALTY,
      classLevel
    )
  };

  const specialtyId = getItemId(specialty);
  if (specialtyId) {
    if (Array.isArray(context.subclasses)) {
      context.subclasses = context.subclasses.filter((item) => getItemId(item) !== specialtyId);
    }
    const categorizedSubclasses = context.itemCategories?.subclasses;
    if (Array.isArray(categorizedSubclasses)) {
      context.itemCategories.subclasses = categorizedSubclasses.filter(
        (item) => getItemId(item) !== specialtyId
      );
    }
    removeItemFromPreparedSections(context.sections, specialtyId);
  }
  return context;
}

async function onOpenCraftsmanSubclassChoice(_event, target) {
  const actionTarget = target?.closest?.("[data-class-id][data-track]") ?? target;
  return openCraftsmanSubclassChoice(
    this.actor,
    actionTarget?.dataset?.classId,
    actionTarget?.dataset?.track
  );
}

function getCharacterActorSheetClass() {
  return globalThis.game?.dnd5e?.applications?.actor?.CharacterActorSheet
    ?? globalThis.dnd5e?.applications?.actor?.CharacterActorSheet
    ?? null;
}

function getLibWrapperContract() {
  const active = globalThis.game?.modules?.get?.("lib-wrapper")?.active === true;
  if (!active) return { active: false, api: null };
  const api = globalThis.libWrapper;
  return {
    active: true,
    api: api?.register instanceof Function && api?.unregister instanceof Function ? api : null
  };
}

function installClassCardDefinition(CharacterActorSheet) {
  const features = CharacterActorSheet?.PARTS?.features;
  if (!features || typeof features !== "object") return null;

  const currentOptions = CharacterActorSheet.DEFAULT_OPTIONS ?? {};
  const currentActions = currentOptions.actions ?? {};
  const hadPriorAction = Object.hasOwn(currentActions, "openCraftsmanSubclassChoice");
  const priorAction = currentActions.openCraftsmanSubclassChoice;
  const definition = {
    CharacterActorSheet,
    features,
    hadPriorAction,
    priorAction,
    priorTemplate: features.template
  };

  features.template = CRAFTSMAN_FEATURES_TEMPLATE;
  CharacterActorSheet.DEFAULT_OPTIONS = {
    ...currentOptions,
    actions: {
      ...currentActions,
      openCraftsmanSubclassChoice: onOpenCraftsmanSubclassChoice
    }
  };
  return definition;
}

function restoreClassCardDefinition(definition) {
  if (!definition) return;
  const { CharacterActorSheet, features } = definition;
  if (features.template === CRAFTSMAN_FEATURES_TEMPLATE) {
    features.template = definition.priorTemplate;
  }

  const currentOptions = CharacterActorSheet.DEFAULT_OPTIONS ?? {};
  const currentActions = currentOptions.actions ?? {};
  if (currentActions.openCraftsmanSubclassChoice !== onOpenCraftsmanSubclassChoice) return;
  const restoredActions = { ...currentActions };
  if (definition.hadPriorAction) {
    restoredActions.openCraftsmanSubclassChoice = definition.priorAction;
  }
  else {
    delete restoredActions.openCraftsmanSubclassChoice;
  }
  CharacterActorSheet.DEFAULT_OPTIONS = {
    ...currentOptions,
    actions: restoredActions
  };
}

export function ensureCraftsmanClassCardDefinition(CharacterActorSheet) {
  if (!CharacterActorSheet?.PARTS?.features) return false;
  CharacterActorSheet.PARTS.features.template = CRAFTSMAN_FEATURES_TEMPLATE;
  const currentOptions = CharacterActorSheet.DEFAULT_OPTIONS ?? {};
  CharacterActorSheet.DEFAULT_OPTIONS = {
    ...currentOptions,
    actions: {
      ...(currentOptions.actions ?? {}),
      openCraftsmanSubclassChoice: onOpenCraftsmanSubclassChoice
    }
  };
  return true;
}

export function registerCraftsmanClassCardIntegration(CharacterActorSheet = getCharacterActorSheetClass()) {
  if (classCardRegistration?.CharacterActorSheet === CharacterActorSheet) return true;
  if (classCardRegistration) unregisterCraftsmanClassCardIntegration();

  const prototype = CharacterActorSheet?.prototype;
  const originalMethod = prototype?._prepareFeaturesContext;
  if (!(originalMethod instanceof Function) || !CharacterActorSheet?.PARTS?.features) return false;

  const libWrapperContract = getLibWrapperContract();
  if (libWrapperContract.active && !libWrapperContract.api) return false;
  if (libWrapperContract.active && getCharacterActorSheetClass() !== CharacterActorSheet) return false;

  const definition = installClassCardDefinition(CharacterActorSheet);
  if (!definition) return false;

  try {
    if (libWrapperContract.active) {
      const wrapper = async function(wrapped, context, options, ...args) {
        reorderCraftsmanSubclasses(context);
        const prepared = await wrapped(context, options, ...args);
        return prepareCraftsmanClassCardContext(prepared ?? context);
      };
      const id = libWrapperContract.api.register(
        MODULE_ID,
        PREPARE_FEATURES_TARGET,
        wrapper,
        "MIXED"
      );
      classCardRegistration = {
        CharacterActorSheet,
        api: libWrapperContract.api,
        definition,
        id,
        kind: "libWrapper"
      };
      return true;
    }

    const ownedMethod = async function(context, options, ...args) {
      reorderCraftsmanSubclasses(context);
      const prepared = await originalMethod.call(this, context, options, ...args);
      return prepareCraftsmanClassCardContext(prepared ?? context);
    };
    prototype._prepareFeaturesContext = ownedMethod;
    classCardRegistration = {
      CharacterActorSheet,
      definition,
      kind: "direct",
      originalMethod,
      ownedMethod,
      prototype
    };
    return true;
  }
  catch (error) {
    restoreClassCardDefinition(definition);
    throw error;
  }
}

export function unregisterCraftsmanClassCardIntegration() {
  const registration = classCardRegistration;
  classCardRegistration = null;
  if (!registration) return;

  if (registration.kind === "libWrapper") {
    registration.api.unregister(MODULE_ID, registration.id);
  }
  else if (registration.prototype._prepareFeaturesContext === registration.ownedMethod) {
    registration.prototype._prepareFeaturesContext = registration.originalMethod;
  }
  restoreClassCardDefinition(registration.definition);
}

function bindCraftsmanArchetypeRows(element, actor) {
  if (!element?.addEventListener) return;
  const previousListener = tidyClickListeners.get(element);
  if (previousListener) element.removeEventListener("click", previousListener);

  const listener = async (event) => {
    const row = event.target?.closest?.(TIDY_ROW_SELECTOR);
    if (!row) return;
    const item = getActorItem(actor, row.dataset?.itemId);
    if (!item) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    await item.sheet?.render?.(true);
  };
  tidyClickListeners.set(element, listener);
  element.addEventListener("click", listener);
}

function registerCraftsmanTidyContentWithApi(api) {
  if (!(api?.models?.HandlebarsContent instanceof Function) || !(api?.registerCharacterContent instanceof Function)) {
    return false;
  }
  if (tidyApiRegistrations.has(api)) return true;

  api.registerCharacterContent(new api.models.HandlebarsContent({
    path: CRAFTSMAN_TIDY_TEMPLATE,
    enabled: (context) => buildCraftsmanArchetypeSheetState(context?.actor).visible,
    getData: (context) => buildCraftsmanArchetypeSheetState(context?.actor),
    injectParams: {
      selector: TIDY_FEATURES_SELECTOR,
      position: "afterbegin"
    },
    onRender: ({ app, element }) => bindCraftsmanArchetypeRows(element, app?.actor)
  }), { layout: ["classic", "quadrone"] });
  tidyApiRegistrations.add(api);
  return true;
}

// Retained for the existing Tidy extension until Task 8 replaces its shared template and layout bindings.
export function buildCraftsmanArchetypeSheetState(actor) {
  const craftsmanClass = findCraftsmanClass(getActorItems(actor));
  const { research, specialty } = craftsmanClass
    ? getCraftsmanSubclasses(craftsmanClass)
    : { research: null, specialty: null };
  return {
    visible: Boolean(craftsmanClass),
    research: makeLegacyTidyAxisState(research, CRAFTSMAN_TRACKS.RESEARCH),
    specialty: makeLegacyTidyAxisState(specialty, CRAFTSMAN_TRACKS.SPECIALTY)
  };
}

export function registerCraftsmanTidyContent() {
  const hooks = globalThis.Hooks;
  if (hooks?.once && !tidyHookRegistrations.has(hooks)) {
    tidyHookRegistrations.add(hooks);
    hooks.once("tidy5e-sheet.ready", registerCraftsmanTidyContentWithApi);
  }

  const tidyModule = globalThis.game?.modules?.get?.("tidy5e-sheet");
  if (tidyModule?.active !== false && tidyModule?.api) {
    registerCraftsmanTidyContentWithApi(tidyModule.api);
  }
}
