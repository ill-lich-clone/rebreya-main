import { MODULE_ID } from "../constants.js";
import { isShieldReactionItem, hasShieldEffect, dropLegacyShieldExpiry, MISSILE_REACTION_CONDITION } from "../data/shield-spell-item.js?v=1.5.102";
import { CprShieldReactionAdapter } from "./cpr-shield-reaction-adapter.js?v=1.5.102";

const WRAPPED = Symbol.for(`${MODULE_ID}.midiReactionAdapter`);
const NONE = Object.freeze({ name: "None" });
const MARKER = /<!--rm-reaction:([a-zA-Z0-9-]+)-->/;
const TIMEOUT = 10_000;
const isMagicMissile = item => item?.type === "spell" && item.system?.identifier === "magic-missile";
const isParry = item => item?.type === "feat" && item.system?.identifier === "glossary-parry";
const isManualReaction = item => item?.system?.identifier === "glossary-opportunity-attack";
const isDefensiveItem = item => isShieldReactionItem(item) || isParry(item);

// The socketlib function map and MIDI dialog data are an isolated, version-sensitive
// boundary. Replacing MidiQOL.reactionDialog alone does not intercept lexical calls.
export class MidiReactionAdapter {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this._options = options;
    this._sessions = new Map();
    this._shieldApplications = new WeakMap();
    this.moduleApi.reactionQueueService?.registerType?.("midi-native", {
      midi: { ReactionFilter: (...args) => this.filterReactions(...args),
        RollComplete: workflow => this.completeDefensiveReaction(workflow) }
    });
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
    if (!isShieldReactionItem(activity?.item) || !actor || hasShieldEffect(actor)) return false;
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
    if (context?.magicMissile) return context.conditions?.[activity.uuid] !== false;
    if (!context || context.actorUuid !== actor.uuid || context.isCritical || context.isFumble
      || context.conditions?.[activity.uuid] === false) return false;
    if (Number.isFinite(context.defenceDC)) {
      const defenceTotal = context.defenceTotal + Number(actor.system?.attributes?.ac?.value) - context.baseAC;
      return defenceTotal < context.defenceDC && defenceTotal + 5 >= context.defenceDC;
    }
    const effectiveAC = context.effectiveAC + Number(actor.system?.attributes?.ac?.value) - context.baseAC;
    return Number.isFinite(effectiveAC) && effectiveAC <= context.attackTotal && context.attackTotal < effectiveAC + 5;
  }

  canOfferParry(activity, context) {
    const actor = activity?.actor;
    const combat = this.moduleApi.combatAttackService;
    return Boolean(isParry(activity?.item) && actor && context?.parry && context.actorUuid === actor.uuid
      && combat?.canUseReaction?.(actor)?.canUse && combat.getParryBonus?.(actor) > 0 && activity.canUse !== false);
  }

  async filterReactions(reactions, options = {}, triggerType, reactionActivityList) {
    const registry = this.moduleApi.reactionCapabilityIndex;
    if (registry?.ownsActivity) {
      const owned = new Set(reactions.filter(activity => registry.ownsActivity(activity)).map(activity => activity.uuid));
      for (let index = reactions.length - 1; index >= 0; index--) if (owned.has(reactions[index].uuid)) reactions.splice(index, 1);
      for (let index = reactionActivityList.length - 1; index >= 0; index--) if (owned.has(reactionActivityList[index])) reactionActivityList.splice(index, 1);
    }
    const managed = reactions.filter(activity => isDefensiveItem(activity?.item) || isManualReaction(activity?.item));
    if (!managed.length) return;
    const allowed = new Set();
    const workflow = options.workflow;
    const missile = triggerType === "reactiondamage" && workflow?.workflowOptions?.rebreyaMissileShieldPrompt !== false && isMagicMissile(workflow?.item);
    if (["reaction", "reactionhit"].includes(triggerType) || missile || (!workflow && triggerType === "reactiondamage")) {
      options.rebreyaShieldReaction ??= {};
      for (const activity of managed) {
        if (isManualReaction(activity.item)) continue;
        if (!workflow) { allowed.add(activity.uuid); continue; } // The receiving choose() already checked its exact Token.
        for (const target of workflow.targets ?? []) {
          if (target.actor?.uuid !== activity.actor?.uuid) continue;
          const context = missile
            ? { tokenUuid: target.document?.uuid ?? target.uuid, actorUuid: target.actor.uuid, magicMissile: true }
            : await this.getShieldAttackContext(workflow, target);
          if (!context) continue;
          if (isParry(activity.item)) {
            const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
            context.parry = !missile && Boolean(workflow.token && workflow.activity.attack?.type?.value === "melee"
              && midi?.canSee?.(target.object ?? target, workflow.token.object ?? workflow.token));
          }
          context.conditions = {};
          if (activity.reactionCondition) {
            const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
            context.conditions[activity.uuid] = Boolean(await midi?.evalCondition?.(activity.reactionCondition,
              midi.createConditionData({ workflow, target, extraData: { reaction: missile ? "isDamaged" : "isHit" } }), { async: true, errorReturn: false }));
          }
          const previous = options.rebreyaShieldReaction[context.tokenUuid];
          context.conditions = { ...previous?.conditions, ...context.conditions };
          context.parry ??= previous?.parry;
          options.rebreyaShieldReaction[context.tokenUuid] = context;
          if (isParry(activity.item) ? this.canOfferParry(activity, context) : await this.canOfferShield(activity, context)) allowed.add(activity.uuid);
        }
      }
    }
    const excluded = new Set(managed.filter(activity => !allowed.has(activity.uuid)).map(activity => activity.uuid));
    for (let index = reactions.length - 1; index >= 0; index--) if (excluded.has(reactions[index].uuid)) reactions.splice(index, 1);
    for (let index = reactionActivityList.length - 1; index >= 0; index--) if (excluded.has(reactionActivityList[index])) reactionActivityList.splice(index, 1);
  }

  prepareMagicMissileReactions(workflow) {
    if (!isMagicMissile(workflow?.item)) return;
    for (const target of workflow.targets ?? []) {
      for (const item of target.actor?.items ?? []) {
        if (!isShieldReactionItem(item)) continue;
        for (const activity of item.system.activities ?? []) {
          if (activity.type === "utility" && (!activity.useConditionText || /^reaction\s*===\s*['"]isHit['"]$/.test(activity.useConditionText))) {
            activity.useConditionText = MISSILE_REACTION_CONDITION;
          }
        }
      }
    }
  }

  applyMagicMissileShield(actor, damages, options = {}) {
    if (!hasShieldEffect(actor)) return true;
    const message = options.originatingMessage ?? (options.midi?.itemCardUuid && globalThis.fromUuidSync?.(options.midi.itemCardUuid));
    const item = message?.getAssociatedItem?.() ?? options.activity?.item ?? options.sourceItem;
    if (!isMagicMissile(item)) return true;
    let amount = 0;
    for (const damage of damages) {
      if (["temphp", "maximum"].includes(damage.type)) continue;
      if (damage.value > 0 && damage.type !== "healing") {
        damage.value = 0;
        (damage.active ??= {}).multiplier = 0;
      }
      amount += damage.value;
    }
    damages.amount = Math.trunc(amount + Math.min(0, damages.tempMax ?? 0));
    return true;
  }

  async applyShieldEffect(workflow) {
    const { actor, activity, itemCardUuid, aborted } = workflow ?? {};
    if (aborted || !itemCardUuid || !isShieldReactionItem(activity?.item) || activity.item.actor?.uuid !== actor?.uuid
      || !actor?.isOwner || !actor.createEmbeddedDocuments) return false;
    const pending = this._shieldApplications.get(actor) ?? this._applyShieldBarrier(actor, activity, itemCardUuid);
    this._shieldApplications.set(actor, pending);
    try {
      const applied = await pending;
      const session = this._sessions.get(workflow.workflowOptions?.rebreyaShieldSessionId);
      if (applied && session?.shieldActivity?.uuid === activity.uuid && session.actor.uuid === actor.uuid) {
        session.shieldResult = { name: activity.name ?? activity.item.name ?? "Щит", uuid: activity.uuid,
          itemName: activity.item.name, itemUuid: activity.item.uuid };
      }
      return applied;
    } finally {
      if (this._shieldApplications.get(actor) === pending) this._shieldApplications.delete(actor);
    }
  }

  async completeDefensiveReaction(workflow) {
    if (!isParry(workflow?.activity?.item)) {
      await this.applyShieldEffect(workflow);
      return;
    }
    const session = this._sessions.get(workflow.workflowOptions?.rebreyaShieldSessionId);
    const { activity, actor } = workflow;
    if (workflow.aborted || !workflow.itemCardUuid || session?.parryActivity?.uuid !== activity.uuid || session.actor.uuid !== actor?.uuid) return;
    session.parryResult = this.parryResult(activity, actor);
  }

  parryResult(activity, actor) {
    const ac = Number(actor.system?.attributes?.ac?.value);
    const bonus = this.moduleApi.combatAttackService?.getParryBonus?.(actor) ?? 0;
    if (!Number.isFinite(ac) || !(bonus > 0)) return;
    return { ac: ac + bonus, uuid: activity.uuid, name: activity.item.name, itemName: activity.item.name, itemUuid: activity.item.uuid };
  }

  async _applyShieldBarrier(actor, activity, itemCardUuid) {
    if (hasShieldEffect(actor)) return true;
    for (const profile of activity.effects ?? []) {
      const effect = await (profile.getEffect?.() ?? activity.item.effects?.get?.(profile._id));
      const data = effect?.toObject?.();
      const changes = data?.system?.changes ?? data?.changes;
      if (data?.transfer || !changes?.some(change => change.key === "system.attributes.ac.bonus" && Number(change.value) === 5)) continue;
      if (hasShieldEffect(actor)) return true;
      delete data._id;
      delete data.start;
      data.disabled = false;
      data.origin = activity.item.uuid;
      data.flags ??= {};
      (data.flags[MODULE_ID] ??= {}).shieldReaction = { version: 1 };
      if (data.system?.changes) {
        dropLegacyShieldExpiry(data);
        data.duration = { ...data.duration, value: null, expiry: "targetStart", expired: false };
        data.system.origin = { activity: activity.uuid, message: itemCardUuid };
        const Effect = globalThis.CONFIG?.ActiveEffect?.documentClass;
        if (Effect?.forApplication) data.system.changes = await Effect.forApplication(changes, activity, actor);
      }
      const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
      return Boolean(created);
    }
    return false;
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
      if (activity?.actor?.uuid !== actor.uuid || isManualReaction(activity.item)
        || this.moduleApi.reactionCapabilityIndex?.ownsActivity?.(activity)) continue;
      if (isDefensiveItem(activity.item)) {
        const context = data.options?.rebreyaShieldReaction?.[data.tokenUuid];
        const matched = context?.magicMissile ? data.triggerType === "reactiondamage" : ["reaction", "reactionhit"].includes(data.triggerType);
        if (!matched || !(isParry(activity.item) ? this.canOfferParry(activity, context) : await this.canOfferShield(activity, context))) continue;
      }
      activities.push(uuid);
    }
    const optional = data.triggerType === "reactionattacked"
      ? Object.values(actor.flags?.["midi-qol"]?.optional ?? {}).filter(flag => flag?.ac !== undefined)
      : [];
    if (!activities.length && !optional.length) return { ...NONE };
    const workflowId = String(data.options?.workflowId ?? data.options?.workflowOptions?.workflowId ?? "");
    const fallbackId = workflowId || (this._options.idFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    const triggerId = [fallbackId, data.tokenUuid, data.triggerType,
      data.options?.reactionTriggerId ?? "", [...activities].sort().join(",")].join(":");
    return this.moduleApi.reactionQueueService.resolveManagedReaction({
      kind: "midi-native", triggerId, triggerType: data.triggerType,
      chatRetry: Boolean(data.options?.reactionRequest && this._midi?.extendReactionTimeout),
      candidate: { actorUuid: actor.uuid, tokenUuid: data.tokenUuid, activityUuids: activities }
    }, async controls => {
      const id = String(controls.sessionId).replaceAll(/[^a-zA-Z0-9-]/g, "");
      const expiresAt = controls.choiceDeadline ?? this.now() + TIMEOUT;
      let extended = false;
      const extend = () => {
        if (extended || !data.options?.reactionRequest || !this._midi?.extendReactionTimeout) return;
        extended = true;
        void Promise.resolve().then(() => this._midi.extendReactionTimeout(data.options.reactionRequest)).catch(error => this.log(error));
      };
      const commitForcedAc = () => { extend(); return controls.commit(); };
      const patchedMidi = typeof this._midi?.extendReactionTimeout === "function";
      const session = { ...controls, actor, tokenUuid: data.tokenUuid, shieldContext: data.options?.rebreyaShieldReaction?.[data.tokenUuid],
        expiresAt, extend, dialogs: new Set(), chosen: false, finished: false };
      this._sessions.set(id, session);
      const abort = () => {
        for (const dialog of session.dialogs) void Promise.resolve(dialog.close()).catch(error => this.log(error));
      };
      controls.signal.addEventListener("abort", abort, { once: true });
      try {
        // Forced optional effects execute before MIDI creates a dialog. Reserve
        // application first, without re-evaluating or rewriting authored conditions.
        if (!patchedMidi && optional.some(flag => flag.force !== undefined) && !await commitForcedAc()) return { ...NONE };
        if (controls.signal.aborted) return { ...NONE };
        const remaining = expiresAt - this.now();
        if (remaining <= 0) return { ...NONE };
        session.nativeOptions = { ...data.options, timeout: remaining / 1000,
          ...(patchedMidi && optional.length ? { rebreyaBeforeForcedAc: commitForcedAc } : {}) };
        if (controls.chatRetryMs) extend();
        const result = await this._original({
          ...data,
          reactionActivityList: controls.activityUuids ?? activities,
          reactionFlavor: `${data.reactionFlavor ?? ""}<!--rm-reaction:${id}-->`,
          options: session.nativeOptions
        });
        if (session.shieldActivity) {
          const current = (await this.resolve(data.tokenUuid))?.actor ?? actor;
          if (!hasShieldEffect(current)) return { ...NONE };
        }
        if (session.parryActivity) {
          const current = (await this.resolve(data.tokenUuid))?.actor ?? actor;
          if (session.parryResult) return session.parryResult;
          if (result?.uuid === session.parryActivity.uuid) return this.parryResult(session.parryActivity, current) ?? { ...NONE };
          return { ...NONE };
        }
        return session.shieldResult ?? result;
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
    const close = dialog.data.close;
    if (!optional && typeof close === "function") dialog.data.close = function (...args) {
      if (!submitting && !submitted && !session.signal.aborted && !session.finished && adapter.now() < session.expiresAt) session.reportClose?.();
      return close.apply(this, args);
    };
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
      session.extend();
      // Stop the window timer during the already selected optional reaction.
      // MIDI's activity dialog also protects its lexical deadline in the local patch.
      clearTimeout(dialog.timeoutId); clearTimeout(dialog.secondTimeoutId);
      dialog.timeoutId = undefined; dialog.secondTimeoutId = undefined;
      const activityUuid = optional ? undefined : args[1]?.key;
      if (!await session.commit({ activityUuid }) || session.signal.aborted) {
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      const selected = !optional && await adapter.resolve(activityUuid);
      if ((isShieldReactionItem(selected?.item) && !await adapter.canOfferShield(selected, session.shieldContext))
        || (isParry(selected?.item) && !adapter.canOfferParry(selected, session.shieldContext))) {
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      if (session.signal.aborted) {
        dialog.data.completed = false;
        await dialog.close();
        return;
      }
      if (isDefensiveItem(selected?.item)) {
        if (isParry(selected.item)) session.parryActivity = selected;
        else session.shieldActivity = selected;
        session.nativeOptions.configureDialog = false;
        delete session.nativeOptions.targetsToUse;
        session.nativeOptions.targetUuids = [session.tokenUuid];
        session.nativeOptions.workflowOptions = { ...session.nativeOptions.workflowOptions, rebreyaShieldSessionId: match[1] };
      }
      submitted = true;
      session.chosen = true;
      try { return await callback.apply(this, args); }
      finally { submitting = false; }
    };
  }

  log(error) { (this._options.logger ?? console).error("Native reaction adapter failed", error); }
}
