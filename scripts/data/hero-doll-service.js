import { MODULE_ID } from "../constants.js";
import { getHeroDollBackSlots, getHeroDollSlots, inferHeroDollSlotsFromName, normalizeHeroDollSlots } from "./item-classification.js";

const HERO_DOLL_SLOTS = getHeroDollSlots();
const HERO_DOLL_INVENTORY_TYPES = new Set([
  "weapon",
  "equipment",
  "consumable",
  "tool",
  "loot",
  "container",
  "backpack"
]);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function sanitizeEmbeddedItemData(itemData) {
  const source = foundry.utils.deepClone(itemData);
  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;
  return source;
}

function getItemQuantity(itemData) {
  return Math.max(0, roundNumber(foundry.utils.getProperty(itemData, "system.quantity") ?? 1, 2));
}

function getItemWeight(itemData) {
  return Math.max(0, roundNumber(foundry.utils.getProperty(itemData, "system.weight.value") ?? 0, 2));
}

function buildDefaultState() {
  return {
    version: 1,
    slots: {}
  };
}

function buildEmptySnapshot(actor = null) {
  return {
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? "",
    slots: HERO_DOLL_SLOTS.map((slot) => ({
      ...slot,
      occupied: false,
      itemId: "",
      itemUuid: "",
      itemName: "",
      itemImg: "",
      itemMeta: "",
      title: `${slot.label}: пусто`
    })),
    inventoryItems: [],
    slotCount: HERO_DOLL_SLOTS.length,
    hasItems: false,
    hasInventoryItems: false,
    inventoryCount: 0,
    reservedCount: 0,
    availableCount: 0
  };
}

export class HeroDollService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  #normalizeState(actor) {
    if (!(actor instanceof Actor)) {
      return buildDefaultState();
    }

    const rawState = foundry.utils.deepClone(actor.getFlag(MODULE_ID, "heroDoll") ?? {});
    const state = foundry.utils.mergeObject(buildDefaultState(), rawState);
    const allowedSlots = new Set(HERO_DOLL_SLOTS.map((slot) => slot.id));
    state.slots = state.slots && typeof state.slots === "object" ? state.slots : {};

    for (const [slotId, slotState] of Object.entries(state.slots)) {
      if (!allowedSlots.has(slotId)) {
        delete state.slots[slotId];
        continue;
      }

      const itemId = String(slotState?.itemId ?? "").trim();
      if (!itemId || !actor.items.get(itemId)) {
        delete state.slots[slotId];
        continue;
      }

      state.slots[slotId] = { itemId };
    }

    return state;
  }

  async #saveState(actor, state) {
    const nextState = foundry.utils.mergeObject(buildDefaultState(), foundry.utils.deepClone(state), {
      inplace: false
    });

    // setFlag merges nested objects and can leave removed slots behind.
    // Replace the whole flag to keep slot removals deterministic.
    await actor.unsetFlag(MODULE_ID, "heroDoll");
    await actor.setFlag(MODULE_ID, "heroDoll", nextState);
    return nextState;
  }

  async #syncEquippedState(item, equipped) {
    if (!(item instanceof Item)) {
      return;
    }

    const itemData = item.toObject();
    if (!foundry.utils.hasProperty(itemData, "system.equipped")) {
      return;
    }

    const currentValue = Boolean(foundry.utils.getProperty(itemData, "system.equipped"));
    if (currentValue === equipped) {
      return;
    }

    await item.update({
      "system.equipped": equipped
    });
  }

  #getItemAllowedSlots(item) {
    if (!(item instanceof Item)) {
      return [];
    }

    const explicit = normalizeHeroDollSlots(
      item.getFlag(MODULE_ID, "heroDollSlots")
      ?? item.getFlag(MODULE_ID, "allowedHeroDollSlots")
      ?? foundry.utils.getProperty(item, `flags.${MODULE_ID}.heroDoll.slots`)
      ?? foundry.utils.getProperty(item, "system.heroDollSlots")
    );
    if (explicit.length) {
      return explicit;
    }

    const itemTypeValue = String(foundry.utils.getProperty(item, "system.type.value") ?? "").trim().toLowerCase();
    const itemTypeLabel = String(item.system?.type?.label ?? item.labels?.itemType ?? item.type).trim().toLowerCase();

    if (item.type === "weapon") {
      return normalizeHeroDollSlots([], [...getHeroDollBackSlots(), "leftHand", "rightHand"]);
    }

    if (item.type === "equipment") {
      if (itemTypeValue === "shield") {
        return ["leftHand", "rightHand", ...getHeroDollBackSlots()];
      }

      if (itemTypeValue === "ring") {
        return ["ring1", "ring2"];
      }
    }

    const inferred = inferHeroDollSlotsFromName(item.name, []);
    if (inferred.length) {
      return inferred;
    }

    if (item.type === "loot" && /книга|гримуар|фокус|жезл|палочка|посох|сфера/u.test(item.name)) {
      return ["leftHand", "rightHand", ...getHeroDollBackSlots()];
    }

    if (itemTypeLabel.includes("shield")) {
      return ["leftHand", "rightHand", ...getHeroDollBackSlots()];
    }

    return [];
  }

  #buildItemMeta(item, reservedSlotLabel = "") {
    const itemData = item.toObject();
    const quantity = getItemQuantity(itemData);
    const weight = getItemWeight(itemData);
    const typeLabel = item.system?.type?.label || item.labels?.itemType || item.type;
    const allowedSlots = this.#getItemAllowedSlots(item);
    const allowedLabels = allowedSlots
      .map((slotId) => HERO_DOLL_SLOTS.find((slot) => slot.id === slotId)?.label ?? "")
      .filter(Boolean);
    const parts = [];

    if (typeLabel) {
      parts.push(String(typeLabel));
    }

    if (quantity > 1) {
      parts.push(`x${quantity}`);
    }

    if (weight > 0) {
      parts.push(`${weight} фнт.`);
    }

    if (reservedSlotLabel) {
      parts.push(`Слот: ${reservedSlotLabel}`);
    }
    else if (allowedLabels.length && allowedLabels.length <= 3) {
      parts.push(`Можно: ${allowedLabels.join(", ")}`);
    }

    return parts.join(" • ");
  }

  #isInventoryItem(item) {
    if (!(item instanceof Item)) {
      return false;
    }

    if (HERO_DOLL_INVENTORY_TYPES.has(item.type)) {
      return true;
    }

    const itemData = item.toObject();
    return foundry.utils.hasProperty(itemData, "system.quantity")
      || foundry.utils.hasProperty(itemData, "system.weight.value");
  }

  #getInventoryItems(actor, occupiedSlotsByItemId) {
    return actor.items.contents
      .filter((item) => this.#isInventoryItem(item))
      .sort((left, right) => {
        const sortDifference = toNumber(left.sort, 0) - toNumber(right.sort, 0);
        if (sortDifference !== 0) {
          return sortDifference;
        }

        return String(left.name ?? "").localeCompare(String(right.name ?? ""), game.i18n?.lang);
      })
      .map((item) => {
        const reservedSlot = occupiedSlotsByItemId.get(item.id) ?? null;
        if (reservedSlot) {
          return null;
        }

        const allowedSlots = this.#getItemAllowedSlots(item);
        if (!allowedSlots.length) {
          return null;
        }

        return {
          id: item.id,
          itemUuid: item.uuid,
          name: item.name,
          img: item.img,
          reserved: false,
          reservedSlotId: "",
          reservedSlotLabel: "",
          allowedSlots,
          allowedSlotsCsv: allowedSlots.join(","),
          meta: this.#buildItemMeta(item, ""),
          title: item.name
        };
      })
      .filter(Boolean);
  }

  async #moveItemToActor(sourceItem, targetActor) {
    const sourceActor = sourceItem.parent;
    const sourceData = sourceItem.toObject();
    const sourceQuantity = getItemQuantity(sourceData);
    const itemData = sanitizeEmbeddedItemData(sourceData);

    if (sourceQuantity > 1) {
      foundry.utils.setProperty(itemData, "system.quantity", 1);
      const [created] = await targetActor.createEmbeddedDocuments("Item", [itemData]);
      await sourceItem.update({
        "system.quantity": roundNumber(sourceQuantity - 1, 2)
      });
      return created ?? null;
    }

    const [created] = await targetActor.createEmbeddedDocuments("Item", [itemData]);
    await sourceItem.delete();

    if (sourceActor?.sheet?.rendered) {
      try {
        await sourceActor.sheet.render({ force: true });
      }
      catch (_error) {
        await sourceActor.sheet.render(true);
      }
    }

    return created ?? null;
  }

  async #resolveDropItem(actor, dropData) {
    const itemDocument = dropData?.uuid ? await fromUuid(dropData.uuid) : null;
    if (!(itemDocument instanceof Item) || !(itemDocument.parent instanceof Actor)) {
      throw new Error("Перетащите предмет из листа персонажа или партийного склада.");
    }

    const sourceActor = itemDocument.parent;
    if (!actor?.isOwner || !sourceActor.isOwner) {
      throw new Error("Недостаточно прав для изменения куклы героя.");
    }

    if (sourceActor.id === actor.id) {
      return itemDocument;
    }

    const inventoryActor = await this.moduleApi.inventoryService?.getInventoryActor?.({ create: false }) ?? null;
    if (!inventoryActor || sourceActor.id !== inventoryActor.id) {
      throw new Error("Кукла героя принимает предметы только из инвентаря персонажа или общего склада группы.");
    }

    const movedItem = await this.#moveItemToActor(itemDocument, actor);
    if (!movedItem) {
      throw new Error("Не удалось перенести предмет в инвентарь персонажа.");
    }

    return movedItem;
  }

  getActorSnapshot(actor) {
    if (!(actor instanceof Actor)) {
      return buildEmptySnapshot();
    }

    const state = this.#normalizeState(actor);
    const occupiedItemIds = Object.values(state.slots).map((slotState) => slotState.itemId);
    const occupiedItemIdSet = new Set(occupiedItemIds);
    const occupiedSlotsByItemId = new Map();
    const slots = HERO_DOLL_SLOTS.map((slot) => {
      const itemId = state.slots[slot.id]?.itemId ?? "";
      const item = itemId ? actor.items.get(itemId) ?? null : null;

      if (item) {
        occupiedSlotsByItemId.set(item.id, slot);
      }

      return {
        ...slot,
        occupied: Boolean(item),
        itemId: item?.id ?? "",
        itemUuid: item?.uuid ?? "",
        itemName: item?.name ?? "",
        itemImg: item?.img ?? "",
        itemMeta: item ? this.#buildItemMeta(item) : "",
        title: item ? `${slot.label}: ${item.name}` : `${slot.label}: пусто`
      };
    });
    const inventoryItems = this.#getInventoryItems(actor, occupiedSlotsByItemId);

    return {
      actorId: actor.id,
      actorName: actor.name,
      slots,
      inventoryItems,
      slotCount: HERO_DOLL_SLOTS.length,
      hasItems: occupiedItemIds.length > 0,
      hasInventoryItems: inventoryItems.length > 0,
      inventoryCount: inventoryItems.length,
      reservedCount: occupiedItemIdSet.size,
      availableCount: Math.max(0, inventoryItems.length - occupiedItemIdSet.size)
    };
  }

  async clearSlot(actor, slotId) {
    if (!(actor instanceof Actor) || !slotId) {
      return false;
    }

    const state = this.#normalizeState(actor);
    const itemId = state.slots[slotId]?.itemId ?? null;
    if (!itemId) {
      return false;
    }

    delete state.slots[slotId];
    await this.#saveState(actor, state);

    const item = actor.items.get(itemId) ?? null;
    const stillReserved = Object.values(state.slots).some((slotState) => slotState.itemId === itemId);
    if (!stillReserved) {
      await this.#syncEquippedState(item, false);
    }

    return true;
  }

  async assignItemToSlot(actor, slotId, dropData) {
    if (!(actor instanceof Actor)) {
      throw new Error("Персонаж для куклы героя не найден.");
    }

    const slot = HERO_DOLL_SLOTS.find((entry) => entry.id === slotId) ?? null;
    if (!slot) {
      throw new Error("Слот куклы героя не найден.");
    }

    const item = await this.#resolveDropItem(actor, dropData);
    const allowedSlots = this.#getItemAllowedSlots(item);
    if (!allowedSlots.length) {
      throw new Error(`Для предмета "${item.name}" не настроены слоты куклы героя.`);
    }

    if (!allowedSlots.includes(slotId)) {
      const allowedLabels = allowedSlots
        .map((allowedSlotId) => HERO_DOLL_SLOTS.find((entry) => entry.id === allowedSlotId)?.label ?? "")
        .filter(Boolean)
        .join(", ");
      throw new Error(allowedLabels
        ? `Этот предмет нельзя поместить в слот "${slot.label}". Подходящие слоты: ${allowedLabels}.`
        : `Этот предмет нельзя поместить в слот "${slot.label}".`);
    }

    const state = this.#normalizeState(actor);
    const previousItemId = state.slots[slotId]?.itemId ?? null;

    for (const [existingSlotId, slotState] of Object.entries(state.slots)) {
      if (slotState.itemId === item.id) {
        delete state.slots[existingSlotId];
      }
    }

    state.slots[slotId] = { itemId: item.id };
    await this.#saveState(actor, state);
    await this.#syncEquippedState(item, true);

    if (previousItemId && previousItemId !== item.id) {
      const previousItem = actor.items.get(previousItemId) ?? null;
      const stillReserved = Object.values(state.slots).some((slotState) => slotState.itemId === previousItemId);
      if (!stillReserved) {
        await this.#syncEquippedState(previousItem, false);
      }
    }

    return item;
  }

  async openSlotItem(actor, slotId) {
    const state = this.#normalizeState(actor);
    const itemId = state.slots[slotId]?.itemId ?? "";
    const item = itemId ? actor.items.get(itemId) ?? null : null;
    if (!item) {
      throw new Error("В этом слоте нет предмета.");
    }

    await item.sheet?.render?.(true);
    return item;
  }
}
