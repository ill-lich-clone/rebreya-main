/**
 * One-click character import by share code (no site password in Foundry).
 *
 * Flow (site contract, see rebreya-site-api.js claimShareCode):
 *  1. The player makes a one-time code on rebreya.com (15 min, single use).
 *  2. Their Foundry client exchanges it for a per-character link token + the
 *     character payload (POST /characters/claim/, no auth).
 *  3. The Actor is created and the build imported:
 *       - the player may create Actors → done on their client;
 *       - otherwise → the request is relayed over the module socket to the
 *         active GM, whose client creates the Actor owned by that player.
 *  4. The link token is stored ONLY in the importing player's client settings
 *     (see settings.js SITE_LINK_TOKENS for why) and is used afterwards for
 *     re-import and state push/pull instead of the password login.
 *
 * The link token never goes over the socket: Foundry module socket messages
 * are delivered to every connected client. Only the character payload (which
 * ends up on the Actor anyway) is relayed to the GM.
 */
import { MODULE_ID } from "../constants.js";

export const SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const SHARE_IMPORT_REQUEST = "rebreyaSiteShareImportRequest";
export const SHARE_IMPORT_RESULT = "rebreyaSiteShareImportResult";
const OWNER = 3;
const NONE = 0;

export class SiteShareImport {
  /**
   * @param {object} moduleApi game.rebreyaMain (needs .site and .characterSync)
   * @param {object} [opts]
   * @param {() => object} [opts.gameRef] injectable `game` (tests)
   * @param {() => object} [opts.actorClass] injectable `Actor` class (tests)
   * @param {number} [opts.timeoutMs] how long a player waits for the GM
   */
  constructor(moduleApi, { gameRef = () => globalThis.game, actorClass = () => globalThis.Actor, timeoutMs = 60000 } = {}) {
    this.moduleApi = moduleApi;
    this._game = gameRef;
    this._actorClass = actorClass;
    this.timeoutMs = timeoutMs;
    this._pending = new Map();
  }

  get game() { return this._game(); }
  get site() { return this.moduleApi?.site ?? null; }
  get characterSync() { return this.moduleApi?.characterSync ?? null; }

  /** True when this user may create Actors directly (GMs always). */
  canCreateActors(user = this.game?.user) {
    if (!user) return false;
    if (user.isGM) return true;
    return typeof user.can === "function" ? Boolean(user.can("ACTOR_CREATE")) : false;
  }

  /** The GM that would handle a relayed import, or null when none is online. */
  activeGm() {
    const users = this.game?.users;
    if (!users) return null;
    if (users.activeGM !== undefined) return users.activeGM ?? null;
    const list = Array.isArray(users.contents) ? users.contents : Array.from(users.values?.() ?? users);
    return list.find((u) => u?.active && u?.isGM) ?? null;
  }

  worldLabel() {
    const title = String(this.game?.world?.title ?? this.game?.world?.id ?? "").trim();
    return title ? `Foundry: ${title}` : "Foundry";
  }

  /**
   * Import (or re-link) a site character by share code.
   * @param {string} code as typed by the player
   * @param {object} [opts]
   * @param {object|null} [opts.actor] link this existing Actor instead of creating one
   * @returns {Promise<{actor:object, result:object, route:"existing"|"local"|"gm"}>}
   */
  async importByCode(code, { actor = null } = {}) {
    const site = this.site;
    if (!site?.api) throw new Error("Интеграция с сайтом недоступна.");
    if (site.isEnabled && !site.isEnabled()) throw new Error("Интеграция с rebreya.com выключена в настройках мира.");
    const user = this.game?.user;

    // Decide the route BEFORE claiming: the code is single-use.
    let route;
    if (actor) {
      if (actor.isOwner === false) throw new Error("Вы не владелец этого персонажа.");
      route = "existing";
    } else if (this.canCreateActors(user)) {
      route = "local";
    } else if (this.activeGm()) {
      route = "gm";
    } else {
      throw new Error("Создать персонажа может только ГМ, а ГМа сейчас нет в игре. Попросите ГМа зайти и повторите — код пока не использован.");
    }

    const { linkToken, character } = await site.api.claimShareCode(code, this.worldLabel());

    let target = actor;
    let result;
    if (route === "existing") {
      result = await this.characterSync.importBuild(actor, character, { syncMode: "link-token" });
    } else if (route === "local") {
      target = await this.#createActor(character, user.id);
      result = await this.characterSync.importBuild(target, character, { syncMode: "link-token", ownerUserId: user.id });
    } else {
      const reply = await this.#requestGmImport(character);
      target = await this.#waitForActor(reply.actorId);
      result = reply;
      if (!target) throw new Error("ГМ создал персонажа, но он не появился у вас — обновите страницу.");
    }

    await site.setLinkToken(target.id, { token: linkToken, siteId: character?.id ?? null });
    return { actor: target, result, route };
  }

  async #createActor(character, ownerId) {
    const ActorClass = this._actorClass();
    const name = String(character?.name ?? "").trim() || "Персонаж Ребреи";
    return ActorClass.create({
      name,
      type: "character",
      ownership: { default: NONE, ...(ownerId ? { [ownerId]: OWNER } : {}) },
    });
  }

  async #waitForActor(actorId, { attempts = 20, delayMs = 100 } = {}) {
    for (let i = 0; i < attempts; i += 1) {
      const actor = this.game?.actors?.get?.(actorId);
      if (actor) return actor;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
  }

  #requestGmImport(character) {
    const game = this.game;
    const requestId = `share-import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error("ГМ не ответил вовремя. Код уже использован — получите новый на сайте и повторите."));
      }, this.timeoutMs);
      this._pending.set(requestId, { resolve, reject, timer });
      game.socket.emit(SOCKET_CHANNEL, {
        type: SHARE_IMPORT_REQUEST,
        requestId,
        senderId: game.user.id,
        character,
      });
    });
  }

  /** Socket handler: GM side executes requests, player side receives results. */
  async handleSocketMessage(message) {
    if (!message || typeof message !== "object") return;
    const game = this.game;
    if (message.type === SHARE_IMPORT_RESULT) {
      if (message.forUserId !== game?.user?.id) return;
      const pending = this._pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this._pending.delete(message.requestId);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error || "ГМ не смог создать персонажа."));
      return;
    }
    if (message.type !== SHARE_IMPORT_REQUEST) return;
    // Exactly one client handles it: the active GM.
    const gm = this.activeGm();
    if (!game?.user?.isGM || (gm && gm.id !== game.user.id)) return;

    const reply = { type: SHARE_IMPORT_RESULT, requestId: message.requestId, forUserId: message.senderId };
    try {
      const requester = game.users?.get?.(message.senderId);
      if (!requester) throw new Error("Неизвестный пользователь запроса.");
      const character = message.character;
      if (!character || typeof character !== "object") throw new Error("Пустые данные персонажа.");
      const actor = await this.#createActor(character, requester.id);
      const result = await this.characterSync.importBuild(actor, character, { syncMode: "link-token", ownerUserId: requester.id });
      game.socket.emit(SOCKET_CHANNEL, {
        ...reply,
        ok: true,
        actorId: actor.id,
        itemsCreated: result?.itemsCreated ?? 0,
        spellsAdded: result?.spellsAdded ?? 0,
        classes: result?.classes ?? [],
        warnings: result?.warnings ?? [],
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Share-code import for another user failed.`, error);
      game.socket.emit(SOCKET_CHANNEL, { ...reply, ok: false, error: error?.message ?? String(error) });
    }
  }

  registerSocket() {
    const socket = this.game?.socket;
    if (!socket?.on || this._socketRegistered) return;
    socket.on(SOCKET_CHANNEL, (message) => {
      this.handleSocketMessage(message).catch((error) => console.error(`${MODULE_ID} | Share-import socket error.`, error));
    });
    this._socketRegistered = true;
  }
}

/**
 * Wire the share-code import into Foundry: service on the module API, socket
 * listener (GM relay), and the Actors directory button. Called once from the
 * module's ready hook.
 */
export async function registerSiteShareImport(moduleApi) {
  const service = new SiteShareImport(moduleApi);
  moduleApi.siteShareImport = service;
  service.registerSocket();
  const { bindActorDirectoryShareButton } = await import("./site-sync-panel.js");
  globalThis.Hooks?.on?.("renderActorDirectory", (_app, html) => bindActorDirectoryShareButton(html, moduleApi));
  // The directory may already be rendered by the time ready fires.
  const directory = globalThis.ui?.actors;
  if (directory?.element) bindActorDirectoryShareButton(directory.element, moduleApi);
  return service;
}
