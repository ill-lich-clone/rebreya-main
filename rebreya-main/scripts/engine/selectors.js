import { DEFAULT_CITY_SORT } from "../constants.js";

function matchesSearch(city, search) {
  if (!search) {
    return true;
  }

  const haystack = [city.name, city.state, city.regionName, city.cityType, city.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function sortCities(cities, sortKey = DEFAULT_CITY_SORT) {
  const sorted = [...cities];
  switch (sortKey) {
    case "deficit":
      return sorted.sort((left, right) => right.totalDeficit - left.totalDeficit || left.name.localeCompare(right.name, "ru"));
    case "surplus":
      return sorted.sort((left, right) => right.totalSurplus - left.totalSurplus || left.name.localeCompare(right.name, "ru"));
    case "selfSufficiency":
      return sorted.sort((left, right) => right.selfSufficiencyRate - left.selfSufficiencyRate || left.name.localeCompare(right.name, "ru"));
    case "name":
      return sorted.sort((left, right) => left.name.localeCompare(right.name, "ru"));
    case "population":
    default:
      return sorted.sort((left, right) => right.population - left.population || left.name.localeCompare(right.name, "ru"));
  }
}

export function selectCityList(model, filters = {}) {
  const {
    search = "",
    state = "all",
    regionId = "all",
    cityType = "all",
    sort = DEFAULT_CITY_SORT
  } = filters;

  const filteredCities = model.cities.filter((city) => {
    if (state !== "all" && city.state !== state) {
      return false;
    }

    if (regionId !== "all" && city.regionId !== regionId) {
      return false;
    }

    if (cityType !== "all" && city.cityType !== cityType) {
      return false;
    }

    return matchesSearch(city, search);
  });

  return sortCities(filteredCities, sort);
}

export function selectStateOptions(model) {
  return [...new Set(model.cities.map((city) => city.state).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((state) => ({ value: state, label: state }));
}

export function selectRegionOptions(model, state = "all") {
  return model.regionSummaries
    .filter((region) => state === "all" || region.state === state)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"))
    .map((region) => ({ value: region.id, label: `${region.name} (${region.state})` }));
}

export function selectCityTypeOptions(model) {
  return [...new Set(model.cities.map((city) => city.cityType).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((cityType) => ({ value: cityType, label: cityType }));
}

export function selectRegionOverview(model) {
  return [...model.regionSummaries].sort((left, right) => right.totalDeficit - left.totalDeficit || left.name.localeCompare(right.name, "ru"));
}

export function selectStateOverview(model) {
  return [...model.stateSummaries].sort((left, right) => right.totalDeficit - left.totalDeficit || left.name.localeCompare(right.name, "ru"));
}
