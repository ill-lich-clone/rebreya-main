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
} from "../data/site-character-mapper.js";
import { SITE_SPELLS_COMPENDIUM_NAME } from "../data/site-spells-compendium.js";

const SPELLS_PACK_ID = `world.${SITE_SPELLS_COMPENDIUM_NAME}`;
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
   * flags + embedded site spells. Re-import replaces previously site-embedded
   * spells so it stays clean; user-added items are untouched.
   * @returns {Promise<{actorId:string, spellsAdded:number, warnings:string[]}>}
   */
  async importBuild(actor, character, { overrideAc = false, embedSpells = true } = {}) {
    if (!actor) throw new Error("Не передан Actor для импорта.");
    const warnings = [];

    const update = buildCharacterActorUpdate(character, { overrideAc, baseUrl: this.#baseUrl });
    update.flags = buildSiteCharacterFlags(character, {
      moduleId: MODULE_ID,
      baseUrl: this.#baseUrl,
      syncMode: "manual-state-push",
      ownerUserId: game.user?.id ?? "",
    });
    await actor.update(update);

    let spellsAdded = 0;
    if (embedSpells) {
      try {
        spellsAdded = await this.#embedSpells(actor, character);
      } catch (error) {
        warnings.push(`Не удалось перенести заклинания: ${error.message}`);
      }
    }
    return { actorId: actor.id, spellsAdded, warnings };
  }

  /**
   * Push the Actor's mutable in-session state to the linked site character
   * (ТЗ §5.2, §9.2). Requires the Actor to be linked and the user authed.
   * @returns {Promise<{ok:boolean, stateHash:string|null}>}
   */
  async pushState(actor) {
    if (!actor) throw new Error("Не передан Actor.");
    const site = this.#site;
    if (!site?.isAuthenticated?.()) throw new Error("Требуется авторизация на сайте rebreya.com.");
    const link = this.getLink(actor);
    if (!link?.id) throw new Error("Actor не связан с персонажем сайта.");

    const statuses = actor.statuses ? [...actor.statuses] : [];
    const patch = buildStatePatch(actor.system ?? {}, {
      statuses,
      moduleId: MODULE_ID,
      moduleVersion: game.modules?.get?.(MODULE_ID)?.version ?? "",
      actorUuid: actor.uuid,
      previousHash: link.lastSyncHash ?? "",
    });

    const result = await site.api.patchCharacterState(link.id, patch);
    const newHash = result?.stateHash ?? "";
    // Update linkage provenance with the acknowledged state hash + time.
    const updatedLink = { ...link, lastSyncAt: new Date().toISOString(), lastSyncHash: newHash };
    await actor.update({ [`flags.${MODULE_ID}.siteCharacter`]: updatedLink });
    return { ok: true, stateHash: newHash };
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
        docs.push(data);
      }
    }
    if (docs.length) await actor.createEmbeddedDocuments("Item", docs);
    return docs.length;
  }
}
