import { MODULE_ID } from "../constants.js";
import { getAppElement } from "../ui.js";
import { placeTokenOverlay, storageTokenViewportBounds } from "./storage-token-overlay.js";
import { openStorageJournalViewer } from "./storage-journal-viewer.js?v=1.4.217-journal-record-items";
import { formatDurabilityItemName } from "../data/durability-item-presentation.js?v=1.4.154-broken-item-name";
import { isDurabilityEligible } from "../data/durability-rules.js?v=1.4.200-storage-broken-presentation";
import {
  buildStorageDragData,
  parseStorageDragData,
  promptStorageTransferQuantity,
  storageGridColumns
} from "./storage-transfer-ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const COIN_KEYS = ["pp", "gp", "sp", "cp"];
const STORAGE_TRANSFER_TYPES = new Set(["text/plain", "text", "application/json"]);
const TEXTURE_MODES = Object.freeze([
  Object.freeze({ mode: "unopened", number: "1", label: "Закрытый" }),
  Object.freeze({ mode: "opened", number: "2", label: "Открытый" }),
  Object.freeze({ mode: "empty", number: "3", label: "Пустой" })
]);

function clean(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return globalThis.foundry?.utils?.deepClone
    ? globalThis.foundry.utils.deepClone(value)
    : JSON.parse(JSON.stringify(value));
}

function mutationId(prefix) {
  const random = globalThis.foundry?.utils?.randomID?.() ?? globalThis.randomID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}

export async function promptStorageClaimAllDestination(
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
) {
  if (typeof DialogV2?.wait !== "function") {
    throw new Error("Диалог выбора назначения добычи недоступен.");
  }
  const destination = await DialogV2.wait({
    window: { title: "Забрать всё" },
    content: "<p>Куда перенести содержимое хранилища?</p>",
    buttons: [
      {
        action: "self",
        label: "Забрать всё себе",
        icon: "fa-solid fa-user",
        default: true,
        callback: () => "self"
      },
      {
        action: "party",
        label: "Забрать в инвентарь",
        icon: "fa-solid fa-box-open",
        callback: () => "party"
      },
      { action: "cancel", label: "Отмена", callback: () => null }
    ],
    rejectClose: false,
    close: () => null
  });
  return destination === "self" || destination === "party" ? destination : null;
}

function dragEventData(event) {
  const foundryData = globalThis.TextEditor?.getDragEventData?.(event);
  if (foundryData != null) return foundryData;
  try {
    return JSON.parse(event?.dataTransfer?.getData?.("text/plain") || "{}");
  }
  catch (_error) {
    return null;
  }
}

function isSupportedStorageWindowDrop(data) {
  if (parseStorageDragData(data)) return true;
  return ["Item", "ItemUUID", "JournalEntry"].includes(clean(data?.type)) && Boolean(clean(data?.uuid));
}

function isEditableDropTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function hasStorageTransferType(dataTransfer) {
  return Array.from(dataTransfer?.types ?? []).some((type) => STORAGE_TRANSFER_TYPES.has(clean(type).toLowerCase()));
}

function normalizeCoins(coins = {}) {
  return Object.fromEntries(COIN_KEYS.map((key) => [key, Math.max(0, Math.trunc(Number(coins?.[key] ?? 0))) ]));
}

function coinsLabel(coins = {}) {
  const normalized = normalizeCoins(coins);
  const labels = { pp: "пм", gp: "зм", sp: "см", cp: "мм" };
  const parts = COIN_KEYS.filter((key) => normalized[key] > 0).map((key) => `${normalized[key]} ${labels[key]}`);
  return parts.length ? parts.join(" ") : "0 мм";
}

export class StorageApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-storage-app"],
    window: {
      title: "Хранилище",
      icon: "fa-solid fa-box-open",
      resizable: true
    },
    position: { width: 286, height: "auto" }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/storage-app.hbs`
    }
  };

  constructor(moduleApi, tokenUuid, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.tokenUuid = clean(tokenUuid);
    this.characterTokenUuid = clean(options.characterTokenUuid);
    this.path = (Array.isArray(options.path) ? options.path : []).map(clean).filter(Boolean).slice(0, 8);
    this.pathNames = (Array.isArray(options.pathNames) ? options.pathNames : []).map(clean).filter(Boolean).slice(0, 8);
    this.rootName = clean(options.rootName);
    this.configure = options.configure === true;
    this.openStorageJournalViewer = options.openStorageJournalViewer ?? openStorageJournalViewer;
    this.anchorRequested = options.anchorToToken === true;
    this.anchorDetached = false;
    this.snapshot = null;
    this.snapshotRequest = 0;
    this.activeRowId = "";
    this.claimAllPending = false;
    this.renderListenersAbortController = null;
    this.liveHookSubscriptions = [];
  }

  get id() {
    return `${MODULE_ID}-storage-${this.tokenUuid.replace(/[^a-z0-9_-]/giu, "-")}`;
  }

  get title() {
    return clean(this.snapshot?.name) || clean(this.options?.window?.title) || "Сундук";
  }

  #pathRequest() {
    return {
      ...(this.path.length ? { path: [...this.path] } : {}),
      ...(this.characterTokenUuid ? { characterTokenUuid: this.characterTokenUuid } : {})
    };
  }

  async #requestSnapshot() {
    while (true) {
      try {
        return await this.moduleApi.getStorageSnapshot(this.tokenUuid, this.#pathRequest());
      }
      catch (error) {
        if (!this.path.length) throw error;
        this.path.pop();
        this.pathNames.pop();
        this.activeRowId = "";
      }
    }
  }

  async _prepareContext() {
    if (!this.snapshot) {
      const request = ++this.snapshotRequest;
      const snapshot = await this.#requestSnapshot();
      if (request === this.snapshotRequest) this.snapshot = snapshot;
    }
    const windowTitle = clean(this.snapshot?.name) || "Сундук";
    if (!this.path.length) this.rootName = windowTitle;
    this.options ??= {};
    this.options.window ??= {};
    this.options.window.title = windowTitle;
    const canManage = globalThis.game?.user?.isGM === true;
    const configurationEnabled = canManage && this.configure;
    const templates = configurationEnabled && typeof this.moduleApi.listLootgenTemplates === "function"
      ? this.moduleApi.listLootgenTemplates()
      : [];
    const coins = normalizeCoins(this.snapshot?.coins);
    const hasTextureSet = TEXTURE_MODES.every(({ mode }) => clean(this.snapshot?.textures?.[mode]));
    const snapshotRows = this.snapshot?.rows ?? [];
    const hasCoins = COIN_KEYS.some((key) => coins[key] > 0);
    const gridItemCount = snapshotRows.length + (hasCoins ? 1 : 0);
    const gridColumns = storageGridColumns(gridItemCount);
    const rows = snapshotRows.map((row) => {
      const isJournal = row.rowKind === "journal";
      const isContainer = row.rowKind === "container" && Boolean(row.container);
      const durability = row.itemData?.flags?.[MODULE_ID]?.durability;
      const durabilityState = clean(durability?.state).toLowerCase();
      const hasToggleableDurability = durability?.version === 1
        && durability?.eligible === true
        && ["intact", "broken"].includes(durabilityState)
        && Number.isFinite(Number(durability?.hp?.max))
        && Number(durability.hp.max) > 0;
      const canToggleBroken = configurationEnabled && (
        hasToggleableDurability
        || (durability == null && isDurabilityEligible(row.itemData))
      );
      const itemName = clean(row.name ?? row.itemData?.name) || "Предмет";
      const displayName = isJournal && row.journalRead === true
        ? `${itemName} (прочитано)`
        : formatDurabilityItemName(itemName, row.itemData?.flags?.[MODULE_ID]?.durability);
      return {
        ...clone(row),
        rowId: clean(row.rowId),
        name: displayName,
        img: clean(row.img ?? row.itemData?.img),
        quantity: Math.max(1, Number(row.quantity ?? 1)),
        typeLabel: clean(row.typeLabel ?? row.itemData?.type) || "Предмет",
        sourceType: clean(row.sourceType),
        sourceId: clean(row.sourceId),
        isJournal,
        canDrag: !isJournal,
        canClaim: !isJournal,
        canOpenSource: !isJournal && Boolean(clean(row.sourceId)),
        isContainer,
        primaryAction: isContainer ? "storage-open-container" : "storage-toggle-row",
        canEdit: configurationEnabled && !isJournal,
        canToggleBroken,
        broken: durabilityState === "broken",
        canDelete: isJournal ? canManage : configurationEnabled,
        active: this.activeRowId === clean(row.rowId),
        showQuantity: !isJournal && !isContainer && Math.max(1, Number(row.quantity ?? 1)) > 1
      };
    });
    const validPopoverIds = new Set(rows.map((row) => row.rowId));
    if (hasCoins) validPopoverIds.add("__coins");
    if (this.activeRowId && !validPopoverIds.has(this.activeRowId)) this.activeRowId = "";
    const selectedRow = rows.find((row) => row.rowId === this.activeRowId) ?? null;
    const selectedIndex = this.activeRowId === "__coins"
      ? rows.length
      : rows.findIndex((row) => row.rowId === this.activeRowId);
    const selectedColumn = selectedIndex >= 0 ? selectedIndex % gridColumns : 0;
    const popoverPlacement = selectedIndex >= 0 ? {
      anchorColumn: selectedColumn,
      anchorRow: Math.floor(selectedIndex / gridColumns),
      popoverAlignment: selectedColumn === 0
        ? "left"
        : selectedColumn === gridColumns - 1 ? "right" : "center"
    } : {};
    const activePopover = this.activeRowId === "__coins"
      ? {
          isCoins: true,
          anchorRowId: "__coins",
          name: coinsLabel(coins),
          ...popoverPlacement
        }
      : selectedRow ? { ...selectedRow, anchorRowId: selectedRow.rowId, ...popoverPlacement } : null;
    const breadcrumbs = [
      { index: 0, name: this.rootName || "Сундук" },
      ...this.path.map((rowId, index) => ({
        index: index + 1,
        rowId,
        name: clean(this.pathNames[index]) || `Контейнер ${index + 1}`
      }))
    ].map((entry, index, values) => ({ ...entry, current: index === values.length - 1 }));

    return {
      tokenUuid: this.tokenUuid,
      name: windowTitle,
      state: clean(this.snapshot?.state) || "unopened",
      isEmpty: this.snapshot?.state === "empty",
      canManage,
      rows,
      activePopover,
      breadcrumbs,
      hasBreadcrumbs: breadcrumbs.length > 1,
      hasRows: rows.length > 0,
      hasGridItems: gridItemCount > 0,
      canClaimAll: !this.configure && (rows.some((row) => row.canClaim) || hasCoins),
      claimAllPending: this.claimAllPending,
      gridColumns,
      coins,
      coinsLabel: coinsLabel(coins),
      hasCoins,
      coinsExpanded: this.activeRowId === "__coins",
      configuration: {
        enabled: configurationEnabled,
        baseName: clean(this.snapshot?.baseName) || clean(this.snapshot?.name) || "Хранилище",
        canAddManualItems: configurationEnabled,
        templateOptions: configurationEnabled ? clone(templates) : [],
        selectedTemplateName: clean(this.snapshot?.template?.name),
        mixGeneratedLoot: this.snapshot?.mixGeneratedLoot === true,
        triggerActiveCount: Math.max(0, Math.trunc(Number(this.snapshot?.triggerActiveCount) || 0)),
        manualRows: configurationEnabled ? clone(this.snapshot?.manualRows ?? []) : [],
        canReset: configurationEnabled && ["opened", "empty"].includes(this.snapshot?.state),
        canSetTexture: configurationEnabled && hasTextureSet,
        displayMode: configurationEnabled && hasTextureSet ? clean(this.snapshot?.displayMode) : "",
        textureModes: configurationEnabled && hasTextureSet
          ? TEXTURE_MODES.map((entry) => ({
              ...entry,
              active: this.snapshot?.displayMode === entry.mode
            }))
          : []
      }
    };
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    this.#registerLiveHooks();
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const root = getAppElement(this);
    if (!root) return;
    const windowTitle = clean(context?.name) || this.title;
    const windowTitleElement = root.querySelector?.(".window-title");
    if (windowTitleElement) windowTitleElement.textContent = windowTitle;
    const listenerOptions = { signal: this.renderListenersAbortController.signal };
    root.addEventListener("click", (event) => this.#onClick(event), listenerOptions);
    root.addEventListener("change", (event) => this.#onStorageChange(event), listenerOptions);
    root.addEventListener("contextmenu", (event) => this.#onContextMenu(event), listenerOptions);
    root.addEventListener("drop", (event) => this.#onDrop(event), listenerOptions);
    root.addEventListener("dragstart", (event) => this.#onDragStart(event), listenerOptions);
    root.addEventListener("dragover", (event) => {
      if (this.#acceptsDropTarget(event) && hasStorageTransferType(event.dataTransfer)) {
        event.preventDefault();
      }
    }, listenerOptions);
    globalThis.document?.addEventListener?.("click", (event) => {
      if (!this.activeRowId || root.contains?.(event.target)) return;
      this.activeRowId = "";
      void this.#renderCurrent();
    }, listenerOptions);
    globalThis.document?.addEventListener?.("keydown", (event) => {
      if (event.key !== "Escape" || !this.activeRowId) return;
      this.activeRowId = "";
      void this.#renderCurrent();
    }, listenerOptions);
    const gridCount = (this.snapshot?.rows?.length ?? 0)
      + (COIN_KEYS.some((key) => Number(this.snapshot?.coins?.[key] ?? 0) > 0) ? 1 : 0);
    const columns = storageGridColumns(gridCount);
    root.style?.setProperty?.("--rm-storage-columns", String(columns));
    const viewportWidth = Math.max(320, Number(globalThis.innerWidth) || 1920);
    const width = this.configure ? 430 : Math.min(viewportWidth - 32, Math.max(286, (columns * 80) + 46));
    this.setPosition?.({ width });
    root.querySelector?.(".window-header")?.addEventListener?.("pointerdown", () => this.#detachAnchor(), listenerOptions);
    if (this.anchorRequested && !this.anchorDetached) {
      const schedule = globalThis.requestAnimationFrame ?? ((callback) => globalThis.setTimeout?.(callback, 0));
      schedule?.(() => this.repositionToToken());
    }
  }

  async #onStorageChange(event) {
    const input = event.target;
    if (input?.matches?.("[data-storage-broken]")) {
      const rowId = clean(input.dataset?.rowId);
      try {
        await this.moduleApi.setStorageRowBroken(this.tokenUuid, rowId, input.checked === true, this.#pathRequest());
        await this.#refresh();
      }
      catch (error) {
        console.error(`${MODULE_ID} | Storage broken-state update failed.`, error);
        globalThis.ui?.notifications?.error(error?.message ?? "Не удалось изменить состояние предмета.");
      }
      return;
    }
    if (!input?.matches?.("[data-storage-quantity]")) return;
    const rowId = clean(input.dataset?.rowId);
    const quantity = Number(input.value);
    try {
      await this.moduleApi.updateStorageRowQuantity(this.tokenUuid, rowId, quantity, this.#pathRequest());
      await this.#refresh();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Storage quantity update failed.`, error);
      globalThis.ui?.notifications?.error(error?.message ?? "Не удалось изменить количество предмета.");
    }
  }

  requestTokenAnchor() {
    this.anchorRequested = true;
    this.anchorDetached = false;
  }

  async repositionToToken() {
    if (!this.anchorRequested || this.anchorDetached) return false;
    const document = await globalThis.fromUuid?.(this.tokenUuid);
    const root = getAppElement(this);
    const bounds = storageTokenViewportBounds(document?.object ?? document);
    if (!root || !bounds) return false;
    const rect = root.getBoundingClientRect?.() ?? { width: 430, height: 560 };
    const position = placeTokenOverlay({
      tokenBounds: bounds,
      overlaySize: rect,
      viewport: { width: globalThis.innerWidth, height: globalThis.innerHeight },
      gap: 14,
      margin: 16
    });
    this.setPosition?.({ left: position.left, top: position.top });
    root.classList?.add?.("is-token-anchored");
    root.dataset.anchorPlacement = position.placement;
    root.style?.setProperty?.("--rm-storage-pointer-left", `${position.pointerLeft}px`);
    return true;
  }

  #detachAnchor() {
    this.anchorDetached = true;
    this.anchorRequested = false;
    const root = getAppElement(this);
    root?.classList?.remove?.("is-token-anchored");
    if (root?.dataset) delete root.dataset.anchorPlacement;
  }

  #matchesToken(document) {
    return clean(document?.uuid ?? document?.document?.uuid) === this.tokenUuid;
  }

  #registerLiveHooks() {
    const Hooks = globalThis.Hooks;
    if (this.liveHookSubscriptions.length || typeof Hooks?.on !== "function") return;
    const subscribe = (name, callback) => {
      const id = Hooks.on(name, callback);
      this.liveHookSubscriptions.push({ name, id });
    };
    subscribe("updateToken", (token) => (
      this.#matchesToken(token) ? this.scheduleSnapshotRefresh() : undefined
    ));
    subscribe("deleteToken", (token) => (
      this.#matchesToken(token) ? this.close?.() : undefined
    ));
    subscribe(`${MODULE_ID}.storageUpdated`, (token) => (
      this.#matchesToken(token) ? this.scheduleSnapshotRefresh() : undefined
    ));
  }

  async _onClose(options) {
    this.snapshotRequest += 1;
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    const Hooks = globalThis.Hooks;
    for (const { name, id } of this.liveHookSubscriptions.splice(0)) {
      Hooks?.off?.(name, id);
    }
    return super._onClose?.(options);
  }

  async scheduleSnapshotRefresh() {
    const request = ++this.snapshotRequest;
    const snapshot = await this.#requestSnapshot();
    if (request !== this.snapshotRequest) return false;
    this.snapshot = snapshot;
    await this.render({ force: true });
    return true;
  }

  async #renderCurrent() {
    await this.render({ force: true });
  }

  async #refresh() {
    await this.scheduleSnapshotRefresh();
  }

  #rowById(rowId) {
    return (this.snapshot?.rows ?? []).find((row) => clean(row?.rowId) === clean(rowId)) ?? null;
  }

  async #claimRow(rowId, destination) {
    const row = this.#rowById(rowId);
    if (!row) throw new Error("Предмет хранилища уже недоступен.");
    if (row.rowKind === "journal") throw new Error("Записи журнала нельзя перемещать.");
    const available = Math.max(1, Math.trunc(Number(row.quantity ?? 1)) || 1);
    const quantity = await promptStorageTransferQuantity(available);
    if (quantity === null) return false;
    return this.moduleApi.claimStorageRow(
      this.tokenUuid,
      rowId,
      destination,
      mutationId("storage-row"),
      { quantity, ...this.#pathRequest() }
    );
  }

  async #claimAll(destination) {
    return this.moduleApi.claimStorageAll(
      this.tokenUuid,
      destination,
      mutationId("storage-all"),
      this.#pathRequest()
    );
  }

  async #promptAndClaimAll() {
    if (this.claimAllPending) return null;
    this.claimAllPending = true;
    let result = null;
    try {
      await this.#renderCurrent();
      const destination = await promptStorageClaimAllDestination();
      if (!destination) return null;
      result = await this.#claimAll(destination);
      return result;
    }
    finally {
      this.claimAllPending = false;
      if (!result) await this.#renderCurrent();
    }
  }

  async #openContainer(rowId) {
    const row = this.#rowById(rowId);
    if (!row || row.rowKind !== "container" || !row.container) {
      throw new Error("Вложенный контейнер уже недоступен.");
    }
    this.path.push(clean(row.rowId));
    this.pathNames.push(clean(row.name) || "Контейнер");
    this.activeRowId = "";
    this.snapshot = null;
    await this.scheduleSnapshotRefresh();
  }

  async #openRowSource(rowId) {
    const row = this.#rowById(rowId);
    if (!row) throw new Error("Предмет хранилища уже недоступен.");
    if (row.rowKind === "journal") throw new Error("Запись журнала доступна только для чтения.");
    const sourceId = clean(row.sourceId);
    if (sourceId.includes(".") && typeof globalThis.fromUuid === "function") {
      const document = await globalThis.fromUuid(sourceId);
      if (document?.sheet?.render) {
        await document.sheet.render(true);
        return;
      }
    }
    if (typeof this.moduleApi.openTradeEntry === "function" && sourceId) {
      await this.moduleApi.openTradeEntry(clean(row.sourceType), sourceId, clean(row.name));
      return;
    }
    throw new Error("Исходный документ предмета не найден.");
  }

  async #readJournal(rowId) {
    const row = this.#rowById(rowId);
    if (!row || row.rowKind !== "journal") throw new Error("Запись журнала уже недоступна.");
    const snapshot = await this.moduleApi.readStorageJournal(this.tokenUuid, rowId, this.#pathRequest());
    const recordMutationId = mutationId("storage-journal-record");
    await this.openStorageJournalViewer(snapshot, {
      onRecord: () => this.moduleApi.recordStorageJournal(
        this.tokenUuid,
        rowId,
        recordMutationId,
        this.#pathRequest()
      )
    });
    await this.#refresh();
  }

  async #onClick(event) {
    const control = event.target?.closest?.("[data-action]");
    if (!control) return;
    const action = clean(control.dataset.action);
    const rowId = clean(control.dataset.rowId);
    event.preventDefault?.();
    try {
      if (action === "storage-close-popover") {
        this.activeRowId = "";
        await this.#renderCurrent();
        return;
      }
      else if (action === "storage-toggle-row") {
        this.activeRowId = this.activeRowId === rowId ? "" : rowId;
        await this.#renderCurrent();
        return;
      }
      else if (action === "storage-toggle-coins") {
        this.activeRowId = this.activeRowId === "__coins" ? "" : "__coins";
        await this.#renderCurrent();
        return;
      }
      else if (action === "storage-open-item") {
        await this.#openRowSource(rowId);
        return;
      }
      else if (action === "storage-read-journal") {
        await this.#readJournal(rowId);
        return;
      }
      else if (action === "storage-open-container") {
        await this.#openContainer(rowId);
        return;
      }
      else if (action === "storage-breadcrumb") {
        const index = Math.max(0, Math.trunc(Number(control.dataset.index) || 0));
        this.path = this.path.slice(0, index);
        this.pathNames = this.pathNames.slice(0, index);
        this.activeRowId = "";
        this.snapshot = null;
        await this.scheduleSnapshotRefresh();
        return;
      }
      else if (action === "storage-claim-self" || action === "storage-claim-party") {
        const result = await this.#claimRow(rowId, action.endsWith("self") ? "self" : "party");
        if (!result) return;
        this.activeRowId = "";
        if (result.sourceDeleted === true) {
          await this.close?.();
          return;
        }
      }
      else if (action === "storage-claim-coins-self" || action === "storage-claim-coins-party") {
        const result = await this.moduleApi.claimStorageCoins(
          this.tokenUuid,
          action.endsWith("self") ? "self" : "party",
          mutationId("storage-coins"),
          this.#pathRequest()
        );
        if (result?.sourceDeleted === true) {
          await this.close?.();
          return;
        }
      }
      else if (action === "storage-claim-all") {
        const result = await this.#promptAndClaimAll();
        if (!result) return;
        this.activeRowId = "";
        if (result?.sourceDeleted === true) {
          await this.close?.();
          return;
        }
      }
      else if (action === "storage-save-config") {
        const form = control.closest("form");
        await this.moduleApi.configureStorageToken(this.tokenUuid, {
          baseName: clean(form?.elements?.baseName?.value),
          templateId: clean(form?.elements?.templateId?.value),
          mixGeneratedLoot: form?.elements?.mixGeneratedLoot?.checked === true
        }, this.#pathRequest());
      }
      else if (action === "storage-remove-manual-item") {
        await this.moduleApi.removeManualStorageItem(this.tokenUuid, rowId, this.#pathRequest());
      }
      else if (action === "storage-update-row") {
        const row = control.closest?.("[data-storage-row]");
        const quantity = Number(row?.querySelector?.("[data-storage-quantity]")?.value);
        await this.moduleApi.updateStorageRowQuantity(this.tokenUuid, rowId, quantity, this.#pathRequest());
      }
      else if (action === "storage-delete-row") {
        await this.moduleApi.deleteStorageRow(this.tokenUuid, rowId, this.#pathRequest());
        this.activeRowId = "";
      }
      else if (action === "storage-reset") {
        await this.moduleApi.resetStorageToken(this.tokenUuid, this.#pathRequest());
      }
      else if (action === "storage-open-trigger-editor") {
        await this.moduleApi.openStorageTriggerEditor(this.tokenUuid, this.#pathRequest());
        return;
      }
      else if (action === "storage-reset-triggers") {
        await this.moduleApi.resetStorageTriggerExecutions(this.tokenUuid, "", this.#pathRequest());
      }
      else if (action === "storage-set-texture") {
        await this.moduleApi.setStorageTextureMode(this.tokenUuid, clean(control.dataset.mode), this.#pathRequest());
      }
      else {
        return;
      }
      await this.#refresh();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Storage action failed.`, error);
      globalThis.ui?.notifications?.error(error?.message ?? "Не удалось выполнить действие хранилища.");
    }
  }

  async #onContextMenu(event) {
    const control = event.target?.closest?.(
      "[data-action='storage-toggle-row'], [data-action='storage-open-container'], [data-action='storage-toggle-coins']"
    );
    if (!control) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (clean(control.dataset.action) === "storage-open-container") {
      const rowId = clean(control.dataset.rowId);
      this.activeRowId = this.activeRowId === rowId ? "" : rowId;
      await this.#renderCurrent();
      return;
    }
    await this.#onClick({ target: control });
  }

  #onDragStart(event) {
    const source = event.target?.closest?.("[data-storage-row-drag]");
    if (!source || !event.dataTransfer) return;
    const row = this.#rowById(clean(source.dataset.rowId));
    if (!row || row.rowKind === "journal") return;
    const payload = buildStorageDragData({
      tokenUuid: this.tokenUuid,
      path: this.path,
      rowId: clean(row.rowId),
      quantity: Math.max(1, Math.trunc(Number(row.quantity ?? 1)) || 1)
    });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
  }

  #acceptsDropTarget(event) {
    if (isEditableDropTarget(event?.target)) return false;
    return this.configure !== true || Boolean(event?.target?.closest?.("[data-storage-dropzone]"));
  }

  #acceptsDrop(event, data) {
    return this.#acceptsDropTarget(event) && isSupportedStorageWindowDrop(data);
  }

  async #onDrop(event) {
    const data = dragEventData(event);
    if (!this.#acceptsDrop(event, data)) return;
    event.preventDefault();
    try {
      const inspected = await this.moduleApi.inspectStorageDepositSource(data);
      const quantity = await promptStorageTransferQuantity(inspected.available);
      if (quantity === null) return;
      await this.moduleApi.depositStorageItem(
        this.tokenUuid,
        inspected.source,
        quantity,
        mutationId("storage-window-deposit"),
        {
          ...this.#pathRequest(),
          ...(this.configure ? { administrative: true } : {})
        }
      );
      await this.#refresh();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to add a manual storage item.`, error);
      globalThis.ui?.notifications?.error(error?.message ?? "Не удалось добавить предмет.");
    }
  }
}
