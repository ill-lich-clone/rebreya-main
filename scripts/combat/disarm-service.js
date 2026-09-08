import { DisarmError, evaluateDisarmRules, resolveDisarmOutcome } from "./disarm-rules.js?v=1.4.252";
import { itemInstanceFingerprint } from "../application/item-instance-workflow.js";

/** One durable owner; human decisions return between commands and never hold a queue. */
export class DisarmService {
  constructor({ journal, coordinator, documents, rollAdapter, storageCommands, publish = async () => {}, gameProvider = () => globalThis.game }) {
    Object.assign(this, { journal, coordinator, documents, rollAdapter, storageCommands, publish, gameProvider });
  }
  #id(operationId) {
    if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 128 || operationId !== operationId.trim()) throw new DisarmError("invalid-operation");
    return `disarm:${operationId}`;
  }
  #sender(context) {
    const sender = context?.sender;
    if (!sender?.id || this.gameProvider()?.users?.get(sender.id) !== sender) throw new DisarmError("unauthorized");
    return sender;
  }
  #authorize(record, context, save = false) {
    const sender = this.#sender(context);
    if (!sender.isGM && sender.id !== (save ? record.responderUserId : record.senderId)
      && !(save === null && sender.id === record.responderUserId)) throw new DisarmError("unauthorized");
  }
  async #write(context, action) {
    await context.assertAuthority(); const result = await action(); await context.assertAuthority(); return result;
  }
  async #phase(record, phase, patch, context) {
    return this.#write(context, () => this.journal.checkpoint(record.id, record.phase, phase, patch));
  }
  async #finish(record, phase, patch, context) {
    record = await this.#phase(record, phase, patch, context);
    return this.#write(context, () => this.journal.finish(record.id, { phase }));
  }
  projection(record) {
    return { operationId: record.intent.operationId, phase: record.phase, sourceName: record.sourceName,
      targetName: record.targetName, itemName: record.itemName, senderId: record.senderId,
      responderUserId: record.responderUserId, attackPlan: record.attackPlan,
      attackTotal: record.attackRoll?.total ?? null, saveTotal: record.saveRoll?.total ?? null,
      saveAbility: record.saveAbility ?? null, dropped: record.dropped ?? false,
      attackMode: record.attackMode, strSaveAdvantage: record.strSaveAdvantage,
      destination: record.destination ?? null, directionTotal: record.directionRoll?.total ?? null,
      ground: record.ground ?? null, error: record.error ?? null };
  }
  async #present(record) {
    try { await this.publish(record); } catch (error) { console.warn("rebreya-main | Disarm chat refresh failed", error); }
    return this.projection(record);
  }
  async start(intent, context) {
    const sender = this.#sender(context), id = this.#id(intent.operationId);
    return this.coordinator.run("disarm-operations", async () => {
      const fingerprint = itemInstanceFingerprint({ intent, senderId: sender.id });
      let record = await this.journal.find(id);
      if (record) {
        this.#authorize(record, context);
        if (record.fingerprint !== fingerprint) throw new DisarmError("operation-conflict", "Номер операции уже относится к другой атаке.");
        return this.#present(record);
      }
      const pending = await this.journal.listPending();
      if (pending.some(r => r.kind === "disarm" && (r.intent.sourceTokenUuid === intent.sourceTokenUuid || r.intent.targetItemUuid === intent.targetItemUuid))) {
        throw new DisarmError("operation-pending", "Сначала завершите прежнюю попытку обезоруживания.");
      }
      const prepared = await this.documents.prepare(intent, sender);
      const rules = evaluateDisarmRules({ ...prepared, saveAbility: "str" });
      if (!rules.allowed) throw new DisarmError(rules.reason, "Цель больше атакующего более чем на одну категорию.");
      record = await this.#write(context, () => this.journal.start({ ...prepared, id, kind: "disarm", intent: structuredClone(intent), fingerprint,
        senderId: sender.id, phase: "prepared", attackMode: rules.attackMode, strSaveAdvantage: rules.saveMode === "advantage" }));
      if (!record.attackPlan.formula) return this.#present(await this.#phase(record, "awaiting-baseline", {}, context));
      return this.#present(await this.#attack(record, context));
    });
  }
  async #attack(record, context) {
    record = await this.#phase(record, "attack-rolling", {}, context);
    try {
      const attackRoll = await this.rollAdapter.attack(record.attackPlan, record.attackMode);
      record = await this.#phase(record, "attack-rolled", { attackRoll }, context);
      return await this.#phase(record, "awaiting-save", {}, context);
    } catch (error) {
      await context.assertAuthority();
      const current = await this.journal.find(record.id);
      if (current.phase === "awaiting-save") return current;
      if (current.phase === "attack-rolled") return this.#phase(current, "awaiting-save", {}, context);
      return this.#finish(current, "manual-review", { error: `Бросок атаки не подтверждён: ${error.message}` }, context);
    }
  }
  async chooseSave(intent, context) {
    if (!["str", "dex"].includes(intent.saveAbility)) throw new DisarmError("invalid-save");
    return this.coordinator.run("disarm-operations", async () => {
      let record = await this.journal.find(this.#id(intent.operationId));
      if (!record) throw new DisarmError("operation-not-found");
      this.#authorize(record, context, true);
      if (record.saveAbility && record.saveAbility !== intent.saveAbility) throw new DisarmError("operation-conflict");
      if (record.terminal || record.phase !== "awaiting-save") return this.#present(record);
      let live;
      try { live = await this.documents.revalidate(record, intent.saveAbility); }
      catch (error) { return this.#present(await this.#finish(record, "conflict", { error: error.message }, context)); }
      if (!context.sender.isGM && live.targetActor.testUserPermission && !live.targetActor.testUserPermission(context.sender, "OWNER")) throw new DisarmError("unauthorized");
      const rules = evaluateDisarmRules({ ...record, ...live.saveConditions, saveAbility: intent.saveAbility });
      record = await this.#phase(record, "save-rolling", { saveAbility: intent.saveAbility, saveMode: rules.saveMode }, context);
      try {
        const saveRoll = await this.rollAdapter.save(live.targetActor, intent.saveAbility, rules.saveMode);
        record = await this.#phase(record, "save-resolved", { saveRoll, dropped: resolveDisarmOutcome({ attackTotal: record.attackRoll.total, saveTotal: saveRoll.total }).dropped }, context);
      } catch (error) {
        await context.assertAuthority();
        const current = await this.journal.find(record.id);
        if (current.phase !== "save-resolved") return this.#present(await this.#finish(current, "manual-review", { error: `Спасбросок не подтверждён: ${error.message}` }, context));
        record = current;
      }
      return this.#present(await this.#continueSave(record, context));
    });
  }
  async #continueSave(record, context) {
    try { return await this.#completeSave(record, context); }
    catch (error) {
      await context.assertAuthority();
      const current = await this.journal.find(record.id);
      if (current.terminal) return current;
      return this.#phase(current, current.phase, { error: error.message }, context);
    }
  }
  async #completeSave(record, context) {
    if (!record.dropped) return this.#finish(record, "completed", { error: null }, context);
    if (record.phase === "save-resolved") {
      try { await this.documents.revalidate(record); }
      catch (error) { return this.#finish(record, "conflict", { error: error.message }, context); }
      const points = await this.documents.dropPoints(record);
      if (!points.length) return this.#finish(record, "manual-review", { error: "Нет соседней точки без стены. Предмет не перемещён." }, context);
      record = await this.#phase(record, "direction-rolling", { dropPoints: points }, context);
      let directionRoll;
      try { directionRoll = await this.rollAdapter.direction(points.length); }
      catch (error) { return this.#finish(record, "manual-review", { error: error.message }, context); }
      const destination = points[directionRoll.total - 1];
      if (!destination) return this.#finish(record, "manual-review", { error: "Некорректный результат выбора точки." }, context);
      record = await this.#phase(record, "drop-prepared", { directionRoll, destination }, context);
    }
    if (record.phase === "drop-prepared") {
      // The storage owner has its own durable receipt. A retry never invokes another attack/save.
      const ground = await this.storageCommands.dropDisarmedItem({ operationId: record.intent.operationId }, { record, assertAuthority: context.assertAuthority });
      record = await this.#phase(record, "drop-committed", { ground }, context);
    }
    return this.#finish(record, "completed", { error: null }, context);
  }
  async resume(operationId, context) {
    return this.coordinator.run("disarm-operations", async () => {
      let record = await this.journal.find(this.#id(operationId));
      if (!record) throw new DisarmError("operation-not-found");
      this.#authorize(record, context, null);
      if (!record.terminal) {
        if (["attack-rolling", "save-rolling", "direction-rolling"].includes(record.phase)) record = await this.#finish(record, "manual-review", { error: "Прерванный бросок требует сверки; повторный бросок не выполнен." }, context);
        else if (record.phase === "attack-rolled") record = await this.#phase(record, "awaiting-save", {}, context);
        else if (record.phase === "prepared") record = await this.#attack(record, context);
        else if (["save-resolved", "drop-prepared", "drop-committed"].includes(record.phase)) record = await this.#continueSave(record, context);
      }
      return this.#present(record);
    });
  }
  async cancel(operationId, context) {
    return this.coordinator.run("disarm-operations", async () => {
      let record = await this.journal.find(this.#id(operationId));
      if (!record) throw new DisarmError("operation-not-found");
      this.#authorize(record, context);
      if (!record.terminal && ["prepared", "awaiting-baseline", "awaiting-save"].includes(record.phase)) record = await this.#finish(record, "cancelled", {}, context);
      return this.#present(record);
    });
  }
  async setBaseline(intent, context) {
    if (!this.#sender(context).isGM) throw new DisarmError("unauthorized");
    return this.coordinator.run("disarm-operations", async () => {
      let record = await this.journal.find(this.#id(intent.operationId));
      if (!record || record.phase !== "awaiting-baseline") throw new DisarmError("phase-conflict");
      const { attackPlan } = await this.documents.prepare(record.intent, this.gameProvider().users.get(record.senderId), { baseline: intent });
      if (!attackPlan.formula) throw new DisarmError("unresolved-roll-plan");
      record = await this.#phase(record, "prepared", { attackPlan, baselineDecision: { ...intent, gmId: context.sender.id } }, context);
      return this.#present(await this.#attack(record, context));
    });
  }
}
