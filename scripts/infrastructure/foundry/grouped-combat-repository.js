import { MODULE_ID } from "../../constants.js";
import { GROUPED_COMBAT_FLAG, combatantsOf } from "../../combat/turn-group-rules.js";

export const GROUPED_NATIVE_WRITES = new WeakSet();
const stateOf = combat => combat?.getFlag?.(MODULE_ID, GROUPED_COMBAT_FLAG) ?? combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG] ?? null;
const progressOptions = state => ({ render: false, turnEvents: false, [MODULE_ID]: { groupedCombatProgress: state?.mode === "active" && Boolean(state.pendingTransition) } });

export function isGroupedCombatProgressUpdate(combat, changed, options = {}) {
  if (options[MODULE_ID]?.groupedCombatProgress !== true || options.render !== false || options.turnEvents !== false) return false;
  const state = stateOf(combat), flags = changed?.flags, own = flags?.[MODULE_ID];
  return state?.mode === "active" && Boolean(state.pendingTransition) && (changed._id === undefined || changed._id === combat.id)
    && Object.keys(changed).every(key => key === "flags" || key === "_id")
    && Object.keys(flags ?? {}).length === 1 && Object.keys(own ?? {}).length === 1
    && [GROUPED_COMBAT_FLAG, `==${GROUPED_COMBAT_FLAG}`].includes(Object.keys(own ?? {})[0]);
}

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
  readState(combat) { return structuredClone(stateOf(combat)); }
  async withNativeChanges(combat, operation) {
    GROUPED_NATIVE_WRITES.add(combat);
    try { return await operation(); } finally { GROUPED_NATIVE_WRITES.delete(combat); }
  }
  async writeState(combat, state, { expectedRevision = 0 } = {}) {
    if ((stateOf(combat)?.revision ?? 0) !== expectedRevision) throw new Error("stale-combat");
    state.revision = expectedRevision + 1;
    await combat.update({ [`flags.${MODULE_ID}.==${GROUPED_COMBAT_FLAG}`]: structuredClone(state) }, progressOptions(state));
    return state;
  }
  async writeReceipt(combat, state, key, { expectedRevision = 0 } = {}) {
    const live = stateOf(combat);
    if ((live?.revision ?? 0) !== expectedRevision) throw new Error("stale-combat");
    if (!live?.pendingTransition || !state.receipts[key]) throw new Error("missing-combat-checkpoint");
    state.revision = expectedRevision + 1;
    const path = `flags.${MODULE_ID}.${GROUPED_COMBAT_FLAG}`;
    await combat.update({ [`${path}.revision`]: state.revision, [`${path}.receipts.==${key}`]: structuredClone(state.receipts[key]) }, progressOptions(state));
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
