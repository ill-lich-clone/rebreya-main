const wrappedPrototypes = new WeakSet();

function hasPotentialRoundRecovery(recovery) {
  return !Array.isArray(recovery)
    || recovery.some(profile => typeof profile?.period !== "string" || profile.period === "round");
}

export function installDnd5eRoundRecoveryOptimization({
  system = globalThis.game?.system,
  itemModels = globalThis.CONFIG?.Item?.dataModels
} = {}) {
  if (system?.id !== "dnd5e" || system.version !== "6.0.6") return;

  for (const model of Object.values(itemModels ?? {})) {
    let prototype = model?.prototype;
    while (prototype && !Object.hasOwn(prototype, "recoverUses")) {
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!prototype || wrappedPrototypes.has(prototype)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "recoverUses");
    const original = descriptor.value;
    if (!descriptor.writable || typeof original !== "function"
      || !Function.prototype.toString.call(original).includes("UsesField.recoverUses.call")) continue;

    prototype.recoverUses = async function rebreyaRoundRecovery(periods, ...args) {
      // Round-only calls cannot trigger NPC turn-start recharge in this version.
      if (periods instanceof Map && periods.size === 1 && periods.has("round")
        && !hasPotentialRoundRecovery(this.uses?.recovery)
        && typeof this.activities?.some === "function"
        && !this.activities.some(activity => !activity
          || (activity.uses != null && hasPotentialRoundRecovery(activity.uses.recovery)))) {
        return { updates: {}, rolls: [], destroy: this.uses.autoDestroy && false };
      }
      return original.call(this, periods, ...args);
    };
    wrappedPrototypes.add(prototype);
  }
}
