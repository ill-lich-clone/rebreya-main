import { MODULE_ID } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";
import { createTradeTransactionId } from "../features/trading/trade-transaction-model.js";
import {
  PendingTradeTransactions,
  commitSaleBasket,
  purchaseSemanticKey,
  saleSemanticKey,
  tradeErrorCorrelation
} from "../features/trading/trade-ui-transaction-lifecycle.js";

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

const DND5E_PRICE_IN_COPPER = {
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1
};

const SELLABLE_ITEM_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "backpack"]);

const ITEM_TYPE_LABELS = {
  weapon: "Оружие",
  equipment: "Снаряжение",
  consumable: "Расходники",
  tool: "Инструменты",
  loot: "Добыча",
  backpack: "Контейнеры"
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

function actorCurrencyToCopperLocal(actor) {
  const currency = actor?.system?.currency ?? {};
  return Math.max(0,
    Math.round(toNumber(currency.pp, 0) * DND5E_PRICE_IN_COPPER.pp)
    + Math.round(toNumber(currency.gp, 0) * DND5E_PRICE_IN_COPPER.gp)
    + Math.round(toNumber(currency.ep, 0) * DND5E_PRICE_IN_COPPER.ep)
    + Math.round(toNumber(currency.sp, 0) * DND5E_PRICE_IN_COPPER.sp)
    + Math.round(toNumber(currency.cp, 0) * DND5E_PRICE_IN_COPPER.cp)
  );
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getItemQuantity(itemData) {
  return Math.max(1, Math.floor(toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 1)));
}

function getItemPriceCopper(itemData) {
  const priceValue = toNumber(foundry.utils.getProperty(itemData, "system.price.value"), 0);
  const denomination = String(foundry.utils.getProperty(itemData, "system.price.denomination") ?? "gp").toLowerCase();
  const multiplier = DND5E_PRICE_IN_COPPER[denomination] ?? DND5E_PRICE_IN_COPPER.gp;
  return Math.max(0, Math.round(priceValue * multiplier));
}

function getItemTypeLabel(item) {
  return ITEM_TYPE_LABELS[item?.type] ?? String(item?.type ?? "Товар");
}

function isSellableItem(item) {
  if (!(item instanceof Item) || !SELLABLE_ITEM_TYPES.has(item.type)) {
    return false;
  }

  const itemData = item.toObject();
  return getItemQuantity(itemData) > 0;
}

function buildSaleInventoryEntry(item) {
  const itemData = item.toObject();
  const flags = foundry.utils.deepClone(item.flags?.[MODULE_ID] ?? {});
  const priceCopper = getItemPriceCopper(itemData);
  const itemTypeLabel = String(flags.itemTypeLabel ?? getItemTypeLabel(item)).trim() || "Товар";
  const materialLabel = String(flags.predominantMaterialName ?? flags.materialName ?? "").trim();

  return {
    id: item.id,
    uuid: item.uuid,
    name: item.name,
    img: item.img || "icons/svg/item-bag.svg",
    type: item.type,
    typeLabel: getItemTypeLabel(item),
    itemTypeLabel,
    materialLabel,
    quantity: getItemQuantity(itemData),
    priceCopper,
    priceLabel: formatCopper(priceCopper)
  };
}

function groupSaleInventory(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.typeLabel || "Товары";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    count: items.length,
    items
  }));
}

function buildFacetTooltip(kind, label, rank = null) {
  const safeLabel = String(label ?? "").trim();
  if (!safeLabel && kind !== "rank") {
    return "";
  }

  if (kind === "type") {
    return `${safeLabel}: тип товара. Показывает назначение предмета и помогает быстро понять, как он используется.`;
  }

  if (kind === "material") {
    return `${safeLabel}: основной материал или состав товара. Используется в поиске, ремесле и расчёте торговой ценности.`;
  }

  const safeRank = Math.max(1, Math.floor(toNumber(rank, 1)));
  return `Ранг ${safeRank}: примерная редкость и сложность товара. Чем выше ранг, тем реже и дороже позиция.`;
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
    this.saleSellerActorId = options.actorId ?? null;
    this.saleSearch = "";
    this.saleBasket = new Map();
    this.pendingTradeTransactions = new PendingTradeTransactions();
    this.salePreviewCache = new Map();
    this.usePartyFunds = options.usePartyFunds ?? game.user?.isGM === true;
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

  #buildSaleContext(snapshot) {
    const sellerOptions = (snapshot.customerOptions ?? [])
      .filter((option) => option?.value)
      .map((option) => ({
        value: String(option.value),
        label: String(option.label ?? option.value)
      }));
    const sellerIds = new Set(sellerOptions.map((option) => option.value));
    const preferredSellerId = [
      this.saleSellerActorId,
      this.usePartyFunds ? null : this.selectedActorId,
      game.user?.character?.isOwner ? game.user.character.id : null,
      snapshot.customer?.id,
      snapshot.partyInventoryActorId,
      sellerOptions[0]?.value
    ].find((actorId) => actorId && sellerIds.has(actorId)) ?? "";

    this.saleSellerActorId = preferredSellerId;
    const sellerActor = preferredSellerId ? game.actors.get(preferredSellerId) : null;
    const saleSearchText = normalizeText(this.saleSearch);
    const allSaleItems = sellerActor?.isOwner
      ? sellerActor.items.contents
        .filter(isSellableItem)
        .map(buildSaleInventoryEntry)
        .sort((left, right) => left.name.localeCompare(right.name, "ru"))
      : [];
    const saleItems = allSaleItems.filter((entry) => {
      if (!saleSearchText) {
        return true;
      }

      return normalizeText([
        entry.name,
        entry.typeLabel,
        entry.itemTypeLabel,
        entry.materialLabel
      ].join(" ")).includes(saleSearchText);
    });

    return {
      seller: sellerActor?.isOwner ? {
        id: sellerActor.id,
        name: sellerActor.name,
        img: sellerActor.img,
        currencyLabel: formatCopper(actorCurrencyToCopperLocal(sellerActor))
      } : null,
      sellerOptions: sellerOptions.map((option) => ({
        ...option,
        selected: option.value === preferredSellerId
      })),
      search: this.saleSearch,
      items: saleItems,
      itemGroups: groupSaleInventory(saleItems),
      itemCount: saleItems.length,
      empty: saleItems.length === 0,
      basketCount: this.saleBasket.size
    };
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
        traderTexturePath: `modules/${MODULE_ID}/templates/texture/shop.webp`,
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
          itemTypeTooltip: buildFacetTooltip("type", entry.itemTypeLabel || "Товар"),
          materialTooltip: entry.materialLabel ? buildFacetTooltip("material", entry.materialLabel) : "",
          rankTooltip: entry.rank ? buildFacetTooltip("rank", "", entry.rank) : "",
          isSelected: selectedItem?.itemKey === entry.itemKey
        })),
        inventoryCount: inventory.length,
        emptyInventory: inventory.length === 0,
        selectedItem,
        selectedQuote,
        canBuyAnyItem,
        canBuySelected: buyDisabledReason.length === 0,
        buyDisabledReason,
        sale: this.#buildSaleContext(snapshot)
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

    const semanticKey = saleSemanticKey({
      actorId: preview.actorId,
      cityId: this.cityId,
      traderKey: this.traderKey,
      itemUuid: preview.itemUuid,
      quantity
    });
    const transactionId = this.pendingTradeTransactions.acquire("sale", semanticKey);
    let result;
    try {
      result = await this.moduleApi.sellTraderItem(
        this.cityId,
        this.traderKey,
        preview,
        quantity,
        { transactionId }
      );
      this.pendingTradeTransactions.resolve(semanticKey);
    }
    catch (error) {
      this.pendingTradeTransactions.reject(semanticKey, error);
      error.tradeTransactionId = transactionId;
      throw error;
    }

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

    const semanticKey = purchaseSemanticKey({
      actorId: this.selectedActorId,
      cityId: this.cityId,
      traderKey: this.traderKey,
      itemKey,
      quantity
    });
    const transactionId = this.pendingTradeTransactions.acquire("purchase", semanticKey);
    let result;
    try {
      result = await this.moduleApi.purchaseTraderItem(
        this.cityId,
        this.traderKey,
        itemKey,
        quantity,
        { actorId: this.selectedActorId, transactionId }
      );
      this.pendingTradeTransactions.resolve(semanticKey);
    }
    catch (error) {
      this.pendingTradeTransactions.reject(semanticKey, error);
      error.tradeTransactionId = transactionId;
      throw error;
    }
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

  #updatePurchaseQuoteForInput(quantityInput, { commit = true } = {}) {
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
    const rawQuantity = String(quantityInput.value ?? "").trim();
    if (!rawQuantity && !commit) {
      return;
    }

    const quantity = Math.max(1, Math.min(Math.floor(toNumber(rawQuantity || "1", 1)), maxQuantity));
    const totalOutput = card.querySelector("[data-role='purchase-total']");
    const unitSummary = card.querySelector("[data-role='purchase-unit-summary']");
    const buyButton = card.querySelector("[data-action='buy-selected']");

    this.purchaseQuantity = quantity;
    if (commit || rawQuantity !== String(quantity)) {
      quantityInput.value = String(quantity);
    }
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

  #getSaleBasketEntries() {
    return Array.from(this.saleBasket.values()).sort((left, right) => (
      left.preview.itemName.localeCompare(right.preview.itemName, "ru")
    ));
  }

  #getSaleBasketTotals() {
    return this.#getSaleBasketEntries().reduce((totals, entry) => {
      totals.grossCopper += entry.preview.grossOfferCopper * entry.quantity;
      totals.taxCopper += entry.preview.taxCopper * entry.quantity;
      totals.netCopper += entry.preview.netPayoutCopper * entry.quantity;
      return totals;
    }, {
      grossCopper: 0,
      taxCopper: 0,
      netCopper: 0
    });
  }

  #renderSaleBasket(element = getAppElement(this)) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const basket = element.querySelector("[data-role='sale-basket']");
    const empty = element.querySelector("[data-role='sale-basket-empty']");
    const grossOutput = element.querySelector("[data-role='sale-total-gross']");
    const taxOutput = element.querySelector("[data-role='sale-total-tax']");
    const netOutputs = element.querySelectorAll("[data-role='sale-total-net']");
    const confirmButton = element.querySelector("[data-action='sale-confirm']");
    const entries = this.#getSaleBasketEntries();
    const totals = this.#getSaleBasketTotals();

    if (basket instanceof HTMLElement) {
      basket.innerHTML = entries.map((entry) => {
        const preview = entry.preview;
        const quantity = Math.max(1, Math.min(entry.quantity, preview.quantityAvailable));
        return `
          <article class="rm-trader-v2-sale-picked" data-sale-basket-item="${escapeHtml(preview.itemUuid)}">
            <img src="${escapeHtml(preview.img || "icons/svg/item-bag.svg")}" alt="">
            <div class="rm-trader-v2-sale-picked__main">
              <strong>${escapeHtml(preview.itemName)}</strong>
              <small>оригинал ${escapeHtml(preview.marketPriceLabel)} · выплата ${escapeHtml(preview.netPayoutLabel)} за шт.</small>
              <div class="rm-trader-v2-sale-picked__quantity">
                <button type="button" data-action="sale-qty-dec" aria-label="Уменьшить количество">−</button>
                <input
                  type="number"
                  min="1"
                  max="${preview.quantityAvailable}"
                  step="1"
                  value="${quantity}"
                  data-action="sale-basket-quantity"
                  data-item-uuid="${escapeHtml(preview.itemUuid)}"
                >
                <button type="button" data-action="sale-qty-inc" aria-label="Увеличить количество">+</button>
              </div>
            </div>
            <strong class="rm-trader-v2-sale-picked__price">${escapeHtml(formatCopper(preview.netPayoutCopper * quantity))}</strong>
            <button type="button" class="rm-trader-v2-sale-picked__remove" data-action="sale-remove-item" aria-label="Убрать из продажи">×</button>
          </article>
        `;
      }).join("");
    }

    if (empty instanceof HTMLElement) {
      empty.hidden = entries.length > 0;
    }
    if (grossOutput instanceof HTMLElement) {
      grossOutput.textContent = formatCopper(totals.grossCopper);
    }
    if (taxOutput instanceof HTMLElement) {
      taxOutput.textContent = formatCopper(totals.taxCopper);
    }
    netOutputs.forEach((netOutput) => {
      if (netOutput instanceof HTMLElement) {
        netOutput.textContent = formatCopper(totals.netCopper);
      }
    });
    if (confirmButton instanceof HTMLButtonElement) {
      confirmButton.disabled = entries.length === 0;
    }
  }

  #setSaleBasketQuantity(itemUuid, quantity) {
    const entry = this.saleBasket.get(itemUuid);
    if (!entry) {
      return;
    }
    if (entry.frozenQuantity != null) {
      return;
    }

    entry.quantity = Math.max(1, Math.min(
      Math.floor(toNumber(quantity, 1)),
      Math.max(1, Math.floor(toNumber(entry.preview.quantityAvailable, 1)))
    ));
  }

  async #addSaleItemToBasket(itemUuid, element) {
    const existingEntry = this.saleBasket.get(itemUuid);
    if (existingEntry) {
      this.#setSaleBasketQuantity(itemUuid, existingEntry.quantity + 1);
      this.#renderSaleBasket(element);
      return;
    }

    const preview = this.salePreviewCache.get(itemUuid)
      ?? await this.moduleApi.createTraderSalePreview(this.cityId, this.traderKey, { uuid: itemUuid });
    this.salePreviewCache.set(itemUuid, preview);
    this.saleBasket.set(itemUuid, {
      preview,
      quantity: 1,
      frozenQuantity: null,
      transactionId: createTradeTransactionId("sale")
    });
    this.#renderSaleBasket(element);
  }

  #filterSaleInventoryRows(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const query = normalizeText(this.saleSearch);
    let visibleCount = 0;
    element.querySelectorAll("[data-sale-inventory-item]").forEach((row) => {
      const haystack = normalizeText(row.dataset.search ?? "");
      const isVisible = !query || haystack.includes(query);
      row.hidden = !isVisible;
      if (isVisible) {
        visibleCount += 1;
      }
    });
    element.querySelectorAll("[data-sale-group]").forEach((group) => {
      const hasVisibleRows = Boolean(group.querySelector("[data-sale-inventory-item]:not([hidden])"));
      group.hidden = !hasVisibleRows;
    });

    const empty = element.querySelector("[data-role='sale-inventory-empty']");
    if (empty instanceof HTMLElement) {
      empty.hidden = visibleCount > 0;
    }
  }

  async #confirmSaleBasket(element) {
    const entries = this.#getSaleBasketEntries();
    if (!entries.length) {
      ui.notifications?.warn("Выберите предметы для продажи.");
      return;
    }

    const totals = this.#getSaleBasketTotals();
    await commitSaleBasket(this.saleBasket, async (entry) => {
      try {
        return await this.moduleApi.sellTraderItem(
          this.cityId,
          this.traderKey,
          entry.preview,
          entry.frozenQuantity,
          { transactionId: entry.transactionId }
        );
      }
      catch (error) {
        error.tradeTransactionId = entry.transactionId;
        throw error;
      }
    }, {
      onSettledEntry: async (entry) => {
        this.salePreviewCache.delete(entry.preview.itemUuid);
        this.#renderSaleBasket(element);
      }
    });

    this.#renderSaleBasket(element);
    ui.notifications?.info(`Продано ${entries.length} поз. на ${formatCopper(totals.netCopper)}.`);
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

    element.querySelector("[data-action='close-sale-overlay']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.mode = "buy";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='sale-select-seller']")?.addEventListener("change", (event) => {
      this.saleSellerActorId = event.currentTarget.value || null;
      this.saleBasket.clear();
      this.salePreviewCache.clear();
      this.render({ force: true });
    }, listenerOptions);

    element.querySelector("[data-action='sale-search']")?.addEventListener("input", (event) => {
      this.saleSearch = event.currentTarget.value ?? "";
      this.#filterSaleInventoryRows(element);
    }, listenerOptions);

    element.querySelectorAll("[data-action='sale-add-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const itemUuid = event.currentTarget.dataset.itemUuid ?? "";
        if (!itemUuid) {
          return;
        }

        event.currentTarget.disabled = true;
        try {
          await this.#addSaleItemToBasket(itemUuid, element);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to prepare sale item '${itemUuid}'.`, error);
          ui.notifications?.error(error.message || "Не удалось добавить предмет в продажу.");
        }
        finally {
          event.currentTarget.disabled = false;
        }
      }, listenerOptions);
    });

    element.querySelector("[data-role='sale-basket-panel']")?.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const actionButton = event.target.closest("[data-action]");
      const row = event.target.closest("[data-sale-basket-item]");
      if (!(actionButton instanceof HTMLElement) || !(row instanceof HTMLElement)) {
        return;
      }

      const itemUuid = row.dataset.saleBasketItem ?? "";
      const entry = this.saleBasket.get(itemUuid);
      if (!entry) {
        return;
      }

      if (actionButton.dataset.action === "sale-remove-item") {
        this.saleBasket.delete(itemUuid);
        this.#renderSaleBasket(element);
        return;
      }

      if (actionButton.dataset.action === "sale-qty-dec") {
        this.#setSaleBasketQuantity(itemUuid, entry.quantity - 1);
        this.#renderSaleBasket(element);
        return;
      }

      if (actionButton.dataset.action === "sale-qty-inc") {
        this.#setSaleBasketQuantity(itemUuid, entry.quantity + 1);
        this.#renderSaleBasket(element);
      }
    }, listenerOptions);

    element.querySelector("[data-role='sale-basket-panel']")?.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.action !== "sale-basket-quantity") {
        return;
      }

      this.#setSaleBasketQuantity(input.dataset.itemUuid ?? "", input.value);
      this.#renderSaleBasket(element);
    }, listenerOptions);

    element.querySelector("[data-action='sale-confirm']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.currentTarget.disabled = true;
      try {
        await this.#confirmSaleBasket(element);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to confirm sale basket.`, error);
        ui.notifications?.error(tradeErrorCorrelation(error, error.tradeTransactionId));
        event.currentTarget.disabled = false;
      }
    }, listenerOptions);

    this.#renderSaleBasket(element);
    this.#filterSaleInventoryRows(element);

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

      const updateQuote = () => this.#updatePurchaseQuoteForInput(quantityInput, { commit: false });
      const commitQuote = () => this.#updatePurchaseQuoteForInput(quantityInput, { commit: true });
      quantityInput.addEventListener("input", updateQuote, listenerOptions);
      quantityInput.addEventListener("change", commitQuote, listenerOptions);
      quantityInput.addEventListener("blur", commitQuote, listenerOptions);
      commitQuote();
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
          const card = event.currentTarget.closest("[data-item-card]");
          const quantityInput = card?.querySelector("[data-action='purchase-quantity']");
          if (quantityInput instanceof HTMLInputElement) {
            this.#updatePurchaseQuoteForInput(quantityInput, { commit: true });
          }

          const quantity = Math.max(1, Math.floor(toNumber(event.currentTarget.dataset.quantity, this.purchaseQuantity)));
          await this.#purchaseItemByKey(itemKey, inventoryByKey, quantity, customerOptions);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to buy selected item '${itemKey}'.`, error);
          ui.notifications?.error(tradeErrorCorrelation(error, error.tradeTransactionId));
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
          ui.notifications?.error(tradeErrorCorrelation(error, error.tradeTransactionId));
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
    this.saleBasket?.clear?.();
    this.salePreviewCache?.clear?.();
    return super._preClose ? super._preClose(options) : undefined;
  }
}
