import { MODULE_ID } from "../constants.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const COIN_KEYS = ["pp", "gp", "sp", "cp"];
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
    position: { width: 720, height: 680 }
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
    this.configure = options.configure === true;
    this.snapshot = null;
    this.renderListenersAbortController = null;
  }

  get id() {
    return `${MODULE_ID}-storage-${this.tokenUuid.replace(/[^a-z0-9_-]/giu, "-")}`;
  }

  async _prepareContext() {
    this.snapshot = await this.moduleApi.getStorageSnapshot(this.tokenUuid);
    const canManage = globalThis.game?.user?.isGM === true;
    const configurationEnabled = canManage && this.configure;
    const templates = configurationEnabled && typeof this.moduleApi.listLootgenTemplates === "function"
      ? this.moduleApi.listLootgenTemplates()
      : [];
    const coins = normalizeCoins(this.snapshot?.coins);
    const hasTextureSet = TEXTURE_MODES.every(({ mode }) => clean(this.snapshot?.textures?.[mode]));
    const rows = (this.snapshot?.rows ?? []).map((row) => ({
      ...clone(row),
      rowId: clean(row.rowId),
      name: clean(row.name ?? row.itemData?.name) || "Предмет",
      img: clean(row.img ?? row.itemData?.img),
      quantity: Math.max(1, Number(row.quantity ?? 1)),
      typeLabel: clean(row.typeLabel ?? row.itemData?.type) || "Предмет"
    }));

    return {
      tokenUuid: this.tokenUuid,
      name: clean(this.snapshot?.name) || "Хранилище",
      state: clean(this.snapshot?.state) || "unopened",
      isEmpty: this.snapshot?.state === "empty",
      canManage,
      rows,
      hasRows: rows.length > 0,
      coins,
      coinsLabel: coinsLabel(coins),
      hasCoins: COIN_KEYS.some((key) => coins[key] > 0),
      configuration: {
        enabled: configurationEnabled,
        baseName: clean(this.snapshot?.baseName) || clean(this.snapshot?.name) || "Хранилище",
        canAddManualItems: configurationEnabled,
        templateOptions: configurationEnabled ? clone(templates) : [],
        selectedTemplateName: clean(this.snapshot?.template?.name),
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

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const root = getAppElement(this);
    if (!root) return;
    const listenerOptions = { signal: this.renderListenersAbortController.signal };
    root.addEventListener("click", (event) => this.#onClick(event), listenerOptions);
    root.addEventListener("drop", (event) => this.#onDrop(event), listenerOptions);
    root.addEventListener("dragover", (event) => {
      if (event.target?.closest?.("[data-storage-dropzone]")) event.preventDefault();
    }, listenerOptions);
  }

  async #refresh() {
    await this.render({ force: false });
  }

  async #onClick(event) {
    const control = event.target?.closest?.("[data-action]");
    if (!control) return;
    const action = clean(control.dataset.action);
    const rowId = clean(control.dataset.rowId);
    try {
      if (action === "storage-claim-self" || action === "storage-claim-party") {
        await this.moduleApi.claimStorageRow(
          this.tokenUuid,
          rowId,
          action.endsWith("self") ? "self" : "party",
          mutationId("storage-row")
        );
      }
      else if (action === "storage-claim-coins-self" || action === "storage-claim-coins-party") {
        await this.moduleApi.claimStorageCoins(
          this.tokenUuid,
          action.endsWith("self") ? "self" : "party",
          mutationId("storage-coins")
        );
      }
      else if (action === "storage-save-config") {
        const form = control.closest("form");
        await this.moduleApi.configureStorageToken(this.tokenUuid, {
          baseName: clean(form?.elements?.baseName?.value),
          templateId: clean(form?.elements?.templateId?.value)
        });
      }
      else if (action === "storage-remove-manual-item") {
        await this.moduleApi.removeManualStorageItem(this.tokenUuid, rowId);
      }
      else if (action === "storage-reset") {
        await this.moduleApi.resetStorageToken(this.tokenUuid);
      }
      else if (action === "storage-set-texture") {
        await this.moduleApi.setStorageTextureMode(this.tokenUuid, clean(control.dataset.mode));
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

  async #onDrop(event) {
    if (!this.configure || globalThis.game?.user?.isGM !== true || !event.target?.closest?.("[data-storage-dropzone]")) return;
    event.preventDefault();
    try {
      const data = globalThis.TextEditor?.getDragEventData?.(event)
        ?? JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
      const uuid = clean(data?.uuid);
      if (!uuid || !["Item", "ItemUUID"].includes(clean(data?.type))) {
        throw new Error("Перетащите предмет из листа или компендиума.");
      }
      await this.moduleApi.addManualStorageItem(this.tokenUuid, uuid);
      await this.#refresh();
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to add a manual storage item.`, error);
      globalThis.ui?.notifications?.error(error?.message ?? "Не удалось добавить предмет.");
    }
  }
}
