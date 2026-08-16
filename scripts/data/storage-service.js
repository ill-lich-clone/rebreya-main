import { MODULE_ID } from "../constants.js";
import { normalizeLootgenForm } from "./lootgen-generator.js";
import {
  buildStorageContainerSnapshot,
  collectStorageContainerIds,
  isStorageContainerRow,
  isStorageJournalRow,
  resolveStorageContainerPath,
  updateStorageContainerPath
} from "./storage-container-snapshot.js";

export const STORAGE_ACTOR_FLAG = "storage";
export const STORAGE_TOKEN_FLAG = "storage";
export const STORAGE_UPDATED_HOOK = `${MODULE_ID}.storageUpdated`;
const STORAGE_VERSION = 1;
const STORAGE_STATES = new Set(["unopened", "opened", "empty"]);
export const STORAGE_TEXTURE_MODES = Object.freeze(["unopened", "opened", "empty"]);
const STORAGE_TEXTURE_MODE_SET = new Set(STORAGE_TEXTURE_MODES);
export const STORAGE_COIN_DENOMINATIONS = Object.freeze(["pp", "gp", "sp", "cp"]);
const STORAGE_COIN_DENOMINATION_SET = new Set(STORAGE_COIN_DENOMINATIONS);
const COIN_KEYS = STORAGE_COIN_DENOMINATIONS;
const STORAGE_KINDS = new Set(["chest", "bag", "pile"]);
const NIGHT_GOGGLES_ICON = "modules/rebreya-main/templates/icons/Magic%20Items/%D0%9D%D0%BE%D1%87%D0%BD%D1%8B%D0%B5%20%D0%BE%D1%87%D0%BA%D0%B8.webp";

export function readStorageCoinDenomination(item) {
  const flag = typeof item?.getFlag === "function"
    ? item.getFlag(MODULE_ID, "storageCoinTemplate")
    : item?.flags?.[MODULE_ID]?.storageCoinTemplate;
  if (flag?.version !== 1) return null;
  const denomination = String(flag?.denomination ?? "").trim().toLowerCase();
  return STORAGE_COIN_DENOMINATION_SET.has(denomination) ? denomination : null;
}

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

function cleanId(value) {
  return String(value ?? "").trim();
}

function normalizeStorageItemIcon(value) {
  const path = cleanId(value).replace(/\\/gu, "/");
  return path.toLowerCase().endsWith("goggles-of-night.webp")
    ? NIGHT_GOGGLES_ICON
    : path;
}

function storageKindForDocument(document, stored = null) {
  const explicit = cleanId(stored?.storageKind);
  if (STORAGE_KINDS.has(explicit)) return explicit;
  return readFlag(document, "groundPile")?.enabled === true ? "pile" : "chest";
}

function storageContainerIdForDocument(document, stored = null) {
  const explicit = cleanId(stored?.containerId);
  if (explicit) return explicit;
  const identity = cleanId(document?.uuid ?? document?.id);
  return identity ? `scene-storage:${identity}` : `scene-storage:${createDepositRowId()}`;
}

function normalizeRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const normalized = clone(row);
      if (Object.hasOwn(normalized, "img")) {
        normalized.img = normalizeStorageItemIcon(normalized.img);
      }
      if (normalized.itemData && typeof normalized.itemData === "object" && Object.hasOwn(normalized.itemData, "img")) {
        normalized.itemData.img = normalizeStorageItemIcon(normalized.itemData.img);
      }
      return normalized;
    });
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

function requirePositiveQuantity(value) {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Количество должно быть целым числом не меньше 1.");
  }
  return quantity;
}

function cleanStackKey(value) {
  return String(value ?? "").trim();
}

function storageRowStackKey(row) {
  return cleanStackKey(row?.stackKey ?? row?.sourceId);
}

function setStorageRowQuantity(row, quantity) {
  const next = clone(row) ?? {};
  next.quantity = quantity;
  next.itemData ??= {};
  next.itemData.system ??= {};
  next.itemData.system.quantity = quantity;
  return next;
}

function createDepositRowId() {
  const random = globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `deposit-${random}`;
}

function mergeDepositIntoRows(rows, claimedRowIds, row, stackKey, quantity) {
  const nextRows = normalizeRows(rows);
  const index = stackKey
    ? nextRows.findIndex((entry) => (
        !claimedRowIds.has(String(entry?.rowId ?? "").trim())
        && storageRowStackKey(entry) === stackKey
      ))
    : -1;
  if (index < 0) return { rows: nextRows, merged: false, rowId: "" };

  const currentQuantity = requirePositiveQuantity(
    nextRows[index]?.quantity ?? nextRows[index]?.itemData?.system?.quantity ?? 1
  );
  nextRows[index] = setStorageRowQuantity(nextRows[index], currentQuantity + quantity);
  return {
    rows: nextRows,
    merged: true,
    rowId: String(nextRows[index].rowId ?? "").trim()
  };
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
    containerId: cleanId(source.containerId),
    storageKind: STORAGE_KINDS.has(cleanId(source.storageKind)) ? cleanId(source.storageKind) : "chest",
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
    containerId: storageContainerIdForDocument(document, stored),
    storageKind: storageKindForDocument(document, stored),
    baseName: stored?.baseName ?? document?.name ?? token?.name,
    ...stored
  });
}

function storageSnapshotForToken(token) {
  const document = resolveDocument(token);
  const state = readStorageState(token);
  const texturePath = cleanId(state.textures?.[state.displayMode] ?? document?.texture?.src ?? token?.texture?.src);
  return buildStorageContainerSnapshot({
    containerId: state.containerId,
    storageKind: state.storageKind,
    name: state.baseName,
    img: texturePath,
    state,
    presentation: {
      tokenName: cleanId(document?.name ?? token?.name),
      texture: texturePath,
      width: Number(document?.width ?? token?.width) || 1,
      height: Number(document?.height ?? token?.height) || 1
    }
  });
}

function normalizeStoragePath(path) {
  return (Array.isArray(path) ? path : []).map(cleanId).filter(Boolean);
}

export function readStorageStateAtPath(token, path = []) {
  const normalizedPath = normalizeStoragePath(path);
  if (!normalizedPath.length) return readStorageState(token);
  const nested = resolveStorageContainerPath(storageSnapshotForToken(token), normalizedPath);
  if (!nested) throw new Error("Вложенный контейнер по указанному пути не найден.");
  return buildStorageTokenState({
    ...nested.state,
    containerId: nested.containerId,
    storageKind: nested.storageKind,
    baseName: nested.state?.baseName ?? nested.name
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

  #scopedToken(token, path = []) {
    const normalizedPath = normalizeStoragePath(path);
    if (!normalizedPath.length) return token;
    const root = resolveDocument(token);
    const rootSnapshot = storageSnapshotForToken(root);
    const nested = resolveStorageContainerPath(rootSnapshot, normalizedPath);
    if (!nested) throw new Error("Вложенный контейнер по указанному пути не найден.");
    const service = this;
    return {
      id: `${cleanId(root?.id)}:${normalizedPath.join("/")}`,
      uuid: `${cleanId(root?.uuid)}#${normalizedPath.join("/")}`,
      name: nested.name,
      actor: root?.actor,
      __storageRoot: root,
      __storagePath: normalizedPath,
      getFlag(scope, key) {
        if (scope === MODULE_ID && key === STORAGE_TOKEN_FLAG) {
          return {
            ...clone(nested.state),
            containerId: nested.containerId,
            storageKind: nested.storageKind
          };
        }
        return undefined;
      },
      async update(patch = {}) {
        const nextState = buildStorageTokenState(
          patch[`flags.${MODULE_ID}.${STORAGE_TOKEN_FLAG}`] ?? nested.state
        );
        const nextRoot = updateStorageContainerPath(rootSnapshot, normalizedPath, (current) => ({
          ...current,
          name: nextState.baseName,
          img: cleanId(nextState.textures?.[nextState.displayMode] ?? current.img),
          state: nextState,
          presentation: {
            ...(clone(current.presentation) ?? {}),
            texture: cleanId(nextState.textures?.[nextState.displayMode] ?? current.presentation?.texture ?? current.img)
          }
        }));
        await root.update({
          [`flags.${MODULE_ID}.${STORAGE_TOKEN_FLAG}`]: nextRoot.state
        });
        globalThis.Hooks?.callAll?.(STORAGE_UPDATED_HOOK, root, clone(nextRoot.state));
        return service.#scopedToken(root, normalizedPath);
      }
    };
  }

  async #write(token, state) {
    const document = resolveDocument(token);
    if (typeof document?.update !== "function") {
      throw new TypeError("Storage token must support update.");
    }
    const normalized = buildStorageTokenState({
      ...state,
      containerId: cleanId(state?.containerId) || storageContainerIdForDocument(document, state),
      storageKind: storageKindForDocument(document, state)
    });
    const patch = {
      ["flags." + MODULE_ID + "." + STORAGE_TOKEN_FLAG]: normalized,
      name: deriveStorageDisplayName(normalized)
    };
    const texturePath = normalized.textures?.[normalized.displayMode];
    if (texturePath) {
      patch["texture.src"] = texturePath;
    }
    await document.update(patch);
    if (!document?.__storageRoot) {
      globalThis.Hooks?.callAll?.(STORAGE_UPDATED_HOOK, document, clone(normalized));
    }
    return clone(normalized);
  }

  async configure(token, config = {}, { path = [] } = {}) {
    token = this.#scopedToken(token, path);
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
    token = this.#scopedToken(token, context?.path);
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
    token = this.#scopedToken(token, request?.path);
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
    if (isStorageJournalRow(row)) {
      throw new Error("Ссылку на журнал нельзя забрать из хранилища.");
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

  async depositRow(token, row, { quantity, path = [] } = {}) {
    token = this.#scopedToken(token, path);
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError("Предмет для добавления в хранилище должен быть объектом.");
    }
    const current = readStorageState(token);
    const amount = requirePositiveQuantity(quantity ?? row.quantity ?? row.itemData?.system?.quantity);
    const journalRow = isStorageJournalRow(row);
    if (journalRow && amount !== 1) {
      throw new Error("Ссылку на журнал можно добавить только целиком в количестве 1.");
    }
    if (isStorageContainerRow(row) && amount !== 1) {
      throw new Error("Контейнер можно переносить только целиком.");
    }
    if (isStorageContainerRow(row)) {
      const root = token?.__storageRoot ?? resolveDocument(token);
      const targetIds = collectStorageContainerIds(storageSnapshotForToken(root));
      const incomingIds = collectStorageContainerIds(row.container);
      if ([...incomingIds].some((containerId) => targetIds.has(containerId))) {
        throw new Error("Нельзя поместить контейнер в самого себя или создать цикл вложения.");
      }
    }
    const stackKey = journalRow ? "" : cleanStackKey(row.stackKey ?? row.sourceId);
    const claimedRowIds = new Set(current.claimedRowIds);

    const manualMerge = journalRow
      ? { rows: normalizeRows(current.manualRows), merged: false, rowId: "" }
      : mergeDepositIntoRows(
          current.manualRows,
          claimedRowIds,
          row,
          stackKey,
          amount
        );
    let manualRows = manualMerge.rows;
    let generatedRows = normalizeRows(current.generatedRows);
    let merged = manualMerge.merged;
    let rowId = manualMerge.rowId;

    if (!merged && !journalRow) {
      const generatedMerge = mergeDepositIntoRows(
        generatedRows,
        claimedRowIds,
        row,
        stackKey,
        amount
      );
      generatedRows = generatedMerge.rows;
      merged = generatedMerge.merged;
      rowId = generatedMerge.rowId;
    }

    if (!merged) {
      const deposited = journalRow ? clone(row) : setStorageRowQuantity(row, amount);
      if (journalRow) {
        deposited.rowKind = "journal";
        deposited.sourceType = "journal";
        deposited.quantity = 1;
        delete deposited.itemData;
      }
      deposited.stackKey = stackKey;
      const requestedRowId = String(deposited.rowId ?? "").trim();
      deposited.rowId = requestedRowId && !claimedRowIds.has(requestedRowId)
        ? requestedRowId
        : createDepositRowId();
      rowId = deposited.rowId;
      manualRows.push(deposited);
    }

    const state = await this.#write(token, {
      ...current,
      manualRows,
      generatedRows,
      state: "opened",
      displayMode: "opened"
    });
    return { changed: true, merged, rowId, quantity: amount, state };
  }

  async #mutateEditableRow(token, rowId, mutate, { path = [] } = {}) {
    token = this.#scopedToken(token, path);
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

  async updateRowQuantity(token, rowId, quantity, { path = [] } = {}) {
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Количество должно быть целым числом не меньше 1.");
    return this.#mutateEditableRow(token, rowId, (row) => {
      if (isStorageJournalRow(row)) {
        throw new Error("Количество ссылки на журнал изменять нельзя.");
      }
      row.quantity = amount;
      row.itemData ??= {};
      row.itemData.system ??= {};
      row.itemData.system.quantity = amount;
      return row;
    }, { path });
  }

  async updateRowDurability(token, rowId, durability, { path = [] } = {}) {
    if (!durability || typeof durability !== "object") {
      throw new TypeError("Прочность предмета должна быть объектом.");
    }
    return this.#mutateEditableRow(token, rowId, (row) => {
      row.itemData ??= {};
      row.itemData.flags ??= {};
      row.itemData.flags[MODULE_ID] ??= {};
      row.itemData.flags[MODULE_ID].durability = clone(durability);
      return row;
    }, { path });
  }

  async deleteRow(token, rowId, { path = [] } = {}) {
    return this.#mutateEditableRow(token, rowId, () => null, { path });
  }

  async setTextureMode(token, mode, { path = [] } = {}) {
    token = this.#scopedToken(token, path);
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
