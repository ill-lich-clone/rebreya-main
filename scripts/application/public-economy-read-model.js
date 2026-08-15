import { applyMarketPrice, getMaterialPriceModifier } from "../engine/trader-engine.js";

function clean(value) {
  return String(value ?? "").trim();
}

function compareLabels(left, right) {
  return clean(left).localeCompare(clean(right), "ru");
}

function publicTraderSummary(trader) {
  return {
    traderKey: clean(trader?.traderKey),
    name: clean(trader?.name),
    image: clean(trader?.portrait ?? trader?.image),
    description: clean(trader?.merchantRole ?? trader?.roleLabel ?? trader?.description),
    availabilityLabel: clean(trader?.statusLabel ?? trader?.availabilityLabel)
  };
}

function publicCityIdentity(city, presentation = {}) {
  return {
    id: clean(city?.id),
    name: clean(city?.name),
    state: clean(city?.state),
    regionId: clean(city?.regionId),
    regionName: clean(city?.regionName),
    cityType: clean(city?.cityType),
    type: clean(city?.type),
    description: clean(presentation?.description ?? city?.description),
    image: clean(presentation?.image ?? city?.image)
  };
}

export function buildPublicCitySnapshot({
  model,
  city,
  presentation = {},
  traders = [],
  tradersError = ""
} = {}) {
  if (!city) return null;
  return {
    ...publicCityIdentity(city, presentation),
    materialRows: (model?.materials ?? [])
      .filter((material) => Boolean(clean(material?.linkedGoodId)))
      .map((material) => {
        const modifier = getMaterialPriceModifier(model, city, material);
        const pricing = applyMarketPrice(material.priceGold, modifier, material.weight);
        return {
          materialId: material.id,
          name: material.name,
          finalPriceGold: pricing.finalPriceGold,
          finalWeight: pricing.finalWeight
        };
      }),
    traders: (traders ?? []).map(publicTraderSummary),
    tradersError: clean(tradersError)
  };
}

export function buildPublicEconomySnapshot(model, cityPresentations = {}) {
  const deficitByGoodId = new Map(
    (model?.overview?.deficitGoods ?? []).map((row) => [clean(row?.goodId), Math.max(0, Number(row?.deficit) || 0)])
  );
  return {
    cities: (model?.cities ?? []).map((city) => publicCityIdentity(city, cityPresentations?.[city.id])),
    materialRows: (model?.materials ?? []).map((material) => {
      const linkedGoodId = clean(material?.linkedGoodId);
      return {
        materialId: material.id,
        name: material.name,
        basePriceGold: material.priceGold,
        baseWeight: material.weight,
        worldDeficit: linkedGoodId ? (deficitByGoodId.get(linkedGoodId) ?? 0) : null,
        hasWorldDeficit: Boolean(linkedGoodId)
      };
    })
  };
}

export function selectPublicCityRows(cities, filters = {}) {
  const search = clean(filters?.search).toLocaleLowerCase("ru");
  const state = clean(filters?.state || "all");
  const regionId = clean(filters?.regionId || "all");
  const cityType = clean(filters?.cityType || "all");
  return (cities ?? [])
    .filter((city) => !search || clean(city?.name).toLocaleLowerCase("ru").includes(search))
    .filter((city) => state === "all" || city?.state === state)
    .filter((city) => regionId === "all" || city?.regionId === regionId)
    .filter((city) => cityType === "all" || city?.cityType === cityType)
    .toSorted((left, right) => compareLabels(left?.name, right?.name));
}

export function buildPublicFilterOptions(cities, selectedState = "all") {
  const rows = cities ?? [];
  const stateOptions = [...new Set(rows.map((city) => clean(city?.state)).filter(Boolean))]
    .toSorted(compareLabels)
    .map((value) => ({ value, label: value }));
  const regionById = new Map();
  for (const city of rows) {
    if (selectedState !== "all" && city?.state !== selectedState) continue;
    const value = clean(city?.regionId);
    if (!value || regionById.has(value)) continue;
    regionById.set(value, `${clean(city?.regionName)} (${clean(city?.state)})`);
  }
  const regionOptions = [...regionById.entries()]
    .map(([value, label]) => ({ value, label }))
    .toSorted((left, right) => compareLabels(left.label, right.label));
  const cityTypeOptions = [...new Set(rows.map((city) => clean(city?.cityType)).filter(Boolean))]
    .toSorted(compareLabels)
    .map((value) => ({ value, label: value }));
  return { stateOptions, regionOptions, cityTypeOptions };
}
