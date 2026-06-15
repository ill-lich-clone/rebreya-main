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

export async function purchaseUniversalBeltSlot(actor) {
  if (!actor?.isOwner) throw new Error("Недостаточно прав для покупки слота пояса.");

  const unlockedSlots = getUniversalBeltUnlockedSlotCount(actor);
  if (unlockedSlots >= UNIVERSAL_BELT_SLOT_COUNT) {
    throw new Error("Все слоты пояса уже открыты.");
  }

  const currentCurrency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  const payment = calculateUniversalBeltPayment(currentCurrency);
  if (!payment.ok) {
    throw new Error("Недостаточно средств: нужно 500 зм или эквивалент в пм.");
  }

  const nextUnlockedSlots = unlockedSlots + 1;
  await actor.update({
    "system.currency.gp": payment.currency.gp,
    "system.currency.pp": payment.currency.pp
  });
  await actor.setFlag(MODULE_ID, UNIVERSAL_BELT_FLAG, {
    unlockedSlots: nextUnlockedSlots
  });
  return nextUnlockedSlots;
}

export async function useUniversalBeltItem(actor, slot, event = null) {
  const item = getUniversalBeltItemsBySlot(actor).get(Math.floor(toNumber(slot, 0))) ?? null;
  if (!item) throw new Error("В этом слоте пояса нет предмета.");
  if (typeof item.use === "function") {
    return item.use({ event, legacy: false });
  }
  await item.sheet?.render?.(true);
  return item;
}

let contextHookRegistered = false;
const boundRoots = new WeakSet();

function buildSlotTitle(slot, item, locked) {
  if (locked) return `Слот пояса ${slot}: купить за 500 зм`;
  return item ? `Слот пояса ${slot}: ${item.name}` : `Слот пояса ${slot}: пусто`;
}

function createSlotElement(slot, actor) {
  const unlockedCount = getUniversalBeltUnlockedSlotCount(actor);
  const itemsBySlot = getUniversalBeltItemsBySlot(actor);
  const item = itemsBySlot.get(slot) ?? null;
  const locked = slot > unlockedCount;
  const li = document.createElement("li");
  li.classList.add("container", "draggable", "rm-universal-belt-slot");
  li.dataset.rebreyaUniversalBeltSlot = "true";
  li.dataset.beltSlot = String(slot);
  if (locked) li.dataset.locked = "true";
  li.setAttribute("aria-label", buildSlotTitle(slot, item, locked));
  li.setAttribute("title", buildSlotTitle(slot, item, locked));
  if (item) {
    li.dataset.itemId = item.id;
    li.dataset.uuid = item.uuid ?? "";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("rm-universal-belt-slot__button");
  if (item) {
    button.dataset.action = "rebreya-universal-belt-use";
    const img = document.createElement("img");
    img.src = item.img ?? "icons/svg/item-bag.svg";
    img.alt = item.name ?? "";
    img.draggable = false;
    button.append(img);
  }
  else {
    if (locked) {
      button.dataset.action = "rebreya-universal-belt-purchase";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-lock";
      icon.setAttribute("aria-hidden", "true");
      button.append(icon);
    }
  }
  li.append(button);
  return li;
}

export function hideBeltedInventoryRows(root, actor) {
  const beltedIds = new Set([...getUniversalBeltItemsBySlot(actor).values()].map((item) => item.id));
  if (!beltedIds.size) return;

  const inventoryRoot = root?.querySelector?.("[data-tab='inventory']") ?? root;
  for (const node of Array.from(inventoryRoot?.querySelectorAll?.("[data-item-id]") ?? [])) {
    if (node.closest?.(".rm-universal-belt-slot")) continue;
    if (node.closest?.(".containers")) continue;
    if (beltedIds.has(node.dataset.itemId)) {
      node.hidden = true;
      node.classList?.add?.("rm-universal-belt-hidden-item");
    }
  }
}

export function renderUniversalBeltSlots(root, actor) {
  const containers = root?.querySelector?.("ul.containers") ?? null;
  if (!containers || !actor) return false;

  for (const existing of Array.from(containers.querySelectorAll(".rm-universal-belt-slot") ?? [])) {
    existing.remove();
  }
  containers.prepend(...[1, 2, 3].map((slot) => createSlotElement(slot, actor)));
  hideBeltedInventoryRows(root, actor);
  return true;
}

function getDropData(event) {
  for (const type of ["text/plain", "text", "application/json"]) {
    const raw = event.dataTransfer?.getData?.(type);
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    }
    catch (_error) {
      return { uuid: raw };
    }
  }
  return null;
}

async function resolveDroppedItem(dropData) {
  return dropData?.uuid ? fromUuid(dropData.uuid) : null;
}

async function confirmBeltPurchase(slot) {
  if (globalThis.Dialog?.confirm instanceof Function) {
    return Dialog.confirm({
      title: "Купить слот пояса",
      content: `<p>Купить слот пояса ${slot} за 500 зм? Используются только зм и пм.</p>`
    });
  }
  return true;
}

export function bindUniversalBeltSheet(root, { actor, app, moduleApi, rerenderActorSheet }) {
  if (!renderUniversalBeltSlots(root, actor) || boundRoots.has(root)) return false;
  boundRoots.add(root);

  root.addEventListener("dragover", (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot || slot.dataset.locked === "true") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    slot.classList.add("is-dragover");
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }, { capture: true });

  root.addEventListener("dragleave", (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot) return;
    slot.classList.remove("is-dragover");
  }, { capture: true });

  root.addEventListener("drop", async (event) => {
    const slot = event.target?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!slot || slot.dataset.locked === "true") return;
    event.preventDefault?.();
    event.stopPropagation?.();
    slot.classList.remove("is-dragover");
    try {
      const item = await resolveDroppedItem(getDropData(event));
      await assignItemToUniversalBeltSlot(actor, Number(slot.dataset.beltSlot), item);
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to assign universal belt slot.`, error);
      ui.notifications?.error(error.message || "Не удалось поместить предмет в пояс.");
    }
  }, { capture: true });

  root.addEventListener("click", async (event) => {
    const action = event.target?.closest?.("[data-action='rebreya-universal-belt-use'], [data-action='rebreya-universal-belt-purchase']");
    const slot = action?.closest?.("[data-rebreya-universal-belt-slot='true']");
    if (!action || !slot) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    try {
      if (action.dataset.action === "rebreya-universal-belt-purchase") {
        if (!(await confirmBeltPurchase(slot.dataset.beltSlot))) return;
        await purchaseUniversalBeltSlot(actor);
      }
      else {
        await useUniversalBeltItem(actor, Number(slot.dataset.beltSlot), event);
      }
      await rerenderActorSheet(app, moduleApi);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to handle universal belt action.`, error);
      ui.notifications?.error(error.message || "Не удалось выполнить действие пояса.");
    }
  }, { capture: true });

  return true;
}

async function renderOwnerSheet(actor) {
  if (!actor?.sheet?.render) return;
  try {
    await actor.sheet.render({ force: true });
  }
  catch (_error) {
    await actor.sheet.render(true);
  }
}

export function registerUniversalBeltItemContextHook(moduleApi) {
  if (contextHookRegistered || !globalThis.Hooks?.on) return false;
  contextHookRegistered = true;
  Hooks.on("dnd5e.getItemContextOptions", (item, options) => {
    if (!getUniversalBeltItemSlot(item)) return;
    options.push({
      name: "Убрать из пояса",
      icon: '<i class="fa-solid fa-box-open fa-fw"></i>',
      condition: () => item.isOwner !== false,
      callback: async () => {
        try {
          await removeItemFromUniversalBelt(item.parent ?? item.actor, item);
          await moduleApi?.refreshOpenApps?.();
          await renderOwnerSheet(item.parent ?? item.actor);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to remove universal belt item.`, error);
          ui.notifications?.error(error.message || "Не удалось убрать предмет из пояса.");
        }
      },
      group: "action"
    });
  });
  return true;
}
