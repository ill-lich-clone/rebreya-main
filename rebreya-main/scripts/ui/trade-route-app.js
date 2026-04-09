import { MODULE_ID } from "../constants.js";
import { formatNumber, formatPercent, formatSignedPercent, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function toSafeId(value) {
  return Array.from(String(value ?? "route"))
    .map((character) => character.charCodeAt(0).toString(16))
    .join("-");
}

export class TradeRouteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-trade-route-app"],
    window: {
      title: "Торговая связь",
      icon: "fa-solid fa-route",
      resizable: true
    },
    position: {
      width: 1120,
      height: 820
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/trade-route-app.hbs`
    }
  };

  constructor(moduleApi, connectionId, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.connectionId = connectionId;
    this.analyticsWarmupStarted = false;
  }

  get id() {
    return `${MODULE_ID}-trade-route-${toSafeId(this.connectionId)}`;
  }

  async _prepareContext() {
    const detailedRoute = this.moduleApi.getTradeRouteSnapshot(this.connectionId);
    const baseRoute = this.moduleApi.getTradeRouteBaseSnapshot(this.connectionId);
    const route = detailedRoute ?? (baseRoute ? {
      ...baseRoute,
      globalUsageRows: [],
      goodsUsage: [],
      destinationUsage: [],
      isBypassed: true,
      totalUsageQuantity: 0,
      totalDestinationCount: 0,
      totalGoodsCount: 0
    } : null);
    if (!route) {
      return {
        hasError: true,
        errorMessage: "Торговая связь не найдена."
      };
    }

    const routeBlockedByEvent = route.eventRouteDisabled === true;
    const routeStatusTooltip = routeBlockedByEvent
      ? (
        (route.eventSourceNames ?? []).length
          ? `Маршрут перекрыт из-за ивента: ${(route.eventSourceNames ?? []).join(", ")}.`
          : "Маршрут перекрыт активным ивентом."
      )
      : "";

    return {
      hasError: false,
      route,
      isLoadingAnalytics: !detailedRoute,
      isEditable: game.user?.isGM === true,
      additionalPricePercentValue: Number((Number(route.additionalPricePercent ?? 0) * 100).toFixed(2)),
      topGoods: (route.goodsUsage ?? []).slice(0, 8),
      topDestinations: (route.destinationUsage ?? []).slice(0, 8),
      globalUsageRows: (route.globalUsageRows ?? []).map((row) => ({
        ...row,
        legMarkupClass: row.legMarkupPercent > 0 ? "rm-negative" : (row.legMarkupPercent < 0 ? "rm-positive" : ""),
        routeMarkupClass: row.routeMarkupPercent > 0 ? "rm-negative" : (row.routeMarkupPercent < 0 ? "rm-positive" : "")
      })),
      isEventModified: route.isModifiedByEvents === true || (route.eventSourceNames ?? []).length > 0,
      eventSourceNamesLabel: (route.eventSourceNames ?? []).join(", "),
      eventRiskNotesLabel: (route.eventRouteRiskNotes ?? []).join(" • "),
      hasEventRiskNotes: (route.eventRouteRiskNotes ?? []).length > 0,
      routeStatusLabel: routeBlockedByEvent ? "Перекрыта ивентом" : (route.isActive ? "Включена" : "Отключена"),
      routeStatusTooltip,
      display: {
        movementCost: formatPercent(route.movementCost ?? 0, 1),
        additionalPricePercent: formatSignedPercent(route.additionalPricePercent ?? 0, 1),
        singleStepMarkupPercent: formatSignedPercent(route.markupPercent ?? 0, 1),
        selfSufficiency: formatPercent(route.targetSelfSufficiencyRate ?? 0, 1),
        netBalance: formatNumber(route.targetNetBalance ?? 0),
        totalUsageQuantity: formatNumber(route.totalUsageQuantity ?? 0),
        totalDestinationCount: formatNumber(route.totalDestinationCount ?? 0, 0),
        totalGoodsCount: formatNumber(route.totalGoodsCount ?? 0, 0)
      },
      additionalPriceClass: Number(route.additionalPricePercent ?? 0) > 0
        ? "rm-negative"
        : (Number(route.additionalPricePercent ?? 0) < 0 ? "rm-positive" : "")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    element.querySelector("[data-action='save-route']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      const descriptionField = element.querySelector("[name='description']");
      const priceField = element.querySelector("[name='additionalPricePercent']");
      const description = descriptionField instanceof HTMLTextAreaElement ? descriptionField.value : "";
      const priceInput = priceField instanceof HTMLInputElement ? Number(priceField.value ?? 0) : 0;
      const additionalPricePercent = Number.isFinite(priceInput) ? priceInput / 100 : 0;

      event.currentTarget.disabled = true;
      try {
        await this.moduleApi.updateTradeRouteMetadata(this.connectionId, {
          description,
          additionalPricePercent
        });
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to save trade route '${this.connectionId}'.`, error);
        ui.notifications?.error("Не удалось сохранить торговую связь.");
        event.currentTarget.disabled = false;
      }
    });

    element.querySelectorAll("[data-action='open-city']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const cityId = event.currentTarget.dataset.cityId;
        if (cityId) {
          this.moduleApi.openCityApp(cityId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-state-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const entryId = event.currentTarget.dataset.stateId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("state", entryId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-region-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const entryId = event.currentTarget.dataset.regionId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("region", entryId);
        }
      });
    });

    element.querySelectorAll("[data-action='open-transport-mode-info']").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const entryId = event.currentTarget.dataset.modeId;
        if (entryId) {
          this.moduleApi.openReferenceInfoApp("transportMode", entryId);
        }
      });
    });

    if (context?.isLoadingAnalytics && !this.analyticsWarmupStarted) {
      this.analyticsWarmupStarted = true;
      this.moduleApi.prepareTradeRouteAnalytics({ rerender: false })
        .then(() => this.render({ force: true }))
        .catch((error) => {
          console.error(`${MODULE_ID} | Failed to prepare analytics for trade route '${this.connectionId}'.`, error);
        })
        .finally(() => {
          this.analyticsWarmupStarted = false;
        });
    }
  }
}
