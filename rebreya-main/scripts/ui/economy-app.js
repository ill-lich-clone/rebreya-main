import { CITY_SORT_OPTIONS, MAX_VISIBLE_CITIES, MODULE_ID } from "../constants.js";
import {
  selectCityList,
  selectCityTypeOptions,
  selectRegionOptions,
  selectRegionOverview,
  selectStateOptions,
  selectStateOverview
} from "../engine/selectors.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function summarizeCities(cities) {
  const cityCount = cities.length;
  const population = cities.reduce((sum, city) => sum + Number(city.population ?? 0), 0);
  const totalProduction = cities.reduce((sum, city) => sum + Number(city.totalProduction ?? 0), 0);
  const totalDemand = cities.reduce((sum, city) => sum + Number(city.totalDemand ?? 0), 0);
  const totalDeficit = cities.reduce((sum, city) => sum + Number(city.totalDeficit ?? 0), 0);
  const totalSurplus = cities.reduce((sum, city) => sum + Number(city.totalSurplus ?? 0), 0);
  const averageSelfSufficiency = cityCount
    ? cities.reduce((sum, city) => sum + Number(city.selfSufficiencyRate ?? 0), 0) / cityCount
    : 1;

  return {
    cityCount,
    population,
    totalProduction,
    totalDemand,
    totalDeficit,
    totalSurplus,
    averageSelfSufficiency
  };
}

function buildGoodsOverview(cities) {
  const goodsById = new Map();

  for (const city of cities) {
    for (const row of city.goodsRows ?? []) {
      const current = goodsById.get(row.goodId) ?? {
        goodId: row.goodId,
        goodName: row.goodName,
        deficit: 0,
        surplus: 0
      };

      current.deficit += Number(row.deficit ?? 0);
      current.surplus += Number(row.surplus ?? 0);
      goodsById.set(row.goodId, current);
    }
  }

  const rows = Array.from(goodsById.values());
  return {
    topDeficitGoods: rows
      .filter((row) => row.deficit > 0)
      .sort((left, right) => right.deficit - left.deficit || left.goodName.localeCompare(right.goodName, "ru"))
      .slice(0, 6),
    topSurplusGoods: rows
      .filter((row) => row.surplus > 0)
      .sort((left, right) => right.surplus - left.surplus || left.goodName.localeCompare(right.goodName, "ru"))
      .slice(0, 6)
  };
}

function hasActiveSummaryFilters(filters) {
  return Boolean(
    String(filters.search ?? "").trim()
    || filters.state !== "all"
    || filters.regionId !== "all"
    || filters.cityType !== "all"
  );
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

async function confirmDataRestore() {
  if (typeof DialogV2?.confirm === "function") {
    return DialogV2.confirm({
      window: {
        title: "Восстановить данные"
      },
      content: `
        <p>Все ручные изменения мира будут сброшены.</p>
        <p>Это выключит отключённые связи, уберёт доп. цену маршрутов, очистит описания справочников и настройки налогов и пошлин.</p>
      `
    });
  }

  return Dialog.confirm({
    title: "Восстановить данные",
    content: `
      <p>Все ручные изменения мира будут сброшены.</p>
      <p>Продолжить?</p>
    `,
    yes: () => true,
    no: () => false,
    defaultYes: false
  });
}

export class EconomyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-economy-app`,
    classes: ["rebreya-main", "rebreya-economy-app"],
    window: {
      title: "Экономика Ребреи",
      icon: "fa-solid fa-coins",
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
      template: `modules/${MODULE_ID}/templates/economy-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.searchRenderTimer = null;
    this.pendingFocus = null;
    this.filters = {
      search: "",
      state: "all",
      regionId: "all",
      cityType: "all",
      sort: "population"
    };
  }

  async _prepareContext() {
    const model = await this.moduleApi.getModel();
    const selectedCities = selectCityList(model, this.filters);
    const visibleCities = selectedCities.slice(0, MAX_VISIBLE_CITIES).map((city) => ({
      ...city,
      netBalanceClass: getSignedValueClass(city.netBalance),
      selfSufficiencyColor: getSelfSufficiencyColor(city.selfSufficiencyRate)
    }));
    const filteredSummary = summarizeCities(selectedCities);
    const filteredGoodsOverview = buildGoodsOverview(selectedCities);
    const filteredScope = hasActiveSummaryFilters(this.filters);
    const activeEvents = this.moduleApi.getActiveGlobalEvents().map((event) => ({
      id: event.id,
      name: event.name || event.id,
      priority: Number(event?.stacking?.priority ?? event.priority ?? 100)
    }));

    return {
      hasError: false,
      filters: this.filters,
      cities: visibleCities,
      visibleCityCount: visibleCities.length,
      filteredCityCount: selectedCities.length,
      totalCityCount: model.cities.length,
      hiddenCityCount: Math.max(0, selectedCities.length - visibleCities.length),
      cityListLimited: selectedCities.length > visibleCities.length,
      summary: filteredSummary,
      isFilteredSummary: filteredScope,
      summaryScopeLabel: filteredScope ? "Суммарно по текущему списку городов" : "Суммарно по всей экономике",
      summaryCountLabel: filteredScope ? "Городов в текущем списке" : "Всего записей в экономике",
      stateOptions: selectStateOptions(model),
      regionOptions: selectRegionOptions(model, this.filters.state),
      cityTypeOptions: selectCityTypeOptions(model),
      sortOptions: CITY_SORT_OPTIONS,
      stateOverview: selectStateOverview(model).slice(0, 8),
      regionOverview: selectRegionOverview(model).slice(0, 10),
      topDeficitGoods: filteredGoodsOverview.topDeficitGoods,
      topSurplusGoods: filteredGoodsOverview.topSurplusGoods,
      activeEvents,
      hasActiveEvents: activeEvents.length > 0,
      canManageGlobalEvents: game.user?.isGM === true,
      dataSource: model.source,
      debugMode: game.settings.get(MODULE_ID, "debugMode")
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

    element.querySelectorAll("[data-filter]").forEach((field) => {
      const eventName = field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, (event) => {
        const target = event.currentTarget;
        const previousState = this.filters.state;
        const filterKey = target.dataset.filter;
        this.filters[filterKey] = target.value;

        if (filterKey === "state" && previousState !== target.value) {
          this.filters.regionId = "all";
        }

        if (filterKey === "search") {
          requestRenderWithFocus(`[data-filter='${filterKey}']`, target);
          return;
        }

        this.render({ force: true });
      });
    });

    element.querySelector("[data-action='reload-data']")?.addEventListener("click", async () => {
      await this.moduleApi.reloadData({ notify: true, rerender: true });
    });

    element.querySelector("[data-action='restore-data']")?.addEventListener("click", async () => {
      const confirmed = await confirmDataRestore();
      if (!confirmed) {
        return;
      }

      await this.moduleApi.resetWorldData({ notify: true });
    });

    element.querySelector("[data-action='open-world-routes']")?.addEventListener("click", async () => {
      await this.moduleApi.openWorldTradeRoutesApp();
    });

    element.querySelector("[data-action='open-states']")?.addEventListener("click", async () => {
      await this.moduleApi.openStatesApp();
    });

    element.querySelector("[data-action='open-global-events']")?.addEventListener("click", async () => {
      await this.moduleApi.openGlobalEventsApp();
    });

    element.querySelector("[data-action='open-inventory']")?.addEventListener("click", async () => {
      await this.moduleApi.openInventoryApp();
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
  }
}
