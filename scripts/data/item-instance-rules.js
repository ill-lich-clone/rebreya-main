export class ItemInstanceError extends Error {
  constructor(code, message) { super(message); this.name = "ItemInstanceError"; this.code = code; }
}

export function planItemInstanceMutation({ source, quantity, sameActor, sameFolder, forHeroSlot }) {
  const step = source?.step;
  const total = source?.quantity;
  if (![step, total, quantity].every(Number.isFinite) || step <= 0 || total <= 0 || quantity <= 0 || quantity > total) {
    throw new ItemInstanceError("invalid-quantity", "Количество должно быть положительным и не превышать остаток.");
  }
  const material = step === 1e-12;
  const scale = material ? 1 : 100000;
  const units = value => {
    if (material) {
      if (Number(value.toFixed(12)) !== value) throw new ItemInstanceError("invalid-quantity", "Неподдерживаемая точность количества.");
      return value;
    }
    const scaled = value * scale;
    const integer = Math.round(scaled);
    if (!Number.isSafeInteger(integer) || Math.abs(scaled - integer) > 1e-6) {
      throw new ItemInstanceError("invalid-quantity", "Неподдерживаемая точность количества.");
    }
    return integer;
  };
  const stepUnits = units(step), totalUnits = units(total), movedUnits = units(quantity);
  if ((!material && (stepUnits < 1 || totalUnits % stepUnits || movedUnits % stepUnits)) || (forHeroSlot && quantity !== 1)) {
    throw new ItemInstanceError("invalid-quantity", "Количество не соответствует шагу предмета или слоту героя.");
  }
  if (sameActor && sameFolder && !forHeroSlot) return { kind: "noop", quantity, sourceRemaining: total, preserveSourceId: true };
  if (quantity === total) return { kind: sameActor ? "membership" : "move", quantity, sourceRemaining: sameActor ? total : 0, preserveSourceId: Boolean(sameActor) };
  if (["hasContents", "hasInstalledUpgrades", "hasIndependentState", "isEquipped", "isHeld"].some(key => source[key])) {
    throw new ItemInstanceError("complex-stack", "Предмет с индивидуальным состоянием нельзя разделить автоматически. Нужна сверка экземпляров.");
  }
  return { kind: "split", quantity, sourceRemaining: material ? Number((total - quantity).toFixed(12)) : (totalUnits - movedUnits) / scale, preserveSourceId: false };
}
