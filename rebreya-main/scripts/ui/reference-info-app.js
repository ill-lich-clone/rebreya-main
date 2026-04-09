import { MODULE_ID } from "../constants.js";
import { formatNumber, formatPercent, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function toSafeId(value) {
  return Array.from(String(value ?? "entry"))
    .map((character) => character.charCodeAt(0).toString(16))
    .join("-");
}

function formatFactValue(fact) {
  if (fact.format === "percent") {
    return formatPercent(fact.value, 1);
  }

  if (typeof fact.value === "number") {
    return formatNumber(fact.value, 0);
  }

  return String(fact.value ?? "");
}

function normalizeEntryForDisplay(entry, entryType) {
  const labelsByType = {
    state: ["Городов", "Население", "Производство", "Спрос", "Дефицит", "Самообеспечение"],
    region: ["Государство", "Городов", "Население", "Производство", "Спрос", "Самообеспечение"],
    transportMode: ["Стоимость шага", "Макс. шагов", "Макс. наценка"]
  };

  const subtitleByType = {
    state: "Государство",
    transportMode: "Режим перемещения"
  };

  const normalizedFacts = (entry.facts ?? []).map((fact, index) => ({
    ...fact,
    label: labelsByType[entryType]?.[index] ?? fact.label
  }));

  return {
    ...entry,
    subtitle: subtitleByType[entryType] ?? entry.subtitle,
    facts: normalizedFacts
  };
}

export class ReferenceInfoApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-reference-app"],
    window: {
      title: "Справочная запись",
      icon: "fa-solid fa-book-open",
      resizable: true
    },
    position: {
      width: 720,
      height: 620
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/reference-info-app.hbs`
    }
  };

  constructor(moduleApi, entryType, entryId, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.entryType = entryType;
    this.entryId = entryId;
  }

  get id() {
    return `${MODULE_ID}-reference-${this.entryType}-${toSafeId(this.entryId)}`;
  }

  async _prepareContext() {
    const rawEntry = this.moduleApi.getReferenceEntrySnapshot(this.entryType, this.entryId);
    const entry = rawEntry ? normalizeEntryForDisplay(rawEntry, this.entryType) : null;
    if (!entry) {
      return {
        hasError: true,
        errorMessage: "Справочная запись не найдена."
      };
    }

    return {
      hasError: false,
      entry: {
        ...entry,
        facts: (entry.facts ?? []).map((fact) => ({
          ...fact,
          displayValue: formatFactValue(fact)
        }))
      },
      isEditable: game.user?.isGM === true
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    element.querySelector("[data-action='save-reference']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      const textarea = element.querySelector("[name='description']");
      const description = textarea instanceof HTMLTextAreaElement ? textarea.value : "";

      event.currentTarget.disabled = true;
      try {
        await this.moduleApi.updateReferenceDescription(this.entryType, this.entryId, description);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to save reference description '${this.entryType}:${this.entryId}'.`, error);
        ui.notifications?.error("Не удалось сохранить описание.");
        event.currentTarget.disabled = false;
      }
    });
  }
}
