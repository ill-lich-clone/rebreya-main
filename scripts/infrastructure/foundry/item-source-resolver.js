import { MODULE_ID } from "../../constants.js";
import { collectItemSourceUuids } from "../../data/item-source-reference.js?v=1.4.377";

const clean = value => String(value ?? "").trim();
const normalize = value => clean(value).replace(/\s+/gu, " ").toLocaleLowerCase();
const values = collection => collection?.contents ?? Array.from(collection?.values?.() ?? []);
const documentName = document => document?.documentName ?? document?.constructor?.metadata?.name;
const packIdOf = item => item?.pack || (clean(item?.uuid).startsWith("Compendium.") ? item.uuid.split(".").slice(1, 3).join(".") : "");
const visibleItemPack = pack => Boolean(pack?.visible && documentName(pack) === "Item");

export function canViewItem(item, { game = globalThis.game } = {}) {
  if (documentName(item) !== "Item" || !game?.user) return false;
  const packId = packIdOf(item);
  if (packId && !visibleItemPack(game.packs?.get?.(packId))) return false;
  try { return item.testUserPermission?.(game.user, "OBSERVER") === true; }
  catch { return false; }
}

function isExternalItem(item, environment) {
  return Boolean(item && !item.parent && canViewItem(item, environment));
}

function typedId(flags, type) {
  const key = Object.keys(flags).find(key => normalize(key) === `${normalize(type)}id`);
  return clean(key ? flags[key] : "");
}

/** Read-only source lookup; null also covers ambiguity or an incomplete search. */
export async function resolveItemSource(itemOrData, hints = {}, {
  game = globalThis.game,
  fromUuid = globalThis.fromUuid
} = {}) {
  const environment = { game };
  const data = itemOrData?.toObject?.() ?? itemOrData ?? {};
  for (const uuid of collectItemSourceUuids(data, hints)) {
    const packId = uuid.startsWith("Compendium.") ? uuid.split(".").slice(1, 3).join(".") : "";
    if (packId && !visibleItemPack(game?.packs?.get?.(packId))) continue;
    try {
      const document = await fromUuid?.(uuid);
      if (isExternalItem(document, environment)) return document;
    }
    catch { /* A stale source can still have a valid identity or name. */ }
  }

  const flags = data.flags?.[MODULE_ID] ?? {};
  const sourceType = normalize(hints.sourceType || flags.sourceType);
  const sourceId = clean(flags.sourceId) || typedId(flags, flags.sourceType || sourceType)
    || typedId(flags, sourceType) || clean(hints.sourceId);
  const sourceName = normalize(hints.sourceName || data.name);
  const packs = values(game?.packs).filter(visibleItemPack);
  const indexed = await Promise.all(packs.map(async pack => {
    try {
      const index = await pack.getIndex({ fields: ["name", "type", `flags.${MODULE_ID}`] });
      return { pack, entries: values(index) };
    }
    catch { return null; }
  }));
  if (indexed.some(result => !result)) return null;
  const worldItems = values(game?.items).filter(item => isExternalItem(item, environment));
  const matchesId = entry => {
    const candidate = entry?.flags?.[MODULE_ID] ?? {};
    if (candidate.sourceType && normalize(candidate.sourceType) !== sourceType) return false;
    return (normalize(candidate.sourceType) === sourceType && clean(candidate.sourceId) === sourceId)
      || typedId(candidate, sourceType) === sourceId;
  };
  const packMatch = async predicate => {
    const candidates = indexed.flatMap(({ pack, entries }) => entries.filter(predicate).map(entry => ({ pack, entry })));
    const documents = await Promise.all(candidates.map(async ({ pack, entry }) => {
      try { return await pack.getDocument(entry._id ?? entry.id) ?? null; }
      catch { return undefined; }
    }));
    const accessible = documents.filter(document => isExternalItem(document, environment));
    return { document: accessible[0] ?? null, blocked: documents.includes(undefined) || accessible.length > 1 };
  };
  for (const predicate of [
    ...(sourceType && sourceId ? [matchesId] : []),
    ...(sourceName ? [entry => normalize(entry?.name) === sourceName] : [])
  ]) {
    const packed = await packMatch(predicate);
    if (packed.blocked) return null;
    if (packed.document) return packed.document;
    const world = worldItems.filter(predicate);
    if (world.length > 1) return null;
    if (world.length === 1) return world[0];
  }
  return null;
}
