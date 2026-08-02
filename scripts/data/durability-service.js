import {
  DURABILITY_UPDATED_HOOK,
  MODULE_ID,
  SETTINGS_KEYS
} from "../constants.js";
import { DurableMutationJournal } from "../application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  applyDurabilityDamage,
  buildInitialDurability,
  isDurabilityEligible,
  markDurabilityBroken,
  markDurabilityDestroyed,
  resolveDurabilityProfile
} from "./durability-rules.js";

const DURABILITY_FLAG_PATH = `flags.${MODULE_ID}.durability`;
const SIDE_EFFECT_LEASE_MS = 30_000;

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toPlain(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }
  if (typeof value.toObject === "function") {
    return toPlain(value.toObject());
  }
  if (Array.isArray(value)) {
    return value.map(toPlain);
  }

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = toPlain(child);
  }
  return result;
}

function itemDataOf(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  if (typeof item.toObject === "function") {
    return toPlain(item.toObject());
  }
  if (item._source && typeof item._source === "object") {
    return toPlain(item._source);
  }
  return toPlain({
    id: item.id,
    uuid: item.uuid,
    type: item.type,
    system: item.system,
    flags: item.flags
  });
}

function moduleFlagsOf(itemData) {
  return itemData?.flags?.[MODULE_ID]
    ?? itemData?._source?.flags?.[MODULE_ID]
    ?? {};
}

function lookupById(map, rows, id) {
  const key = cleanId(id);
  if (!key) {
    return null;
  }
  return map?.get?.(key)
    ?? (Array.isArray(rows) ? rows.find((row) => cleanId(row?.id) === key) : null)
    ?? null;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  const text = cleanId(value);
  return text || new Date().toISOString();
}

function ignoredTransition(flag = null) {
  return {
    outcome: "ignored",
    nextFlag: flag == null ? null : toPlain(flag),
    appliedDamage: 0
  };
}

function transitionWithTimestamp(transition, timestamp) {
  return {
    ...toPlain(transition),
    nextFlag: {
      ...toPlain(transition.nextFlag),
      updatedAt: timestamp
    }
  };
}

function clearAttunementPayload(itemData) {
  const system = itemData?.system;
  if (!system || typeof system !== "object") {
    return {};
  }

  const payload = {};
  if (Object.hasOwn(system, "attuned")) {
    payload["system.attuned"] = false;
  }
  if (Object.hasOwn(system, "attunement")) {
    const attunement = system.attunement;
    if (attunement && typeof attunement === "object" && !Array.isArray(attunement)) {
      payload["system.attunement"] = {
        ...toPlain(attunement),
        value: typeof attunement.value === "boolean" ? false : 0
      };
    }
    else if (typeof attunement === "boolean") {
      payload["system.attunement"] = false;
    }
    else if (typeof attunement === "string") {
      payload["system.attunement"] = "";
    }
    else {
      payload["system.attunement"] = 0;
    }
  }
  return payload;
}

function normalizeDurabilityJournal(value) {
  return {
    version: 1,
    records: Array.isArray(value?.records) ? toPlain(value.records) : []
  };
}

function defaultJournal() {
  return new DurableMutationJournal({
    readState: () => globalThis.game?.settings?.get(
      MODULE_ID,
      SETTINGS_KEYS.DURABILITY_MUTATION_JOURNAL
    ) ?? {},
    writeState: (state) => {
      if (typeof globalThis.game?.settings?.set !== "function") {
        throw new Error("Durability mutation journal setting is unavailable.");
      }
      return globalThis.game.settings.set(
        MODULE_ID,
        SETTINGS_KEYS.DURABILITY_MUTATION_JOURNAL,
        state
      );
    },
    normalizeState: normalizeDurabilityJournal
  });
}

async function defaultResolveItem(itemUuid, fallbackItem) {
  if (typeof globalThis.fromUuid === "function") {
    return globalThis.fromUuid(itemUuid);
  }
  if (fallbackItem?.exists === false || fallbackItem?._deleted === true) {
    return null;
  }
  if (fallbackItem?.parent?.items?.get && fallbackItem.id) {
    return fallbackItem.parent.items.get(fallbackItem.id) ?? null;
  }
  return fallbackItem ?? null;
}

export class DurabilityService {
  constructor(moduleApi = {}, {
    coordinator = moduleApi.worldMutationCoordinator ?? new WorldMutationCoordinator(),
    journal = null,
    resolveItem = defaultResolveItem,
    isActiveGm = () => isActiveGmClient(globalThis.game),
    ownerId = () => cleanId(globalThis.game?.user?.id) || "active-gm",
    now = () => new Date().toISOString(),
    hooks = globalThis.Hooks
  } = {}) {
    if (!coordinator || typeof coordinator.run !== "function") {
      throw new TypeError("coordinator must serialize durability mutations");
    }
    if (journal && (typeof journal.find !== "function" || typeof journal.start !== "function")) {
      throw new TypeError("journal must persist durability mutations");
    }
    if (typeof resolveItem !== "function" || typeof isActiveGm !== "function" || typeof ownerId !== "function" || typeof now !== "function") {
      throw new TypeError("resolveItem, isActiveGm, ownerId, and now must be functions");
    }

    this.moduleApi = moduleApi;
    this.mutationCoordinator = coordinator;
    this.mutationJournal = journal ?? defaultJournal();
    this.resolveItem = resolveItem;
    this.isActiveGm = isActiveGm;
    this.ownerId = ownerId;
    this.now = now;
    this.hooks = hooks;
  }

  initializeItem(item, options = {}) {
    return this.mutationCoordinator.run(
      this.#mutationKey(item),
      () => this.#initializeItem(item, options)
    );
  }

  async #initializeItem(item, { force = false, sourceType, sourceId } = {}) {
    const itemData = itemDataOf(item);
    if (!isDurabilityEligible(itemData)) {
      return null;
    }

    const existing = this.getDurability(item);
    if (existing && force !== true) {
      return existing;
    }

    const flag = await this.#buildInitialFlag(item, { sourceType, sourceId });
    if (!flag) {
      return null;
    }
    const transition = {
      outcome: "initialized",
      nextFlag: flag,
      appliedDamage: 0
    };
    await this.#commitUpdate(item, transition, { clearEquipment: false });
    return toPlain(flag);
  }

  damageItem(item, { amount, damageType, mutationId = "" } = {}) {
    return this.mutationCoordinator.run(
      this.#mutationKey(item),
      async () => {
        const flag = await this.#readOrBuildFlag(item);
        if (!flag) {
          return ignoredTransition();
        }

        const transition = applyDurabilityDamage(flag, { amount, damageType });
        if (transition.outcome === "ignored") {
          return toPlain(transition);
        }
        const committedTransition = transitionWithTimestamp(transition, this.#timestamp());
        return this.#commitUpdate(item, committedTransition, { clearEquipment: false });
      }
    );
  }

  breakItem(item, _options = {}) {
    return this.mutationCoordinator.run(
      this.#mutationKey(item),
      async () => {
        const flag = await this.#readOrBuildFlag(item);
        if (!flag || flag.state === "broken" || flag.state === "destroyed") {
          return ignoredTransition(flag);
        }
        const transition = markDurabilityBroken(flag);
        if (transition.outcome === "ignored") {
          return toPlain(transition);
        }
        return this.#commitUpdate(
          item,
          transitionWithTimestamp(transition, this.#timestamp()),
          { clearEquipment: true }
        );
      }
    );
  }

  destroyItem(item, { mutationId = "" } = {}) {
    return this.mutationCoordinator.run(
      this.#mutationKey(item),
      async () => {
        this.#assertGm();
        const flag = await this.#readOrBuildFlag(item);
        if (!flag) {
          return ignoredTransition();
        }
        const transition = this.#buildDestroyedTransition(flag);
        if (transition.outcome === "ignored") {
          return transition;
        }
        return this.#executeDestroy(
          item,
          transitionWithTimestamp(transition, this.#timestamp()),
          mutationId
        );
      }
    );
  }

  getDurability(item) {
    if (!item || typeof item !== "object") {
      return null;
    }

    let flag;
    try {
      flag = typeof item.getFlag === "function"
        ? item.getFlag(MODULE_ID, "durability")
        : undefined;
    }
    catch (_error) {
      flag = undefined;
    }
    flag ??= item.flags?.[MODULE_ID]?.durability
      ?? item._source?.flags?.[MODULE_ID]?.durability;
    return flag && typeof flag === "object" ? toPlain(flag) : null;
  }

  isBroken(item) {
    const state = this.getDurability(item)?.state;
    return state === "broken" || state === "destroyed";
  }

  async #readOrBuildFlag(item) {
    if (!isDurabilityEligible(itemDataOf(item))) {
      return null;
    }
    const existing = this.getDurability(item);
    if (existing) {
      return existing;
    }
    return this.#buildInitialFlag(item);
  }

  async #buildInitialFlag(item, { sourceType, sourceId } = {}) {
    const itemData = itemDataOf(item);
    if (!isDurabilityEligible(itemData)) {
      return null;
    }

    const model = await this.#getModel();
    const flags = moduleFlagsOf(itemData);
    const explicitSourceType = cleanId(sourceType);
    const explicitSourceId = cleanId(sourceId);
    const flagSourceType = cleanId(flags.sourceType);
    const gearId = cleanId(
      (explicitSourceType === "gear" ? explicitSourceId : "")
      || flags.gearId
      || flags.containerContentGearId
      || ((flagSourceType === "gear" || flagSourceType === "gearContainerContent") ? flags.sourceId : "")
    );
    const gear = lookupById(model?.gearById, model?.gear, gearId);
    const materialId = cleanId(
      flags.predominantMaterialId
      || gear?.predominantMaterialId
      || flags.materialId
    );
    let material = lookupById(model?.materialById, model?.materials, materialId);
    if (!material) {
      const linkedGoodId = cleanId(flags.linkedGoodId || gear?.linkedGoodId);
      material = lookupById(model?.materialByGoodId, [], linkedGoodId);
    }

    const resolvedSourceType = explicitSourceType
      || flagSourceType
      || (gear ? "gear" : "item");
    const resolvedSourceId = explicitSourceId
      || cleanId(flags.sourceId)
      || gearId
      || cleanId(itemData?.id ?? itemData?._id ?? item?.id ?? item?.uuid);
    const profile = resolveDurabilityProfile({ itemData, gear: gear ?? {}, material: material ?? {} });
    return {
      ...buildInitialDurability({
        ...profile,
        initializedFrom: {
          sourceType: resolvedSourceType,
          sourceId: resolvedSourceId
        }
      }),
      updatedAt: this.#timestamp()
    };
  }

  async #getModel() {
    if (typeof this.moduleApi.getModel === "function") {
      return await this.moduleApi.getModel();
    }
    return this.moduleApi.repository?.model ?? {};
  }

  #buildDestroyedTransition(flag) {
    return toPlain(markDurabilityDestroyed(flag));
  }

  async #commitUpdate(item, transition, {
    clearEquipment,
    assertAuthority = null,
    operationOptions = null
  }) {
    if (!item || typeof item.update !== "function") {
      throw new TypeError("item must support document updates");
    }
    const committedTransition = toPlain(transition);
    const payload = {
      [DURABILITY_FLAG_PATH]: toPlain(committedTransition.nextFlag)
    };
    if (clearEquipment) {
      payload["system.equipped"] = false;
      Object.assign(payload, clearAttunementPayload(itemDataOf(item)));
    }

    await assertAuthority?.();
    if (operationOptions) {
      await item.update(payload, toPlain(operationOptions));
    }
    else {
      await item.update(payload);
    }
    await assertAuthority?.();
    this.#emitUpdate(item, committedTransition);
    return committedTransition;
  }

  async #executeDestroy(item, transition, requestedMutationId) {
    const itemUuid = cleanId(item?.uuid ?? itemDataOf(item)?.uuid);
    if (!itemUuid) {
      throw new TypeError("destroyed item must have a UUID");
    }
    const requestId = cleanId(requestedMutationId) || itemUuid;
    const operationId = `durability-destroy:${requestId}`;
    let record = await this.#awaitAsActiveGm(
      () => this.mutationJournal.find(operationId)
    );
    if (!record) {
      record = await this.#awaitAsActiveGm(
        () => this.mutationJournal.start({
          id: operationId,
          kind: "destroy",
          phase: "prepared",
          itemUuid,
          transition: toPlain(transition)
        })
      );
    }
    if (record.itemUuid !== itemUuid) {
      const error = new Error("Durability mutation ID belongs to another item.");
      error.code = "mutation-item-conflict";
      throw error;
    }
    if (record.terminal === true) {
      return toPlain(record.result?.value ?? record.transition);
    }

    if (record.phase === "prepared") {
      const currentItem = await this.#awaitAsActiveGm(
        () => this.resolveItem(record.itemUuid, item)
      );
      if (!currentItem) {
        record = await this.#awaitAsActiveGm(
          () => this.mutationJournal.checkpoint(
            operationId,
            "prepared",
            "deleted"
          )
        );
      }
      else {
        if (this.getDurability(currentItem)?.state !== "destroyed") {
          record = await this.#awaitAsActiveGm(
            () => this.mutationJournal.checkpoint(
              operationId,
              "prepared",
              "update-pending",
              this.#sideEffectLease("update", { operationId, itemUuid: record.itemUuid })
            )
          );
          record = await this.#runDestroyedUpdate(operationId, record, currentItem, item);
        }
        else {
          this.#assertGm();
          this.#emitUpdate(currentItem, record.transition);
          record = await this.#awaitAsActiveGm(
            () => this.mutationJournal.checkpoint(
              operationId,
              "prepared",
              "visible-destroyed",
              {
                sideEffect: null,
                updateNotificationPending: false
              }
            )
          );
        }
      }
    }

    if (this.#isSideEffectPhase(record.phase, "update")) {
      let currentItem = await this.#awaitAsActiveGm(
        () => this.resolveItem(record.itemUuid, item)
      );
      if (!currentItem) {
        record = await this.#checkpointSideEffect(
          operationId,
          record,
          "deleted",
          { sideEffect: null }
        );
      }
      else if (this.getDurability(currentItem)?.state === "destroyed") {
        await this.#assertSideEffectLease(operationId, record);
        this.#emitUpdate(currentItem, record.transition);
        record = await this.#checkpointSideEffect(
          operationId,
          record,
          "visible-destroyed",
          {
            sideEffect: null,
            updateNotificationPending: false
          }
        );
      }
      else {
        record = await this.#claimExpiredSideEffect(operationId, record, "update");
        currentItem = await this.#awaitAsActiveGm(
          () => this.resolveItem(record.itemUuid, item)
        );
        if (!currentItem) {
          record = await this.#checkpointSideEffect(
            operationId,
            record,
            "deleted",
            { sideEffect: null }
          );
        }
        else if (this.getDurability(currentItem)?.state === "destroyed") {
          await this.#assertSideEffectLease(operationId, record);
          this.#emitUpdate(currentItem, record.transition);
          record = await this.#checkpointSideEffect(
            operationId,
            record,
            "visible-destroyed",
            {
              sideEffect: null,
              updateNotificationPending: false
            }
          );
        }
        else {
          record = await this.#runDestroyedUpdate(operationId, record, currentItem, item);
        }
      }
    }

    if (record.phase === "visible-destroyed") {
      let currentItem = await this.#awaitAsActiveGm(
        () => this.resolveItem(record.itemUuid, item)
      );
      if (currentItem && record.updateNotificationPending === true) {
        this.#emitUpdate(currentItem, record.transition);
        record = await this.#awaitAsActiveGm(
          () => this.mutationJournal.checkpoint(
            operationId,
            "visible-destroyed",
            "visible-destroyed",
            { updateNotificationPending: false }
          )
        );
        currentItem = await this.#awaitAsActiveGm(
          () => this.resolveItem(record.itemUuid, item)
        );
      }
      if (currentItem) {
        record = await this.#awaitAsActiveGm(
          () => this.mutationJournal.checkpoint(
            operationId,
            "visible-destroyed",
            "delete-pending",
            this.#sideEffectLease("delete", { operationId, itemUuid: record.itemUuid })
          )
        );
        record = await this.#runDelete(operationId, record, currentItem, item);
      }
      else {
        record = await this.#awaitAsActiveGm(
          () => this.mutationJournal.checkpoint(
            operationId,
            "visible-destroyed",
            "deleted",
            { sideEffect: null }
          )
        );
      }
    }

    if (this.#isSideEffectPhase(record.phase, "delete")) {
      let currentItem = await this.#awaitAsActiveGm(
        () => this.resolveItem(record.itemUuid, item)
      );
      if (currentItem) {
        record = await this.#claimExpiredSideEffect(operationId, record, "delete");
        currentItem = await this.#awaitAsActiveGm(
          () => this.resolveItem(record.itemUuid, item)
        );
        if (currentItem) {
          record = await this.#runDelete(operationId, record, currentItem, item);
        }
        else {
          record = await this.#checkpointSideEffect(
            operationId,
            record,
            "deleted",
            { sideEffect: null }
          );
        }
      }
      else {
        record = await this.#checkpointSideEffect(
          operationId,
          record,
          "deleted",
          { sideEffect: null }
        );
      }
    }

    if (record.phase !== "deleted") {
      const error = new Error(`Unknown durability destruction phase: ${String(record.phase)}`);
      error.code = "unknown-durability-phase";
      throw error;
    }

    record = await this.#awaitAsActiveGm(
      () => this.mutationJournal.finish(operationId, {
        ok: true,
        value: toPlain(record.transition)
      })
    );
    return toPlain(record.result.value);
  }

  async #runDestroyedUpdate(operationId, record, currentItem, fallbackItem) {
    try {
      await this.#commitUpdate(currentItem, record.transition, {
        clearEquipment: true,
        assertAuthority: () => this.#assertSideEffectLease(operationId, record),
        operationOptions: this.#sideEffectOptions(record)
      });
    }
    catch (error) {
      if (this.#isAuthorityError(error)) {
        throw error;
      }
      await this.#assertSideEffectLease(operationId, record);
      const observedItem = await this.#awaitAsActiveGm(
        () => this.resolveItem(record.itemUuid, fallbackItem)
      );
      const observedPhase = observedItem && this.getDurability(observedItem)?.state === "destroyed"
        ? "visible-destroyed"
        : "prepared";
      await this.#checkpointSideEffect(
        operationId,
        record,
        observedPhase,
        {
          sideEffect: null,
          updateNotificationPending: observedPhase === "visible-destroyed"
        }
      );
      throw error;
    }

    return this.#checkpointSideEffect(
      operationId,
      record,
      "visible-destroyed",
      {
        sideEffect: null,
        updateNotificationPending: false
      }
    );
  }

  async #runDelete(operationId, record, currentItem, fallbackItem) {
    try {
      await this.#assertSideEffectLease(operationId, record);
      await currentItem.delete(this.#sideEffectOptions(record));
      await this.#assertSideEffectLease(operationId, record);
    }
    catch (error) {
      if (this.#isAuthorityError(error)) {
        throw error;
      }
      await this.#assertSideEffectLease(operationId, record);
      if (await this.#awaitAsActiveGm(() => this.resolveItem(record.itemUuid, fallbackItem))) {
        await this.#checkpointSideEffect(
          operationId,
          record,
          "visible-destroyed",
          { sideEffect: null }
        );
        throw error;
      }
    }

    return this.#checkpointSideEffect(
      operationId,
      record,
      "deleted",
      { sideEffect: null }
    );
  }

  #assertGm() {
    if (this.isActiveGm() === true) {
      return;
    }
    const error = new Error("Only a GM can destroy a durable item.");
    error.code = "gm-required";
    throw error;
  }

  async #awaitAsActiveGm(operation) {
    this.#assertGm();
    const result = await operation();
    this.#assertGm();
    return result;
  }

  #sideEffectLease(kind, {
    operationId,
    itemUuid,
    previousLease = null,
    startedAt = this.#timestamp()
  } = {}) {
    const startedAtMs = Date.parse(startedAt);
    const leaseExpiresAt = Number.isFinite(startedAtMs)
      ? new Date(startedAtMs + SIDE_EFFECT_LEASE_MS).toISOString()
      : startedAt;
    const ownerId = cleanId(this.ownerId()) || "active-gm";
    const mutationGroup = cleanId(previousLease?.mutationGroup)
      || cleanId(operationId);
    const mutationId = cleanId(previousLease?.mutationId)
      || `${mutationGroup}:${kind}`;
    const targetItemUuid = cleanId(previousLease?.itemUuid)
      || cleanId(itemUuid);
    return {
      sideEffect: {
        kind,
        ownerId,
        leaseId: `${mutationId}:${ownerId}:${startedAt}`,
        mutationId,
        mutationGroup,
        itemUuid: targetItemUuid,
        startedAt,
        leaseExpiresAt
      }
    };
  }

  async #claimExpiredSideEffect(operationId, record, kind) {
    const claimedAt = this.#timestamp();
    const expiresAtMs = Date.parse(cleanId(record?.sideEffect?.leaseExpiresAt));
    const claimedAtMs = Date.parse(claimedAt);
    if (!Number.isFinite(expiresAtMs)
      || !Number.isFinite(claimedAtMs)
      || claimedAtMs < expiresAtMs) {
      throw this.#sideEffectPendingError(record);
    }

    const current = await this.#awaitAsActiveGm(
      () => this.mutationJournal.find(operationId)
    );
    if (!this.#sameSideEffectLease(current, record)) {
      throw this.#sideEffectPendingError(current ?? record);
    }

    const patch = this.#sideEffectLease(kind, {
      operationId,
      itemUuid: record.itemUuid,
      previousLease: record.sideEffect,
      startedAt: claimedAt
    });
    const nextPhase = `${kind}-pending:${encodeURIComponent(patch.sideEffect.leaseId)}`;
    try {
      return await this.#awaitAsActiveGm(
        () => this.mutationJournal.checkpoint(
          operationId,
          record.phase,
          nextPhase,
          patch
        )
      );
    }
    catch (error) {
      if (error?.code !== "phase-conflict") {
        throw error;
      }
      const latest = await this.#awaitAsActiveGm(
        () => this.mutationJournal.find(operationId)
      );
      throw this.#sideEffectPendingError(latest ?? record);
    }
  }

  async #assertSideEffectLease(operationId, expectedRecord) {
    const current = await this.#awaitAsActiveGm(
      () => this.mutationJournal.find(operationId)
    );
    if (!this.#sameSideEffectLease(current, expectedRecord)) {
      throw this.#sideEffectFencedError(expectedRecord);
    }
    return current;
  }

  async #checkpointSideEffect(operationId, record, nextPhase, patch) {
    await this.#assertSideEffectLease(operationId, record);
    try {
      return await this.#awaitAsActiveGm(
        () => this.mutationJournal.checkpoint(
          operationId,
          record.phase,
          nextPhase,
          patch
        )
      );
    }
    catch (error) {
      if (error?.code === "phase-conflict") {
        throw this.#sideEffectFencedError(record);
      }
      throw error;
    }
  }

  #sameSideEffectLease(current, expected) {
    if (cleanId(current?.id) !== cleanId(expected?.id)
      || cleanId(current?.phase) !== cleanId(expected?.phase)
      || cleanId(current?.itemUuid) !== cleanId(expected?.itemUuid)) {
      return false;
    }
    const fields = [
      "kind",
      "ownerId",
      "leaseId",
      "mutationId",
      "mutationGroup",
      "itemUuid",
      "startedAt",
      "leaseExpiresAt"
    ];
    return fields.every((field) => cleanId(current?.sideEffect?.[field])
      === cleanId(expected?.sideEffect?.[field]));
  }

  #sideEffectOptions(record) {
    const sideEffect = record?.sideEffect ?? {};
    const mutationGroup = cleanId(sideEffect.mutationGroup)
      || cleanId(record?.id);
    const kind = cleanId(sideEffect.kind) || "document";
    return {
      [MODULE_ID]: {
        mutationId: cleanId(sideEffect.mutationId) || `${mutationGroup}:${kind}`,
        mutationGroup,
        itemUuid: cleanId(sideEffect.itemUuid) || cleanId(record?.itemUuid)
      }
    };
  }

  #isSideEffectPhase(phase, kind) {
    const base = `${kind}-pending`;
    const value = cleanId(phase);
    return value === base || value.startsWith(`${base}:`);
  }

  #isAuthorityError(error) {
    return error?.code === "gm-required"
      || error?.code === "durability-side-effect-fenced";
  }

  #sideEffectPendingError(record) {
    const error = new Error(`Durability ${String(record?.sideEffect?.kind ?? "document")} side effect is still pending.`);
    error.code = "durability-side-effect-pending";
    error.ownerId = cleanId(record?.sideEffect?.ownerId);
    error.leaseExpiresAt = cleanId(record?.sideEffect?.leaseExpiresAt);
    return error;
  }

  #sideEffectFencedError(record) {
    const error = new Error(`Durability ${String(record?.sideEffect?.kind ?? "document")} side effect lease was replaced.`);
    error.code = "durability-side-effect-fenced";
    error.ownerId = cleanId(record?.sideEffect?.ownerId);
    error.leaseExpiresAt = cleanId(record?.sideEffect?.leaseExpiresAt);
    return error;
  }

  #mutationKey(item) {
    return `durability:${cleanId(item?.uuid ?? item?.id) || "unknown"}`;
  }

  #timestamp() {
    return normalizeTimestamp(this.now());
  }

  #emitUpdate(item, transition) {
    this.hooks?.callAll?.(DURABILITY_UPDATED_HOOK, item, toPlain(transition));
  }
}
