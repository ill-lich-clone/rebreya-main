/** Keep the original d20 and its critical/advantage options while persisting the bonus. */
export function appendD20Bonus(roll, bonusRoll, { sign = 1 } = {}) {
  const amount = Math.max(0, Math.floor(Number(bonusRoll?.total)));
  if (!Number.isFinite(amount) || !Number.isFinite(Number(roll?.total))) {
    throw new Error("Не удалось определить результат доброса.");
  }
  const total = Number(roll.total) + (sign < 0 ? -amount : amount);
  if (Array.isArray(roll.terms)) {
    const { OperatorTerm, NumericTerm } = globalThis.foundry.dice.terms;
    roll.terms.push(
      new OperatorTerm({ operator: sign < 0 ? "-" : "+" }),
      new NumericTerm({ number: amount, options: { rebreyaD20Bonus: { formula: bonusRoll?.formula ?? "" } } })
    );
    roll._formula = roll.constructor.getFormula(roll.terms);
  }
  roll._total = total;
  try { roll.total = total; } catch { /* Foundry exposes total as a getter. */ }
}

export function isAvailableD20BonusEffect(effect, worldTime = globalThis.game?.time?.worldTime) {
  if (!effect || effect.disabled === true || effect.transfer === true || effect.isSuppressed === true) return false;
  const duration = effect.duration;
  if (duration?.remaining != null && Number(duration.remaining) <= 0) return false;
  return !(duration?.startTime != null && Number(duration.seconds) > 0
    && Number(worldTime) >= Number(duration.startTime) + Number(duration.seconds));
}
const actorOperations = new WeakMap();

/** Both attack and ordinary d20 consumers share this canonical actor queue. */
export function runD20BonusOperation(actor, operation) {
  const previous = actorOperations.get(actor) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation).finally(() => {
    if (actorOperations.get(actor) === pending) actorOperations.delete(actor);
  });
  actorOperations.set(actor, pending);
  return pending;
}
