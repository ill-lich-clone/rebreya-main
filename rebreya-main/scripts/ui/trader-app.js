import { MODULE_ID } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PRICE_IN_COPPER = {
  gp: 100,
  sp: 10,
  cp: 1
};

const COIN_LABELS = {
  gp: "зм",
  sp: "см",
  cp: "мм"
};

function toSafeId(value) {
  return Array.from(String(value ?? "trader"))
    .map((character) => character.charCodeAt(0).toString(16))
    .join("-");
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function formatCopper(value) {
  let remaining = Math.max(0, Math.round(toNumber(value, 0)));
  const parts = [];

  for (const [denomination, multiplier] of Object.entries(PRICE_IN_COPPER)) {
    const amount = Math.floor(remaining / multiplier);
    remaining -= amount * multiplier;
    if (amount > 0) {
      parts.push(`${amount} ${COIN_LABELS[denomination]}`);
    }
  }

  return parts.length ? parts.join(" ") : `0 ${COIN_LABELS.cp}`;
}

function getDialogRoot(html) {
  if (!html) {
    return null;
  }

  if (html instanceof HTMLElement) {
    return html;
  }

  if (html[0] instanceof HTMLElement) {
    return html[0];
  }

  return null;
}

async function promptTradeQuantity({ title, itemName, quantityAvailable, unitLabel, rows, confirmLabel }) {
  return new Promise((resolve) => {
    let settled = false;
    const maxQuantity = Math.max(1, Math.floor(toNumber(quantityAvailable, 1)));

    const renderRows = (quantity) => rows.map((row) => `
      <div class="rm-purchase-dialog__metric">
        <span>${foundry.utils.escapeHTML(row.label)}</span>
        <strong>${foundry.utils.escapeHTML(row.getValue(quantity))}</strong>
      </div>
    `).join("");

    const dialog = new Dialog({
      title,
      content: `
        <form class="rm-purchase-dialog">
          <div class="rm-purchase-dialog__summary">
            <strong>${foundry.utils.escapeHTML(itemName)}</strong>
            <p>${foundry.utils.escapeHTML(unitLabel)}</p>
            <p>Доступно: ${maxQuantity} шт.</p>
          </div>
          <div class="rm-field">
            <label for="rm-trade-quantity">Количество</label>
            <input
              id="rm-trade-quantity"
              type="number"
              min="1"
              max="${maxQuantity}"
              step="1"
              value="1"
              data-field="trade-quantity"
            >
          </div>
          <div class="rm-purchase-dialog__metrics" data-field="trade-metrics">
            ${renderRows(1)}
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: confirmLabel,
          callback: (html) => {
            const root = getDialogRoot(html);
            const quantityField = root?.querySelector("[data-field='trade-quantity']");
            const quantity = Math.max(1, Math.min(
              Math.floor(toNumber(quantityField?.value, 1)),
              maxQuantity
            ));
            settled = true;
            resolve(quantity);
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => {
            settled = true;
            resolve(null);
          }
        }
      },
      default: "confirm",
      render: (html) => {
        const root = getDialogRoot(html);
        const quantityField = root?.querySelector("[data-field='trade-quantity']");
        const metricsField = root?.querySelector("[data-field='trade-metrics']");
        if (!(quantityField instanceof HTMLInputElement) || !(metricsField instanceof HTMLElement)) {
          return;
        }

        const updateMetrics = () => {
          const quantity = Math.max(1, Math.min(
            Math.floor(toNumber(quantityField.value, 1)),
            maxQuantity
          ));
          quantityField.value = String(quantity);
          metricsField.innerHTML = renderRows(quantity);
        };

        quantityField.addEventListener("input", updateMetrics);
        quantityField.addEventListener("change", updateMetrics);
        updateMetrics();
        quantityField.focus();
        quantityField.select();
      },
      close: () => {
        if (!settled) {
          resolve(null);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog"]
    });

    dialog.render(true);
  });
}

async function promptPurchaseQuantity(item) {
  return promptTradeQuantity({
    title: `Покупка: ${item.name}`,
    itemName: item.name,
    quantityAvailable: item.quantity,
    unitLabel: `Цена за 1 шт.: ${item.finalPriceLabel}`,
    confirmLabel: "Купить",
    rows: [
      {
        label: "Итого",
        getValue: (quantity) => formatCopper(item.finalPriceCopper * quantity)
      }
    ]
  });
}

async function promptSaleQuantity(preview) {
  return promptTradeQuantity({
    title: `Продажа: ${preview.itemName}`,
    itemName: preview.itemName,
    quantityAvailable: preview.quantityAvailable,
    unitLabel: `Цена города за 1 шт.: ${preview.marketPriceLabel}`,
    confirmLabel: "Продать",
    rows: [
      {
        label: "Цена города",
        getValue: (quantity) => formatCopper(preview.grossOfferCopper * quantity)
      },
      {
        label: "Налог",
        getValue: (quantity) => formatCopper(preview.taxCopper * quantity)
      },
      {
        label: "К выплате",
        getValue: (quantity) => formatCopper(preview.netPayoutCopper * quantity)
      }
    ]
  });
}

function pickImagePath(currentPath = "") {
  return new Promise((resolve) => {
    if (typeof FilePicker !== "function") {
      resolve(null);
      return;
    }

    const picker = new FilePicker({
      type: "image",
      current: currentPath || "",
      callback: (path) => resolve(path)
    });

    picker.render(true);
    picker.browse(currentPath || "").catch(() => resolve(null));
  });
}

export class TraderApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-trader-app"],
    window: {
      title: "Лавка",
      icon: "fa-solid fa-store",
      resizable: true
    },
    position: {
      width: 1280,
      height: 860
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/trader-app.hbs`
    }
  };

  constructor(moduleApi, cityId, traderKey, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.cityId = cityId;
    this.traderKey = traderKey;
    this.selectedActorId = options.actorId ?? null;
    this.search = "";
    this.renderListenersAbortController = null;
  }

  get id() {
    return `${MODULE_ID}-trader-${toSafeId(`${this.cityId}-${this.traderKey}`)}`;
  }

  async _prepareContext() {
    try {
      const snapshot = await this.moduleApi.getTraderSnapshot(this.cityId, this.traderKey, {
        actorId: this.selectedActorId
      });
      this.selectedActorId = snapshot.customer?.id ?? null;
      const searchText = normalizeText(this.search);
      const inventory = (snapshot.inventory ?? []).filter((entry) => {
        if (!searchText) {
          return true;
        }

        return normalizeText([
          entry.name,
          entry.itemTypeLabel,
          entry.materialLabel,
          entry.description
        ].join(" ")).includes(searchText);
      });

      return {
        hasError: false,
        trader: snapshot,
        search: this.search,
        inventory,
        inventoryCount: inventory.length,
        emptyInventory: inventory.length === 0
      };
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to prepare trader app '${this.cityId}:${this.traderKey}'.`, error);
      return {
        hasError: true,
        errorMessage: "Не удалось подготовить данные лавки."
      };
    }
  }

  async #handleDroppedSale(event) {
    const dragData = TextEditor.getDragEventData(event);
    const preview = await this.moduleApi.createTraderSalePreview(this.cityId, this.traderKey, dragData);
    const quantity = await promptSaleQuantity(preview);
    if (!quantity) {
      return;
    }

    const result = await this.moduleApi.sellTraderItem(
      this.cityId,
      this.traderKey,
      preview,
      quantity
    );

    ui.notifications?.info(
      `${result.actorName} продаёт «${result.itemName}» (${result.sellQuantity} шт.) и получает ${result.netPayoutLabel}.`
    );
    await this.moduleApi.refreshOpenApps();
    bringAppToFront(this);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const listenerOptions = { signal: this.renderListenersAbortController.signal };

    bringAppToFront(this);

    const inventoryByKey = new Map((context.inventory ?? []).map((entry) => [entry.itemKey, entry]));

    element.querySelector("[data-action='search']")?.addEventListener("input", (event) => {
      this.search = event.currentTarget.value ?? "";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='select-customer']")?.addEventListener("change", (event) => {
      this.selectedActorId = event.currentTarget.value || null;
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='portrait-picker']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      const currentPath = event.currentTarget.dataset.currentPath ?? "";
      const nextPath = await pickImagePath(currentPath);
      if (typeof nextPath === "string") {
        await this.moduleApi.updateTraderMetadata(this.cityId, this.traderKey, {
          portrait: nextPath
        });
      }
    }, listenerOptions);

    element.querySelector("[data-action='description']")?.addEventListener("change", async (event) => {
      await this.moduleApi.updateTraderMetadata(this.cityId, this.traderKey, {
        description: event.currentTarget.value ?? ""
      });
    }, listenerOptions);

    element.querySelectorAll("[data-action='open-compendium-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const { sourceType, sourceId, sourceName } = event.currentTarget.dataset;
        try {
          const document = await this.moduleApi.openTradeEntry(sourceType, sourceId, sourceName);
          bringAppToFront(document?.sheet);
          window.setTimeout(() => bringAppToFront(document?.sheet), 40);
          window.setTimeout(() => bringAppToFront(document?.sheet), 140);
          if (!document) {
            ui.notifications?.warn("Не удалось найти запись предмета в компендиуме.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open compendium entry '${sourceType}:${sourceId}'.`, error);
          ui.notifications?.error("Не удалось открыть запись в компендиуме.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='buy-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const itemKey = event.currentTarget.dataset.itemKey;
        const item = inventoryByKey.get(itemKey);
        if (!item) {
          ui.notifications?.warn("Товар уже обновился. Попробуйте открыть лавку заново.");
          return;
        }

        const quantity = await promptPurchaseQuantity(item);
        if (!quantity) {
          return;
        }

        try {
          const result = await this.moduleApi.purchaseTraderItem(
            this.cityId,
            this.traderKey,
            itemKey,
            quantity,
            { actorId: this.selectedActorId }
          );
          ui.notifications?.info(`${result.actorName} покупает «${result.itemName}» за ${result.totalPriceLabel}.`);
          await this.moduleApi.refreshOpenApps();
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to buy item '${itemKey}'.`, error);
          ui.notifications?.error(error.message || "Не удалось совершить покупку.");
        }
      }, listenerOptions);
    });

    const sellZone = element.querySelector("[data-action='sale-dropzone']");
    if (sellZone) {
      sellZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        sellZone.classList.add("is-dragover");
      }, listenerOptions);

      sellZone.addEventListener("dragleave", () => {
        sellZone.classList.remove("is-dragover");
      }, listenerOptions);

      sellZone.addEventListener("drop", async (event) => {
        event.preventDefault();
        sellZone.classList.remove("is-dragover");

        try {
          await this.#handleDroppedSale(event);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to complete dropped sale.`, error);
          ui.notifications?.error(error.message || "Не удалось завершить продажу.");
        }
      }, listenerOptions);
    }
  }

  async _preClose(options) {
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    return super._preClose ? super._preClose(options) : undefined;
  }
}
