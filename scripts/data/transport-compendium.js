import {
  MODULE_ID,
  TRANSPORT_COMPENDIUM_ID,
  TRANSPORT_COMPENDIUM_LABEL,
  TRANSPORT_COMPENDIUM_NAME
} from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  buildTransportActorData,
  normalizeTransportEntry,
  resolveTransportDefaultArtwork
} from "./transport-actor-builder.js";
import { buildNamedIconLookup } from "./compendium-utils.js";
import { syncFlaggedManagedDocuments } from "./managed-compendium-sync.js";

const EXPECTED_CATALOG_SIZE = 62;
const TRANSPORT_ICON_SEARCH_PATHS = [
  `modules/${MODULE_ID}/templates/icons/Transport`,
  `modules/${MODULE_ID}/templates/icons`
];

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isMissingLegacyValue(value) {
  return value == null
    || String(value).trim() === ""
    || String(value).trim() === "[object Object]";
}

function isLegacyBrokenSpeed(record, primaryKey) {
  return isMissingLegacyValue(record?.[primaryKey])
    || String(record?.raw ?? "").trim() === "[object Object]";
}

function shouldRepairNativeSpeed(value, flagRecord, primaryKey) {
  if (isMissingLegacyValue(value)) return true;
  return Number(value) === 0 && isLegacyBrokenSpeed(flagRecord, primaryKey);
}

function patchMissingNestedValues(patch, path, current, source, keys) {
  for (const key of keys) {
    if (isMissingLegacyValue(current?.[key]) && !isMissingLegacyValue(source?.[key])) {
      patch[`${path}.${key}`] = structuredClone(source[key]);
    }
  }
}

function firstPositiveEntry(record = {}, keys = []) {
  for (const key of keys) {
    const value = positiveNumber(record?.[key]);
    if (value != null) return [key, value];
  }
  return null;
}

export async function repairTransportInstanceSpeeds(actors, actorDataBySourceId) {
  const sources = actorDataBySourceId instanceof Map ? actorDataBySourceId : new Map();
  let inspected = 0;
  let updated = 0;
  for (const actor of collectionValues(actors)) {
    const moduleFlags = actor?.flags?.[MODULE_ID] ?? {};
    const transport = moduleFlags.transport ?? {};
    const sourceId = String(transport.sourceId ?? moduleFlags.sourceId ?? "").trim();
    if (actor?.type !== "vehicle" || transport.instance !== true || !sourceId) continue;
    const sourceData = sources.get(sourceId);
    if (!sourceData) continue;
    inspected += 1;

    const patch = {};
    const sourceArtwork = String(sourceData.img ?? "").trim();
    const stockArtwork = resolveTransportDefaultArtwork(
      sourceData.flags?.[MODULE_ID]?.transport?.sourceType
    );
    const currentArtwork = String(actor.img ?? "").trim();
    if (sourceArtwork && sourceArtwork !== stockArtwork && (!currentArtwork || currentArtwork === stockArtwork)) {
      patch.img = sourceArtwork;
    }
    const sourceMovement = firstPositiveEntry(
      sourceData.system?.attributes?.movement,
      ["walk", "swim", "fly", "climb", "burrow"]
    );
    if (sourceMovement) {
      const [mode, value] = sourceMovement;
      if (shouldRepairNativeSpeed(
        actor.system?.attributes?.movement?.[mode],
        transport.combatSpeed,
        "primaryFt"
      )) {
        patch[`system.attributes.movement.${mode}`] = value;
      }
      patchMissingNestedValues(
        patch,
        `flags.${MODULE_ID}.transport.combatSpeed`,
        transport.combatSpeed,
        sourceData.flags?.[MODULE_ID]?.transport?.combatSpeed,
        ["primaryFt", "secondaryFt", "raw"]
      );
    }

    const sourceTravel = firstPositiveEntry(
      sourceData.system?.attributes?.travel?.speeds,
      ["land", "water", "air"]
    );
    if (sourceTravel) {
      const [mode, value] = sourceTravel;
      if (shouldRepairNativeSpeed(
        actor.system?.attributes?.travel?.speeds?.[mode],
        transport.travelSpeed,
        "value"
      )) {
        patch[`system.attributes.travel.speeds.${mode}`] = value;
      }
      patchMissingNestedValues(
        patch,
        `flags.${MODULE_ID}.transport.travelSpeed`,
        transport.travelSpeed,
        sourceData.flags?.[MODULE_ID]?.transport?.travelSpeed,
        ["value", "units", "raw"]
      );
    }

    if (Object.keys(patch).length > 0) {
      await actor.update?.(patch);
      updated += 1;
    }
  }
  return { inspected, updated };
}

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
    const iconLookup = await buildNamedIconLookup(TRANSPORT_ICON_SEARCH_PATHS, { forceRefresh: true });
    const prepared = rows.map((entry, index) => ({
      normalized: normalizeTransportEntry(entry, index),
      actorData: buildTransportActorData(entry, iconLookup)
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
    await repairTransportInstanceSpeeds(
      game?.actors,
      new Map(prepared.map(({ normalized: entry, actorData }) => [entry.sourceId, actorData]))
    );
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
