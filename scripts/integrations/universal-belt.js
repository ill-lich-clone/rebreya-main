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

function getCollectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  return [];
}

function getActorItems(actor) {
  return getCollectionValues(actor?.items);
}

function getItemQuantity(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 0));
}

function setBeltSlotOnData(itemData, slot) {
  foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`, slot);
}

function buildMergeKey(item) {
  const itemData = typeof item?.toObject === "function" ? item.toObject() : item;
  const flags = itemData.flags?.[MODULE_ID] ?? {};
  return JSON.stringify({
    type: itemData.type ?? "",
    name: itemData.name ?? "",
    sourceType: flags.sourceType ?? "",
    gearId: flags.gearId ?? "",
    magicItemId: flags.magicItemId ?? "",
    materialId: flags.materialId ?? "",
    foundrySubtype: flags.foundrySubtype ?? foundry.utils.getProperty(itemData, "system.type.value") ?? "",
    foundrySubtypeExtra: flags.foundrySubtypeExtra ?? foundry.utils.getProperty(itemData, "system.type.subtype") ?? ""
  });
}

function findMergeCandidate(actor, item) {
  const sourceKey = buildMergeKey(item);
  return getActorItems(actor).find((candidate) => (
    candidate !== item
    && !candidate.deleted
    && getUniversalBeltItemSlot(candidate) === 0
    && isUniversalBeltEligibleItem(candidate)
    && buildMergeKey(candidate) === sourceKey
  )) ?? null;
}

async function clearBeltSlotFlag(item) {
  await item.update({
    [`flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`]: null
  });
}

export function getUniversalBeltItemsBySlot(actor) {
  const result = new Map();
  for (const item of getActorItems(actor)) {
    const slot = getUniversalBeltItemSlot(item);
    if (slot) result.set(slot, item);
  }
  return result;
}

export async function removeItemFromUniversalBelt(actor, slotOrItem) {
  const item = typeof slotOrItem === "number"
    ? getUniversalBeltItemsBySlot(actor).get(slotOrItem) ?? null
    : slotOrItem;
  if (!item) return false;

  const mergeCandidate = findMergeCandidate(actor, item);
  if (mergeCandidate) {
    await mergeCandidate.update({
      "system.quantity": getItemQuantity(mergeCandidate) + getItemQuantity(item)
    });
    await item.delete();
    return true;
  }

  await clearBeltSlotFlag(item);
  return true;
}

export async function assignItemToUniversalBeltSlot(actor, slot, item) {
  const safeSlot = Math.floor(toNumber(slot, 0));
  if (!actor?.isOwner) throw new Error("Недостаточно прав для изменения пояса.");
  if (safeSlot < 1 || safeSlot > getUniversalBeltUnlockedSlotCount(actor)) {
    throw new Error("Этот слот пояса ещё не открыт.");
  }
  if (!isUniversalBeltEligibleItem(item) || item?.parent !== actor) {
    throw new Error("Перетащите физический предмет из инвентаря этого персонажа.");
  }
  if (getItemQuantity(item) <= 0) {
    throw new Error("У предмета нет доступного количества.");
  }

  const existing = getUniversalBeltItemsBySlot(actor).get(safeSlot) ?? null;
  if (existing && existing !== item) await removeItemFromUniversalBelt(actor, existing);

  const currentSlot = getUniversalBeltItemSlot(item);
  if (currentSlot && currentSlot !== safeSlot) await clearBeltSlotFlag(item);

  const sourceQuantity = getItemQuantity(item);
  if (sourceQuantity > 1) {
    const itemData = foundry.utils.deepClone(item.toObject());
    delete itemData._id;
    setBeltSlotOnData(itemData, safeSlot);
    foundry.utils.setProperty(itemData, "system.quantity", 1);
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { renderSheet: false });
    await item.update({ "system.quantity": sourceQuantity - 1 });
    return created ?? null;
  }

  await item.update({
    [`flags.${MODULE_ID}.${UNIVERSAL_BELT_ITEM_SLOT_FLAG}`]: safeSlot
  });
  return item;
}
