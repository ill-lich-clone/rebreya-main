import { MODULE_ID } from "../constants.js";
import { combatFlagKey, GROUPED_COMBAT_FLAG } from "../combat/turn-group-rules.js?v=1.5.66";

const stateOf = combat => combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG];
const eventFor = { "turn-start": "turnStart", "turn-end": "turnEnd", "round-start": "roundStart", "round-end": "roundEnd" };
const specialEdge = { sourceStart: "turnStart", sourceEnd: "turnEnd", targetStart: "turnStart", targetEnd: "turnEnd" };
const installed = new WeakSet();

function anchorFor(effect, combat, state) {
  const { start } = effect;
  const signature = JSON.stringify([start.round, start.turn, start.combatant]);
  const existing = state.durationAnchors?.[combatFlagKey(effect.uuid)];
  if (existing?.signature === signature) return existing;
  const id = combat.turns[start.turn ?? 0]?.id;
  return { signature, round: start.round, groupId: state.groups.find(g => g.memberIds.includes(id))?.id };
}

// Let core format, convert, and notify durations using its own method. In a shared turn
// its ordinal distance is measured in groups instead of native Combatant array indexes.
export function prepareGroupedDuration(wrapped, duration, context) {
  const combat = this.start?.combat;
  const state = stateOf(combat);
  if (duration.units !== "turns" || !combat?.started || !["active", "blocked"].includes(state?.mode) || !state.groups.length) {
    return wrapped(duration, context);
  }
  const anchor = anchorFor(this, combat, state);
  const phase = context?.rebreyaGroupPhase;
  const position = phase?.groupId ? phase : state.executionPosition ?? state.current;
  const from = state.groups.findIndex(g => g.id === anchor.groupId);
  const to = state.groups.findIndex(g => g.id === position?.groupId);
  if (from < 0 || to < 0 || !Number.isFinite(anchor.round)) return wrapped(duration, context);
  const elapsed = (position.round - anchor.round) * state.groups.length + to - from;
  return wrapped(duration, { ...context, round: anchor.round, turn: (this.start.turn ?? 0) + Math.max(0, elapsed) });
}

export function isGroupedExpiryEvent(wrapped, event, context) {
  const phase = context?.rebreyaGroupPhase;
  const combat = context?.combat;
  const expiry = this.duration.expiry;
  if (!phase || !["turnStart", "turnEnd"].includes(event) || !(expiry in specialEdge || expiry === event)) {
    return wrapped(event, context);
  }
  if (specialEdge[expiry] && specialEdge[expiry] !== event) return false;
  const start = this.start;
  const special = !!specialEdge[expiry];
  if (special && !start.combat) return true;
  if (start.combat && start.combat !== combat) return special ? false : wrapped(event, context);
  const member = special || start.combat !== combat
    ? combat.getCombatantsByActor(expiry.startsWith("source") ? this.getSourceActor() : this.actor)[0]
    : combat.combatants.get(start.combatant);
  if (!member) return special || globalThis.game?.modules?.get("dae")?.active ? start.round < phase.round : false;
  if (!phase.memberIds.includes(member.id)) return false;
  return !special || start.round !== phase.round || anchorFor(this, combat, stateOf(combat)).groupId !== phase.groupId;
}

export function installV14EffectGuards(EffectClass, libWrapper) {
  if (!EffectClass?.prototype) return false;
  if (installed.has(EffectClass)) return true;
  const callbacks = { isExpiryEvent: isGroupedExpiryEvent, _prepareCombatBasedDuration: prepareGroupedDuration };
  if (!Object.keys(callbacks).every(key => typeof EffectClass.prototype[key] === "function")) return false;
  for (const [key, fn] of Object.entries(callbacks)) {
    if (libWrapper) libWrapper.register(MODULE_ID, `CONFIG.ActiveEffect.documentClass.prototype.${key}`, fn, "MIXED");
    else {
      const original = EffectClass.prototype[key];
      EffectClass.prototype[key] = function (...args) { return fn.call(this, original.bind(this), ...args); };
    }
  }
  installed.add(EffectClass);
  return true;
}

export function planV14Expiry(combat, phase, state, registry, add) {
  const event = eventFor[phase.kind];
  if (!event) return;
  for (const effect of registry) {
    if (effect.start?.combat !== combat || !(effect.duration.units === "turns" || specialEdge[effect.duration.expiry])) continue;
    state.durationAnchors ??= {};
    state.durationAnchors[combatFlagKey(effect.uuid)] = anchorFor(effect, combat, state);
  }
  // The real registry retains native DAE expiryMode, dependent cleanup, UI notifications
  // and removal-before-await ordering even when a world-time refresh overlaps a group phase.
  add("foundry", null, "effect-registry", () => registry.refresh(event, {
    combat, round: phase.round, turn: combat.turn, skipped: false, rebreyaGroupPhase: phase
  }));
}

export function planV14RegionEvents(combat, phase, selected, add) {
  const event = eventFor[phase.kind];
  if (!event) return;
  const name = `token${event.charAt(0).toUpperCase()}${event.slice(1)}`;
  for (const member of selected) for (const region of member.token?.regions ?? []) {
    const context = { round: phase.round, skipped: false, token: member.token, combatant: member, combat };
    if (phase.kind.startsWith("turn-")) context.turn = combat.turns.findIndex(c => c.id === member.id);
    add("foundry", member, `region:${region.uuid}:${name}`, () => region._triggerEvent(name, context));
  }
}

export function planV14MidiOptionals(actor, member, phase, add) {
  const period = { "turn-start": "turn", "each-turn": "each-turn", "round-start": "each-round" }[phase.kind];
  if (!period) return;
  const used = new Set();
  for (const effect of actor.allApplicableEffects?.() ?? actor.appliedEffects ?? []) for (const change of effect.system?.changes ?? []) {
    if (change.value !== period || !/^flags\.midi-qol\.optional\.[^.]+\.(count|countAlt)$/.test(change.key)) continue;
    const key = change.key.slice("flags.midi-qol.".length).replace(/\.(count|countAlt)$/, ".used");
    if (!used.has(key) && actor.getFlag("midi-qol", key)) {
      used.add(key);
      add("midi-qol", member, `optional:${key}`, () => actor.unsetFlag("midi-qol", key));
    }
  }
}
