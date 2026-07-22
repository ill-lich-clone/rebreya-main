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
const CRAFTSMAN_TIDY_TEMPLATE = `/modules/${MODULE_ID}/templates/craftsman-tidy-class-subclasses.hbs`;
const PREPARE_FEATURES_TARGET = "game.dnd5e.applications.actor.CharacterActorSheet.prototype._prepareFeaturesContext";
const TIDY_CLASSIC_SELECTOR = '[data-tidy-section-key="classes"] .item-table-body';
const TIDY_QUADRONE_SELECTOR = ".class-list";
const TIDY_FRAGMENT_SELECTOR = ".rebreya-craftsman-tidy-subclasses";
const TIDY_FRAGMENT_CLASS_ATTRIBUTE = "data-rebreya-craftsman-class-id";
const TIDY_ACTION_SELECTOR = "[data-action][data-track]";
const TRACK_DEFINITIONS = Object.freeze({
  [CRAFTSMAN_TRACKS.RESEARCH]: Object.freeze({ label: "Исследование", requiredLevel: 2 }),
  [CRAFTSMAN_TRACKS.SPECIALTY]: Object.freeze({ label: "Специальность", requiredLevel: 3 })
});
const tidyHookRegistrations = new WeakMap();
const tidyApiRegistrations = new WeakMap();
const tidyClickListeners = new WeakMap();

let classCardRegistration = null;
let tidyActive = false;
let tidyGeneration = 0;

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

function bindCraftsmanTidyFragment(element, actor) {
  if (!element?.addEventListener) return;
  const previousListener = tidyClickListeners.get(element);
  if (previousListener) element.removeEventListener("click", previousListener);

  const listener = async (event) => {
    const target = event.target?.closest?.(TIDY_ACTION_SELECTOR);
    if (!target || !element.contains?.(target)) return;
    const action = target.dataset?.action;
    const track = target.dataset?.track;
    if (!Object.values(CRAFTSMAN_TRACKS).includes(track)) return;

    if (action === "showDocument") {
      const item = getActorItem(actor, target.dataset?.itemId);
      if (!item || getCraftsmanSubclassTrack(item) !== track) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      await item.sheet?.render?.(true);
      return;
    }
    if (action !== "openCraftsmanSubclassChoice") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    await openCraftsmanSubclassChoice(actor, target.dataset?.classId, track);
  };
  tidyClickListeners.set(element, listener);
  element.addEventListener("click", listener);
}

function escapeAttributeValue(value) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function resolveTidyFragmentRoots(nodes, element, anchorSelector, classId) {
  const expectedClassId = String(classId ?? "");
  const roots = [];
  for (const node of Array.from(nodes ?? [])) {
    if (
      node?.matches?.(TIDY_FRAGMENT_SELECTOR)
      && node.getAttribute?.(TIDY_FRAGMENT_CLASS_ATTRIBUTE) === expectedClassId
    ) {
      roots.push(node);
      continue;
    }
    for (const child of node?.querySelectorAll?.(TIDY_FRAGMENT_SELECTOR) ?? []) {
      if (child.getAttribute?.(TIDY_FRAGMENT_CLASS_ATTRIBUTE) === expectedClassId) roots.push(child);
    }
  }
  if (roots.length) return roots;

  // Tidy 13.3.0 inserts the HTML correctly but accidentally passes an empty nodes array.
  const anchor = element?.querySelector?.(anchorSelector);
  if (!anchor) return [];
  const escapedClassId = escapeAttributeValue(expectedClassId);
  return Array.from(anchor.querySelectorAll?.(
    `${TIDY_FRAGMENT_SELECTOR}[${TIDY_FRAGMENT_CLASS_ATTRIBUTE}="${escapedClassId}"]`
  ) ?? []);
}

function removeClassicSpecialtyArtifacts(context, specialty) {
  const specialtyId = getItemId(specialty);
  if (!specialtyId) return;

  if (Array.isArray(context?.orphanedSubclasses)) {
    context.orphanedSubclasses = context.orphanedSubclasses.filter(
      (item) => getItemId(item) !== specialtyId
    );
  }
  for (const section of context?.features ?? []) {
    if (section?.isClass || section?.key === "classes" || !Array.isArray(section?.items)) continue;
    section.items = section.items.filter((item) => getItemId(item) !== specialtyId);
  }

  const mismatchMessage = globalThis.game?.i18n?.format?.("DND5E.SubclassMismatchWarn", {
    name: specialty.name,
    class: specialty.system?.classIdentifier
  });
  if (mismatchMessage && Array.isArray(context?.warnings)) {
    context.warnings = context.warnings.filter((warning) => (
      (warning?.message ?? warning) !== mismatchMessage
    ));
  }
}

function prepareCraftsmanTidyData(context, layout) {
  const state = buildCraftsmanArchetypeSheetState(context?.actor);
  if (layout === "classic" && state.visible) {
    const specialty = getActorItem(context.actor, state.specialty.itemId);
    if (specialty) removeClassicSpecialtyArtifacts(context, specialty);
  }
  return state;
}

function relocateClassicCraftsmanFragment({ app, element, nodes }) {
  const state = buildCraftsmanArchetypeSheetState(app?.actor);
  if (!state.visible) return;
  const roots = resolveTidyFragmentRoots(
    nodes,
    element,
    TIDY_CLASSIC_SELECTOR,
    state.classId
  );
  if (!roots.length) return;

  const anchor = element?.querySelector?.(TIDY_CLASSIC_SELECTOR);
  const classRow = anchor?.querySelector?.(
    `[data-item-id="${escapeAttributeValue(state.classId)}"]`
  );
  if (!classRow) return;
  let nextNode = classRow.nextSibling;
  const alreadyPlaced = roots.every((root) => {
    if (nextNode !== root) return false;
    nextNode = root.nextSibling;
    return true;
  });
  if (!alreadyPlaced) classRow.after?.(...roots);
  for (const root of roots) bindCraftsmanTidyFragment(root, app?.actor);
}

function removeQuadroneCraftsmanSingleton(element, state) {
  const classList = element?.querySelector?.(TIDY_QUADRONE_SELECTOR);
  if (!classList) return;
  const classTitle = `${state.className} ${state.classLevel}`;
  const classLabel = Array.from(classList.querySelectorAll?.("[title]") ?? [])
    .find((node) => node.getAttribute?.("title") === classTitle);
  const summary = classLabel?.parentElement;
  if (!summary) return;
  const selectedNames = new Set(
    state.axes.filter((axis) => axis.itemId).map((axis) => axis.name)
  );
  for (const node of Array.from(summary.querySelectorAll?.("[title]") ?? [])) {
    if (node !== classLabel && selectedNames.has(node.getAttribute?.("title"))) node.remove?.();
  }
}

function prepareQuadroneCraftsmanFragment({ app, element, nodes }) {
  const state = buildCraftsmanArchetypeSheetState(app?.actor);
  if (!state.visible) return;
  const roots = resolveTidyFragmentRoots(
    nodes,
    element,
    TIDY_QUADRONE_SELECTOR,
    state.classId
  );
  for (const root of roots) bindCraftsmanTidyFragment(root, app?.actor);
  removeQuadroneCraftsmanSingleton(element, state);
}

function isTidyGenerationActive(generation) {
  return tidyActive && tidyGeneration === generation;
}

function registerCraftsmanTidyContentWithApi(api, generation = tidyGeneration) {
  if (!(api?.models?.HandlebarsContent instanceof Function) || !(api?.registerCharacterContent instanceof Function)) {
    return false;
  }
  if (!isTidyGenerationActive(generation)) return false;

  let registration = tidyApiRegistrations.get(api);
  if (registration?.generation !== generation) {
    registration = { generation, layouts: new Set() };
    tidyApiRegistrations.set(api, registration);
  }
  const definitions = [
    {
      layout: "classic",
      selector: TIDY_CLASSIC_SELECTOR,
      getData: (context) => prepareCraftsmanTidyData(context, "classic"),
      onRender: relocateClassicCraftsmanFragment
    },
    {
      layout: "quadrone",
      selector: TIDY_QUADRONE_SELECTOR,
      getData: (context) => prepareCraftsmanTidyData(context, "quadrone"),
      onRender: prepareQuadroneCraftsmanFragment
    }
  ];

  for (const definition of definitions) {
    if (registration.layouts.has(definition.layout)) continue;
    api.registerCharacterContent(new api.models.HandlebarsContent({
      path: CRAFTSMAN_TIDY_TEMPLATE,
      enabled: (context) => (
        isTidyGenerationActive(generation)
        && buildCraftsmanArchetypeSheetState(context?.actor).visible
      ),
      getData: definition.getData,
      injectParams: {
        selector: definition.selector,
        position: "beforeend"
      },
      onRender: definition.onRender
    }), { layout: definition.layout });
    registration.layouts.add(definition.layout);
  }
  return registration.layouts.size === definitions.length;
}

export function buildCraftsmanArchetypeSheetState(actor) {
  const craftsmanClass = actor?.type === "character"
    ? findCraftsmanClass(getActorItems(actor))
    : null;
  const { research, specialty } = craftsmanClass
    ? getCraftsmanSubclasses(craftsmanClass)
    : { research: null, specialty: null };
  const classLevel = Number(craftsmanClass?.system?.levels ?? 0);
  const classId = getItemId(craftsmanClass);
  const researchState = makeAxisViewModel(research, CRAFTSMAN_TRACKS.RESEARCH, classLevel);
  const specialtyState = makeAxisViewModel(specialty, CRAFTSMAN_TRACKS.SPECIALTY, classLevel);
  return {
    visible: Boolean(craftsmanClass),
    classId,
    className: craftsmanClass?.name ?? "",
    classLevel,
    research: researchState,
    specialty: specialtyState,
    axes: [researchState, specialtyState].map((axis) => ({ ...axis, classId }))
  };
}

export function registerCraftsmanTidyContent() {
  if (!tidyActive) {
    tidyActive = true;
    tidyGeneration += 1;
  }
  const generation = tidyGeneration;
  const hooks = globalThis.Hooks;
  if (hooks?.once && tidyHookRegistrations.get(hooks) !== generation) {
    tidyHookRegistrations.set(hooks, generation);
    hooks.once("tidy5e-sheet.ready", (api) => (
      registerCraftsmanTidyContentWithApi(api, generation)
    ));
  }

  const tidyModule = globalThis.game?.modules?.get?.("tidy5e-sheet");
  if (tidyModule?.active !== false && tidyModule?.api) {
    registerCraftsmanTidyContentWithApi(tidyModule.api, generation);
  }
}

export function unregisterCraftsmanTidyContent() {
  tidyActive = false;
}
