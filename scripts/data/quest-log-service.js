import { MODULE_ID } from "../constants.js";
import { normalizeGroupState, normalizeQuestState } from "./group-context-service.js";

export const FQL_MODULE_ID = "forien-quest-log";

export const REBREYA_QUEST_FLAGS = Object.freeze({
  METADATA: "questLog"
});

const QUEST_STATUS_VALUES = new Set(["active", "available", "completed", "failed", "inactive"]);
const REQUIREMENT_TYPES = new Set(["quest", "level", "item"]);
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const REQUIREMENT_TYPE_OPTIONS = Object.freeze([
  {
    value: "quest",
    label: "Задание"
  },
  {
    value: "level",
    label: "Уровень группы"
  },
  {
    value: "item",
    label: "Предмет у участника"
  }
]);
const REQUIREMENT_STATUS_OPTIONS = Object.freeze([
  {
    value: "completed",
    label: "Завершить"
  },
  {
    value: "failed",
    label: "Провалить"
  },
  {
    value: "available",
    label: "Сделать доступным"
  },
  {
    value: "active",
    label: "Активировать"
  },
  {
    value: "inactive",
    label: "Оставить неактивным"
  }
]);

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

function cleanRequirementType(value) {
  const type = cleanId(value) || "quest";
  return REQUIREMENT_TYPES.has(type) ? type : "quest";
}

function toPositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function collectionValues(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (Array.isArray(value.contents)) {
    return value.contents.filter(Boolean);
  }

  if (typeof value.values === "function") {
    return Array.from(value.values()).filter(Boolean);
  }

  if (typeof value[Symbol.iterator] === "function") {
    return Array.from(value).map((entry) => Array.isArray(entry) ? entry[1] : entry).filter(Boolean);
  }

  return Object.values(value).filter(Boolean);
}

function getActorLevel(actor) {
  const system = actor?.system ?? {};
  const candidates = [
    system.details?.level,
    system.attributes?.level,
    system.level,
    actor?.level
  ];
  const directLevel = candidates.map(Number).find((level) => Number.isFinite(level) && level > 0);
  if (directLevel) {
    return directLevel;
  }

  const classLevels = collectionValues(actor?.items)
    .filter((item) => item?.type === "class" || item?.type === "subclass")
    .map((item) => Number(item?.system?.levels ?? item?.system?.level ?? 0))
    .filter((level) => Number.isFinite(level) && level > 0);

  return classLevels.reduce((sum, level) => sum + level, 0);
}

function getAverageGroupLevel(members = []) {
  const levels = asArray(members)
    .map(getActorLevel)
    .filter((level) => Number.isFinite(level) && level > 0);

  if (levels.length === 0) {
    return 0;
  }

  const total = levels.reduce((sum, level) => sum + level, 0);
  return Math.floor(total / levels.length);
}

function getActorItems(actor) {
  return collectionValues(actor?.items).map((item) => ({
    id: cleanId(item?.id),
    name: cleanText(item?.name),
    actorId: cleanId(actor?.id),
    actorName: cleanText(actor?.name)
  })).filter((item) => item.id || item.name);
}

function buildGroupItemOptions(members = []) {
  const seen = new Set();
  const options = [];

  for (const actor of asArray(members)) {
    for (const item of getActorItems(actor)) {
      const key = `${item.id}::${item.name}`.toLocaleLowerCase("ru");
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      options.push({
        id: item.id,
        value: item.name || item.id,
        name: item.name || item.id,
        actorId: item.actorId,
        actorName: item.actorName
      });
    }
  }

  return options.sort((left, right) =>
    `${left.name} ${left.actorName}`.localeCompare(`${right.name} ${right.actorName}`, "ru")
  );
}

function buildRequirementItemOptions(groupItemOptions = [], requirement = {}) {
  const selectedValue = cleanText(requirement.itemName) || cleanId(requirement.itemId);
  const options = [...groupItemOptions];
  const hasSelectedOption = !selectedValue || options.some((option) =>
    option.value === selectedValue || option.id === selectedValue
  );

  if (!hasSelectedOption) {
    options.push({
      id: cleanId(requirement.itemId),
      value: selectedValue,
      name: selectedValue,
      actorId: "",
      actorName: ""
    });
  }

  return buildSelectedOptions(options, selectedValue);
}

function findGroupItem(members = [], requirement = {}) {
  const itemId = cleanId(requirement.itemId);
  const itemName = cleanText(requirement.itemName).toLocaleLowerCase("ru");

  for (const actor of asArray(members)) {
    for (const item of getActorItems(actor)) {
      const matchesId = itemId && item.id === itemId;
      const matchesName = itemName && item.name.toLocaleLowerCase("ru") === itemName;
      if (matchesId || matchesName) {
        return item;
      }
    }
  }

  return null;
}

function isPlaceholderNewQuest(quest) {
  const name = cleanText(quest?.name).toLocaleLowerCase("ru");
  const status = cleanId(quest?.status);
  if (status !== "inactive" || !["новое задание", "new quest"].includes(name)) {
    return false;
  }

  const hasContent = asArray(quest?.tasks).length > 0
    || asArray(quest?.subquests).length > 0
    || asArray(quest?.rewards).length > 0
    || Boolean(quest?.parent);

  return !hasContent;
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
  const type = cleanRequirementType(source.type);
  const questId = cleanId(source.questId);

  if (!id) {
    return null;
  }

  const status = cleanId(source.status);
  const normalizedStatus = QUEST_STATUS_VALUES.has(status) ? status : "completed";

  if (type === "level") {
    const level = toPositiveInteger(source.level);
    if (!level) {
      return null;
    }

    return {
      id,
      type,
      questId: "",
      title: cleanText(source.title) || `Средний уровень группы ${level}+`,
      status: "completed",
      level,
      itemName: "",
      itemId: ""
    };
  }

  if (type === "item") {
    const itemName = cleanText(source.itemName);
    const itemId = cleanId(source.itemId);
    if (!itemName && !itemId) {
      return null;
    }

    return {
      id,
      type,
      questId: "",
      title: cleanText(source.title) || itemName || itemId,
      status: "completed",
      level: 0,
      itemName,
      itemId
    };
  }

  if (!questId) {
    return null;
  }

  return {
    id,
    type,
    questId,
    title: cleanText(source.title),
    status: normalizedStatus
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

function normalizeTaskSubtask(value = {}) {
  const source = asObject(value);
  const id = cleanId(source.id);
  const title = cleanText(source.title);
  if (!id || !title) {
    return null;
  }

  const failed = source.failed === true;
  return {
    id,
    title,
    completed: failed ? false : source.completed === true,
    failed
  };
}

function normalizeTaskSubtasksById(value = {}) {
  const subtasksById = {};

  for (const [rawTaskId, rawSubtasks] of Object.entries(asObject(value))) {
    const taskId = cleanId(rawTaskId);
    if (!taskId || !isSafeObjectKey(taskId)) {
      continue;
    }

    const subtasks = asArray(rawSubtasks).map(normalizeTaskSubtask).filter(Boolean);
    if (subtasks.length > 0) {
      subtasksById[taskId] = subtasks;
    }
  }

  return subtasksById;
}

function getQuestTask(quest, taskId) {
  const id = cleanId(taskId);
  if (!id) {
    return null;
  }

  return quest?.getTask?.(id)
    ?? asArray(quest?.tasks).find((task) => task?.uuidv4 === id)
    ?? null;
}

function normalizeRumorTopicInput(id, { title = "", tableUuid = "", entries = [] } = {}) {
  const topic = {
    id: cleanId(id),
    title: cleanText(title),
    tableUuid: cleanId(tableUuid),
    entries: asArray(entries).map((entry) => ({
      id: cleanId(entry?.id),
      text: cleanText(entry?.text),
      hidden: entry?.hidden === true
    })).filter((entry) => entry.id && entry.text)
  };

  if (!topic.id || !topic.title) {
    return null;
  }

  return topic;
}

function normalizeRumorEntryInput(id, { text = "", hidden = false } = {}) {
  const entry = {
    id: cleanId(id),
    text: cleanText(text),
    hidden: hidden === true
  };

  return entry.id && entry.text ? entry : null;
}

function normalizeQuestEventInput(id, { title = "", text = "" } = {}) {
  const event = {
    id: cleanId(id),
    title: cleanText(title),
    text: cleanText(text)
  };

  return event.id && event.title ? event : null;
}

function buildSelectedOptions(options, selectedValue) {
  return options.map((option) => ({
    ...option,
    selected: option.value === selectedValue || option.id === selectedValue
  }));
}

export function normalizeQuestMetadata(value = {}) {
  const source = asObject(value);

  return {
    version: 1,
    groupActorIds: uniqueCleanIds(source.groupActorIds),
    requirements: asArray(source.requirements).map(normalizeRequirement).filter(Boolean),
    unlockRewards: asArray(source.unlockRewards).map(normalizeUnlockReward).filter(Boolean),
    taskSubtasksById: normalizeTaskSubtasksById(source.taskSubtasksById)
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
    const groupItemOptions = buildGroupItemOptions(groupContext?.members ?? []);
    const questOptions = quests
      .filter((entry) => entry?.id && entry.id !== quest.id && !isPlaceholderNewQuest(entry))
      .map((entry) => ({
        id: entry.id,
        value: entry.id,
        name: entry.name ?? entry.id,
        status: entry.status ?? ""
      }))
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const requirements = groupId
      ? this.evaluateRequirementsForGroupState(quest.id, groupId, groupState, { members: groupContext?.members ?? [] }).requirements
      : metadata.requirements.map((requirement) => ({
        ...requirement,
        sourceQuestName: requirement.type === "quest"
          ? this.getFqlApi()?.DB?.getQuest?.(requirement.questId)?.name ?? ""
          : requirement.title,
        sourceStatus: requirement.type === "quest"
          ? this.getFqlApi()?.DB?.getQuest?.(requirement.questId)?.status ?? ""
          : "",
        unlocked: false,
        unlock: null,
        satisfied: false
      }));
    const editableRequirements = requirements.map((requirement) => ({
      ...requirement,
      typeOptions: buildSelectedOptions(REQUIREMENT_TYPE_OPTIONS, requirement.type),
      questOptions: buildSelectedOptions(questOptions, requirement.questId),
      statusOptions: buildSelectedOptions(REQUIREMENT_STATUS_OPTIONS, requirement.status),
      itemOptions: buildRequirementItemOptions(groupItemOptions, requirement)
    }));
    const unlockTargets = [];

    for (const targetQuest of quests.filter((entry) => entry?.id && !isPlaceholderNewQuest(entry))) {
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
      requirements: editableRequirements,
      unlockRewards,
      questOptions,
      groupItemOptions,
      requirementTypeOptions: REQUIREMENT_TYPE_OPTIONS.map((option) => ({ ...option })),
      requirementStatusOptions: REQUIREMENT_STATUS_OPTIONS.map((option) => ({ ...option })),
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

    return this.evaluateRequirementsForGroupState(questId, context.groupId, context.groupState, {
      members: context.members ?? []
    });
  }

  evaluateRequirementsForGroupState(questId, groupActorId, groupState = {}, { members = [] } = {}) {
    const targetQuest = this.getQuest(questId);
    const metadata = this.getQuestMetadata(targetQuest);
    const normalizedState = normalizeGroupState(groupActorId, groupState);
    const unlocks = normalizedState.questState.unlocksByQuestId?.[targetQuest.id] ?? {};

    const requirements = metadata.requirements.map((requirement) => {
      const linkedQuest = requirement.type === "quest"
        ? this.getFqlApi()?.DB?.getQuest?.(requirement.questId) ?? null
        : null;
      const unlocked = Boolean(unlocks[requirement.id]);
      const completedByQuest = requirement.type === "quest" && linkedQuest?.status === requirement.status;
      const currentLevel = requirement.type === "level" ? getAverageGroupLevel(members) : 0;
      const matchedItem = requirement.type === "item" ? findGroupItem(members, requirement) : null;
      const completedByLevel = requirement.type === "level" && currentLevel >= requirement.level;
      const completedByItem = requirement.type === "item" && Boolean(matchedItem);

      return {
        ...requirement,
        sourceQuestName: requirement.type === "quest" ? linkedQuest?.name ?? "" : requirement.title,
        sourceStatus: requirement.type === "quest" ? linkedQuest?.status ?? "" : "",
        currentLevel,
        matchedItemName: matchedItem?.name ?? "",
        matchedActorName: matchedItem?.actorName ?? "",
        unlocked,
        unlock: unlocks[requirement.id] ?? null,
        satisfied: unlocked || completedByQuest || completedByLevel || completedByItem
      };
    });

    return {
      questId: targetQuest.id,
      groupActorId,
      satisfied: requirements.every((requirement) => requirement.satisfied),
      requirements
    };
  }

  buildRequirementData(id, { type = "quest", requiredQuestId, title = "", status = "completed", level = 0, itemName = "", itemId = "" } = {}) {
    const requirementType = cleanRequirementType(type);
    if (requirementType === "level") {
      return normalizeRequirement({
        id,
        type: requirementType,
        title,
        level
      });
    }

    if (requirementType === "item") {
      const cleanItemName = cleanText(itemName);
      const cleanItemId = cleanId(itemId);
      return normalizeRequirement({
        id,
        type: requirementType,
        title: title || cleanItemName || cleanItemId,
        itemName: cleanItemName,
        itemId: cleanItemId
      });
    }

    const requiredQuest = this.getQuest(requiredQuestId);
    return normalizeRequirement({
      id,
      type: requirementType,
      questId: requiredQuest.id,
      title: title || requiredQuest.name || requiredQuest.id,
      status
    });
  }

  async addRequirement(questId, data = {}) {
    const quest = this.getQuest(questId);
    const metadata = this.getQuestMetadata(quest);
    const requirement = this.buildRequirementData(this.idFactory("req"), data);
    if (!requirement) {
      throw new Error("Quest requirement data is incomplete.");
    }

    metadata.requirements.push(requirement);
    await this.setQuestMetadata(quest, metadata);
    return requirement;
  }

  async updateRequirement(questId, requirementId, data = {}) {
    const quest = this.getQuest(questId);
    const metadata = this.getQuestMetadata(quest);
    const id = cleanId(requirementId);
    const index = metadata.requirements.findIndex((requirement) => requirement.id === id);
    if (index === -1) {
      throw new Error("Quest requirement was not found.");
    }

    const requirement = this.buildRequirementData(id, data);
    if (!requirement) {
      throw new Error("Quest requirement data is incomplete.");
    }

    metadata.requirements[index] = requirement;
    await this.setQuestMetadata(quest, metadata);
    return requirement;
  }

  async removeRequirement(questId, requirementId) {
    const quest = this.getQuest(questId);
    const metadata = this.getQuestMetadata(quest);
    const id = cleanId(requirementId);
    const requirement = metadata.requirements.find((entry) => entry.id === id);
    if (!requirement) {
      throw new Error("Quest requirement was not found.");
    }

    metadata.requirements = metadata.requirements.filter((entry) => entry.id !== id);
    metadata.unlockRewards = metadata.unlockRewards.filter((reward) => reward.requirementId !== id || reward.targetQuestId !== quest.id);
    await this.setQuestMetadata(quest, metadata);
    return requirement;
  }

  getTaskSubtasks(questId, taskId) {
    const quest = this.getQuest(questId);
    const task = getQuestTask(quest, taskId);
    if (!task) {
      throw new Error("Quest task was not found.");
    }

    const metadata = this.getQuestMetadata(quest);
    return asArray(metadata.taskSubtasksById[task.uuidv4 ?? cleanId(taskId)]).map((subtask) => ({ ...subtask }));
  }

  async addTaskSubtask(questId, taskId, data = {}) {
    const quest = this.getQuest(questId);
    const task = getQuestTask(quest, taskId);
    if (!task) {
      throw new Error("Quest task was not found.");
    }

    const subtask = normalizeTaskSubtask({
      id: this.idFactory("subtask"),
      title: data.title,
      completed: data.completed,
      failed: data.failed
    });
    if (!subtask) {
      throw new Error("Quest subtask data is incomplete.");
    }

    const metadata = this.getQuestMetadata(quest);
    const normalizedTaskId = task.uuidv4 ?? cleanId(taskId);
    metadata.taskSubtasksById[normalizedTaskId] ??= [];
    metadata.taskSubtasksById[normalizedTaskId].push(subtask);
    await this.setQuestMetadata(quest, metadata);
    return subtask;
  }

  async updateTaskSubtask(questId, taskId, subtaskId, data = {}) {
    const quest = this.getQuest(questId);
    const task = getQuestTask(quest, taskId);
    if (!task) {
      throw new Error("Quest task was not found.");
    }

    const metadata = this.getQuestMetadata(quest);
    const normalizedTaskId = task.uuidv4 ?? cleanId(taskId);
    const subtasks = asArray(metadata.taskSubtasksById[normalizedTaskId]);
    const id = cleanId(subtaskId);
    const index = subtasks.findIndex((subtask) => subtask.id === id);
    if (index === -1) {
      throw new Error("Quest subtask was not found.");
    }

    const current = subtasks[index];
    const subtask = normalizeTaskSubtask({
      id,
      title: data.title ?? current.title,
      completed: data.failed === true ? false : data.completed ?? current.completed,
      failed: data.failed ?? (data.completed === true ? false : current.failed)
    });
    if (!subtask) {
      throw new Error("Quest subtask data is incomplete.");
    }

    metadata.taskSubtasksById[normalizedTaskId] = [
      ...subtasks.slice(0, index),
      subtask,
      ...subtasks.slice(index + 1)
    ];
    await this.setQuestMetadata(quest, metadata);
    return subtask;
  }

  async removeTaskSubtask(questId, taskId, subtaskId) {
    const quest = this.getQuest(questId);
    const task = getQuestTask(quest, taskId);
    if (!task) {
      throw new Error("Quest task was not found.");
    }

    const metadata = this.getQuestMetadata(quest);
    const normalizedTaskId = task.uuidv4 ?? cleanId(taskId);
    const subtasks = asArray(metadata.taskSubtasksById[normalizedTaskId]);
    const id = cleanId(subtaskId);
    const subtask = subtasks.find((entry) => entry.id === id);
    if (!subtask) {
      throw new Error("Quest subtask was not found.");
    }

    metadata.taskSubtasksById[normalizedTaskId] = subtasks.filter((entry) => entry.id !== id);
    if (metadata.taskSubtasksById[normalizedTaskId].length === 0) {
      delete metadata.taskSubtasksById[normalizedTaskId];
    }

    await this.setQuestMetadata(quest, metadata);
    return subtask;
  }

  async markTaskFailed(questId, taskId) {
    const quest = this.getQuest(questId);
    const task = getQuestTask(quest, taskId);
    if (!task) {
      throw new Error("Quest task was not found.");
    }

    task.completed = false;
    task.failed = true;
    await quest.save?.();
    return task;
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

  async removeUnlockReward(sourceQuestId, rewardId) {
    const sourceQuest = this.getQuest(sourceQuestId);
    const metadata = this.getQuestMetadata(sourceQuest);
    const id = cleanId(rewardId);
    const reward = metadata.unlockRewards.find((entry) => entry.id === id);
    if (!reward) {
      throw new Error("Unlock reward was not found.");
    }

    metadata.unlockRewards = metadata.unlockRewards.filter((entry) => entry.id !== id);
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
    const evaluation = this.evaluateRequirementsForGroupState(targetQuest.id, context.groupId, groupState, {
      members: context.members ?? []
    });
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

  getQuestActivitiesContext(groupActorId = "") {
    const context = this.getGroupContext(groupActorId);
    if (!context?.groupId) {
      return {
        groupActorId: "",
        groupName: "",
        hasGroupContext: false,
        canEdit: false,
        activities: normalizeQuestState({}).activities
      };
    }

    const groupState = normalizeGroupState(context.groupId, context.groupState ?? {});
    const canEdit = globalThis.game?.user ? globalThis.game.user.isGM === true : true;
    const activities = clone(groupState.questState.activities);
    if (!canEdit) {
      activities.rumors = activities.rumors.map((rumor) => ({
        ...rumor,
        entries: rumor.entries.filter((entry) => !entry.hidden)
      }));
    }

    return {
      groupActorId: context.groupId,
      groupName: context.groupActor?.name ?? "",
      hasGroupContext: true,
      canEdit,
      activities
    };
  }

  async updateGroupQuestActivities(groupActorId, updater) {
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
    const result = updater(groupState.questState.activities);
    registry.activeGroupActorId ||= context.groupId;
    registry.groupsById[context.groupId] = groupState;
    await this.groupContextService?.setRegistry?.(registry);
    return result;
  }

  async addRumorTopic(data = {}, groupActorId = "") {
    const topic = normalizeRumorTopicInput(this.idFactory("rumor"), data);
    if (!topic) {
      throw new Error("Rumor data is incomplete.");
    }

    await this.updateGroupQuestActivities(groupActorId, (activities) => {
      activities.rumors.push(topic);
      return topic;
    });
    return topic;
  }

  async removeRumorTopic(rumorId, groupActorId = "") {
    const id = cleanId(rumorId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const rumor = activities.rumors.find((entry) => entry.id === id);
      if (!rumor) {
        throw new Error("Rumor topic was not found.");
      }

      activities.rumors = activities.rumors.filter((entry) => entry.id !== id);
      return rumor;
    });
  }

  async updateRumorTopic(rumorId, data = {}, groupActorId = "") {
    const id = cleanId(rumorId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const index = activities.rumors.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new Error("Rumor topic was not found.");
      }

      const current = activities.rumors[index];
      const topic = normalizeRumorTopicInput(id, {
        title: data.title ?? current.title,
        tableUuid: data.tableUuid ?? current.tableUuid,
        entries: current.entries
      });
      if (!topic) {
        throw new Error("Rumor data is incomplete.");
      }

      activities.rumors[index] = topic;
      return topic;
    });
  }

  async addRumorEntry(rumorId, data = {}, groupActorId = "") {
    const entry = normalizeRumorEntryInput(this.idFactory("rumor-entry"), data);
    if (!entry) {
      throw new Error("Rumor entry data is incomplete.");
    }

    await this.updateGroupQuestActivities(groupActorId, (activities) => {
      const rumor = activities.rumors.find((topic) => topic.id === cleanId(rumorId));
      if (!rumor) {
        throw new Error("Rumor topic was not found.");
      }

      rumor.entries.push(entry);
      return entry;
    });
    return entry;
  }

  async updateRumorEntry(rumorId, entryId, data = {}, groupActorId = "") {
    const topicId = cleanId(rumorId);
    const id = cleanId(entryId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const rumor = activities.rumors.find((topic) => topic.id === topicId);
      if (!rumor) {
        throw new Error("Rumor topic was not found.");
      }

      const index = rumor.entries.findIndex((item) => item.id === id);
      if (index === -1) {
        throw new Error("Rumor entry was not found.");
      }

      const current = rumor.entries[index];
      const entry = normalizeRumorEntryInput(id, {
        text: data.text ?? current.text,
        hidden: data.hidden ?? current.hidden
      });
      if (!entry) {
        throw new Error("Rumor entry data is incomplete.");
      }

      rumor.entries[index] = entry;
      return entry;
    });
  }

  async removeRumorEntry(rumorId, entryId, groupActorId = "") {
    const topicId = cleanId(rumorId);
    const id = cleanId(entryId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const rumor = activities.rumors.find((topic) => topic.id === topicId);
      if (!rumor) {
        throw new Error("Rumor topic was not found.");
      }

      const entry = rumor.entries.find((item) => item.id === id);
      if (!entry) {
        throw new Error("Rumor entry was not found.");
      }

      rumor.entries = rumor.entries.filter((item) => item.id !== id);
      return entry;
    });
  }

  async addQuestEvent(data = {}, groupActorId = "") {
    const event = normalizeQuestEventInput(this.idFactory("event"), data);
    if (!event) {
      throw new Error("Quest event data is incomplete.");
    }

    await this.updateGroupQuestActivities(groupActorId, (activities) => {
      activities.events.push(event);
      return event;
    });
    return event;
  }

  async updateQuestEvent(eventId, data = {}, groupActorId = "") {
    const id = cleanId(eventId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const index = activities.events.findIndex((entry) => entry.id === id);
      if (index === -1) {
        throw new Error("Quest event was not found.");
      }

      const current = activities.events[index];
      const event = normalizeQuestEventInput(id, {
        title: data.title ?? current.title,
        text: data.text ?? current.text
      });
      if (!event) {
        throw new Error("Quest event data is incomplete.");
      }

      activities.events[index] = event;
      return event;
    });
  }

  async removeQuestEvent(eventId, groupActorId = "") {
    const id = cleanId(eventId);
    return this.updateGroupQuestActivities(groupActorId, (activities) => {
      const event = activities.events.find((entry) => entry.id === id);
      if (!event) {
        throw new Error("Quest event was not found.");
      }

      activities.events = activities.events.filter((entry) => entry.id !== id);
      return event;
    });
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
