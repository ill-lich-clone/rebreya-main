import { TreatWoundsError } from "../application/treat-wounds-rules.js?v=1.4.372";
const SCOPE = "rebreya-main";
const flag = (actor, key) => actor.getFlag?.(SCOPE, key) ?? actor.flags?.[SCOPE]?.[key];
const hpSnapshot = actor => ({ value: Number(actor.system.attributes.hp.value),
  max: Number(actor.system.attributes.hp.effectiveMax ?? Math.max(Number(actor.system.attributes.hp.max) + Number(actor.system.attributes.hp.tempmax ?? 0), 0)),
  temp: Number(actor.system.attributes.hp.temp ?? 0),
  failure: Number(actor.system.attributes.death?.failure ?? 0), success: Number(actor.system.attributes.death?.success ?? 0) });

/** Verified against installed dnd5e 5.2.5 Actor5e.rollSkill and applyDamage health-pool rules. */
export class TreatWoundsDnd5eAdapter {
  constructor({ RollClass = globalThis.Roll } = {}) { this.RollClass = RollClass; }
  level(actor) { return Number(actor?.system?.details?.[actor?.type === "npc" ? "cr" : "level"] ?? 0); }
  hasMedicineProficiency(actor) { return Number(actor?.system?.skills?.med?.value ?? 0) >= 1; }
  isLiving(actor) {
    const hp = actor?.system?.attributes?.hp;
    const creatureType = actor?.system?.details?.type?.value ?? actor?.system?.details?.type;
    return ["character", "npc"].includes(actor?.type) && Number.isFinite(Number(hp?.value))
      && Number.isFinite(Number(hp?.max)) && Number(hp?.max) > 0
      && !["undead", "construct"].includes(creatureType) && !actor?.statuses?.has?.("dead")
      && Number(actor?.system?.attributes?.death?.failure ?? 0) < 3;
  }
  kitState(item) {
    const identity = item?.getFlag?.(SCOPE, "gearId") ?? item?.flags?.[SCOPE]?.gearId;
    const isKit = identity === "komplekt-tselitelya" || (!identity && ["комплект целителя", "healer's kit", "healer’s kit"].includes(String(item?.name ?? "").trim().toLowerCase()));
    const quantity = Number(item?.system?.quantity);
    const uses = item?.system?.uses;
    const max = uses?.max;
    const noPool = !uses || max === "" || max === null || max === undefined;
    const unspent = (!uses || Number(uses.spent ?? 0) === 0)
      && (noPool || (Number.isFinite(Number(max)) && Number(max) > 0));
    return { eligible: isKit && Number.isSafeInteger(quantity) && quantity > 0 && unspent, quantity,
      reason: !isKit ? "Это не комплект целителя." : !unspent ? "Требуется целый неиспользованный комплект." : "Нет целого комплекта." };
  }
  async rollMedicine(actor, { dc }) {
    const rolls = await actor.rollSkill({ skill: "med", ability: "wis", target: dc }, { configure: false }, { create: false });
    return rolls?.[0] ?? null;
  }
  async rollResult(outcome) {
    return outcome.formula ? new this.RollClass(outcome.formula).evaluate() : null;
  }
  planResult(actor, { kind, amount, operationId }) {
    const before = hpSnapshot(actor);
    if (!Number.isFinite(amount) || amount < 0 || !Object.values(before).every(Number.isFinite)) throw new TreatWoundsError("invalid-hp", "Некорректные хиты пациента.");
    const updates = {};
    if (["success", "critical-success"].includes(kind)) {
      updates["system.attributes.hp.value"] = Math.min(before.max, before.value + amount);
      updates["system.attributes.death.failure"] = 0;
    } else if (kind === "critical-failure") {
      // Pure piercing bypasses all damage traits; temp HP absorb damage as in native applyDamage.
      const absorbed = Math.min(before.temp, amount);
      updates["system.attributes.hp.temp"] = before.temp - absorbed;
      updates["system.attributes.hp.value"] = Math.max(0, before.value - amount + absorbed);
    }
    updates[`flags.${SCOPE}.treatWoundsHealthReceipt`] = operationId;
    const restoreDeathSuccess = before.value <= 0 && updates["system.attributes.hp.value"] > 0 && before.success > 0;
    return { before, updates, operationId, restoreDeathSuccess };
  }
  async applyResult(actor, plan) {
    if (flag(actor, "treatWoundsHealthReceipt") !== plan.operationId) {
      if (JSON.stringify(hpSnapshot(actor)) !== JSON.stringify(plan.before)) throw new TreatWoundsError("manual-review", "Хиты изменились во время лечения. Нужна проверка Мастера; бросок сохранён в чате.");
      try { await actor.update(plan.updates); }
      catch (error) { if (flag(actor, "treatWoundsHealthReceipt") !== plan.operationId) throw error; }
    }
    // Actor5e._preUpdate resets both counters on recovery from 0 HP. Restore only the saved successes.
    if (plan.restoreDeathSuccess && flag(actor, "treatWoundsDeathSuccessReceipt") !== plan.operationId) {
      const current = Number(actor.system.attributes.death.success);
      if (current !== 0 && current !== plan.before.success) throw new TreatWoundsError("manual-review", "Спасброски от смерти изменились во время лечения. Нужна проверка Мастера.");
      try { await actor.update({ "system.attributes.death.success": plan.before.success, [`flags.${SCOPE}.treatWoundsDeathSuccessReceipt`]: plan.operationId }); }
      catch (error) { if (flag(actor, "treatWoundsDeathSuccessReceipt") !== plan.operationId) throw error; }
    }
  }
}
