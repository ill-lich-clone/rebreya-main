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
  return Array.from(String(value ?? "trader-v2"))
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
            <label for="rm-trade-quantity-v2">Количество</label>
            <input
              id="rm-trade-quantity-v2"
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

async function promptPurchaseTarget(customerOptions, currentActorId = null) {
  const options = (customerOptions ?? [])
    .filter((option) => option?.value)
    .map((option) => ({
      value: String(option.value),
      label: String(option.label ?? option.value),
      selected: option.value === currentActorId || option.selected === true
    }));

  if (!options.length) {
    return currentActorId ?? null;
  }

  if (options.length === 1) {
    return options[0].value;
  }

  return new Promise((resolve) => {
    let settled = false;
    const selectedValue = options.find((option) => option.selected)?.value ?? options[0].value;
    const optionMarkup = options.map((option) => `
      <option value="${foundry.utils.escapeHTML(option.value)}" ${option.value === selectedValue ? "selected" : ""}>
        ${foundry.utils.escapeHTML(option.label)}
      </option>
    `).join("");

    const dialog = new Dialog({
      title: "Куда положить покупку",
      content: `
        <form class="rm-purchase-dialog">
          <div class="rm-purchase-dialog__summary">
            <strong>Выберите получателя</strong>
            <p>Можно купить в личный лист персонажа или в партийный склад.</p>
          </div>
          <div class="rm-field">
            <label for="rm-trade-target-v2">Получатель</label>
            <select id="rm-trade-target-v2" data-field="purchase-target">
              ${optionMarkup}
            </select>
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: "Продолжить",
          callback: (html) => {
            const root = getDialogRoot(html);
            const targetField = root?.querySelector("[data-field='purchase-target']");
            settled = true;
            resolve(targetField?.value ?? selectedValue);
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => {
            settled = true;
            resolve(undefined);
          }
        }
      },
      default: "confirm",
      close: () => {
        if (!settled) {
          resolve(undefined);
        }
      }
    }, {
      classes: ["rebreya-main", "rebreya-trader-dialog"]
    });

    dialog.render(true);
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
        label: "Оригинальная цена",
        getValue: (quantity) => formatCopper(toNumber(preview.basePriceGold, 0) * PRICE_IN_COPPER.gp * quantity)
      },
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

export class TraderAppV2 extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-trader-app", "rebreya-trader-app-v2"],
    window: {
      title: "Лавка (новое)",
      icon: "fa-solid fa-store",
      resizable: true
    },
    position: {
      width: 1680,
      height: 960
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/trader-app-v2.hbs`
    }
  };

  constructor(moduleApi, cityId, traderKey, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.cityId = cityId;
    this.traderKey = traderKey;
    this.selectedActorId = options.actorId ?? null;
    this.search = "";
    this.mode = "buy";
    this.selectedItemKey = "";
    this.purchaseQuantity = 1;
    this.usePartyFunds = options.usePartyFunds !== false;
    this.partyInventoryActorId = null;
    this.hasPlayedSequencerEntrance = false;
    this.isClosing = false;
    this.searchRenderTimeout = null;
    this.characterPokeTimeout = null;
    this.renderListenersAbortController = null;
  }

  get id() {
    return `${MODULE_ID}-trader-v2-${toSafeId(`${this.cityId}-${this.traderKey}`)}`;
  }

  async _prepareContext() {
    try {
      const snapshot = await this.moduleApi.getTraderSnapshot(this.cityId, this.traderKey, {
        actorId: this.usePartyFunds ? null : this.selectedActorId
      });
      this.partyInventoryActorId = snapshot.partyInventoryActorId ?? null;
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

      if (!inventory.length || !inventory.some((entry) => entry.itemKey === this.selectedItemKey)) {
        this.selectedItemKey = "";
      }

      const selectedItem = inventory.find((entry) => entry.itemKey === this.selectedItemKey) ?? null;
      if (selectedItem) {
        this.purchaseQuantity = Math.max(1, Math.min(
          Math.floor(toNumber(this.purchaseQuantity, 1)),
          Math.max(1, Math.floor(toNumber(selectedItem.quantity, 1)))
        ));
      }
      else {
        this.purchaseQuantity = 1;
      }

      const selectedQuote = selectedItem ? {
        quantity: this.purchaseQuantity,
        maxQuantity: Math.max(1, Math.floor(toNumber(selectedItem.quantity, 1))),
        unitPriceLabel: selectedItem.finalPriceLabel,
        totalLabel: formatCopper(selectedItem.finalPriceCopper * this.purchaseQuantity)
      } : null;
      const modeIsBuy = this.mode !== "sell";
      const modeIsSell = !modeIsBuy;
      const canBuyAnyItem = modeIsBuy && snapshot.canTrade && Boolean(snapshot.customer);

      let buyDisabledReason = "";
      if (modeIsSell) {
        buyDisabledReason = "В режиме продажи используйте блок перетягивания ниже.";
      }
      else if (!snapshot.canTrade) {
        buyDisabledReason = "Торговля сейчас недоступна.";
      }
      else if (!snapshot.customer) {
        buyDisabledReason = "Выберите покупателя.";
      }
      else if (!selectedItem) {
        buyDisabledReason = "Выберите товар из списка.";
      }

      return {
        hasError: false,
        trader: snapshot,
        traderArtPath: `modules/${MODULE_ID}/assets/ui/trader-cutout.png`,
        traderSpeech: snapshot.description || "Добро пожаловать. Выберите товар из ассортимента, чтобы открыть карточку сделки.",
        search: this.search,
        mode: {
          isBuy: modeIsBuy,
          isSell: modeIsSell
        },
        usePartyFunds: this.usePartyFunds,
        inventory: inventory.map((entry) => ({
          ...entry,
          isSelected: selectedItem?.itemKey === entry.itemKey
        })),
        inventoryCount: inventory.length,
        emptyInventory: inventory.length === 0,
        selectedItem,
        selectedQuote,
        canBuyAnyItem,
        canBuySelected: buyDisabledReason.length === 0,
        buyDisabledReason
      };
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to prepare trader v2 app '${this.cityId}:${this.traderKey}'.`, error);
      return {
        hasError: true,
        errorMessage: "Не удалось подготовить данные новой лавки."
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

  async #purchaseItemByKey(itemKey, inventoryByKey, requestedQuantity = null, customerOptions = []) {
    const item = inventoryByKey.get(itemKey);
    if (!item) {
      ui.notifications?.warn("Товар уже обновился. Попробуйте открыть лавку заново.");
      return;
    }

    const quantity = requestedQuantity
      ? Math.max(1, Math.min(Math.floor(toNumber(requestedQuantity, 1)), Math.max(1, Math.floor(toNumber(item.quantity, 1)))))
      : await promptPurchaseQuantity(item);
    if (!quantity) {
      return;
    }

    const actorId = this.usePartyFunds
      ? (this.partyInventoryActorId ?? this.selectedActorId ?? null)
      : await promptPurchaseTarget(customerOptions, this.selectedActorId);

    if (actorId === undefined) {
      return;
    }

    this.selectedActorId = actorId ?? null;

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

  async #playSequencerEntrance(element) {
    if (this.hasPlayedSequencerEntrance || game.modules?.get?.("sequencer")?.active !== true || typeof Sequence !== "function") {
      return;
    }

    this.hasPlayedSequencerEntrance = true;
    try {
      await new Sequence()
        .thenDo(() => element.classList.add("rm-trader-v2-sequencer-open"))
        .wait(700)
        .thenDo(() => element.classList.remove("rm-trader-v2-sequencer-open"))
        .play({ local: true });
    }
    catch (error) {
      console.debug(`${MODULE_ID} | Sequencer trader v2 entrance animation was skipped.`, error);
      element.classList.remove("rm-trader-v2-sequencer-open");
    }
  }

  #fitToViewport() {
    if (typeof window === "undefined") {
      return;
    }

    this.setPosition?.({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    });
  }

  #updatePurchaseQuoteForInput(quantityInput) {
    if (!(quantityInput instanceof HTMLInputElement)) {
      return;
    }

    const card = quantityInput.closest("[data-item-card]");
    if (!(card instanceof HTMLElement)) {
      return;
    }

    const maxQuantity = Math.max(1, Math.floor(toNumber(quantityInput.dataset.max, quantityInput.max || 1)));
    const unitPriceCopper = Math.max(0, Math.floor(toNumber(quantityInput.dataset.unitPriceCopper, 0)));
    const unitPriceLabel = quantityInput.dataset.unitPriceLabel || formatCopper(unitPriceCopper);
    const quantity = Math.max(1, Math.min(Math.floor(toNumber(quantityInput.value, 1)), maxQuantity));
    const totalOutput = card.querySelector("[data-role='purchase-total']");
    const unitSummary = card.querySelector("[data-role='purchase-unit-summary']");
    const buyButton = card.querySelector("[data-action='buy-selected']");

    this.purchaseQuantity = quantity;
    quantityInput.value = String(quantity);
    if (totalOutput instanceof HTMLElement) {
      totalOutput.textContent = formatCopper(unitPriceCopper * quantity);
    }
    if (unitSummary instanceof HTMLElement) {
      unitSummary.textContent = `за ${quantity} шт. · ${unitPriceLabel} за штуку`;
    }
    if (buyButton instanceof HTMLElement) {
      buyButton.dataset.quantity = String(quantity);
    }
  }

  #syncSelectedItemDom(element, { resetQuantity = false } = {}) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const activeItemKey = this.selectedItemKey || "";
    element.querySelectorAll("[data-action='select-item']").forEach((button) => {
      const isSelected = Boolean(activeItemKey) && button.dataset.itemKey === activeItemKey;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    });

    element.querySelectorAll("[data-item-card]").forEach((card) => {
      if (!(card instanceof HTMLElement)) {
        return;
      }

      const isActive = Boolean(activeItemKey) && card.dataset.itemCard === activeItemKey;
      card.hidden = !isActive;
      card.classList.toggle("is-active", isActive);
      card.classList.toggle("is-hidden", !isActive);

      if (!isActive || !resetQuantity) {
        return;
      }

      const quantityInput = card.querySelector("[data-action='purchase-quantity']");
      if (quantityInput instanceof HTMLInputElement) {
        quantityInput.value = "1";
        this.#updatePurchaseQuoteForInput(quantityInput);
      }
    });
  }

  async #closeWithAnimation(element) {
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;
    element?.classList?.add("is-closing");
    await new Promise((resolve) => window.setTimeout(resolve, 240));
    await this.close();
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
    this.#playSequencerEntrance(element);
    this.#fitToViewport();
    window.addEventListener("resize", () => this.#fitToViewport(), listenerOptions);

    const inventoryByKey = new Map((context.inventory ?? []).map((entry) => [entry.itemKey, entry]));
    const customerOptions = context.trader?.customerOptions ?? [];

    element.querySelector("[data-action='close-trader-v2']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await this.#closeWithAnimation(element);
    }, listenerOptions);

    element.querySelector("[data-action='poke-trader-character']")?.addEventListener("click", (event) => {
      event.preventDefault();
      const character = event.currentTarget;
      const tooltip = element.querySelector(".rm-trader-v2-character-tooltip");
      const tooltipText = tooltip?.querySelector("span");
      const normalSpeech = context.traderSpeech ?? "";

      character.classList.remove("is-poked");
      // Restart the scale pulse even when the user clicks repeatedly.
      void character.offsetWidth;
      character.classList.add("is-poked");
      tooltip?.classList?.add("is-visible", "is-poked");
      if (tooltipText instanceof HTMLElement) {
        tooltipText.textContent = "\u0410\u0439";
      }

      window.clearTimeout(this.characterPokeTimeout);
      this.characterPokeTimeout = window.setTimeout(() => {
        character.classList.remove("is-poked");
        tooltip?.classList?.remove("is-visible", "is-poked");
        if (tooltipText instanceof HTMLElement) {
          tooltipText.textContent = normalSpeech;
        }
      }, 1150);
    }, listenerOptions);

    element.querySelector("[data-action='search']")?.addEventListener("input", (event) => {
      this.search = event.currentTarget.value ?? "";
      window.clearTimeout(this.searchRenderTimeout);
      this.searchRenderTimeout = window.setTimeout(() => this.render({ force: true }), 120);
    }, listenerOptions);

    element.querySelector("[data-action='toggle-shared-funds']")?.addEventListener("change", (event) => {
      this.usePartyFunds = event.currentTarget.checked === true;
      if (!this.usePartyFunds && (!this.selectedActorId || this.selectedActorId === this.partyInventoryActorId)) {
        const character = game.user?.character;
        this.selectedActorId = character?.isOwner ? character.id : null;
      }
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='select-customer']")?.addEventListener("change", (event) => {
      this.selectedActorId = event.currentTarget.value || null;
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='switch-mode']").forEach((button) => {
      button.addEventListener("click", (event) => {
        const mode = event.currentTarget.dataset.mode === "sell" ? "sell" : "buy";
        if (this.mode === mode) {
          return;
        }

        this.mode = mode;
        this.selectedItemKey = mode === "sell" ? "" : this.selectedItemKey;
        this.purchaseQuantity = 1;
        this.render({ force: true });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='select-item']").forEach((button, index) => {
      if (button instanceof HTMLElement) {
        button.style.setProperty("--rm-row-delay", `${150 + (index * 46)}ms`);
      }

      button.addEventListener("click", (event) => {
        const itemKey = event.currentTarget.dataset.itemKey ?? "";
        if (!itemKey) {
          return;
        }

        this.selectedItemKey = this.selectedItemKey === itemKey ? "" : itemKey;
        this.purchaseQuantity = 1;
        this.#syncSelectedItemDom(element, { resetQuantity: true });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='clear-selected-item']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.selectedItemKey = "";
        this.purchaseQuantity = 1;
        this.#syncSelectedItemDom(element);
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='purchase-quantity']").forEach((quantityInput) => {
      if (!(quantityInput instanceof HTMLInputElement)) {
        return;
      }

      const updateQuote = () => this.#updatePurchaseQuoteForInput(quantityInput);
      quantityInput.addEventListener("input", updateQuote, listenerOptions);
      quantityInput.addEventListener("change", updateQuote, listenerOptions);
      updateQuote();
    });

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

    element.querySelectorAll("[data-action='buy-selected']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const itemKey = event.currentTarget.dataset.itemKey;
        if (!itemKey) {
          return;
        }

        try {
          const quantity = Math.max(1, Math.floor(toNumber(event.currentTarget.dataset.quantity, this.purchaseQuantity)));
          await this.#purchaseItemByKey(itemKey, inventoryByKey, quantity, customerOptions);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to buy selected item '${itemKey}'.`, error);
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
          console.error(`${MODULE_ID} | Failed to complete dropped sale in trader v2.`, error);
          ui.notifications?.error(error.message || "Не удалось завершить продажу.");
        }
      }, listenerOptions);
    }
  }

  async _preClose(options) {
    window.clearTimeout(this.searchRenderTimeout);
    this.searchRenderTimeout = null;
    window.clearTimeout(this.characterPokeTimeout);
    this.characterPokeTimeout = null;
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    return super._preClose ? super._preClose(options) : undefined;
  }
}
