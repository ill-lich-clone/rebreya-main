import { CITY_TABS, MODULE_ID } from "../constants.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function formatStatusLabel(status) {
  switch (status) {
    case "deficit":
      return "Дефицит";
    case "surplus":
      return "Профицит";
    default:
      return "Баланс";
  }
}

function buildModifierRows(source, goods) {
  return goods
    .map((good) => ({
      goodId: good.id,
      goodName: good.name,
      value: Number(source?.[good.id] ?? 0)
    }))
    .filter((row) => !Number.isNaN(row.value));
}

function attachMaterialState(row, model) {
  return {
    ...row,
    hasMaterial: model.materialByGoodId.has(row.goodId)
  };
}

function mapTradeConnections(connections, model, exportKey) {
  return connections.map((connection) => ({
    ...connection,
    [exportKey]: (connection[exportKey] ?? []).map((row) => attachMaterialState(row, model))
  }));
}

function mapConnectionRows(connections) {
  return (connections ?? []).map((connection) => ({
    ...connection,
    ...buildConnectionStatus(connection)
  }));
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function formatSignedPercent(value, precision = 1) {
  const percentValue = toNumber(value, 0) * 100;
  const rounded = Math.abs(percentValue) < 1e-9 ? 0 : percentValue;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(precision)}%`;
}

function buildConnectionStatus(connection = {}) {
  const isEventBlocked = connection.eventRouteDisabled === true;
  const eventSourceNames = Array.isArray(connection.eventSourceNames) ? connection.eventSourceNames : [];
  const eventReason = eventSourceNames.length
    ? `Маршрут перекрыт из-за ивента: ${eventSourceNames.join(", ")}.`
    : "Маршрут перекрыт активным ивентом.";

  if (isEventBlocked) {
    return {
      isEventBlocked: true,
      statusTooltip: eventReason,
      toggleLabel: "Маршрут перекрыт",
      toggleClass: "is-event-blocked",
      toggleDisabled: true,
      statusChipClass: "rm-chip--blocked"
    };
  }

  if (connection.isActive === false) {
    return {
      isEventBlocked: false,
      statusTooltip: "Связь выключена вручную.",
      toggleLabel: "Связь выключена",
      toggleClass: "is-inactive",
      toggleDisabled: false,
      statusChipClass: "rm-chip--warn"
    };
  }

  return {
    isEventBlocked: false,
    statusTooltip: "",
    toggleLabel: "Активная связь",
    toggleClass: "is-active",
    toggleDisabled: false,
    statusChipClass: ""
  };
}

function buildPriceModifierTooltip(row = {}) {
  const importMarkup = toNumber(row.routePriceModifierPercent, 0);
  const eventModifier = toNumber(row.eventPriceModifierPercent, 0);
  const totalModifier = toNumber(row.priceModifierPercent, importMarkup + eventModifier);
  const eventSourceNames = Array.isArray(row.eventSourceNames) ? row.eventSourceNames : [];
  const hasEventPriceImpact = Math.abs(eventModifier) > 1e-9;

  const lines = [
    `Итоговый модификатор: ${formatSignedPercent(totalModifier, 1)}`,
    `Наценка за импорт: ${formatSignedPercent(importMarkup, 1)}`
  ];
  if (hasEventPriceImpact) {
    if (eventSourceNames.length) {
      lines.push(`Ивенты (${eventSourceNames.join(", ")}): ${formatSignedPercent(eventModifier, 1)}`);
    } else {
      lines.push(`Ивенты: ${formatSignedPercent(eventModifier, 1)}`);
    }
  }
  return lines.join("\n");
}

function getSignedValueClass(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return "";
  }

  return numericValue > 0 ? "rm-positive" : "rm-negative";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolateColor(left, right, ratio) {
  return left.map((channel, index) => Math.round(channel + ((right[index] - channel) * ratio)));
}

function toRgbString(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

function getSelfSufficiencyColor(rate) {
  const percentage = Number(rate ?? 0) * 100;
  if (!Number.isFinite(percentage)) {
    return "";
  }

  const red = [229, 125, 112];
  const orange = [224, 162, 93];
  const green = [128, 196, 126];

  if (percentage <= 50) {
    return toRgbString(red);
  }

  if (percentage >= 100) {
    return toRgbString(green);
  }

  if (percentage <= 75) {
    const ratio = clamp((percentage - 50) / 25, 0, 1);
    return toRgbString(interpolateColor(red, orange, ratio));
  }

  const ratio = clamp((percentage - 75) / 25, 0, 1);
  return toRgbString(interpolateColor(orange, green, ratio));
}

export class CityEconomyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-city-app"],
    window: {
      title: "Городская экономика",
      icon: "fa-solid fa-city",
      resizable: true
    },
    position: {
      width: 1180,
      height: 860
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/city-app.hbs`
    }
  };

  constructor(moduleApi, cityId, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.cityId = cityId;
    this.activeTab = CITY_TABS.OVERVIEW;
  }

  get id() {
    return `${MODULE_ID}-city-${this.cityId}`;
  }

  async _prepareContext() {
    const model = await this.moduleApi.getModel();
    const city = this.moduleApi.getCitySnapshot(this.cityId);
    if (!city) {
      return {
        hasError: true,
        errorMessage: "Город не найден в загруженных данных."
      };
    }

    const region = model.regionById.get(city.regionId) ?? null;
    const traders = await this.moduleApi.getCityTraderSummaries(this.cityId);
    const cityRank = Math.max(0, Number(city.rank ?? 0));
    const profileShopSlotCount = Math.max(1, 1 + (cityRank * 2));
    const cityBalanceClass = getSignedValueClass(city.netBalance);
    const citySelfSufficiencyColor = getSelfSufficiencyColor(city.selfSufficiencyRate);
    const coefficientRows = buildModifierRows(region?.productionCoefficients, model.goods)
      .filter((row) => row.value !== 0)
      .map((row) => attachMaterialState(row, model));
    const modifierRows = buildModifierRows(region?.productionModifiers, model.goods)
      .filter((row) => row.value !== 0)
      .map((row) => attachMaterialState(row, model));

    return {
      hasError: false,
      activeTab: this.activeTab,
      city,
      cityBalanceClass,
      citySelfSufficiencyColor,
      activeCityEvents: (city.activeEventRows ?? []).map((row) => ({
        id: row.id,
        name: row.name || row.id,
        priority: Number(row.priority ?? 100)
      })),
      region,
      traders,
      tradersEnabled: this.moduleApi.isTraderIntegrationAvailable(),
      expectedTraderCount: traders.length,
      profileShopSlotCount,
      goodsRows: city.goodsRows.map((row) => ({
        ...attachMaterialState(row, model),
        statusLabel: formatStatusLabel(row.status),
        priceModifierClass: row.priceModifierPercent > 0 ? "rm-negative" : (row.priceModifierPercent < 0 ? "rm-positive" : ""),
        priceModifierTooltip: buildPriceModifierTooltip(row),
        hasImports: (row.importSources ?? []).length > 0,
        hasEventModifiers: (row.eventSourceNames ?? []).length > 0,
        eventSourceNamesLabel: (row.eventSourceNames ?? []).join(", "),
        blockedByEvents: row.blockedByEvents === true
      })),
      criticalDeficits: city.deficitGoods.slice(0, 8).map((row) => attachMaterialState(row, model)),
      keySurpluses: city.surplusGoods.slice(0, 8).map((row) => attachMaterialState(row, model)),
      goodsWithImports: (city.goodsWithImports ?? []).map((row) => ({
        ...attachMaterialState(row, model),
        priceModifierClass: row.priceModifierPercent > 0 ? "rm-negative" : (row.priceModifierPercent < 0 ? "rm-positive" : ""),
        priceModifierTooltip: buildPriceModifierTooltip(row)
      })),
      tradeConnections: mapConnectionRows(city.tradeConnections),
      potentialImports: mapTradeConnections(city.potentialImports, model, "matchingNeeds"),
      potentialExports: mapTradeConnections(city.potentialExports, model, "matchingExports"),
      brokenConnections: city.brokenConnections,
      tabs: {
        isOverview: this.activeTab === CITY_TABS.OVERVIEW,
        isGoods: this.activeTab === CITY_TABS.GOODS,
        isTrade: this.activeTab === CITY_TABS.TRADE,
        isTraders: this.activeTab === CITY_TABS.TRADERS,
        isDebug: this.activeTab === CITY_TABS.DEBUG
      },
      debugMode: game.settings.get(MODULE_ID, "debugMode"),
      coefficientRows,
      modifierRows,
      sourceWarnings: model.reference?.warnings ?? {},
      importRouteStats: city.importRouteStats
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    element.querySelectorAll("[data-action='switch-tab']").forEach((button) => {
      button.addEventListener("click", (event) => {
        this.activeTab = event.currentTarget.dataset.tab;
        this.render({ force: true });
      });
    });

    element.querySelectorAll("[data-action='open-city']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const cityId = event.currentTarget.dataset.cityId;
        if (cityId) {
          this.moduleApi.openCityApp(cityId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-trade-route']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const connectionId = event.currentTarget.dataset.connectionId;
        if (connectionId) {
          this.moduleApi.openTradeRouteApp(connectionId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-state-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entryId = event.currentTarget.dataset.stateId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("state", entryId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-region-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entryId = event.currentTarget.dataset.regionId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("region", entryId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-transport-mode-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const entryId = event.currentTarget.dataset.modeId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("transportMode", entryId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-material']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const goodId = event.currentTarget.dataset.goodId;
        if (goodId) {
          this.moduleApi.openMaterialByGoodId(goodId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-trader']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const traderKey = event.currentTarget.dataset.traderKey;
        if (!traderKey) {
          return;
        }

        event.currentTarget.disabled = true;

        try {
          await this.moduleApi.openTrader(this.cityId, traderKey);
          this.render({ force: true });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open trader '${traderKey}'.`, error);
          ui.notifications?.error("Не удалось открыть лавку.");
          event.currentTarget.disabled = false;
        }
      });
    });

    element.querySelectorAll("[data-action='toggle-connection']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const connectionId = event.currentTarget.dataset.connectionId;
        if (!connectionId) {
          return;
        }

        const isActive = event.currentTarget.dataset.active === "true";
        event.currentTarget.disabled = true;

        try {
          await this.moduleApi.setConnectionActive(connectionId, !isActive);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to toggle connection '${connectionId}'.`, error);
          ui.notifications?.error("Не удалось переключить торговую связь.");
          event.currentTarget.disabled = false;
        }
      });
    });
  }
}
