import { MODULE_ID } from "../constants.js";
import { normalizeGroupState } from "./group-context-service.js";

export const FQL_MODULE_ID = "forien-quest-log";

export const REBREYA_QUEST_FLAGS = Object.freeze({
  METADATA: "questLog"
});

const QUEST_STATUS_VALUES = new Set(["active", "available", "completed", "failed", "inactive"]);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isSafeObjectKey(value) {
  return !UNSAFE_OBJECT_KEYS.has(value);
}

function uniqueCleanIds(value = []) {
  const seen = new Set();
  const result = [];

  for (const rawId of asArray(value)) {
    const id = cleanId(rawId);
    if (!id || !isSafeObjectKey(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    result.push(id);
  }

  return result;
}

function getOwnershipLevel(name, fallback) {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.[name] ?? fallback);
}

function getGameUsers() {
  const users = globalThis.game?.users;
  if (!users) {
    return [];
  }

  if (Array.isArray(users.contents)) {
    return users.contents;
  }

  if (typeof users[Symbol.iterator] === "function") {
    return Array.from(users).map((entry) => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
  }

  return [];
}

function userOwnsActor(user, actor) {
  if (!user || !actor || actor.type !== "character") {
    return false;
  }

  if (user.character?.id && user.character.id === actor.id) {
    return true;
  }

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER") === true
      || actor.testUserPermission(user, getOwnershipLevel("OWNER", 3)) === true;
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= getOwnershipLevel("OWNER", 3)
    || Number(ownership.default ?? 0) >= getOwnershipLevel("OWNER", 3);
}

function getQuestEntry(questOrEntry) {
  return questOrEntry?.quest?.entry ?? questOrEntry?.entry ?? questOrEntry ?? null;
}

function getQuestFromEntry(questOrEntry) {
  return questOrEntry?.quest ?? questOrEntry ?? null;
}

function defaultGetFqlApi() {
  return globalThis.game?.modules?.get?.(FQL_MODULE_ID)?.public?.QuestAPI ?? null;
}

function createId(prefix) {
  const randomId = globalThis.foundry?.utils?.randomID?.()
    ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${randomId}`;
}

function normalizeRequirement(value = {}) {
  const source = asObject(value);
  const id = cleanId(source.id);
  const questId = cleanId(source.questId);

  if (!id || !questId) {
    return null;
  }

  const status = cleanId(source.status);

  return {
    id,
    type: cleanId(source.type) || "quest",
    questId,
    title: cleanText(source.title),
    status: QUEST_STATUS_VALUES.has(status) ? status : "completed"
  };
}

function normalizeUnlockReward(value = {}) {
  const source = asObject(value);
  const id = cleanId(source.id);
  const targetQuestId = cleanId(source.targetQuestId);
  const requirementId = cleanId(source.requirementId);

  if (!id || !targetQuestId || !requirementId) {
    return null;
  }

  return {
    id,
    targetQuestId,
    requirementId,
    title: cleanText(source.title)
  };
}

export function normalizeQuestMetadata(value = {}) {
  const source = asObject(value);

  return {
    version: 1,
    groupActorIds: uniqueCleanIds(source.groupActorIds),
    requirements: asArray(source.requirements).map(normalizeRequirement).filter(Boolean),
    unlockRewards: asArray(source.unlockRewards).map(normalizeUnlockReward).filter(Boolean)
  };
}

export class RebreyaQuestLogService {
  constructor({ groupContextService = null, getFqlApi = defaultGetFqlApi, now = Date.now, idFactory = createId } = {}) {
    this.groupContextService = groupContextService;
    this.getFqlApi = getFqlApi;
    this.now = now;
    this.idFactory = idFactory;
  }

  getQuestMetadata(questOrEntry) {
    const entry = getQuestEntry(questOrEntry);
    return normalizeQuestMetadata(
      entry?.getFlag?.(MODULE_ID, REBREYA_QUEST_FLAGS.METADATA)
        ?? entry?.flags?.[MODULE_ID]?.[REBREYA_QUEST_FLAGS.METADATA]
        ?? {}
    );
  }

  async setQuestMetadata(questOrEntry, metadata) {
    const entry = getQuestEntry(questOrEntry);
    if (!entry) {
      throw new Error("FQL quest journal entry is not available.");
    }

    const normalized = normalizeQuestMetadata(metadata);
    if (typeof entry.setFlag === "function") {
      await entry.setFlag(MODULE_ID, REBREYA_QUEST_FLAGS.METADATA, normalized);
    }
    else if (typeof entry.update === "function") {
      await entry.update({
        flags: {
          [MODULE_ID]: {
            [REBREYA_QUEST_FLAGS.METADATA]: normalized
          }
        }
      });
    }
    else {
      entry.flags ??= {};
      entry.flags[MODULE_ID] ??= {};
      entry.flags[MODULE_ID][REBREYA_QUEST_FLAGS.METADATA] = normalized;
    }

    return normalized;
  }

  getCurrentGroupContext() {
    try {
      return this.groupContextService?.resolveForCurrentUser?.() ?? null;
    }
    catch (_error) {
      return null;
    }
  }

  getGroupContext(groupActorId) {
    const groupId = cleanId(groupActorId);
    if (groupId) {
      return this.groupContextService?.resolveForGroup?.(groupId) ?? null;
    }

    return this.getCurrentGroupContext();
  }

  isQuestAssignedToGroup(questOrEntry, groupActorId) {
    const groupId = cleanId(groupActorId);
    if (!groupId) {
      return false;
    }

    return this.getQuestMetadata(questOrEntry).groupActorIds.includes(groupId);
  }

  isQuestVisibleForGroup(questOrEntry, groupActorId, { includeUnassigned = false } = {}) {
    const metadata = this.getQuestMetadata(questOrEntry);
    if (includeUnassigned && metadata.groupActorIds.length === 0) {
      return true;
    }

    return metadata.groupActorIds.includes(cleanId(groupActorId));
  }

  filterQuestEntriesForGroup(entries = [], groupActorId, options = {}) {
    const groupId = cleanId(groupActorId);
    if (!groupId) {
      return asArray(entries);
    }

    return asArray(entries).filter((entry) => this.isQuestVisibleForGroup(entry, groupId, options));
  }

  filterQuestCollectionForGroup(collection, groupActorId, options = {}) {
    const groupId = cleanId(groupActorId);
    if (!groupId || !collection) {
      return collection;
    }

    if (typeof collection.filter === "function") {
      return collection.filter((entry) => this.isQuestVisibleForGroup(entry, groupId, options));
    }

    return this.filterQuestEntriesForGroup(collection, groupId, options);
  }

  filterQuestCollectResult(result, groupActorId, options = {}) {
    const groupId = cleanId(groupActorId);
    if (!groupId || !result) {
      return result;
    }

    if (typeof result.filter === "function" || Array.isArray(result)) {
      return this.filterQuestCollectionForGroup(result, groupId, options);
    }

    const filtered = {};
    for (const [status, collection] of Object.entries(result)) {
      filtered[status] = this.filterQuestCollectionForGroup(collection, groupId, options);
    }
    return filtered;
  }

  getQuest(questId) {
    const id = cleanId(questId);
    const quest = this.getFqlApi()?.DB?.getQuest?.(id) ?? null;
    if (!quest) {
      throw new Error(`FQL quest '${id}' was not found.`);
    }

    return quest;
  }

  getAllQuests() {
    return this.getFqlApi()?.DB?.getAllQuests?.() ?? [];
  }

  getQuestOverlayContext(questId, groupActorId = "") {
    const quest = this.getQuest(questId);
    const groupContext = this.getGroupContext(groupActorId);
    const groupId = groupContext?.groupId ?? "";
    const groupState = normalizeGroupState(groupId, groupContext?.groupState ?? {});
    const metadata = this.getQuestMetadata(quest);
    const quests = this.getAllQuests();
    const questOptions = quests
      .filter((entry) => entry?.id && entry.id !== quest.id)
      .map((entry) => ({
        id: entry.id,
        name: entry.name ?? entry.id,
        status: entry.status ?? ""
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const requirements = groupId
      ? this.evaluateRequirementsForGroupState(quest.id, groupId, groupState).requirements
      : metadata.requirements.map((requirement) => ({
        ...requirement,
        sourceQuestName: this.getFqlApi()?.DB?.getQuest?.(requirement.questId)?.name ?? "",
        sourceStatus: this.getFqlApi()?.DB?.getQuest?.(requirement.questId)?.status ?? "",
        unlocked: false,
        unlock: null,
        satisfied: false
      }));
    const unlockTargets = [];

    for (const targetQuest of quests) {
      const targetMetadata = this.getQuestMetadata(targetQuest);
      for (const requirement of targetMetadata.requirements) {
        unlockTargets.push({
          questId: targetQuest.id,
          questName: targetQuest.name ?? targetQuest.id,
          requirementId: requirement.id,
          title: requirement.title || requirement.id
        });
      }
    }

    const unlocksByQuestId = groupState.questState.unlocksByQuestId;
    const unlockRewards = metadata.unlockRewards.map((reward) => {
      const targetQuest = this.getFqlApi()?.DB?.getQuest?.(reward.targetQuestId) ?? null;
      const targetRequirement = this.getQuestMetadata(targetQuest).requirements
        .find((requirement) => requirement.id === reward.requirementId);

      return {
        ...reward,
        targetQuestName: targetQuest?.name ?? reward.targetQuestId,
        requirementTitle: targetRequirement?.title ?? reward.requirementId,
        applied: Boolean(unlocksByQuestId?.[reward.targetQuestId]?.[reward.requirementId])
      };
    });

    return {
      questId: quest.id,
      questName: quest.name ?? quest.id,
      groupActorId: groupId,
      groupName: groupContext?.groupActor?.name ?? "",
      hasGroupContext: Boolean(groupId),
      assignedGroupIds: metadata.groupActorIds,
      assignedToCurrentGroup: Boolean(groupId && metadata.groupActorIds.includes(groupId)),
      requirements,
      unlockRewards,
      questOptions,
      unlockTargets: unlockTargets.sort((left, right) =>
        `${left.questName} ${left.title}`.localeCompare(`${right.questName} ${right.title}`, "ru")
      )
    };
  }

  getGroupMemberUserIds(groupContext) {
    const members = asArray(groupContext?.members);
    const userIds = new Set();

    for (const user of getGameUsers()) {
      if (!user || user.isGM) {
        continue;
      }

      if (members.some((actor) => userOwnsActor(user, actor))) {
        userIds.add(user.id);
      }
    }

    return Array.from(userIds).sort((left, right) => left.localeCompare(right));
  }

  async assignQuestToGroup(questId, groupActorId) {
    const quest = typeof questId === "string" ? this.getQuest(questId) : questId;
    const context = this.getGroupContext(groupActorId);
    if (!context?.groupId) {
      throw new Error("Rebreya group context is not available.");
    }

    const metadata = this.getQuestMetadata(quest);
    metadata.groupActorIds = uniqueCleanIds([...metadata.groupActorIds, context.groupId]);
    const nextMetadata = await this.setQuestMetadata(quest, metadata);
    await this.updateQuestOwnershipForGroup(quest, context);
    return nextMetadata;
  }

  async updateQuestOwnershipForGroup(questOrEntry, groupContext) {
    const entry = getQuestEntry(questOrEntry);
    if (!entry || typeof entry.update !== "function") {
      return null;
    }

    const ownership = {
      default: getOwnershipLevel("NONE", 0)
    };

    for (const userId of this.getGroupMemberUserIds(groupContext)) {
      ownership[userId] = getOwnershipLevel("OBSERVER", 2);
    }

    await entry.update({ ownership });
    return ownership;
  }

  evaluateRequirements(questId, groupActorId) {
    const context = this.getGroupContext(groupActorId);
    if (!context?.groupId) {
      return {
        questId: cleanId(questId),
        groupActorId: "",
        satisfied: true,
        requirements: []
      };
    }

    return this.evaluateRequirementsForGroupState(questId, context.groupId, context.groupState);
  }

  evaluateRequirementsForGroupState(questId, groupActorId, groupState = {}) {
    const targetQuest = this.getQuest(questId);
    const metadata = this.getQuestMetadata(targetQuest);
    const normalizedState = normalizeGroupState(groupActorId, groupState);
    const unlocks = normalizedState.questState.unlocksByQuestId?.[targetQuest.id] ?? {};

    const requirements = metadata.requirements.map((requirement) => {
      const linkedQuest = this.getFqlApi()?.DB?.getQuest?.(requirement.questId) ?? null;
      const unlocked = Boolean(unlocks[requirement.id]);
      const completedByQuest = requirement.type === "quest" && linkedQuest?.status === requirement.status;

      return {
        ...requirement,
        sourceQuestName: linkedQuest?.name ?? "",
        sourceStatus: linkedQuest?.status ?? "",
        unlocked,
        unlock: unlocks[requirement.id] ?? null,
        satisfied: unlocked || completedByQuest
      };
    });

    return {
      questId: targetQuest.id,
      groupActorId,
      satisfied: requirements.every((requirement) => requirement.satisfied),
      requirements
    };
  }

  async addRequirement(questId, { requiredQuestId, title = "", status = "completed" } = {}) {
    const quest = this.getQuest(questId);
    const requiredQuest = this.getQuest(requiredQuestId);
    const metadata = this.getQuestMetadata(quest);
    const requirement = normalizeRequirement({
      id: this.idFactory("req"),
      type: "quest",
      questId: requiredQuest.id,
      title: title || requiredQuest.name || requiredQuest.id,
      status
    });

    metadata.requirements.push(requirement);
    await this.setQuestMetadata(quest, metadata);
    return requirement;
  }

  async addUnlockReward(sourceQuestId, { targetQuestId, requirementId, title = "" } = {}) {
    const sourceQuest = this.getQuest(sourceQuestId);
    const targetQuest = this.getQuest(targetQuestId);
    const metadata = this.getQuestMetadata(sourceQuest);
    const targetMetadata = this.getQuestMetadata(targetQuest);
    const targetRequirement = targetMetadata.requirements.find((requirement) => requirement.id === cleanId(requirementId));
    if (!targetRequirement) {
      throw new Error("Target requirement was not found.");
    }

    const reward = normalizeUnlockReward({
      id: this.idFactory("reward"),
      targetQuestId: targetQuest.id,
      requirementId: targetRequirement.id,
      title: title || targetRequirement.title || targetQuest.name || targetQuest.id
    });

    metadata.unlockRewards.push(reward);
    await this.setQuestMetadata(sourceQuest, metadata);
    return reward;
  }

  async applyUnlockReward(sourceQuestId, rewardId, { groupActorId = "" } = {}) {
    const sourceQuest = this.getQuest(sourceQuestId);
    const sourceMetadata = this.getQuestMetadata(sourceQuest);
    const reward = sourceMetadata.unlockRewards.find((entry) => entry.id === cleanId(rewardId));
    if (!reward) {
      throw new Error("Unlock reward was not found.");
    }

    const context = this.getGroupContext(groupActorId);
    if (!context?.groupId) {
      throw new Error("Rebreya group context is not available.");
    }

    const registry = this.groupContextService?.getRegistry?.() ?? {
      version: 1,
      activeGroupActorId: context.groupId,
      groupsById: {}
    };
    registry.groupsById ??= {};
    const groupState = normalizeGroupState(context.groupId, registry.groupsById[context.groupId] ?? context.groupState ?? {});
    groupState.questState.unlocksByQuestId[reward.targetQuestId] ??= {};
    groupState.questState.unlocksByQuestId[reward.targetQuestId][reward.requirementId] = {
      unlockedAt: this.now(),
      sourceQuestId: sourceQuest.id,
      sourceRewardId: reward.id
    };
    registry.groupsById[context.groupId] = groupState;
    await this.groupContextService?.setRegistry?.(registry);

    const targetQuest = this.getQuest(reward.targetQuestId);
    const evaluation = this.evaluateRequirementsForGroupState(targetQuest.id, context.groupId, groupState);
    if (evaluation.satisfied && targetQuest.status === "inactive") {
      if (typeof targetQuest.setStatus === "function") {
        await targetQuest.setStatus("available");
      }
      else {
        targetQuest.status = "available";
        await targetQuest.save?.();
      }
    }

    return {
      ...reward,
      groupActorId: context.groupId,
      evaluation
    };
  }

  cloneQuestDataForImport(sourceQuest) {
    const data = clone(typeof sourceQuest?.toJSON === "function" ? sourceQuest.toJSON() : sourceQuest ?? {});
    delete data.id;
    data.name = cleanText(data.name) || sourceQuest?.name || "Imported Quest";
    data.status = "inactive";
    data.parent = null;
    data.subquests = [];
    data.tasks = asArray(data.tasks);
    data.rewards = asArray(data.rewards);
    return data;
  }

  async importQuestIntoParent(sourceQuestId, parentQuestId, { groupActorId = "" } = {}) {
    const fqlApi = this.getFqlApi();
    const sourceQuest = this.getQuest(sourceQuestId);
    const parentQuest = this.getQuest(parentQuestId);
    const parentMetadata = this.getQuestMetadata(parentQuest);
    const fallbackGroupId = parentMetadata.groupActorIds[0] ?? "";
    const context = this.getGroupContext(groupActorId || fallbackGroupId);
    if (!context?.groupId) {
      throw new Error("Rebreya group context is not available.");
    }

    const importedQuest = await fqlApi?.DB?.createQuest?.({
      data: this.cloneQuestDataForImport(sourceQuest),
      parentId: parentQuest.id
    });
    if (!importedQuest?.id) {
      throw new Error("FQL quest import failed.");
    }

    await this.assignQuestToGroup(importedQuest, context.groupId);
    return importedQuest;
  }

  canQuestEnterStatus(questId, targetStatus, groupActorId = "") {
    const status = cleanId(targetStatus);
    if (status !== "active" && status !== "available") {
      return true;
    }

    return this.evaluateRequirements(questId, groupActorId).satisfied;
  }
}
