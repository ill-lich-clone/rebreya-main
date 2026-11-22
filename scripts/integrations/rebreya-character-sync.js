/**
 * Character sync service (integration ТЗ §5.2, §8).
 *
 * Links a site character to a dnd5e Actor and imports the build. MVP scope:
 * site → Foundry (scalar build + embedded site spells). Mutable-state push
 * (Foundry → site) is a later stage. Orchestration only — the scalar mapping
 * lives in the (unit-tested) site-character-mapper; this service touches
 * Foundry documents and is verified live.
 */
import { MODULE_ID } from "../constants.js";
import {
  buildCharacterActorUpdate,
  buildSiteCharacterFlags,
  buildStatePatch,
  buildActorStateUpdate,
  detectStateConflict,
  buildSlotValueUpdate,
} from "../data/site-character-mapper.js";
import {
  sumSpentHitDice,
  distributeSpentHitDice,
  diffStatuses,
  fromSiteConditions,
  stateSignature,
} from "../data/site-state-mapping.js";
import { SITE_SPELLS_COMPENDIUM_NAME } from "../data/site-spells-compendium.js";
import { SiteBuildImporter } from "./site-build-importer.js";
import { LinkRevoked } from "./rebreya-site-api.js";

const SPELLS_PACK_ID = `world.${SITE_SPELLS_COMPENDIUM_NAME}`;
/** Link-flag fields that survive a re-import (sync state, not build data). */
const PRESERVED_LINK_KEYS = ["lastStateHash", "lastSyncedSignature", "linkHolderUserId", "autoSync", "extraConditions"];
const stripPrefix = (slug) => String(slug ?? "").replace(/^\d+-/u, "");

export class RebreyaCharacterSync {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  get #site() {
    return this.moduleApi?.site ?? game.rebreyaMain?.site ?? null;
  }

  get #baseUrl() {
    return this.#site?.api?.baseUrl ?? "https://rebreya.com";
  }

  /** Authenticated list of the user's site characters. */
  async listCharacters() {
    const site = this.#site;
    if (!site) throw new Error("Site integration service is not available.");
    if (!site.isAuthenticated()) throw new Error("Требуется авторизация на сайте rebreya.com.");
    const payload = await site.api.listCharacters();
    return Array.isArray(payload) ? payload : payload?.results ?? [];
  }

  getLink(actor) {
    return actor?.getFlag?.(MODULE_ID, "siteCharacter") ?? null;
  }

  /** This browser's link token for the Actor (share-code link), or null. */
  getLinkToken(actor) {
    return actor?.id ? this.#site?.getLinkToken?.(actor.id)?.token ?? null : null;
  }

  /** Can this client talk to the site for this Actor (link token or login)? */
  canSync(actor) {
    return Boolean(this.getLinkToken(actor) || this.#site?.isAuthenticated?.());
  }

  /**
   * Run a site call with the Actor's link token; a revoked token is dropped
   * from this browser so the UI asks for a new code.
   */
  async #withLinkToken(actor, fn) {
    const token = this.getLinkToken(actor);
    try {
      return await fn(token);
    } catch (error) {
      if (error instanceof LinkRevoked || error?.name === "LinkRevoked") {
        await this.#site?.clearLinkToken?.(actor.id);
      }
      throw error;
    }
  }

  /**
   * Latest build for an already-linked Actor: link token first (no password),
   * else the logged-in account's character list.
   */
  async fetchLinkedCharacter(actor) {
    if (this.getLinkToken(actor)) {
      return this.#withLinkToken(actor, (token) => this.#site.api.getLinkedCharacter(token));
    }
    const link = this.getLink(actor);
    if (!link?.id) throw new Error("Actor не связан с персонажем сайта.");
    const list = await this.listCharacters();
    const character = list.find((c) => String(c.id) === String(link.id)) ?? null;
    if (!character) throw new Error("Связанный персонаж не найден на сайте.");
    return character;
  }

  /** Re-import the build of an already-linked Actor. */
  async refreshBuild(actor, opts = {}) {
    const character = await this.fetchLinkedCharacter(actor);
    const viaToken = Boolean(this.getLinkToken(actor));
    const result = await this.importBuild(actor, character, { ...opts, syncMode: viaToken ? "link-token" : "manual-state-push" });
    if (viaToken) {
      // The site is the truth right after a re-import: take its in-play state
      // and make it the sync baseline (no false conflict on the next poll).
      try {
        await this.applySiteState(actor);
      } catch (error) {
        result.warnings.push(`Не удалось подтянуть состояние с сайта: ${error.message}`);
      }
    }
    return { character, ...result };
  }

  async #getRemoteState(actor, link) {
    if (this.getLinkToken(actor)) return this.#withLinkToken(actor, (token) => this.#site.api.getLinkedState(token));
    return this.#site.api.getCharacterState(link.id);
  }

  async #patchRemoteState(actor, link, patch) {
    if (this.getLinkToken(actor)) return this.#withLinkToken(actor, (token) => this.#site.api.patchLinkedState(token, patch));
    return this.#site.api.patchCharacterState(link.id, patch);
  }

  /**
   * Another Actor in this world already linked to the same site character id
   * (ТЗ §9.3 trigger: site character linked to a different Actor). Returns the
   * conflicting Actor or null.
   */
  findActorLinkedTo(siteId, exceptActorId = null) {
    if (siteId == null) return null;
    const target = Number(siteId);
    for (const actor of game.actors ?? []) {
      if (exceptActorId && actor.id === exceptActorId) continue;
      const link = actor.getFlag?.(MODULE_ID, "siteCharacter");
      if (link?.id != null && Number(link.id) === target) return actor;
    }
    return null;
  }

  async linkActor(actor, character, { syncMode = "manual-state-push" } = {}) {
    const flags = buildSiteCharacterFlags(character, {
      moduleId: MODULE_ID,
      baseUrl: this.#baseUrl,
      syncMode,
      ownerUserId: game.user?.id ?? "",
    });
    await actor.update({ flags });
    return this.getLink(actor);
  }

  async unlinkActor(actor) {
    await actor.unsetFlag(MODULE_ID, "siteCharacter");
  }

  /**
   * Import a site character's build into an Actor: scalar fields + linkage
   * flags + class/subclass/race/background Items (with their granted features)
   * + embedded site spells. Re-import replaces only what a previous import
   * created; user-added items are untouched.
   * @returns {Promise<{actorId:string, spellsAdded:number, itemsCreated:number, classes:string[], warnings:string[]}>}
   */
  async importBuild(actor, character, { overrideAc = false, embedSpells = true, importItems = true, syncMode = "manual-state-push", ownerUserId = null } = {}) {
    if (!actor) throw new Error("Не передан Actor для импорта.");
    const warnings = [];

    const update = buildCharacterActorUpdate(character, { overrideAc, baseUrl: this.#baseUrl });
    const previous = this.getLink(actor);
    update.flags = buildSiteCharacterFlags(character, {
      moduleId: MODULE_ID,
      baseUrl: this.#baseUrl,
      syncMode,
      ownerUserId: ownerUserId ?? previous?.ownerUserId ?? game.user?.id ?? "",
    });
    // Re-import of the same site character keeps the sync bookkeeping.
    if (previous && String(previous.id) === String(character?.id ?? "")) {
      const kept = {};
      for (const key of PRESERVED_LINK_KEYS) if (previous[key] !== undefined) kept[key] = previous[key];
      Object.assign(update.flags[MODULE_ID].siteCharacter, kept);
    }
    await actor.update(update);

    // Classes before spells: dnd5e assigns a spell's sourceClass on creation.
    let itemsCreated = 0;
    let classes = [];
    if (importItems) {
      try {
        const importer = new SiteBuildImporter({ api: this.#site?.api ?? null, baseUrl: this.#baseUrl });
        const res = await importer.import(actor, character);
        itemsCreated = res.created;
        classes = res.classes;
        warnings.push(...res.warnings);
      } catch (error) {
        console.error(`${MODULE_ID} | Site build item import failed.`, error);
        warnings.push(`Не удалось перенести класс/расу/предысторию: ${error.message}`);
      }
    }

    // Available slots = max (now derived from the class Items) − spent on the site.
    try {
      const slots = buildSlotValueUpdate(actor.system?.spells ?? {}, character?.data?.usedSlots, { fillMissing: true });
      if (Object.keys(slots).length) await actor.update({ system: { spells: slots } });
    } catch (error) {
      warnings.push(`Не удалось выставить ячейки заклинаний: ${error.message}`);
    }

    let spellsAdded = 0;
    if (embedSpells) {
      try {
        spellsAdded = await this.#embedSpells(actor, character);
      } catch (error) {
        warnings.push(`Не удалось перенести заклинания: ${error.message}`);
      }
    }
    return { actorId: actor.id, spellsAdded, itemsCreated, classes, warnings };
  }

  /**
   * Push the Actor's mutable in-session state to the linked site character
   * (ТЗ §5.2, §9.2). Requires the Actor to be linked and the user authed.
   *
   * Conflict-safe (ТЗ §9.3): unless `force`, it first reads the site's current
   * state and, if that state moved ahead of what this Actor last acknowledged,
   * returns `{ok:false, conflict:true, remote}` WITHOUT overwriting — the caller
   * resolves via a dialog (force-push / accept-site / cancel).
   * @param {object} actor
   * @param {{force?:boolean}} [options]
   * @returns {Promise<{ok:boolean, conflict:boolean, stateHash?:string, remote?:object, remoteHash?:string}>}
   */
  /** Class Items of the Actor (for hit dice). */
  #classItems(actor) {
    return (actor?.items ?? []).filter?.((i) => i.type === "class") ?? [];
  }

  /**
   * The Actor's in-play state as the site PATCH body. `extraConditions` are
   * site conditions with no dnd5e status (kept so a push does not drop them).
   */
  localStatePatch(actor, { previousHash = "", extraConditions = undefined } = {}) {
    const link = this.getLink(actor) ?? {};
    const statuses = actor?.statuses ? [...actor.statuses] : [];
    const extras = extraConditions ?? link.extraConditions;
    return buildStatePatch(actor?.system ?? {}, {
      statuses,
      extraConditions: Array.isArray(extras) ? extras : [],
      usedHitDice: sumSpentHitDice(this.#classItems(actor)),
      moduleId: MODULE_ID,
      moduleVersion: globalThis.game?.modules?.get?.(MODULE_ID)?.version ?? "",
      actorUuid: actor?.uuid ?? "",
      previousHash,
    });
  }

  /** Fingerprint of the Actor's current synced state. */
  localSignature(actor) {
    return stateSignature(this.localStatePatch(actor));
  }

  /** Changed in Foundry since the last push/pull (unknown baseline counts as changed). */
  isLocallyDirty(actor) {
    const last = this.getLink(actor)?.lastSyncedSignature ?? "";
    return !last || last !== this.localSignature(actor);
  }

  /** Read the site's state (link token, else logged-in account). */
  async fetchRemoteState(actor) {
    return this.#getRemoteState(actor, this.getLink(actor));
  }

  async #acknowledge(actor, stateHash, extra = {}) {
    const link = this.getLink(actor);
    if (!link) return;
    const updatedLink = {
      ...link,
      ...extra,
      lastSyncAt: new Date().toISOString(),
      lastStateHash: stateHash,
      lastSyncHash: stateHash,
    };
    // Signature of the state as it will read once this flag is written
    // (extraConditions included) — otherwise the next check sees a false change.
    updatedLink.lastSyncedSignature = stateSignature(this.localStatePatch(actor, { extraConditions: updatedLink.extraConditions ?? [] }));
    await actor.update({ [`flags.${MODULE_ID}.siteCharacter`]: updatedLink }, { rebreyaSiteSync: true });
  }

  async pushState(actor, { force = false, remote: knownRemote = undefined } = {}) {
    if (!actor) throw new Error("Не передан Actor.");
    if (!this.canSync(actor)) throw new Error("Нет связи с сайтом: свяжите персонажа по коду с rebreya.com или войдите.");
    const link = this.getLink(actor);
    if (!link?.id && !this.getLinkToken(actor)) throw new Error("Actor не связан с персонажем сайта.");

    if (!force) {
      let remote = knownRemote ?? null;
      if (knownRemote === undefined) {
        try {
          remote = await this.#getRemoteState(actor, link);
        } catch (error) {
          if (error instanceof LinkRevoked) throw error;
          remote = null; // no state yet / transient — treat as no conflict
        }
      }
      const remoteHash = remote?.stateHash ?? "";
      if (detectStateConflict(remoteHash, link.lastStateHash ?? "")) {
        return { ok: false, conflict: true, remote, remoteHash };
      }
    }

    const patch = this.localStatePatch(actor, { previousHash: link.lastStateHash ?? "" });
    const result = await this.#patchRemoteState(actor, link, patch);
    const newHash = result?.stateHash ?? "";
    // Acknowledge the pushed state so the next push is conflict-free.
    await this.#acknowledge(actor, newHash);
    return { ok: true, conflict: false, stateHash: newHash };
  }

  /**
   * «Принять сайт» (ТЗ §9.3) and auto-pull: bring the site's in-play state into
   * the Actor — hp, death saves, inspiration, exhaustion, currency, spent spell
   * slots, spent hit dice and conditions (mapped statuses are added AND
   * removed; site-only conditions are remembered so pushes keep them) — then
   * acknowledge that state hash so a subsequent push is conflict-free.
   * @returns {Promise<{ok:boolean, warnings:string[]}>}
   */
  async applySiteState(actor, remoteState = null) {
    if (!actor) throw new Error("Не передан Actor.");
    const link = this.getLink(actor);
    let state = remoteState;
    if (!state) {
      if (!link?.id && !this.getLinkToken(actor)) throw new Error("Actor не связан с персонажем сайта.");
      state = await this.#getRemoteState(actor, link);
    }
    if (!state) throw new Error("Не удалось получить состояние с сайта.");
    const opts = { rebreyaSiteSync: true };

    const update = buildActorStateUpdate(state);
    // Spell slots: state.usedSlots is spent-count per level; value = max − used.
    const slots = buildSlotValueUpdate(actor.system?.spells ?? {}, state.usedSlots);
    if (Object.keys(slots).length) {
      update.system = update.system ?? {};
      update.system.spells = slots;
    }
    await actor.update(update, opts);

    // Hit dice: one site number → per-class hd.spent, largest die first.
    const warnings = [];
    if (state.usedHitDice != null && typeof state.usedHitDice !== "object") {
      const hdUpdates = distributeSpentHitDice(this.#classItems(actor).map((c) => ({ _id: c.id, system: c.system })), state.usedHitDice);
      if (hdUpdates.length) await actor.updateEmbeddedDocuments("Item", hdUpdates, opts);
    }

    // Conditions: mapped statuses follow the site; unknown ones are only added.
    // A site condition Foundry has no status effect for is remembered on the
    // link so the next push sends it back instead of dropping it.
    let extraConditions = [];
    if (Array.isArray(state.conditions)) {
      const statusIds = new Set((globalThis.CONFIG?.statusEffects ?? []).map((e) => e?.id).filter(Boolean));
      const exists = (id) => !statusIds.size || statusIds.has(id);
      extraConditions = fromSiteConditions(state.conditions).filter((id) => !exists(id));
      const { add, remove } = diffStatuses(actor.statuses ? [...actor.statuses] : [], state.conditions);
      for (const id of remove) {
        try { await actor.toggleStatusEffect(id, { active: false }); } catch (_error) { warnings.push(`Не удалось снять состояние «${id}».`); }
      }
      for (const id of add.filter(exists)) {
        try { await actor.toggleStatusEffect(id, { active: true }); } catch (_error) { warnings.push(`Не удалось применить состояние «${id}».`); }
      }
    }

    await this.#acknowledge(actor, state.stateHash ?? "", { extraConditions });
    return { ok: true, warnings };
  }

  async #embedSpells(actor, character) {
    const refs = Array.isArray(character?.data?.spells) ? character.data.spells : [];
    if (!refs.length) return 0;

    const pack = game.packs.get(SPELLS_PACK_ID);
    if (!pack) throw new Error("Компендий заклинаний rebreya.com не создан — сначала синхронизируйте заклинания.");

    // Index carries the site identity flags so we can match by id or slug.
    const index = await pack.getIndex({ fields: ["flags"] });
    const byId = new Map();
    const bySlug = new Map();
    for (const entry of index) {
      const site = entry.flags?.[MODULE_ID]?.site;
      if (!site) continue;
      if (site.id != null) byId.set(Number(site.id), entry._id);
      if (site.slug) bySlug.set(stripPrefix(site.slug), entry._id);
    }

    // Resolve each requested spell (accepts a raw slug/id or an object).
    const wantedPackIds = [];
    for (const ref of refs) {
      const id = typeof ref === "object" ? ref?.id : /^\d+$/u.test(String(ref)) ? Number(ref) : null;
      const slug = typeof ref === "object" ? ref?.slug : typeof ref === "string" ? ref : null;
      const packDocId = (id != null && byId.get(Number(id))) || (slug && bySlug.get(stripPrefix(slug)));
      if (packDocId) wantedPackIds.push(packDocId);
    }
    if (!wantedPackIds.length) return 0;

    // Remove previously site-embedded spells so re-import is idempotent.
    const stale = actor.items
      .filter((i) => i.type === "spell" && i.getFlag(MODULE_ID, "site")?.entity === "spells")
      .map((i) => i.id);
    if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);

    const docs = [];
    for (const packDocId of wantedPackIds) {
      const doc = await pack.getDocument(packDocId);
      if (doc) {
        const data = doc.toObject();
        delete data._id;
        // The site list is the spells the character uses — mark leveled ones
        // prepared (dnd5e defaults PC spells to unprepared on creation).
        if (Number(data.system?.level) > 0) foundry.utils.setProperty(data, "system.prepared", 1);
        docs.push(data);
      }
    }
    if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
    return docs.length;
  }
}
