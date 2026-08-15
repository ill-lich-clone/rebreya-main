const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_IMAGE_PATH_LENGTH = 1024;

function clean(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

export function normalizeCityPresentationOverrides(raw, knownCityIds = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const [cityId, value] of Object.entries(source)) {
    if (knownCityIds && !knownCityIds.has(cityId)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const description = clean(value.description, MAX_DESCRIPTION_LENGTH);
    const image = clean(value.image, MAX_IMAGE_PATH_LENGTH);
    const entry = {};
    if (description) entry.description = description;
    if (image) entry.image = image;
    if (Object.keys(entry).length) result[cityId] = entry;
  }
  return result;
}

export function patchCityPresentationOverrides(raw, cityId, patch = {}, knownCityIds = null) {
  const cleanCityId = String(cityId ?? "").trim();
  if (!cleanCityId || (knownCityIds && !knownCityIds.has(cleanCityId))) {
    throw new Error(`Unknown city '${cleanCityId}'`);
  }
  const next = normalizeCityPresentationOverrides(raw, knownCityIds);
  const entry = { ...(next[cleanCityId] ?? {}) };
  for (const [field, limit] of [["description", MAX_DESCRIPTION_LENGTH], ["image", MAX_IMAGE_PATH_LENGTH]]) {
    if (!Object.hasOwn(patch, field)) continue;
    const value = patch[field] === null ? "" : clean(patch[field], limit);
    if (value) entry[field] = value;
    else delete entry[field];
  }
  if (Object.keys(entry).length) next[cleanCityId] = entry;
  else delete next[cleanCityId];
  return next;
}

export function mergeCityPresentation(city, overrides = {}) {
  const baseDescription = clean(city?.description, MAX_DESCRIPTION_LENGTH);
  const baseImage = clean(city?.image, MAX_IMAGE_PATH_LENGTH);
  const entry = normalizeCityPresentationOverrides(overrides)?.[city?.id] ?? {};
  return {
    cityId: city.id,
    baseDescription,
    baseImage,
    description: entry.description || baseDescription,
    image: entry.image || baseImage,
    descriptionOverridden: Boolean(entry.description),
    imageOverridden: Boolean(entry.image)
  };
}
