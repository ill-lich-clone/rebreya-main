function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

const FOUNDRY_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{16}$/u;
const COUNTERSPELL_ACTIVITY_ID = "counterspell0000";

function resolveActivityId(sourceActivity = {}) {
  const sourceId = cleanString(sourceActivity?._id ?? sourceActivity?.id);
  return FOUNDRY_DOCUMENT_ID_PATTERN.test(sourceId)
    ? sourceId
    : COUNTERSPELL_ACTIVITY_ID;
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function collectionValues(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  return typeof collection === "object" ? Object.values(collection) : [];
}

export function buildCounterspellActivity(sourceSystem = {}) {
  const activities = sourceSystem.activities && typeof sourceSystem.activities === "object"
    ? sourceSystem.activities
    : {};
  const activityValues = collectionValues(activities);
  const sourceActivity = activities.counterspell
    ?? activities.get?.("counterspell")
    ?? activityValues.find((activity) => cleanString(activity?._id) === "counterspell")
    ?? activityValues[0]
    ?? {};

  const {
    check: _check,
    save: _save,
    attack: _attack,
    damage: _damage,
    ...activity
  } = clone(sourceActivity) ?? {};

  return {
    ...activity,
    _id: resolveActivityId(sourceActivity),
    type: "utility",
    activation: {
      ...(activity.activation ?? {}),
      type: "reaction",
      value: activity.activation?.value ?? 1
    },
    consumption: {
      ...(activity.consumption ?? {}),
      targets: Array.isArray(activity.consumption?.targets) ? activity.consumption.targets : [],
      scaling: {
        ...(activity.consumption?.scaling ?? {}),
        allowed: true,
        max: activity.consumption?.scaling?.max ?? ""
      }
    },
    spell: {
      ...(activity.spell ?? {}),
      level: 3,
      scaling: {
        ...(activity.spell?.scaling ?? {}),
        mode: "level",
        formula: activity.spell?.scaling?.formula ?? ""
      }
    }
  };
}
