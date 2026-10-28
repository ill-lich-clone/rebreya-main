import { MODULE_ID } from "../constants.js";
import { isMaterializedCorpseStorageState, isDeadNpcStorageTarget } from "./storage-corpse-target.js?v=1.5.19";

export { isMaterializedCorpseStorageState };

function objectFlags(value) {
  if (!value || typeof value !== "object") return null;
  return value?.flags?.[MODULE_ID]
    ?? value?._source?.flags?.[MODULE_ID]
    ?? null;
}

function candidates(target) {
  const values = [
    target,
    target?.document,
    target?.token,
    target?.token?.document,
    target?.actor,
    target?.parent,
    target?.prototypeToken
  ];
  const seen = new Set();
  return values.filter((value) => {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function storageObjectKind(target) {
  for (const candidate of candidates(target)) {
    const flags = objectFlags(candidate);
    if (flags?.groundPile?.enabled === true || flags?.groundPilePrototype?.enabled === true) {
      return "groundPile";
    }
  }
  const creature = candidates(target).find(candidate => candidate?.type === "npc");
  if (creature && objectFlags(creature)?.storage?.enabled !== true && isDeadNpcStorageTarget(target)) return null;
  for (const candidate of candidates(target)) {
    const storage = objectFlags(candidate)?.storage;
    if (isMaterializedCorpseStorageState(storage)) continue;
    if (storage?.enabled === true || Number(storage?.version) >= 1) {
      return "chest";
    }
  }
  return null;
}

export function isNativeStorageObject(target) {
  return storageObjectKind(target) !== null;
}
