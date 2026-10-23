import { MODULE_ID } from "../constants.js";

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

  async initialize() {
    const midi = this._options.midiProvider?.() ?? globalThis.MidiQOL;
    if (!midi) return false;
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
      const session = { ...controls, actor, expiresAt: this.now() + TIMEOUT, dialogs: new Set(), chosen: false, finished: false };
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
