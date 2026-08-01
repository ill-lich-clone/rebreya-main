import { rollLootgenBrokenState } from "./lootgen-durability.js";

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

function randomPick(values, random) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const index = Math.floor(random() * values.length);
  return values[index] ?? null;
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

function spendRemainingValueIntoRows(rows = [], remainingValue = 0) {
  const resultRows = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
  let remaining = Math.max(0, toInteger(remainingValue, 0));
  const spendableRows = resultRows
    .map((row, index) => ({
      index,
      value: Math.max(1, toInteger(row.value, 1))
    }))
    .filter((entry) => entry.value <= remaining);

  if (!spendableRows.length || remaining <= 0) {
    return { rows: resultRows, remainingValue: remaining };
  }

  const applySpend = (rowIndex, quantity) => {
    const row = resultRows[rowIndex];
    const extraQuantity = Math.max(0, toInteger(quantity, 0));
    if (!row || extraQuantity <= 0) {
      return 0;
    }

    const value = Math.max(1, toInteger(row.value, 1));
    row.quantity = Math.max(0, toInteger(row.quantity, 0)) + extraQuantity;
    row.totalValue = Math.max(0, toInteger(row.totalValue, 0)) + (value * extraQuantity);
    return value * extraQuantity;
  };

  if (remaining <= 200000) {
    const previous = Array(remaining + 1).fill(null);
    previous[0] = { rowIndex: -1, previousTotal: -1 };

    for (let total = 0; total <= remaining; total += 1) {
      if (!previous[total]) {
        continue;
      }

      for (const entry of spendableRows) {
        const nextTotal = total + entry.value;
        if (nextTotal <= remaining && !previous[nextTotal]) {
          previous[nextTotal] = {
            rowIndex: entry.index,
            previousTotal: total
          };
        }
      }
    }

    let bestTotal = remaining;
    while (bestTotal > 0 && !previous[bestTotal]) {
      bestTotal -= 1;
    }

    if (bestTotal > 0) {
      let cursor = bestTotal;
      const quantityByRowIndex = new Map();
      while (cursor > 0) {
        const step = previous[cursor];
        if (!step || step.rowIndex < 0) {
          break;
        }

        quantityByRowIndex.set(step.rowIndex, (quantityByRowIndex.get(step.rowIndex) ?? 0) + 1);
        cursor = step.previousTotal;
      }

      for (const [rowIndex, quantity] of quantityByRowIndex.entries()) {
        applySpend(rowIndex, quantity);
      }

      remaining -= bestTotal;
    }

    return { rows: resultRows, remainingValue: remaining };
  }

  const greedyRows = [...spendableRows].sort((left, right) => right.value - left.value);
  for (const entry of greedyRows) {
    const quantity = Math.floor(remaining / entry.value);
    if (quantity <= 0) {
      continue;
    }

    remaining -= applySpend(entry.index, quantity);
    if (remaining <= 0) {
      break;
    }
  }

  return { rows: resultRows, remainingValue: remaining };
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

  for (let index = 0; index < maxRows; index += 1) {
    const affordableMundane = safeMundanePool.filter((entry) => {
      if (entry.value > remainingValue) {
        return false;
      }

      const entryKey = `${entry.sourceType}:${entry.sourceId}`;
      return !usedUnique.has(entryKey);
    });
    const affordableMagic = safeMagicPool.filter((entry) => {
      if (entry.value > remainingValue) {
        return false;
      }

      const entryKey = `${entry.sourceType}:${entry.sourceId}`;
      return !usedUnique.has(entryKey);
    });
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
    const picked = randomPick(sourcePool, random);
    if (!picked) {
      break;
    }

    const pickedKey = `${picked.sourceType}:${picked.sourceId}`;
    usedUnique.add(pickedKey);
    let quantity = 1;
    if (picked.stackable) {
      const maxQtyByBudget = Math.max(1, Math.floor(remainingValue / picked.value));
      quantity = Math.max(1, Math.min(maxQtyByBudget, 1 + Math.floor(random() * 4)));
    }

    let totalValue = picked.value * quantity;
    if (totalValue > remainingValue) {
      quantity = 1;
      totalValue = picked.value;
    }
    picks.push({
      ...picked,
      isBroken: rollLootgenBrokenState({
        sourceType: picked.sourceType,
        chance: form.brokenEquipmentChance,
        isEligible: picked.breakable === true,
        random
      }),
      quantity,
      totalValue
    });

    remainingValue = Math.max(0, remainingValue - totalValue);
    if (remainingValue <= 0) {
      break;
    }
  }

  let rows = aggregateRows(picks);
  const budgetFill = spendRemainingValueIntoRows(rows, remainingValue);
  rows = budgetFill.rows;
  remainingValue = budgetFill.remainingValue;
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
