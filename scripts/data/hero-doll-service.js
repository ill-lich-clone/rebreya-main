import { MODULE_ID, REBREYA_GROUP_FLAGS } from "../constants.js";
import { getHeroDollBackSlots, getHeroDollSlots, inferHeroDollSlotsFromName, normalizeHeroDollSlots } from "./item-classification.js?v=1.4.338-hero-doll-menu";

import { ItemInstanceWorkflow, itemInstanceFingerprint } from "../application/item-instance-workflow.js?v=1.4.368-hero-performance";
import { ItemInstanceDocuments } from "../infrastructure/foundry/item-instance-documents.js?v=1.4.368-hero-performance";
import { ItemInstanceError, planItemInstanceMutation } from "./item-instance-rules.js";
import { normalizeHeroDollPresets, captureHeroDollPresetSlots, heroDollPresetModified } from "./hero-doll-presets.js?v=1.4.364-hero-presets";
import { isInventoryGraphItem } from "../application/inventory-graph-transfer.js?v=1.4.280";
import { captureRuntimeItemGraph, buildRuntimeGraphDocuments } from "./runtime-item-graph.js?v=1.4.267-native-schema";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { buildHeldItemWornUpdate, getItemHeldHands } from "../integrations/held-items.js";

export const HERO_DOLL_ASSIGN_COMMAND = "hero-doll.assign";
export const HERO_DOLL_NORMALIZE_COMMAND = "hero-doll.normalize-stack";
export const HERO_DOLL_CLEAR_COMMAND = "hero-doll.clear";
export const HERO_DOLL_PRESET_COMMAND = "hero-doll.preset";
export function isValidHeroDollPresetPayload(payload) {
  const fields = {create:["name","presetId"],save:["presetId"],rename:["name","presetId"],delete:["presetId"],apply:["expectedFingerprint","presetId"],"clear-ghost":["slotId"]}[payload?.action];
  const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  return Boolean(fields && payload && Object.keys(payload).sort().join(",") === ["action","actorUuid","operationId",...fields].sort().join(",")
    && typeof payload.actorUuid === "string" && /^Actor\.[A-Za-z0-9_-]+$/.test(payload.actorUuid) && id(payload.operationId)
    && (!fields.includes("presetId") || id(payload.presetId))
    && (!fields.includes("name") || (typeof payload.name === "string" && payload.name.trim().length > 0 && payload.name.length <= 128))
    && (!fields.includes("slotId") || HERO_DOLL_SLOTS.some(slot=>slot.id===payload.slotId))
    && (!fields.includes("expectedFingerprint") || (typeof payload.expectedFingerprint === "string" && payload.expectedFingerprint.length > 0 && payload.expectedFingerprint.length <= 100000)));
}
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

function buildHeroDollEquippedUpdate(item, equipped) {
  return {
    "system.equipped": equipped === true || getItemHeldHands(item).length > 0
  };
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
    this.pendingPresets = new Map();
    this.selectedPresets = new Map();
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
      const compatible = new Set(explicit);
      if (compatible.has("ring1") && compatible.has("ring2")) compatible.add("ring3");
      const backSlots = getHeroDollBackSlots();
      if (backSlots.slice(0, 5).every((slotId) => compatible.has(slotId))) {
        for (const slotId of backSlots.slice(5)) compatible.add(slotId);
      }
      return [...compatible];
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
        return normalizeHeroDollSlots("ring");
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
    const presetState = normalizeHeroDollPresets(actor.getFlag(MODULE_ID, "heroDollPresets"));
    const occupiedItemIds = Object.values(state.slots).map((slotState) => slotState.itemId);
    const occupiedItemIdSet = new Set(occupiedItemIds);
    const occupiedSlotsByItemId = new Map();
    const slots = HERO_DOLL_SLOTS.map((slot) => {
      const itemId = state.slots[slot.id]?.itemId ?? "";
      const item = itemId ? actor.items.get(itemId) ?? null : null;
      const ghost = !item ? presetState.ghosts[slot.id] : null;

      if (item) {
        occupiedSlotsByItemId.set(item.id, slot);
      }

      return {
        ...slot,
        occupied: Boolean(item),
        ghost: Boolean(ghost),
        legacyStack: Boolean(item && item.system.quantity > 1),
        itemId: item?.id ?? "",
        itemUuid: item?.uuid ?? "",
        itemName: item?.name ?? ghost?.name ?? "",
        itemImg: item?.img ?? ghost?.img ?? "",
        itemMeta: item ? this.#buildItemMeta(item) : "",
        title: item ? `${slot.label}: ${item.name}` : ghost ? `${ghost.name} — предмет отсутствует` : `${slot.label}: пусто`
      };
    });
    const inventoryItems = this.#getInventoryItems(actor, occupiedSlotsByItemId);

    return {
      actorId: actor.id,
      actorName: actor.name,
      presets: presetState.presets.map(preset=>({id:preset.id,name:preset.name,
        selected:preset.id===(presetState.presets.some(entry=>entry.id===this.selectedPresets.get(actor.uuid))?this.selectedPresets.get(actor.uuid):presetState.activePresetId)})),
      selectedPresetId: this.selectedPresets.get(actor.uuid) && presetState.presets.some(preset=>preset.id===this.selectedPresets.get(actor.uuid))
        ? this.selectedPresets.get(actor.uuid) : presetState.activePresetId,
      activePresetId: presetState.activePresetId,
      presetModified: heroDollPresetModified(actor, actor.getFlag(MODULE_ID,"heroDoll") ?? state, presetState),
      canEditPresets: actor.isOwner === true || game.user?.isGM === true,
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
    if (normalizeHeroDollPresets(actor.getFlag(MODULE_ID,"heroDollPresets")).ghosts[slotId]) return this.clearGhost(actor,slotId);
    const itemId = this.#normalizeState(actor).slots[slotId]?.itemId;
    if (!itemId) return false;
    await this.#submitAssignment(actor, slotId, {uuid:`${actor.uuid}.Item.${itemId}`}, "clear");
    return true;
  }

  prepareDisarmPlacement(actor, item) {
    const slots = actor.getFlag(MODULE_ID, "heroDoll")?.slots ?? {};
    return Object.entries(slots).filter(([, value]) => value?.itemId === item.id).map(([slot, value]) => ({
      path: `flags.${MODULE_ID}.heroDoll.slots.${slot}`, before: foundry.utils.deepClone(value), after: null
    }));
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
    if (!(targetActor instanceof Actor) || !["character", "npc"].includes(targetActor.type) || !owns(targetActor)) {
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
  }

  #prepareAssignment({ sourceItem, targetActor, intent, plan, itemId }) {
    const flag = `flags.${MODULE_ID}.heroDoll`;
    const state = this.#normalizeState(targetActor);
    const slots = [intent.heroSlotId];
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
      return step(id, item.toObject(), buildHeroDollEquippedUpdate(item, false));
    });
    const beforeAssignment = plan.kind === "move" && isInventoryGraphItem(sourceItem.parent, sourceItem)
      ? buildRuntimeGraphDocuments(captureRuntimeItemGraph(sourceItem.parent, sourceItem), "hero-placement-preview", sourceItem.toObject(), { actorId: targetActor.id }).documents[0]
      : sourceItem.toObject();
    placement.push(step(itemId, beforeAssignment, buildHeroDollEquippedUpdate(sourceItem, true)));
    placement.push({ actor:"target", before:{[flag]:targetActor.getFlag(MODULE_ID,"heroDoll") ?? null}, after:{[flag]:state} });
    const presetState = normalizeHeroDollPresets(targetActor.getFlag(MODULE_ID,"heroDollPresets"));
    if (presetState.ghosts[intent.heroSlotId]) {
      delete presetState.ghosts[intent.heroSlotId];
      const path = `flags.${MODULE_ID}.heroDollPresets`;
      placement.push({actor:"target",before:{[path]:targetActor.getFlag(MODULE_ID,"heroDollPresets")},after:{[path]:presetState}});
    }
    return placement;
  }

  selectPreset(actor, presetId) { this.selectedPresets.set(actor.uuid, String(presetId ?? "")); }
  createPreset(actor, name) { return this.#submitPreset(actor,"create",{name,presetId:crypto.randomUUID()}); }
  savePreset(actor, presetId) { return this.#submitPreset(actor,"save",{presetId}); }
  renamePreset(actor, presetId, name) { return this.#submitPreset(actor,"rename",{presetId,name}); }
  deletePreset(actor, presetId) { return this.#submitPreset(actor,"delete",{presetId}); }
  clearGhost(actor, slotId) { return this.#submitPreset(actor,"clear-ghost",{slotId}); }
  applyPreset(actor, presetId) { return this.#submitPreset(actor,"apply",{presetId}); }

  async #submitPreset(actor, action, fields) {
    // New create IDs must also survive an ambiguous retry.
    const key = itemInstanceFingerprint({actorUuid:actor?.uuid,action,...fields,...(action==="create"?{presetId:null}:{})});
    let payload = this.pendingPresets.get(key);
    if (!payload && [...this.pendingPresets.values()].some(entry=>entry.actorUuid===actor?.uuid)) {
      throw new ItemInstanceError("pending-instance-operation","Сначала повторите или сверьте незавершённое изменение комплекта.");
    }
    if (!payload) {
      payload = {actorUuid:actor?.uuid,operationId:crypto.randomUUID(),action,...fields};
      if (action === "apply") {
        const preset = normalizeHeroDollPresets(actor.getFlag(MODULE_ID,"heroDollPresets")).presets.find(entry=>entry.id===fields.presetId);
        payload.expectedFingerprint = itemInstanceFingerprint(preset) ?? "missing";
      }
      this.pendingPresets.set(key,payload);
    }
    try {
      const result = await this.moduleApi.mutateHeroDollPreset(payload);
      this.pendingPresets.delete(key);
      if (["create","save","apply"].includes(action)) this.selectPreset(actor,result.presetId);
      return result;
    } catch (error) {
      if (!["request-timeout","ambiguous-outcome","active-gm-changed","manual-review","pending-instance-operation"].includes(error?.code)) this.pendingPresets.delete(key);
      throw error;
    }
  }

  async executePresetMutation(payload, {sender} = {}) {
    if (!isValidHeroDollPresetPayload(payload)) throw new ItemInstanceError("invalid-payload","Некорректные данные комплекта.");
    const documents = new ItemInstanceDocuments(), authorityId = game.user?.id;
    const assertAuthority = () => {
      if (!isActiveGmClient(game) || game.user.id !== authorityId) throw new ItemInstanceError("active-gm-changed","Активный мастер изменился. Повторите операцию.");
    };
    const intent = {operationId:payload.operationId,mode:"hero-preset",sourceActorUuid:payload.actorUuid,destinationActorUuid:payload.actorUuid,payload};
    const workflow = new ItemInstanceWorkflow({documents,journal:this.moduleApi.inventoryService.mutationJournal,coordinator:this.moduleApi.worldMutationCoordinator});
    return workflow.runBatch(intent,{sender,assertAuthority,suppressItemRenders:true,
      authorize: ({targetActor}) => {
        if (!(targetActor instanceof Actor) || !["character", "npc"].includes(targetActor.type) || !(sender?.isGM || targetActor.testUserPermission(sender,"OWNER"))) {
          throw new ItemInstanceError("unauthorized","Недостаточно прав для изменения комплекта героя.");
        }
      },
      prepareBatch: (actors, operation) => this.#preparePresetMutation(actors,operation,documents)
    });
  }

  async #preparePresetMutation(actors, operation, documents) {
    const {targetActor:actor} = actors, {intent} = operation, payload = intent.payload;
    const presetPath = `flags.${MODULE_ID}.heroDollPresets`, dollPath = `flags.${MODULE_ID}.heroDoll.slots`;
    const raw = actor.getFlag(MODULE_ID,"heroDollPresets") ?? null;
    const state = normalizeHeroDollPresets(raw), doll = this.#normalizeState(actor);
    const preset = state.presets.find(entry=>entry.id===payload.presetId);
    const steps = [], placement = [], actorBefore = {}, actorAfter = {};
    if (!["create","clear-ghost"].includes(payload.action) && !preset) throw new ItemInstanceError("preset-not-found","Комплект больше не существует.");
    if (["create","rename"].includes(payload.action)) {
      if (state.presets.some(entry=>entry.id!==payload.presetId && entry.name.toLocaleLowerCase()===payload.name.trim().toLocaleLowerCase())) {
        throw new ItemInstanceError("duplicate-name","Комплект с таким именем уже существует.");
      }
    }
    switch (payload.action) {
      case "create":
        if (preset) throw new ItemInstanceError("operation-conflict","Комплект с таким ID уже существует.");
        state.presets.push({id:payload.presetId,name:payload.name.trim(),slots:captureHeroDollPresetSlots(actor,doll,state)});
        state.activePresetId=payload.presetId;break;
      case "save": preset.slots=captureHeroDollPresetSlots(actor,doll,state);state.activePresetId=preset.id;break;
      case "rename": preset.name=payload.name.trim();break;
      case "delete": state.presets=state.presets.filter(entry=>entry.id!==preset.id);if(state.activePresetId===preset.id)state.activePresetId="";break;
      case "clear-ghost": delete state.ghosts[payload.slotId];break;
      case "apply": {
        const saved = raw?.presets?.find(entry=>entry.id===payload.presetId);
        if (!saved?.slots || typeof saved.slots !== "object" || Array.isArray(saved.slots)
          || Object.entries(saved.slots).some(([slot,entry])=>!HERO_DOLL_SLOTS.some(known=>known.id===slot)
            || !entry || typeof entry.itemId!=="string" || !entry.itemId)) {
          throw new ItemInstanceError("invalid-preset","Комплект содержит некорректные слоты или ссылки на предметы.");
        }
        if (itemInstanceFingerprint(preset)!==payload.expectedFingerprint) throw new ItemInstanceError("stale-preset","Комплект изменился. Обновите лист и повторите переключение.");
        const nextSlots = {}, ghosts = {}, seen = new Set();
        for (const [slotId,entry] of Object.entries(preset.slots)) {
          if (seen.has(entry.itemId)) throw new ItemInstanceError("duplicate-instance","Один экземпляр нельзя назначить в несколько слотов комплекта.");
          seen.add(entry.itemId);
          const item = actor.items.get(entry.itemId);
          if (!item) {ghosts[slotId]=structuredClone(entry);continue;}
          if (!this.#getItemAllowedSlots(item).includes(slotId)) throw new ItemInstanceError("invalid-slot",`${item.name}: предмет больше не подходит этому слоту.`);
          const childIntent = {operationId:payload.operationId,mode:"normalize",sourceActorUuid:actor.uuid,destinationActorUuid:actor.uuid,
            sourceItemId:item.id,targetFolderId:null,heroSlotId:null,expectedSourceQuantity:null,quantity:item.system.quantity>1?item.system.quantity-1:item.system.quantity};
          const source = await documents.readSource(childIntent,actors);
          if (source.quantity>1) {
            const plan = planItemInstanceMutation({source:{...source,isEquipped:false,isHeld:false},quantity:source.quantity-1,sameActor:true,sameFolder:false,forHeroSlot:false});
            const prepared = await documents.prepare(childIntent,plan,source,{
              preparePlacement:()=>[],prepareTargetData:(data)=>{
                for (const [path,value] of Object.entries(buildHeldItemWornUpdate(false,item))) {
                  const parts=path.split("."),leaf=parts.pop(),parent=foundry.utils.getProperty(data,parts.join("."));
                  if (leaf.startsWith("-=")) {if(parent)delete parent[leaf.slice(2)];}
                  else foundry.utils.setProperty(data,path,value);
                }
              }
            },{id:`${operation.id}:${item.id}`,fingerprint:operation.fingerprint});
            steps.push({...prepared,intent:childIntent,plan});
          } else {
            planItemInstanceMutation({source,quantity:1,sameActor:true,sameFolder:false,forHeroSlot:true});
          }
          nextSlots[slotId]={itemId:item.id};
        }
        const equipped = new Set(Object.values(nextSlots).map(entry=>entry.itemId));
        const touched = new Set([...Object.values(doll.slots).map(entry=>entry.itemId),...equipped]);
        for (const itemId of touched) {
          const item=actor.items.get(itemId);if(!item)continue;
          const after=buildHeroDollEquippedUpdate(item,equipped.has(itemId));
          placement.push({actor:"target",itemId,before:{"system.equipped":item.system.equipped ?? null},after});
        }
        actorBefore[dollPath]=actor.getFlag(MODULE_ID,"heroDoll")?.slots ?? null;
        actorAfter[dollPath]=nextSlots;
        state.ghosts=ghosts;state.activePresetId=preset.id;break;
      }
    }
    actorBefore[presetPath]=raw;actorAfter[presetPath]=state;
    placement.push({actor:"target",before:actorBefore,after:actorAfter});
    steps.push({intent,plan:{kind:"placement",preserveSourceId:true},placement});
    return {steps,value:{presetId:payload.presetId ?? state.activePresetId}};
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
          const patch = buildHeroDollEquippedUpdate(source.sourceItem, false);
          const after = Object.fromEntries(Object.entries(patch).map(([path,value])=>[path.replace(".-=","."),value]));
          const before = Object.fromEntries(Object.keys(after).map(path=>[path,foundry.utils.getProperty(source.data,path) ?? null]));
          return [{actor:"target",itemId:source.sourceItem.id,before,after},
            {actor:"target",before:{[flag]:source.targetActor.getFlag(MODULE_ID,"heroDoll") ?? null},after:{[flag]:state}}];
        }
        if (source.plan.kind === "move" && (source.isEquipped || source.isHeld)) {
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
