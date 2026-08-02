export const STORAGE_DRAG_TYPE = "RebreyaStorageClaim";

function clean(value) {
  return String(value ?? "").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : 0;
}

export function buildStorageDragData({ tokenUuid = "", path = [], rowId = "", quantity = 0 } = {}) {
  const payload = {
    type: STORAGE_DRAG_TYPE,
    tokenUuid: clean(tokenUuid),
    rowId: clean(rowId),
    quantity: positiveInteger(quantity)
  };
  const normalizedPath = (Array.isArray(path) ? path : []).map(clean).filter(Boolean).slice(0, 8);
  if (normalizedPath.length) payload.path = normalizedPath;
  if (!payload.tokenUuid || !payload.rowId || !payload.quantity) {
    throw new Error("Нельзя перетащить предмет без действительного источника.");
  }
  return payload;
}

export function parseStorageDragData(value) {
  let payload = value;
  if (typeof value === "string") {
    try {
      payload = JSON.parse(value);
    }
    catch (_error) {
      return null;
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (clean(payload.type) !== STORAGE_DRAG_TYPE) return null;
  const tokenUuid = clean(payload.tokenUuid);
  const rowId = clean(payload.rowId);
  const quantity = positiveInteger(payload.quantity);
  if (!tokenUuid || !rowId || !quantity) return null;
  const path = (Array.isArray(payload.path) ? payload.path : []).map(clean).filter(Boolean).slice(0, 8);
  return {
    type: STORAGE_DRAG_TYPE,
    tokenUuid,
    ...(path.length ? { path } : {}),
    rowId,
    quantity
  };
}

export function storageGridColumns(itemCount) {
  const count = Math.max(0, Math.trunc(Number(itemCount) || 0));
  if (count <= 6) return 3;
  return Math.max(4, Math.ceil(Math.sqrt(count * 1.25)));
}

async function defaultQuantityPrompt({ max, value }) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.prompt !== "function") {
    const fallback = globalThis.prompt?.(`Сколько перенести? (1-${max})`, String(value));
    return fallback === null ? null : Number(fallback);
  }
  return DialogV2.prompt({
    window: { title: "Сколько перенести?" },
    content: `
      <form class="rm-storage-quantity-dialog">
        <label>Количество (1-${max})</label>
        <input type="number" name="quantity" min="1" max="${max}" step="1" value="${value}" autofocus>
      </form>
    `,
    ok: {
      label: "Перенести",
      callback: (_event, button) => Number(button?.form?.elements?.quantity?.value)
    },
    rejectClose: false
  });
}

export async function promptStorageTransferQuantity(maxQuantity, { prompt = defaultQuantityPrompt } = {}) {
  const max = positiveInteger(maxQuantity);
  if (!max) throw new Error("В источнике нет доступных предметов.");
  if (max === 1) return 1;
  const value = await prompt({ max, value: max });
  if (value === null || value === undefined || value === false || value === "") return null;
  const quantity = positiveInteger(value);
  if (!quantity || quantity > max) {
    throw new Error(`Количество должно быть целым числом от 1 до ${max}.`);
  }
  return quantity;
}
