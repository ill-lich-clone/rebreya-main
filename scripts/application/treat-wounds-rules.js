export class TreatWoundsError extends Error {
  constructor(code, message) { super(message); this.code = code; this.name = "TreatWoundsError"; }
}

export function getTreatWoundsTiers(level) {
  return [{ level: 0, dc: 10, bonus: 0 }, { level: 5, dc: 15, bonus: 10 },
    { level: 11, dc: 20, bonus: 30 }, { level: 17, dc: 25, bonus: 50 }]
    .filter(tier => tier.level === 0 || Number(level) >= tier.level).map(({ dc, bonus }) => ({ dc, bonus }));
}

export function resolveTreatWoundsOutcome({ total, dc, bonus }) {
  if (![total, dc, bonus].every(Number.isFinite)) throw new TreatWoundsError("invalid-roll", "Нет достоверного результата проверки.");
  const margin = total - dc;
  const kind = margin >= 5 ? "critical-success" : margin >= 0 ? "success" : margin <= -5 ? "critical-failure" : "failure";
  const canContinue = margin >= 0;
  return { kind, formula: margin >= 5 ? "4d8" : canContinue ? "2d8" : margin <= -5 ? "1d8" : null,
    bonus: canContinue ? bonus : 0, canContinue };
}
