import { MODULE_ID } from "../constants.js";
import { normalizeLootgenForm } from "./lootgen-generator.js";

export const STORAGE_ACTOR_FLAG = "storage";
export const STORAGE_TOKEN_FLAG = "storage";
const STORAGE_VERSION = 1;
const STORAGE_STATES = new Set(["unopened", "opened", "empty"]);
export const STORAGE_TEXTURE_MODES = Object.freeze(["unopened", "opened", "empty"]);
const STORAGE_TEXTURE_MODE_SET = new Set(STORAGE_TEXTURE_MODES);
const COIN_KEYS = ["pp", "gp", "sp", "cp"];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanName(value, fallback = "Хранилище") {
  const name = String(value ?? "").trim().replace(/\s+/gu, " ");
  return name || fallback;
}

function resolveDocument(token) {
  return token?.document ?? token ?? null;
}

function readFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => clone(row));
}

function normalizeCoins(coins) {
  const result = {};
  for (const key of COIN_KEYS) {
    const amount = Number(coins?.[key] ?? 0);
    result[key] = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  }
  return result;
}

function mergeCoins(...sources) {
  return sources.reduce((total, source) => {
    const coins = normalizeCoins(source);
    for (const key of COIN_KEYS) {
      total[key] += coins[key];
    }
    return total;
  }, normalizeCoins());
}

function normalizeTemplate(template) {
  if (!template || typeof template !== "object") {
    return null;
  }
  const name = String(template.name ?? "").trim();
  return {
    name,
    form: normalizeLootgenForm(template.form)
  };
}

function visibleRows(state) {
  return [
    ...normalizeRows(state.manualRows),
    ...normalizeRows(state.generatedRows)
  ];
}

function normalizeClaimedRowIds(value) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((rowId) => String(rowId ?? "").trim())
    .filter(Boolean)));
}

function normalizeTextures(value) {
  if (!value || typeof value !== "object") return null;
  const textures = Object.fromEntries(STORAGE_TEXTURE_MODES.map((mode) => [
    mode,
    String(value[mode] ?? "").trim()
  ]));
  return STORAGE_TEXTURE_MODES.every((mode) => textures[mode]) ? textures : null;
}

function hasUnclaimedContent(state) {
  const rows = visibleRows(state);
  const hasRows = rows.some((row, index) => !state.claimedRowIds.includes(String(row.rowId ?? index)));
  const coins = mergeCoins(state.manualCoins, state.generatedCoins);
  const hasCoins = !state.coinsClaimed && COIN_KEYS.some((key) => coins[key] > 0);
  return hasRows || hasCoins;
}

export function buildStorageTokenState(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const state = STORAGE_STATES.has(source.state) ? source.state : "unopened";
  const textures = normalizeTextures(source.textures);
  const displayMode = textures && STORAGE_TEXTURE_MODE_SET.has(source.displayMode)
    ? source.displayMode
    : state;
  return {
    version: STORAGE_VERSION,
    baseName: cleanName(source.baseName),
    template: normalizeTemplate(source.template),
    manualRows: normalizeRows(source.manualRows),
    manualCoins: normalizeCoins(source.manualCoins),
    generatedRows: normalizeRows(source.generatedRows),
    generatedCoins: normalizeCoins(source.generatedCoins),
    claimedRowIds: normalizeClaimedRowIds(source.claimedRowIds),
    coinsClaimed: source.coinsClaimed === true,
    state,
    textures,
    displayMode
  };
}

export function isStorageActor(actor) {
  const data = readFlag(actor, STORAGE_ACTOR_FLAG);
  return data?.enabled === true;
}

export function readStorageState(token) {
  const document = resolveDocument(token);
  const stored = readFlag(document, STORAGE_TOKEN_FLAG);
  return buildStorageTokenState({
    baseName: stored?.baseName ?? document?.name ?? token?.name,
    ...stored
  });
}

export function deriveStorageDisplayName(state = {}) {
  const normalized = buildStorageTokenState(state);
  return normalized.state === "empty"
    ? normalized.baseName + " (пусто)"
    : normalized.baseName;
}

export class StorageService {
  constructor({
    generate = async () => ({ rows: [], coins: {} }),
    onGeneratedOpen = async () => {},
    logger = console
  } = {}) {
    if (typeof generate !== "function") {
      throw new TypeError("StorageService requires a generate function.");
    }
    this.generate = generate;
    this.onGeneratedOpen = typeof onGeneratedOpen === "function" ? onGeneratedOpen : async () => {};
    this.logger = logger;
    this.openTasks = new Map();
  }

  async #write(token, state) {
    const document = resolveDocument(token);
    if (typeof document?.update !== "function") {
      throw new TypeError("Storage token must support update.");
    }
    const normalized = buildStorageTokenState(state);
    const patch = {
      ["flags." + MODULE_ID + "." + STORAGE_TOKEN_FLAG]: normalized,
      name: deriveStorageDisplayName(normalized)
    };
    const texturePath = normalized.textures?.[normalized.displayMode];
    if (texturePath) {
      patch["texture.src"] = texturePath;
    }
    await document.update(patch);
    return clone(normalized);
  }

  async configure(token, config = {}) {
    const current = readStorageState(token);
    const source = config && typeof config === "object" ? config : {};
    return this.#write(token, {
      ...current,
      ...source,
      template: source.template === undefined ? current.template : source.template,
      manualRows: source.manualRows === undefined ? current.manualRows : source.manualRows,
      manualCoins: source.manualCoins === undefined ? current.manualCoins : source.manualCoins,
      generatedRows: source.generatedRows === undefined ? current.generatedRows : source.generatedRows,
      generatedCoins: source.generatedCoins === undefined ? current.generatedCoins : source.generatedCoins
    });
  }

  async open(token, context = {}) {
    const document = resolveDocument(token);
    const tokenId = String(document?.uuid ?? document?.id ?? token?.id ?? "");
    if (this.openTasks.has(tokenId)) {
      return this.openTasks.get(tokenId);
    }

    const task = this.#openOnce(token, context).finally(() => {
      this.openTasks.delete(tokenId);
    });
    this.openTasks.set(tokenId, task);
    return task;
  }

  async #openOnce(token, context) {
    const current = readStorageState(token);
    if (current.state !== "unopened") {
      return {
        generatedNow: false,
        state: clone(current),
        rows: visibleRows(current),
        coins: mergeCoins(current.manualCoins, current.generatedCoins),
        context: clone(context)
      };
    }

    const generated = await this.generate(current.template?.form ?? normalizeLootgenForm({}), {
      token: resolveDocument(token),
      state: clone(current),
      context: clone(context)
    });
    const next = await this.#write(token, {
      ...current,
      generatedRows: generated?.rows,
      generatedCoins: generated?.coins,
      state: "opened",
      displayMode: "opened"
    });
    try {
      await this.onGeneratedOpen({ token: resolveDocument(token), state: clone(next), context: clone(context) });
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage opened callback failed.`, error);
    }
    return {
      generatedNow: true,
      state: next,
      rows: visibleRows(next),
      coins: mergeCoins(next.manualCoins, next.generatedCoins),
      context: clone(context)
    };
  }

  async claim(token, request = {}) {
    const current = readStorageState(token);
    if (current.state === "unopened") {
      throw new Error("Сначала откройте хранилище.");
    }

    if (request?.kind === "coins") {
      const coins = mergeCoins(current.manualCoins, current.generatedCoins);
      if (current.coinsClaimed || !COIN_KEYS.some((key) => coins[key] > 0)) {
        return { changed: false, coins, state: clone(current) };
      }
      const nextState = hasUnclaimedContent({ ...current, coinsClaimed: true }) ? "opened" : "empty";
      const state = await this.#write(token, {
        ...current,
        coinsClaimed: true,
        state: nextState,
        displayMode: nextState === "empty" ? "empty" : current.displayMode
      });
      return { changed: true, coins, state };
    }

    const rowId = String(request?.rowId ?? "").trim();
    const rows = visibleRows(current);
    const row = rows.find((entry, index) => String(entry.rowId ?? index) === rowId) ?? null;
    if (!row || current.claimedRowIds.includes(rowId)) {
      return { changed: false, row: null, state: clone(current) };
    }

    const available = Math.max(1, Math.trunc(Number(
      row.quantity ?? row.itemData?.system?.quantity ?? 1
    )) || 1);
    const quantity = request?.quantity === undefined
      ? available
      : Number(request.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available) {
      throw new Error("Количество должно быть целым числом от 1 до доступного остатка.");
    }

    const claimedRow = clone(row);
    claimedRow.quantity = quantity;
    claimedRow.itemData ??= {};
    claimedRow.itemData.system ??= {};
    claimedRow.itemData.system.quantity = quantity;

    if (quantity < available) {
      const remaining = available - quantity;
      const updateRows = (sourceRows) => normalizeRows(sourceRows).map((entry) => {
        if (String(entry?.rowId ?? "").trim() !== rowId) return entry;
        entry.quantity = remaining;
        entry.itemData ??= {};
        entry.itemData.system ??= {};
        entry.itemData.system.quantity = remaining;
        return entry;
      });
      const state = await this.#write(token, {
        ...current,
        manualRows: updateRows(current.manualRows),
        generatedRows: updateRows(current.generatedRows)
      });
      return { changed: true, row: claimedRow, quantity, state };
    }

    const claimedRowIds = [...current.claimedRowIds, rowId];
    const nextState = hasUnclaimedContent({ ...current, claimedRowIds }) ? "opened" : "empty";
    const state = await this.#write(token, {
      ...current,
      claimedRowIds,
      state: nextState,
      displayMode: nextState === "empty" ? "empty" : current.displayMode
    });
    return { changed: true, row: claimedRow, quantity, state };
  }

  async #mutateEditableRow(token, rowId, mutate) {
    const current = readStorageState(token);
    const id = String(rowId ?? "").trim();
    if (!id || current.claimedRowIds.includes(id)) throw new Error("Предмет уже забран или недоступен для изменения.");
    let found = false;
    const change = (rows) => rows.map((row) => {
      if (String(row?.rowId ?? "").trim() !== id) return row;
      found = true;
      return mutate(clone(row));
    }).filter(Boolean);
    const manualRows = change(current.manualRows);
    const generatedRows = change(current.generatedRows);
    if (!found) throw new Error("Предмет хранилища не найден.");
    const candidate = { ...current, manualRows, generatedRows };
    const state = current.state === "unopened" ? "unopened" : (hasUnclaimedContent(candidate) ? "opened" : "empty");
    return this.#write(token, {
      ...candidate,
      state,
      displayMode: state === "empty" ? "empty" : state === "opened" ? "opened" : current.displayMode
    });
  }

  async updateRowQuantity(token, rowId, quantity) {
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Количество должно быть целым числом не меньше 1.");
    return this.#mutateEditableRow(token, rowId, (row) => {
      row.quantity = amount;
      row.itemData ??= {};
      row.itemData.system ??= {};
      row.itemData.system.quantity = amount;
      return row;
    });
  }

  async deleteRow(token, rowId) {
    return this.#mutateEditableRow(token, rowId, () => null);
  }

  async setTextureMode(token, mode) {
    const normalizedMode = String(mode ?? "").trim();
    if (!STORAGE_TEXTURE_MODE_SET.has(normalizedMode)) {
      throw new Error("Неизвестный режим текстуры хранилища.");
    }
    const current = readStorageState(token);
    if (!current.textures) {
      throw new Error("У хранилища не настроен полный набор текстур.");
    }
    return this.#write(token, {
      ...current,
      displayMode: normalizedMode
    });
  }
}
