import { rollLootgenBrokenState } from "./lootgen-durability.js";
import { rollLootgenMultipleAppearance } from "./lootgen-multiple-appearance.js?v=1.4.128-lootgen-multiplicity";

const COIN_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function clampInteger(value, minimum, maximum, fallback) {
  return Math.min(maximum, Math.max(minimum, toInteger(value, fallback)));
}

function normalizeFilterMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value)
    .map(([key, enabled]) => {
      const normalized = String(enabled ?? "").trim().toLowerCase();
      const isEnabled = typeof enabled === "string"
        ? !["", "0", "false", "no"].includes(normalized)
        : Boolean(enabled);
      return [String(key ?? "").trim(), isEnabled];
    })
    .filter(([key]) => key));
}

export function normalizeLootgenForm(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rankMin = clampInteger(source.rankMin, 0, 10, 0);
  const rankMax = clampInteger(source.rankMax, 0, 10, 4);

  return {
    rankMin: Math.min(rankMin, rankMax),
    rankMax: Math.max(rankMin, rankMax),
    itemCount: clampInteger(source.itemCount, 1, 40, 8),
    optimalItemQuantity: clampInteger(source.optimalItemQuantity, 1, 100, 4),
    budgetValue: Math.max(0, toInteger(source.budgetValue, 5000)),
    magicPercent: clampInteger(source.magicPercent, 0, 100, 25),
    brokenEquipmentChance: clampInteger(source.brokenEquipmentChance, 0, 100, 0),
    includeGear: source.includeGear !== false,
    includeMagicItems: source.includeMagicItems === true,
    includeCoins: source.includeCoins !== false,
    gearTypeFilters: normalizeFilterMap(source.gearTypeFilters),
    magicTypeFilters: normalizeFilterMap(source.magicTypeFilters)
  };
}

function weightedRandomPick(values, getWeight, random) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const weighted = values
    .map((value) => ({ value, weight: Math.max(0, toNumber(getWeight(value), 0)) }))
    .filter((entry) => entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let threshold = Math.max(0, Math.min(0.9999999999999999, toNumber(random(), 0))) * totalWeight;
  for (const entry of weighted) {
    threshold -= entry.weight;
    if (threshold < 0) {
      return entry.value;
    }
  }
  return weighted.at(-1)?.value ?? null;
}

function candidateIdentity(candidate) {
  return `${String(candidate?.sourceType ?? "")}:${String(candidate?.sourceId ?? "")}`;
}

function candidateWeight(candidate, currentQuantity, optimalQuantity) {
  if (candidate?.sourceType === "magicItem") {
    return currentQuantity === 0 ? 1 : 0;
  }
  if (currentQuantity === 0) {
    return 4;
  }
  if (currentQuantity < optimalQuantity) {
    return 2;
  }
  return 0.5;
}

function normalizeCoins(coins = {}) {
  const result = {
    pp: Math.max(0, toInteger(coins.pp, 0)),
    gp: Math.max(0, toInteger(coins.gp, 0)),
    sp: Math.max(0, toInteger(coins.sp, 0)),
    cp: Math.max(0, toInteger(coins.cp, 0))
  };

  result.totalCopper = (result.pp * COIN_MULTIPLIERS.pp)
    + (result.gp * COIN_MULTIPLIERS.gp)
    + (result.sp * COIN_MULTIPLIERS.sp)
    + result.cp;

  return result;
}

function formatCoinsLabel(coins = {}) {
  const safeCoins = normalizeCoins(coins);
  const parts = [];
  if (safeCoins.pp > 0) parts.push(`${safeCoins.pp} пм`);
  if (safeCoins.gp > 0) parts.push(`${safeCoins.gp} зм`);
  if (safeCoins.sp > 0) parts.push(`${safeCoins.sp} см`);
  if (safeCoins.cp > 0) parts.push(`${safeCoins.cp} мм`);
  return parts.length ? parts.join(" ") : "0 мм";
}

function randomCoinsFromValue(totalValue, random) {
  let remaining = Math.max(0, toInteger(totalValue, 0));
  const coins = {
    pp: 0,
    gp: 0,
    sp: 0,
    cp: 0
  };

  for (const key of ["pp", "gp", "sp"]) {
    const multiplier = COIN_MULTIPLIERS[key];
    const maxCount = Math.floor(remaining / multiplier);
    if (maxCount <= 0) {
      continue;
    }

    const randomCount = Math.floor(random() * (maxCount + 1));
    coins[key] = randomCount;
    remaining -= randomCount * multiplier;
  }

  coins.cp = remaining;
  const normalized = normalizeCoins(coins);
  return {
    ...normalized,
    label: formatCoinsLabel(normalized)
  };
}

function aggregateRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.sourceType}:${row.sourceId}:${row.isBroken ? "broken" : "intact"}`;
    const isStackable = row.stackable === undefined
      ? ["material", "gear"].includes(String(row.sourceType ?? ""))
      : Boolean(row.stackable);
    const existing = map.get(key) ?? {
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      name: row.name,
      rank: row.rank,
      value: row.value,
      typeLabel: row.typeLabel,
      stackable: isStackable,
      isBroken: Boolean(row.isBroken),
      quantity: 0,
      totalValue: 0
    };

    if (existing.stackable) {
      existing.quantity += row.quantity;
      existing.totalValue += row.totalValue;
    }
    else if (existing.quantity <= 0) {
      const quantity = Math.max(1, toInteger(row.quantity, 1));
      existing.quantity = quantity;
      existing.totalValue = Math.max(existing.value * quantity, toInteger(row.totalValue, existing.value * quantity));
    }

    map.set(key, existing);
  }

  return Array.from(map.values())
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name, "ru"))
    .map((row, index) => ({
      ...row,
      rowIndex: index
    }));
}

export function generateLootgenResult({
  form: rawForm,
  mundanePool = [],
  magicPool = [],
  rankMin,
  rankMax,
  includeMagicItems = false,
  magicPercent = 0,
  itemCount = 1,
  optimalItemQuantity = 4,
  budgetValue = 0,
  includeCoins = true,
  brokenEquipmentChance = 0,
  batchId = "",
  generatedAt = "",
  random = Math.random
} = {}) {
  if (typeof random !== "function") {
    throw new TypeError("random must be a function");
  }

  const form = normalizeLootgenForm(rawForm ?? {
    rankMin,
    rankMax,
    itemCount,
    optimalItemQuantity,
    budgetValue,
    includeMagicItems,
    magicPercent,
    includeCoins,
    brokenEquipmentChance
  });
  const safeMundanePool = Array.isArray(mundanePool) ? mundanePool : [];
  const safeMagicPool = Array.isArray(magicPool) ? magicPool : [];
  if (!safeMundanePool.length && !safeMagicPool.length) {
    throw new Error("Для выбранных параметров нет доступных предметов.");
  }

  const magicChance = form.magicPercent / 100;
  const forceMagicOnly = form.includeMagicItems && magicChance >= 0.999;
  const maxRows = form.itemCount;
  const safeBudgetValue = form.budgetValue;
  let remainingValue = safeBudgetValue;
  const picks = [];
  const usedUnique = new Set();
  const quantitiesByIdentity = new Map();
  const isEligible = (entry) => {
    const identity = candidateIdentity(entry);
    if (usedUnique.has(identity)) {
      return false;
    }
    const value = Math.max(0, toInteger(entry?.value, 0));
    return value <= remainingValue;
  };
  const weightFor = (entry) => candidateWeight(
    entry,
    quantitiesByIdentity.get(candidateIdentity(entry)) ?? 0,
    form.optimalItemQuantity
  );

  let passMadeProgress = true;
  while (remainingValue > 0 && passMadeProgress) {
    passMadeProgress = false;
    for (let index = 0; index < maxRows; index += 1) {
      const affordableMundane = safeMundanePool.filter(isEligible);
      const affordableMagic = safeMagicPool.filter(isEligible);
      if (!affordableMundane.length && !affordableMagic.length) {
        break;
      }

      let sourcePool = [];
      if (forceMagicOnly) {
        sourcePool = affordableMagic;
      }
      else {
        const wantsMagic = form.includeMagicItems
          && affordableMagic.length > 0
          && (!affordableMundane.length || random() < magicChance);
        sourcePool = wantsMagic
          ? affordableMagic
          : (affordableMundane.length ? affordableMundane : affordableMagic);
      }
      const picked = weightedRandomPick(sourcePool, weightFor, random);
      if (!picked) {
        break;
      }

      const pickedKey = candidateIdentity(picked);
      const unitValue = Math.max(0, toInteger(picked.value, 0));
      let quantity = picked.sourceType === "magicItem" || picked.stackable === false
        ? 1
        : rollLootgenMultipleAppearance(picked.multipleAppearance ?? "1", random);
      if (unitValue > 0) {
        quantity = Math.min(quantity, Math.floor(remainingValue / unitValue));
      }
      quantity = Math.max(0, toInteger(quantity, 0));
      if (quantity <= 0) {
        usedUnique.add(pickedKey);
        continue;
      }

      const totalValue = unitValue * quantity;
      picks.push({
        ...picked,
        value: unitValue,
        isBroken: rollLootgenBrokenState({
          sourceType: picked.sourceType,
          chance: form.brokenEquipmentChance,
          isEligible: picked.breakable === true,
          random
        }),
        quantity,
        totalValue
      });
      quantitiesByIdentity.set(
        pickedKey,
        (quantitiesByIdentity.get(pickedKey) ?? 0) + quantity
      );
      if (picked.sourceType === "magicItem" || picked.stackable === false || unitValue <= 0) {
        usedUnique.add(pickedKey);
      }

      remainingValue = Math.max(0, remainingValue - totalValue);
      passMadeProgress = true;
      if (remainingValue <= 0) {
        break;
      }
    }
  }

  let rows = aggregateRows(picks);
  const spentValue = rows.reduce((sum, row) => sum + row.totalValue, 0);
  const coins = form.includeCoins ? randomCoinsFromValue(remainingValue, random) : randomCoinsFromValue(0, random);
  const safeBatchId = String(batchId ?? "").trim();
  rows = rows.map((row, index) => ({
    ...row,
    directGrantId: `lootgen:${safeBatchId}:row:${index}`
  }));

  return {
    rows,
    coins,
    spentValue,
    budgetValue: safeBudgetValue,
    totalItems: rows.reduce((sum, row) => sum + row.quantity, 0),
    generatedAt: String(generatedAt ?? ""),
    directCoinGrantId: `lootgen:${safeBatchId}:coins`,
    hasResult: rows.length > 0 || coins.totalCopper > 0
  };
}
