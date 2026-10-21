import { MODULE_ID } from "../constants.js";
import { buildPhaseStepKey, combatFlagKey, combatantsOf, GROUPED_COMBAT_FLAG } from "../combat/turn-group-rules.js";

const GUARDED = Symbol.for("rebreya-main.groupedCombatProviderGuard");
const KNOWN = { dae: "13.0.27", "times-up": "13.1.9", "midi-qol": "13.0.61", effectmacro: "13.0.4" };
const entries = Hooks => (Hooks?.events ?? Hooks?._hooks)?.updateCombat ?? [];
const callback = entry => typeof entry === "function" ? entry : entry.fn;
const providerOf = fn => {
  if (fn?.[GUARDED]) return fn[GUARDED];
  const source = String(fn);
  if (source.includes("_processOverTime(") && source.includes("_processActivityOverTime(")) return "midi-qol";
  if (source.includes("turnStartSource") && (source.includes("timesUpEnabled") || source.includes("effectsToExpire"))) return "times-up";
  if (fn?.__rebreyaEffectMacroCombatCompatPatched || fn?.name === "rebreyaEffectMacroUpdateCombatCompat" || (fn?.name === "updateCombat" && source.includes("_executeAppliedEffects"))) return "effectmacro";
  return null;
};
export const hasGroupedCombatPhases = combat => ["active", "blocked"].includes(combat?.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG]?.mode);

export function inspectGroupedCombatSupport({ game = globalThis.game, Hooks = globalThis.Hooks } = {}) {
  const issues = [], providers = {};
  if (game?.system?.id !== "dnd5e" || game.system.version !== "5.2.5" || game.version !== "13.351") issues.push("unsupported-foundry-system");
  for (const [id, version] of Object.entries(KNOWN)) {
    const module = game?.modules?.get?.(id);
    if (!module?.active) continue;
    providers[id] = module.version;
    if (module.version !== version) issues.push(`unsupported-provider:${id}:${module.version}`);
    if (id !== "dae" && !entries(Hooks).some(entry => providerOf(callback(entry)) === id)) issues.push(`missing-provider-hook:${id}`);
  }
  return { supported: issues.length === 0, issues, providers };
}

export function describeInitiative(actor) {
  const roll = actor?.getInitiativeRoll?.();
  if (!roll) return { key: null, canShare: false };
  const options = roll.options ?? {};
  const semantic = ["advantage", "disadvantage", "fixed", "minimum", "maximum", "halflingLucky", "reliableTalent", "elvenAccuracy", "critical", "fumble", "targetValue", "rollMode", "flavor", "configured", "preRollClassHook", "evaluate"];
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
  let ownerSocket;
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
      const member = combatantsOf(combat).find(c => c.id === receipt?.combatantId);
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
    const list = entries(Hooks);
    for (let i = 0; i < list.length; i++) {
      const original = callback(list[i]), provider = providerOf(original);
      if (!provider || original[GUARDED]) continue;
      const wrapped = function (...args) {
        if (hasGroupedCombatPhases(args[0]) && (args[1]?.round !== undefined || args[1]?.turn !== undefined)) return;
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, GUARDED, { value: provider });
      if (typeof list[i] === "function") list[i] = wrapped; else list[i].fn = wrapped;
    }
  };

  async function activityOverTime(actor, effect, startTurn) {
    if (effect.disabled || effect.isSuppressed || (effect.flags?.ActiveAuras?.isAura && effect.flags.ActiveAuras.ignoreSelf)) return;
    const midi = getMidi(), owner = midi.playerForActor(actor), game = gameProvider();
    let privateExecution = false;
    for (const change of effect.changes ?? []) {
      if (!change.key.startsWith("flags.midi-qol.ActivityOverTime")) continue;
      let activity = await (dependencies.fromUuid ?? globalThis.fromUuid)?.(String(change.value ?? ""));
      if (!activity && effect.transfer) activity = effect.parent?.system?.activities?.find(a => a.identifier === String(change.value));
      if (!activity && effect.origin) activity = midi.getItemFromEffectOrigin(effect.origin)?.system?.activities?.find(a => a.identifier === String(change.value));
      if (!activity) throw new Error(`ActivityOverTime activity not found: ${effect.uuid}`);
      const choice = activity.overTimeProperties?.turnChoice ?? "start";
      if ((choice === "start" && !startTurn) || (choice === "end" && startTurn)) continue;
      const modes = globalThis.CONST?.DICE_ROLL_MODES ?? { PRIVATE: "gmroll", SELF: "selfroll" };
      if ([modes.PRIVATE, modes.SELF].includes(activity.midiProperties?.rollMode)) privateExecution = owner !== undefined;
    }
    const executorId = privateExecution && owner?.active && owner !== game.user ? owner.id : game.user.id;
    return midi.socket().executeAsUser("localActivityOverTimeEffect", executorId, {
      actorUuid: actor.uuid, effectUuid: effect.uuid, startTurn, options: {}
    });
  }

  function plan(combat, phase, state = combat.flags?.[MODULE_ID]?.[GROUPED_COMBAT_FLAG]) {
    const steps = [], combatants = combatantsOf(combat), selected = combatants.filter(c => phase.memberIds.includes(c.id));
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
    if (start || end) {
      for (const target of combatants) for (const effect of applicableEffects(target.actor)) {
        const special = effect.flags?.dae?.specialDuration ?? [];
        const own = selected.some(c => c.id === target.id);
        const source = selected.some(c => effect.origin === c.actor?.uuid || effect.origin?.startsWith(`${c.actor?.uuid}.`));
        const createdRound = effect.duration?.startRound ?? -1, createdTurn = effect.duration?.startTurn ?? -1;
        const currentIndex = combat.turns?.findIndex(c => phase.memberIds.includes(c.id)) ?? 0;
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
      const periods = { "turn-start": ["turnStart"], "turn-end": ["turnEnd"], "each-turn": ["turn"] }[phase.kind];
      if (periods && !c.isDefeated) add("dnd5e", c, "recovery", () => c.recoverCombatUses?.(periods));
      if (start && combat.clearMovementHistories) add("foundry", c, "movement-history", () => combat.clearMovementHistories([c]));
      if (start && getMidi()?.removeActionUsed) add("midi-qol", c, "action-state", () => getMidi().removeActionUsed(c.actor));
      if (start && getMidi()?.socket && !gameProvider().modules?.get?.("times-up")?.active) add("midi-qol", c, "reaction-state", () => getMidi().socket().executeAsGM("removeActionBonusReaction", { actorUuid: c.actor.uuid }));
      if (start || end) for (const effect of applicableEffects(c.actor)) {
        if (expiring.has(effect.uuid)) continue;
        const repeat = effect.flags?.dae?.macroRepeat ?? "";
        if (getDAE()?.daeMacro && ((start && /^(?:startEveryTurn|startEndEveryTurn)(?:Any)?$/u.test(repeat)) || (end && /^(?:endEveryTurn|startEndEveryTurn)(?:Any)?$/u.test(repeat)))) {
          if (repeat.endsWith("Any") || (!effect.disabled && !effect.isSuppressed)) add("dae", c, `repeat:${effect.uuid}`, () => getDAE().daeMacro("each", c.actor, effect, {
            actor: c.actor, effectId: effect.id, tokenId: c.token?.id, actorUuid: c.actor.uuid, actorID: c.actor.id, efData: effect.toObject(), turn: start ? "startTurn" : "endTurn"
          }), effect);
        }
        const midi = getMidi();
        if (midi?.doOverTimeEffect && effect.changes?.some(change => change.key.startsWith("flags.midi-qol.OverTime"))) add("midi-qol", c, `overtime:${effect.uuid}`, () => midi.doOverTimeEffect(c.actor, effect, start), effect);
        if (midi?.socket && effect.changes?.some(change => change.key.startsWith("flags.midi-qol.ActivityOverTime"))) add("midi-qol", c, `activity:${effect.uuid}`, () => activityOverTime(c.actor, effect, start), effect);
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
    if (dependencies.planRebreyaPhase) {
      for (const step of dependencies.planRebreyaPhase(combat, phase)) add("rebreya", combatants.find(c => c.id === step.combatantId), step.id, step.run);
    } else add("rebreya", null, "automation", () => runRebreyaPhase(combat, phase));
    return steps;
  }
  return { plan, installNativeGuards, inspect: () => {
    installNativeGuards();
    const game = gameProvider(), support = inspectGroupedCombatSupport({ game, Hooks });
    const needs = { dae: () => getDAE()?.daeMacro, "times-up": () => getTimesUp()?.expireEffect,
      "midi-qol": () => getMidi()?.doOverTimeEffect && getMidi()?.socket && getMidi()?.playerForActor,
      effectmacro: () => getEffectMacro()?.utils?.callMacro && getEffectMacro()?.utils?.getExecutor && ensureOwnerSocket() };
    for (const [id, available] of Object.entries(needs)) if (game.modules?.get?.(id)?.active && !available()) support.issues.push(`missing-provider-api:${id}`);
    const midiConfig = getMidi()?.currentConfigSettings;
    // ponytail: individual round rerolls require a grouped reroll coordinator; preserve the setting and refuse conversion until supported.
    if (game.modules?.get?.("midi-qol")?.active && !midiConfig?.toggleOptionalRules && midiConfig?.optionalRules?.autoRerollInitiative) support.issues.push("midi-auto-reroll-initiative");
    support.supported = support.issues.length === 0;
    return support;
  } };
}
