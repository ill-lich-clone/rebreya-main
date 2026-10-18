import { MODULE_ID } from "../constants.js";
import { buildNarrativeItemCreationPatch, pickLootgenNarrativeFields } from "./lootgen-narrative-catalog.js?v=1.4.396";

export function hasStorageNarrativeCandidates(rows = []) {
  return rows.some(row => {
    if (row?.rowKind === "journal" || row?.rowKind === "coin" || row?.sourceType === "journal") return false;
    const flags = row?.itemData?.flags?.[MODULE_ID];
    const shellFlags = row?.container?.presentation?.itemData?.flags?.[MODULE_ID];
    return Boolean(row?.itemData && (flags?.gearId || flags?.sourceType === "gear" || flags?.narrativeVariantId || row.sourceType === "gear" || row.narrativeVariantId))
      || Boolean(shellFlags?.gearId || shellFlags?.sourceType === "gear" || shellFlags?.narrativeVariantId)
      || hasStorageNarrativeCandidates(row?.container?.state?.manualRows)
      || hasStorageNarrativeCandidates(row?.container?.state?.generatedRows);
  });
}

/** Project physical storage copies through the canonical narrative policy. No document writes. */
export function prepareStorageNarrativeRows(rows, catalog, {
  random = Math.random, idFactory = () => globalThis.foundry?.utils?.randomID?.() ?? globalThis.crypto.randomUUID(), claimedRowIds = []
} = {}) {
  const claimed = new Set(claimedRowIds);
  const ids = new Set((rows ?? []).map(row => row.rowId));
  return (rows ?? []).flatMap(original => {
    const row = structuredClone(original);
    if (claimed.has(row.rowId) || row.rowKind === "journal" || row.rowKind === "coin" || row.sourceType === "journal") return [row];
    if (row.container?.state) {
      const state = row.container.state;
      const options = { random, idFactory, claimedRowIds: state.claimedRowIds ?? [] };
      state.manualRows = prepareStorageNarrativeRows(state.manualRows, catalog, options);
      state.generatedRows = prepareStorageNarrativeRows(state.generatedRows, catalog, options);
    }
    const itemData = row.container?.presentation?.itemData ?? row.itemData;
    if (!itemData || typeof itemData !== "object") return [row];
    const source = structuredClone(itemData);
    source.flags ??= {};
    const flags = source.flags[MODULE_ID] ??= {};
    for (const [key, value] of Object.entries(pickLootgenNarrativeFields(row))) {
      if (!Object.hasOwn(flags, key)) flags[key] = value;
    }
    if (flags.materialId || flags.sourceType === "material") return [row];
    if (!flags.gearId && row.sourceType === "gear") flags.gearId = row.sourceId;
    const firstPatch = buildNarrativeItemCreationPatch(source, catalog, { random });
    if (!firstPatch) return [row];
    const quantity = Number(row.quantity ?? source.system?.quantity ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Invalid personalised Item quantity");
    return Array.from({ length: quantity }, (_, index) => {
      const patch = index ? buildNarrativeItemCreationPatch(source, catalog, { random }) : firstPatch;
      const copy = structuredClone(row);
      if (index) {
        const id = String(idFactory() ?? "").trim();
        if (!id || ids.has(id)) throw new Error("Duplicate personalised storage row ID");
        copy.rowId = id;
        ids.add(id);
      }
      copy.itemData = structuredClone(source);
      copy.itemData.name = patch.name;
      copy.itemData.system = { ...copy.itemData.system, ...patch.system };
      copy.itemData.flags[MODULE_ID] = patch.flags[MODULE_ID];
      copy.name = copy.itemData.name;
      copy.quantity = 1;
      copy.stackable = false;
      if (copy.container) {
        copy.container.name = copy.name;
        copy.container.state.baseName = copy.name;
        copy.container.presentation ??= {};
        copy.container.presentation.itemData = structuredClone(copy.itemData);
      }
      Object.assign(copy, pickLootgenNarrativeFields(patch.flags[MODULE_ID]));
      for (const field of ["descriptor", "composition"]) if (copy[field]) copy[field].quantity = 1;
      if (Number.isFinite(row.totalValue)) copy.totalValue = row.totalValue / quantity;
      return copy;
    });
  });
}
