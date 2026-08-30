const MODULE_ID = "rebreya-main";
const DEFERRED_EMBEDDED_ITEM_NAMES = new Set([
  "особый кинжал телепортации",
  "зелье заживления ран",
  "зелье лечения 1 го уровня"
]);
const DND5E_ACTIVITY_ITEM_TYPES = new Set([
  "consumable",
  "equipment",
  "facility",
  "feat",
  "spell",
  "tool",
  "weapon"
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
const ABILITY_RING_IDS = new Set([
  "уроборос",
  "кольцо-характеристики-обычное",
  "кольцо-характеристики-необычное",
  "кольцо-характеристики-редкое",
  "кольцо-характеристики-очень-редкое"
]);
const ARMOR_TYPES = new Set(["light", "medium", "heavy"]);

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

function hasTrustedMagicEquipmentTemplateIdentity(document) {
  const flags = getModuleFlags(document);
  return Boolean(
    flags.sourceType === "magicItem"
    && flags.magicEquipmentTemplate === true
    && cleanText(flags.magicEquipmentGearId)
  );
}

function resolveAbilityChoice(normalizedName) {
  const match = normalizedName.match(/\(([^)]+)\)$/u);
  const ability = ABILITY_CHOICES.get(normalizeText(match?.[1]));
  return ability ? { ability } : null;
}

function runtimeAbilityChoice(document) {
  const choice = getModuleFlags(document)?.magicItemRuntime?.abilityChoice;
  const ability = cleanText(choice?.ability);
  if (![...ABILITY_CHOICES.values()].includes(ability)) {
    return null;
  }
  const appliedBonus = Number(choice?.appliedBonus);
  return {
    ability,
    ...(Number.isFinite(appliedBonus) && appliedBonus >= 0 ? { appliedBonus } : {})
  };
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
  const trustedTemplateStable = stableKnown && hasTrustedMagicEquipmentTemplateIdentity(item);
  const sourceId = index?.magicItemIdByCompendiumSource?.get(compendiumSource) ?? "";
  let nameId = index?.catalogByName?.get(normalizedName) ?? "";
  let reason = nameId ? "exact-name" : "";

  const aliasId = index?.aliases?.get(normalizedName) ?? "";
  if (aliasId) {
    nameId = aliasId;
    reason = "registered-alias";
  }

  const explicitAbilityChoice = resolveAbilityChoice(normalizedName);
  if (explicitAbilityChoice && normalizedName.includes("кольцо характеристики")) {
    const matchingRing = [...index?.catalogById?.values?.() ?? []].find((row) => (
      normalizeText(row?.name) === normalizeText(normalizedName.replace(/\s*\([^)]+\)$/u, ""))
    ));
    if (matchingRing?.id) {
      nameId = matchingRing.id;
      reason = "explicit-choice";
    }
  }
  const ouroborosChoice = normalizedName.startsWith(`${normalizeText("Уроборос")} (`)
    ? explicitAbilityChoice
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

  if (stableKnown && !sourceId && !nameId && !trustedTemplateStable) {
    return { status: "unresolved", reason: "stable-id-name-conflict", evidence: [stableId] };
  }

  if (!uniqueEvidence.length) {
    const generic = resolveGenericBonus(item, index, normalizedName);
    return generic ?? { status: "unresolved", reason: "identity-not-found", evidence: [] };
  }

  const magicItemId = uniqueEvidence[0];
  if (ABILITY_RING_IDS.has(magicItemId)) {
    const choice = runtimeAbilityChoice(item) ?? ouroborosChoice ?? explicitAbilityChoice;
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
    reason || (sourceId
      ? "compendium-source"
      : trustedTemplateStable ? "trusted-template-stable-id" : "stable-id")
  );
}

function stableHashId(seed, scope = "id") {
  const source = `${scope}:${seed}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (const char of source) {
    const code = char.codePointAt(0) ?? 0;
    hashA = Math.imul(hashA ^ code, 0x01000193) >>> 0;
    hashB = Math.imul(hashB + code + ((hashB << 6) >>> 0) + (hashB >>> 2), 0x85ebca6b) >>> 0;
  }
  const token = `${hashA.toString(36)}${hashB.toString(36)}`.replace(/[^a-z0-9]/gu, "");
  return token.padEnd(16, "0").slice(0, 16);
}

function buildAbilityRingEffect(projection, resolution) {
  const definition = projection?.automationDefinition;
  if (definition?.kind !== "abilityRing") return null;
  const ability = cleanText(resolution?.choice?.ability);
  const declaredBonus = Math.max(0, Number(definition?.bonus) || 0);
  const appliedBonus = Math.max(0, Number(resolution?.choice?.appliedBonus ?? declaredBonus) || 0);
  const maximum = Math.max(0, Number(definition?.maxAbilityScore) || 0);
  if (![...ABILITY_CHOICES.values()].includes(ability) || !appliedBonus || !maximum) {
    return null;
  }
  const magicItemId = cleanText(projection?.magicItemId ?? resolution?.magicItemId);
  const id = stableHashId(`magic-item:${magicItemId}:ability-ring`, "magic-item-effect");
  return {
    _id: id,
    name: `Кольцо характеристики: ${ability.toUpperCase()}`,
    type: "base",
    system: {},
    changes: [
      { key: `system.abilities.${ability}.value`, mode: 2, value: `+${appliedBonus}`, priority: 20 },
      { key: `system.abilities.${ability}.max`, mode: 4, value: String(maximum), priority: 20 }
    ],
    disabled: false,
    duration: {
      startTime: null, seconds: null, combat: null, rounds: null, turns: null,
      startRound: null, startTurn: null
    },
    description: definition.note ?? "",
    origin: null,
    transfer: true,
    statuses: [],
    sort: 0,
    flags: { [MODULE_ID]: { managed: true, magicItemAutomation: true, abilityRing: true } }
  };
}

function hasEquippedArmor(item) {
  const actor = item?.actor ?? item?.parent ?? null;
  return collectionDocuments(actor?.items).some((candidate) => (
    cleanText(candidate?._id ?? candidate?.id) !== cleanText(item?._id ?? item?.id)
    && candidate?.type === "equipment"
    && candidate?.system?.equipped === true
    && ARMOR_TYPES.has(cleanText(candidate?.system?.type?.value))
  ));
}

function hasEquippedShield(item) {
  const actor = item?.actor ?? item?.parent ?? null;
  return collectionDocuments(actor?.items).some((candidate) => (
    cleanText(candidate?._id ?? candidate?.id) !== cleanText(item?._id ?? item?.id)
    && candidate?.type === "equipment"
    && candidate?.system?.equipped === true
    && cleanText(candidate?.system?.type?.value) === "shield"
  ));
}

function projectRuntimeEffects(item, projection, resolution) {
  const effects = (Array.isArray(projection?.effects) ? projection.effects : []).map(cloneValue);
  const ringEffect = buildAbilityRingEffect(projection, resolution);
  if (ringEffect) effects.push(ringEffect);
  const suppressNaturalArmor = hasEquippedArmor(item);
  for (const effect of effects) {
    const condition = getModuleFlags(effect)?.condition;
    if (condition === "no-equipped-armor") {
      effect.disabled = suppressNaturalArmor;
    }
    else if (condition === "no-equipped-armor-or-shield") {
      effect.disabled = suppressNaturalArmor || hasEquippedShield(item);
    }
  }
  return effects;
}

function isManagedAutomation(document) {
  return getModuleFlags(document).magicItemAutomation === true;
}

function effectKeys(effect) {
  return new Set((Array.isArray(effect?.changes) ? effect.changes : [])
    .map((change) => cleanText(change?.key))
    .filter(Boolean));
}

function compactMechanicalValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactMechanicalValue)
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const compacted = Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, compactMechanicalValue(entry)])
    .filter(([, entry]) => entry !== undefined));
  return Object.keys(compacted).length ? compacted : undefined;
}

function buildActivityMechanicalSignature(activity) {
  const uses = activity?.uses && typeof activity.uses === "object"
    ? { ...activity.uses }
    : null;
  if (uses) {
    delete uses.spent;
  }
  return JSON.stringify(stableValue({
    type: cleanText(activity?.type),
    spellUuid: cleanText(activity?.spell?.uuid),
    consumption: compactMechanicalValue(activity?.consumption ?? null),
    uses: compactMechanicalValue(uses)
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
  const unmanagedKeys = new Set(unmanaged.flatMap((effect) => [...effectKeys(effect)]));
  for (const projectedEffect of projectedEffects) {
    const nextEffect = cloneValue(projectedEffect);
    const projectedChanges = Array.isArray(nextEffect?.changes) ? nextEffect.changes : [];
    nextEffect.changes = projectedChanges.filter((change) => (
      !unmanagedKeys.has(cleanText(change?.key))
    ));
    if (projectedChanges.length && !nextEffect.changes.length) {
      continue;
    }
    merged.push(nextEffect);
  }
  return merged;
}

function mergeActivities(existingActivities, projectedActivities) {
  const unmanaged = new Map(Object.entries(existingActivities)
    .filter(([, activity]) => !isManagedAutomation(activity)));
  const managed = {};
  for (const [id, projectedActivity] of Object.entries(projectedActivities)) {
    const signature = buildActivityMechanicalSignature(projectedActivity);
    const equivalentEntry = [...unmanaged.entries()].find(([, activity]) => (
      buildActivityMechanicalSignature(activity) === signature
    ));
    let previousActivity = existingActivities[id];
    if (equivalentEntry) {
      const [legacyId, legacyActivity] = equivalentEntry;
      unmanaged.delete(legacyId);
      previousActivity = legacyActivity;
    }
    if ([...unmanaged.values()].some((activity) => activitiesConflict(activity, projectedActivity))) {
      return null;
    }
    const nextActivity = cloneValue(projectedActivity);
    if (previousActivity?.uses && nextActivity?.uses) {
      nextActivity.uses.spent = previousActivity.uses.spent ?? nextActivity.uses.spent;
    }
    managed[id] = nextActivity;
  }
  return {
    ...Object.fromEntries([...unmanaged.entries()].map(([id, activity]) => [id, cloneValue(activity)])),
    ...managed
  };
}

export function buildEmbeddedMagicItemPatch(item, projection, resolution) {
  if (resolution?.status !== "resolved") {
    return { status: "unresolved", reason: resolution?.reason ?? "identity-not-resolved" };
  }

  const itemSource = documentSource(item) ?? {};
  const existingEffects = effectSources(itemSource.effects);
  const projectedEffects = projectRuntimeEffects(item, projection, resolution);
  const effects = mergeEffects(existingEffects, projectedEffects);
  if (!effects) {
    return { status: "unresolved", reason: "automation-conflict" };
  }

  const itemType = cleanText(itemSource?.type ?? item?.type);
  const supportsActivities = !itemType || DND5E_ACTIVITY_ITEM_TYPES.has(itemType);
  const existingActivities = activitySources(itemSource?.system?.activities);
  const projectedActivities = objectActivities(projection?.activities);
  const activities = supportsActivities
    ? mergeActivities(existingActivities, projectedActivities)
    : {};
  if (!activities) {
    return { status: "unresolved", reason: "automation-conflict" };
  }

  const system = supportsActivities ? { activities } : {};
  if (supportsActivities && projection?.uses) {
    system.uses = cloneValue(projection.uses);
    system.uses.spent = itemSource?.system?.uses?.spent ?? system.uses.spent;
  }
  else if (!supportsActivities) {
    if (Object.hasOwn(itemSource?.system ?? {}, "activities")) system["-=activities"] = null;
    if (Object.hasOwn(itemSource?.system ?? {}, "uses")) system["-=uses"] = null;
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
  const activitiesChanged = supportsActivities
    ? !sameValue(activities, existingActivities)
    : Object.hasOwn(system, "-=activities");
  const usesChanged = supportsActivities
    ? projection?.uses
      ? !sameValue(system.uses, itemSource?.system?.uses)
      : false
    : Object.hasOwn(system, "-=uses");
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
