import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

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

  async #writeState(mutator) {
    if (!game.user?.isGM) {
      throw new Error("Управлять крафтом может только ГМ.");
    }

    const state = this.#getState();
    const result = await mutator(state);
    await this.#setState(state);
    return result;
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

  async queueTask({ gearId, quantity = 1, crafterActorId = "" } = {}) {
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
    if (material && materialNeededLb > 0) {
      const inventory = await this.moduleApi.getInventorySnapshot({ createActor: true });
      const materialEntry = (inventory.allItems ?? []).find((entry) => (
        entry.sourceType === "material" && entry.sourceId === material.id
      )) ?? null;
      const available = toNumber(materialEntry?.quantity, 0);
      if (available + 1e-9 < materialNeededLb) {
        throw new Error(`Не хватает материала "${material.name}" (${materialNeededLb} фнт., есть ${roundNumber(available, 2)}).`);
      }

      await this.moduleApi.updateInventoryItemQuantity(materialEntry.itemId, roundNumber(available - materialNeededLb, 2));
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
    const now = Date.now();

    return this.#writeState((state) => {
      state.counter += 1;
      const task = {
        id: `craft-${state.counter}`,
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
      state.queue.push(task);
      return {
        ...task,
        ...buildTaskProgressView(task)
      };
    });
  }

  async cancelTask(taskId) {
    if (!taskId) {
      return false;
    }

    const cancelledTask = await this.#writeState((state) => {
      const index = state.queue.findIndex((entry) => entry.id === taskId);
      if (index === -1) {
        return null;
      }

      const [task] = state.queue.splice(index, 1);
      return task ?? null;
    });

    if (!cancelledTask) {
      return false;
    }

    if (cancelledTask.materialId && cancelledTask.materialSpentLb > 0) {
      await this.moduleApi.addModelItemToInventory("material", cancelledTask.materialId, cancelledTask.materialSpentLb);
    }

    return true;
  }

  async processOneDay() {
    const completed = [];
    const tasks = this.#getState().queue;
    if (!tasks.length) {
      return {
        completed,
        completedCount: 0
      };
    }

    await this.#writeState((state) => {
      const nextQueue = [];
      const now = Date.now();
      for (const task of state.queue) {
        const progressPerDay = Math.max(CRAFT_MIN_PROGRESS_GOLD_PER_DAY, toNumber(task.progressPerDay, CRAFT_MIN_PROGRESS_GOLD_PER_DAY));
        const nextProgress = roundNumber(toNumber(task.progress, 0) + progressPerDay, 2);
        const nextTask = {
          ...task,
          progress: nextProgress,
          updatedAt: now
        };

        if (nextProgress + 1e-9 >= toNumber(task.progressTarget, 0)) {
          completed.push({
            ...nextTask,
            ...buildTaskProgressView({
              ...nextTask,
              progress: toNumber(task.progressTarget, nextProgress)
            })
          });
          continue;
        }

        nextQueue.push(nextTask);
      }

      state.queue = nextQueue;
    });

    for (const task of completed) {
      await this.moduleApi.addModelItemToInventory("gear", task.gearId, task.quantity);
    }

    return {
      completed,
      completedCount: completed.length
    };
  }
}
