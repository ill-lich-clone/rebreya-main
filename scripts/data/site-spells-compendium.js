/**
 * Managed world compendium «Заклинания D&D 5e (rebreya.com)».
 *
 * First vertical slice of the site catalogue sync (integration ТЗ Этап 2):
 * the module has no local spells data, so this pack is pure site content and
 * cannot conflict with local Rebreya reworks. Sync is per-document and
 * hash-based: a record is created when missing, updated only when the site's
 * `content_hash` changed, and managed documents that vanished from the site
 * are removed. User-created documents are never touched (ТЗ §7.1).
 */
import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { ensureCompendiumFolders, ensurePackSidebarFolder } from "./compendium-utils.js";
import { buildSpellItemData, folderPathForLevel } from "./site-spell-mapper.js";
import { SiteApiCatalogProvider } from "./catalog-providers/site-api-catalog-provider.js";

export const SITE_SPELLS_COMPENDIUM_NAME = "rebreya-site-spells";
export const SITE_SPELLS_COMPENDIUM_LABEL = "Заклинания D&D 5e (rebreya.com)";
const PACK_ID = `world.${SITE_SPELLS_COMPENDIUM_NAME}`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const RESOURCE = "spells";

function getDesiredPackMetadata() {
  return {
    label: SITE_SPELLS_COMPENDIUM_LABEL,
    type: "Item",
    name: SITE_SPELLS_COMPENDIUM_NAME,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    },
    flags: {
      dnd5e: {
        sourceBook: "rebreya.com",
        types: ["spell"]
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
    console.warn(`${MODULE_ID} | Failed to assign site spells compendium to the sidebar folder.`, error);
  }
  return pack;
}

function siteFlag(document) {
  return document?.getFlag?.(MODULE_ID, "site") ?? null;
}

export class SiteSpellsCompendiumService {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  get #siteService() {
    return this.moduleApi?.site ?? game.rebreyaMain?.site ?? null;
  }

  /**
   * Synchronise the pack with the site catalogue.
   * @returns {Promise<{created:number,updated:number,unchanged:number,removed:number,total:number}|null>}
   */
  async sync({ notify = true } = {}) {
    if (!game.user?.isGM || game.system?.id !== "dnd5e") return null;
    const site = this.#siteService;
    if (!site) throw new Error("Site integration service is not available.");

    const provider = new SiteApiCatalogProvider(site.api);
    const baseUrl = site.api.baseUrl;
    const records = await provider.list(RESOURCE);

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
        [...new Set(records.map((r) => folderPathForLevel(r.level)))]
      );
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to prepare folders for the site spells pack.`, error);
    }

    const toCreate = [];
    const toUpdate = [];
    let unchanged = 0;
    const seenIds = new Set();

    for (const record of records) {
      if (record?.id == null) continue;
      seenIds.add(Number(record.id));
      const data = buildSpellItemData(record, { moduleId: MODULE_ID, baseUrl });
      data.folder = folderIdByPath.get(folderPathForLevel(record.level)) ?? null;

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
      toUpdate.push({ _id: existing.id, ...data });
    }

    // Managed docs whose site record disappeared → remove (user docs untouched).
    const staleIds = [...managedById.entries()]
      .filter(([id]) => !seenIds.has(id))
      .map(([, doc]) => doc.id);

    if (toCreate.length) {
      await Item.implementation.createDocuments(toCreate, { pack: pack.collection });
    }
    if (toUpdate.length) {
      await Item.implementation.updateDocuments(toUpdate, { pack: pack.collection });
    }
    if (staleIds.length) {
      await Item.implementation.deleteDocuments(staleIds, { pack: pack.collection });
    }

    // Remember the sync moment for diagnostics / future incremental runs.
    try {
      const state = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC) ?? {});
      state[RESOURCE] = { at: new Date().toISOString(), total: records.length };
      await game.settings.set(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC, state);
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to store site catalog sync state.`, error);
    }

    const stats = {
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged,
      removed: staleIds.length,
      total: records.length
    };
    console.info(`${MODULE_ID} | Site spells sync:`, stats);
    if (notify) {
      ui.notifications?.info(
        `Заклинания rebreya.com: создано ${stats.created}, обновлено ${stats.updated}, без изменений ${stats.unchanged}.`
      );
    }
    return stats;
  }
}
