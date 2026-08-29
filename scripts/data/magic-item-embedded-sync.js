const MODULE_ID = "rebreya-main";
const DEFERRED_EMBEDDED_ITEM_NAMES = new Set([
  "особый кинжал телепортации",
  "зелье заживления ран",
  "зелье лечения 1 го уровня"
]);
const REGISTERED_ALIASES = new Map([
  ["goggles of night", "ночные-очки"]
]);
const ABILITY_CHOICES = new Map([
  ["сила", "str"],
  ["ловкость", "dex"],
  ["телосложение", "con"],
  ["интеллект", "int"],
  ["мудрость", "wis"],
  ["харизма", "cha"]
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/gu, "е")
    .replace(/[’']/gu, "")
    .replace(/[^\p{L}\p{N}+()]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function cloneValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stableValue(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function embeddedItemFlags(value) {
  const flags = cloneValue(value ?? {});
  const midiOnUseMacroParts = flags?.["midi-qol"]?.onUseMacroParts;
  if (Array.isArray(midiOnUseMacroParts?.items) && midiOnUseMacroParts.items.length === 0) {
    delete midiOnUseMacroParts.items;
  }
  return flags;
}

function getModuleFlags(document) {
  return document?.flags?.[MODULE_ID] ?? {};
}

function getMagicItemId(document) {
  const flags = getModuleFlags(document);
  return cleanText(flags.magicItemId ?? (
    flags.sourceType === "magicItem" ? flags.sourceId : ""
  ));
}

function resolveAbilityChoice(normalizedName) {
  const match = normalizedName.match(/\(([^)]+)\)$/u);
  const ability = ABILITY_CHOICES.get(normalizeText(match?.[1]));
  return ability ? { ability } : null;
}

function resolved(magicItemId, reason, extras = {}) {
  return {
    status: "resolved",
    magicItemId,
    reason,
    ...extras,
    identityPatch: extras.identityPatch ?? {}
  };
}

export function buildMagicItemIdentityIndex(catalogRows = [], packRows = []) {
  const catalogById = new Map();
  const catalogByName = new Map();
  for (const row of Array.isArray(catalogRows) ? catalogRows : []) {
    const id = cleanText(row?.id);
    const name = normalizeText(row?.name);
    if (!id || !name) continue;
    catalogById.set(id, cloneValue(row));
    catalogByName.set(name, id);
  }

  const magicItemIdByCompendiumSource = new Map();
  for (const row of Array.isArray(packRows) ? packRows : []) {
    const uuid = cleanText(row?.uuid);
    const magicItemId = getMagicItemId(row);
    if (uuid && magicItemId && catalogById.has(magicItemId)) {
      magicItemIdByCompendiumSource.set(uuid, magicItemId);
    }
  }

  return {
    catalogById,
    catalogByName,
    magicItemIdByCompendiumSource,
    aliases: new Map(REGISTERED_ALIASES)
  };
}

function resolveGenericBonus(item, index, normalizedName) {
  const bonusMatch = normalizedName.match(/\+(\d+)$/u);
  const bonus = Number(bonusMatch?.[1] ?? 0);
  if (!bonus) {
    return null;
  }
  if (item?.type === "weapon" && Number(item?.system?.magicalBonus) === bonus) {
    const magicItemId = `оружие-${bonus}`;
    return index.catalogById.has(magicItemId)
      ? resolved(magicItemId, "generic-native-bonus")
      : null;
  }
  if (item?.type === "equipment" && Number(item?.system?.armor?.magicalBonus) === bonus) {
    const magicItemId = `доспех-${bonus}`;
    return index.catalogById.has(magicItemId)
      ? resolved(magicItemId, "generic-native-bonus")
      : null;
  }
  return null;
}

export function resolveEmbeddedMagicItemIdentity(item, index) {
  const normalizedName = normalizeText(item?.name);
  if (DEFERRED_EMBEDDED_ITEM_NAMES.has(normalizedName)) {
    return { status: "deferred", reason: "deferred-current-iteration" };
  }

  if (
    normalizedName === normalizeText("Кольцо характеристики +1 (Сила)")
    && getMagicItemId(item) === "механистический-амулет"
  ) {
    return resolved("уроборос", "cassidy-strength-ring-migration", {
      choice: { ability: "str" },
      identityPatch: { magicItemId: "уроборос", sourceType: "magicItem" }
    });
  }

  const compendiumSource = cleanText(item?._stats?.compendiumSource);
  if (
    normalizedName === normalizeText("Плащ защиты")
    && compendiumSource.startsWith("Compendium.dnd5e.")
  ) {
    return { status: "native", reason: "native-external" };
  }

  const stableId = getMagicItemId(item);
  const stableKnown = stableId && index?.catalogById?.has(stableId);
  const sourceId = index?.magicItemIdByCompendiumSource?.get(compendiumSource) ?? "";
  let nameId = index?.catalogByName?.get(normalizedName) ?? "";
  let reason = nameId ? "exact-name" : "";

  const aliasId = index?.aliases?.get(normalizedName) ?? "";
  if (aliasId) {
    nameId = aliasId;
    reason = "registered-alias";
  }

  const ouroborosChoice = normalizedName.startsWith(`${normalizeText("Уроборос")} (`)
    ? resolveAbilityChoice(normalizedName)
    : null;
  if (ouroborosChoice) {
    nameId = "уроборос";
    reason = "explicit-choice";
  }

  const evidence = [stableKnown ? stableId : "", sourceId, nameId].filter(Boolean);
  const uniqueEvidence = [...new Set(evidence)];
  if (uniqueEvidence.length > 1) {
    return { status: "unresolved", reason: "identity-conflict", evidence: uniqueEvidence };
  }

  if (stableKnown && !sourceId && !nameId) {
    return { status: "unresolved", reason: "stable-id-name-conflict", evidence: [stableId] };
  }

  if (!uniqueEvidence.length) {
    const generic = resolveGenericBonus(item, index, normalizedName);
    return generic ?? { status: "unresolved", reason: "identity-not-found", evidence: [] };
  }

  const magicItemId = uniqueEvidence[0];
  if (magicItemId === "уроборос") {
    const choice = ouroborosChoice ?? resolveAbilityChoice(normalizedName);
    if (!choice) {
      return {
        status: "unresolved-choice",
        magicItemId,
        reason: "ability-choice-required"
      };
    }
    return resolved(magicItemId, reason || "stable-id", { choice });
  }

  return resolved(
    magicItemId,
    reason || (sourceId ? "compendium-source" : "stable-id")
  );
}

function isManagedAutomation(document) {
  return getModuleFlags(document).magicItemAutomation === true;
}

function buildEffectMechanicalSignature(effect) {
  const changes = Array.isArray(effect?.changes) ? effect.changes : [];
  return JSON.stringify(changes
    .map(({ key, mode, value, priority }) => ({
      key: cleanText(key),
      mode: Number(mode),
      value: String(value ?? ""),
      priority: Number(priority ?? 0)
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function effectKeys(effect) {
  return new Set((Array.isArray(effect?.changes) ? effect.changes : [])
    .map((change) => cleanText(change?.key))
    .filter(Boolean));
}

function hasOverlappingEffectKeys(left, right) {
  const leftKeys = effectKeys(left);
  return [...effectKeys(right)].some((key) => leftKeys.has(key));
}

function buildActivityMechanicalSignature(activity) {
  return JSON.stringify(stableValue({
    type: cleanText(activity?.type),
    spellUuid: cleanText(activity?.spell?.uuid),
    consumption: activity?.consumption ?? null,
    uses: activity?.uses ?? null
  }));
}

function activitiesConflict(left, right) {
  const leftId = cleanText(left?._id);
  const rightId = cleanText(right?._id);
  const leftSpell = cleanText(left?.spell?.uuid);
  const rightSpell = cleanText(right?.spell?.uuid);
  return Boolean(
    (leftId && rightId && leftId === rightId)
    || (leftSpell && rightSpell && leftSpell === rightSpell)
  );
}

function objectActivities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function collectionDocuments(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value.values === "function") return Array.from(value.values());
  return [];
}

function documentSource(document) {
  return cloneValue(typeof document?.toObject === "function" ? document.toObject() : document);
}

function effectSources(value) {
  return collectionDocuments(value).map(documentSource);
}

function activitySources(value) {
  const collection = collectionDocuments(value);
  if (collection.length || Array.isArray(value) || Array.isArray(value?.contents) || typeof value?.values === "function") {
    return Object.fromEntries(collection.map((activity) => {
      const source = documentSource(activity);
      return [cleanText(source?._id ?? activity?.id), source];
    }).filter(([id]) => id));
  }
  return Object.fromEntries(Object.entries(objectActivities(value))
    .map(([id, activity]) => [id, documentSource(activity)]));
}

export function buildMagicItemAutomationProjection(packItem) {
  const source = typeof packItem?.toObject === "function"
    ? packItem.toObject()
    : cloneValue(packItem ?? {});
  const flags = getModuleFlags(source);
  const effects = (Array.isArray(source.effects) ? source.effects : [])
    .filter(isManagedAutomation)
    .map(cloneValue);
  const activities = Object.fromEntries(Object.entries(objectActivities(source?.system?.activities))
    .filter(([, activity]) => isManagedAutomation(activity))
    .map(([id, activity]) => [id, cloneValue(activity)]));
  return {
    magicItemId: cleanText(flags.magicItemId),
    signature: cleanText(flags.signature),
    automationDefinition: cloneValue(flags.magicItemAutomation ?? null),
    effects,
    activities,
    uses: cloneValue(source?.system?.uses ?? null)
  };
}

function mergeEffects(existingEffects, projectedEffects) {
  const unmanaged = existingEffects.filter((effect) => !isManagedAutomation(effect));
  const merged = unmanaged.map(cloneValue);
  for (const projectedEffect of projectedEffects) {
    const signature = buildEffectMechanicalSignature(projectedEffect);
    if (unmanaged.some((effect) => buildEffectMechanicalSignature(effect) === signature)) {
      continue;
    }
    if (unmanaged.some((effect) => hasOverlappingEffectKeys(effect, projectedEffect))) {
      return null;
    }
    merged.push(cloneValue(projectedEffect));
  }
  return merged;
}

function mergeActivities(existingActivities, projectedActivities) {
  const unmanagedEntries = Object.entries(existingActivities)
    .filter(([, activity]) => !isManagedAutomation(activity));
  const merged = Object.fromEntries(unmanagedEntries.map(([id, activity]) => [id, cloneValue(activity)]));
  for (const [id, projectedActivity] of Object.entries(projectedActivities)) {
    const signature = buildActivityMechanicalSignature(projectedActivity);
    if (unmanagedEntries.some(([, activity]) => buildActivityMechanicalSignature(activity) === signature)) {
      continue;
    }
    if (unmanagedEntries.some(([, activity]) => activitiesConflict(activity, projectedActivity))) {
      return null;
    }
    const nextActivity = cloneValue(projectedActivity);
    const previousActivity = existingActivities[id];
    if (previousActivity?.uses && nextActivity?.uses) {
      nextActivity.uses.spent = previousActivity.uses.spent ?? nextActivity.uses.spent;
    }
    merged[id] = nextActivity;
  }
  return merged;
}

export function buildEmbeddedMagicItemPatch(item, projection, resolution) {
  if (resolution?.status !== "resolved") {
    return { status: "unresolved", reason: resolution?.reason ?? "identity-not-resolved" };
  }

  const itemSource = documentSource(item) ?? {};
  const existingEffects = effectSources(itemSource.effects);
  const projectedEffects = Array.isArray(projection?.effects) ? projection.effects : [];
  const effects = mergeEffects(existingEffects, projectedEffects);
  if (!effects) {
    return { status: "unresolved", reason: "automation-conflict" };
  }

  const existingActivities = activitySources(itemSource?.system?.activities);
  const projectedActivities = objectActivities(projection?.activities);
  const activities = mergeActivities(existingActivities, projectedActivities);
  if (!activities) {
    return { status: "unresolved", reason: "automation-conflict" };
  }

  const system = { activities };
  if (projection?.uses) {
    system.uses = cloneValue(projection.uses);
    system.uses.spent = itemSource?.system?.uses?.spent ?? system.uses.spent;
  }

  const existingFlags = embeddedItemFlags(itemSource.flags);
  const flags = cloneValue(existingFlags);
  flags[MODULE_ID] = {
    ...(flags[MODULE_ID] ?? {}),
    ...(resolution.identityPatch ?? {}),
    sourceType: "magicItem",
    magicItemId: resolution.magicItemId,
    signature: cleanText(projection?.signature),
    magicItemAutomation: cloneValue(projection?.automationDefinition ?? null)
  };

  const effectsChanged = !sameValue(effects, existingEffects);
  const activitiesChanged = !sameValue(activities, existingActivities);
  const usesChanged = projection?.uses
    ? !sameValue(system.uses, itemSource?.system?.uses)
    : false;
  const flagsChanged = !sameValue(flags, existingFlags);
  if (!effectsChanged && !activitiesChanged && !usesChanged && !flagsChanged) {
    return { status: "unchanged" };
  }

  return {
    status: "updated",
    update: {
      _id: cleanText(itemSource?._id ?? item?._id ?? item?.id),
      effects,
      system,
      flags
    }
  };
}
