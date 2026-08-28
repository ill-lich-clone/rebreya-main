export const PURCHASE_BASKET_COMMIT_COMMAND = "purchase-basket.commit";
export const PURCHASE_BASKET_MAX_ROWS = 100;
export const PURCHASE_DENOMINATION_COPPER = Object.freeze({
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUnitPrice(value) {
  if (!hasExactKeys(value, ["denomination", "value"])) return false;
  const multiplier = PURCHASE_DENOMINATION_COPPER[value.denomination];
  return Number.isFinite(value.value)
    && value.value >= 0
    && Number.isSafeInteger(value.value * multiplier);
}

function isValidRow(value) {
  return hasExactKeys(value, ["quantity", "rowId", "sourceUuid", "unitPrice"])
    && isNonEmptyString(value.rowId)
    && isNonEmptyString(value.sourceUuid)
    && Number.isSafeInteger(value.quantity)
    && value.quantity >= 1
    && isValidUnitPrice(value.unitPrice);
}

export function isValidPurchaseBasketPayload(payload) {
  if (!hasExactKeys(payload, ["actorId", "rows", "transactionId"])
    || !isNonEmptyString(payload.transactionId)
    || !isNonEmptyString(payload.actorId)
    || !Array.isArray(payload.rows)
    || payload.rows.length < 1
    || payload.rows.length > PURCHASE_BASKET_MAX_ROWS
    || !payload.rows.every(isValidRow)) {
    return false;
  }

  const rowIds = new Set();
  const sourceUuids = new Set();
  for (const row of payload.rows) {
    const rowId = row.rowId.trim();
    const sourceUuid = row.sourceUuid.trim();
    if (rowIds.has(rowId) || sourceUuids.has(sourceUuid)) return false;
    rowIds.add(rowId);
    sourceUuids.add(sourceUuid);
  }
  return true;
}

function invalid(message, transactionId = "") {
  const error = new TypeError(message);
  error.code = "invalid-request";
  error.transactionId = transactionId;
  return error;
}

export function canonicalizePurchaseBasketRequest(payload, requestedByUserId) {
  const transactionId = typeof payload?.transactionId === "string" ? payload.transactionId.trim() : "";
  if (Array.isArray(payload?.rows)) {
    const rowIds = new Set();
    const sourceUuids = new Set();
    for (const row of payload.rows) {
      const rowId = typeof row?.rowId === "string" ? row.rowId.trim() : "";
      const sourceUuid = typeof row?.sourceUuid === "string" ? row.sourceUuid.trim() : "";
      if (rowId && rowIds.has(rowId)) throw invalid("Purchase basket has a duplicate row ID", transactionId);
      if (sourceUuid && sourceUuids.has(sourceUuid)) throw invalid("Purchase basket has a duplicate source UUID", transactionId);
      if (rowId) rowIds.add(rowId);
      if (sourceUuid) sourceUuids.add(sourceUuid);
    }
  }
  if (!isValidPurchaseBasketPayload(payload)) {
    throw invalid("Purchase basket payload is invalid", transactionId);
  }
  const requester = typeof requestedByUserId === "string" ? requestedByUserId.trim() : "";
  if (!requester) throw invalid("Purchase basket requester is invalid", transactionId);

  const rows = payload.rows.map((row) => Object.freeze({
    rowId: row.rowId.trim(),
    sourceUuid: row.sourceUuid.trim(),
    quantity: row.quantity,
    unitPrice: Object.freeze({
      value: row.unitPrice.value,
      denomination: row.unitPrice.denomination
    })
  })).sort((left, right) => left.rowId.localeCompare(right.rowId));
  const actorId = payload.actorId.trim();
  const fingerprint = JSON.stringify([actorId, rows]);

  return Object.freeze({
    transactionId,
    actorId,
    rows: Object.freeze(rows),
    requestedByUserId: requester,
    fingerprint
  });
}
