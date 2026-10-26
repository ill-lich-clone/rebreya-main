import { MODULE_ID } from "../constants.js";
import { isManagedShield, hasShieldEffect } from "../data/shield-spell-item.js?v=1.5.8";
import { CprShieldReactionAdapter } from "./cpr-shield-reaction-adapter.js?v=1.5.8";

const WRAPPED = Symbol.for(`${MODULE_ID}.midiReactionAdapter`);
const NONE = Object.freeze({ name: "None" });
const MARKER = /<!--rm-reaction:([a-zA-Z0-9-]+)-->/;
const TIMEOUT = 10_000;

// The socketlib function map and MIDI dialog data are an isolated, version-sensitive
// boundary. Replacing MidiQOL.reactionDialog alone does not intercept lexical calls.
export class MidiReactionAdapter {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
    this._sessions = new Map();
  }

  now() { return this._options.now?.() ?? Date.now(); }
  resolve(uuid) { return (this._options.resolver ?? globalThis.fromUuid)?.(uuid); }

  async getShieldAttackContext(workflow, target) {
    const actor = target?.actor;
    if (!actor || !workflow?.attackRoll || !workflow.activity?.attack) return null;
    const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
    const settings = midi?.configSettings?.() ?? {};
    const ac = actor.system?.attributes?.ac;
    const baseAC = Number(ac?.value);
    if (typeof workflow.activeDefenceDC === "number" && Array.isArray(workflow.rollResults)) {
      const targets = Array.from(workflow.targets ?? []).filter(entry => entry.actor);
      const index = targets.findIndex(entry => (entry.document?.uuid ?? entry.uuid) === (target.document?.uuid ?? target.uuid));
      const result = workflow.rollResults[index];
      const defenceTotal = Number(result?.total);
      const die = result?.dice?.[0]?.total;
      if (![baseAC, defenceTotal, workflow.activeDefenceDC, die].every(Number.isFinite)) return null;
      return { workflowId: String(workflow.id), tokenUuid: target.document?.uuid ?? target.uuid, actorUuid: actor.uuid,
        baseAC, defenceTotal, defenceDC: workflow.activeDefenceDC,
        isCritical: die <= 21 - (workflow.attackRoll.options?.criticalSuccess ?? 20),
        isFumble: die >= 21 - (workflow.attackRoll.options?.criticalFailure ?? 1) };
    }
    const evaluated = workflow.actor?.flags?.midi?.evaluated ?? {};
    const ignoreCover = Boolean(evaluated.ignoreCover?.value
      || (workflow.activity.actionType === "rsak" && evaluated.dnd5e?.spellSniper?.value)
      || (workflow.activity.actionType === "rwak" && (evaluated.sharpShooter?.value || evaluated.dnd5e?.sharpShooter?.value)));
    const statusCover = actor.statuses?.has?.("coverTotal") ? Infinity : Number(ac?.cover ?? 0);
    const moduleCover = workflow.token ? Number(midi?.computeCoverBonus?.(workflow.token, target, workflow.activity) ?? 0) : 0;
    let cover = Math.max(statusCover, moduleCover);
    let delta = Math.max(moduleCover - statusCover, 0);
    if (workflow.activity.midiProperties?.ignoreFullCover) {
      if (workflow.activity.item?.type === "spell") { cover = 0; delta = 0; }
      else if (cover === Infinity) { cover = 5; delta = Math.max(5 - statusCover, 0); }
    }
    const descriptor = workflow.targetDescriptors?.find(entry => entry.uuid === actor.uuid);
    const flanking = (settings.optionalRules?.flankingBonus ?? "advantage") === "advantage" ? 0 : Number(descriptor?.flankingBonus ?? 0);
    let effectiveAC = baseAC + Number(workflow.targetACModifiers?.get(actor.uuid) ?? 0) - flanking;
    effectiveAC += ignoreCover && cover < Infinity ? -statusCover : delta;
    if (cover === Infinity) effectiveAC = Infinity;
    let attackBonus = 0;
    const grants = actor.flags?.["midi-qol"]?.grants?.attack?.bonus;
    for (const key of ["all", workflow.activity.actionType]) {
      if (grants?.[key]) {
        const raw = grants[key];
        attackBonus = Number.isFinite(Number(raw)) ? Number(raw) : Number(evaluated.grants?.attack?.bonus?.[key]?.value);
      }
    }
    const attackTotal = Number(workflow.attackTotal) + attackBonus;
    if (![baseAC, effectiveAC, attackTotal].every(Number.isFinite)) return null;
    return { workflowId: String(workflow.id), tokenUuid: target.document?.uuid ?? target.uuid, actorUuid: actor.uuid,
      attackTotal, effectiveAC, baseAC, isCritical: Boolean(workflow.isCritical), isFumble: Boolean(workflow.isFumble) };
  }

  async canOfferShield(activity, context) {
    const actor = activity?.actor;
    if (!isManagedShield(activity?.item) || !actor || hasShieldEffect(actor)) return false;
    const ledger = this.moduleApi.combatAttackService;
    if (ledger?.canUseReaction?.(actor)?.canUse === false) return false;
    const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
    if (!ledger && midi?.hasUsedReaction?.(actor)) return false;
    const item = activity.item;
    if (item.system?.method === "spell" && item.system.prepared === 0) return false;
    if (activity._prepareUsageConfig && activity._prepareUsageUpdates) {
      const result = await activity._prepareUsageUpdates(activity._prepareUsageConfig({ create: false }), { returnErrors: true });
      if (Array.isArray(result)) return false;
    }
    if (context?.magicMissile) return true;
    if (!context || context.actorUuid !== actor.uuid || context.isCritical || context.isFumble
      || context.conditions?.[activity.uuid] === false) return false;
    if (Number.isFinite(context.defenceDC)) {
      const defenceTotal = context.defenceTotal + Number(actor.system?.attributes?.ac?.value) - context.baseAC;
      return defenceTotal < context.defenceDC && defenceTotal + 5 >= context.defenceDC;
    }
    const effectiveAC = context.effectiveAC + Number(actor.system?.attributes?.ac?.value) - context.baseAC;
    return Number.isFinite(effectiveAC) && effectiveAC <= context.attackTotal && context.attackTotal < effectiveAC + 5;
  }

  async filterReactions(reactions, options = {}, triggerType, reactionActivityList) {
    const managed = reactions.filter(activity => isManagedShield(activity?.item));
    if (!managed.length) return;
    const allowed = new Set();
    const workflow = options.workflow;
    if (["reaction", "reactionhit"].includes(triggerType)) {
      options.rebreyaShieldReaction ??= {};
      for (const activity of managed) {
        if (!workflow) { allowed.add(activity.uuid); continue; } // The receiving choose() already checked its exact Token.
        for (const target of workflow.targets ?? []) {
          if (target.actor?.uuid !== activity.actor?.uuid) continue;
          const context = await this.getShieldAttackContext(workflow, target);
          if (!context) continue;
          context.conditions = {};
          if (activity.reactionCondition) {
            const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
            context.conditions[activity.uuid] = Boolean(await midi?.evalCondition?.(activity.reactionCondition,
              midi.createConditionData({ workflow, target, extraData: { reaction: "isHit" } }), { async: true, errorReturn: false }));
          }
          const previous = options.rebreyaShieldReaction[context.tokenUuid];
          context.conditions = { ...previous?.conditions, ...context.conditions };
          options.rebreyaShieldReaction[context.tokenUuid] = context;
          if (await this.canOfferShield(activity, context)) allowed.add(activity.uuid);
        }
      }
    }
    const excluded = new Set(managed.filter(activity => !allowed.has(activity.uuid)).map(activity => activity.uuid));
    for (let index = reactions.length - 1; index >= 0; index--) if (excluded.has(reactions[index].uuid)) reactions.splice(index, 1);
    for (let index = reactionActivityList.length - 1; index >= 0; index--) if (excluded.has(reactionActivityList[index])) reactionActivityList.splice(index, 1);
  }

  async initialize() {
    const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
    if (!midi) return false;
    this._cpr ??= new CprShieldReactionAdapter(this.moduleApi, {
      ...this._options, canOfferShield: (activity, context) => this.canOfferShield(activity, context)
    });
    this._cpr.initialize();
    const socket = this._options.socketProvider?.() ?? globalThis.socketlib?.modules?.get?.("midi-qol");
    const original = socket?.functions?.get?.("chooseReactions");
    if (original?.[WRAPPED] === this) return true;
    if (typeof original !== "function" || !midi.apps?.ReactionDialog?.prototype?.render || !midi.apps?.RollModifyDialog?.prototype?.render) {
      const message = "Rebreya: не удалось подключить стандартные реакции Midi-QOL: несовместимый socket/dialog API.";
      (this._options.logger ?? console).error(message);
      globalThis.ui?.notifications?.error?.(message, { permanent: true });
      return false;
    }
    if (original[WRAPPED]) throw new Error("Midi reaction adapter is already owned by another instance");
    this._midi = midi;
    this._socket = socket;
    this._original = original;
    const adapter = this;
    const wrapped = function(data) { return adapter.choose(data); };
    wrapped[WRAPPED] = this;
    socket.functions.set("chooseReactions", wrapped);
    for (const Class of [midi.apps.ReactionDialog, midi.apps.RollModifyDialog]) {
      const render = Class.prototype.render;
      const patched = function(...args) {
        adapter.attachDialog(this);
        return render.apply(this, args);
      };
      Class.prototype.render = patched;
    }
    return true;
  }

  async choose(data = {}) {
    const token = await this.resolve(data.tokenUuid);
    const actor = token?.actor;
    if (!actor || !data.triggerType || this._sessions.size >= 128) return { ...NONE };
    const activities = [];
    for (const uuid of data.reactionActivityList ?? []) {
      const activity = await this.resolve(uuid);
      // Only module-owned activities are removed; all other MIDI filtering and
      // native resource/formula logic remains in the captured original handler.
      if (activity?.actor?.uuid !== actor.uuid || this.moduleApi.reactionCapabilityIndex?.ownsActivity?.(activity)) continue;
      if (isManagedShield(activity.item) && (!['reaction', 'reactionhit'].includes(data.triggerType)
        || !await this.canOfferShield(activity, data.options?.rebreyaShieldReaction?.[data.tokenUuid]))) continue;
      activities.push(uuid);
    }
    const optional = data.triggerType === "reactionattacked"
      ? Object.values(actor.flags?.["midi-qol"]?.optional ?? {}).filter(flag => flag?.ac !== undefined)
      : [];
    if (!activities.length && !optional.length) return { ...NONE };
    const workflowId = String(data.options?.workflowId ?? data.options?.workflowOptions?.workflowId ?? "");
    const fallbackId = workflowId || (this._options.idFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const triggerId = [fallbackId, data.tokenUuid, data.triggerType,
      data.options?.reactionTriggerId ?? "", activities.join(",")].join(":");
    return this.moduleApi.reactionQueueService.resolveManagedReaction({
      kind: "midi-native", triggerId, candidate: { actorUuid: actor.uuid, tokenUuid: data.tokenUuid, activityUuids: activities }
    }, async controls => {
      const id = String(controls.sessionId).replaceAll(/[^a-zA-Z0-9-]/g, "");
      const session = { ...controls, actor, shieldContext: data.options?.rebreyaShieldReaction?.[data.tokenUuid],
        expiresAt: this.now() + TIMEOUT, dialogs: new Set(), chosen: false, finished: false };
      this._sessions.set(id, session);
      const abort = () => {
        for (const dialog of session.dialogs) void Promise.resolve(dialog.close()).catch(error => this.log(error));
      };
      controls.signal.addEventListener("abort", abort, { once: true });
      try {
        // Forced optional effects execute before MIDI creates a dialog. Reserve
        // application first, without re-evaluating or rewriting authored conditions.
        if (optional.some(flag => flag.force !== undefined) && !await controls.commit()) return { ...NONE };
        if (controls.signal.aborted) return { ...NONE };
        return await this._original({
          ...data,
          reactionActivityList: activities,
          reactionFlavor: `${data.reactionFlavor ?? ""}<!--rm-reaction:${id}-->`,
          options: { ...data.options, timeout: TIMEOUT / 1000 }
        });
      }
      finally {
        session.finished = true;
        controls.signal.removeEventListener("abort", abort);
        abort();
        this._sessions.delete(id);
      }
    });
  }

  attachDialog(dialog) {
    const match = MARKER.exec([dialog.data?.content, dialog.data?.rollHTML, dialog.data?.targetObject?.rollHTML].join("\n"));
    const session = match && this._sessions.get(match[1]);
    if (!session || dialog.data?.actor?.uuid !== session.actor.uuid || session.dialogs.has(dialog)) return;
    session.dialogs.add(dialog);
    const callback = dialog.data.callback;
    if (typeof callback !== "function") return;
    const adapter = this;
    const optional = dialog instanceof this._midi.apps.RollModifyDialog;
    let submitting = false;
    let submitted = false;
    dialog.data.callback = async function(...args) {
      if (submitting || (!optional && submitted)) return;
      if (session.finished || session.signal.aborted || (!session.chosen && adapter.now() >= session.expiresAt)) {
        // ReactionDialog.submit marks completed before invoking us. Restore its
        // decline close path so MIDI's awaiting Promise also resolves.
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      submitting = true;
      const selected = !optional && await adapter.resolve(args[1]?.key);
      if (isManagedShield(selected?.item) && !await adapter.canOfferShield(selected, session.shieldContext)) {
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      if (!await session.commit({ activityUuid: optional ? undefined : args[1]?.key }) || session.signal.aborted) {
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      submitted = true;
      session.chosen = true;
      // Native activity callback clears its lexical selection timer. Optional AC
      // keeps a class timer as well; it must not interrupt an authorized macro/roll.
      clearTimeout(dialog.timeoutId); clearTimeout(dialog.secondTimeoutId);
      dialog.timeoutId = undefined; dialog.secondTimeoutId = undefined;
      try { return await callback.apply(this, args); }
      finally { submitting = false; }
    };
  }

  log(error) { (this._options.logger ?? console).error("Native reaction adapter failed", error); }
}
