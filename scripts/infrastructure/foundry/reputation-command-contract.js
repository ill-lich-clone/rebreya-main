import { reputationExactKeys, validateReputationRequest, reputationFingerprint } from "../../data/reputation-rules.js?v=1.4.251";
export const REPUTATION_UPDATE_COMMAND = "reputation.update";
export function isValidReputationPayload(payload) {
  if (!reputationExactKeys(payload, ["actorUuid", "expectedRevision", "change", "reason", "operationId"])
    || typeof payload.actorUuid !== "string" || !/^Actor\.[A-Za-z0-9]{16}$/u.test(payload.actorUuid)) return false;
  try { const { actorUuid, ...request } = payload; validateReputationRequest(request); return true; }
  catch { return false; }
}
export function authorizeReputationUpdate(_payload, { sender, game = globalThis.game } = {}) {
  return Boolean(sender?.id && sender.isGM === true && game?.users?.get?.(sender.id) === sender);
}
/** Payload-sensitive transport ID prevents the gateway replay cache masking an altered durable ID. */
export async function reputationTransportId(payload, gmId) {
  const { actorUuid, ...request } = payload;
  const bytes = new TextEncoder().encode(JSON.stringify([actorUuid, request.operationId, reputationFingerprint(request, gmId)]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `reputation:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
}
