function cleanString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function buildCounterspellActivity(sourceSystem = {}) {
  const activities = sourceSystem.activities && typeof sourceSystem.activities === "object"
    ? sourceSystem.activities
    : {};
  const sourceActivity = activities.counterspell
    ?? Object.values(activities).find((activity) => cleanString(activity?._id) === "counterspell")
    ?? Object.values(activities)[0]
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
    _id: "counterspell",
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
