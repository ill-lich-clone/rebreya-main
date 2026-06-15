import { MODULE_ID } from "../constants.js";

export const UNIVERSAL_BELT_FLAG = "universalBelt";
export const UNIVERSAL_BELT_ITEM_SLOT_FLAG = "universalBelt.slot";
export const UNIVERSAL_BELT_SLOT_COUNT = 3;
export const UNIVERSAL_BELT_DEFAULT_UNLOCKED_SLOTS = 1;
export const UNIVERSAL_BELT_SLOT_PRICE_GP = 500;

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toWholeCoins(value) {
  return Math.max(0, Math.floor(toNumber(value, 0)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(toNumber(value, min))));
}

export function getUniversalBeltUnlockedSlotCount(actor) {
  const rawState = actor?.getFlag?.(MODULE_ID, UNIVERSAL_BELT_FLAG)
    ?? foundry.utils.getProperty(actor, `flags.${MODULE_ID}.${UNIVERSAL_BELT_FLAG}`)
    ?? {};
  return clamp(
    rawState.unlockedSlots,
    UNIVERSAL_BELT_DEFAULT_UNLOCKED_SLOTS,
    UNIVERSAL_BELT_SLOT_COUNT
  );
}

export function getUniversalBeltItemSlot(item) {
  const slot = item?.getFlag?.(MODULE_ID, UNIVERSAL_BELT_ITEM_SLOT_FLAG)
    ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`)
    ?? 0;
  const numericSlot = Math.floor(toNumber(slot, 0));
  return numericSlot >= 1 && numericSlot <= UNIVERSAL_BELT_SLOT_COUNT ? numericSlot : 0;
}

export function isUniversalBeltEligibleItem(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  return foundry.utils.hasProperty(itemData, "system.quantity");
}

export function calculateUniversalBeltPayment(currency = {}, costGp = UNIVERSAL_BELT_SLOT_PRICE_GP) {
  const gp = toWholeCoins(currency.gp);
  const pp = toWholeCoins(currency.pp);
  const cost = toWholeCoins(costGp);

  if (gp >= cost) {
    return { ok: true, currency: { gp: gp - cost, pp } };
  }

  const deficit = cost - gp;
  const ppToSpend = Math.ceil(deficit / 10);
  if (ppToSpend > pp) {
    return { ok: false, currency: { gp, pp } };
  }

  return {
    ok: true,
    currency: {
      gp: (ppToSpend * 10) - deficit,
      pp: pp - ppToSpend
    }
  };
}
