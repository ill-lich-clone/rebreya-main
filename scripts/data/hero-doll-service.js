import { MODULE_ID, REBREYA_GROUP_FLAGS } from "../constants.js";
import { getHeroDollBackSlots, getHeroDollSlots, inferHeroDollSlotsFromName, normalizeHeroDollSlots } from "./item-classification.js";

import { ItemInstanceWorkflow } from "../application/item-instance-workflow.js?v=1.4.249-item-instances";
import { ItemInstanceDocuments } from "../infrastructure/foundry/item-instance-documents.js?v=1.4.249-item-instances";
import { ItemInstanceError } from "./item-instance-rules.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildHeldItemHandUpdate, buildHeldItemWornUpdate, getActorHandSlots, getOccupiedHandSlots, itemRequiresTwoHandsForUse } from "../integrations/held-items.js";

export const HERO_DOLL_ASSIGN_COMMAND = "hero-doll.assign";
export const HERO_DOLL_NORMALIZE_COMMAND = "hero-doll.normalize-stack";
export const HERO_DOLL_CLEAR_COMMAND = "hero-doll.clear";
export function isValidHeroDollAssignPayload(payload) {
  return payload && Object.keys(payload).sort().join(",") === "actorUuid,operationId,slotId,sourceItemUuid"
    && /^Actor\.[A-Za-z0-9_-]+$/.test(payload.actorUuid)
    && /^Actor\.[A-Za-z0-9_-]+\.Item\.[A-Za-z0-9_-]+$/.test(payload.sourceItemUuid)
    && HERO_DOLL_SLOTS.some(slot => slot.id === payload.slotId)
    && typeof payload.operationId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.operationId);
}

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
    this.pendingAssignments = new Map();
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
        legacyStack: Boolean(item && item.system.quantity > 1),
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
    const itemId = this.#normalizeState(actor).slots[slotId]?.itemId;
    if (!itemId) return false;
    await this.#submitAssignment(actor, slotId, {uuid:`${actor.uuid}.Item.${itemId}`}, "clear");
    return true;
  }

  normalizeLegacyStack(actor, slotId) {
    const itemId = this.#normalizeState(actor).slots[slotId]?.itemId;
    if (!itemId) throw new ItemInstanceError("item-not-found", "В слоте нет предмета.");
    return this.#submitAssignment(actor,slotId,{uuid:`${actor.uuid}.Item.${itemId}`},"normalize");
  }

  assignItemToSlot(actor, slotId, dropData) {
    return this.#submitAssignment(actor, slotId, dropData, "assign");
  }

  async #submitAssignment(actor, slotId, dropData, mode) {
    const key = JSON.stringify([actor?.uuid, dropData?.uuid, slotId, mode]);
    const payload = this.pendingAssignments.get(key) ?? {
      actorUuid: actor?.uuid, sourceItemUuid: dropData?.uuid, slotId, operationId: crypto.randomUUID()
    };
    this.pendingAssignments.set(key, payload);
    try {
      const method = {assign:"assignHeroDollItem",normalize:"normalizeHeroDollStack",clear:"clearHeroDollSlot"}[mode];
      const result = await this.moduleApi[method](payload);
      this.pendingAssignments.delete(key);
      return actor.items.get(result.itemId) ?? await fromUuid(`${actor.uuid}.Item.${result.itemId}`);
    } catch (error) {
      if (!["request-timeout", "ambiguous-outcome", "active-gm-changed", "manual-review", "pending-instance-operation"].includes(error?.code)) this.pendingAssignments.delete(key);
      throw error;
    }
  }

  async #authorizeAssignment({ sourceActor, targetActor, sourceItem }, intent, sender) {
    const owns = actor => sender?.isGM === true || actor?.testUserPermission?.(sender, "OWNER") === true;
    if (!(targetActor instanceof Actor) || targetActor.type !== "character" || !owns(targetActor)) {
      throw new ItemInstanceError("unauthorized", "Недостаточно прав для изменения куклы героя.");
    }
    if (sourceActor.uuid !== targetActor.uuid) {
      const group = sourceActor.getFlag(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED) === true;
      const context = group ? await this.moduleApi.groupContextService.resolveForGroup(sourceActor.id) : null;
      if (!group || !context?.members?.some(member => member.id === targetActor.id) || !owns(sourceActor)) {
        throw new ItemInstanceError("unauthorized", "Предмет должен принадлежать персонажу или доступному складу его группы.");
      }
    }
    if (!sourceItem) return;
    if (intent.mode !== "assign") {
      if (sourceActor.uuid !== targetActor.uuid || this.#normalizeState(targetActor).slots[intent.heroSlotId]?.itemId !== sourceItem.id
        || (intent.mode === "normalize" && sourceItem.system.quantity <= 1)) {
        throw new ItemInstanceError("stale-slot", "Содержимое слота изменилось. Обновите лист персонажа.");
      }
      return;
    }
    if (!this.#getItemAllowedSlots(sourceItem).includes(intent.heroSlotId)) {
      throw new ItemInstanceError("invalid-slot", "Этот предмет нельзя поместить в выбранный слот куклы героя.");
    }
    this.#assignmentHands(targetActor, sourceItem, intent.heroSlotId);
  }

  #assignmentHands(actor, item, slotId) {
    const hand = { leftHand: "left", rightHand: "right" }[slotId];
    if (!hand) return [];
    const hands = itemRequiresTwoHandsForUse(item) ? ["left", "right"] : [hand];
    const capacity = getActorHandSlots(actor);
    const occupied = getOccupiedHandSlots(actor, { exceptItem: item.parent.uuid === actor.uuid ? item : null });
    const state = this.#normalizeState(actor);
    for (const selected of hands) {
      const occupant = occupied.get(selected);
      const oldSlot = selected === "left" ? "leftHand" : "rightHand";
      if (!capacity.includes(selected) || occupant?.isHandReservation
        || (occupant && state.slots[oldSlot]?.itemId !== occupant.id)) {
        throw new ItemInstanceError("hands-unavailable", "Нужная рука занята. Сначала освободите её.");
      }
    }
    return hands;
  }

  #prepareAssignment({ sourceItem, targetActor, intent, plan, itemId }) {
    const flag = `flags.${MODULE_ID}.heroDoll`;
    const state = this.#normalizeState(targetActor);
    const hands = this.#assignmentHands(targetActor, sourceItem, intent.heroSlotId);
    const slots = hands.length === 2 ? ["leftHand", "rightHand"] : [intent.heroSlotId];
    const replaced = new Set(slots.map(slot => state.slots[slot]?.itemId).filter(id => id && id !== itemId));
    for (const [slot, entry] of Object.entries(state.slots)) {
      if (entry.itemId === itemId || replaced.has(entry.itemId)) delete state.slots[slot];
    }
    for (const slot of slots) state.slots[slot] = { itemId };
    const step = (id, data, patch) => {
      const after = Object.fromEntries(Object.entries(patch).map(([path,value]) => [path.replace(".-=", "."),value]));
      const before = Object.fromEntries(Object.keys(after).map(path => [path,foundry.utils.getProperty(data,path) ?? null]));
      return { actor: "target", itemId: id, before, after };
    };
    const placement = [...replaced].map(id => {
      const item = targetActor.items.get(id);
      return step(id, item.toObject(), buildHeldItemWornUpdate(false,item));
    });
    placement.push(step(itemId,sourceItem.toObject(), hands.length
      ? buildHeldItemHandUpdate(hands,sourceItem) : buildHeldItemWornUpdate(true,sourceItem)));
    placement.push({ actor:"target", before:{[flag]:targetActor.getFlag(MODULE_ID,"heroDoll") ?? null}, after:{[flag]:state} });
    return placement;
  }

  async executeAssignItemToSlot(payload, { sender } = {}, mode = "assign") {
    if (!["assign","clear","normalize"].includes(mode)) throw new ItemInstanceError("invalid-mode", "Неизвестное действие куклы героя.");
    if (!isValidHeroDollAssignPayload(payload)) throw new ItemInstanceError("invalid-payload", "Некорректные данные экипировки.");
    const [sourceActorUuid, sourceItemId] = payload.sourceItemUuid.split(".Item.");
    const inventory = this.moduleApi.inventoryService;
    const documents = new ItemInstanceDocuments();
    const authorityId = game.user?.id;
    const assertAuthority = () => {
      if (!isActiveGmClient(game) || game.user.id !== authorityId) throw new ItemInstanceError("active-gm-changed", "Активный мастер изменился. Повторите операцию.");
    };
    const intent = {operationId:payload.operationId,sourceActorUuid,sourceItemId,destinationActorUuid:payload.actorUuid,
      quantity:mode === "assign" ? 1 : null,targetFolderId:null,heroSlotId:payload.slotId,expectedSourceQuantity:null,mode};
    const workflow = new ItemInstanceWorkflow({journal:inventory.mutationJournal,coordinator:this.moduleApi.worldMutationCoordinator,documents});
    return workflow.run(intent, {
      sender, assertAuthority,
      planSource: source => mode === "assign" ? {} : {
        source: mode === "normalize" ? {...source,isEquipped:false,isHeld:false} : source,
        quantity: mode === "normalize" ? source.quantity - 1 : source.quantity,
        sameFolder:false,forHeroSlot:false
      },
      prepareTargetData: (data, source) => {
        if (mode !== "normalize") return;
        for (const [path,value] of Object.entries(buildHeldItemWornUpdate(false,source.sourceItem))) {
          const parts = path.split("."); const key = parts.pop();
          if (key.startsWith("-=")) {
            const parent = foundry.utils.getProperty(data,parts.join("."));
            if (parent) delete parent[key.slice(2)];
          } else foundry.utils.setProperty(data,path,value);
        }
      },
      authorize: (source, request) => this.#authorizeAssignment(source, request, sender),
      preparePlacement: source => {
        if (mode === "normalize") return [];
        if (mode === "clear") {
          const flag = `flags.${MODULE_ID}.heroDoll`;
          const state = this.#normalizeState(source.targetActor);
          for (const [slot,entry] of Object.entries(state.slots)) if (entry.itemId === source.sourceItem.id) delete state.slots[slot];
          const patch = buildHeldItemWornUpdate(false,source.sourceItem);
          const after = Object.fromEntries(Object.entries(patch).map(([path,value])=>[path.replace(".-=","."),value]));
          const before = Object.fromEntries(Object.keys(after).map(path=>[path,foundry.utils.getProperty(source.data,path) ?? null]));
          return [{actor:"target",itemId:source.sourceItem.id,before,after},
            {actor:"target",before:{[flag]:source.targetActor.getFlag(MODULE_ID,"heroDoll") ?? null},after:{[flag]:state}}];
        }
        if (source.plan.kind === "move" && (source.hasContents || source.hasInstalledUpgrades || source.hasIndependentState || source.isEquipped || source.isHeld)) {
          throw new ItemInstanceError("complex-transfer", "Сначала перенесите предмет с индивидуальным состоянием штатным действием склада, затем экипируйте его.");
        }
        return this.#prepareAssignment(source);
      },
      moveWhole: async record => {
        const result = await inventory.executeTakeMutation({inventoryActorId:sourceActorUuid.slice(6),targetActorId:payload.actorUuid.slice(6),
          itemId:sourceItemId,quantity:1,mutationId:`hero-${record.targetData.flags[MODULE_ID].itemInstanceOrigin.id}`});
        if (!result?.createdItemId) throw new ItemInstanceError("manual-review", "Штатный перенос не вернул ID предмета. Нужна сверка.");
        return {itemId:result.createdItemId};
      },
      verifyWhole: async record => {
        const receipt = await inventory.mutationJournal.find(`hero-${record.targetData.flags[MODULE_ID].itemInstanceOrigin.id}`);
        if (!receipt?.terminal || (!receipt.result?.ok || receipt.result.value?.createdItemId !== record.itemId)) throw new ItemInstanceError("manual-review", "Нет подтверждения штатного переноса. Нужна сверка.");
      }
    });
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
