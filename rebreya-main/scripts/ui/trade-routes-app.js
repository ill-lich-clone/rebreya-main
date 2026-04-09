import { DEFAULT_ROUTE_SORT, MODULE_ID, ROUTE_SORT_OPTIONS } from "../constants.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesRouteSearch(route, search) {
  if (!search) {
    return true;
  }

  const haystack = [
    route.sourceCityName,
    route.targetName,
    route.sourceState,
    route.sourceRegionName,
    route.targetState,
    route.targetRegionName,
    route.connectionType
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(search);
}

function getRouteStateOptions(routes) {
  return [...new Set(routes.map((route) => route.sourceState).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((state) => ({ value: state, label: state }));
}

function selectRoutes(routes, filters) {
  const search = normalizeSearch(filters.search);
  const state = filters.state ?? "all";
  const status = filters.status ?? "all";
  const sort = filters.sort ?? DEFAULT_ROUTE_SORT;

  const filtered = routes.filter((route) => {
    if (state !== "all" && route.sourceState !== state) {
      return false;
    }

    if (status === "active" && route.isActive === false) {
      return false;
    }

    if (status === "inactive" && route.isActive !== false) {
      return false;
    }

    return matchesRouteSearch(route, search);
  });

  return filtered.sort((left, right) => {
    switch (sort) {
      case "usageAsc":
        return Number(left.totalUsageQuantity ?? 0) - Number(right.totalUsageQuantity ?? 0)
          || left.sourceCityName.localeCompare(right.sourceCityName, "ru")
          || left.targetName.localeCompare(right.targetName, "ru");
      case "additionalPriceDesc":
        return Number(right.additionalPricePercent ?? 0) - Number(left.additionalPricePercent ?? 0)
          || left.sourceCityName.localeCompare(right.sourceCityName, "ru")
          || left.targetName.localeCompare(right.targetName, "ru");
      case "additionalPriceAsc":
        return Number(left.additionalPricePercent ?? 0) - Number(right.additionalPricePercent ?? 0)
          || left.sourceCityName.localeCompare(right.sourceCityName, "ru")
          || left.targetName.localeCompare(right.targetName, "ru");
      case "name":
        return left.sourceCityName.localeCompare(right.sourceCityName, "ru")
          || left.targetName.localeCompare(right.targetName, "ru");
      case "usageDesc":
      default:
        return Number(right.totalUsageQuantity ?? 0) - Number(left.totalUsageQuantity ?? 0)
          || left.sourceCityName.localeCompare(right.sourceCityName, "ru")
          || left.targetName.localeCompare(right.targetName, "ru");
    }
  });
}

function mapRoutes(routes) {
  return routes.map((route) => ({
    ...route,
    isEventBlocked: route.eventRouteDisabled === true,
    statusTooltip: route.eventRouteDisabled === true
      ? (
        (route.eventSourceNames ?? []).length
          ? `Маршрут перекрыт из-за ивента: ${(route.eventSourceNames ?? []).join(", ")}.`
          : "Маршрут перекрыт активным ивентом."
      )
      : "",
    activityClass: route.eventRouteDisabled === true
      ? "rm-chip--blocked"
      : (route.isActive === false ? "rm-chip--warn" : "rm-badge--good"),
    activityLabel: route.eventRouteDisabled === true
      ? "Перекрыта ивентом"
      : (route.isActive === false ? "Отключена" : "Включена"),
    toggleClass: route.eventRouteDisabled === true
      ? "is-event-blocked"
      : (route.isActive === false ? "is-inactive" : "is-active"),
    toggleLabel: route.eventRouteDisabled === true
      ? "Перекрыта ивентом"
      : (route.isActive === false ? "Выключена" : "Активна"),
    toggleDisabled: route.eventRouteDisabled === true,
    additionalPriceClass: Number(route.additionalPricePercent ?? 0) > 0
      ? "rm-negative"
      : (Number(route.additionalPricePercent ?? 0) < 0 ? "rm-positive" : ""),
    additionalPricePercentValue: Number((Number(route.additionalPricePercent ?? 0) * 100).toFixed(2)),
    isEventModified: route.isModifiedByEvents === true || (route.eventSourceNames ?? []).length > 0,
    eventSummary: (route.eventSourceNames ?? []).join(", "),
    hasRiskNotes: (route.eventRouteRiskNotes ?? []).length > 0,
    riskNotesLabel: (route.eventRouteRiskNotes ?? []).join(" • ")
  }));
}

export class WorldTradeRoutesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-world-trade-routes-app`,
    classes: ["rebreya-main", "rebreya-world-trade-routes-app"],
    window: {
      title: "Мировые связи",
      icon: "fa-solid fa-route",
      resizable: true
    },
    position: {
      width: 1360,
      height: 880
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/trade-routes-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.searchRenderTimer = null;
    this.pendingFocus = null;
    this.analyticsWarmupStarted = false;
    this.filters = {
      search: "",
      state: "all",
      status: "all",
      sort: DEFAULT_ROUTE_SORT
    };
  }

  async _prepareContext() {
    const model = await this.moduleApi.getModel();
    const allRoutes = this.moduleApi.getTradeRoutes();
    const filteredRoutes = mapRoutes(selectRoutes(allRoutes, this.filters));
    const totalUsageQuantity = filteredRoutes.reduce((sum, route) => sum + Number(route.totalUsageQuantity ?? 0), 0);

    return {
      hasError: false,
      filters: this.filters,
      routeStateOptions: getRouteStateOptions(allRoutes),
      sortOptions: ROUTE_SORT_OPTIONS,
      routes: filteredRoutes,
      totalRoutes: allRoutes.length,
      filteredRouteCount: filteredRoutes.length,
      totalUsageQuantity,
      tradeAnalyticsReady: this.moduleApi.hasTradeRouteAnalytics(),
      sourceMode: model.source?.mode ?? "builtin"
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    const requestRenderWithFocus = (selector, target) => {
      this.pendingFocus = {
        selector,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd
      };

      window.clearTimeout(this.searchRenderTimer);
      this.searchRenderTimer = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    };

    element.querySelectorAll("[data-filter]").forEach((field) => {
      const eventName = field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, (event) => {
        const target = event.currentTarget;
        const filterKey = target.dataset.filter;
        this.filters[filterKey] = target.value;

        if (filterKey === "search") {
          requestRenderWithFocus(`[data-filter='${filterKey}']`, target);
          return;
        }

        this.render({ force: true });
      });
    });

    element.querySelectorAll("[data-action='open-trade-route']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const connectionId = event.currentTarget.dataset.connectionId;
        if (connectionId) {
          await this.moduleApi.openTradeRouteApp(connectionId);
        }
      });
    });

    element.querySelectorAll("[data-action='toggle-connection']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const connectionId = event.currentTarget.dataset.connectionId;
        const isActive = event.currentTarget.dataset.active === "true";
        if (!connectionId) {
          return;
        }

        event.currentTarget.disabled = true;
        try {
          await this.moduleApi.setConnectionActive(connectionId, !isActive);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to toggle connection '${connectionId}' from world routes app.`, error);
          ui.notifications?.error("Не удалось переключить торговую связь.");
          event.currentTarget.disabled = false;
        }
      });
    });

    element.querySelectorAll("[data-action='save-route-price']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const connectionId = event.currentTarget.dataset.connectionId;
        const card = event.currentTarget.closest("[data-route-card]");
        const priceField = card?.querySelector("[data-field='additional-price']");
        const priceValue = priceField instanceof HTMLInputElement ? Number(priceField.value ?? 0) : 0;
        const additionalPricePercent = Number.isFinite(priceValue) ? priceValue / 100 : 0;

        if (!connectionId) {
          return;
        }

        event.currentTarget.disabled = true;
        try {
          await this.moduleApi.updateTradeRouteMetadata(connectionId, {
            additionalPricePercent
          });
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to save additional price for '${connectionId}'.`, error);
          ui.notifications?.error("Не удалось сохранить доп. цену связи.");
          event.currentTarget.disabled = false;
        }
      });
    });

    if (this.pendingFocus?.selector) {
      const focusTarget = element.querySelector(this.pendingFocus.selector);
      if (focusTarget instanceof HTMLInputElement || focusTarget instanceof HTMLTextAreaElement) {
        const selectionStart = Number.isInteger(this.pendingFocus.selectionStart)
          ? this.pendingFocus.selectionStart
          : focusTarget.value.length;
        const selectionEnd = Number.isInteger(this.pendingFocus.selectionEnd)
          ? this.pendingFocus.selectionEnd
          : selectionStart;

        focusTarget.focus();
        focusTarget.setSelectionRange(selectionStart, selectionEnd);
      }

      this.pendingFocus = null;
    }

    if (!context?.tradeAnalyticsReady && !this.analyticsWarmupStarted) {
      this.analyticsWarmupStarted = true;
      this.moduleApi.prepareTradeRouteAnalytics({ rerender: false })
        .then(() => this.render({ force: true }))
        .catch((error) => {
          console.error(`${MODULE_ID} | Failed to prepare world trade route analytics.`, error);
        })
        .finally(() => {
          this.analyticsWarmupStarted = false;
        });
    }
  }
}
