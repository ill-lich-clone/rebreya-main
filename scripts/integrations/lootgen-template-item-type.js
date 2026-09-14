import { LOOTGEN_TEMPLATE_ITEM_TYPE, MODULE_ID } from "../constants.js";
import {
  LOOTGEN_TEMPLATE_DEFAULT_IMG,
  LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
  normalizeLootgenTemplateItemSystem
} from "../data/lootgen-template-item.js";

export const LOOTGEN_TEMPLATE_TYPE_LABEL = "TYPES.Item.rebreya-main.lootgen-template";
export const LOOTGEN_TEMPLATE_TYPE_PLURAL_LABEL = "TYPES.Item.rebreya-main.lootgen-templatePl";
export const LOOTGEN_TEMPLATE_TYPE_ICON = "fa-solid fa-box-open";

let LootgenTemplateItemDataModel = null;
let LootgenTemplateItemSheet = null;
let registeredSheetConfig = null;

export function getLootgenTemplateItemDataModel() {
  return LootgenTemplateItemDataModel;
}

export function getLootgenTemplateItemSheet() {
  return LootgenTemplateItemSheet;
}

export function registerLootgenTemplateItemType() {
  const ItemConfig = globalThis.CONFIG?.Item;
  const TypeDataModel = globalThis.foundry?.abstract?.TypeDataModel;
  if (!ItemConfig || typeof TypeDataModel !== "function") return false;
  if (!LootgenTemplateItemDataModel || Object.getPrototypeOf(LootgenTemplateItemDataModel) !== TypeDataModel) {
    LootgenTemplateItemDataModel = class LootgenTemplateItemData extends TypeDataModel {
      static defineSchema() {
        const fields = globalThis.foundry?.data?.fields;
        if (!fields?.NumberField || !fields?.ObjectField) return {};
        return {
          schemaVersion: new fields.NumberField({
            required: true,
            nullable: false,
            integer: true,
            initial: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
            min: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
            max: LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION
          }),
          form: new fields.ObjectField({ required: true, nullable: false, initial: {} })
        };
      }

      static migrateData(source) {
        return normalizeLootgenTemplateItemSystem({
          schemaVersion: source?.schemaVersion ?? LOOTGEN_TEMPLATE_ITEM_SCHEMA_VERSION,
          form: source?.form ?? {}
        });
      }
    };
  }
  ItemConfig.dataModels ??= {};
  ItemConfig.typeLabels ??= {};
  ItemConfig.typeIcons ??= {};
  ItemConfig.dataModels[LOOTGEN_TEMPLATE_ITEM_TYPE] = LootgenTemplateItemDataModel;
  ItemConfig.typeLabels[LOOTGEN_TEMPLATE_ITEM_TYPE] = LOOTGEN_TEMPLATE_TYPE_LABEL;
  ItemConfig.typeLabels[`${LOOTGEN_TEMPLATE_ITEM_TYPE}Pl`] = LOOTGEN_TEMPLATE_TYPE_PLURAL_LABEL;
  ItemConfig.typeIcons[LOOTGEN_TEMPLATE_ITEM_TYPE] = LOOTGEN_TEMPLATE_TYPE_ICON;
  return true;
}

export function registerLootgenTemplateItemSheet() {
  const DocumentSheetV2 = globalThis.foundry?.applications?.api?.DocumentSheetV2;
  const sheetConfig = globalThis.foundry?.applications?.apps?.DocumentSheetConfig;
  if (typeof DocumentSheetV2 !== "function" || typeof sheetConfig?.registerSheet !== "function") return false;
  if (registeredSheetConfig === sheetConfig) return false;
  if (!LootgenTemplateItemSheet || Object.getPrototypeOf(LootgenTemplateItemSheet) !== DocumentSheetV2) {
    LootgenTemplateItemSheet = class LootgenTemplateItemEditorSheet extends DocumentSheetV2 {
      async render(_options = {}) {
        const uuid = String(this.document?.uuid ?? "").trim();
        if (!uuid) throw new Error("Шаблон Lootgen не имеет UUID.");
        await globalThis.game?.rebreyaMain?.openLootgenApp?.({
          newWindow: true,
          templateUuid: uuid,
          readOnly: Boolean(this.document?.pack)
            || this.document?.isOwner === false
            || this.document?.canUserModify?.(globalThis.game?.user, "update") === false
        });
        return this;
      }
    };
  }
  sheetConfig.registerSheet(globalThis.Item, MODULE_ID, LootgenTemplateItemSheet, {
    types: [LOOTGEN_TEMPLATE_ITEM_TYPE],
    makeDefault: true,
    label: LOOTGEN_TEMPLATE_TYPE_LABEL
  });
  registeredSheetConfig = sheetConfig;
  return true;
}

export { LOOTGEN_TEMPLATE_DEFAULT_IMG };
