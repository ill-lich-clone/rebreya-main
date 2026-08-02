import { CHEST_OBJECT_DURABILITY } from "./native-object-durability-service.js";

const ASSET_ROOT = "modules/rebreya-main/assets/storage/chests";
const CLOSED_TEXTURE = `${ASSET_ROOT}/wood-dark-closed.webp`;
const EMPTY_TEXTURE = `${ASSET_ROOT}/wood-dark-empty.webp`;
export const BUILTIN_STORAGE_TOKEN_NAME = "Сундук";
export const GROUND_PILE_PRESET_ID = "ground-pile";

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
      texture: { src: textures.unopened },
      objectDurability: JSON.parse(JSON.stringify(CHEST_OBJECT_DURABILITY)),
      delta: {
        system: {
          attributes: {
            hp: { value: 18, max: 18, dt: 0 },
            ac: { calc: "flat", flat: 15 }
          }
        }
      },
      bar1: { attribute: "attributes.hp" }
    }
  });
}

export const BUILTIN_STORAGE_PRESETS = Object.freeze([
  createPreset("wood-dark-copper", "Сундук — медные монеты", "wood-dark-copper-open.webp"),
  createPreset("wood-dark-silver", "Сундук — серебряные монеты", "wood-dark-silver-open.webp"),
  createPreset("wood-dark-gold", "Сундук — золотые монеты", "wood-dark-gold-open.webp")
]);

const GROUND_PILE_TEXTURE = "modules/rebreya-main/assets/storage/piles/mixed-items.png";
export const GROUND_PILE_STORAGE_PRESET = deepFreeze({
  id: GROUND_PILE_PRESET_ID,
  name: "Куча предметов",
  groundPile: true,
  textures: {
    unopened: GROUND_PILE_TEXTURE,
    opened: GROUND_PILE_TEXTURE,
    empty: GROUND_PILE_TEXTURE
  },
  prototypeToken: {
    name: "Куча предметов",
    actorLink: false,
    texture: { src: GROUND_PILE_TEXTURE }
  }
});
