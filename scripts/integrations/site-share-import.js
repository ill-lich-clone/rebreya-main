/**
 * One-click character import by share code (no site password in Foundry).
 *
 * Flow (site contract, see rebreya-site-api.js claimShareCode):
 *  1. The player makes a one-time code on rebreya.com (15 min, single use).
 *  2. Their Foundry client exchanges it for a per-character link token + the
 *     character payload (POST /characters/claim/, no auth).
 *  3. The Actor is created and the build imported:
 *       - the player may create Actors → done on their client;
 *       - otherwise → the typed socket command `site.share-import.create-actor`
 *         (SocketCommandBus) asks the active GM's client to create the Actor,
 *         owned by the transport-authenticated sender.
 *  4. The link token is stored ONLY in the importing player's client settings
 *     (see settings.js SITE_LINK_TOKENS for why) and is used afterwards for
 *     re-import and state push/pull instead of the password login.
 *
 * The link token never goes over the socket: Foundry module socket messages
 * are delivered to every connected client. Only the character payload (which
 * ends up on the Actor anyway) is relayed to the GM.
 */
import { MODULE_ID } from "../constants.js";
import { keyedMutationScheduling } from "../application/socket-command-scheduling.js?v=1.5.3";

export const SHARE_IMPORT_COMMAND = "site.share-import.create-actor";
/** The socket envelope limit is 64 KiB; keep the character well below it. */
export const MAX_SHARED_CHARACTER_BYTES = 48000;
const OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * Exact payload of the GM relay: `{operationId, character}`. The character is
 * the site's claim payload (it ends up on the Actor anyway); the link token is
 * never part of it.
 */
export function isValidShareImportPayload(payload) {
  if (!isPlainObject(payload)) return false;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes("operationId") || !keys.includes("character")) return false;
  if (typeof payload.operationId !== "string" || !OPERATION_ID.test(payload.operationId)) return false;
  const character = payload.character;
  if (!isPlainObject(character)) return false;
  if (!Number.isSafeInteger(character.id) || character.id <= 0) return false;
  if (character.name !== undefined && (typeof character.name !== "string" || character.name.length > 200)) return false;
  let size;
  try { size = new TextEncoder().encode(JSON.stringify(character)).byteLength; } catch (_error) { return false; }
  return size <= MAX_SHARED_CHARACTER_BYTES;
}

/**
 * Any current non-GM user may ask the GM to create their own imported
 * character; the owner is always the authenticated sender, never a payload field.
 */
export function authorizeShareImport(_payload, { sender, game } = {}) {
  if (!sender?.id || sender.isGM) return false;
  return game?.users?.get?.(sender.id) === sender;
}

/** Register the GM relay on the module's SocketCommandBus. */
export function registerShareImportCommand(commandBus, service) {
  commandBus.register(SHARE_IMPORT_COMMAND, {
    validate: isValidShareImportPayload,
    authorize: (payload, context) => authorizeShareImport(payload, context),
    scheduling: keyedMutationScheduling((payload) => [`site-share-import:${payload.operationId}`]),
    execute: (payload, context) => service.executeGmImport(payload.character, context.sender),
  });
}

const SOCKET_ERRORS = {
  "active-gm-unavailable": "ГМа сейчас нет в игре.",
  "active-gm-changed": "ГМ сменился во время импорта.",
  "envelope-too-large": "Персонаж слишком большой для передачи ГМу.",
  "invalid-payload": "ГМ отклонил данные персонажа.",
  "unauthorized": "ГМ отклонил запрос на создание персонажа.",
};
const OWNER = 3;
const NONE = 0;

export class SiteShareImport {
  /**
   * @param {object} moduleApi game.rebreyaMain (needs .site and .characterSync)
   * @param {object} [opts]
   * @param {() => object} [opts.gameRef] injectable `game` (tests)
   * @param {() => object} [opts.actorClass] injectable `Actor` class (tests)
   * @param {object} [opts.commandBus] SocketCommandBus (defaults to moduleApi.socketCommandBus)
   * @param {() => string} [opts.operationIdFactory] injectable id source (tests)
   */
  constructor(moduleApi, { gameRef = () => globalThis.game, actorClass = () => globalThis.Actor, commandBus = null, operationIdFactory = null } = {}) {
    this.moduleApi = moduleApi;
    this._game = gameRef;
    this._actorClass = actorClass;
    this._commandBus = commandBus;
    this._operationId = operationIdFactory
      ?? (() => `share-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  get commandBus() { return this._commandBus ?? this.moduleApi?.socketCommandBus ?? null; }

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
    // Record whose browser holds the token: that client runs auto-sync for it.
    if (typeof target.update === "function" && user?.id) {
      await target.update({ [`flags.${MODULE_ID}.siteCharacter.linkHolderUserId`]: user.id }, { rebreyaSiteSync: true });
    }
    // Site in-play state (slots, hit dice, conditions…) + sync baseline.
    if (typeof this.characterSync?.applySiteState === "function") {
      try {
        await this.characterSync.applySiteState(target);
      } catch (error) {
        (result.warnings ??= []).push(`Не удалось подтянуть состояние с сайта: ${error.message}`);
      }
    }
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

  async #requestGmImport(character) {
    const bus = this.commandBus;
    if (!bus?.request) throw new Error("Канал связи с ГМом недоступен.");
    try {
      return await bus.request(SHARE_IMPORT_COMMAND, { operationId: this._operationId(), character });
    } catch (error) {
      const reason = SOCKET_ERRORS[error?.code] ?? error?.message ?? String(error);
      throw new Error(`${reason} Код уже использован — получите новый на сайте и повторите.`);
    }
  }

  /**
   * GM side of the relay (runs on the active GM client via SocketCommandBus).
   * @param {object} character validated claim payload
   * @param {object} requester transport-authenticated sender User
   */
  async executeGmImport(character, requester) {
    const site = this.site;
    if (site?.isEnabled && !site.isEnabled()) throw new Error("Интеграция с rebreya.com выключена в настройках мира.");
    const actor = await this.#createActor(character, requester.id);
    const result = await this.characterSync.importBuild(actor, character, { syncMode: "link-token", ownerUserId: requester.id });
    return {
      actorId: actor.id,
      itemsCreated: result?.itemsCreated ?? 0,
      spellsAdded: result?.spellsAdded ?? 0,
      classes: result?.classes ?? [],
      warnings: result?.warnings ?? [],
    };
  }
}

/**
 * Wire the share-code import into Foundry: service on the module API, the GM
 * relay command on the SocketCommandBus, and the Actors directory button. Called once from the
 * module's ready hook.
 */
export async function registerSiteShareImport(moduleApi) {
  const service = new SiteShareImport(moduleApi);
  moduleApi.siteShareImport = service;
  if (moduleApi.socketCommandBus) registerShareImportCommand(moduleApi.socketCommandBus, service);
  const { bindActorDirectoryShareButton } = await import("./site-sync-panel.js");
  globalThis.Hooks?.on?.("renderActorDirectory", (_app, html) => bindActorDirectoryShareButton(html, moduleApi));
  // The directory may already be rendered by the time ready fires.
  const directory = globalThis.ui?.actors;
  if (directory?.element) bindActorDirectoryShareButton(directory.element, moduleApi);
  return service;
}
