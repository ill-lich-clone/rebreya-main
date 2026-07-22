import {
  CRAFTSMAN_GADGET_ITEM_TYPE,
  MODULE_ID
} from "../constants.js";

const ACTIVE_SUFFIX = " (активный)";
const VALID_STATES = new Set(["prepared", "active", "spent"]);

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : structuredClone(value);
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function sourceData(document) {
  return document?.toObject instanceof Function
    ? document.toObject()
    : clone(document ?? {});
}

function activityOperation(activity) {
  return cleanString(activity?.flags?.[MODULE_ID]?.craftsmanGadget?.operation);
}

function normalizeActivities(activities) {
  if (Array.isArray(activities)) {
    return Object.fromEntries(activities
      .filter(Boolean)
      .map((activity) => [cleanString(activity._id), clone(activity)])
      .filter(([id]) => id));
  }
  if (!activities || typeof activities !== "object") return {};
  return Object.fromEntries(Object.entries(activities).map(([id, activity]) => [id, clone(activity)]));
}

function activitiesForState(activities, state) {
  const operation = state === "prepared" ? "activate" : state === "active" ? "action" : "";
  if (!operation) return {};
  return Object.fromEntries(Object.entries(normalizeActivities(activities))
    .filter(([, activity]) => activityOperation(activity) === operation));
}

function managedState(item) {
  return item?.flags?.[MODULE_ID]?.craftsmanGadget ?? null;
}

function appendActiveSuffix(name) {
  const text = String(name ?? "");
  return text.endsWith(ACTIVE_SUFFIX) ? text : `${text}${ACTIVE_SUFFIX}`;
}

export function getCraftsmanGadgetQuantity(item) {
  const rawQuantity = item?.system?.quantity;
  if (rawQuantity === undefined || rawQuantity === null || rawQuantity === "") return 1;
  const quantity = Math.trunc(Number(rawQuantity));
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

export function expandCraftsmanGadgetSelection(items) {
  const entries = Array.isArray(items?.contents)
    ? items.contents
    : Array.isArray(items)
      ? items
      : typeof items?.values === "function"
        ? Array.from(items.values())
        : [];
  const selection = [];
  for (const item of entries) {
    const state = managedState(item);
    const catalogId = cleanString(state?.catalogId);
    if (state?.managed !== true || !catalogId) continue;
    selection.push(...Array.from({ length: getCraftsmanGadgetQuantity(item) }, () => catalogId));
  }
  return selection;
}

export function buildCraftsmanGadgetItemSource(template, options = {}) {
  const templateSource = sourceData(template);
  const originalActivities = normalizeActivities(templateSource.system?.activities);
  const moduleFlags = clone(templateSource.flags?.[MODULE_ID] ?? {});
  delete moduleFlags.craftsmanGadgetTemplate;

  const source = {
    name: String(templateSource.name ?? ""),
    type: CRAFTSMAN_GADGET_ITEM_TYPE,
    img: templateSource.img,
    system: {
      description: clone(templateSource.system?.description ?? { value: "", chat: "" }),
      source: clone(templateSource.system?.source ?? {}),
      identified: true,
      unidentified: { name: "", description: "" },
      container: null,
      quantity: Math.max(1, Math.trunc(Number(options.quantity) || 1)),
      weight: { value: 0, units: "lb" },
      price: { value: 0, denomination: "gp" },
      rarity: "",
      attunement: "",
      attuned: false,
      equipped: false,
      type: { value: "trinket", subtype: "" },
      properties: [],
      activities: activitiesForState(originalActivities, "prepared"),
      uses: { spent: 0, max: "", recovery: [], autoDestroy: false }
    },
    effects: clone(templateSource.effects ?? []),
    flags: {
      ...clone(templateSource.flags ?? {}),
      [MODULE_ID]: {
        ...moduleFlags,
        craftsmanGadgetActivities: clone(originalActivities),
        craftsmanGadget: {
          managed: true,
          catalogId: cleanString(options.catalogId),
          instanceId: cleanString(options.instanceId),
          ownerUuid: cleanString(options.ownerUuid),
          restGeneration: cleanString(options.restGeneration),
          state: "prepared",
          vehicleUuid: cleanString(options.vehicleUuid),
          actionUsed: false
        }
      }
    }
  };
  if (!source.img) delete source.img;
  return source;
}

export function buildCraftsmanGadgetStateUpdate(item, state, overrides = {}) {
  if (!VALID_STATES.has(state)) {
    throw new Error(`Unsupported Craftsman gadget state '${state}'.`);
  }
  const currentState = clone(managedState(item) ?? {});
  const activities = item?.flags?.[MODULE_ID]?.craftsmanGadgetActivities ?? {};
  return {
    name: state === "active" ? appendActiveSuffix(item?.name) : String(item?.name ?? ""),
    "system.activities": activitiesForState(activities, state),
    [`flags.${MODULE_ID}.craftsmanGadget`]: {
      ...currentState,
      ...clone(overrides),
      state
    }
  };
}
