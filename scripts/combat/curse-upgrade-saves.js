const MODULE_ID = "rebreya-main";
const MAX_RECEIPTS = 256;

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function sameSource(left, right) {
  const leftId = left.upgrade?.uuid ?? left.upgrade?.id ?? left.host?.uuid;
  const rightId = right.upgrade?.uuid ?? right.upgrade?.id ?? right.host?.uuid;
  return Boolean(leftId) && leftId === rightId;
}

function receiptPatch(state, eventId, result) {
  if (!eventId) return {};
  const receipts = values(state.saveReceipts).filter(entry => entry.eventId !== eventId).slice(-15);
  return { saveReceipts: [...receipts, { eventId, result }] };
}

/** Conservative activity classification: unknown or condition-bearing saves are excluded. */
export function isDamageOnlySaveActivity(activity) {
  if (activity?.type !== "save") return false;
  const parts = values(activity.damage?.parts);
  if (!parts.length || values(activity.effects).length) return false;
  if (values(activity.item?.effects).some(effect => !effect.disabled && effect.transfer !== true)) return false;
  if (activity.item?.flags?.["midi-qol"]?.onUseMacroName) return false;
  return parts.every(part => {
    const types = values(part.types);
    return types.length > 0 && types.every(type => !["healing", "temphp"].includes(type));
  });
}

/** Save adaptation only; persistence, owner dialogs and status expiry belong to the injected service. */
export class CurseUpgradeSaveAdapter {
  constructor(service) {
    this.service = service;
    this._pending = new Map();
    this._completed = new Map();
    this._actorTails = new Map();
    this._workflows = new WeakMap();
  }

  async _once(actor, eventId, operation) {
    if (!actor?.uuid || typeof eventId !== "string" || !eventId) return operation();
    const key = `${actor.uuid}:${eventId}`;
    if (this._completed.has(key)) return this._completed.get(key);
    if (this._pending.has(key)) return this._pending.get(key);
    const previous = this._actorTails.get(actor.uuid) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(operation).then(result => {
      this._completed.set(key, result);
      while (this._completed.size > MAX_RECEIPTS) this._completed.delete(this._completed.keys().next().value);
      return result;
    }).finally(() => {
      this._pending.delete(key);
      if (this._actorTails.get(actor.uuid) === pending) this._actorTails.delete(actor.uuid);
    });
    this._pending.set(key, pending);
    this._actorTails.set(actor.uuid, pending);
    return pending;
  }

  resolveSaveAuthority(actor, request = {}) {
    const unchanged = { saved: request.saved === true, forced: false, override: false };
    if (!this.service.isAuthority() || typeof request.saved !== "boolean") return Promise.resolve(unchanged);
    return this._once(actor, request.eventId, async () => {
      const sources = this.service.sources(actor, "success");
      const debtSources = this.service.debtSources?.(actor) ?? sources;
      const allSources = [...sources, ...debtSources];
      for (const source of allSources) {
        const receipt = values(this.service.state(source).saveReceipts).find(entry => entry.eventId === request.eventId);
        if (receipt) return receipt.result;
      }
      const owed = debtSources.filter(source => this.service.state(source).forcedFailurePending === true);
      if (owed.length) {
        const result = { saved: false, forced: true, override: true };
        for (const source of owed) await this.service.writeState(source, {
          forcedFailurePending: false, ...receiptPatch(this.service.state(source), request.eventId, result)
        });
        return result;
      }
      const rememberUnchanged = async () => {
        // MIDI needs an authoritative receipt even when the curse declined to override the result.
        // Later MIDI bonuses remain free to change that natural result.
        if (request.eventId?.startsWith("curse-save:") && allSources.length) {
          const source = allSources[0];
          await this.service.writeState(source, receiptPatch(this.service.state(source), request.eventId, unchanged));
        }
        return unchanged;
      };
      if (request.saved) return rememberUnchanged();
      for (const source of sources) {
        if (this.service.state(source).successUsed) continue;
        const accepted = await this.service.prompt(source, {
          title: "Проклятье преследующего успеха",
          body: "Преуспеть в проваленном спасброске? Следующий спасбросок будет автоматически провален. Повторное применение доступно после продолжительного отдыха."
        });
        if (!accepted) continue;
        const current = this.service.sources(actor, "success").find(entry => sameSource(entry, source));
        if (!current || this.service.state(current).successUsed) continue;
        const result = { saved: true, forced: false, override: true };
        await this.service.writeState(current, {
          successUsed: true, forcedFailurePending: true,
          ...receiptPatch(this.service.state(current), request.eventId, result)
        });
        return result;
      }
      return rememberUnchanged();
    });
  }

  resolveMidiChainAuthority(sourceActor, targetActor, request = {}) {
    if (!this.service.isAuthority() || !request.damageOnly || typeof request.saved !== "boolean") {
      return Promise.resolve({ applied: false });
    }
    return this._once(sourceActor, request.eventId, async () => {
      let applied = false;
      for (const source of this.service.sources(sourceActor, "chains")) {
        if (this.service.state(source).chainsPending) {
          if (typeof this.service.recoverPendingChains !== "function") throw new Error("Chain recovery is unavailable.");
          await this.service.recoverPendingChains(source);
          if (this.service.state(source).chainsPending) throw new Error("Chain recovery is still pending.");
        }
        const state = this.service.state(source);
        const receipt = values(state.saveReceipts).find(entry => entry.eventId === request.eventId);
        if (receipt) { applied ||= receipt.result.applied; continue; }
        const now = this.service.now?.() ?? globalThis.game?.time?.worldTime ?? 0;
        const readyAt = Number(this.service.state(source).chainsReadyAt) || 0;
        if (request.saved) {
          if (readyAt > now) {
            await this._applyChains(source, sourceActor, request.eventId, now);
            applied = true;
          }
          continue;
        }
        if (readyAt > now) continue;
        if (!await this.service.prompt(source, {
          title: "Проклятье цепей",
          body: "Опутать цель до конца её следующего хода? Особенность перезаряжается одну минуту."
        })) continue;
        const current = this.service.sources(sourceActor, "chains").find(entry => sameSource(entry, source));
        if (!current || Number(this.service.state(current).chainsReadyAt) > now) continue;
        await this._applyChains(current, targetActor, request.eventId, now, { chainsReadyAt: now + 60 });
        applied = true;
      }
      return { applied };
    });
  }

  async _applyChains(source, targetActor, eventId, now, cooldown = {}) {
    // The intent and its original expiry survive an ambiguous ActiveEffect create/update failure.
    await this.service.writeState(source, {
      ...cooldown,
      chainsPending: { targetActorUuid: targetActor.uuid, eventId, expiresAt: now + 12 },
      ...receiptPatch(this.service.state(source), eventId, { applied: true })
    });
    await this.service.restrain(targetActor, source);
    await this.service.writeState(source, { chainsPending: null });
  }

  /** Called and awaited BEFORE the original D20Roll.buildPost; ordinary Foundry hooks are synchronous. */
  async applyNativeBuildPost(rolls, config = {}, message = {}) {
    const names = (config.hookNames ?? []).map(name => String(name).toLowerCase());
    if (!names.includes("savingthrow") || config.evaluate === false) return;
    const actor = config.subject;
    if (!actor?.uuid || typeof this.service.resolveSaveRequest !== "function") return;
    for (const roll of rolls ?? []) {
      if (!Number.isFinite(roll.total) || !Number.isFinite(roll.options?.target) || roll.options.rebreyaCurseSave) continue;
      const originalTarget = roll.options.target;
      const workflowId = config.midiOptions?.workflowId;
      const eventId = workflowId ? `curse-save:${workflowId}:${actor.uuid}` : globalThis.crypto.randomUUID();
      const before = roll.total >= originalTarget;
      const result = await this.service.resolveSaveRequest({
        actorUuid: actor.uuid, eventId, saved: before,
        death: names.includes("deathsave"), damageOnly: false
      });
      if (typeof result?.saved !== "boolean" || (result.saved === before && !result.forced)) continue;
      roll.options.rebreyaCurseSave = { originalTarget, saved: result.saved, forced: result.forced === true, eventId };
      // MIDI calculates saves separately from totals. Its postCheckSaves boundary consumes this receipt.
      if (!workflowId) roll.options.target = result.saved ? roll.total : roll.total + 1;
      message.data ??= {};
      message.data.flags ??= {};
      message.data.flags[MODULE_ID] ??= {};
      message.data.flags[MODULE_ID].curseSave = roll.options.rebreyaCurseSave;
    }
  }

  /** MIDI awaits postCheckSaves before displaySaves and damage/effect application. */
  applyMidiPostCheckSaves(workflow) {
    if (!workflow || typeof this.service.resolveSaveRequest !== "function") return Promise.resolve();
    const pending = this._workflows.get(workflow);
    if (pending) return pending;
    const operation = this._applyMidiPostCheckSaves(workflow).catch(error => {
      this._workflows.delete(workflow);
      throw error;
    });
    this._workflows.set(workflow, operation);
    return operation;
  }

  async _applyMidiPostCheckSaves(workflow) {
    const activity = workflow.saveActivity ?? workflow.activity;
    if (activity?.type !== "save") return;
    const workflowId = workflow.id ?? workflow.uuid;
    if (!workflowId) return;
    const targets = new Set([...values(workflow.saves), ...values(workflow.failedSaves)]);
    for (const target of targets) {
      const actor = target.actor ?? target.document?.actor;
      if (!actor?.uuid) continue;
      const eventId = `curse-save:${workflowId}:${actor.uuid}`;
      const saved = workflow.saves?.has(target) === true;
      const evidence = {
        workflowId, itemCardUuid: workflow.itemCardUuid || (workflow.itemCardId ? `ChatMessage.${workflow.itemCardId}` : ""),
        activityUuid: workflow.activity?.uuid ?? activity.uuid ?? "",
        targetUuid: target.document?.uuid ?? target.uuid ?? "", sourceActorUuid: workflow.actor?.uuid ?? ""
      };
      const saveSources = this.service.sources(actor, "success");
      const debtSources = this.service.debtSources?.(actor) ?? saveSources;
      const result = saveSources.length || debtSources.length
        ? await this.service.resolveSaveRequest({ actorUuid: actor.uuid, eventId, saved, death: false, damageOnly: false, ...evidence })
        : null;
      const finalSaved = result?.override !== false && typeof result?.saved === "boolean" ? result.saved : saved;
      if (finalSaved !== saved) {
        workflow.saves ??= new Set();
        workflow.failedSaves ??= new Set();
        if (typeof workflow.updateSaveFailSets === "function") workflow.updateSaveFailSets(target, finalSaved);
        else {
          (finalSaved ? workflow.saves : workflow.failedSaves).add(target);
          (finalSaved ? workflow.failedSaves : workflow.saves).delete(target);
        }
        for (const row of workflow.saveDisplayData ?? []) {
          if (row.target !== target && row.id !== target.id) continue;
          row.saveClass = finalSaved ? "success" : "failure";
          row.saveSymbol = String(row.saveSymbol ?? "").replace(/fa-(?:check|xmark)/gu, finalSaved ? "fa-check" : "fa-xmark");
        }
      }
      if (workflow.actor?.uuid && isDamageOnlySaveActivity(activity)) {
        await this.service.resolveSaveRequest({
          kind: "chains", actorUuid: actor.uuid, sourceActorUuid: workflow.actor.uuid,
          eventId: `${eventId}:chains`, saved: finalSaved, death: false, damageOnly: true, ...evidence
        });
      }
    }
  }
}
