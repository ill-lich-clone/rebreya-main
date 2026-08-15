import { CHEST_OBJECT_DURABILITY } from "./native-object-durability-service.js";

const CHEST_ASSET_ROOT = "modules/rebreya-main/assets/storage/chests";
const FURNITURE_ASSET_ROOT = "modules/rebreya-main/assets/storage/furniture";
const CLOSED_TEXTURE = `${CHEST_ASSET_ROOT}/wood-dark-closed.webp`;
const EMPTY_TEXTURE = `${CHEST_ASSET_ROOT}/wood-dark-empty.webp`;
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

function createPreset(id, name, textures, tokenName = name) {
  return deepFreeze({
    id,
    name,
    textures,
    prototypeToken: {
      name: tokenName,
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
  createPreset("wood-dark-copper", "Сундук — медные монеты", {
    unopened: CLOSED_TEXTURE,
    opened: `${CHEST_ASSET_ROOT}/wood-dark-copper-open.webp`,
    empty: EMPTY_TEXTURE
  }, BUILTIN_STORAGE_TOKEN_NAME),
  createPreset("wood-dark-silver", "Сундук — серебряные монеты", {
    unopened: CLOSED_TEXTURE,
    opened: `${CHEST_ASSET_ROOT}/wood-dark-silver-open.webp`,
    empty: EMPTY_TEXTURE
  }, BUILTIN_STORAGE_TOKEN_NAME),
  createPreset("wood-dark-gold", "Сундук — золотые монеты", {
    unopened: CLOSED_TEXTURE,
    opened: `${CHEST_ASSET_ROOT}/wood-dark-gold-open.webp`,
    empty: EMPTY_TEXTURE
  }, BUILTIN_STORAGE_TOKEN_NAME),
  createPreset("barrel", "Бочка", {
    unopened: `${FURNITURE_ASSET_ROOT}/barrel-closed.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/barrel-open.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/barrel-empty.webp`
  }),
  createPreset("wicker-basket", "Плетёная корзина", {
    unopened: `${FURNITURE_ASSET_ROOT}/wicker-basket-closed.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/wicker-basket-open.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/wicker-basket-empty.webp`
  }),
  createPreset("provision-sack", "Мешок припасов", {
    unopened: `${FURNITURE_ASSET_ROOT}/provision-sack-closed.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/provision-sack-open.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/provision-sack-empty.webp`
  }),
  createPreset("ceramic-storage-jar", "Керамический сосуд", {
    unopened: `${FURNITURE_ASSET_ROOT}/ceramic-storage-jar-closed.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/ceramic-storage-jar-open.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/ceramic-storage-jar-empty.webp`
  }),
  createPreset("wardrobe", "Платяной шкаф", {
    unopened: `${FURNITURE_ASSET_ROOT}/wardrobe.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/wardrobe.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/wardrobe.webp`
  }),
  createPreset("kitchen-hutch", "Кухонный буфет", {
    unopened: `${FURNITURE_ASSET_ROOT}/kitchen-hutch.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/kitchen-hutch.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/kitchen-hutch.webp`
  }),
  createPreset("dresser", "Комод", {
    unopened: `${FURNITURE_ASSET_ROOT}/dresser.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/dresser.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/dresser.webp`
  }),
  createPreset("bedside-cabinet", "Прикроватная тумба", {
    unopened: `${FURNITURE_ASSET_ROOT}/bedside-cabinet.webp`,
    opened: `${FURNITURE_ASSET_ROOT}/bedside-cabinet.webp`,
    empty: `${FURNITURE_ASSET_ROOT}/bedside-cabinet.webp`
  })
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
