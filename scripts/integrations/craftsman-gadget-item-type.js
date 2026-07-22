import { CRAFTSMAN_GADGET_ITEM_TYPE } from "../constants.js";

const GADGET_TYPE_LABEL = "TYPES.Item.rebreya-main.gadget";
const GADGET_TYPE_PLURAL_LABEL = "TYPES.Item.rebreya-main.gadgetPl";

let CraftsmanGadgetItemDataModel = null;

export function getCraftsmanGadgetItemDataModel() {
  return CraftsmanGadgetItemDataModel;
}

export function registerCraftsmanGadgetItemType() {
  const ItemConfig = globalThis.CONFIG?.Item;
  const ConsumableData = ItemConfig?.dataModels?.consumable;
  if (!ItemConfig || typeof ConsumableData !== "function") {
    return false;
  }

  if (
    !CraftsmanGadgetItemDataModel
    || Object.getPrototypeOf(CraftsmanGadgetItemDataModel) !== ConsumableData
  ) {
    CraftsmanGadgetItemDataModel = class CraftsmanGadgetItemData extends ConsumableData {
      static inventorySection = {
        id: "craftsman-gadgets",
        order: 350,
        label: GADGET_TYPE_PLURAL_LABEL,
        groups: { type: CRAFTSMAN_GADGET_ITEM_TYPE },
        columns: ["price", "weight", "quantity", "charges", "controls"]
      };
    };
  }

  ItemConfig.dataModels[CRAFTSMAN_GADGET_ITEM_TYPE] = CraftsmanGadgetItemDataModel;
  ItemConfig.typeLabels[CRAFTSMAN_GADGET_ITEM_TYPE] = GADGET_TYPE_LABEL;
  ItemConfig.typeLabels[`${CRAFTSMAN_GADGET_ITEM_TYPE}Pl`] = GADGET_TYPE_PLURAL_LABEL;
  ItemConfig.typeIcons[CRAFTSMAN_GADGET_ITEM_TYPE] = "fa-solid fa-gears";
  return true;
}
