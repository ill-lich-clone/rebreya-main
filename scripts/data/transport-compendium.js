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
    const prepared = rows.map((entry, index) => ({
      normalized: normalizeTransportEntry(entry, index),
      actorData: buildTransportActorData(entry)
    }));
    const normalized = prepared.map(({ normalized: entry }) => entry);
    const pack = await this.#ensurePack(game);
    const documents = await pack.getDocuments();
    const expectedSourceIdByDocumentId = new Map(
      normalized.map((entry) => [entry.documentId, entry.sourceId])
    );
    const identityCollisions = documents.filter((document) => {
      const id = String(document?.id ?? document?._id ?? "").trim();
      const expectedSourceId = expectedSourceIdByDocumentId.get(id);
      if (!expectedSourceId) return false;
      const managed = document?.getFlag?.(MODULE_ID, "managed")
        ?? document?.flags?.[MODULE_ID]?.managed;
      const sourceId = String(
        document?.getFlag?.(MODULE_ID, "sourceId")
        ?? document?.flags?.[MODULE_ID]?.sourceId
        ?? ""
      ).trim();
      return managed !== true || sourceId !== expectedSourceId;
    });
    if (identityCollisions.length > 0) {
      const ids = identityCollisions.map((document) => document?.id ?? document?._id).join(", ");
      const hasUnmanaged = identityCollisions.some((document) => (
        (document?.getFlag?.(MODULE_ID, "managed") ?? document?.flags?.[MODULE_ID]?.managed) !== true
      ));
      const collisionType = hasUnmanaged
        ? "unmanaged document id collision"
        : "managed document identity collision";
      throw new Error(`Transport compendium has a ${collisionType}: ${ids}`);
    }
    const result = await syncFlaggedManagedDocuments({
      pack,
      entries: prepared.map(({ normalized: entry, actorData }) => ({
        ...entry,
        actorData,
        signature: actorData.flags[MODULE_ID].signature
      })),
      documents,
      moduleId: MODULE_ID,
      sourceIdFlag: "sourceId",
      documentIdOfEntry: (entry) => entry.documentId,
      buildData: (entry) => entry.actorData
    });
    return { skipped: false, pack, result };
  }

  async #ensurePack(game) {
    let pack = game?.packs?.get?.(TRANSPORT_COMPENDIUM_ID) ?? null;
    if (pack && (pack.documentName !== "Actor" || pack.metadata?.system !== "dnd5e")) {
      throw new Error(
        `Transport compendium ${TRANSPORT_COMPENDIUM_ID} is incompatible; `
        + "rename or migrate the existing user pack before synchronization"
      );
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
