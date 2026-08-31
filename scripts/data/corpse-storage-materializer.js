import { GEAR_COMPENDIUM_NAME, MODULE_ID } from "../constants.js";
import { resolveRebreyaOrdinaryWeaponGearId } from "./item-classification.js?v=1.4.152-dead-npc-looting";
import { formatDurabilityItemName } from "./durability-item-presentation.js?v=1.4.154-broken-item-name";
import {
  CORPSE_MATERIALIZATION_VERSION,
  isCorpseStorageTarget,
  isDeadNpcStorageTarget
} from "./storage-corpse-target.js?v=1.4.195-storage-corpse-target";

export {
  CORPSE_MATERIALIZATION_VERSION,
  isCorpseStorageTarget,
  isDeadNpcStorageTarget
};

const GEAR_PACK_ID = `world.${GEAR_COMPENDIUM_NAME}`;
const CANONICAL_UUID_PREFIX = `Compendium.${GEAR_PACK_ID}.Item.`;
const SUPPORTED_ITEM_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return cleanId(value).toLowerCase();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPlain(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toObject === "function") return toPlain(value.toObject());
  if (Array.isArray(value)) return value.map(toPlain);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPlain(child)]));
}

function collectionValues(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value.values === "function") return Array.from(value.values());
  return value && typeof value === "object" ? Object.values(value) : [];
}

function resolveTokenDocument(token) {
  return token?.document ?? token ?? null;
}

function actorOf(token) {
  const document = resolveTokenDocument(token);
  return document?.actor ?? token?.actor ?? null;
}

function canonicalFlags(data) {
  const flags = data?.flags?.[MODULE_ID] ?? {};
  const sourceIds = [cleanId(flags.gearId), cleanId(flags.sourceId)].filter(Boolean);
  const gearId = sourceIds[0] ?? "";
  if (flags.managed !== true
    || normalizeToken(flags.sourceType) !== "gear"
    || !gearId
    || sourceIds.some((sourceId) => sourceId !== gearId)) {
    return null;
  }
  return { gearId };
}

function canonicalNativeKey(data) {
  const itemType = normalizeToken(data?.type);
  const type = data?.system?.type ?? {};
  if (itemType === "weapon" || itemType === "equipment") {
    if (itemType === "weapon" && normalizeToken(type.value) === "natural") return "";
    const baseItem = normalizeToken(type.baseItem);
    return baseItem ? `${itemType}:base:${baseItem}` : "";
  }
  if (itemType === "consumable" && normalizeToken(type.value) === "ammo") {
    const subtype = normalizeToken(type.subtype);
    return subtype ? `consumable:ammo:${subtype}` : "";
  }
  return "";
}

function addLookup(map, key, entry) {
  if (!key) return;
  const values = map.get(key) ?? [];
  values.push(entry);
  map.set(key, values);
}

function uniqueLookup(map, key) {
  const values = map.get(key) ?? [];
  return values.length === 1 ? values[0] : null;
}

function readQuantity(item) {
  const raw = item?.system?.quantity;
  if (raw === undefined || raw === null || raw === "") return 1;
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
}

function hasLegacyMonsterEvidence(item) {
  if (cleanId(item?.flags?.srd5e?.hash)) return true;
  const source = cleanId(item?._stats?.compendiumSource);
  return /^(?:Compendium\.[^.]+\.[^.]+\.)?Actor\.[^.]+\.Item\.[^.]+$/u.test(source);
}

function explicitGearId(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  const hasIdentity = Object.hasOwn(flags, "sourceType")
    || Object.hasOwn(flags, "gearId")
    || Object.hasOwn(flags, "sourceId");
  if (!hasIdentity) return { present: false, gearId: "" };
  const sourceIds = [cleanId(flags.gearId), cleanId(flags.sourceId)].filter(Boolean);
  const gearId = sourceIds[0] ?? "";
  const valid = normalizeToken(flags.sourceType) === "gear"
    && gearId
    && sourceIds.every((sourceId) => sourceId === gearId);
  return { present: true, gearId: valid ? gearId : "" };
}

function canonicalSourceIdentity(item) {
  const sources = [
    item?._stats?.compendiumSource,
    item?.flags?.core?.sourceId,
    item?.flags?.dnd5e?.sourceId
  ]
    .map(cleanId)
    .filter((value) => value.startsWith(CANONICAL_UUID_PREFIX));
  const documentIds = Array.from(new Set(sources.map((value) => cleanId(value.slice(CANONICAL_UUID_PREFIX.length)))));
  return {
    present: documentIds.length > 0,
    documentId: documentIds.length === 1 ? documentIds[0] : ""
  };
}

function isBodyArmor(itemData) {
  return normalizeToken(itemData?.type) === "equipment"
    && Boolean(normalizeToken(itemData?.system?.type?.value))
    && normalizeToken(itemData?.system?.type?.value) !== "shield";
}

function buildCanonicalIndex(entries) {
  const byDocumentId = new Map();
  const byGearId = new Map();
  const byNativeKey = new Map();
  for (const source of collectionValues(entries)) {
    const data = toPlain(source);
    const flags = canonicalFlags(data);
    const documentId = cleanId(data?._id ?? data?.id);
    if (!flags || !documentId || !SUPPORTED_ITEM_TYPES.has(normalizeToken(data?.type))) continue;
    const entry = { documentId, gearId: flags.gearId, data };
    byDocumentId.set(documentId, entry);
    addLookup(byGearId, flags.gearId, entry);
    addLookup(byNativeKey, canonicalNativeKey(data), entry);
  }
  return { byDocumentId, byGearId, byNativeKey };
}

function resolveCanonicalEntry(item, index) {
  if (!SUPPORTED_ITEM_TYPES.has(normalizeToken(item?.type))) return null;

  const explicit = explicitGearId(item);
  if (explicit.present) {
    return explicit.gearId ? uniqueLookup(index.byGearId, explicit.gearId) : null;
  }

  const sourceIdentity = canonicalSourceIdentity(item);
  if (sourceIdentity.present) {
    return sourceIdentity.documentId
      ? index.byDocumentId.get(sourceIdentity.documentId) ?? null
      : null;
  }

  const nativeKey = canonicalNativeKey(item);
  if (nativeKey) {
    return uniqueLookup(index.byNativeKey, nativeKey);
  }

  if (normalizeToken(item?.type) !== "weapon" || !hasLegacyMonsterEvidence(item)) {
    return null;
  }
  const gearId = resolveRebreyaOrdinaryWeaponGearId(item?.name);
  return gearId ? uniqueLookup(index.byGearId, gearId) : null;
}

export class CorpseStorageMaterializer {
  constructor({
    inventoryService,
    durabilityService,
    getGearPack = () => globalThis.game?.packs?.get?.(GEAR_PACK_ID) ?? null
  } = {}) {
    if (!inventoryService || typeof inventoryService.buildLootgenItemData !== "function") {
      throw new TypeError("CorpseStorageMaterializer requires InventoryService.buildLootgenItemData().");
    }
    if (!durabilityService || typeof durabilityService.getOrBuildBrokenDurability !== "function") {
      throw new TypeError("CorpseStorageMaterializer requires DurabilityService.getOrBuildBrokenDurability().");
    }
    if (typeof getGearPack !== "function") {
      throw new TypeError("CorpseStorageMaterializer requires a gear pack provider.");
    }
    this.inventoryService = inventoryService;
    this.durabilityService = durabilityService;
    this.getGearPack = getGearPack;
  }

  async materialize(token) {
    if (!isDeadNpcStorageTarget(token)) {
      throw new Error("Corpse storage can only be materialized for a dead unmarked NPC token.");
    }
    const document = resolveTokenDocument(token);
    const actor = actorOf(document);
    const pack = this.getGearPack();
    const actualPackId = cleanId(pack?.collection ?? pack?.metadata?.id);
    if (!pack || actualPackId !== GEAR_PACK_ID || typeof pack.getIndex !== "function" || typeof pack.getDocument !== "function") {
      throw new Error(`Corpse storage requires the canonical managed ${GEAR_PACK_ID} source.`);
    }

    const entries = await pack.getIndex({
      fields: [
        `flags.${MODULE_ID}.managed`,
        `flags.${MODULE_ID}.sourceType`,
        `flags.${MODULE_ID}.gearId`,
        `flags.${MODULE_ID}.sourceId`,
        "type",
        "system.type.value",
        "system.type.baseItem",
        "system.type.subtype"
      ]
    });
    const index = buildCanonicalIndex(entries);
    const rows = [];
    for (const embeddedSource of collectionValues(actor?.items)) {
      const embedded = toPlain(embeddedSource);
      const quantity = readQuantity(embedded);
      if (!quantity) continue;
      const entry = resolveCanonicalEntry(embedded, index);
      if (!entry) continue;
      const canonicalDocument = await pack.getDocument(entry.documentId);
      const canonicalData = toPlain(canonicalDocument);
      const flags = canonicalFlags(canonicalData);
      const canonicalUuid = cleanId(canonicalDocument?.uuid ?? canonicalData?.uuid);
      if (!flags
        || flags.gearId !== entry.gearId
        || (canonicalUuid && canonicalUuid !== `${CANONICAL_UUID_PREFIX}${entry.documentId}`)) {
        throw new Error(`Corpse gear '${entry.gearId}' requires a matching managed canonical source document.`);
      }
      const itemData = await this.inventoryService.buildLootgenItemData({
        sourceType: "gear",
        sourceId: entry.gearId,
        sourceDocumentId: entry.documentId,
        quantity
      });
      if (isBodyArmor(itemData)) {
        const broken = await this.durabilityService.getOrBuildBrokenDurability(itemData, {
          sourceType: "gear",
          sourceId: entry.gearId
        });
        if (!broken || broken.state !== "broken" || broken.breakStage !== 1 || Number(broken?.hp?.value) !== 0) {
          throw new Error(`Corpse armor '${entry.gearId}' could not derive the canonical broken state.`);
        }
        itemData.flags ??= {};
        itemData.flags[MODULE_ID] ??= {};
        itemData.flags[MODULE_ID].durability = clone(broken);
        itemData.name = formatDurabilityItemName(itemData.name, broken);
      }
      const embeddedId = cleanId(embedded?._id ?? embedded?.id);
      if (!embeddedId) continue;
      rows.push({
        rowId: `corpse-v${CORPSE_MATERIALIZATION_VERSION}:${embeddedId}:${entry.gearId}`,
        stackKey: `gear:${entry.gearId}`,
        sourceType: "gear",
        sourceId: entry.gearId,
        sourceDocumentId: entry.documentId,
        name: cleanId(itemData?.name ?? canonicalData?.name),
        img: cleanId(itemData?.img ?? canonicalData?.img),
        typeLabel: cleanId(itemData?.type ?? canonicalData?.type),
        quantity,
        itemData
      });
    }

    return {
      rows,
      coins: {},
      corpseMaterialization: {
        version: CORPSE_MATERIALIZATION_VERSION,
        status: "complete",
        sourceActorUuid: cleanId(actor?.uuid),
        sourceActorId: cleanId(actor?.id)
      }
    };
  }
}
