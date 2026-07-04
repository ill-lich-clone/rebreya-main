/**
 * Managed world compendium «Статьи D&D 5e (rebreya.com)» (integration ТЗ §7.10).
 *
 * JournalEntry per site article, foldered by subsection. Same per-document
 * hash-based sync discipline as the spells pack: create missing, update only
 * when the site's content_hash changed, remove managed docs that vanished,
 * never touch user documents.
 */
import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { ensureCompendiumFolders, ensurePackSidebarFolder } from "./compendium-utils.js";
import { articleFolderPath, buildArticleJournalData } from "./site-article-mapper.js";
import { SiteApiCatalogProvider } from "./catalog-providers/site-api-catalog-provider.js";

export const SITE_ARTICLES_COMPENDIUM_NAME = "rebreya-site-articles";
export const SITE_ARTICLES_COMPENDIUM_LABEL = "Статьи D&D 5e (rebreya.com)";
const PACK_ID = `world.${SITE_ARTICLES_COMPENDIUM_NAME}`;
const COMPENDIUM_SIDEBAR_FOLDER = ["Ребрея"];
const RESOURCE = "articles";

function getDesiredPackMetadata() {
  return {
    label: SITE_ARTICLES_COMPENDIUM_LABEL,
    type: "JournalEntry",
    name: SITE_ARTICLES_COMPENDIUM_NAME,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
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
  if (!pack) {
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium(desired);
  }
  try {
    await ensurePackSidebarFolder(pack, COMPENDIUM_SIDEBAR_FOLDER);
  } catch (error) {
    console.warn(`${MODULE_ID} | Failed to assign site articles compendium to the sidebar folder.`, error);
  }
  return pack;
}

function siteFlag(document) {
  return document?.getFlag?.(MODULE_ID, "site") ?? null;
}

export class SiteArticlesCompendiumService {
  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  get #siteService() {
    return this.moduleApi?.site ?? game.rebreyaMain?.site ?? null;
  }

  async sync({ notify = true } = {}) {
    if (!game.user?.isGM) return null;
    const site = this.#siteService;
    if (!site) throw new Error("Site integration service is not available.");

    const provider = new SiteApiCatalogProvider(site.api);
    const baseUrl = site.api.baseUrl;
    const [records, subsections] = await Promise.all([
      provider.list(RESOURCE),
      provider.list("subsections"),
    ]);
    const subsectionNameById = new Map(
      subsections.map((s) => [String(s.id), String(s.name ?? "").trim()])
    );

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
        [...new Set(records.map((r) => articleFolderPath(r, subsectionNameById)))]
      );
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to prepare folders for the site articles pack.`, error);
    }

    const toCreate = [];
    const toUpdate = [];
    let unchanged = 0;
    const seenIds = new Set();

    for (const record of records) {
      if (record?.id == null) continue;
      seenIds.add(Number(record.id));
      const data = buildArticleJournalData(record, { moduleId: MODULE_ID, baseUrl });
      data.folder = folderIdByPath.get(articleFolderPath(record, subsectionNameById)) ?? null;

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
      // Replace pages wholesale on update: build fresh page list.
      toUpdate.push({ _id: existing.id, ...data });
    }

    const staleIds = [...managedById.entries()]
      .filter(([id]) => !seenIds.has(id))
      .map(([, doc]) => doc.id);

    if (toCreate.length) {
      await JournalEntry.implementation.createDocuments(toCreate, { pack: pack.collection });
    }
    if (toUpdate.length) {
      await JournalEntry.implementation.updateDocuments(toUpdate, { pack: pack.collection, recursive: false });
    }
    if (staleIds.length) {
      await JournalEntry.implementation.deleteDocuments(staleIds, { pack: pack.collection });
    }

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
    console.info(`${MODULE_ID} | Site articles sync:`, stats);
    if (notify) {
      ui.notifications?.info(
        `Статьи rebreya.com: создано ${stats.created}, обновлено ${stats.updated}, без изменений ${stats.unchanged}.`
      );
    }
    return stats;
  }
}
