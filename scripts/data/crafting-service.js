import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

import { DurableMutationJournal } from "../application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";

const CRAFT_BASE_PROGRESS_GOLD_PER_DAY = 5;
const CRAFT_MIN_PROGRESS_GOLD_PER_DAY = 1;
const CRAFT_DEFAULT_MATERIAL_RATIO = 0.5;
const CRAFT_MIN_MATERIAL_LB = 0.1;

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildDefaultCraftState() {
  return {
    version: 1,
    counter: 0,
    queue: []
  };
}

function normalizeCraftMutationJournal(value) {
  return {
    version: 1,
    records: Array.isArray(value?.records)
      ? foundry.utils.deepClone(value.records)
      : []
  };
}

function createMutationId(prefix, requestedId = "") {
  const explicit = String(requestedId ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function quantitiesMatch(left, right) {
  return Math.abs(toNumber(left, 0) - toNumber(right, 0)) <= 1e-9;
}

function cloneValue(value) {
  return value == null ? value : foundry.utils.deepClone(value);
}

function getGearBasePriceGold(gearItem) {
  return Math.max(0.01, toNumber(gearItem?.priceGoldEquivalent, toNumber(gearItem?.priceValue, 0.01)));
}

function buildTaskProgressView(task) {
  const progress = Math.max(0, roundNumber(toNumber(task.progress, 0), 2));
  const target = Math.max(0.01, roundNumber(toNumber(task.progressTarget, 0.01), 2));
  const percent = Math.max(0, Math.min(100, roundNumber((progress / target) * 100, 0)));
  const remaining = Math.max(0, roundNumber(target - progress, 2));
  const daysLeft = Math.max(0, Math.ceil(remaining / Math.max(CRAFT_MIN_PROGRESS_GOLD_PER_DAY, toNumber(task.progressPerDay, CRAFT_MIN_PROGRESS_GOLD_PER_DAY))));
  return {
    progress,
    target,
    percent,
    remaining,
    daysLeft
  };
}

export class CraftingService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this.mutationCoordinator = moduleApi.worldMutationCoordinator ?? new WorldMutationCoordinator();
    this.mutationJournal = new DurableMutationJournal({
      readState: () => game.settings.get(MODULE_ID, SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL),
      writeState: (state) => game.settings.set(MODULE_ID, SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL, state),
      normalizeState: normalizeCraftMutationJournal
    });
  }

  #getState() {
    const state = game.settings.get(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE);
    const nextState = foundry.utils.mergeObject(buildDefaultCraftState(), foundry.utils.deepClone(state ?? {}));
    nextState.counter = Math.max(0, Math.floor(toNumber(nextState.counter, 0)));
    nextState.queue = Array.isArray(nextState.queue) ? nextState.queue : [];
    return nextState;
  }

  async #setState(nextState) {
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.CRAFT_STATE, nextState);
    return nextState;
  }

  #assertCanManageCrafting() {
    const canManageInventory = this.moduleApi.inventoryService?.canManagePartyInventory?.() === true;
    if (!game.user?.isGM && !canManageInventory) {
      throw new Error("Крафтом управляют владельцы партийного склада.");
    }
  }

  #reconciliationError(message) {
    const error = new Error(message);
    error.code = "reconciliation-required";
    return error;
  }

  async #inventoryEntry(sourceType, sourceId) {
    const inventory = await this.moduleApi.getInventorySnapshot({ createActor: true });
    return (inventory.allItems ?? []).find((entry) => (
      entry.sourceType === sourceType && entry.sourceId === sourceId
    )) ?? null;
  }

  async #observeReceipt(receipt) {
    if (!receipt) {
      return { entry: null, quantity: 0 };
    }
    const entry = await this.#inventoryEntry(receipt.sourceType, receipt.sourceId);
    return {
      entry,
      quantity: toNumber(entry?.quantity, 0)
    };
  }

  async #applyReceipt(receipt, operation) {
    if (!receipt || quantitiesMatch(receipt.beforeQuantity, receipt.afterQuantity)) {
      return;
    }
    let observed = await this.#observeReceipt(receipt);
    if (quantitiesMatch(observed.quantity, receipt.afterQuantity)) {
      return;
    }
    if (!quantitiesMatch(observed.quantity, receipt.beforeQuantity)) {
      throw this.#reconciliationError(
        `Craft inventory receipt for ${receipt.sourceType}:${receipt.sourceId} has an unexpected quantity.`
      );
    }

    try {
      await operation(observed.entry);
    }
    catch (error) {
      observed = await this.#observeReceipt(receipt);
      if (quantitiesMatch(observed.quantity, receipt.afterQuantity)) {
        return;
      }
      throw error;
    }

    observed = await this.#observeReceipt(receipt);
    if (!quantitiesMatch(observed.quantity, receipt.afterQuantity)) {
      throw this.#reconciliationError(
        `Craft inventory receipt for ${receipt.sourceType}:${receipt.sourceId} was not observed after mutation.`
      );
    }
  }

  async #restoreReceiptBefore(receipt) {
    if (!receipt || quantitiesMatch(receipt.beforeQuantity, receipt.afterQuantity)) {
      return;
    }
    let observed = await this.#observeReceipt(receipt);
    if (quantitiesMatch(observed.quantity, receipt.beforeQuantity)) {
      return;
    }
    if (!quantitiesMatch(observed.quantity, receipt.afterQuantity)) {
      throw this.#reconciliationError(
        `Craft inventory compensation for ${receipt.sourceType}:${receipt.sourceId} cannot verify its receipt.`
      );
    }

    const itemId = receipt.itemId || observed.entry?.itemId;
    if (receipt.beforeQuantity <= 0 && !receipt.itemId && itemId && typeof this.moduleApi.deleteInventoryItem === "function") {
      await this.moduleApi.deleteInventoryItem(itemId);
    }
    else if (itemId) {
      await this.moduleApi.updateInventoryItemQuantity(itemId, receipt.beforeQuantity);
    }
    else {
      throw this.#reconciliationError("Craft inventory compensation cannot resolve the mutated item.");
    }

    observed = await this.#observeReceipt(receipt);
    if (!quantitiesMatch(observed.quantity, receipt.beforeQuantity)) {
      throw this.#reconciliationError("Craft inventory compensation did not restore the expected quantity.");
    }
  }

  #readTerminalValue(record) {
    if (record?.terminal !== true) {
      return { terminal: false, value: undefined };
    }
    if (record.result?.ok === false) {
      const error = new Error(record.result.error || "Craft mutation was compensated.");
      error.code = record.result.code || "craft-mutation-failed";
      throw error;
    }
    return { terminal: true, value: cloneValue(record.result?.value) };
  }

  async #persistQueuedTask(record) {
    const current = this.#getState();
    if (current.queue.some((task) => task.id === record.task.id)) {
      return;
    }
    if (current.counter !== record.counterBefore) {
      throw this.#reconciliationError("Craft queue counter changed while a task was being prepared.");
    }
    const nextState = cloneValue(current);
    nextState.counter = record.taskCounter;
    nextState.queue.push(cloneValue(record.task));
    try {
      await this.#setState(nextState);
    }
    catch (error) {
      if (this.#getState().queue.some((task) => task.id === record.task.id)) {
        return;
      }
      throw error;
    }
  }

  async #persistQueue(queue) {
    const current = this.#getState();
    const nextState = {
      ...current,
      queue: cloneValue(queue)
    };
    try {
      await this.#setState(nextState);
    }
    catch (error) {
      if (JSON.stringify(this.#getState().queue) === JSON.stringify(nextState.queue)) {
        return;
      }
      throw error;
    }
  }

  async #removeTasks(taskIds) {
    const ids = new Set(taskIds);
    const current = this.#getState();
    if (!current.queue.some((task) => ids.has(task.id))) {
      return;
    }
    const nextState = {
      ...current,
      queue: current.queue.filter((task) => !ids.has(task.id))
    };
    try {
      await this.#setState(nextState);
    }
    catch (error) {
      if (!this.#getState().queue.some((task) => ids.has(task.id))) {
        return;
      }
      throw error;
    }
  }

  #resolveMaterial(model, gearItem) {
    if (gearItem?.predominantMaterialId) {
      return model.materialById?.get(gearItem.predominantMaterialId) ?? null;
    }

    const byName = normalizeText(gearItem?.predominantMaterialName);
    if (!byName) {
      return null;
    }

    return model.materials.find((material) => normalizeText(material.name) === byName) ?? null;
  }

  #resolveCrafter(partySnapshot, crafterActorId) {
    const members = partySnapshot.members ?? [];
    if (!members.length) {
      throw new Error("В группе нет участников для крафта.");
    }

    if (crafterActorId) {
      const match = members.find((member) => member.actorId === crafterActorId);
      if (match) {
        return match;
      }
    }

    return members[0];
  }

  #resolveToolState(crafter, requiredToolId) {
    if (!requiredToolId) {
      return {
        toolId: "",
        toolLabel: "Без инструмента",
        owned: true,
        prof: false,
        mod: 0
      };
    }

    const toolState = (crafter.tools ?? []).find((entry) => entry.toolId === requiredToolId) ?? null;
    return {
      toolId: requiredToolId,
      toolLabel: this.moduleApi.inventoryService.getRebreyaToolLabel(requiredToolId) || requiredToolId,
      owned: Boolean(toolState?.owned),
      prof: Boolean(toolState?.prof),
      mod: toNumber(toolState?.mod, 0)
    };
  }

  #buildCraftableEntries(model, search = "") {
    const normalizedSearch = normalizeText(search);
    return (model.gear ?? [])
      .map((gearItem) => {
        const requiredToolId = this.moduleApi.inventoryService.resolveRebreyaToolId(gearItem.linkedTool);
        const material = this.#resolveMaterial(model, gearItem);
        return {
          id: gearItem.id,
          name: gearItem.name,
          rank: Math.max(0, Math.floor(toNumber(gearItem.rank, 0))),
          priceGold: getGearBasePriceGold(gearItem),
          weight: Math.max(0, roundNumber(toNumber(gearItem.weight, 0), 2)),
          linkedTool: gearItem.linkedTool || "",
          requiredToolId,
          requiredToolLabel: this.moduleApi.inventoryService.getRebreyaToolLabel(requiredToolId) || gearItem.linkedTool || "Без инструмента",
          materialId: material?.id ?? "",
          materialName: material?.name ?? gearItem.predominantMaterialName ?? "",
          materialLbPerUnit: Math.max(CRAFT_MIN_MATERIAL_LB, roundNumber(Math.max(0, toNumber(gearItem.weight, 0)) * CRAFT_DEFAULT_MATERIAL_RATIO, 2)),
          description: gearItem.description || ""
        };
      })
      .filter((entry) => {
        if (!normalizedSearch) {
          return true;
        }

        return normalizeText([
          entry.name,
          entry.requiredToolLabel,
          entry.materialName
        ].join(" ")).includes(normalizedSearch);
      })
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }

  async getSnapshot({ search = "", crafterActorId = "" } = {}) {
    const model = await this.moduleApi.getModel();
    const partySnapshot = await this.moduleApi.getPartySnapshot();
    const craftableEntries = this.#buildCraftableEntries(model, search);
    const crafters = (partySnapshot.members ?? []).map((member) => ({
      actorId: member.actorId,
      actorName: member.actorName,
      actorImg: member.actorImg,
      selected: member.actorId === crafterActorId
    }));
    if (crafters.length && !crafters.some((entry) => entry.selected)) {
      crafters[0].selected = true;
    }

    const queue = this.#getState().queue
      .map((task) => ({
        ...task,
        ...buildTaskProgressView(task)
      }))
      .sort((left, right) => toNumber(left.createdAt, 0) - toNumber(right.createdAt, 0));

    return {
      craftableEntries,
      queue,
      queueCount: queue.length,
      crafters,
      hasCrafters: crafters.length > 0
    };
  }

  queueTask(payload = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#queueTask(payload));
  }

  async #queueTask({ gearId, quantity = 1, crafterActorId = "", mutationId = "" } = {}) {
    this.#assertCanManageCrafting();
    const operationId = createMutationId("craft-queue", mutationId);
    let record = await this.mutationJournal.find(operationId);
    if (!record) {
      const model = await this.moduleApi.getModel();
      const gearItem = model.gearById?.get(gearId) ?? null;
      if (!gearItem) {
        throw new Error("Предмет для крафта не найден.");
      }

      const partySnapshot = await this.moduleApi.getPartySnapshot();
      const crafter = this.#resolveCrafter(partySnapshot, crafterActorId);
      const requiredToolId = this.moduleApi.inventoryService.resolveRebreyaToolId(gearItem.linkedTool);
      const toolState = this.#resolveToolState(crafter, requiredToolId);
      if (requiredToolId && !toolState.owned) {
        throw new Error(`У ${crafter.actorName} нет нужного инструмента: ${toolState.toolLabel}.`);
      }

      const safeQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
      const material = this.#resolveMaterial(model, gearItem);
      const materialPerUnit = Math.max(
        CRAFT_MIN_MATERIAL_LB,
        roundNumber(Math.max(0, toNumber(gearItem.weight, 0)) * CRAFT_DEFAULT_MATERIAL_RATIO, 2)
      );
      const materialNeededLb = roundNumber(materialPerUnit * safeQuantity, 2);
      let materialReceipt = null;
      if (material && materialNeededLb > 0) {
        const materialEntry = await this.#inventoryEntry("material", material.id);
        const available = toNumber(materialEntry?.quantity, 0);
        if (available + 1e-9 < materialNeededLb) {
          throw new Error(`Не хватает материала "${material.name}" (${materialNeededLb} фнт., есть ${roundNumber(available, 2)}).`);
        }
        materialReceipt = {
          sourceType: "material",
          sourceId: material.id,
          itemId: materialEntry?.itemId ?? "",
          beforeQuantity: available,
          afterQuantity: roundNumber(available - materialNeededLb, 2)
        };
      }

      const basePriceGold = getGearBasePriceGold(gearItem);
      const progressTarget = roundNumber(basePriceGold * safeQuantity, 2);
      const progressPerDay = Math.max(
        CRAFT_MIN_PROGRESS_GOLD_PER_DAY,
        roundNumber(
          CRAFT_BASE_PROGRESS_GOLD_PER_DAY
            + toNumber(toolState.mod, 0)
            + (toolState.prof ? 2 : 0),
          2
        )
      );
      const state = this.#getState();
      const taskCounter = state.counter + 1;
      const now = Date.now();
      const task = {
        id: `craft-${taskCounter}`,
        gearId: gearItem.id,
        gearName: gearItem.name,
        quantity: safeQuantity,
        crafterActorId: crafter.actorId,
        crafterName: crafter.actorName,
        requiredToolId,
        requiredToolLabel: toolState.toolLabel,
        materialId: material?.id ?? "",
        materialName: material?.name ?? "",
        materialSpentLb: material ? materialNeededLb : 0,
        progress: 0,
        progressTarget,
        progressPerDay,
        createdAt: now,
        updatedAt: now
      };
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "queue",
        phase: "prepared",
        counterBefore: state.counter,
        taskCounter,
        task,
        materialReceipt
      });
    }

    const terminal = this.#readTerminalValue(record);
    if (terminal.terminal) {
      return terminal.value;
    }

    if (record.phase === "prepared") {
      try {
        await this.#applyReceipt(record.materialReceipt, (entry) => this.moduleApi.updateInventoryItemQuantity(
          record.materialReceipt.itemId || entry?.itemId,
          record.materialReceipt.afterQuantity
        ));
        record = await this.mutationJournal.checkpoint(
          operationId,
          "prepared",
          "materials-debited"
        );
      }
      catch (error) {
        await this.#restoreReceiptBefore(record.materialReceipt);
        try {
          record = await this.mutationJournal.checkpoint(operationId, "prepared", "compensated", {
            failure: { code: error.code ?? "craft-queue-failed", message: error.message }
          });
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code ?? "craft-queue-failed",
            error: error.message
          });
        }
        catch {
          // The original mutation error remains the most useful failure to the caller.
        }
        throw error;
      }
    }

    if (record.phase === "materials-debited") {
      try {
        await this.#persistQueuedTask(record);
      }
      catch (error) {
        try {
          await this.#restoreReceiptBefore(record.materialReceipt);
          record = await this.mutationJournal.checkpoint(operationId, "materials-debited", "compensated", {
            failure: { code: error.code ?? "craft-state-write-failed", message: error.message }
          });
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code ?? "craft-state-write-failed",
            error: error.message
          });
        }
        catch (compensationError) {
          try {
            await this.mutationJournal.checkpoint(operationId, "materials-debited", "reconciliation-required", {
              failure: { code: error.code ?? "craft-state-write-failed", message: error.message },
              compensationFailure: {
                code: compensationError.code ?? "craft-compensation-failed",
                message: compensationError.message
              }
            });
          }
          catch {
            // Preserve both failures below even if the journal is also unavailable.
          }
          throw new AggregateError([error, compensationError], "Craft task persistence and material compensation failed.");
        }
        throw error;
      }
      record = await this.mutationJournal.checkpoint(operationId, "materials-debited", "task-persisted");
    }

    if (record.phase === "task-persisted") {
      record = await this.mutationJournal.checkpoint(operationId, "task-persisted", "committed");
    }
    const value = {
      ...cloneValue(record.task),
      ...buildTaskProgressView(record.task)
    };
    await this.mutationJournal.finish(operationId, { ok: true, value });
    return cloneValue(value);
  }

  cancelTask(taskId, options = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#cancelTask(taskId, options));
  }

  async #cancelTask(taskId, { mutationId = "" } = {}) {
    this.#assertCanManageCrafting();
    const safeTaskId = String(taskId ?? "").trim();
    if (!safeTaskId) {
      return false;
    }
    const operationId = createMutationId(`craft-cancel-${safeTaskId}`, mutationId || `craft-cancel:${safeTaskId}`);
    let record = await this.mutationJournal.find(operationId);
    if (!record) {
      const task = this.#getState().queue.find((entry) => entry.id === safeTaskId) ?? null;
      if (!task) {
        return false;
      }
      let materialReceipt = null;
      if (task.materialId && toNumber(task.materialSpentLb, 0) > 0) {
        const entry = await this.#inventoryEntry("material", task.materialId);
        const beforeQuantity = toNumber(entry?.quantity, 0);
        materialReceipt = {
          sourceType: "material",
          sourceId: task.materialId,
          itemId: entry?.itemId ?? "",
          beforeQuantity,
          afterQuantity: roundNumber(beforeQuantity + toNumber(task.materialSpentLb, 0), 2)
        };
      }
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "cancel",
        phase: "prepared",
        task: cloneValue(task),
        materialReceipt
      });
    }

    const terminal = this.#readTerminalValue(record);
    if (terminal.terminal) {
      return terminal.value === true;
    }
    if (record.phase === "prepared") {
      await this.#applyReceipt(record.materialReceipt, () => this.moduleApi.addModelItemToInventory(
        "material",
        record.materialReceipt.sourceId,
        record.materialReceipt.afterQuantity - record.materialReceipt.beforeQuantity
      ));
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "materials-debited");
    }
    if (record.phase === "materials-debited") {
      await this.#removeTasks([record.task.id]);
      record = await this.mutationJournal.checkpoint(operationId, "materials-debited", "task-persisted");
    }
    if (record.phase === "task-persisted") {
      record = await this.mutationJournal.checkpoint(operationId, "task-persisted", "committed");
    }
    await this.mutationJournal.finish(operationId, { ok: true, value: true });
    return true;
  }

  processOneDay(options = {}) {
    return this.mutationCoordinator.run("crafting", () => this.#processOneDay(options));
  }

  async #processOneDay({ mutationId = "" } = {}) {
    this.#assertCanManageCrafting();
    const operationId = createMutationId("craft-day", mutationId);
    let record = await this.mutationJournal.find(operationId);
    if (!record) {
      const tasks = this.#getState().queue;
      const completed = [];
      const nextQueue = [];
      const now = Date.now();
      for (const task of tasks) {
        const progressPerDay = Math.max(
          CRAFT_MIN_PROGRESS_GOLD_PER_DAY,
          toNumber(task.progressPerDay, CRAFT_MIN_PROGRESS_GOLD_PER_DAY)
        );
        const target = Math.max(0, toNumber(task.progressTarget, 0));
        const nextProgress = Math.min(target, roundNumber(toNumber(task.progress, 0) + progressPerDay, 2));
        const nextTask = {
          ...task,
          progress: nextProgress,
          updatedAt: now
        };
        nextQueue.push(nextTask);
        if (nextProgress + 1e-9 >= target) {
          completed.push({
            ...nextTask,
            ...buildTaskProgressView(nextTask)
          });
        }
      }

      const inventory = await this.moduleApi.getInventorySnapshot({ createActor: true });
      const quantities = new Map();
      const entries = new Map();
      for (const entry of inventory.allItems ?? []) {
        const key = `${entry.sourceType}:${entry.sourceId}`;
        quantities.set(key, toNumber(entry.quantity, 0));
        entries.set(key, entry);
      }
      const outputReceipts = completed.map((task) => {
        const key = `gear:${task.gearId}`;
        const beforeQuantity = quantities.get(key) ?? 0;
        const afterQuantity = beforeQuantity + toNumber(task.quantity, 0);
        quantities.set(key, afterQuantity);
        return {
          taskId: task.id,
          sourceType: "gear",
          sourceId: task.gearId,
          itemId: entries.get(key)?.itemId ?? "",
          beforeQuantity,
          afterQuantity
        };
      });
      const result = {
        completed,
        completedCount: completed.length
      };
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "process-day",
        phase: "prepared",
        nextQueue,
        completedTaskIds: completed.map((task) => task.id),
        outputReceipts,
        result
      });
    }

    const terminal = this.#readTerminalValue(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (record.phase === "prepared") {
      await this.#persistQueue(record.nextQueue);
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "task-persisted");
    }
    if (record.phase === "task-persisted") {
      for (const receipt of record.outputReceipts ?? []) {
        await this.#applyReceipt(receipt, () => this.moduleApi.addModelItemToInventory(
          "gear",
          receipt.sourceId,
          receipt.afterQuantity - receipt.beforeQuantity
        ));
      }
      record = await this.mutationJournal.checkpoint(operationId, "task-persisted", "output-created");
    }
    if (record.phase === "output-created") {
      await this.#removeTasks(record.completedTaskIds ?? []);
      record = await this.mutationJournal.checkpoint(operationId, "output-created", "committed");
    }
    await this.mutationJournal.finish(operationId, { ok: true, value: record.result });
    return cloneValue(record.result);
  }
}
