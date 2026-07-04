/**
 * Managed world compendium «Бестиарий D&D 5e (rebreya.com)».
 *
 * Integration ТЗ Этап 6: the site bestiary (~3300 creatures) → dnd5e NPC
 * Actors. Pure site content (no local Rebreya reworks), so it cannot conflict
 * with reworked packs. Sync is per-document and hash-based: a creature is
 * created when missing, fully rebuilt (delete + recreate, so its embedded
 * trait/action items refresh too) only when the site's `content_hash` changed,
 * and managed Actors whose site record vanished are removed. User-created
 * Actors are never touched (ТЗ §7.1).
 *
 * Ability scores live ONLY inside the stat-block markdown, which the list view
 * drops by default — so the sweep requests `?include=details` to pull it back.
 */
import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { ensureCompendiumFolders, ensurePackSidebarFolder } from "./compendium-utils.js";
import { buildNpcActorData, folderPathForType } from "./site-monster-mapper.js";
import { SiteApiCatalogProvider } from "./catalog-providers/site-api-catalog-provider.js";

export const SITE_BESTIARY_COMPENDIUM_NAME = "rebreya-site-bestiary";
export const SITE_BESTIARY_COMPENDIUM_LABEL = "Бестиарий D&D 5e (rebreya.com)";
const PACK_ID = `world.${SITE_BESTIARY_COMPENDIUM_NAME}`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const RESOURCE = "bestiary";
const CREATE_CHUNK = 100; // creatures carry embedded items — create in batches.

function getDesiredPackMetadata() {
  return {
    label: SITE_BESTIARY_COMPENDIUM_LABEL,
    type: "Actor",
    name: SITE_BESTIARY_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "rebreya.com",
        types: ["npc"]
      }
    }
  };
}

async function ensurePack() {
  const desired = getDesiredPackMetadata();
  let pack = game.packs.get(PACK_ID);

  if (pack && pack.documentName !== desired.type) {
    if (typeof pack.deleteCompendium === "function") await pack.deleteCompendium();
    pack = null;
  }
  if (pack && desired.system && pack.metadata.system !== desired.system) {
    if (typeof pack.deleteCompendium === "function") await pack.deleteCompendium();
    pack = null;
  }
  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }

  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign site bestiary compendium to the sidebar folder.`, error);
  }
  return pack;
}

function siteFlag(document) {
  return document?.getFlag?.(MODULE_ID, "site") ?? null;
}

async function chunkedCreate(pack, data) {
  for (let i = 0; i < data.length; i += CREATE_CHUNK) {
    await Actor.implementation.createDocuments(data.slice(i, i + CREATE_CHUNK), { pack: pack.collection, keepId: false });
  }
}

export class SiteBestiaryCompendiumService {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  get #siteService() {
    return this.moduleApi?.site ?? game.rebreyaMain?.site ?? null;
  }

  /**
   * Synchronise the pack with the site bestiary.
   * @param {{notify?:boolean, limit?:number}} [options] `limit` runs a bounded
   *   preview import (no stale-deletion) — used to smoke-test without pulling
   *   all ~3300 creatures.
   * @returns {Promise<{created:number,updated:number,unchanged:number,removed:number,total:number}|null>}
   */
  async sync({ notify = true, limit = Infinity } = {}) {
    if (!game.user?.isGM || game.system?.id !== "dnd5e") return null;
    const site = this.#siteService;
    if (!site) throw new Error("Site integration service is not available.");
    const preview = Number.isFinite(limit);

    const provider = new SiteApiCatalogProvider(site.api);
    const baseUrl = site.api.baseUrl;
    let records = await provider.list(RESOURCE, { params: { include: "details" } });
    if (preview) records = records.slice(0, Math.max(0, limit));

    // Ability scores / traits / actions live only inside the `details`
    // markdown, which the list view returns only for `?include=details`.
    // Refuse to import empty stat blocks against a site that predates that
    // support — better a clear message than 3300 blank NPCs.
    if (records.length && !records.some((r) => typeof r?.details === "string" && r.details.trim())) {
      throw new Error(
        "Сайт rebreya.com не отдаёт стат-блоки бестиария (details). Обновите бэкенд сайта (поддержка ?include=details) и повторите."
      );
    }

    const pack = await ensurePack();
    const documents = await pack.getDocuments();
    const managedById = new Map();
    for (const doc of documents) {
      const flag = siteFlag(doc);
      if (doc.getFlag(MODULE_ID, "managed") && flag?.entity === RESOURCE && flag.id != null) {
        managedById.set(Number(flag.id), doc);
      }
    }

    let folderIdByPath = new Map();
    try {
      folderIdByPath = await ensureCompendiumFolders(
        pack,
        [...new Set(records.map((r) => folderPathForType(r)))]
      );
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to prepare folders for the site bestiary pack.`, error);
    }

    const toCreate = [];
    const idsToDelete = [];
    let unchanged = 0;
    let updated = 0;
    const seenIds = new Set();

    for (const record of records) {
      if (record?.id == null) continue;
      seenIds.add(Number(record.id));
      const data = buildNpcActorData(record, { moduleId: MODULE_ID, baseUrl });
      data.folder = folderIdByPath.get(folderPathForType(record)) ?? null;

      const existing = managedById.get(Number(record.id));
      if (!existing) {
        toCreate.push(data);
        continue;
      }
      const currentHash = siteFlag(existing)?.contentHash ?? "";
      if (currentHash && currentHash === data.flags[MODULE_ID].site.contentHash) {
        unchanged += 1;
        continue;
      }
      // Changed → rebuild fully so embedded trait/action items refresh too.
      idsToDelete.push(existing.id);
      toCreate.push(data);
      updated += 1;
    }

    // Managed docs whose site record disappeared → remove (user docs untouched).
    // Skipped in preview mode, where `records` is only a bounded slice.
    if (!preview) {
      for (const [id, doc] of managedById.entries()) {
        if (!seenIds.has(id)) idsToDelete.push(doc.id);
      }
    }

    if (idsToDelete.length) {
      await Actor.implementation.deleteDocuments(idsToDelete, { pack: pack.collection });
    }
    if (toCreate.length) {
      await chunkedCreate(pack, toCreate);
    }

    if (!preview) {
      try {
        const state = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC) ?? {});
        state[RESOURCE] = { at: new Date().toISOString(), total: records.length };
        await game.settings.set(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC, state);
      } catch (error) {
        console.warn(`${MODULE_ID} | Failed to store site catalog sync state.`, error);
      }
    }

    const removed = idsToDelete.length - updated; // deletes beyond the rebuilds
    const stats = {
      created: toCreate.length - updated,
      updated,
      unchanged,
      removed: Math.max(0, removed),
      total: records.length
    };
    console.info(`${MODULE_ID} | Site bestiary sync${preview ? " (preview)" : ""}:`, stats);
    if (notify) {
      ui.notifications?.info(
        `Бестиарий rebreya.com: создано ${stats.created}, обновлено ${stats.updated}, без изменений ${stats.unchanged}.`
      );
    }
    return stats;
  }
}
