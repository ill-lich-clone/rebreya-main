import { MODULE_ID } from "../constants.js";

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

export function isMaterializedCorpseStorageState(value) {
  return Number(value?.corpseMaterialization?.version) === 1
    && value?.corpseMaterialization?.status === "complete";
}

export function storageObjectKind(target) {
  for (const candidate of candidates(target)) {
    const flags = objectFlags(candidate);
    if (flags?.groundPile?.enabled === true || flags?.groundPilePrototype?.enabled === true) {
      return "groundPile";
    }
  }
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
