import { MODULE_ID } from "../constants.js";

export const PARTY_INVENTORY_CREST_FLAG = "partyInventoryCrest";
export const DEFAULT_PARTY_INVENTORY_CREST = "icons/svg/mystery-man.svg";

function cleanPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePartyInventoryCrest(actor) {
  const stored = cleanPath(actor?.getFlag?.(MODULE_ID, PARTY_INVENTORY_CREST_FLAG))
    || cleanPath(actor?.flags?.[MODULE_ID]?.[PARTY_INVENTORY_CREST_FLAG]);
  return stored || cleanPath(actor?.img) || DEFAULT_PARTY_INVENTORY_CREST;
}

export function openPartyInventoryCrestPicker({
  actor,
  current,
  pickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation
    ?? globalThis.FilePicker,
  onSelected = null,
  onError = null
} = {}) {
  if (!actor || typeof actor.setFlag !== "function") {
    throw new Error("Active group Actor is unavailable.");
  }
  if (typeof pickerClass !== "function") {
    throw new Error("Foundry image picker is unavailable.");
  }

  const picker = new pickerClass({
    type: "image",
    current: cleanPath(current),
    callback: async (path) => {
      const selected = cleanPath(path);
      if (!selected) {
        return;
      }
      try {
        await actor.setFlag(MODULE_ID, PARTY_INVENTORY_CREST_FLAG, selected);
      }
      catch (error) {
        onError?.(error);
        return;
      }
      await onSelected?.(selected);
    }
  });
  void picker.render({ force: true });
  return picker;
}
