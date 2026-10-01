import { MODULE_ID } from "../constants.js";

export const CORPSE_MATERIALIZATION_VERSION = 1;

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function tokenActor(token) {
  const document = tokenDocument(token);
  return document?.actor ?? token?.actor ?? null;
}

function readFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key)
    ?? document?.flags?.[MODULE_ID]?.[key]
    ?? document?._source?.flags?.[MODULE_ID]?.[key];
}

function isUnmarkedNpc(token) {
  const actor = tokenActor(token);
  return actor?.type === "npc" && readFlag(actor, "storage")?.enabled !== true;
}

export function isMaterializedCorpseStorageState(state) {
  return Number(state?.corpseMaterialization?.version) === CORPSE_MATERIALIZATION_VERSION
    && state?.corpseMaterialization?.status === "complete";
}

export function isDeadNpcStorageTarget(token) {
  if (!isUnmarkedNpc(token)) return false;
  const actor = tokenActor(token);
  const hp = actor?.system?.attributes?.hp?.value;
  const statuses = actor?.statuses;
  const hasStatus = id => statuses?.has?.(id) === true || (Array.isArray(statuses) && statuses.includes(id));
  if (!hasStatus("dead") && (hasStatus("unconscious") || hasStatus("stable"))) return false;
  return typeof hp === "number" && Number.isFinite(hp) && hp <= 0;
}

export function isCorpseStorageTarget(token) {
  return isDeadNpcStorageTarget(token);
}
