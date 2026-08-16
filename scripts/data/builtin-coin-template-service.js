import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const BUILTIN_COIN_FOLDER_NAME = "МОНЕТЫ";
export const BUILTIN_COIN_TEMPLATE_FLAG = "storageCoinTemplate";

export const BUILTIN_COIN_TEMPLATES = Object.freeze([
  Object.freeze({
    denomination: "pp",
    name: "Платиновая монета",
    img: "icons/commodities/currency/coins-assorted-mix-platinum.webp"
  }),
  Object.freeze({
    denomination: "gp",
    name: "Золотая монета",
    img: "icons/commodities/currency/coins-plain-gold.webp"
  }),
  Object.freeze({
    denomination: "sp",
    name: "Серебряная монета",
    img: "icons/commodities/currency/coins-assorted-mix-silver.webp"
  }),
  Object.freeze({
    denomination: "cp",
    name: "Медная монета",
    img: "icons/commodities/currency/coins-assorted-mix-copper.webp"
  })
]);

const BUILTIN_COIN_DENOMINATIONS = new Set(
  BUILTIN_COIN_TEMPLATES.map(({ denomination }) => denomination)
);

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function cloneData(value) {
  const source = typeof value?.toObject === "function" ? value.toObject() : value;
  if (!source || typeof source !== "object") return {};
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(source);
  }
  return JSON.parse(JSON.stringify(source));
}

function compareManagedItems(left, right) {
  const leftSort = Number.isFinite(left?.sort) ? left.sort : 0;
  const rightSort = Number.isFinite(right?.sort) ? right.sort : 0;
  if (leftSort !== rightSort) return leftSort - rightSort;
  const leftId = String(left?.id ?? "");
  const rightId = String(right?.id ?? "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

export function readBuiltinCoinDenomination(item) {
  const flag = typeof item?.getFlag === "function"
    ? item.getFlag(MODULE_ID, BUILTIN_COIN_TEMPLATE_FLAG)
    : item?.flags?.[MODULE_ID]?.[BUILTIN_COIN_TEMPLATE_FLAG];
  const denomination = String(flag?.denomination ?? "").trim();
  return BUILTIN_COIN_DENOMINATIONS.has(denomination) ? denomination : null;
}

function buildExactCoinTemplateFlag(item, denomination) {
  const current = typeof item?.getFlag === "function"
    ? item.getFlag(MODULE_ID, BUILTIN_COIN_TEMPLATE_FLAG)
    : item?.flags?.[MODULE_ID]?.[BUILTIN_COIN_TEMPLATE_FLAG];
  const removals = Object.keys(current && typeof current === "object" ? current : {})
    .filter((key) => key !== "version" && key !== "denomination")
    .map((key) => [`-=${key}`, null]);
  return {
    ...Object.fromEntries(removals),
    version: 1,
    denomination
  };
}

function buildBuiltinCoinTemplateData(template, folderId) {
  return {
    name: template.name,
    type: "loot",
    img: template.img,
    folder: folderId,
    system: {
      quantity: 1,
      type: { value: "treasure" }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "coinTemplate",
        [BUILTIN_COIN_TEMPLATE_FLAG]: {
          version: 1,
          denomination: template.denomination
        }
      }
    }
  };
}

export class BuiltinCoinTemplateService {
  constructor({
    gameProvider = () => globalThis.game,
    folderProvider = () => globalThis.Folder,
    itemProvider = () => globalThis.Item,
    isActiveGm = isActiveGmClient,
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.folderProvider = folderProvider;
    this.itemProvider = itemProvider;
    this.isActiveGm = isActiveGm;
    this.logger = logger;
  }

  async sync() {
    const game = this.gameProvider();
    if (this.isActiveGm(game) !== true) return null;

    const folder = await this.#ensureFolder(game);
    const worldItems = collectionValues(game?.items);
    const items = [];
    for (const template of BUILTIN_COIN_TEMPLATES) {
      const matches = worldItems
        .filter((item) => readBuiltinCoinDenomination(item) === template.denomination)
        .sort(compareManagedItems);
      if (matches.length > 1) {
        this.logger?.warn?.(
          `${MODULE_ID} | Found duplicate built-in coin templates for ${template.denomination}; repairing only the deterministic primary.`
        );
      }
      const primary = matches[0];
      if (primary) {
        await this.#repairItem(primary, template, folder.id);
        items.push(primary);
        continue;
      }

      const Item = this.itemProvider();
      if (typeof Item?.create !== "function") {
        throw new TypeError("Item.create is required to restore built-in coin templates.");
      }
      const item = await Item.create(
        buildBuiltinCoinTemplateData(template, folder.id),
        { renderSheet: false }
      );
      if (item) items.push(item);
    }
    return { folder, items };
  }

  async #repairItem(item, template, folderId) {
    if (typeof item?.update !== "function") return;
    const exactFlag = buildExactCoinTemplateFlag(item, template.denomination);
    if (item.type !== "loot") {
      const system = cloneData(item.system);
      system.quantity = 1;
      system.type = {
        ...(system.type && typeof system.type === "object" ? system.type : {}),
        value: "treasure"
      };
      await item.update({
        name: template.name,
        type: "loot",
        img: template.img,
        folder: folderId,
        system
      }, { recursive: false });
      await item.update({
        [`flags.${MODULE_ID}.sourceType`]: "coinTemplate",
        [`flags.${MODULE_ID}.${BUILTIN_COIN_TEMPLATE_FLAG}`]: exactFlag
      });
      return;
    }
    await item.update({
      name: template.name,
      type: "loot",
      img: template.img,
      folder: folderId,
      "system.quantity": 1,
      "system.type.value": "treasure",
      [`flags.${MODULE_ID}.sourceType`]: "coinTemplate",
      [`flags.${MODULE_ID}.${BUILTIN_COIN_TEMPLATE_FLAG}`]: exactFlag
    });
  }

  async #ensureFolder(game) {
    const existing = collectionValues(game?.folders).find((folder) => (
      folder?.type === "Item"
      && folder?.folder == null
      && String(folder?.name ?? "").trim() === BUILTIN_COIN_FOLDER_NAME
    ));
    if (existing) return existing;

    const Folder = this.folderProvider();
    if (typeof Folder?.create !== "function") {
      throw new TypeError("Folder.create is required to restore built-in coin templates.");
    }
    return Folder.create({
      name: BUILTIN_COIN_FOLDER_NAME,
      type: "Item",
      folder: null
    });
  }
}
