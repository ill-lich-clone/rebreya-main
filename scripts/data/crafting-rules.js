const DAILY_PROGRESS_BY_HOURS = new Map([
  [8, 5],
  [9, 5.5],
  [10, 6],
  [11, 6.5],
  [12, 7],
  [13, 7.5],
  [14, 8],
  [15, 9],
  [16, 10]
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return cleanText(value).toLocaleLowerCase("ru-RU");
}

function toFiniteNumber(value, fallback = Number.NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundFive(value) {
  return Math.round((toFiniteNumber(value, 0) + Number.EPSILON) * 100000) / 100000;
}

function getPath(source, path) {
  return path.split(".").reduce((value, key) => value?.[key], source);
}

function hasProperty(properties, key) {
  if (properties instanceof Set) {
    return properties.has(key);
  }
  if (Array.isArray(properties)) {
    return properties.includes(key);
  }
  return properties?.[key] === true;
}

function isMagicGear(gear = {}) {
  const moduleFlags = getPath(gear, "flags.rebreya-main") ?? {};
  const sourceTypes = [gear.sourceType, gear.category, moduleFlags.sourceType].map(normalizeText);
  const itemTypes = [gear.type, gear.equipmentType].map(normalizeText);
  const rarity = normalizeText(gear.rarity ?? getPath(gear, "system.rarity"));
  const properties = gear.properties ?? getPath(gear, "system.properties");
  return gear.isMagic === true
    || gear.magic === true
    || gear.magical === true
    || sourceTypes.some((value) => ["magicitem", "magic-item", "magic item"].includes(value))
    || itemTypes.includes("магический предмет")
    || Boolean(cleanText(gear.magicItemId ?? moduleFlags.magicItemId))
    || moduleFlags.magical === true
    || moduleFlags.isMagic === true
    || hasProperty(properties, "mgc")
    || Boolean(rarity && !["mundane", "none", "обычный", "немагический"].includes(rarity))
    || moduleFlags.magicItem === true;
}

function isFirearmGear(gear = {}) {
  const profile = normalizeText(gear.profile);
  const equipmentType = normalizeText(gear.equipmentType ?? gear.weaponType);
  return gear.isFirearm === true
    || profile === "firearm"
    || Boolean(cleanText(gear.firearmClass))
    || equipmentType.includes("огнестрел")
    || equipmentType.includes("firearm");
}

function resolveGear(gearById, sourceId) {
  if (gearById instanceof Map) {
    return gearById.get(sourceId) ?? null;
  }
  if (Array.isArray(gearById)) {
    return gearById.find((gear) => cleanText(gear?.id) === sourceId) ?? null;
  }
  return gearById?.[sourceId] ?? null;
}

function resolveToolId(gear = {}) {
  return cleanText(gear.requiredToolId ?? gear.toolId ?? gear.linkedTool);
}

function buildError(code, message) {
  return { code, message };
}

function resolveToolAccess(toolAccess, toolId) {
  if (toolAccess instanceof Map) {
    return toolAccess.get(toolId) ?? null;
  }
  if (Array.isArray(toolAccess)) {
    return toolAccess.find((entry) => cleanText(entry?.toolId) === toolId) ?? null;
  }
  return toolAccess && typeof toolAccess === "object" ? toolAccess : null;
}

function hasToolAccess(access) {
  return Boolean(access && typeof access === "object" && (
    access.available === true
    || cleanText(access.source)
    || cleanText(access.itemUuid)
    || cleanText(access.toolId)
  ));
}

export function buildCraftBatch(outputs, gearById) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("A craft batch requires at least one output.");
  }

  const normalizedOutputs = outputs.map((output) => {
    const sourceId = cleanText(output?.sourceId ?? output?.id);
    const quantity = toFiniteNumber(output?.quantity, Number.NaN);
    if (!sourceId) {
      throw new Error("A craft output requires a source ID.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Craft output quantity must be a positive integer.");
    }

    const gear = resolveGear(gearById, sourceId);
    if (!gear) {
      throw new Error(`Craft gear '${sourceId}' was not found.`);
    }

    const priceGold = toFiniteNumber(gear.priceGoldEquivalent ?? gear.priceGold ?? gear.priceValue, Number.NaN);
    const sourceWeight = gear.weightLb ?? gear.weight;
    const weightLb = typeof sourceWeight === "number" && Number.isFinite(sourceWeight)
      ? sourceWeight
      : Number.NaN;
    if (!Number.isFinite(priceGold) || priceGold < 0) {
      throw new Error(`Craft gear '${sourceId}' has an invalid price.`);
    }
    if (!Number.isFinite(weightLb) || weightLb < 0) {
      throw new Error(`Craft gear '${sourceId}' has an invalid weight.`);
    }

    return {
      sourceId,
      quantity,
      name: cleanText(gear.name) || sourceId,
      priceGold,
      weightLb,
      rank: Math.max(0, Math.floor(toFiniteNumber(gear.rank, 0))),
      requiredToolId: resolveToolId(gear),
      isFirearm: isFirearmGear(gear),
      isMagic: isMagicGear(gear)
    };
  });

  const requiredToolIds = [...new Set(normalizedOutputs
    .map((output) => output.requiredToolId)
    .filter(Boolean))];
  const firearmSourceIds = normalizedOutputs
    .filter((output) => output.isFirearm)
    .map((output) => output.sourceId);

  return {
    outputs: normalizedOutputs,
    totalQuantity: normalizedOutputs.reduce((total, output) => total + output.quantity, 0),
    totalPriceGold: roundFive(normalizedOutputs.reduce(
      (total, output) => total + (output.priceGold * output.quantity),
      0
    )),
    totalWeightLb: roundFive(normalizedOutputs.reduce(
      (total, output) => total + (output.weightLb * output.quantity),
      0
    )),
    requiredRank: normalizedOutputs.reduce((rank, output) => Math.max(rank, output.rank), 0),
    requiredToolId: requiredToolIds.length === 1 ? requiredToolIds[0] : null,
    requiredToolIds,
    profile: firearmSourceIds.length ? "firearm" : "mundane",
    firearmSourceIds,
    hasMagicItems: normalizedOutputs.some((output) => output.isMagic)
  };
}

export function resolveDailyProgressGold({ hours = 8, profile = "mundane", effectiveBaseGold = 5 } = {}) {
  const safeHours = toFiniteNumber(hours, Number.NaN);
  if (!Number.isInteger(safeHours)) {
    throw new Error("Working hours must be an integer from 8 to 16.");
  }
  const baseProgress = DAILY_PROGRESS_BY_HOURS.get(safeHours);
  if (!baseProgress) {
    throw new Error("A workday must last from 8 to 16 hours.");
  }

  const safeEffectiveBase = toFiniteNumber(effectiveBaseGold, Number.NaN);
  if (!Number.isFinite(safeEffectiveBase) || safeEffectiveBase <= 0) {
    throw new Error("Effective base crafting progress must be greater than zero.");
  }

  const profileMultiplier = normalizeText(profile) === "firearm" ? 5 : 1;
  return roundFive(baseProgress * (safeEffectiveBase / 5) * profileMultiplier);
}

export function calculateMaterialReservation({
  totalPriceGold,
  totalWeightLb,
  predominantMaterial,
  baseRawMaterial
} = {}) {
  const safeTotalPrice = toFiniteNumber(totalPriceGold, Number.NaN);
  const safeTotalWeight = toFiniteNumber(totalWeightLb, Number.NaN);
  if (!Number.isFinite(safeTotalPrice) || safeTotalPrice < 0) {
    throw new Error("Craft output price must be a nonnegative number.");
  }
  if (!Number.isFinite(safeTotalWeight) || safeTotalWeight < 0) {
    throw new Error("Craft output weight must be a nonnegative number.");
  }

  const predominantPrice = toFiniteNumber(predominantMaterial?.priceGold, Number.NaN);
  const predominantUnitWeight = toFiniteNumber(
    predominantMaterial?.weightLb ?? predominantMaterial?.weight,
    Number.NaN
  );
  if (!Number.isFinite(predominantPrice) || predominantPrice <= 0) {
    throw new Error("Predominant material price must be greater than zero.");
  }
  if (!Number.isFinite(predominantUnitWeight) || predominantUnitWeight <= 0) {
    throw new Error("Predominant material weight must be greater than zero.");
  }

  const baseRawPrice = toFiniteNumber(baseRawMaterial?.priceGold, Number.NaN);
  const baseRawUnitWeight = toFiniteNumber(
    baseRawMaterial?.weightLb ?? baseRawMaterial?.weight,
    Number.NaN
  );
  if (!Number.isFinite(baseRawPrice) || baseRawPrice <= 0) {
    throw new Error("Base raw material price must be greater than zero.");
  }
  if (!Number.isFinite(baseRawUnitWeight) || baseRawUnitWeight <= 0) {
    throw new Error("Base raw material weight must be greater than zero.");
  }

  const materialValueGold = safeTotalPrice / 2;
  const predominantPricePerLb = predominantPrice / predominantUnitWeight;
  const predominantMaterialLb = Math.min(
    safeTotalWeight,
    materialValueGold / predominantPricePerLb
  );
  const predominantMaterialValueGold = predominantMaterialLb * predominantPricePerLb;
  const remainingMaterialValueGold = Math.max(0, materialValueGold - predominantMaterialValueGold);
  const baseRawMaterialQuantity = remainingMaterialValueGold / baseRawPrice;

  return {
    materialValueGold: roundFive(materialValueGold),
    predominantMaterialLb: roundFive(predominantMaterialLb),
    predominantMaterialValueGold: roundFive(predominantMaterialValueGold),
    baseRawMaterialQuantity: roundFive(baseRawMaterialQuantity),
    baseRawWeightLb: roundFive(baseRawMaterialQuantity * baseRawUnitWeight)
  };
}

export function calculateProjectWorkdays({ targetGold, hours = 8, profile = "mundane", effectiveBaseGold = 5 } = {}) {
  const safeTargetGold = toFiniteNumber(targetGold, Number.NaN);
  if (!Number.isFinite(safeTargetGold) || safeTargetGold < 0) {
    throw new Error("Craft project target must be a nonnegative number.");
  }
  if (safeTargetGold === 0) {
    return 0;
  }
  const dailyProgressGold = resolveDailyProgressGold({ hours, profile, effectiveBaseGold });
  return Math.ceil(safeTargetGold / dailyProgressGold);
}

export function validateCraftEligibility({
  batch,
  toolAccess,
  workshopApproved = false,
  blueprintIds = []
} = {}) {
  const source = batch && typeof batch === "object" ? batch : {};
  const errors = [];
  const outputs = Array.isArray(source.outputs) ? source.outputs : [];
  const requiredToolIds = Array.isArray(source.requiredToolIds) ? source.requiredToolIds : [];

  if (outputs.length === 0) {
    errors.push(buildError("empty-batch", "The craft batch has no outputs."));
  }
  const unresolvedToolSourceIds = outputs
    .filter((output) => !cleanText(output?.requiredToolId))
    .map((output) => cleanText(output?.sourceId))
    .filter(Boolean);
  if (unresolvedToolSourceIds.length) {
    errors.push(buildError(
      "tool-unresolved",
      `Craft tool metadata is missing for: ${unresolvedToolSourceIds.join(", ")}.`
    ));
  }
  if (source.hasMagicItems === true) {
    errors.push(buildError("magic-item", "Magical items cannot be crafted by this project."));
  }
  if (requiredToolIds.length > 1) {
    errors.push(buildError("incompatible-tools", "All outputs must require the same tool."));
  }

  const requiredToolId = cleanText(source.requiredToolId ?? requiredToolIds[0]);
  const access = resolveToolAccess(toolAccess, requiredToolId);
  const accessToolId = cleanText(access?.toolId);
  if (requiredToolId && (
    !hasToolAccess(access)
    || (accessToolId && accessToolId !== requiredToolId)
  )) {
    errors.push(buildError("tool-required", `The '${requiredToolId}' tool is required.`));
  }

  const accessRank = Math.max(0, Math.floor(toFiniteNumber(access?.rank, 0)));
  const requiredRank = Math.max(0, Math.floor(toFiniteNumber(source.requiredRank, 0)));
  if (accessRank < requiredRank) {
    errors.push(buildError("insufficient-tool-rank", `Tool rank ${requiredRank} is required.`));
  }
  if (workshopApproved !== true) {
    errors.push(buildError("workshop-required", "A workshop must be approved for the project."));
  }

  const availableBlueprintIds = new Set(Array.isArray(blueprintIds)
    ? blueprintIds.map((id) => cleanText(id)).filter(Boolean)
    : []);
  const missingBlueprintIds = (Array.isArray(source.firearmSourceIds) ? source.firearmSourceIds : [])
    .filter((sourceId) => !availableBlueprintIds.has(sourceId));
  if (missingBlueprintIds.length) {
    errors.push(buildError("blueprint-required", `Missing firearm blueprint: ${missingBlueprintIds.join(", ")}.`));
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
