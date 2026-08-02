const ASSET_ROOT = "modules/rebreya-main/assets/storage/chests";
const CLOSED_TEXTURE = `${ASSET_ROOT}/wood-dark-closed.webp`;
const EMPTY_TEXTURE = `${ASSET_ROOT}/wood-dark-empty.webp`;
export const BUILTIN_STORAGE_TOKEN_NAME = "Сундук";

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      deepFreeze(child);
    }
  }
  return Object.freeze(value);
}

function createPreset(id, name, openedFile) {
  const textures = {
    unopened: CLOSED_TEXTURE,
    opened: `${ASSET_ROOT}/${openedFile}`,
    empty: EMPTY_TEXTURE
  };
  return deepFreeze({
    id,
    name,
    textures,
    prototypeToken: {
      name: BUILTIN_STORAGE_TOKEN_NAME,
      actorLink: false,
      texture: { src: textures.unopened }
    }
  });
}

export const BUILTIN_STORAGE_PRESETS = Object.freeze([
  createPreset("wood-dark-copper", "Сундук — медные монеты", "wood-dark-copper-open.webp"),
  createPreset("wood-dark-silver", "Сундук — серебряные монеты", "wood-dark-silver-open.webp"),
  createPreset("wood-dark-gold", "Сундук — золотые монеты", "wood-dark-gold-open.webp")
]);
