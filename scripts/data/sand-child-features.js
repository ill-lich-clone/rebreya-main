const MODULE_ID = "rebreya-main";

export const SAND_CHILD_FEATURE_IDS = Object.freeze({
  manifestation: "sorcerer-rework-v011-9::subclass::sorcerer-9-feature-1",
  ancestralArt: "sorcerer-rework-v011-9::subclass::sorcerer-9-feature-2"
});
export const SAND_MANIFESTATION_ACTIVITY_ID = "sandManifest0001";

export function sandChildFeatureKind(item) {
  const id = item?.flags?.[MODULE_ID]?.featureId;
  if (id === SAND_CHILD_FEATURE_IDS.manifestation) return "manifestation";
  if (id === SAND_CHILD_FEATURE_IDS.ancestralArt) return "ancestralArt";
  return null;
}

export function buildSandChildFeatureAutomation(feature) {
  if (feature.featureId !== SAND_CHILD_FEATURE_IDS.manifestation) return null;
  const id = SAND_MANIFESTATION_ACTIVITY_ID;
  return {
    activities: {
      [id]: {
        _id: id, type: "utility", name: feature.name,
        activation: { type: "bonus", value: 1 },
        duration: { units: "minute", value: "1" },
        target: { affects: { type: "self", count: "1" } },
        consumption: { targets: [] }
      }
    },
    effects: [],
    usesMax: "@prof",
    usesRecovery: [{ period: "lr", type: "recoverAll", formula: "" }]
  };
}

export function buildSandChildItemPatch(item, source) {
  const kind = sandChildFeatureKind(item);
  if (!kind || kind !== sandChildFeatureKind(source)) return null;
  const owned = item._source?.system ?? item.system;
  const profile = source._source?.system ?? source.system;
  if (!profile) return null;
  const changes = {};
  if (owned?.description?.value !== profile.description?.value) {
    changes["system.description.value"] = profile.description.value;
  }
  if (kind === "manifestation") {
    for (const [id, activity] of Object.entries(profile.activities ?? {})) {
      if (JSON.stringify(owned?.activities?.[id]) !== JSON.stringify(activity)) {
        changes[`system.activities.${id}`] = activity;
      }
    }
    for (const key of ["max", "recovery"]) {
      if (JSON.stringify(owned?.uses?.[key]) !== JSON.stringify(profile.uses?.[key])) {
        changes[`system.uses.${key}`] = profile.uses[key];
      }
    }
  }
  return Object.keys(changes).length ? changes : null;
}
