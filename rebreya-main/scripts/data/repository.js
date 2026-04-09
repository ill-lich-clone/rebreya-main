import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { buildDetailedCitySnapshot, buildEconomyModel, buildReachableImportRoutesForCity } from "../engine/economy-engine.js";
import { loadEconomyDataset } from "./importer.js";

function buildReferenceNoteKey(entryType, entryId) {
  return `${entryType}::${entryId}`;
}

function toNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function finalizeTradeRouteSnapshot(route, usage) {
  const globalUsageRows = (usage?.rows ?? [])
    .sort((left, right) => right.quantity - left.quantity || left.destinationCityName.localeCompare(right.destinationCityName, "ru"));
  const goodsUsage = Array.from(usage ? usage.goods.values() : [])
    .map((row) => ({
      ...row,
      destinations: undefined
    }))
    .sort((left, right) => right.totalQuantity - left.totalQuantity || left.goodName.localeCompare(right.goodName, "ru"));
  const destinationUsage = Array.from(usage ? usage.destinations.values() : [])
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

function buildTradeRouteSnapshotCache(model, citySnapshots) {
  const usageByConnectionId = new Map();

  for (const city of citySnapshots) {
    for (const row of city.goodsRows ?? []) {
      for (const importSource of row.importSources ?? []) {
        for (const leg of importSource.legs ?? []) {
          const usage = usageByConnectionId.get(leg.connectionId) ?? {
            rows: [],
            goods: new Map(),
            destinations: new Map()
          };

          usage.rows.push({
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
            legMarkupPercent: toNumber(leg.stepMarkupPercent) + toNumber(leg.additionalPricePercent) + toNumber(leg.interstateDutyPercent, 0),
            legAdditionalPricePercent: toNumber(leg.additionalPricePercent),
            legInterstateDutyPercent: toNumber(leg.interstateDutyPercent, 0),
            legRouteCapacityPercent: toNumber(leg.routeCapacityPercent, 0),
            stepCount: importSource.stepCount
          });

          const goodUsage = usage.goods.get(row.goodId) ?? {
            goodId: row.goodId,
            goodName: row.goodName,
            totalQuantity: 0,
            destinationCount: 0,
            destinations: new Set()
          };
          goodUsage.totalQuantity += importSource.quantity;
          goodUsage.destinations.add(city.id);
          goodUsage.destinationCount = goodUsage.destinations.size;
          usage.goods.set(row.goodId, goodUsage);

          const destinationUsage = usage.destinations.get(city.id) ?? {
            cityId: city.id,
            cityName: city.name,
            state: city.state,
            regionName: city.regionName,
            totalQuantity: 0,
            goodsCount: 0,
            goods: new Set()
          };
          destinationUsage.totalQuantity += importSource.quantity;
          destinationUsage.goods.add(row.goodId);
          destinationUsage.goodsCount = destinationUsage.goods.size;
          usage.destinations.set(city.id, destinationUsage);

          usageByConnectionId.set(leg.connectionId, usage);
        }
      }
    }
  }

  return new Map(
    (model?.tradeRoutes ?? []).map((route) => [
      route.connectionId,
      finalizeTradeRouteSnapshot(route, usageByConnectionId.get(route.connectionId))
    ])
  );
}

export class EconomyRepository {
  #dataset = null;
  #model = null;
  #modelRevision = 0;
  #routePlanCache = new Map();
  #citySnapshotCache = new Map();
  #tradeRouteSnapshotCache = new Map();
  #tradeRouteWarmupPromise = null;
  #globalEventsService = null;

  #getObjectSetting(key) {
    const value = game.settings.get(MODULE_ID, key);
    return value && typeof value === "object" ? foundry.utils.deepClone(value) : {};
  }

  #buildModel() {
    const connectionStates = this.getConnectionStates();
    const tradeRouteOverrides = this.getTradeRouteOverrides();
    const statePolicies = this.getStatePolicies();
    const baseModelForEvents = buildEconomyModel(this.#dataset, {
      connectionStates,
      tradeRouteOverrides,
      statePolicies,
      globalEventModifiers: null
    });
    const globalEventModifiers = this.#globalEventsService?.collectEconomicModifiers?.({
      dataset: baseModelForEvents
    }) ?? null;

    this.#model = buildEconomyModel(this.#dataset, {
      connectionStates,
      tradeRouteOverrides,
      statePolicies,
      globalEventModifiers
    });
    this.#modelRevision += 1;
    this.#routePlanCache = new Map();
    this.#citySnapshotCache = new Map();
    this.#tradeRouteSnapshotCache = new Map();
    this.#tradeRouteWarmupPromise = null;
    return this.#model;
  }

  #getRoutePlan(cityId) {
    if (!this.#model?.cityById?.has(cityId)) {
      return null;
    }

    if (!this.#routePlanCache.has(cityId)) {
      this.#routePlanCache.set(
        cityId,
        buildReachableImportRoutesForCity(
          cityId,
          this.#model.cityById,
          this.#model.reference ?? {},
          { statePolicyMap: this.#model.effectiveStatePolicies ?? {} }
        )
      );
    }

    return this.#routePlanCache.get(cityId) ?? null;
  }

  #ensureTradeRouteSnapshots() {
    if (this.#tradeRouteSnapshotCache.size || !this.#model) {
      return;
    }

    const citySnapshots = (this.#model.cities ?? [])
      .map((city) => this.getCitySnapshot(city.id))
      .filter(Boolean);

    this.#tradeRouteSnapshotCache = buildTradeRouteSnapshotCache(this.#model, citySnapshots);
  }

  async prepareTradeRouteAnalytics({ batchSize = 6 } = {}) {
    if (!this.#model) {
      return new Map();
    }

    if (this.#tradeRouteSnapshotCache.size) {
      return this.#tradeRouteSnapshotCache;
    }

    if (this.#tradeRouteWarmupPromise) {
      return this.#tradeRouteWarmupPromise;
    }

    const revision = this.#modelRevision;
    this.#tradeRouteWarmupPromise = (async () => {
      const citySnapshots = [];
      const cities = this.#model?.cities ?? [];

      for (let index = 0; index < cities.length; index += 1) {
        if (revision !== this.#modelRevision) {
          return new Map();
        }

        citySnapshots.push(this.getCitySnapshot(cities[index].id));

        if ((index + 1) % Math.max(1, batchSize) === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }

      if (revision !== this.#modelRevision) {
        return new Map();
      }

      this.#tradeRouteSnapshotCache = buildTradeRouteSnapshotCache(this.#model, citySnapshots.filter(Boolean));
      return this.#tradeRouteSnapshotCache;
    })();

    try {
      return await this.#tradeRouteWarmupPromise;
    }
    finally {
      this.#tradeRouteWarmupPromise = null;
    }
  }

  async load({ force = false } = {}) {
    if (this.#model && !force) {
      return this.#model;
    }

    this.#dataset = await loadEconomyDataset();
    return this.#buildModel();
  }

  async reload() {
    return this.load({ force: true });
  }

  setGlobalEventsService(service) {
    this.#globalEventsService = service ?? null;
    if (this.#dataset) {
      this.#buildModel();
    }
  }

  async rebuildModel() {
    if (!this.#dataset) {
      return this.load();
    }

    return this.#buildModel();
  }

  get dataset() {
    return this.#dataset;
  }

  get model() {
    return this.#model;
  }

  getConnectionStates() {
    return this.#getObjectSetting(SETTINGS_KEYS.CONNECTION_STATES);
  }

  getReferenceNotes() {
    return this.#getObjectSetting(SETTINGS_KEYS.REFERENCE_NOTES);
  }

  getTradeRouteOverrides() {
    return this.#getObjectSetting(SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES);
  }

  getStatePolicies() {
    return this.#getObjectSetting(SETTINGS_KEYS.STATE_POLICIES);
  }

  getStatePolicy(stateId) {
    return foundry.utils.deepClone(this.getStatePolicies()?.[stateId] ?? {
      taxPercent: 0,
      generalDutyPercent: 0,
      bilateralDuties: {}
    });
  }

  async setConnectionActive(connectionId, isActive) {
    const nextStates = this.getConnectionStates();
    if (isActive) {
      delete nextStates[connectionId];
    }
    else {
      nextStates[connectionId] = false;
    }

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.CONNECTION_STATES, nextStates);
    if (this.#dataset) {
      this.#buildModel();
    }

    return this.#model;
  }

  async setReferenceNote(noteKey, description) {
    const nextNotes = this.getReferenceNotes();
    const nextDescription = String(description ?? "").trim();

    if (nextDescription) {
      nextNotes[noteKey] = {
        description: nextDescription
      };
    }
    else {
      delete nextNotes[noteKey];
    }

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.REFERENCE_NOTES, nextNotes);
    return nextNotes[noteKey] ?? null;
  }

  async setTradeRouteOverride(connectionId, patch = {}) {
    const nextOverrides = this.getTradeRouteOverrides();
    const currentOverride = nextOverrides[connectionId] ?? {};
    const nextDescription = String(patch.description ?? currentOverride.description ?? "").trim();
    const rawPrice = patch.additionalPricePercent ?? currentOverride.additionalPricePercent ?? 0;
    const nextAdditionalPricePercent = Number.isFinite(Number(rawPrice)) ? Number(rawPrice) : 0;

    if (!nextDescription && Math.abs(nextAdditionalPricePercent) < 1e-9) {
      delete nextOverrides[connectionId];
    }
    else {
      nextOverrides[connectionId] = {
        description: nextDescription,
        additionalPricePercent: nextAdditionalPricePercent
      };
    }

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES, nextOverrides);
    if (this.#dataset) {
      this.#buildModel();
    }

    return this.getTradeRoute(connectionId);
  }

  async setStatePolicy(stateId, patch = {}) {
    const nextPolicies = this.getStatePolicies();
    const currentPolicy = nextPolicies[stateId] ?? {};
    const nextPolicy = {
      taxPercent: toNumber(patch.taxPercent ?? currentPolicy.taxPercent),
      generalDutyPercent: toNumber(patch.generalDutyPercent ?? currentPolicy.generalDutyPercent),
      bilateralDuties: {}
    };

    const sourceDuties = patch.bilateralDuties ?? currentPolicy.bilateralDuties ?? {};
    for (const [targetStateId, value] of Object.entries(sourceDuties)) {
      const safeTargetStateId = String(targetStateId ?? "").trim();
      if (!safeTargetStateId) {
        continue;
      }

      const numericValue = toNumber(value);
      if (!Number.isFinite(numericValue)) {
        continue;
      }

      nextPolicy.bilateralDuties[safeTargetStateId] = numericValue;
    }

    if (
      Math.abs(nextPolicy.taxPercent) < 1e-9
      && Math.abs(nextPolicy.generalDutyPercent) < 1e-9
      && !Object.keys(nextPolicy.bilateralDuties).length
    ) {
      delete nextPolicies[stateId];
    }
    else {
      nextPolicies[stateId] = nextPolicy;
    }

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.STATE_POLICIES, nextPolicies);
    if (this.#dataset) {
      this.#buildModel();
    }

    return this.getStatePolicy(stateId);
  }

  async resetWorldData() {
    await Promise.all([
      game.settings.set(MODULE_ID, SETTINGS_KEYS.CONNECTION_STATES, {}),
      game.settings.set(MODULE_ID, SETTINGS_KEYS.REFERENCE_NOTES, {}),
      game.settings.set(MODULE_ID, SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES, {}),
      game.settings.set(MODULE_ID, SETTINGS_KEYS.STATE_POLICIES, {})
    ]);

    if (this.#dataset) {
      this.#buildModel();
    }

    return this.#model;
  }

  getCitySnapshot(cityId) {
    if (!this.#model?.cityById?.has(cityId)) {
      return null;
    }

    if (!this.#citySnapshotCache.has(cityId)) {
      const routePlan = this.#getRoutePlan(cityId);
      this.#citySnapshotCache.set(cityId, buildDetailedCitySnapshot(this.#model, cityId, routePlan));
    }

    return this.#citySnapshotCache.get(cityId) ?? null;
  }

  getRegion(regionId) {
    return this.#model?.regionById?.get(regionId) ?? null;
  }

  getMaterialByGoodId(goodId) {
    return this.#model?.materialByGoodId?.get(goodId) ?? null;
  }

  getTradeRoute(connectionId) {
    if (!this.#model?.tradeRouteById?.has(connectionId)) {
      return null;
    }

    return this.#tradeRouteSnapshotCache.get(connectionId) ?? null;
  }

  getTradeRouteBase(connectionId) {
    return this.#model?.tradeRouteById?.get(connectionId) ?? null;
  }

  getTradeRoutes() {
    return (this.#model?.tradeRoutes ?? []).map((route) => this.#tradeRouteSnapshotCache.get(route.connectionId) ?? {
      ...route,
      globalUsageRows: [],
      goodsUsage: [],
      destinationUsage: [],
      isBypassed: true,
      totalUsageQuantity: 0,
      totalDestinationCount: 0,
      totalGoodsCount: 0
    });
  }

  hasTradeRouteAnalytics() {
    return this.#tradeRouteSnapshotCache.size > 0;
  }

  getReferenceDescription(entryType, entryId) {
    const notes = this.getReferenceNotes();
    return String(notes[buildReferenceNoteKey(entryType, entryId)]?.description ?? "");
  }

  getReferenceEntry(entryType, entryId) {
    if (!this.#model) {
      return null;
    }

    if (entryType === "state") {
      const state = this.#model.stateSummaries.find((summary) => summary.id === entryId);
      if (!state) {
        return null;
      }

      return {
        entryType,
        entryId,
        id: state.id,
        name: state.name,
        subtitle: "Государство",
        description: this.getReferenceDescription(entryType, entryId),
        facts: [
          { label: "Городов", value: state.cityCount },
          { label: "Население", value: state.population },
          { label: "Производство", value: state.totalProduction },
          { label: "Спрос", value: state.totalDemand },
          { label: "Дефицит", value: state.totalDeficit },
          { label: "Самообеспечение", value: state.selfSufficiencyRate, format: "percent" }
        ]
      };
    }

    if (entryType === "region") {
      const regionSummary = this.#model.regionSummaries.find((summary) => summary.id === entryId);
      const region = this.#model.regionById.get(entryId) ?? null;
      if (!regionSummary && !region) {
        return null;
      }

      return {
        entryType,
        entryId,
        id: regionSummary?.id ?? region.id,
        name: regionSummary?.name ?? region.name,
        subtitle: regionSummary?.state ?? region.state,
        description: this.getReferenceDescription(entryType, entryId),
        facts: [
          { label: "Государство", value: regionSummary?.state ?? region.state ?? "" },
          { label: "Городов", value: regionSummary?.cityCount ?? 0 },
          { label: "Население", value: regionSummary?.population ?? 0 },
          { label: "Производство", value: regionSummary?.totalProduction ?? 0 },
          { label: "Спрос", value: regionSummary?.totalDemand ?? 0 },
          { label: "Самообеспечение", value: regionSummary?.selfSufficiencyRate ?? 1, format: "percent" }
        ]
      };
    }

    if (entryType === "transportMode") {
      const mode = (this.#model.reference?.transportModes ?? []).find((transportMode) => transportMode.id === entryId);
      if (!mode) {
        return null;
      }

      return {
        entryType,
        entryId,
        id: mode.id,
        name: mode.name,
        subtitle: "Режим перемещения",
        description: this.getReferenceDescription(entryType, entryId),
        facts: [
          { label: "Стоимость шага", value: mode.movementCost, format: "percent" },
          { label: "Макс. шагов", value: mode.maxSteps },
          { label: "Макс. наценка", value: mode.markupPercent, format: "percent" }
        ]
      };
    }

    return null;
  }
}
