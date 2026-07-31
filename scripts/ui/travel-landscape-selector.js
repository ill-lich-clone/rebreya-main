const DEFAULT_TRAVEL_LANDSCAPE_ID = "industrial";

export const TRAVEL_LANDSCAPES = Object.freeze([
  Object.freeze({
    id: "industrial",
    number: 1,
    label: "Промышленная долина",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-industrial.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-industrial-poster.webp"
  }),
  Object.freeze({
    id: "wilderness",
    number: 2,
    label: "Дикая природа",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-wilderness.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-wilderness-poster.webp"
  }),
  Object.freeze({
    id: "city",
    number: 3,
    label: "Окраины города",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-city.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-city-poster.webp"
  })
]);

function trimOrFallback(value, fallback) {
  const trimmedValue = typeof value === "string" ? value.trim() : "";
  return trimmedValue || fallback;
}

function escapeStorageKeyComponent(value) {
  return value.replaceAll("%", "%25").replaceAll(":", "%3A");
}

function getDefaultScope() {
  const game = globalThis.game;
  return {
    worldId: game?.world?.id,
    userId: game?.user?.id
  };
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;

  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeTravelLandscapeId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return TRAVEL_LANDSCAPES.some((landscape) => landscape.id === id)
    ? id
    : DEFAULT_TRAVEL_LANDSCAPE_ID;
}

export function createTravelLandscapeStorageKey({ worldId, userId } = {}) {
  const defaults = getDefaultScope();
  const normalizedWorldId = escapeStorageKeyComponent(
    trimOrFallback(worldId ?? defaults.worldId, "unknown-world")
  );
  const normalizedUserId = escapeStorageKeyComponent(
    trimOrFallback(userId ?? defaults.userId, "anonymous")
  );
  return `rebreya-main.travelLandscape:${normalizedWorldId}:${normalizedUserId}`;
}

export function loadTravelLandscapeId(options = {}) {
  const storage = resolveStorage(options.storage);
  if (!storage) return DEFAULT_TRAVEL_LANDSCAPE_ID;

  try {
    return normalizeTravelLandscapeId(storage.getItem(createTravelLandscapeStorageKey(options)));
  } catch {
    return DEFAULT_TRAVEL_LANDSCAPE_ID;
  }
}

export function saveTravelLandscapeId(value, options = {}) {
  const id = normalizeTravelLandscapeId(value);
  const storage = resolveStorage(options.storage);
  if (!storage) return id;

  try {
    storage.setItem(createTravelLandscapeStorageKey(options), id);
  } catch {
    // Local persistence is optional; retain the normalized in-memory selection.
  }
  return id;
}

export function prepareTravelLandscapeContext(value) {
  const selectedId = normalizeTravelLandscapeId(value);
  const options = TRAVEL_LANDSCAPES.map((landscape) => {
    const selected = landscape.id === selectedId;
    return {
      ...landscape,
      selected,
      ariaPressed: String(selected)
    };
  });

  return {
    active: options.find((landscape) => landscape.selected),
    options
  };
}
