const pending = new Map();
const scope = "rebreya-main";
const ttl = 630_000; // 10 minute card lifetime plus the accepted clock skew.
const keyOf = uuid => /^ChatMessage\.([a-zA-Z0-9]{1,64})$/.exec(uuid)?.[1];

export function movementReceiptPatch(token, uuid, now = Date.now()) {
  const id = keyOf(uuid);
  if (!id) return {};
  const journal = token.flags?.[scope]?.cardMovementReceipts ?? {};
  const path = `flags.${scope}.cardMovementReceipts.`;
  const patch = { [path + "m" + id]: now + ttl };
  for (const [key, expires] of Object.entries(journal)) {
    if (key !== "m" + id && /^m[a-zA-Z0-9]{1,64}$/.test(key) && expires <= now) {
      if (globalThis._del) patch[path + key] = globalThis._del;
      else patch[path + "-=" + key] = null;
    }
  }
  return patch;
}

export function withMovementReceipt(token, uuid, replayResult, apply) {
  const id = keyOf(uuid);
  if (!id) return apply();
  const key = token.uuid + "/" + id;
  if (pending.has(key)) return pending.get(key).then(result => result && replayResult);
  const flags = token.flags?.[scope];
  if (flags?.cardMovementReceipts?.["m" + id] > Date.now() || flags?.cardTeleport === uuid || flags?.cardShove === uuid) return replayResult;
  const promise = Promise.resolve().then(apply).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
