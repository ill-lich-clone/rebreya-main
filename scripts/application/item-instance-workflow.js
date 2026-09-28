import { ItemInstanceError, planItemInstanceMutation } from "../data/item-instance-rules.js";

export function itemInstanceFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(itemInstanceFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${itemInstanceFingerprint(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Domain policy and document writes belong to the injected owner adapters. */
export class ItemInstanceWorkflow {
  constructor({ journal, coordinator, documents }) {
    this.journal = journal;
    this.coordinator = coordinator;
    this.documents = documents;
  }

  run(intent, context) {
    if (!context?.sender?.id || !intent?.operationId || !intent.sourceActorUuid || !intent.destinationActorUuid
      || !intent.sourceItemId || (intent.targetFolderId !== null && intent.heroSlotId !== null)) {
      return Promise.reject(new ItemInstanceError("invalid-intent", "Неполные данные операции экземпляра."));
    }
    const request = structuredClone(intent);
    const actors = [...new Set([request.sourceActorUuid, request.destinationActorUuid])].sort();
    const lock = index => index === actors.length
      ? this.#run(request, context)
      : this.coordinator.run(`inventory-organization:${actors[index].split(".").at(-1)}`, () => lock(index + 1));
    return lock(0);
  }

  async #guarded(context, operation) {
    await context.assertAuthority();
    const result = await operation();
    await context.assertAuthority();
    return result;
  }

  async #run(intent, context) {
    await context.assertAuthority();
    const action = intent.mode ?? (intent.heroSlotId === null ? "folder" : "hero");
    const id = `item-instance:${JSON.stringify([context.sender.id, action, intent.operationId])}`;
    const fingerprint = itemInstanceFingerprint(intent);
    let record = await this.journal.find(id);
    if (record && record.fingerprint !== fingerprint) throw new ItemInstanceError("operation-conflict", "Этот ID уже использован для другой операции.");
    // Actor authorization must work for terminal retries even when the source Item is gone.
    const actors = await this.documents.readActors(intent);
    await context.authorize(actors, intent);
    if (record?.terminal) {
      if (!record.result.ok) throw new ItemInstanceError(record.result.code, record.result.message);
      return { ...record.result.value, replayed: true };
    }
    if (record?.phase === "manual-review") throw new ItemInstanceError("manual-review", "Операция требует ручной сверки; повторная выдача заблокирована.");
    if (!record) {
      const pending = await this.journal.listPending();
      const actorIds = [intent.sourceActorUuid, intent.destinationActorUuid];
      if (pending.some(entry => entry.kind === "item-instance-v1" &&
        [entry.intent.sourceActorUuid, entry.intent.destinationActorUuid].some(uuid => actorIds.includes(uuid)))) {
        throw new ItemInstanceError("pending-instance-operation", "Сначала завершите или сверьте предыдущую операцию с предметами этого персонажа.");
      }
      const source = await this.documents.readSource(intent, actors);
      await context.authorize({ ...actors, ...source }, intent);
      if (intent.expectedSourceQuantity != null && intent.expectedSourceQuantity !== source.quantity) {
        throw new ItemInstanceError("stale-quantity", "Количество изменилось. Обновите инвентарь и повторите перенос.");
      }
      const plan = planItemInstanceMutation({ source, quantity: intent.quantity,
        sameActor: intent.sourceActorUuid === intent.destinationActorUuid,
        sameFolder: source.folderId === intent.targetFolderId, forHeroSlot: intent.heroSlotId !== null,
        ...context.planSource?.(source, intent) });
      const prepared = await this.documents.prepare(intent, plan, source, context, { id, fingerprint });
      record = await this.#guarded(context, () => this.journal.start({ ...prepared, id, fingerprint, intent, plan, kind: "item-instance-v1", phase: "prepared" }));
    }
    if (["compensating", "compensated"].includes(record.phase)) return this.#compensate(record, context);
    const phases = [
      ["prepared", "target-created", "createTarget"],
      ["target-created", "source-debited", "debitSource"],
      ["source-debited", "placement-written", "writePlacement"]
    ];
    try {
      for (const [before, after, method] of phases) {
        if (record.phase !== before) continue;
        const receipt = await this.#guarded(context, () => this.documents[method](record, context));
        record = await this.#guarded(context, () => this.journal.checkpoint(id, before, after, receipt?.itemId ? { itemId: receipt.itemId } : {}));
      }
      // The driver verifies all receipts, including a target removed after debit.
      await this.documents.verifyCommitted(record, context);
    } catch (error) {
      await context.assertAuthority(); // A former GM must never compensate.
      return this.#compensate(record, context, error);
    }
    const value = { operationId: intent.operationId, itemId: record.itemId,
      sourceRemaining: record.plan.sourceRemaining, changed: record.plan.kind !== "noop", replayed: false };
    // Do not undo a completed document transaction because its terminal journal write failed.
    await this.#guarded(context, () => this.journal.finish(id, { ok: true, value }));
    return value;
  }

  async #compensate(record, context, error = null) {
    if (record.phase !== "compensated") {
      try {
        if (record.phase !== "compensating") record = await this.#guarded(context, () => this.journal.checkpoint(record.id, record.phase, "compensating"));
        await this.#guarded(context, () => this.documents.compensate(record, context));
        record = await this.#guarded(context, () => this.journal.checkpoint(record.id, "compensating", "compensated"));
      } catch (compensationError) {
        await context.assertAuthority();
        const current = await this.journal.find(record.id);
        if (current && !current.terminal && current.phase !== "manual-review") {
          await this.#guarded(context, () => this.journal.checkpoint(record.id, current.phase, "manual-review", {
            failure: {code:error?.code ?? "write-failed",message:error?.message ?? ""},
            compensationFailure: {code:compensationError?.code ?? "compensation-failed",message:compensationError?.message ?? ""}
          }));
        }
        throw new ItemInstanceError("manual-review", "Предметы изменились во время операции. Нужна ручная сверка; повторная выдача заблокирована.");
      }
    }
    const result = { ok: false, code: "instance-compensated", message: "Перенос отменён; исходное количество восстановлено." };
    await this.#guarded(context, () => this.journal.finish(record.id, result));
    throw new ItemInstanceError(result.code, error?.message ? `${result.message} ${error.message}` : result.message);
  }
}
