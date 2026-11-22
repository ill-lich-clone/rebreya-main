/**
 * Automatic in-play state sync between linked Actors and the site, both ways,
 * over the share-code link token (/characters/linked/state/).
 *
 * Who syncs: exactly one client per Actor — the browser holding that Actor's
 * link token (the user who linked it by code, recorded as
 * `siteCharacter.linkHolderUserId`). The token never leaves that browser, so a
 * GM client cannot push for it; it does not need to, because Actor/Item/effect
 * updates made by anyone (GM damage included) reach the holder's client as
 * document updates and are pushed from there. If the holder is offline, nothing
 * syncs until they return; the next pull/push then reconciles (conflict dialog
 * when both sides moved).
 *
 * Push: any relevant change → mark the Actor pending; after a quiet period
 * (debounce) and at least `minPatchGapMs` since the previous PATCH from this
 * client, push one Actor at a time (one request in flight). A push is skipped
 * when the state fingerprint equals the last synced one — this also swallows
 * the echo of our own pull.
 *
 * Pull: on sheet render (throttled) and every `pollMs`: GET the state; if the
 * site moved and Foundry did not → apply silently; if only Foundry moved →
 * push; if both moved → the conflict dialog, once per remote state.
 *
 * Budget: the site allows 600 state PATCH/hour per IP; the default 8 s gap
 * caps this client at 450/hour however busy combat gets.
 */
import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

export const AUTO_SYNC_DEFAULTS = Object.freeze({
  debounceMs: 2000,
  minPatchGapMs: 8000,
  pollMs: 30000,
  renderPullGapMs: 10000,
});

export class SiteAutoSync {
  /**
   * @param {object} moduleApi game.rebreyaMain (site, characterSync)
   * @param {object} [opts]
   * @param {() => object} [opts.gameRef]
   * @param {() => number} [opts.now]
   * @param {{setTimeout:Function, clearTimeout:Function, setInterval:Function, clearInterval:Function}} [opts.timers]
   * @param {() => boolean} [opts.worldEnabled] world-level auto-sync switch
   * @param {(actor:object, conflict:object) => Promise<void>} [opts.onConflict]
   * @param {(kind:string, message:string) => void} [opts.notify]
   */
  constructor(moduleApi, {
    gameRef = () => globalThis.game,
    now = () => Date.now(),
    timers = globalThis,
    worldEnabled = null,
    onConflict = null,
    notify = null,
    ...config
  } = {}) {
    this.moduleApi = moduleApi;
    this._game = gameRef;
    this._now = now;
    this._timers = timers;
    this._worldEnabled = worldEnabled;
    this._onConflict = onConflict;
    this._notify = notify ?? ((kind, message) => globalThis.ui?.notifications?.[kind]?.(message));
    this.config = { ...AUTO_SYNC_DEFAULTS, ...config };
    this.pending = new Set();
    this._lastChangeAt = 0;
    this._lastPatchAt = -Infinity;
    this._timer = null;
    this._inFlight = null;
    this._pulling = new Set();
    this._lastRenderPull = new Map();
    this._conflictShown = new Map();
    this._revokedNotified = new Set();
    this._interval = null;
  }

  get game() { return this._game(); }
  get characterSync() { return this.moduleApi?.characterSync ?? null; }

  isWorldEnabled() {
    if (this.moduleApi?.site?.isEnabled && !this.moduleApi.site.isEnabled()) return false;
    return this._worldEnabled ? Boolean(this._worldEnabled()) : true;
  }

  /** This client is the one that syncs this Actor. */
  isElected(actor) {
    if (!actor || !this.isWorldEnabled()) return false;
    const sync = this.characterSync;
    const link = sync?.getLink?.(actor);
    if (!link || link.autoSync === false) return false;
    if (!sync.getLinkToken?.(actor)) return false;
    const holder = link.linkHolderUserId;
    return !holder || holder === this.game?.user?.id;
  }

  // --- Push -------------------------------------------------------------------

  /** A relevant document change happened on (or to) this Actor. */
  notifyChange(actor, options = {}) {
    if (options?.rebreyaSiteSync) return; // our own pull/acknowledge
    if (!this.isElected(actor)) return;
    this.pending.add(actor.id);
    this._lastChangeAt = this._now();
    this.#kick();
  }

  #kick() {
    if (this._timer || this._inFlight || !this.pending.size) return;
    const now = this._now();
    const wait = Math.max(
      0,
      this.config.debounceMs - (now - this._lastChangeAt),
      this._lastPatchAt + this.config.minPatchGapMs - now,
    );
    this._timer = this._timers.setTimeout(() => {
      this._timer = null;
      this._inFlight = this.#processOne().finally(() => {
        this._inFlight = null;
        this.#kick();
      });
    }, wait);
  }

  /** Push the oldest pending Actor (at most one request in flight). */
  async #processOne() {
    const now = this._now();
    if (now - this._lastChangeAt < this.config.debounceMs) return; // still busy — #kick re-arms
    const [actorId] = this.pending;
    if (!actorId) return;
    this.pending.delete(actorId);
    const actor = this.game?.actors?.get?.(actorId);
    if (!actor || !this.isElected(actor)) return;
    const sync = this.characterSync;
    if (!sync.isLocallyDirty(actor)) return; // nothing new (e.g. echo of a pull)
    this._lastPatchAt = now;
    try {
      const res = await sync.pushState(actor);
      if (res?.conflict) await this.#conflict(actor, res);
    } catch (error) {
      this.#handleError(actor, error);
    }
  }

  // --- Pull -------------------------------------------------------------------

  /**
   * Reconcile one Actor with the site.
   * @returns {Promise<"skipped"|"same"|"pushed"|"applied"|"conflict"|"error">}
   */
  async pullActor(actor) {
    if (!this.isElected(actor) || this._pulling.has(actor.id) || this.pending.has(actor.id)) return "skipped";
    this._pulling.add(actor.id);
    try {
      const sync = this.characterSync;
      const remote = await sync.fetchRemoteState(actor);
      const remoteHash = remote?.stateHash ?? "";
      const known = sync.getLink(actor)?.lastStateHash ?? "";
      const dirty = sync.isLocallyDirty(actor);
      if (!remoteHash || remoteHash === known) {
        if (dirty) { this.notifyChange(actor); return "pushed"; }
        return "same";
      }
      if (!dirty) {
        await sync.applySiteState(actor, remote);
        return "applied";
      }
      await this.#conflict(actor, { ok: false, conflict: true, remote, remoteHash });
      return "conflict";
    } catch (error) {
      this.#handleError(actor, error);
      return "error";
    } finally {
      this._pulling.delete(actor.id);
    }
  }

  /** Sheet rendered: pull, at most once per `renderPullGapMs` per Actor. */
  onSheetRender(actor) {
    if (!actor || !this.isElected(actor)) return;
    const now = this._now();
    const last = this._lastRenderPull.get(actor.id) ?? -Infinity;
    if (now - last < this.config.renderPullGapMs) return;
    this._lastRenderPull.set(actor.id, now);
    this.pullActor(actor);
  }

  /** Pull every Actor this client syncs (sequentially — light on the site). */
  async pullAll() {
    const actors = [...(this.game?.actors ?? [])].filter((a) => this.isElected(a));
    const results = {};
    for (const actor of actors) results[actor.id] = await this.pullActor(actor);
    return results;
  }

  start() {
    if (this._interval) return;
    this._interval = this._timers.setInterval(() => { this.pullAll(); }, this.config.pollMs);
    this.pullAll();
  }

  /**
   * Keep the poll loop running only while the site integration and world
   * auto-sync are on (no idle 30 s timer in worlds that never use the site).
   * Called on ready and from the settings' onChange.
   */
  syncLoop() {
    if (this.isWorldEnabled()) this.start();
    else this.stop();
  }

  stop() {
    if (this._interval) this._timers.clearInterval(this._interval);
    this._interval = null;
    if (this._timer) this._timers.clearTimeout(this._timer);
    this._timer = null;
  }

  // --- Errors / conflicts ---------------------------------------------------------

  async #conflict(actor, conflict) {
    const hash = conflict?.remoteHash ?? conflict?.remote?.stateHash ?? "";
    if (this._conflictShown.get(actor.id) === hash) return; // asked already for this site state
    this._conflictShown.set(actor.id, hash);
    if (this._onConflict) await this._onConflict(actor, conflict);
  }

  #handleError(actor, error) {
    if (error?.name === "LinkRevoked") {
      if (!this._revokedNotified.has(actor.id)) {
        this._revokedNotified.add(actor.id);
        this._notify("warn", `«${actor.name}»: связь с сайтом отозвана — автосинхронизация остановлена. Свяжите персонажа заново по коду.`);
      }
      return;
    }
    console.warn(`${MODULE_ID} | Auto-sync failed for ${actor?.name ?? actor?.id}.`, error);
  }
}

/** Foundry wiring: hooks, poll loop, conflict dialog. Called from the ready hook. */
export async function registerSiteAutoSync(moduleApi) {
  const { resolveStateConflict } = await import("./site-sync-panel.js");
  const auto = new SiteAutoSync(moduleApi, {
    worldEnabled: () => {
      try { return Boolean(globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.SITE_AUTO_SYNC)); } catch (_e) { return true; }
    },
    onConflict: (actor, conflict) => resolveStateConflict(actor, moduleApi, conflict),
  });
  moduleApi.siteAutoSync = auto;
  const H = globalThis.Hooks;
  const actorOf = (doc) => (doc?.documentName === "Actor" ? doc : doc?.parent?.documentName === "Actor" ? doc.parent : doc?.actor ?? null);
  H.on("updateActor", (actor, _changes, options) => auto.notifyChange(actor, options));
  for (const hook of ["createActiveEffect", "deleteActiveEffect"]) {
    H.on(hook, (effect, options) => {
      const actor = actorOf(effect);
      if (actor) auto.notifyChange(actor, options);
    });
  }
  H.on("updateActiveEffect", (effect, _changes, options) => {
    const actor = actorOf(effect);
    if (actor) auto.notifyChange(actor, options);
  });
  H.on("updateItem", (item, _changes, options) => {
    if (item?.type === "class" && item.parent) auto.notifyChange(item.parent, options);
  });
  for (const hook of ["renderActorSheet", "renderActorSheetV2"]) {
    H.on(hook, (app) => auto.onSheetRender(app?.actor ?? app?.document ?? null));
  }
  auto.syncLoop();
  return auto;
}
