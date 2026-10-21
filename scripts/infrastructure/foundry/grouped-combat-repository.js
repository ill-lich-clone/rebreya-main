import { MODULE_ID } from "../../constants.js";
import { GROUPED_COMBAT_FLAG, combatantsOf } from "../../combat/turn-group-rules.js";

export const GROUPED_NATIVE_WRITES = new WeakSet();

export class GroupedCombatRepository {
  constructor({ gameProvider = () => globalThis.game } = {}) { this.gameProvider = gameProvider; }
  getCombat(id) { return this.gameProvider()?.combats?.get?.(id); }
  getActiveCombat(sceneId) {
    const game = this.gameProvider();
    return Array.from(game?.combats?.contents ?? game?.combats ?? []).find(c => c.isActive && (c.scene?.id ?? c.sceneId) === sceneId) ?? null;
  }
  async createCombat(sceneId) {
    const CombatClass = globalThis.CONFIG?.Combat?.documentClass ?? globalThis.Combat;
    return CombatClass.create({ scene: sceneId, active: true });
  }
  readState(combat) { return structuredClone(combat?.getFlag?.(MODULE_ID, GROUPED_COMBAT_FLAG) ?? combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG] ?? null); }
  async withNativeChanges(combat, operation) {
    GROUPED_NATIVE_WRITES.add(combat);
    try { return await operation(); } finally { GROUPED_NATIVE_WRITES.delete(combat); }
  }
  async writeState(combat, state, { expectedRevision = 0 } = {}) {
    if ((this.readState(combat)?.revision ?? 0) !== expectedRevision) throw new Error("stale-combat");
    state.revision = expectedRevision + 1;
    await combat.update({ [`flags.${MODULE_ID}.==${GROUPED_COMBAT_FLAG}`]: structuredClone(state) }, { render: false, turnEvents: false });
    return state;
  }
  async createMissingCombatants(combat, tokens) {
    const existing = combatantsOf(combat);
    const data = tokens.filter(t => !existing.some(c => c.tokenId === t.id || c.token?.id === t.id)).map(t => ({ tokenId: t.id, actorId: t.actor.id, sceneId: t.parent.id, hidden: t.hidden === true }));
    if (data.length) await this.withNativeChanges(combat, () => combat.createEmbeddedDocuments("Combatant", data, { turnEvents: false }));
  }
  async commitNativePosition(combat, position, options = {}) {
    GROUPED_NATIVE_WRITES.add(combat);
    try {
      if (options.turnEvents !== false) globalThis.Hooks?.callAll?.(position.round !== combat.round ? "combatRound" : "combatTurn", combat, position, options);
      await combat.update(position, { ...options, [MODULE_ID]: { groupedNative: true } });
    }
    finally { GROUPED_NATIVE_WRITES.delete(combat); }
  }
  async beginCombat(combat, position) {
    const hook = globalThis.Hooks?.on?.("combatStart", (document, update) => { if (document === combat) Object.assign(update, position); });
    GROUPED_NATIVE_WRITES.add(combat);
    try { await combat.startCombat(); }
    finally { GROUPED_NATIVE_WRITES.delete(combat); if (hook != null) globalThis.Hooks.off("combatStart", hook); }
  }
}
