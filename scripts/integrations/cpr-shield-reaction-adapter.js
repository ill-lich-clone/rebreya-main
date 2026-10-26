import { MODULE_ID } from "../constants.js";
import { isManagedShield, hasShieldEffect } from "../data/shield-spell-item.js?v=1.5.8";

const WRAPPED = Symbol.for(`${MODULE_ID}.cprShieldReactionAdapter`);
const CONTENT = "CHRISPREMADES.Macros.MagicMissile.Shield";
const NONE = Object.freeze({ name: "None" });
const values = collection => Array.from(collection?.contents ?? collection?.values?.() ?? collection ?? []);
const isShieldDialog = content => typeof content === "string"
  && (content === CONTENT || content === globalThis.game?.i18n?.localize?.(CONTENT));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// CPR's native selector and completeItemUse execute on the defending owner client.
// Keep the shared permission alive across their socket handoff; CPR still owns bolts/damage.
export class CprShieldReactionAdapter {
  constructor(moduleApi, options = {}) {
    this.moduleApi = moduleApi;
    this.options = options;
    this.pending = new Map();
    this.sessions = new Set();
    this.actorRuns = new Map();
  }

  initialize() {
    const cpr = this.options.cprProvider?.() ?? globalThis.chrisPremades;
    const midi = this.options.midiProvider?.() ?? globalThis.MidiQOL;
    if (!cpr) return false;
    const Dialog = cpr.DialogApp;
    const selectors = cpr.utils?.dialogUtils;
    if (!Dialog?.dialog || !Dialog.prototype?.render || !midi?.completeItemUse || !selectors?.selectDocumentDialog) {
      throw new Error("Rebreya: несовместимый CPR API реакции «Щит» (ожидается CPR 1.5.44 / MIDI 13.0.61).");
    }
    if (Dialog.dialog[WRAPPED] === this) return true;
    if (Dialog.dialog[WRAPPED] || midi.completeItemUse[WRAPPED]) throw new Error("CPR Shield adapter already owned");
    this.Dialog = Dialog;
    this.originalDialog = Dialog.dialog;
    this.originalUse = midi.completeItemUse;
    const selectDocument = selectors.selectDocumentDialog;
    selectors.selectDocumentDialog = function(title, content, documents, ...rest) {
      if (isShieldDialog(content) && documents.some(isManagedShield)) {
        // CPR's original UUID mode survives the socket boundary without losing synthetic identity.
        documents = documents.map(doc => ({ uuid: doc.uuid, name: doc.name, img: doc.img,
          actor: doc.actor, system: doc.system, flags: doc.flags, reference: doc.reference }));
      }
      return selectDocument.call(this, title, content, documents, ...rest);
    };
    const adapter = this;
    const render = Dialog.prototype.render;
    Dialog.prototype.render = function(...args) {
      if (adapter.opening) adapter.opening.dialogs.add(this);
      return render.apply(this, args);
    };
    Dialog.dialog = function(...args) { return adapter.routeDialog(args, this); };
    Dialog.dialog[WRAPPED] = this;
    midi.completeItemUse = function(...args) { return adapter.routeItemUse(args, this); };
    midi.completeItemUse[WRAPPED] = this;
    return true;
  }

  actors() {
    if (this.options.actorsProvider) return this.options.actorsProvider();
    return [...values(globalThis.game?.actors), ...values(globalThis.canvas?.scene?.tokens).map(token => token.actor).filter(Boolean)];
  }

  async routeDialog(args, receiver = this.Dialog) {
    if (!isShieldDialog(args[1])) return this.originalDialog.apply(receiver, args);
    const buttons = args[2]?.filter(input => input[0] === "button").flatMap(input => input[1]) ?? [];
    const ids = new Set(buttons.map(button => button.name));
    const matches = new Map();
    for (const actor of this.actors()) {
      const items = values(actor.items).filter(item => (ids.has(item.uuid) || ids.has(item.id)) && isManagedShield(item));
      if (items.length) matches.set(actor.uuid, { actor, items });
    }
    if (matches.size !== 1) return this.originalDialog.apply(receiver, args);
    const { actor, items } = matches.values().next().value;
    if (this.actorRuns.size >= 128 && !this.actorRuns.has(actor.uuid)) return null;
    const previous = this.actorRuns.get(actor.uuid) ?? Promise.resolve();
    const finished = deferred();
    this.actorRuns.set(actor.uuid, finished.promise);
    const release = () => {
      if (this.actorRuns.get(actor.uuid) === finished.promise) this.actorRuns.delete(actor.uuid);
      finished.resolve();
    };
    return previous.then(() => this.routeOwnedDialog(args, receiver, actor, items, release))
      .catch(error => { release(); throw error; });
  }

  async routeOwnedDialog(args, receiver, actor, items, release) {
    // A concurrent CPR macro may have checked the effect before another attack cast Shield.
    // Return its normal selection shape so CPR rechecks the now-active effect after the no-op use.
    if (hasShieldEffect(actor)) {
      const uuidMode = args[2]?.some(input => input[0] === "button" && input[1].some(button => button.name === items[0].uuid));
      release(); return { buttons: uuidMode ? items[0].uuid : items[0].id };
    }
    const usable = [];
    for (const item of items) {
      const activity = values(item.system?.activities).find(entry => entry.activation?.type?.startsWith("reaction"));
      if (activity && await this.options.canOfferShield(activity, { magicMissile: true })) usable.push({ item, activity });
    }
    if (!usable.length) { release(); return null; }
    const selected = deferred(); const applied = deferred();
    const session = { actor, dialogs: new Set(), selected, applied, usePromise: null };
    this.sessions.add(session);
    const triggerId = `cpr-shield:${this.options.idFactory?.() ?? globalThis.crypto?.randomUUID?.() ?? Date.now()}:${actor.uuid}`;
    session.done = Promise.resolve().then(() => this.moduleApi.reactionQueueService.resolveManagedReaction({
      kind: "midi-native", triggerId, candidate: { actorUuid: actor.uuid, activityUuids: usable.map(entry => entry.activity.uuid) }
    }, async controls => {
      const abort = () => {
        selected.resolve(null);
        for (const dialog of session.dialogs) void Promise.resolve(dialog.close()).catch(error => this.log(error));
      };
      controls.signal.addEventListener("abort", abort, { once: true });
      try {
        if (controls.signal.aborted) return { ...NONE };
        let choice;
        this.opening = session;
        try { choice = this.originalDialog.apply(receiver, args); }
        finally { this.opening = null; }
        const result = await choice;
        const entry = usable.find(candidate => candidate.item.uuid === result?.buttons || candidate.item.id === result?.buttons);
        if (!entry) { selected.resolve(result); return { ...NONE }; }
        if (controls.signal.aborted || !await this.options.canOfferShield(entry.activity, { magicMissile: true })
          || !await controls.commit({ activityUuid: entry.activity.uuid })) {
          selected.resolve(null); return { ...NONE };
        }
        session.item = entry.item;
        this.pending.set(entry.item.uuid, session);
        selected.resolve(result);
        return await applied.promise;
      } finally {
        controls.signal.removeEventListener("abort", abort);
        for (const dialog of session.dialogs) void Promise.resolve(dialog.close()).catch(error => this.log(error));
      }
    })).catch(error => { selected.reject(error); this.log(error); return { ...NONE }; }).finally(() => {
      if (session.item && this.pending.get(session.item.uuid) === session) this.pending.delete(session.item.uuid);
      this.sessions.delete(session);
      selected.resolve(null);
      release();
    });
    return selected.promise;
  }

  routeItemUse(args, receiver) {
    const [item] = args;
    const session = this.pending.get(item?.uuid);
    if (!session) {
      if (isManagedShield(item) && hasShieldEffect(item.actor)) return Promise.resolve(undefined);
      return this.originalUse.apply(receiver, args);
    }
    return session.usePromise ??= (async () => {
      try {
        const result = await this.originalUse.apply(receiver, args);
        session.applied.resolve(result && hasShieldEffect(session.actor) ? { name: item.name ?? "Щит", uuid: item.uuid } : { ...NONE });
        await session.done;
        return result;
      } catch (error) {
        session.applied.resolve({ ...NONE });
        await session.done;
        throw error;
      }
    })();
  }

  log(error) { (this.options.logger ?? console).error("CPR Shield reaction failed", error); }
}
