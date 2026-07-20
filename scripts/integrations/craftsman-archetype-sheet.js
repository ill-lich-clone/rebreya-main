import {
  MODULE_ID,
  RESEARCH_ITEM_TYPE,
  SPECIALTY_ITEM_TYPE
} from "../constants.js";

const CRAFTSMAN_CLASS_IDENTIFIER = "craftsman-v01";
const CRAFTSMAN_PART_ID = "craftsmanArchetypes";
const CRAFTSMAN_STANDARD_TEMPLATE = `modules/${MODULE_ID}/templates/craftsman-archetypes-standard.hbs`;
const CRAFTSMAN_TIDY_TEMPLATE = `/modules/${MODULE_ID}/templates/craftsman-archetypes.hbs`;
const TIDY_FEATURES_SELECTOR = "[data-tab-contents-for='features']";
const TIDY_ROW_SELECTOR = "[data-action='openCraftsmanArchetype'][data-item-id]";
const tidyHookRegistrations = new WeakSet();
const tidyClickListeners = new WeakMap();

function getActorItems(actor) {
  const collection = actor?.items;
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection?.contents)) {
    return collection.contents;
  }
  if (collection?.values instanceof Function) {
    return Array.from(collection.values());
  }
  return [];
}

function getActorItem(actor, itemId) {
  const cleanItemId = String(itemId ?? "").trim();
  if (!cleanItemId) {
    return null;
  }
  return actor?.items?.get?.(cleanItemId)
    ?? getActorItems(actor).find((item) => item?.id === cleanItemId)
    ?? null;
}

function makeAxisState(item, { label, requiredLevel }) {
  return {
    label,
    name: item?.name ?? "Не выбрано",
    itemId: item?.id ?? "",
    itemUuid: item?.uuid ?? "",
    requiredLevel,
    selected: Boolean(item)
  };
}

function findCraftsmanClass(items) {
  return items.find((item) => (
    item?.type === "class"
    && item?.system?.identifier === CRAFTSMAN_CLASS_IDENTIFIER
  )) ?? null;
}

function findCraftsmanArchetype(items, type) {
  return items.find((item) => (
    item?.type === type
    && item?.system?.classIdentifier === CRAFTSMAN_CLASS_IDENTIFIER
  )) ?? null;
}

async function openCraftsmanArchetype(event, target) {
  const row = target?.closest?.("[data-item-id]") ?? target;
  const item = getActorItem(this.actor, row?.dataset?.itemId);
  if (!item) {
    return;
  }
  await item.sheet?.render?.(true);
}

function insertPartAfterFeatures(parts, partDefinition) {
  const nextParts = {};
  let inserted = false;
  for (const [partId, definition] of Object.entries(parts ?? {})) {
    nextParts[partId] = definition;
    if (partId === "features") {
      nextParts[CRAFTSMAN_PART_ID] = partDefinition;
      inserted = true;
    }
  }
  if (!inserted) {
    nextParts[CRAFTSMAN_PART_ID] = partDefinition;
  }
  return nextParts;
}

function bindCraftsmanArchetypeRows(element, actor) {
  if (!element?.addEventListener) {
    return;
  }
  const previousListener = tidyClickListeners.get(element);
  if (previousListener) {
    element.removeEventListener("click", previousListener);
  }

  const listener = async (event) => {
    const row = event.target?.closest?.(TIDY_ROW_SELECTOR);
    if (!row) {
      return;
    }
    const item = getActorItem(actor, row.dataset?.itemId);
    if (!item) {
      return;
    }
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
  return true;
}

export function buildCraftsmanArchetypeSheetState(actor) {
  const items = getActorItems(actor);
  const craftsmanClass = findCraftsmanClass(items);
  const research = craftsmanClass ? findCraftsmanArchetype(items, RESEARCH_ITEM_TYPE) : null;
  const specialty = craftsmanClass ? findCraftsmanArchetype(items, SPECIALTY_ITEM_TYPE) : null;

  return {
    visible: Boolean(craftsmanClass),
    title: "Архетипы Ремесленника",
    research: makeAxisState(research, { label: "Исследование", requiredLevel: 2 }),
    specialty: makeAxisState(specialty, { label: "Специальность", requiredLevel: 3 })
  };
}

export function ensureCraftsmanArchetypePartDefinition(CharacterActorSheet) {
  if (!CharacterActorSheet) {
    return;
  }

  if (!CharacterActorSheet.PARTS?.[CRAFTSMAN_PART_ID]) {
    CharacterActorSheet.PARTS = insertPartAfterFeatures(CharacterActorSheet.PARTS, {
      container: { classes: ["tab-body"], id: "tabs" },
      template: CRAFTSMAN_STANDARD_TEMPLATE
    });
  }

  CharacterActorSheet.DEFAULT_OPTIONS = {
    ...(CharacterActorSheet.DEFAULT_OPTIONS ?? {}),
    actions: {
      ...(CharacterActorSheet.DEFAULT_OPTIONS?.actions ?? {}),
      openCraftsmanArchetype
    }
  };
}

export function registerCraftsmanTidyContent() {
  if (!globalThis.Hooks?.once || tidyHookRegistrations.has(globalThis.Hooks)) {
    return;
  }
  tidyHookRegistrations.add(globalThis.Hooks);
  globalThis.Hooks.once("tidy5e-sheet.ready", registerCraftsmanTidyContentWithApi);
}
