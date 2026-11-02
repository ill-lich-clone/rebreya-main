/** The original automatic +1. Authored formulas, conditional rows and later phases are distinct mechanics. */
export function isPlainFirearmBonus(change) {
  if (!change || !(change.type == null ? change.mode === 2 : change.type === "add")) return false;
  const condition=change.conditions;
  return (change.value === 1 || change.value === "1")
    && (!change.phase || change.phase === "initial") && !change.replacement
    && (change.priority == null || change.priority === 20)
    && (condition == null || condition === "" || condition === "{}"
      || (typeof condition === "object" && !Array.isArray(condition) && !Object.keys(condition).length));
}
