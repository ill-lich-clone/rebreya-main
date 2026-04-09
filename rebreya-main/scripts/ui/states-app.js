import { DEFAULT_STATE_SORT, MODULE_ID, STATE_SORT_OPTIONS } from "../constants.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function selectStates(model, filters = {}) {
  const search = normalizeSearch(filters.search);
  const sort = filters.sort ?? DEFAULT_STATE_SORT;

  const filtered = [...(model.stateSummaries ?? [])].filter((state) => {
    if (!search) {
      return true;
    }

    return String(state.name ?? "").toLowerCase().includes(search);
  });

  return filtered.sort((left, right) => {
    switch (sort) {
      case "deficit":
        return Number(right.totalDeficit ?? 0) - Number(left.totalDeficit ?? 0)
          || left.name.localeCompare(right.name, "ru");
      case "production":
        return Number(right.totalProduction ?? 0) - Number(left.totalProduction ?? 0)
          || left.name.localeCompare(right.name, "ru");
      case "name":
        return left.name.localeCompare(right.name, "ru");
      case "population":
      default:
        return Number(right.population ?? 0) - Number(left.population ?? 0)
          || left.name.localeCompare(right.name, "ru");
    }
  });
}

function toPercentValue(value) {
  return Number((Number(value ?? 0) * 100).toFixed(2));
}

function buildDutyChecklistRows(partnerOptions = [], policy = {}, effectivePolicy = {}) {
  const bilateralDuties = policy?.bilateralDuties ?? {};
  const effectiveBilateralDuties = effectivePolicy?.bilateralDuties ?? {};

  return (Array.isArray(partnerOptions) ? partnerOptions : []).map((partner) => {
    const targetStateId = String(partner.value ?? "");
    const hasOwnDuty = Object.prototype.hasOwnProperty.call(bilateralDuties, targetStateId);
    const baseDuty = Number(bilateralDuties[targetStateId] ?? 0);
    const effectiveDuty = Number(effectiveBilateralDuties[targetStateId] ?? baseDuty);

    return {
      targetStateId,
      targetStateName: String(partner.label ?? targetStateId),
      enabled: hasOwnDuty,
      valuePercent: toPercentValue(baseDuty),
      effectiveValuePercent: toPercentValue(effectiveDuty),
      deltaPercentValue: Number((toPercentValue(effectiveDuty) - toPercentValue(baseDuty)).toFixed(2))
    };
  });
}

export class StatesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-states-app`,
    classes: ["rebreya-main", "rebreya-states-app"],
    window: {
      title: "Меню государств",
      icon: "fa-solid fa-landmark",
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
      template: `modules/${MODULE_ID}/templates/states-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.searchRenderTimer = null;
    this.pendingFocus = null;
    this.partnerOptionsByState = {};
    this.filters = {
      search: "",
      sort: DEFAULT_STATE_SORT
    };
  }

  async _prepareContext() {
    const model = await this.moduleApi.getModel();
    const statePolicies = this.moduleApi.getStatePolicies();
    const allStates = [...(model.stateSummaries ?? [])].sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const stateEntries = new Map(
      (model.stateSummaries ?? []).map((state) => [state.id, this.moduleApi.getReferenceEntrySnapshot("state", state.id) ?? state])
    );
    const selectedStates = selectStates(model, this.filters);

    this.partnerOptionsByState = Object.fromEntries(
      allStates.map((state) => [
        state.id,
        allStates
          .filter((candidate) => candidate.id !== state.id)
          .map((candidate) => ({
            value: candidate.id,
            label: candidate.name
          }))
      ])
    );

    const states = selectedStates.map((state) => {
      const policy = statePolicies[state.id] ?? {};
      const referenceEntry = stateEntries.get(state.id);
      const effectivePolicy = this.moduleApi.getEffectiveStatePolicy(state.id);
      const activeEvents = this.moduleApi.getEventsAffectingState(state.id).map((event) => ({
        id: event.id,
        name: event.name || event.id
      }));

      return {
        ...state,
        description: String(referenceEntry?.description ?? ""),
        taxPercent: Number(policy.taxPercent ?? 0),
        taxPercentValue: Number((Number(policy.taxPercent ?? 0) * 100).toFixed(2)),
        effectiveTaxPercent: Number(effectivePolicy.taxPercent ?? policy.taxPercent ?? 0),
        effectiveTaxPercentValue: Number((Number(effectivePolicy.taxPercent ?? policy.taxPercent ?? 0) * 100).toFixed(2)),
        taxEventDeltaPercentValue: Number((Number(effectivePolicy?.eventDelta?.taxPercent ?? 0) * 100).toFixed(2)),
        generalDutyPercent: Number(policy.generalDutyPercent ?? 0),
        generalDutyPercentValue: Number((Number(policy.generalDutyPercent ?? 0) * 100).toFixed(2)),
        effectiveGeneralDutyPercent: Number(effectivePolicy.generalDutyPercent ?? policy.generalDutyPercent ?? 0),
        effectiveGeneralDutyPercentValue: Number((Number(effectivePolicy.generalDutyPercent ?? policy.generalDutyPercent ?? 0) * 100).toFixed(2)),
        dutyEventDeltaPercentValue: Number((Number(effectivePolicy?.eventDelta?.generalDutyPercent ?? 0) * 100).toFixed(2)),
        eventSourceNames: effectivePolicy?.eventDelta?.sourceEventNames ?? [],
        activeEvents,
        dutyChecklistRows: buildDutyChecklistRows(this.partnerOptionsByState[state.id] ?? [], policy, effectivePolicy)
      };
    });

    return {
      hasError: false,
      filters: this.filters,
      sortOptions: STATE_SORT_OPTIONS,
      states,
      totalStateCount: model.stateSummaries.length,
      filteredStateCount: states.length
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

    const syncDutyRow = (row) => {
      const enabledField = row.querySelector("[data-field='duty-enabled']");
      const valueField = row.querySelector("[data-field='duty-percent']");
      const enabled = enabledField instanceof HTMLInputElement ? enabledField.checked : false;
      if (valueField instanceof HTMLInputElement) {
        valueField.disabled = !enabled;
      }
      row.classList.toggle("is-enabled", enabled);
    };

    element.querySelectorAll("[data-duty-row]").forEach((row) => {
      syncDutyRow(row);
      row.querySelector("[data-field='duty-enabled']")?.addEventListener("change", () => {
        syncDutyRow(row);
      });
    });

    element.querySelectorAll("[data-action='save-state']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const stateId = event.currentTarget.dataset.stateId;
        const card = event.currentTarget.closest("[data-state-card]");
        if (!stateId || !card) {
          return;
        }

        const descriptionField = card.querySelector("[data-field='description']");
        const taxField = card.querySelector("[data-field='tax-percent']");
        const dutyField = card.querySelector("[data-field='general-duty-percent']");
        const bilateralDuties = {};

        card.querySelectorAll("[data-duty-row]").forEach((row) => {
          const targetStateId = String(row.dataset.targetStateId ?? "").trim();
          const enabledField = row.querySelector("[data-field='duty-enabled']");
          const valueField = row.querySelector("[data-field='duty-percent']");
          const isEnabled = enabledField instanceof HTMLInputElement ? enabledField.checked : false;
          const dutyPercent = valueField instanceof HTMLInputElement ? Number(valueField.value ?? 0) : 0;

          if (!targetStateId || !isEnabled || !Number.isFinite(dutyPercent)) {
            return;
          }

          bilateralDuties[targetStateId] = dutyPercent / 100;
        });

        const description = descriptionField instanceof HTMLTextAreaElement ? descriptionField.value : "";
        const taxPercent = taxField instanceof HTMLInputElement ? Number(taxField.value ?? 0) / 100 : 0;
        const generalDutyPercent = dutyField instanceof HTMLInputElement ? Number(dutyField.value ?? 0) / 100 : 0;

        event.currentTarget.disabled = true;
        try {
          await Promise.all([
            this.moduleApi.updateReferenceDescription("state", stateId, description),
            this.moduleApi.updateStatePolicy(stateId, {
              taxPercent,
              generalDutyPercent,
              bilateralDuties
            })
          ]);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to save state policy '${stateId}'.`, error);
          ui.notifications?.error("Не удалось сохранить настройки государства.");
        }
        finally {
          if (event.currentTarget instanceof HTMLButtonElement && event.currentTarget.isConnected) {
            event.currentTarget.disabled = false;
          }
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
  }
}
