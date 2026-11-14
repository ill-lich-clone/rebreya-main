import { TreatWoundsError, resolveTreatWoundsOutcome } from "./treat-wounds-rules.js?v=1.4.372";
const SCOPE = "rebreya-main";
const values = c => Array.from(c?.contents ?? c ?? []);
const flag = (a, k) => a.getFlag?.(SCOPE, k) ?? a.flags?.[SCOPE]?.[k];
const isImmunity = effect => Boolean(flag(effect, "treatWounds"));
const immunityDeadline = effect => {
  if (!isImmunity(effect)) return NaN;
  const startTime = effect.start?.time ?? effect.duration?.startTime;
  const seconds = effect.duration?.seconds;
  return startTime != null && Number.isFinite(Number(startTime)) && seconds != null && Number.isFinite(Number(seconds))
    ? Number(startTime) + Number(seconds) : NaN;
};
const reject = (code, text) => { throw new TreatWoundsError(code, text); };
function serialize(roll) {
  if (!Number.isFinite(roll?.total)) reject("invalid-roll", "Бросок не вернул подтверждённого результата.");
  return { total: roll.total, json: roll.toJSON() };
}

/** All decisions persist in the existing inventory journal; UI waits occur outside mutation queues. */
export class TreatWoundsService {
  constructor(options) { Object.assign(this, options); }
  #expiryIndexed = false;
  #expiryActors = null;
  #tokenTargets = new Map();

  registerExpiryIndex(hooks = globalThis.Hooks) {
    if (this.#expiryIndexed || typeof hooks?.on !== "function") return;
    this.#expiryIndexed = true;
    const actorChanged = (actor, dependents = true) => {
      if (!this.#expiryActors || !actor?.uuid) return;
      this.#trackExpiryActor(actor);
      if (dependents && !actor.isToken) for (const token of actor.getDependentTokens?.({concreteOnly: true}) ?? []) this.#trackExpiryToken(token);
    };
    hooks.on("createActor", actor => actorChanged(actor));
    hooks.on("updateActor", (actor, changes) => {
      if (Object.keys(changes ?? {}).some(key => key === "effects" || key.startsWith("effects."))) actorChanged(actor);
    });
    hooks.on("deleteActor", actor => {
      this.#expiryActors?.delete(actor.uuid);
      for (const token of actor.getDependentTokens?.({concreteOnly: true}) ?? []) this.#forgetExpiryToken(token);
    });
    for (const event of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      hooks.on(event, effect => {
        const actor = effect.parent;
        if (actor?.effects && (!actor.documentName || actor.documentName === "Actor")
          && (isImmunity(effect) || this.#expiryActors?.has(actor.uuid))) actorChanged(actor);
      });
    }
    hooks.on("createToken", token => this.#trackExpiryToken(token));
    hooks.on("updateToken", (token, changes) => {
      if (Object.keys(changes ?? {}).some(key => ["actorId", "actorLink", "delta", "actorData"].includes(key.split(".")[0]))) this.#trackExpiryToken(token);
    });
    hooks.on("deleteToken", token => this.#forgetExpiryToken(token));
    const refreshScene = scene => {
      for (const uuid of this.#tokenTargets.keys()) if (uuid.startsWith(`${scene.uuid}.Token.`)) this.#forgetExpiryToken({uuid});
      for (const token of values(scene.tokens)) this.#trackExpiryToken(token);
    };
    hooks.on("createScene", refreshScene);
    hooks.on("updateScene", (scene, changes) => { if (Object.hasOwn(changes ?? {}, "tokens")) refreshScene(scene); });
    hooks.on("deleteScene", scene => { for (const token of values(scene.tokens)) this.#forgetExpiryToken(token); });
  }

  #trackExpiryActor(actor) {
    if (!actor?.uuid || !this.#expiryActors || actor.inCompendium || actor.pack || actor.token?.parent?.inCompendium) return;
    if (values(actor.effects).some(isImmunity)) {
      this.#expiryActors.set(actor.uuid, actor);
      if (actor.token?.uuid) this.#tokenTargets.set(actor.token.uuid, actor.uuid);
    } else {
      this.#expiryActors.delete(actor.uuid);
      if (actor.token?.uuid) this.#tokenTargets.delete(actor.token.uuid);
    }
  }

  #forgetExpiryToken(token) {
    this.#expiryActors?.delete(this.#tokenTargets.get(token.uuid));
    this.#tokenTargets.delete(token.uuid);
  }

  #trackExpiryToken(token) {
    if (!this.#expiryActors || token.inCompendium || token.pack || token.parent?.inCompendium) return;
    this.#forgetExpiryToken(token);
    const actor = token.actor;
    if (!actor) return;
    this.#trackExpiryActor(actor);
    if (token.uuid && (actor.isToken ?? !token.actorLink) && this.#expiryActors.has(actor.uuid)) this.#tokenTargets.set(token.uuid, actor.uuid);
  }

  async cleanupExpiredEffects(worldTime = Number(this.gameProvider().time.worldTime)) {
    if (!Number.isFinite(worldTime) || !this.isActiveGm?.()) return 0;
    return this.coordinator.run("treat-wounds", async () => {
      if (!this.isActiveGm()) return 0;
      let removed = 0;
      if (!this.#expiryIndexed || !this.#expiryActors) {
        this.#expiryActors = new Map();
        this.#tokenTargets.clear();
        const game = this.gameProvider();
        for (const actor of values(game.actors)) this.#trackExpiryActor(actor);
        for (const scene of values(game.scenes)) for (const token of values(scene.tokens)) this.#trackExpiryToken(token);
      }
      for (const actor of [...this.#expiryActors.values()]) {
        if (!this.isActiveGm()) return removed;
        const expired = values(actor.effects).filter(e => immunityDeadline(e) <= worldTime).map(e => e.id);
        for (const id of expired) {
          if (!this.isActiveGm()) return removed;
          if (this.#expiryActors.get(actor.uuid) !== actor) break;
          const live = actor.effects?.get?.(id) ?? values(actor.effects).find(e => e.id === id);
          if (!live || !(immunityDeadline(live) <= worldTime)) continue;
          try {
            await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
            removed++;
          } catch (error) {
            if (error?.message !== `ActiveEffect "${id}" does not exist!`) throw error;
          }
        }
        if (this.#expiryActors.get(actor.uuid) === actor) this.#trackExpiryActor(actor);
      }
      return removed;
    });
  }
  #sender(context) {
    const sender = context.sender;
    if (!sender?.id || this.gameProvider().users.get(sender.id) !== sender) reject("unauthorized", "Пользователь не определён.");
    return sender;
  }
  #key(operationId) {
    if (typeof operationId !== "string" || !/^[\w:-]{1,128}$/u.test(operationId)) reject("invalid-operation", "Некорректная операция.");
    return `treat-wounds:${operationId}`;
  }
  async #write(context, action) { await context.assertAuthority(); const r = await action(); await context.assertAuthority(); return r; }
  async #phase(record, phase, patch, context) {
    return this.#write(context, () => this.journal.checkpoint(record.id, record.phase, phase, patch));
  }
  async #present(record) {
    if (!record.medicineRoll) return;
    if (!record.id.endsWith(":continue") && record.phase === "completed") {
      let continuation;
      try { continuation = await this.journal.find(`${record.id}:continue`); } catch { /* Chat publication remains possible during a journal outage. */ }
      if (continuation) record = continuation;
    }
    await this.publish(record);
  }
  async #error(record, error, context) {
    let current;
    try { current = await this.journal.find(record.id); } catch { /* Retain the known roll in memory for publication. */ }
    const patch = { applicationError: error.message };
    let phase = current?.phase;
    if (record.medicineRoll && !current?.medicineRoll) { patch.medicineRoll = record.medicineRoll; patch.outcome = record.outcome; phase = "medicine-rolled"; }
    if (Number.isFinite(record.amount) && !Number.isFinite(current?.amount)) { patch.amount = record.amount; patch.resultRoll = record.resultRoll; phase = "rolled"; }
    if (current && !current.terminal) {
      try { record = await this.#phase(current, phase, patch, context); }
      catch { record = { ...current, ...record, ...patch }; }
    } else record = { ...current ?? record, applicationError: error.message };
    try { await this.#present(record); } catch (publishError) { console.error("rebreya-main | Перевязка: результат сохранён, публикация не удалась", publishError); }
    throw error;
  }
  async preview(intent, context) { this.#sender(context); await context.assertAuthority(); return this.documents.preview(intent, context.sender); }
  start(intent, context) {
    // One short queue for treatment decisions; inventory debit uses canonical inventory queue inside it.
    return this.coordinator.run("treat-wounds", async () => {
      const sender = this.#sender(context), id = this.#key(intent.operationId);
      const fingerprint = JSON.stringify([sender.id, ...Object.keys(intent).sort().map(key => [key, intent[key]])]);
      let record = await this.journal.find(id);
      if (record) {
        if (record.fingerprint !== fingerprint) reject("operation-conflict", "ID перевязки уже использован с другими параметрами.");
        return this.#resume(record, context);
      }
      await context.assertAuthority();
      const prepared = await this.documents.prepare(intent, sender);
      const target = prepared.target.actor, now = Number(this.gameProvider().time.worldTime);
      if (!Number.isFinite(now)) reject("invalid-time", "Не удалось прочитать мировое время.");
      const immunity = values(target.effects).some(e => immunityDeadline(e) > now);
      if (immunity) reject("cooldown", "Цель иммунна к перевязке до окончания часового эффекта.");
      const pending = (await this.journal.listPending()).find(r => r.kind === "treat-wounds" && !["completed", "cancelled"].includes(r.phase)
        && (r.targetActorUuid === target.uuid || r.sourceActorUuid === prepared.source.actor.uuid));
      if (pending) reject("operation-pending", "Предыдущая перевязка ещё не завершена. Восстановите её из карточки чата.");
      record = await this.#write(context, () => this.journal.start({ id, kind: "treat-wounds", fingerprint, intent, senderId: sender.id,
        phase: "prepared", sourceActorUuid: prepared.source.actor.uuid, targetActorUuid: target.uuid,
        sourceName: prepared.source.name, targetName: prepared.target.name, startTime: now, dc: prepared.dc, bonus: prepared.tier.bonus,
        withoutKit: prepared.withoutKit === true }));
      try {
        record = await this.#phase(record, "medicine-rolling", {}, context);
        const medicine = await this.adapter.rollMedicine(prepared.source.actor, { dc: record.dc });
        if (!medicine) {
          record = await this.#phase(record, "cancelled", {}, context);
          return this.#write(context, () => this.journal.finish(id, { cancelled: true }));
        }
        const medicineRoll = serialize(medicine);
        const outcome = resolveTreatWoundsOutcome({ total: medicineRoll.total, dc: record.dc, bonus: record.bonus });
        record = { ...record, medicineRoll, outcome };
        record = await this.#phase(record, "medicine-rolled", { medicineRoll, outcome }, context);
        // A performed check is visible even if the outcome roll or any later mutation fails.
        await this.#present(record);
        return await this.#resume(record, context);
      } catch (error) { return this.#error(record, error, context); }
    });
  }
  resume({ operationId }, context) {
    return this.coordinator.run("treat-wounds", async () => {
      const record = await this.journal.find(this.#key(operationId));
      if (!record) reject("operation-not-found", "Перевязка не найдена.");
      return this.#resume(record, context);
    });
  }
  async #authorize(record, context) {
    const sender = this.#sender(context);
    if (!sender.isGM && sender.id !== record.senderId) reject("unauthorized", "Это перевязка другого пользователя.");
    const source = await this.documents.resolve(record.sourceActorUuid);
    if (!source || (!sender.isGM && source.testUserPermission?.(sender, "OWNER") !== true)) reject("unauthorized", "Лекарь больше недоступен этому пользователю.");
    await context.assertAuthority();
  }
  async #resume(record, context) {
    await this.#authorize(record, context);
    if (record.terminal) { await this.#present(record); return record; }
    try {
      if (["prepared", "medicine-rolling", "result-rolling"].includes(record.phase)) reject("manual-review", "Нельзя безопасно повторить незавершённый бросок. Нужна проверка Мастера.");
      if (record.phase === "medicine-rolled") {
        await this.#present(record);
        record = await this.#phase(record, "result-rolling", {}, context);
        const result = await this.adapter.rollResult(record.outcome);
        const resultRoll = result ? serialize(result) : null;
        const amount = (resultRoll?.total ?? 0) + record.outcome.bonus;
        record = { ...record, resultRoll, amount };
        record = await this.#phase(record, "rolled", { resultRoll, amount }, context);
      }
      await this.#present(record);
      const target = await this.documents.resolve(record.targetActorUuid);
      if (!target) reject("target-not-found", "Пациент больше не существует.");
      if (flag(target, "treatWoundsHealthReceipt") !== record.intent.operationId && !this.adapter.isLiving(target)) reject("invalid-target", "Пациент больше не жив; перевязка не может его воскресить.");
      if (record.phase === "rolled") {
        if (record.withoutKit !== true) {
          await this.inventoryService.consumeTreatWoundsKitOnce({ operationId: record.intent.operationId, sourceActorUuid: record.sourceActorUuid,
            kitItemUuid: record.intent.kitItemUuid, groupActorId: record.intent.groupActorId }, { ...context, operationSenderId: record.senderId });
        }
        record = await this.#phase(record, "kit-debited", {}, context);
      }
      if (record.phase === "kit-debited") {
        const existing = values(target.effects).find(e => flag(e, "treatWounds")?.operationId === record.intent.operationId);
        if (!existing) await this.#write(context, () => target.createEmbeddedDocuments("ActiveEffect", [{
          name: "Перевязка ран: иммунитет", img: "icons/skills/wounds/injury-face-impact-orange.webp",
          origin: record.sourceActorUuid, duration: { seconds: 3600, startTime: record.startTime }, changes: [],
          flags: { [SCOPE]: { treatWounds: { operationId: record.intent.operationId } } }
        }]));
        this.#trackExpiryActor(target);
        record = await this.#phase(record, "effect-created", {}, context);
      }
      if (record.phase === "effect-created") {
        const plan = this.adapter.planResult(target, { kind: record.outcome.kind, amount: record.amount, operationId: record.intent.operationId });
        plan.updates[`flags.${SCOPE}.treatWoundsLatestOperation`] = record.intent.operationId;
        record = await this.#phase(record, "health-prepared", { plan }, context);
      }
      if (record.phase === "health-prepared") {
        await this.#write(context, () => this.adapter.applyResult(target, record.plan));
        record = await this.#phase(record, "completed", { applicationError: null }, context);
      }
      if (record.phase === "completed") record = await this.#write(context, () => this.journal.finish(record.id, { completed: true }));
      await this.#present(record);
      return record;
    } catch (error) { return this.#error(record, error, context); }
  }
  continue({ operationId }, context) {
    return this.coordinator.run("treat-wounds", async () => {
      const original = await this.journal.find(this.#key(operationId));
      if (!original || original.phase !== "completed" || !original.outcome.canContinue) reject("cannot-continue", "Продолжение возможно только после успешной завершённой перевязки.");
      await this.#authorize(original, context);
      const target = await this.documents.resolve(original.targetActorUuid);
      if (!target || flag(target, "treatWoundsLatestOperation") !== operationId) reject("stale-treatment", "Старую перевязку нельзя продолжить после начала новой.");
      const pending = (await this.journal.listPending()).some(r => r.kind === "treat-wounds" && !r.id.endsWith(":continue")
        && r.targetActorUuid === original.targetActorUuid && r.intent.operationId !== operationId);
      if (pending) reject("stale-treatment", "У пациента уже начата новая перевязка.");
      const id = `${original.id}:continue`;
      let record = await this.journal.find(id);
      if (record?.terminal) { await this.#present(record); return record; }
      try {
        if (flag(target, "treatWoundsHealthReceipt") !== `${operationId}:continue` && !this.adapter.isLiving(target)) reject("invalid-target", "Пациент больше не жив; продолжение не может его воскресить.");
        if (!record) {
          const plan = this.adapter.planResult(target, { kind: original.outcome.kind, amount: original.amount, operationId: `${operationId}:continue` });
          record = await this.#write(context, () => this.journal.start({ ...original, id, terminal: false, phase: "continuation-prepared", plan, applicationError: null }));
        }
        await this.#write(context, () => this.adapter.applyResult(target, record.plan));
        record = await this.#phase(record, "completed", { continued: true, applicationError: null }, context);
        record = await this.#write(context, () => this.journal.finish(id, { continued: true }));
        await this.#present(record); return record;
      } catch (error) { return record ? this.#error(record, error, context) : Promise.reject(error); }
    });
  }
}
