import {
  MODULE_ID,
  TRANSPORT_COMPENDIUM_ID,
  TRANSPORT_COMPENDIUM_LABEL,
  TRANSPORT_COMPENDIUM_NAME
} from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  buildTransportActorData,
  normalizeTransportEntry
} from "./transport-actor-builder.js";
import { syncFlaggedManagedDocuments } from "./managed-compendium-sync.js";

const EXPECTED_CATALOG_SIZE = 62;

export async function loadTransportCatalog({
  fetcher = globalThis.fetch,
  path = `modules/${MODULE_ID}/data/rebreya-transport-v01.json`
} = {}) {
  if (typeof fetcher !== "function") {
    throw new TypeError("Transport catalog fetcher is required");
  }
  const response = await fetcher(path);
  if (!response?.ok) {
    throw new Error(`Transport catalog request failed: ${response?.status ?? "unknown"}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== EXPECTED_CATALOG_SIZE) {
    throw new Error(`Transport catalog must contain exactly ${EXPECTED_CATALOG_SIZE} rows`);
  }
  return rows;
}

export class TransportCompendiumService {
  constructor(options = {}) {
    this.options = options;
    this.catalogProvider = options.catalogProvider ?? (() => loadTransportCatalog(options));
  }

  async sync(entries = null) {
    const game = this.options.gameProvider?.() ?? globalThis.game;
    const active = this.options.isActiveGmClient?.(game) ?? isActiveGmClient(game);
    if (!active || game?.system?.id !== "dnd5e") {
      return { skipped: true, pack: null, result: null };
    }

    const rows = entries ?? await this.catalogProvider();
    if (!Array.isArray(rows) || rows.length !== EXPECTED_CATALOG_SIZE) {
      throw new Error(`Transport catalog must contain exactly ${EXPECTED_CATALOG_SIZE} rows`);
    }
    const normalized = rows.map((entry, index) => normalizeTransportEntry(entry, index));
    const pack = await this.#ensurePack(game);
    const documents = await pack.getDocuments();
    const result = await syncFlaggedManagedDocuments({
      pack,
      entries: normalized.map((entry) => ({
        ...entry,
        signature: buildTransportActorData(entry).flags[MODULE_ID].signature
      })),
      documents,
      moduleId: MODULE_ID,
      sourceIdFlag: "sourceId",
      documentIdOfEntry: (entry) => entry.documentId,
      buildData: (entry) => buildTransportActorData(entry)
    });
    return { skipped: false, pack, result };
  }

  async #ensurePack(game) {
    let pack = game?.packs?.get?.(TRANSPORT_COMPENDIUM_ID) ?? null;
    if (pack && (pack.documentName !== "Actor" || pack.metadata?.system !== "dnd5e")) {
      await pack.deleteCompendium?.();
      pack = null;
    }
    if (pack) return pack;

    const metadata = {
      name: TRANSPORT_COMPENDIUM_NAME,
      label: TRANSPORT_COMPENDIUM_LABEL,
      type: "Actor",
      system: "dnd5e",
      package: "world"
    };
    if (typeof this.options.createCompendium === "function") {
      return this.options.createCompendium(metadata);
    }

    const CompendiumCollection = globalThis.foundry?.documents?.collections?.CompendiumCollection;
    if (typeof CompendiumCollection?.createCompendium !== "function") {
      throw new TypeError("CompendiumCollection.createCompendium is required");
    }
    return CompendiumCollection.createCompendium(metadata);
  }
}
