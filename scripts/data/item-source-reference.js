import { MODULE_ID } from "../constants.js";

const clean = value => String(value ?? "").trim();
const isSourceUuid = value => /^Item\.[^.\s]+$/u.test(value)
  || /^Compendium\.[^.\s]+\.[^.\s]+\.(?:Item\.)?[^.\s]+$/u.test(value);

/** Display provenance only; embedded Actor Items are transient, not external sources. */
export function collectItemSourceUuids(itemOrData, { sourceUuid = "" } = {}) {
  const data = itemOrData?.toObject?.() ?? itemOrData ?? {};
  return [...new Set([
    data.flags?.[MODULE_ID]?.itemSourceUuid,
    data.flags?.core?.sourceId,
    data.flags?.dnd5e?.sourceId,
    data._stats?.compendiumSource,
    sourceUuid
  ].map(clean).filter(isSourceUuid))];
}

export function preserveItemSourceUuid(itemData, options = {}) {
  const result = structuredClone(itemData);
  const [sourceUuid] = collectItemSourceUuids(itemData, options);
  if (sourceUuid) {
    result.flags ??= {};
    result.flags[MODULE_ID] ??= {};
    result.flags[MODULE_ID].itemSourceUuid = sourceUuid;
  }
  return result;
}

export function stripItemSourceUuidFromFlags(flags = {}) {
  const result = structuredClone(flags);
  if (result[MODULE_ID]) {
    delete result[MODULE_ID].itemSourceUuid;
    if (!Object.keys(result[MODULE_ID]).length) delete result[MODULE_ID];
  }
  return result;
}
