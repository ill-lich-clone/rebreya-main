const EPSILON = 1e-9;
const DEFAULT_ROUTE_STATE_LIMIT = 20000;
const TRANSPORT_MODE_NAMES = {
  peshkom: "Пешком",
  zemlya: "Земля",
  more: "Море",
  vozdukh: "Воздух",
  reka: "Река",
  pesok: "Песок",
  zhd: "ЖД"
};
const TRANSPORT_MODE_ALIASES = {
  peshkom: ["пешком"],
  zemlya: ["земля"],
  more: ["море"],
  vozdukh: ["воздух"],
  reka: ["река"],
  pesok: ["песок"],
  zhd: ["жд", "ж/д", "железная дорога"]
};

function toNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    rows.push(text);
  }

  return rows;
}

function normalizeMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function getLooseMatchKey(value) {
  return normalizeMatchText(value)
    .replace(/\u0451/gu, "\u0435")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function getFuzzyThreshold(value) {
  if (!value) {
    return 0;
  }

  if (value.length >= 11) {
    return 2;
  }

  if (value.length >= 5) {
    return 1;
  }

  return 0;
}

function getLevenshteinDistance(left, right) {
  const source = String(left ?? "");
  const target = String(right ?? "");
  if (source === target) {
    return 0;
  }

  if (!source.length) {
    return target.length;
  }

  if (!target.length) {
    return source.length;
  }

  const matrix = Array.from({ length: source.length + 1 }, (_, rowIndex) => {
    const row = new Array(target.length + 1).fill(0);
    row[0] = rowIndex;
    return row;
  });

  for (let columnIndex = 0; columnIndex <= target.length; columnIndex += 1) {
    matrix[0][columnIndex] = columnIndex;
  }

  for (let rowIndex = 1; rowIndex <= source.length; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= target.length; columnIndex += 1) {
      const cost = source[rowIndex - 1] === target[columnIndex - 1] ? 0 : 1;
      matrix[rowIndex][columnIndex] = Math.min(
        matrix[rowIndex - 1][columnIndex] + 1,
        matrix[rowIndex][columnIndex - 1] + 1,
        matrix[rowIndex - 1][columnIndex - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function indexRecords(records, key) {
  const index = new Map();
  for (const record of records) {
    if (!record[key]) {
      continue;
    }

    const bucket = index.get(record[key]) ?? [];
    bucket.push(record);
    index.set(record[key], bucket);
  }

  return index;
}

function resolveRecordMatch(name, strictIndex, looseIndex, records, { allowFuzzy = false } = {}) {
  const strictKey = normalizeMatchText(name);
  const strictMatches = strictIndex.get(strictKey) ?? [];
  if (strictMatches.length === 1) {
    return { matched: true, record: strictMatches[0], method: "strict" };
  }

  if (strictMatches.length > 1) {
    return { matched: false, reason: "ambiguous-target" };
  }

  const looseKey = getLooseMatchKey(name);
  const looseMatches = looseIndex.get(looseKey) ?? [];
  if (looseMatches.length === 1) {
    return { matched: true, record: looseMatches[0], method: "loose" };
  }

  if (looseMatches.length > 1) {
    return { matched: false, reason: "ambiguous-target" };
  }

  if (!allowFuzzy) {
    return { matched: false, reason: "missing-target" };
  }

  const maxDistance = getFuzzyThreshold(looseKey);
  if (!maxDistance) {
    return { matched: false, reason: "missing-target" };
  }

  const fuzzyMatches = records
    .filter((record) => record.looseKey)
    .map((record) => ({
      record,
      lengthDelta: Math.abs(record.looseKey.length - looseKey.length),
      distance: getLevenshteinDistance(looseKey, record.looseKey)
    }))
    .filter((candidate) => candidate.lengthDelta <= maxDistance && candidate.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance || left.lengthDelta - right.lengthDelta || left.record.city.name.localeCompare(right.record.city.name, "ru"));

  if (!fuzzyMatches.length) {
    return { matched: false, reason: "missing-target" };
  }

  const [best] = fuzzyMatches;
  const equallyGood = fuzzyMatches.filter((candidate) => candidate.distance === best.distance && candidate.lengthDelta === best.lengthDelta);
  if (equallyGood.length > 1) {
    return { matched: false, reason: "ambiguous-target" };
  }

  return { matched: true, record: best.record, method: "fuzzy" };
}

function resolveCityConnections(cities) {
  const normalizedCities = cities.map((city) => ({
    ...city,
    connections: Array.isArray(city.connections) ? city.connections.map((connection) => ({ ...connection })) : []
  }));

  const cityById = new Map(normalizedCities.map((city) => [city.id, city]));
  const records = normalizedCities.map((city) => ({
    city,
    strictKey: normalizeMatchText(city.name),
    looseKey: getLooseMatchKey(city.name)
  }));
  const strictIndex = indexRecords(records, "strictKey");
  const looseIndex = indexRecords(records, "looseKey");

  for (const city of normalizedCities) {
    const connectionOccurrences = new Map();
    city.connections = city.connections.map((connection) => {
      const connectionTypeKey = getLooseMatchKey(connection.connectionType) || "route";
      const rawTargetKey = connection.targetCityId || getLooseMatchKey(connection.targetName) || "unknown";
      if (connection.targetCityId && cityById.has(connection.targetCityId)) {
        const occurrenceKey = `${connectionTypeKey}|${connection.targetCityId}`;
        const occurrence = (connectionOccurrences.get(occurrenceKey) ?? 0) + 1;
        connectionOccurrences.set(occurrenceKey, occurrence);

        return {
          ...connection,
          connectionId: `${city.id}::${connectionTypeKey}::${connection.targetCityId}::${occurrence}`,
          isActive: connection.isActive !== false,
          broken: false
        };
      }

      const match = resolveRecordMatch(connection.targetName, strictIndex, looseIndex, records, { allowFuzzy: true });
      if (!match.matched) {
        const occurrenceKey = `${connectionTypeKey}|${rawTargetKey}`;
        const occurrence = (connectionOccurrences.get(occurrenceKey) ?? 0) + 1;
        connectionOccurrences.set(occurrenceKey, occurrence);

        return {
          ...connection,
          connectionId: `${city.id}::${connectionTypeKey}::${rawTargetKey}::${occurrence}`,
          isActive: connection.isActive !== false,
          targetCityId: null,
          broken: true,
          brokenReason: match.reason
        };
      }

      const occurrenceKey = `${connectionTypeKey}|${match.record.city.id}`;
      const occurrence = (connectionOccurrences.get(occurrenceKey) ?? 0) + 1;
      connectionOccurrences.set(occurrenceKey, occurrence);

      return {
        ...connection,
        connectionId: `${city.id}::${connectionTypeKey}::${match.record.city.id}::${occurrence}`,
        isActive: connection.isActive !== false,
        targetCityId: match.record.city.id,
        broken: false,
        resolvedBy: match.method
      };
    });
  }

  return normalizedCities;
}

function nearlyZero(value) {
  return Math.abs(value) < EPSILON;
}

function getStatus(balance, deficit, surplus) {
  if (deficit > EPSILON) {
    return "deficit";
  }

  if (surplus > EPSILON) {
    return "surplus";
  }

  if (nearlyZero(balance)) {
    return "balanced";
  }

  return balance > 0 ? "surplus" : "deficit";
}

function pickStackedEffectEntries(entries) {
  const rows = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const stacked = rows.filter((entry) => entry?.event?.stacking?.mode === "stack");
  const highestOnly = rows.filter((entry) => entry?.event?.stacking?.mode === "highestOnly");
  const lowestOnly = rows.filter((entry) => entry?.event?.stacking?.mode === "lowestOnly");
  const overrideByPriority = rows.filter((entry) => entry?.event?.stacking?.mode === "overrideByPriority");

  if (highestOnly.length) {
    stacked.push([...highestOnly].sort((left, right) => toNumber(right.effect?.value, 0) - toNumber(left.effect?.value, 0))[0]);
  }

  if (lowestOnly.length) {
    stacked.push([...lowestOnly].sort((left, right) => toNumber(left.effect?.value, 0) - toNumber(right.effect?.value, 0))[0]);
  }

  if (overrideByPriority.length) {
    stacked.push([...overrideByPriority].sort((left, right) => {
      const priorityDelta = toNumber(right.event?.stacking?.priority, 100) - toNumber(left.event?.stacking?.priority, 100);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return toNumber(right.event?.updatedAt, 0) - toNumber(left.event?.updatedAt, 0);
    })[0]);
  }

  return stacked.filter(Boolean);
}

function applyNumericEventEffects(baseValue, entries) {
  const rows = pickStackedEffectEntries(entries);
  if (!rows.length) {
    return toNumber(baseValue, 0);
  }

  let nextValue = toNumber(baseValue, 0);
  const flatRows = rows.filter((entry) => entry.effect?.mode === "flat");
  const addPercentRows = rows.filter((entry) => entry.effect?.mode === "addPercent");
  const multiplyRows = rows.filter((entry) => entry.effect?.mode === "multiply");
  const overrideRows = rows.filter((entry) => entry.effect?.mode === "override").sort((left, right) => {
    const priorityDelta = toNumber(right.event?.stacking?.priority, 100) - toNumber(left.event?.stacking?.priority, 100);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return toNumber(right.event?.updatedAt, 0) - toNumber(left.event?.updatedAt, 0);
  });

  if (flatRows.length) {
    nextValue += flatRows.reduce((sum, entry) => sum + toNumber(entry.effect?.value, 0), 0);
  }

  if (addPercentRows.length) {
    const delta = addPercentRows.reduce((sum, entry) => sum + toNumber(entry.effect?.value, 0), 0);
    nextValue *= (1 + delta);
  }

  for (const row of multiplyRows) {
    nextValue *= toNumber(row.effect?.value, 1);
  }

  if (overrideRows.length) {
    nextValue = toNumber(overrideRows[0].effect?.value, nextValue);
  }

  return nextValue;
}

function applyPercentEventEffects(entries) {
  return applyNumericEventEffects(1, entries) - 1;
}

function applyRouteEventModifiers(cities, routeEffectsByConnectionId = {}) {
  if (!routeEffectsByConnectionId || typeof routeEffectsByConnectionId !== "object") {
    return cities;
  }

  return cities.map((city) => ({
    ...city,
    connections: Array.isArray(city.connections)
      ? city.connections.map((connection) => {
        const routeModifier = routeEffectsByConnectionId[connection.connectionId] ?? null;
        if (!routeModifier) {
          return connection;
        }

        const eventAdditionalPricePercent = toNumber(routeModifier.routeCostPercent, 0);
        const eventDisabled = routeModifier.disableRoute === true;
        const riskNotes = Array.isArray(routeModifier.routeRiskNotes) ? routeModifier.routeRiskNotes : [];
        const sourceEventNames = Array.isArray(routeModifier.sourceEventNames) ? routeModifier.sourceEventNames : [];

        return {
          ...connection,
          additionalPricePercent: toNumber(connection.additionalPricePercent, 0) + eventAdditionalPricePercent,
          isActive: eventDisabled ? false : connection.isActive !== false,
          eventRouteCostPercent: eventAdditionalPricePercent,
          eventRouteCapacityPercent: toNumber(routeModifier.routeCapacityPercent, 0),
          eventRouteDisabled: eventDisabled,
          eventRouteRiskNotes: riskNotes,
          eventSourceNames: sourceEventNames,
          isModifiedByEvents: true
        };
      })
      : []
  }));
}

function applyCityGoodEventModifiers(cities, goods, globalEventModifiers = {}) {
  const cityEventsByCityId = globalEventModifiers?.cityEventsByCityId ?? {};
  const cityGoodEffectsByCityId = globalEventModifiers?.cityGoodEffectsByCityId ?? {};

  return cities.map((city) => {
    const cityGoodEffects = cityGoodEffectsByCityId[city.id] ?? {};
    const nextProduction = { ...(city.production ?? {}) };
    const nextDemand = { ...(city.demand ?? {}) };
    const eventPriceModifierByGood = {};
    const eventAvailabilityByGood = {};
    const eventRarityShiftByGood = {};
    const eventDetailsByGood = {};
    let selfSufficiencyModifierWeighted = 0;
    let selfSufficiencyModifierWeight = 0;

    for (const good of goods) {
      const goodId = good.id;
      const goodEffects = cityGoodEffects[goodId] ?? null;
      if (!goodEffects) {
        continue;
      }

      const baseProduction = toNumber(nextProduction[goodId], 0);
      const baseDemand = toNumber(nextDemand[goodId], 0);
      const productionWithEvents = Math.max(0, applyNumericEventEffects(baseProduction, goodEffects.productionEffects ?? []));
      const demandWithEvents = Math.max(0, applyNumericEventEffects(baseDemand, [
        ...(goodEffects.demandEffects ?? []),
        ...(goodEffects.importNeedEffects ?? [])
      ]));
      const eventPriceModifierPercent = applyPercentEventEffects(goodEffects.priceEffects ?? []);
      const availabilityBlockValue = applyNumericEventEffects(0, goodEffects.availabilityBlockEffects ?? []);
      const availabilityBoostValue = applyNumericEventEffects(0, goodEffects.availabilityBoostEffects ?? []);
      const blockedByEvents = availabilityBlockValue > availabilityBoostValue;
      const rarityShift = applyNumericEventEffects(0, goodEffects.rarityShiftEffects ?? []);
      const selfSufficiencyModifierPercent = applyPercentEventEffects(goodEffects.selfSufficiencyEffects ?? []);
      if (Math.abs(selfSufficiencyModifierPercent) > EPSILON) {
        const weight = Math.max(baseDemand, demandWithEvents, 1);
        selfSufficiencyModifierWeighted += selfSufficiencyModifierPercent * weight;
        selfSufficiencyModifierWeight += weight;
      }

      nextProduction[goodId] = productionWithEvents;
      nextDemand[goodId] = demandWithEvents;
      eventPriceModifierByGood[goodId] = eventPriceModifierPercent;
      eventAvailabilityByGood[goodId] = {
        blocked: blockedByEvents,
        boosted: availabilityBoostValue > 0,
        score: availabilityBlockValue - availabilityBoostValue
      };
      eventRarityShiftByGood[goodId] = rarityShift;
      eventDetailsByGood[goodId] = {
        productionDelta: productionWithEvents - baseProduction,
        demandDelta: demandWithEvents - baseDemand,
        priceModifierPercent: eventPriceModifierPercent,
        blocked: blockedByEvents,
        rarityShift,
        selfSufficiencyModifierPercent,
        sourceEventNames: uniqueStrings((goodEffects.sourceEvents ?? []).map((eventRow) => eventRow.name || eventRow.id))
      };
    }

    const selfSufficiencyModifierPercent = selfSufficiencyModifierWeight > EPSILON
      ? selfSufficiencyModifierWeighted / selfSufficiencyModifierWeight
      : 0;

    return {
      ...city,
      production: nextProduction,
      demand: nextDemand,
      eventPriceModifierByGood,
      eventAvailabilityByGood,
      eventRarityShiftByGood,
      eventDetailsByGood,
      selfSufficiencyModifierPercent,
      activeEventRows: cityEventsByCityId[city.id] ?? [],
      activeEventNames: uniqueStrings((cityEventsByCityId[city.id] ?? []).map((row) => row.name || row.id))
    };
  });
}

function buildGoodsRows(entity, goods) {
  return goods.map((good) => {
    const production = toNumber(entity.production?.[good.id]);
    const demand = toNumber(entity.demand?.[good.id]);
    const balance = production - demand;
    const deficit = Math.max(0, demand - production);
    const surplus = Math.max(0, production - demand);

    return {
      goodId: good.id,
      goodName: good.name,
      category: good.category,
      groupId: good.groupId,
      groupName: good.groupName,
      baseProductionPer1000: toNumber(good.baseProductionPer1000),
      baseConsumptionPer1000: toNumber(good.baseConsumptionPer1000),
      production,
      demand,
      balance,
      deficit,
      surplus,
      status: getStatus(balance, deficit, surplus),
      eventPriceModifierPercent: toNumber(entity?.eventPriceModifierByGood?.[good.id], 0),
      eventAvailability: entity?.eventAvailabilityByGood?.[good.id] ?? { blocked: false, boosted: false, score: 0 },
      eventRarityShift: toNumber(entity?.eventRarityShiftByGood?.[good.id], 0),
      selfSufficiencyModifierPercent: toNumber(entity?.eventDetailsByGood?.[good.id]?.selfSufficiencyModifierPercent, 0),
      eventSourceNames: uniqueStrings(entity?.eventDetailsByGood?.[good.id]?.sourceEventNames ?? [])
    };
  });
}

function indexGoodsRows(goodsRows) {
  return Object.fromEntries(goodsRows.map((row) => [row.goodId, row]));
}

function summarizeGoodsRows(goodsRows, selfSufficiencyModifierPercent = 0) {
  const totalProduction = goodsRows.reduce((sum, row) => sum + row.production, 0);
  const totalDemand = goodsRows.reduce((sum, row) => sum + row.demand, 0);
  const totalDeficit = goodsRows.reduce((sum, row) => sum + row.deficit, 0);
  const totalSurplus = goodsRows.reduce((sum, row) => sum + row.surplus, 0);
  const baseSelfSufficiencyRate = totalDemand > 0 ? Math.min(totalProduction / totalDemand, 1) : 1;
  const safeSelfSufficiencyModifierPercent = toNumber(selfSufficiencyModifierPercent, 0);
  const selfSufficiencyRate = clamp(baseSelfSufficiencyRate * (1 + safeSelfSufficiencyModifierPercent), 0, 1);
  const netBalance = totalProduction - totalDemand;

  const deficitGoods = goodsRows
    .filter((row) => row.deficit > EPSILON)
    .sort((left, right) => right.deficit - left.deficit || left.goodName.localeCompare(right.goodName, "ru"));

  const surplusGoods = goodsRows
    .filter((row) => row.surplus > EPSILON)
    .sort((left, right) => right.surplus - left.surplus || left.goodName.localeCompare(right.goodName, "ru"));

  const balanceByGood = Object.fromEntries(goodsRows.map((row) => [row.goodId, row.balance]));

  return {
    totalProduction,
    totalDemand,
    totalDeficit,
    totalSurplus,
    baseSelfSufficiencyRate,
    selfSufficiencyModifierPercent: safeSelfSufficiencyModifierPercent,
    selfSufficiencyRate,
    netBalance,
    balanceByGood,
    deficitGoods,
    surplusGoods,
    importNeeds: deficitGoods,
    exportCapacity: surplusGoods
  };
}

function createBaseSnapshot(city, goods, region) {
  const goodsRows = buildGoodsRows(city, goods);
  const summary = summarizeGoodsRows(goodsRows, toNumber(city?.selfSufficiencyModifierPercent, 0));

  return {
    ...city,
    region,
    regionName: city.regionName ?? region?.name ?? "",
    goodsRows,
    goodsRowById: indexGoodsRows(goodsRows),
    ...summary,
    connections: Array.isArray(city.connections) ? city.connections : [],
    activeEventRows: Array.isArray(city.activeEventRows) ? city.activeEventRows : [],
    activeEventNames: Array.isArray(city.activeEventNames) ? city.activeEventNames : [],
    eventDetailsByGood: city.eventDetailsByGood ?? {}
  };
}

function mapTradeGoods(rows, ownGoodsById, targetGoodsById, mode) {
  if (mode === "imports") {
    return rows.map((row) => ({
      ...row,
      overlap: Math.min(row.surplus, ownGoodsById[row.goodId]?.deficit ?? 0)
    }));
  }

  return rows.map((row) => ({
    ...row,
    overlap: Math.min(row.surplus, targetGoodsById[row.goodId]?.deficit ?? 0)
  }));
}

function normalizeStatePolicy(policy = {}) {
  const bilateralDuties = {};
  for (const [targetStateId, value] of Object.entries(policy?.bilateralDuties ?? {})) {
    const safeTargetStateId = String(targetStateId ?? "").trim();
    if (!safeTargetStateId) {
      continue;
    }
    bilateralDuties[safeTargetStateId] = toNumber(value, 0);
  }

  return {
    taxPercent: toNumber(policy?.taxPercent, 0),
    generalDutyPercent: toNumber(policy?.generalDutyPercent, 0),
    bilateralDuties
  };
}

function resolveEffectiveStatePolicies(cities, statePolicies = {}, globalEventModifiers = {}) {
  const safeStatePolicies = statePolicies && typeof statePolicies === "object" ? statePolicies : {};
  const stateEffectsByStateId = globalEventModifiers?.stateEffectsByStateId ?? {};
  const stateIds = new Set([
    ...Object.keys(safeStatePolicies),
    ...Object.keys(stateEffectsByStateId)
  ]);
  for (const city of cities ?? []) {
    const stateId = String(city?.state ?? "").trim();
    if (stateId) {
      stateIds.add(stateId);
    }
  }

  const effectiveStatePolicies = {};
  for (const stateId of stateIds) {
    const basePolicy = normalizeStatePolicy(safeStatePolicies[stateId] ?? {});
    const stateEffects = stateEffectsByStateId[stateId] ?? {};
    const bilateralDuties = {};
    const bilateralTargets = new Set([
      ...Object.keys(basePolicy.bilateralDuties),
      ...Object.keys(stateEffects?.bilateralTariffEffectsByTarget ?? {})
    ]);
    for (const targetStateId of bilateralTargets) {
      bilateralDuties[targetStateId] = applyNumericEventEffects(
        toNumber(basePolicy.bilateralDuties[targetStateId], 0),
        stateEffects?.bilateralTariffEffectsByTarget?.[targetStateId] ?? []
      );
    }

    effectiveStatePolicies[stateId] = {
      taxPercent: applyNumericEventEffects(basePolicy.taxPercent, stateEffects?.stateTaxEffects ?? []),
      generalDutyPercent: applyNumericEventEffects(basePolicy.generalDutyPercent, stateEffects?.tariffEffects ?? []),
      bilateralDuties
    };
  }

  return effectiveStatePolicies;
}

function getInterstateDutyPercent(effectiveStatePolicies = {}, sourceStateId = "", targetStateId = "") {
  const exporterStateId = String(sourceStateId ?? "").trim();
  const importerStateId = String(targetStateId ?? "").trim();
  if (!importerStateId || !exporterStateId || importerStateId === exporterStateId) {
    return 0;
  }

  const importerPolicy = effectiveStatePolicies?.[importerStateId] ?? {};
  const bilateralValue = importerPolicy?.bilateralDuties?.[exporterStateId];
  if (bilateralValue !== undefined && bilateralValue !== null && Number.isFinite(Number(bilateralValue))) {
    return toNumber(bilateralValue, 0);
  }

  return toNumber(importerPolicy?.generalDutyPercent, 0);
}

function buildTradeConnections(citySnapshot, cityById, effectiveStatePolicies = {}) {
  const modeIndex = buildTransportModeIndex(citySnapshot.reference ?? {});
  const tradeConnections = citySnapshot.connections.map((connection) => {
    const transportMode = resolveTransportMode(modeIndex, connection.connectionType);
    const targetCity = connection.targetCityId ? cityById.get(connection.targetCityId) : null;
    const interstateDutyPercent = targetCity
      ? getInterstateDutyPercent(effectiveStatePolicies, citySnapshot.state, targetCity.state)
      : 0;
    const routeCapacityPercent = toNumber(connection.eventRouteCapacityPercent, 0);
    const routeCapacityMultiplier = Math.max(0, 1 + routeCapacityPercent);
    const markupPercent = (transportMode?.movementCost ?? 0)
      + toNumber(connection.additionalPricePercent)
      + interstateDutyPercent;
    if (!targetCity) {
      return {
        ...connection,
        transportModeId: transportMode?.id ?? null,
        transportModeName: TRANSPORT_MODE_NAMES[transportMode?.id] ?? connection.connectionType,
        movementCost: transportMode?.movementCost ?? 0,
        markupPercent,
        interstateDutyPercent,
        eventRouteCostPercent: toNumber(connection.eventRouteCostPercent, 0),
        eventRouteCapacityPercent: routeCapacityPercent,
        eventRouteCapacityMultiplier: routeCapacityMultiplier,
        eventRouteDisabled: connection.eventRouteDisabled === true,
        eventRouteRiskNotes: Array.isArray(connection.eventRouteRiskNotes) ? connection.eventRouteRiskNotes : [],
        eventSourceNames: Array.isArray(connection.eventSourceNames) ? connection.eventSourceNames : [],
        isModifiedByEvents: connection.isModifiedByEvents === true,
        targetName: connection.targetName,
        targetState: "",
        targetStateId: "",
        targetRegionName: "",
        targetRegionId: "",
        importGoods: [],
        matchingNeeds: [],
        matchingExports: [],
        broken: true
      };
    }

    if (connection.isActive === false) {
      return {
        ...connection,
        transportModeId: transportMode?.id ?? null,
        transportModeName: TRANSPORT_MODE_NAMES[transportMode?.id] ?? connection.connectionType,
        movementCost: transportMode?.movementCost ?? 0,
        markupPercent,
        interstateDutyPercent,
        eventRouteCostPercent: toNumber(connection.eventRouteCostPercent, 0),
        eventRouteCapacityPercent: routeCapacityPercent,
        eventRouteCapacityMultiplier: routeCapacityMultiplier,
        eventRouteDisabled: connection.eventRouteDisabled === true,
        eventRouteRiskNotes: Array.isArray(connection.eventRouteRiskNotes) ? connection.eventRouteRiskNotes : [],
        eventSourceNames: Array.isArray(connection.eventSourceNames) ? connection.eventSourceNames : [],
        isModifiedByEvents: connection.isModifiedByEvents === true,
        targetName: targetCity.name,
        targetState: targetCity.state,
        targetStateId: targetCity.state,
        targetRegionName: targetCity.regionName,
        targetRegionId: targetCity.regionId,
        importGoods: [],
        matchingNeeds: [],
        matchingExports: [],
        broken: false,
        targetSelfSufficiencyRate: targetCity.selfSufficiencyRate,
        targetNetBalance: targetCity.netBalance
      };
    }

    const importGoods = mapTradeGoods(targetCity.surplusGoods, citySnapshot.goodsRowById, targetCity.goodsRowById, "imports");
    const matchingNeeds = importGoods
      .filter((row) => row.overlap > EPSILON)
      .sort((left, right) => right.overlap - left.overlap || right.surplus - left.surplus)
      .slice(0, 8);

    const matchingExports = mapTradeGoods(citySnapshot.surplusGoods, citySnapshot.goodsRowById, targetCity.goodsRowById, "exports")
      .filter((row) => row.overlap > EPSILON)
      .sort((left, right) => right.overlap - left.overlap || right.surplus - left.surplus)
      .slice(0, 8);

    return {
      ...connection,
      transportModeId: transportMode?.id ?? null,
      transportModeName: TRANSPORT_MODE_NAMES[transportMode?.id] ?? connection.connectionType,
      movementCost: transportMode?.movementCost ?? 0,
      markupPercent,
      interstateDutyPercent,
      eventRouteCostPercent: toNumber(connection.eventRouteCostPercent, 0),
      eventRouteCapacityPercent: routeCapacityPercent,
      eventRouteCapacityMultiplier: routeCapacityMultiplier,
      eventRouteDisabled: connection.eventRouteDisabled === true,
      eventRouteRiskNotes: Array.isArray(connection.eventRouteRiskNotes) ? connection.eventRouteRiskNotes : [],
      eventSourceNames: Array.isArray(connection.eventSourceNames) ? connection.eventSourceNames : [],
      isModifiedByEvents: connection.isModifiedByEvents === true,
      targetName: targetCity.name,
      targetState: targetCity.state,
      targetStateId: targetCity.state,
      targetRegionName: targetCity.regionName,
      targetRegionId: targetCity.regionId,
      importGoods: importGoods.slice(0, 8),
      matchingNeeds,
      matchingExports,
      broken: false,
      targetSelfSufficiencyRate: targetCity.selfSufficiencyRate,
      targetNetBalance: targetCity.netBalance
    };
  });

  return {
    tradeConnections,
    potentialImports: tradeConnections
      .filter((connection) => connection.isActive !== false && !connection.broken && (connection.matchingNeeds.length || connection.importGoods.length))
      .sort((left, right) => {
        const leftScore = left.matchingNeeds.reduce((sum, row) => sum + row.overlap, 0);
        const rightScore = right.matchingNeeds.reduce((sum, row) => sum + row.overlap, 0);
        return rightScore - leftScore || left.targetName.localeCompare(right.targetName, "ru");
      }),
    potentialExports: tradeConnections
      .filter((connection) => connection.isActive !== false && !connection.broken && connection.matchingExports.length)
      .sort((left, right) => {
        const leftScore = left.matchingExports.reduce((sum, row) => sum + row.overlap, 0);
        const rightScore = right.matchingExports.reduce((sum, row) => sum + row.overlap, 0);
        return rightScore - leftScore || left.targetName.localeCompare(right.targetName, "ru");
      }),
    brokenConnections: tradeConnections.filter((connection) => connection.broken)
  };
}

function buildTransportModeIndex(reference) {
  const transportModes = Array.isArray(reference?.transportModes) ? reference.transportModes : [];
  const modeKeys = [];
  const byKey = new Map();

  for (const mode of transportModes) {
    const movementCost = toNumber(mode.movementCost);
    const maxSteps = Math.max(1, Math.round(toNumber(mode.maxSteps) || 1));
    const markupPercent = toNumber(mode.markupPercent) || (movementCost * maxSteps);
    const normalizedMode = {
      id: mode.id,
      name: mode.name,
      movementCost,
      maxSteps,
      markupPercent,
      stepMovementCost: 0,
      stepMarkupPercent: 0
    };
    normalizedMode.stepMovementCost = normalizedMode.movementCost;
    normalizedMode.stepMarkupPercent = normalizedMode.movementCost;
    modeKeys.push(normalizedMode.id);

    const keys = new Set([
      normalizeMatchText(normalizedMode.name),
      getLooseMatchKey(normalizedMode.name),
      normalizeMatchText(normalizedMode.id),
      getLooseMatchKey(normalizedMode.id)
    ]);
    for (const alias of TRANSPORT_MODE_ALIASES[normalizedMode.id] ?? []) {
      keys.add(normalizeMatchText(alias));
      keys.add(getLooseMatchKey(alias));
    }

    for (const key of keys) {
      if (key) {
        byKey.set(key, normalizedMode);
      }
    }
  }

  return {
    modeKeys,
    byKey,
    byId: new Map(transportModes.map((mode) => [mode.id, mode]))
  };
}

function resolveTransportMode(modeIndex, connectionType) {
  const keys = [
    normalizeMatchText(connectionType),
    getLooseMatchKey(connectionType)
  ];

  for (const key of keys) {
    if (key && modeIndex.byKey.has(key)) {
      return modeIndex.byKey.get(key);
    }
  }

  return null;
}

function createRouteStateKey(cityId, modeKeys, counts) {
  return `${cityId}|${modeKeys.map((key) => counts[key] ?? 0).join(",")}`;
}

class MinPriorityQueue {
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  enqueue(value) {
    this.items.push(value);
    this.#bubbleUp(this.items.length - 1);
  }

  dequeue() {
    if (!this.items.length) {
      return null;
    }

    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      this.#bubbleDown(0);
    }

    return first;
  }

  #bubbleUp(index) {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.compare(this.items[currentIndex], this.items[parentIndex]) >= 0) {
        break;
      }

      [this.items[currentIndex], this.items[parentIndex]] = [this.items[parentIndex], this.items[currentIndex]];
      currentIndex = parentIndex;
    }
  }

  #bubbleDown(index) {
    let currentIndex = index;
    while (true) {
      const leftIndex = (currentIndex * 2) + 1;
      const rightIndex = leftIndex + 1;
      let nextIndex = currentIndex;

      if (
        leftIndex < this.items.length &&
        this.compare(this.items[leftIndex], this.items[nextIndex]) < 0
      ) {
        nextIndex = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        this.compare(this.items[rightIndex], this.items[nextIndex]) < 0
      ) {
        nextIndex = rightIndex;
      }

      if (nextIndex === currentIndex) {
        break;
      }

      [this.items[currentIndex], this.items[nextIndex]] = [this.items[nextIndex], this.items[currentIndex]];
      currentIndex = nextIndex;
    }
  }
}

function formatRoutePath(route) {
  return route.legs.map((leg) => `${leg.fromCityName} -> ${leg.toCityName} (${leg.connectionType})`).join(" / ");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getLocalPriceMultiplier(row) {
  const localSupply = toNumber(row.production);
  const demand = toNumber(row.demand);

  if (localSupply <= EPSILON) {
    return 1;
  }

  if (localSupply <= demand + EPSILON) {
    return 1;
  }

  const demandRatio = demand > EPSILON ? demand / localSupply : 0;
  return clamp(demandRatio, 0.2, 1);
}

function compareRouteState(left, right) {
  if (Math.abs(left.totalMarkupPercent - right.totalMarkupPercent) > EPSILON) {
    return left.totalMarkupPercent - right.totalMarkupPercent;
  }

  if (Math.abs(left.totalMovementCost - right.totalMovementCost) > EPSILON) {
    return left.totalMovementCost - right.totalMovementCost;
  }

  const leftCapacityMultiplier = toNumber(left.routeCapacityMultiplier, 1);
  const rightCapacityMultiplier = toNumber(right.routeCapacityMultiplier, 1);
  if (Math.abs(leftCapacityMultiplier - rightCapacityMultiplier) > EPSILON) {
    return rightCapacityMultiplier - leftCapacityMultiplier;
  }

  return left.legs.length - right.legs.length;
}

function getModeCount(counts, modeId) {
  return counts?.[modeId] ?? 0;
}

function doesRouteStateStrictlyDominate(left, right, modeKeys) {
  if (left.cityId !== right.cityId) {
    return false;
  }

  if (!modeKeys.every((modeId) => getModeCount(left.counts, modeId) <= getModeCount(right.counts, modeId))) {
    return false;
  }

  if (left.totalMarkupPercent > right.totalMarkupPercent + EPSILON) {
    return false;
  }

  if (
    Math.abs(left.totalMarkupPercent - right.totalMarkupPercent) <= EPSILON &&
    left.totalMovementCost > right.totalMovementCost + EPSILON
  ) {
    return false;
  }

  if (toNumber(left.routeCapacityMultiplier, 1) + EPSILON < toNumber(right.routeCapacityMultiplier, 1)) {
    return false;
  }

  const betterMarkup = left.totalMarkupPercent < right.totalMarkupPercent - EPSILON;
  const betterMovement = left.totalMovementCost < right.totalMovementCost - EPSILON;
  const betterCapacity = toNumber(left.routeCapacityMultiplier, 1) > toNumber(right.routeCapacityMultiplier, 1) + EPSILON;
  const usesLessModes = modeKeys.some((modeId) => getModeCount(left.counts, modeId) < getModeCount(right.counts, modeId));

  return betterMarkup || betterMovement || betterCapacity || usesLessModes;
}

function addRouteStateToFrontier(frontierByCity, state, modeKeys) {
  const frontier = frontierByCity.get(state.cityId) ?? [];
  if (frontier.some((candidate) => doesRouteStateStrictlyDominate(candidate, state, modeKeys))) {
    return false;
  }

  const nextFrontier = frontier.filter((candidate) => !doesRouteStateStrictlyDominate(state, candidate, modeKeys));
  nextFrontier.push({
    cityId: state.cityId,
    totalMovementCost: state.totalMovementCost,
    totalMarkupPercent: state.totalMarkupPercent,
    routeCapacityMultiplier: toNumber(state.routeCapacityMultiplier, 1),
    counts: { ...state.counts }
  });
  frontierByCity.set(state.cityId, nextFrontier);
  return true;
}

export function buildReachableImportRoutesForCity(
  originCityId,
  cityById,
  reference,
  {
    maxVisitedStates = DEFAULT_ROUTE_STATE_LIMIT,
    statePolicyMap = {}
  } = {}
) {
  const modeIndex = buildTransportModeIndex(reference);
  const originCity = cityById.get(originCityId);
  if (!originCity) {
    return {
      routes: new Map(),
      exploredStates: 0,
      truncated: false
    };
  }

  const queue = new MinPriorityQueue(compareRouteState);
  const initialState = {
    cityId: originCity.id,
    totalMovementCost: 0,
    totalMarkupPercent: 0,
    routeCapacityMultiplier: 1,
    counts: {},
    legs: []
  };
  queue.enqueue(initialState);
  const bestState = new Map([
    [createRouteStateKey(originCity.id, modeIndex.modeKeys, {}), { totalMovementCost: 0, totalMarkupPercent: 0, routeCapacityMultiplier: 1 }]
  ]);
  const frontierByCity = new Map();
  addRouteStateToFrontier(frontierByCity, initialState, modeIndex.modeKeys);
  const bestRoutes = new Map();
  let exploredStates = 0;

  while (queue.size && exploredStates < maxVisitedStates) {
    const current = queue.dequeue();
    if (!current) {
      break;
    }

    if ((frontierByCity.get(current.cityId) ?? []).some((candidate) => doesRouteStateStrictlyDominate(candidate, current, modeIndex.modeKeys))) {
      continue;
    }

    exploredStates += 1;
    const currentCity = cityById.get(current.cityId);
    if (!currentCity) {
      continue;
    }

    for (const connection of currentCity.connections ?? []) {
      if (connection.isActive === false || connection.broken || !connection.targetCityId || !cityById.has(connection.targetCityId)) {
        continue;
      }

      const mode = resolveTransportMode(modeIndex, connection.connectionType);
      if (!mode) {
        continue;
      }

      const nextCount = (current.counts[mode.id] ?? 0) + 1;
      if (nextCount > mode.maxSteps) {
        continue;
      }

      const nextCounts = {
        ...current.counts,
        [mode.id]: nextCount
      };
      const nextCity = cityById.get(connection.targetCityId);
      const additionalPricePercent = toNumber(connection.additionalPricePercent);
      const interstateDutyPercent = getInterstateDutyPercent(statePolicyMap, nextCity.state, currentCity.state);
      const legCapacityPercent = toNumber(connection.eventRouteCapacityPercent, 0);
      const legCapacityMultiplier = Math.max(0, 1 + legCapacityPercent);
      const nextMovementCost = current.totalMovementCost + mode.stepMovementCost;
      const nextMarkupPercent = current.totalMarkupPercent + mode.stepMarkupPercent + additionalPricePercent + interstateDutyPercent;
      const nextRouteCapacityMultiplier = Math.max(
        0,
        Math.min(toNumber(current.routeCapacityMultiplier, 1), legCapacityMultiplier)
      );
      const nextLegs = current.legs.concat({
        fromCityId: currentCity.id,
        fromCityName: currentCity.name,
        toCityId: nextCity.id,
        toCityName: nextCity.name,
        connectionId: connection.connectionId,
        connectionType: connection.connectionType,
        modeId: mode.id,
        stepMovementCost: mode.stepMovementCost,
        stepMarkupPercent: mode.stepMarkupPercent,
        additionalPricePercent,
        interstateDutyPercent,
        routeCapacityPercent: legCapacityPercent,
        routeCapacityMultiplier: legCapacityMultiplier
      });
      const stateKey = createRouteStateKey(nextCity.id, modeIndex.modeKeys, nextCounts);
      const bestStateRoute = bestState.get(stateKey);
      if (bestStateRoute) {
        const markupDelta = nextMarkupPercent - bestStateRoute.totalMarkupPercent;
        const movementDelta = nextMovementCost - bestStateRoute.totalMovementCost;
        const capacityDelta = nextRouteCapacityMultiplier - toNumber(bestStateRoute.routeCapacityMultiplier, 1);
        if (
          markupDelta > EPSILON
          || (
            Math.abs(markupDelta) <= EPSILON
            && (
              movementDelta > EPSILON
              || (Math.abs(movementDelta) <= EPSILON && capacityDelta <= EPSILON)
            )
          )
        ) {
          continue;
        }
      }

      const nextState = {
        cityId: nextCity.id,
        totalMovementCost: nextMovementCost,
        totalMarkupPercent: nextMarkupPercent,
        routeCapacityMultiplier: nextRouteCapacityMultiplier,
        counts: nextCounts,
        legs: nextLegs
      };

      if (!addRouteStateToFrontier(frontierByCity, nextState, modeIndex.modeKeys)) {
        continue;
      }

      bestState.set(stateKey, {
        totalMovementCost: nextMovementCost,
        totalMarkupPercent: nextMarkupPercent,
        routeCapacityMultiplier: nextRouteCapacityMultiplier
      });
      queue.enqueue(nextState);

      if (nextCity.id === originCity.id) {
        continue;
      }

      const currentBestRoute = bestRoutes.get(nextCity.id);
      if (
        !currentBestRoute ||
        nextMarkupPercent < currentBestRoute.totalMarkupPercent - EPSILON ||
        (
          Math.abs(nextMarkupPercent - currentBestRoute.totalMarkupPercent) < EPSILON &&
          (
            nextMovementCost < currentBestRoute.totalMovementCost - EPSILON ||
            (
              Math.abs(nextMovementCost - currentBestRoute.totalMovementCost) < EPSILON &&
              (
                nextRouteCapacityMultiplier > toNumber(currentBestRoute.routeCapacityMultiplier, 1) + EPSILON
                || (
                  Math.abs(nextRouteCapacityMultiplier - toNumber(currentBestRoute.routeCapacityMultiplier, 1)) <= EPSILON
                  && nextLegs.length < currentBestRoute.legs.length
                )
              )
            )
          )
        )
      ) {
        bestRoutes.set(nextCity.id, {
          connectionId: connection.connectionId,
          sourceCityId: nextCity.id,
          sourceCityName: nextCity.name,
          totalMovementCost: nextMovementCost,
          totalMarkupPercent: nextMarkupPercent,
          routeCapacityMultiplier: nextRouteCapacityMultiplier,
          routeCapacityPercent: nextRouteCapacityMultiplier - 1,
          stepCount: nextLegs.length,
          counts: nextCounts,
          legs: nextLegs,
          pathLabel: formatRoutePath({ legs: nextLegs })
        });
      }
    }
  }

  return {
    routes: bestRoutes,
    exploredStates,
    truncated: queue.size > 0
  };
}

function buildImportPriceAnalysis(citySnapshot, cityById, routesForCity) {
  const goodsRows = citySnapshot.goodsRows.map((row) => {
    const localSupply = row.production;
    const localPriceMultiplier = getLocalPriceMultiplier(row);
    const selfSufficiencyModifierPercent = toNumber(row.selfSufficiencyModifierPercent, 0);
    const importNeedMultiplier = clamp(1 - selfSufficiencyModifierPercent, 0, 3);
    const adjustedImportNeed = Math.max(0, row.deficit * importNeedMultiplier);
    let remainingNeed = adjustedImportNeed;
    let importedQuantity = 0;
    let weightedImportCost = 0;

    const importSources = Array.from(routesForCity.values())
      .map((route) => {
        const sourceCity = cityById.get(route.sourceCityId);
        const sourceRow = sourceCity?.goodsRowById?.[row.goodId];
        return {
          route,
          sourceCity,
          sourceRow,
          availableSurplus: sourceRow?.surplus ?? 0
        };
      })
      .filter((candidate) => candidate.availableSurplus > EPSILON)
      .sort((left, right) => {
        if (Math.abs(left.route.totalMarkupPercent - right.route.totalMarkupPercent) > EPSILON) {
          return left.route.totalMarkupPercent - right.route.totalMarkupPercent;
        }

        if (Math.abs(right.availableSurplus - left.availableSurplus) > EPSILON) {
          return right.availableSurplus - left.availableSurplus;
        }

        return left.route.sourceCityName.localeCompare(right.route.sourceCityName, "ru");
      })
      .map((candidate) => {
        if (remainingNeed <= EPSILON) {
          return null;
        }

        const routeCapacityMultiplier = Math.max(0, toNumber(candidate.route.routeCapacityMultiplier, 1));
        const routeCapacityLimit = Math.min(
          candidate.availableSurplus,
          Math.max(0, candidate.availableSurplus * routeCapacityMultiplier)
        );
        const quantity = Math.min(remainingNeed, routeCapacityLimit);
        if (quantity <= EPSILON) {
          return null;
        }

        remainingNeed -= quantity;
        importedQuantity += quantity;
        weightedImportCost += quantity * (1 + candidate.route.totalMarkupPercent);

        return {
          connectionId: candidate.route.connectionId,
          sourceCityId: candidate.route.sourceCityId,
          sourceCityName: candidate.route.sourceCityName,
          quantity,
          routeCapacityMultiplier,
          routeCapacityPercent: routeCapacityMultiplier - 1,
          routeCapacityLimit,
          movementCost: candidate.route.totalMovementCost,
          markupPercent: candidate.route.totalMarkupPercent,
          stepCount: candidate.route.stepCount,
          pathLabel: candidate.route.pathLabel,
          legs: candidate.route.legs
        };
      })
      .filter(Boolean);

    const totalAvailableSupply = localSupply + importedQuantity;
    const weightedMarketCost = (localSupply * localPriceMultiplier) + weightedImportCost;
    const averagePriceMultiplier = totalAvailableSupply > EPSILON ? weightedMarketCost / totalAvailableSupply : 1;
    const routePriceModifierPercent = averagePriceMultiplier - 1;
    const eventPriceModifierPercent = toNumber(row.eventPriceModifierPercent, 0);
    const priceModifierPercent = clamp(routePriceModifierPercent + eventPriceModifierPercent, -0.8, Number.POSITIVE_INFINITY);
    const effectiveDemand = Math.max(localSupply, localSupply + adjustedImportNeed);
    const coverageRate = effectiveDemand > EPSILON ? Math.min(totalAvailableSupply / effectiveDemand, 1) : 1;

    return {
      ...row,
      importSources,
      importedQuantity,
      importNeedMultiplier,
      adjustedImportNeed,
      localSupply,
      localPriceMultiplier,
      totalAvailableSupply,
      averagePriceMultiplier,
      routePriceModifierPercent,
      eventPriceModifierPercent,
      priceModifierPercent,
      coverageRate,
      uncoveredDemand: Math.max(0, effectiveDemand - totalAvailableSupply),
      blockedByEvents: row?.eventAvailability?.blocked === true
    };
  });

  return {
    goodsRows,
    goodsWithImports: goodsRows
      .filter((row) => row.importSources.length)
      .sort((left, right) => right.priceModifierPercent - left.priceModifierPercent || left.goodName.localeCompare(right.goodName, "ru"))
  };
}

function aggregateSnapshots(snapshots, goods, keyBuilder, metadataBuilder) {
  const groups = new Map();

  for (const city of snapshots) {
    const key = keyBuilder(city);
    const group = groups.get(key) ?? {
      ...metadataBuilder(city),
      cityIds: [],
      cityCount: 0,
      population: 0,
      production: {},
      demand: {},
      selfSufficiencyModifierWeighted: 0,
      selfSufficiencyModifierWeight: 0
    };

    group.cityIds.push(city.id);
    group.cityCount += 1;
    group.population += toNumber(city.population);

    for (const row of city.goodsRows) {
      group.production[row.goodId] = toNumber(group.production[row.goodId]) + row.production;
      group.demand[row.goodId] = toNumber(group.demand[row.goodId]) + row.demand;
    }

    const citySelfSufficiencyModifierPercent = toNumber(city?.selfSufficiencyModifierPercent, 0);
    if (Math.abs(citySelfSufficiencyModifierPercent) > EPSILON) {
      const weight = Math.max(toNumber(city?.totalDemand, 0), 1);
      group.selfSufficiencyModifierWeighted += citySelfSufficiencyModifierPercent * weight;
      group.selfSufficiencyModifierWeight += weight;
    }

    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map((group) => {
      const goodsRows = goods.map((good) => {
        const production = toNumber(group.production[good.id]);
        const demand = toNumber(group.demand[good.id]);
        const balance = production - demand;
        const deficit = Math.max(0, demand - production);
        const surplus = Math.max(0, production - demand);

        return {
          goodId: good.id,
          goodName: good.name,
          category: good.category,
          groupId: good.groupId,
          groupName: good.groupName,
          production,
          demand,
          balance,
          deficit,
          surplus,
          status: getStatus(balance, deficit, surplus)
        };
      });

      const selfSufficiencyModifierPercent = group.selfSufficiencyModifierWeight > EPSILON
        ? group.selfSufficiencyModifierWeighted / group.selfSufficiencyModifierWeight
        : 0;

      return {
        ...group,
        goodsRows,
        ...summarizeGoodsRows(goodsRows, selfSufficiencyModifierPercent)
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function buildOverview(snapshots, goods) {
  const population = snapshots.reduce((sum, city) => sum + toNumber(city.population), 0);
  const totalProduction = snapshots.reduce((sum, city) => sum + city.totalProduction, 0);
  const totalDemand = snapshots.reduce((sum, city) => sum + city.totalDemand, 0);
  const totalDeficit = snapshots.reduce((sum, city) => sum + city.totalDeficit, 0);
  const totalSurplus = snapshots.reduce((sum, city) => sum + city.totalSurplus, 0);
  const averageSelfSufficiency = snapshots.length
    ? snapshots.reduce((sum, city) => sum + city.selfSufficiencyRate, 0) / snapshots.length
    : 1;

  const goodsRows = goods.map((good) => {
    const production = snapshots.reduce((sum, city) => sum + (city.goodsRowById[good.id]?.production ?? 0), 0);
    const demand = snapshots.reduce((sum, city) => sum + (city.goodsRowById[good.id]?.demand ?? 0), 0);
    const balance = production - demand;
    const deficit = Math.max(0, demand - production);
    const surplus = Math.max(0, production - demand);

    return {
      goodId: good.id,
      goodName: good.name,
      production,
      demand,
      balance,
      deficit,
      surplus,
      status: getStatus(balance, deficit, surplus)
    };
  });

  return {
    cityCount: snapshots.length,
    population,
    totalProduction,
    totalDemand,
    totalDeficit,
    totalSurplus,
    averageSelfSufficiency,
    deficitGoods: goodsRows.filter((row) => row.deficit > EPSILON).sort((a, b) => b.deficit - a.deficit),
    surplusGoods: goodsRows.filter((row) => row.surplus > EPSILON).sort((a, b) => b.surplus - a.surplus)
  };
}

function applyTradeRouteOverrides(cities, tradeRouteOverrides = {}) {
  if (!tradeRouteOverrides || typeof tradeRouteOverrides !== "object") {
    return cities;
  }

  return cities.map((city) => ({
    ...city,
    connections: Array.isArray(city.connections)
      ? city.connections.map((connection) => {
        const override = tradeRouteOverrides[connection.connectionId] ?? {};
        return {
          ...connection,
          description: String(override.description ?? connection.description ?? "").trim(),
          additionalPricePercent: toNumber(override.additionalPricePercent ?? connection.additionalPricePercent)
        };
      })
      : []
  }));
}

function buildTradeRouteIndex(citySnapshots) {
  const tradeRoutes = citySnapshots.flatMap((city) => (city.tradeConnections ?? []).map((connection) => ({
    ...connection,
    sourceCityId: city.id,
    sourceCityName: city.name,
    sourceState: city.state,
    sourceStateId: city.state,
    sourceRegionId: city.regionId,
    sourceRegionName: city.regionName,
    sourceCityType: city.cityType
  })));

  return {
    tradeRoutes,
    tradeRouteById: new Map(tradeRoutes.map((route) => [route.connectionId, route]))
  };
}

function applyConnectionStates(cities, connectionStates = {}) {
  if (!connectionStates || typeof connectionStates !== "object") {
    return cities;
  }

  return cities.map((city) => ({
    ...city,
    connections: Array.isArray(city.connections)
      ? city.connections.map((connection) => ({
        ...connection,
        isActive: connectionStates[connection.connectionId] !== false
      }))
      : []
  }));
}

export function buildEconomyModel(
  dataset,
  {
    connectionStates = {},
    tradeRouteOverrides = {},
    statePolicies = {},
    globalEventModifiers = null
  } = {}
) {
  const goods = Array.isArray(dataset.goods) ? dataset.goods : [];
  const regions = Array.isArray(dataset.regions) ? dataset.regions : [];
  const resolvedCities = resolveCityConnections(Array.isArray(dataset.cities) ? dataset.cities : []);
  const activeCities = applyConnectionStates(resolvedCities, connectionStates);
  const overriddenCities = applyTradeRouteOverrides(activeCities, tradeRouteOverrides);
  const citiesWithRouteEvents = applyRouteEventModifiers(
    overriddenCities,
    globalEventModifiers?.routeEffectsByConnectionId ?? {}
  );
  const cities = applyCityGoodEventModifiers(citiesWithRouteEvents, goods, globalEventModifiers ?? {});
  const effectiveStatePolicies = resolveEffectiveStatePolicies(cities, statePolicies, globalEventModifiers ?? {});
  const materials = Array.isArray(dataset.materials) ? dataset.materials : [];
  const gear = Array.isArray(dataset.gear) ? dataset.gear : [];
  const reference = dataset.reference ?? {};

  const regionById = new Map(regions.map((region) => [region.id, region]));
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const materialByGoodId = new Map(
    materials
      .filter((material) => material.linkedGoodId)
      .map((material) => [material.linkedGoodId, material])
  );
  const baseSnapshots = cities.map((city) => createBaseSnapshot(city, goods, regionById.get(city.regionId) ?? null));
  const baseCityById = new Map(baseSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const citySnapshots = baseSnapshots.map((snapshot) => {
    const tradeConnections = buildTradeConnections({ ...snapshot, reference }, baseCityById, effectiveStatePolicies);

    return {
      ...snapshot,
      ...tradeConnections,
      goodsWithImports: [],
      importRouteStats: null
    };
  });

  const cityById = new Map(citySnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const stateSummaries = aggregateSnapshots(
    citySnapshots,
    goods,
    (city) => city.state,
    (city) => ({ id: city.state, name: city.state, state: city.state })
  );
  const regionSummaries = aggregateSnapshots(
    citySnapshots,
    goods,
    (city) => city.regionId,
    (city) => ({
      id: city.regionId,
      name: city.regionName,
      state: city.state,
      regionId: city.regionId
    })
  );
  const tradeRouteIndex = buildTradeRouteIndex(citySnapshots);

  return {
    goods,
    regions,
    materials,
    gear,
    cities: citySnapshots,
    cityById,
    regionById,
    materialById,
    materialByGoodId,
    gearById: new Map(gear.map((item) => [item.id, item])),
    tradeRoutes: tradeRouteIndex.tradeRoutes,
    tradeRouteById: tradeRouteIndex.tradeRouteById,
    effectiveStatePolicies: foundry.utils.deepClone(effectiveStatePolicies),
    stateSummaries,
    regionSummaries,
    overview: buildOverview(citySnapshots, goods),
    statePolicies: foundry.utils.deepClone(statePolicies ?? {}),
    globalEvents: {
      enabled: globalEventModifiers?.enabled === true,
      activeEvents: foundry.utils.deepClone(globalEventModifiers?.activeEvents ?? []),
      cityEventsByCityId: foundry.utils.deepClone(globalEventModifiers?.cityEventsByCityId ?? {}),
      routeEffectsByConnectionId: foundry.utils.deepClone(globalEventModifiers?.routeEffectsByConnectionId ?? {}),
      stateEffectsByStateId: foundry.utils.deepClone(globalEventModifiers?.stateEffectsByStateId ?? {})
    },
    reference,
    source: dataset.source ?? {}
  };
}

export function buildDetailedCitySnapshot(model, cityId, routeResult = null) {
  const city = model?.cityById?.get(cityId);
  if (!city) {
    return null;
  }

  const routePlan = routeResult ?? buildReachableImportRoutesForCity(
    cityId,
    model.cityById,
    model.reference ?? {},
    { statePolicyMap: model.effectiveStatePolicies ?? {} }
  );
  const importPriceAnalysis = buildImportPriceAnalysis(city, model.cityById, routePlan.routes);

  return {
    ...city,
    goodsRows: importPriceAnalysis.goodsRows,
    goodsRowById: indexGoodsRows(importPriceAnalysis.goodsRows),
    goodsWithImports: importPriceAnalysis.goodsWithImports,
    importRouteStats: {
      exploredStates: routePlan.exploredStates,
      truncated: routePlan.truncated
    }
  };
}

export function buildDetailedTradeRouteSnapshot(model, connectionId, detailedCitySnapshots = null) {
  const route = model?.tradeRouteById?.get(connectionId);
  if (!route) {
    return null;
  }

  const detailedCities = Array.isArray(detailedCitySnapshots)
    ? detailedCitySnapshots.filter(Boolean)
    : Array.from(model?.cities ?? []);
  const usageRows = [];
  const usageByGood = new Map();
  const usageByCity = new Map();

  for (const city of detailedCities) {
    for (const row of city.goodsRows ?? []) {
      for (const importSource of row.importSources ?? []) {
        const matchedLeg = (importSource.legs ?? []).find((leg) => leg.connectionId === connectionId);
        if (!matchedLeg) {
          continue;
        }

        const usageRow = {
          destinationCityId: city.id,
          destinationCityName: city.name,
          destinationState: city.state,
          destinationRegionName: city.regionName,
          goodId: row.goodId,
          goodName: row.goodName,
          quantity: importSource.quantity,
          sourceCityId: importSource.sourceCityId,
          sourceCityName: importSource.sourceCityName,
          pathLabel: importSource.pathLabel,
          routeMarkupPercent: importSource.markupPercent,
          legMarkupPercent: toNumber(matchedLeg.stepMarkupPercent) + toNumber(matchedLeg.additionalPricePercent) + toNumber(matchedLeg.interstateDutyPercent, 0),
          legAdditionalPricePercent: toNumber(matchedLeg.additionalPricePercent),
          legInterstateDutyPercent: toNumber(matchedLeg.interstateDutyPercent, 0),
          legRouteCapacityPercent: toNumber(matchedLeg.routeCapacityPercent, 0),
          stepCount: importSource.stepCount
        };
        usageRows.push(usageRow);

        const goodUsage = usageByGood.get(row.goodId) ?? {
          goodId: row.goodId,
          goodName: row.goodName,
          totalQuantity: 0,
          destinationCount: 0,
          destinations: new Set()
        };
        goodUsage.totalQuantity += importSource.quantity;
        goodUsage.destinations.add(city.id);
        goodUsage.destinationCount = goodUsage.destinations.size;
        usageByGood.set(row.goodId, goodUsage);

        const cityUsage = usageByCity.get(city.id) ?? {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          regionName: city.regionName,
          totalQuantity: 0,
          goodsCount: 0,
          goods: new Set()
        };
        cityUsage.totalQuantity += importSource.quantity;
        cityUsage.goods.add(row.goodId);
        cityUsage.goodsCount = cityUsage.goods.size;
        usageByCity.set(city.id, cityUsage);
      }
    }
  }

  const globalUsageRows = usageRows
    .sort((left, right) => right.quantity - left.quantity || left.destinationCityName.localeCompare(right.destinationCityName, "ru"));
  const goodsUsage = Array.from(usageByGood.values())
    .map((row) => ({
      ...row,
      destinations: undefined
    }))
    .sort((left, right) => right.totalQuantity - left.totalQuantity || left.goodName.localeCompare(right.goodName, "ru"));
  const destinationUsage = Array.from(usageByCity.values())
    .map((row) => ({
      ...row,
      goods: undefined
    }))
    .sort((left, right) => right.totalQuantity - left.totalQuantity || left.cityName.localeCompare(right.cityName, "ru"));

  return {
    ...route,
    globalUsageRows,
    goodsUsage,
    destinationUsage,
    isBypassed: globalUsageRows.length === 0,
    totalUsageQuantity: globalUsageRows.reduce((sum, row) => sum + row.quantity, 0),
    totalDestinationCount: destinationUsage.length,
    totalGoodsCount: goodsUsage.length
  };
}
