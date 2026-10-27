const SCOPE = "rebreya-main";
const STATUS = "rebreya-decaying-damage";
const flag = (doc, key) => doc?.getFlag?.(SCOPE, key) ?? doc?.flags?.[SCOPE]?.[key];
const fail = (message, code = "decaying-recovery-rejected") => { throw Object.assign(new Error(message), { code }); };

export class DecayingRecoveryService {
  constructor(options) { Object.assign(this, options); }

  async start(intent, context) {
    const { sender, assertAuthority } = context;
    if (!sender?.id || this.user(sender.id) !== sender) fail("Нет доступа к операции.");
    if (!/^[\w:-]{1,128}$/u.test(intent.operationId) || !["manual", "bonus", "action"].includes(intent.action)
      || !Number.isSafeInteger(intent.amount) || !Number.isSafeInteger(intent.dc)) fail("Некорректные параметры операции.");
    const [source, target] = await Promise.all([this.resolve(intent.sourceTokenUuid), this.resolve(intent.targetTokenUuid)]);
    if (!source?.actor || !target?.actor || source.parent?.id !== this.sceneId() || target.parent?.id !== this.sceneId()) fail("Токены недоступны на активной сцене.");
    if (!sender.isGM && (source.actor.testUserPermission?.(sender, "OWNER") !== true || target.hidden)) fail("Нет доступа к лекарю или пациенту.");
    if (intent.action === "manual" && !sender.isGM && target.actor.testUserPermission?.(sender, "OWNER") !== true) fail("Нет доступа к ручному изменению пациента.");
    const id = `decaying-recovery:${intent.operationId}`;
    const fingerprint = JSON.stringify([sender.id, intent]);
    let record = await this.journal.find(id);
    if (record) {
      if (record.fingerprint !== fingerprint) fail("Идентификатор операции уже использован.");
      if (!record.terminal) fail("Незавершённую операцию должен проверить Мастер.", "manual-review");
      return record;
    }
    const effect = target.actor.effects?.contents?.find(e => e.id === intent.effectId && (e.statuses?.has?.(STATUS) || e.statuses?.includes?.(STATUS) || flag(e, "statusId") === STATUS));
    if (!effect) fail("Эффект затихающего урона больше недоступен.");
    const meta = flag(effect, "statusMeta") ?? {};
    const snapshot = JSON.stringify([flag(effect, "statusValue"), meta, effect._stats?.modifiedTime ?? null]);
    const step = Number(meta.step);
    if (!Number.isSafeInteger(step) || step < 1) fail("Некорректная степень затихания.");
    const origin = await this.sourceActor(meta.sourceActorId, effect, meta.sourceActorUuid);
    const rawProf = origin?.system?.attributes?.prof;
    const prof = Number(rawProf);
    const dc = rawProf !== null && rawProf !== undefined && rawProf !== "" && Number.isFinite(prof) ? 10 + prof : intent.dc;
    if (intent.action !== "manual" && (!Number.isInteger(dc) || dc < 1 || dc > 99)) fail("Укажите Сл от 1 до 99: источник эффекта недоступен.");
    if (intent.action === "manual" && (intent.amount < 1 || intent.amount > 1000000)) fail("Укажите положительное уменьшение.");
    await assertAuthority();
    record = await this.journal.start({ id, kind: "decaying-recovery", phase: "prepared", fingerprint, intent, senderId: sender.id, dc });
    const phase = async (next, patch = {}) => { await assertAuthority(); record = await this.journal.checkpoint(id, record.phase, next, patch); await assertAuthority(); };
    let success = true;
    if (intent.action !== "manual") {
      await phase("rolling");
      const roll = await this.roll(source.actor, dc);
      if (!roll || !Number.isFinite(roll.total)) fail("Не удалось подтвердить бросок; необходима проверка Мастера.", "manual-review");
      success = roll.total >= dc;
      await phase("rolled", { total: roll.total, roll: roll.toJSON(), success });
      await this.publish(record);
    }
    if (success) {
      await phase("applying");
      await assertAuthority();
      await this.reduce(target.actor, intent.effectId, intent.action === "manual" ? intent.amount : step * (intent.action === "action" ? 2 : 1), snapshot);
      await assertAuthority();
    }
    await phase("completed", { success });
    await assertAuthority();
    return this.journal.finish(id, { success });
  }
}
