import { MODULE_ID } from "../constants.js";
import { getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CosmologyApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-cosmology-app`,
    classes: ["rebreya-main", "rebreya-cosmology-app"],
    window: {
      title: "Космология Rebreya",
      icon: "fa-solid fa-solar-system",
      resizable: true
    },
    position: {
      width: 780,
      height: 620
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/cosmology-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
  }

  async _prepareContext() {
    const state = this.moduleApi?.getCosmologyState?.() ?? { mechanusEnabled: false };

    return {
      canManage: game.user?.isGM === true,
      mechanus: {
        enabled: state.mechanusEnabled === true,
        statusLabel: state.mechanusEnabled === true ? "ВКЛ" : "ВЫКЛ"
      }
    };
  }

  async #setMechanusEnabled(enabled) {
    try {
      await this.moduleApi?.setMechanusEnabled?.(enabled);
      ui.notifications?.info(enabled ? "Механус включён." : "Механус выключен.");
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to toggle Mechanus cosmology effect.`, error);
      ui.notifications?.error(error?.message || "Не удалось переключить эффект Механуса.");
      await this.render({ force: true });
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    element.querySelector("[data-action='toggle-mechanus']")?.addEventListener("change", (event) => {
      const enabled = event.currentTarget instanceof HTMLInputElement ? event.currentTarget.checked : false;
      void this.#setMechanusEnabled(enabled);
    });
  }
}
