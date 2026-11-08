import { installV14EffectGuards, planV14Expiry, planV14MidiOptionals, planV14RegionEvents } from "./grouped-combat-v14.js";
import { MODULE_ID } from "../constants.js";
import { buildPhaseStepKey, combatFlagKey, combatantById, combatantsOf, GROUPED_COMBAT_FLAG } from "../combat/turn-group-rules.js?v=1.5.66";

const GUARDED = Symbol.for("rebreya-main.groupedCombatProviderGuard");
const KNOWN = { dae: "13.0.27", "times-up": "13.1.9", "midi-qol": "13.0.61", effectmacro: "13.0.4" };
const KNOWN_V14 = { dae: "14.6.6", "midi-qol": "14.6.8", effectmacro: "14.0.1" };
const isV14 = game => game?.version === "14.369" && game.system?.version === "6.0.6" && game.system.id === "dnd5e";
const entries = (Hooks, name) => (Hooks?.events ?? Hooks?._hooks)?.[name] ?? [];
const callback = entry => typeof entry === "function" ? entry : entry.fn;
const providerOf = fn => {
  if (fn?.[GUARDED]) return fn[GUARDED];
  const source = String(fn);
  if (fn?.name === "expirePerTurnBonusActions") return "midi-qol";
  if (source.includes("processMacroRepeats(")) return "dae";
  if (source.includes("_processOverTime(") && source.includes("_processActivityOverTime(")) return "midi-qol";
  if (source.includes("turnStartSource") && (source.includes("timesUpEnabled") || source.includes("effectsToExpire"))) return "times-up";
  if (fn?.__rebreyaEffectMacroCombatCompatPatched || fn?.name === "rebreyaEffectMacroUpdateCombatCompat" || (fn?.name === "updateCombat" && source.includes("_executeAppliedEffects"))) return "effectmacro";
  return null;
};
export const hasGroupedCombatPhases = combat => ["active", "blocked"].includes(combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG]?.mode);

export function inspectGroupedCombatSupport({ game = globalThis.game, Hooks = globalThis.Hooks } = {}) {
  const issues = [], providers = {};
  const modern = isV14(game);
  if (!modern && (game?.system?.id !== "dnd5e" || game.system.version !== "5.2.5" || game.version !== "13.351")) issues.push("unsupported-foundry-system");
  for (const id of Object.keys(KNOWN)) {
    const module = game?.modules?.get?.(id);
    if (!module?.active) continue;
    providers[id] = module.version;
    if (module.version !== (modern ? KNOWN_V14 : KNOWN)[id]) issues.push(`unsupported-provider:${id}:${module.version}`);
    const hooks = modern && id === "midi-qol" ? ["combatTurn", "combatRound"] : !modern && id === "dae" ? [] : ["updateCombat"];
    if (hooks.some(name => !entries(Hooks, name).some(entry => providerOf(callback(entry)) === id))) issues.push(`missing-provider-hook:${id}`);
  }
  return { supported: issues.length === 0, issues, providers };
}

export function describeInitiative(actor) {
  const roll = actor?.getInitiativeRoll?.();
  if (!roll) return { key: null, canShare: false };
  const options = roll.options ?? {};
  const semantic = ["ability", "advantage", "disadvantage", "advantageMode", "fixed", "minimum", "maximum", "halflingLucky", "reliableTalent", "elvenAccuracy", "critical", "criticalSuccess", "fumble", "criticalFailure", "target", "targetValue", "rollMode", "flavor", "configured", "preRollClassHook", "evaluate"];
  if (Object.keys(options).some(key => !semantic.includes(key))) return { key: null, canShare: false };
  const rules = Object.fromEntries(Object.entries(options).filter(([key]) => !["flavor", "rollMode", "configured", "evaluate", "preRollClassHook"].includes(key)));
  // Native formula already resolves referenced actor data; unrelated HP/name never enter the key.
  return { key: JSON.stringify([roll.constructor?.name, roll.formula, rules]), canShare: true };
}

function applicableEffects(actor) {
  const base = Array.from(actor?.allApplicableEffects?.() ?? actor?.appliedEffects ?? []);
  const enchantments = Array.from(actor?.items?.contents ?? []).flatMap(item => Array.from(item.effects?.contents ?? []).filter(e => e.isAppliedEnchantment));
  return [...new Map([...base, ...enchantments].map(e => [e.uuid ?? e.id, e])).values()];
}

function durationExpired(effect, combat, phase, state) {
  const d = effect.duration;
  if (!d || d.type === "seconds" || !(d.rounds || d.turns) || !Number.isFinite(d.startRound)) return false;
  const groups = state?.groups ?? [], n = groups.length;
  if (!n) return false;
  state.durationAnchors ??= {};
  const signature = JSON.stringify([d.startRound, d.startTurn, d.rounds, d.turns]);
  const key = combatFlagKey(effect.uuid);
  let anchor = state.durationAnchors[key];
  if (!anchor || anchor.signature !== signature) {
    const startId = combat.turns?.[d.startTurn ?? 0]?.id;
    anchor = state.durationAnchors[key] = { signature, round: d.startRound, groupId: groups.find(g => g.memberIds.includes(startId))?.id ?? groups[0].id };
  }
  const index = groups.findIndex(g => g.id === phase.groupId);
  const now = phase.round * n + Math.max(0, index) + (phase.kind === "turn-end" ? 1 : 0);
  const from = anchor.round * n + Math.max(0, groups.findIndex(g => g.id === anchor.groupId));
  return now > from && now >= from + (d.rounds ?? 0) * n + (d.turns ?? 0);
}

export function createGroupedCombatEffects(dependencies = {}) {
  const gameProvider = dependencies.gameProvider ?? (() => globalThis.game);
  const Hooks = dependencies.Hooks ?? globalThis.Hooks;
  const getDAE = () => dependencies.DAE ?? globalThis.DAE;
  const getTimesUp = () => dependencies.TimesUp ?? globalThis.TimesUp;
  const getMidi = () => dependencies.MidiQOL ?? globalThis.MidiQOL;
  const getEffectMacro = () => dependencies.effectmacro ?? globalThis.effectmacro;
  const runRebreyaPhase = dependencies.runRebreyaPhase ?? (async () => {});
  const registry = () => dependencies.effectRegistry?.() ?? globalThis.CONFIG?.ActiveEffect?.documentClass?.registry;
  const modern = () => isV14(gameProvider());
  let ownerSocket;
  let worldCardPhase;
  let effectGuardsReady;
  const ensureOwnerSocket = () => {
    if (ownerSocket) return ownerSocket;
    const socketlib = dependencies.socketlib ?? globalThis.socketlib;
    if (!socketlib?.registerModule || !getEffectMacro()?.utils) return null;
    ownerSocket = socketlib.registerModule(MODULE_ID);
    ownerSocket?.register("groupedEffectMacro", async ({ combatId, stepKey, hook } = {}) => {
      const game = gameProvider(), macro = getEffectMacro();
      // This endpoint never runs on a privileged GM: GM work is executed locally by the coordinator.
      if (game.user?.isGM) return { status: "cancelled" };
      const combat = game.combats?.get?.(combatId), state = combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG];
      const receipt = state?.receipts?.[stepKey];
      const allowed = { "turn-start": "onTurnStart", "turn-end": "onTurnEnd", "each-turn": "onEachTurn", "round-start": "onRoundStart", "round-end": "onRoundEnd", "combat-start": "onCombatStart", "combat-end": "onCombatEnd" };
      const member = combatantById(combat, receipt?.combatantId);
      if (state?.mode !== "active" || receipt?.status !== "running" || receipt.provider !== "effectmacro" || allowed[receipt.phase] !== hook || !macro.utils.isExecutor(member?.actor)) return { status: "cancelled" };
      const effect = applicableEffects(member.actor).find(e => e.uuid === receipt.effectUuid);
      if (!effect || !macro.utils.hasMacro(effect, hook)) return { status: "completed" };
      const result = await macro.utils.callMacro(effect, hook);
      if (result === null) throw new Error("effectmacro-step-failed");
      return { status: "completed" };
    });
    return ownerSocket;
  };

  const installNativeGuards = () => {
    ensureOwnerSocket();
    if (modern()) effectGuardsReady = installV14EffectGuards(dependencies.EffectClass ?? globalThis.CONFIG?.ActiveEffect?.documentClass, dependencies.libWrapper ?? globalThis.libWrapper);
    for (const name of modern() ? ["updateCombat", "combatTurn", "combatRound"] : ["updateCombat"]) {
      const list = entries(Hooks, name);
      for (let i = 0; i < list.length; i++) {
        const original = callback(list[i]), provider = providerOf(original);
        if (!provider || original[GUARDED]) continue;
        const wrapped = function (...args) {
          if (hasGroupedCombatPhases(args[0])) return;
          return original.apply(this, args);
        };
        Object.defineProperty(wrapped, GUARDED, { value: provider });
        if (typeof list[i] === "function") list[i] = wrapped; else list[i].fn = wrapped;
      }
    }
  };

  async function activityOverTime(actor, effect, startTurn) {
    if (effect.disabled || effect.isSuppressed || (effect.flags?.ActiveAuras?.isAura && effect.flags.ActiveAuras.ignoreSelf)) return;
    const midi = getMidi(), owner = midi.playerForActor(actor), game = gameProvider();
    let privateExecution = false;
    for (const change of (modern() ? effect.system?.changes : effect.changes) ?? []) {
      if (!change.key.startsWith("flags.midi-qol.ActivityOverTime")) continue;
      let activity = await (dependencies.fromUuid ?? globalThis.fromUuid)?.(String(change.value ?? ""));
      if (!activity && effect.transfer) activity = effect.parent?.system?.activities?.find(a => a.identifier === String(change.value));
      if (!activity && effect.origin) activity = midi.getItemFromEffectOrigin(effect.origin)?.system?.activities?.find(a => a.identifier === String(change.value));
      if (modern() && !activity) continue;
      if (!activity) throw new Error(`ActivityOverTime activity not found: ${effect.uuid}`);
      const choice = activity.overTimeProperties?.turnChoice ?? "start";
      if ((choice === "start" && !startTurn) || (choice === "end" && startTurn)) continue;
      const modes = globalThis.CONST?.DICE_ROLL_MODES ?? { PRIVATE: "gmroll", SELF: "selfroll" };
      if (["gm", "self", "gmroll", "selfroll", modes.PRIVATE, modes.SELF].filter(Boolean).includes(activity.midiProperties?.rollMode)) privateExecution = owner !== undefined;
    }
    const executorId = privateExecution && owner?.active && owner !== game.user ? owner.id : game.user.id;
    return midi.socket().executeAsUser("localActivityOverTimeEffect", executorId, {
      actorUuid: actor.uuid, effectUuid: effect.uuid, startTurn, options: {}
    });
  }

  function plan(combat, phase, state = combat.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG]) {
    const steps = [], combatants = combatantsOf(combat), memberIds = new Set(phase.memberIds);
    const selected = combatants.filter(c => memberIds.has(c.id));
    const add = (provider, c, id, run, effect = null) => steps.push({
      key: buildPhaseStepKey(combat.id, phase, c?.id ?? "all", provider, id), provider, combatantId: c?.id ?? null, effectUuid: effect?.uuid ?? null,
      actorUuid: c?.actor?.uuid ?? null, actorSourceId: c?.token?.baseActor?.id ?? null,
      async run() {
        if (effect?.parent?.effects?.get && !effect.parent.effects.get(effect.id)) return { status: "completed" };
        const result = await run();
        return { status: result?.status === "cancelled" || result?.aborted || result?.cancelled || result === false ? "cancelled" : "completed" };
      }
    });
    const start = phase.kind === "turn-start", end = phase.kind === "turn-end";
    const expiring = new Set();
    if (!modern() && (start || end)) {
      const currentIndex = combat.turns?.findIndex(c => memberIds.has(c.id)) ?? 0;
      for (const target of combatants) for (const effect of applicableEffects(target.actor)) {
        const special = effect.flags?.dae?.specialDuration ?? [];
        const own = memberIds.has(target.id);
        const source = selected.some(c => effect.origin === c.actor?.uuid || effect.origin?.startsWith(`${c.actor?.uuid}.`));
        const createdRound = effect.duration?.startRound ?? -1, createdTurn = effect.duration?.startTurn ?? -1;
        const existedAtStart = createdRound < phase.round || (createdRound === phase.round && createdTurn < currentIndex);
        const expires = (own && start && special.includes("turnStart")) || (own && end && existedAtStart && special.includes("turnEnd"))
          || (source && start && special.includes("turnStartSource")) || (source && end && existedAtStart && special.includes("turnEndSource"))
          || durationExpired(effect, combat, phase, state);
        if (expires && getTimesUp()?.expireEffect && !expiring.has(effect.uuid)) {
          expiring.add(effect.uuid);
          add("times-up", target, `expire:${effect.uuid}`, () => getTimesUp().expireEffect(effect, { "expiry-reason": `times-up:${phase.kind}` }), effect);
        }
      }
    }
    for (const c of selected) {
      if (!c.actor) continue;
      const periods = { "round-start": modern() ? ["round"] : null, "turn-start": ["turnStart"], "turn-end": ["turnEnd"], "each-turn": ["turn"] }[phase.kind];
      if (periods && !c.isDefeated) add("dnd5e", c, "recovery", () => c.recoverCombatUses?.(periods));
      if (start && combat.clearMovementHistories) add("foundry", c, "movement-history", () => combat.clearMovementHistories([c]));
      if (start && getMidi()?.removeActionUsed) add("midi-qol", c, "action-state", () => getMidi().removeActionUsed(c.actor));
      if (modern() && getMidi()) planV14MidiOptionals(c.actor, c, phase, add);
      if (!modern() && start && getMidi()?.socket && !gameProvider().modules?.get?.("times-up")?.active) add("midi-qol", c, "reaction-state", () => getMidi().socket().executeAsGM("removeActionBonusReaction", { actorUuid: c.actor.uuid }));
      const midiEffects = modern() && (start || end) ? new Set(c.actor.appliedEffects ?? []) : null;
      if (start || end) for (const effect of applicableEffects(c.actor)) {
        if (expiring.has(effect.uuid) || (modern() && effect.duration?.expired)) continue;
        const repeat = effect.flags?.dae?.macroRepeat ?? "";
        if (getDAE()?.daeMacro && ((start && /^(?:startEveryTurn|startEndEveryTurn)(?:Any)?$/u.test(repeat)) || (end && /^(?:endEveryTurn|startEndEveryTurn)(?:Any)?$/u.test(repeat)))) {
          if (repeat.endsWith("Any") || (!effect.disabled && !effect.isSuppressed)) add("dae", c, `repeat:${effect.uuid}`, () => getDAE().daeMacro("each", c.actor, effect, {
            actor: c.actor, effectId: effect.id, tokenId: c.token?.id, actorUuid: c.actor.uuid, actorID: c.actor.id, efData: effect.toObject(), turn: start ? "startTurn" : "endTurn"
          }), effect);
        }
        const midi = getMidi();
        if (midiEffects && !midiEffects.has(effect)) continue;
        const changes = modern() ? effect.system?.changes : effect.changes;
        if (midi?.doOverTimeEffect && changes?.some(change => change.key.startsWith("flags.midi-qol.OverTime"))) add("midi-qol", c, `overtime:${effect.uuid}`, () => midi.doOverTimeEffect(c.actor, effect, start), effect);
        if (midi?.socket && changes?.some(change => change.key.startsWith("flags.midi-qol.ActivityOverTime"))) add("midi-qol", c, `activity:${effect.uuid}`, () => activityOverTime(c.actor, effect, start), effect);
      }
      const hook = { "turn-start": "onTurnStart", "turn-end": "onTurnEnd", "each-turn": "onEachTurn", "round-start": "onRoundStart", "round-end": "onRoundEnd", "combat-start": "onCombatStart", "combat-end": "onCombatEnd" }[phase.kind];
      const effectmacro = getEffectMacro();
      if (hook && !c.isDefeated && effectmacro?.utils) for (const effect of Array.from(c.actor.appliedEffects ?? [])) {
        if (effectmacro.utils.hasMacro(effect, hook)) {
          const id = `${hook}:${effect.uuid}`, key = buildPhaseStepKey(combat.id, phase, c.id, "effectmacro", id);
          add("effectmacro", c, id, async () => {
            const executor = effectmacro.utils.getExecutor?.(c.actor) ?? gameProvider().user;
            if (executor?.id !== gameProvider().user?.id) {
              const socket = ensureOwnerSocket();
              if (!socket) throw new Error("effectmacro-owner-unavailable");
              return socket.executeAsUser("groupedEffectMacro", executor.id, { combatId: combat.id, stepKey: key, hook });
            }
            const result = await effectmacro.utils.callMacro(effect, hook);
            if (result === null) throw new Error("effectmacro-step-failed");
            return result;
          }, effect);
        }
      }
    }
    if (modern()) {
      planV14Expiry(combat, phase, state, registry(), add);
      planV14RegionEvents(combat, phase, selected, add);
      if (worldCardPhase) for (const member of selected) worldCardPhase(combat, phase, member, add);
    }
    if (dependencies.planRebreyaPhase) {
      const byId = new Map(combatants.map(c => [c.id, c]));
      for (const step of dependencies.planRebreyaPhase(combat, phase)) add("rebreya", byId.get(step.combatantId), step.id, step.run);
    } else add("rebreya", null, "automation", () => runRebreyaPhase(combat, phase));
    return steps;
  }
  return { plan, installNativeGuards, setWorldCardPhase(handler) { worldCardPhase = handler; }, inspect: (scene = null, actors = []) => {
    installNativeGuards();
    const game = gameProvider(), support = inspectGroupedCombatSupport({ game, Hooks });
    const needs = { dae: () => getDAE()?.daeMacro, "times-up": () => getTimesUp()?.expireEffect,
      "midi-qol": () => getMidi()?.doOverTimeEffect && getMidi()?.socket && getMidi()?.playerForActor,
      effectmacro: () => getEffectMacro()?.utils?.callMacro && getEffectMacro()?.utils?.getExecutor && ensureOwnerSocket() };
    for (const [id, available] of Object.entries(needs)) if (game.modules?.get?.(id)?.active && !available()) support.issues.push(`missing-provider-api:${id}`);
    if (modern() && (!effectGuardsReady || !registry()?.refresh)) support.issues.push("missing-foundry-effect-registry");
    // Midi moves these regions on the individual caster’s turn on the owning client.
    if (modern() && game.modules?.get("midi-qol")?.active && scene && Array.from(scene.regions ?? []).some(region => !region.attachment?.token && Array.from(region.behaviors ?? []).some(
      b => !b.disabled && b.type === "midi-qol.regionActivity" && b.system?.moveDistance > 0 && actors.some(actor => actor?.uuid === b.system.sourceActorUuid)
    ))) support.issues.push("midi-moving-region");
    const midiConfig = getMidi()?.currentConfigSettings;
    // ponytail: individual round rerolls require a grouped reroll coordinator; preserve the setting and refuse conversion until supported.
    if (game.modules?.get?.("midi-qol")?.active && !midiConfig?.toggleOptionalRules && midiConfig?.optionalRules?.autoRerollInitiative) support.issues.push("midi-auto-reroll-initiative");
    support.supported = support.issues.length === 0;
    return support;
  } };
}
