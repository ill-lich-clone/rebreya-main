export const MAX_REPUTATION_HISTORY = 50;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function reputationExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export class ReputationError extends Error {
  constructor(code) {
    super({ "invalid-request": "Проверьте целые числа и причину изменения (до 240 символов).",
      "invalid-value": "Счётчики должны оставаться неотрицательными целыми числами без переполнения.",
      "invalid-state": "Сохранённые данные репутации повреждены; автоматическая перезапись отменена.",
      "stale-revision": "Значения уже изменились. Проверьте свежие данные и подтвердите новую правку.",
      "operation-conflict": "Этот номер операции уже использован для другого изменения.",
      unauthorized: "Изменять репутацию может только мастер; просмотр требует доступа к персонажу.",
      "invalid-actor": "Выберите доступного персонажа.",
      "ambiguous-outcome": "Не удалось подтвердить сохранение. Повторите ту же операцию, не меняя её данные." }[code] ?? code);
    this.name = "ReputationError"; this.code = code;
  }
}
export function validateReputationRequest(request) {
  if (!reputationExactKeys(request, ["expectedRevision", "change", "reason", "operationId"])
    || !integer(request.expectedRevision) || !text(request.reason, 240) || !text(request.operationId, 128)
    || request.operationId !== request.operationId.trim()) throw new ReputationError("invalid-request");
  const mode = reputationExactKeys(request.change, ["set"]) ? "set" : reputationExactKeys(request.change, ["delta"]) ? "delta" : null;
  const values = request.change?.[mode];
  if (!mode || !reputationExactKeys(values, ["fame", "infamy"])
    || ![values.fame, values.infamy].every(Number.isSafeInteger)
    || (mode === "set" && (values.fame < 0 || values.infamy < 0))) throw new ReputationError("invalid-request");
  return { expectedRevision: request.expectedRevision, operationId: request.operationId,
    reason: request.reason.trim(), change: { [mode]: { fame: values.fame, infamy: values.infamy } } };
}
export function normalizeReputation(raw) {
  if (raw == null) return { version: 1, fame: 0, infamy: 0, revision: 0, recentChanges: [] };
  if (typeof raw !== "object" || Array.isArray(raw) || (raw.version != null && raw.version !== 1)
    || ![raw.fame ?? 0, raw.infamy ?? 0, raw.revision ?? 0].every(integer)
    || (raw.recentChanges != null && !Array.isArray(raw.recentChanges))) throw new ReputationError("invalid-state");
  const recentChanges = structuredClone((raw.recentChanges ?? []).slice(-MAX_REPUTATION_HISTORY));
  if (recentChanges.some(r => !r || !text(r.operationId, 128) || !text(r.fingerprint, 2048)
    || !integer(r.revision) || r.revision > (raw.revision ?? 0) || !integer(r.after?.fame) || !integer(r.after?.infamy))) throw new ReputationError("invalid-state");
  return { version: 1, fame: raw.fame ?? 0, infamy: raw.infamy ?? 0, revision: raw.revision ?? 0, recentChanges };
}
export function reputationFingerprint(request, gmId) {
  const r = validateReputationRequest(request);
  return JSON.stringify({ gmId, expectedRevision: r.expectedRevision, change: r.change, reason: r.reason });
}
export function applyReputationChange(state, request, { gmId, timestamp }) {
  const current = normalizeReputation(state), r = validateReputationRequest(request);
  if (!text(gmId, 128) || !integer(timestamp)) throw new ReputationError("invalid-request");
  const fingerprint = reputationFingerprint(r, gmId);
  const receipt = current.recentChanges.find(entry => entry.operationId === r.operationId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new ReputationError("operation-conflict");
    return { version: 1, ...receipt.after, revision: receipt.revision,
      recentChanges: current.recentChanges.filter(entry => entry.revision <= receipt.revision) };
  }
  if (r.expectedRevision !== current.revision) throw new ReputationError("stale-revision");
  const before = { fame: current.fame, infamy: current.infamy };
  const after = r.change.set ?? { fame: current.fame + r.change.delta.fame, infamy: current.infamy + r.change.delta.infamy };
  const revision = current.revision + 1;
  if (![after.fame, after.infamy, revision].every(integer)) throw new ReputationError("invalid-value");
  return { version: 1, ...after, revision, recentChanges: [...current.recentChanges,
    { operationId: r.operationId, fingerprint, gmId, timestamp, before, after: { ...after }, reason: r.reason, revision }].slice(-MAX_REPUTATION_HISTORY) };
}
