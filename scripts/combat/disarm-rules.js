const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
export class DisarmError extends Error {
  constructor(code, message = code) { super(message); this.name = "DisarmError"; this.code = code; }
}
const mode = (advantage, disadvantage) => advantage === disadvantage ? "normal" : advantage ? "advantage" : "disadvantage";
const fail = () => { throw new DisarmError("invalid-disarm-rules", "Не удалось определить правила обезоруживания. Проверьте размер, руки и параметры броска."); };

export function evaluateDisarmRules({ attackerSize, targetSize, heldHands, saveAbility,
  attackAdvantage = false, attackDisadvantage = false, saveAdvantage = false, saveDisadvantage = false }) {
  const attacker = SIZES.indexOf(attackerSize), target = SIZES.indexOf(targetSize);
  if (attacker < 0 || target < 0 || !Number.isInteger(heldHands) || heldHands < 1
    || !["str", "dex"].includes(saveAbility)
    || ![attackAdvantage, attackDisadvantage, saveAdvantage, saveDisadvantage].every(v => typeof v === "boolean")) fail();
  return { allowed: target <= attacker + 1, reason: target > attacker + 1 ? "target-too-large" : null,
    attackMode: mode(attackAdvantage, attackDisadvantage || heldHands >= 2),
    saveMode: mode(saveAdvantage || (saveAbility === "str" && attacker < target), saveDisadvantage) };
}

export function resolveDisarmOutcome({ attackTotal, saveTotal }) {
  if (![attackTotal, saveTotal].every(Number.isFinite)) fail();
  return { dc: attackTotal, success: saveTotal < attackTotal, dropped: saveTotal < attackTotal };
}

export function buildDisarmAttackFormula({ abilityModifier, proficiencyContribution }) {
  if (![abilityModifier, proficiencyContribution].every(Number.isSafeInteger) || proficiencyContribution < 0) fail();
  return `1d20 ${abilityModifier < 0 ? "-" : "+"} ${Math.abs(abilityModifier)} + ${proficiencyContribution}`;
}

/** Centres of external square cells. Even footprints use the north/west middle cell. */
export function calculateDisarmDropCell({ tokenBounds, gridSize, direction }) {
  const { x, y, width, height } = tokenBounds ?? {};
  if (![x, y, width, height, gridSize].every(Number.isFinite) || width <= 0 || height <= 0 || gridSize <= 0
    || !Number.isInteger(direction) || direction < 1 || direction > 8) fail();
  const half = gridSize / 2;
  const middleX = x + Math.floor((Math.max(1, Math.ceil(width / gridSize)) - 1) / 2) * gridSize + Math.min(half, width / 2);
  const middleY = y + Math.floor((Math.max(1, Math.ceil(height / gridSize)) - 1) / 2) * gridSize + Math.min(half, height / 2);
  const left = x - half, right = x + width + half, top = y - half, bottom = y + height + half;
  const points = [[middleX, top], [right, top], [right, middleY], [right, bottom], [middleX, bottom], [left, bottom], [left, middleY], [left, top]];
  return { x: points[direction - 1][0], y: points[direction - 1][1] };
}
