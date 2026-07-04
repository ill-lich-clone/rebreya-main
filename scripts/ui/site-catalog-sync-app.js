/**
 * GM control to import site catalogues into managed compendia (integration
 * ТЗ §10.6): a small ApplicationV2 with a «Синхронизировать» button per
 * resource + «всё», plus last-sync status. Makes the console-only sync
 * services (game.rebreyaMain.siteSpellsCompendium / siteArticlesCompendium)
 * usable from the module settings.
 */
import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { SITE_SPELLS_COMPENDIUM_NAME } from "../data/site-spells-compendium.js";
import { SITE_ARTICLES_COMPENDIUM_NAME } from "../data/site-articles-compendium.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// resource key → { label, pack collection, service getter }
const RESOURCES = [
  {
    key: "spells",
    label: "Заклинания",
    pack: `world.${SITE_SPELLS_COMPENDIUM_NAME}`,
    service: (api) => api?.siteSpellsCompendium,
  },
  {
    key: "articles",
    label: "Статьи",
    pack: `world.${SITE_ARTICLES_COMPENDIUM_NAME}`,
    service: (api) => api?.siteArticlesCompendium,
  },
];

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch (_error) {
    return "—";
  }
}

export class SiteCatalogSyncApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "rebreya-site-catalog-sync",
    classes: ["rebreya-main", "rebreya-site-catalog-sync-app"],
    window: {
      title: "Rebreya — синхронизация справочников с сайтом",
      icon: "fa-solid fa-cloud-arrow-down",
      resizable: true,
    },
    position: { width: 560, height: "auto" },
  };

  static PARTS = {
    main: { root: true, template: `modules/${MODULE_ID}/templates/site-catalog-sync-app.hbs` },
  };

  constructor(moduleApi = null, options = {}) {
    super(options);
    this.moduleApi = moduleApi ?? game.rebreyaMain ?? null;
  }

  async _prepareContext() {
    const lastSync = game.settings.get(MODULE_ID, SETTINGS_KEYS.SITE_LAST_CATALOG_SYNC) ?? {};
    return {
      isGM: game.user?.isGM === true,
      resources: RESOURCES.map((r) => ({
        key: r.key,
        label: r.label,
        packCount: game.packs.get(r.pack)?.index?.size ?? 0,
        lastSync: formatDate(lastSync?.[r.key]?.at),
      })),
    };
  }

  async _runSync(keys) {
    const api = this.moduleApi ?? game.rebreyaMain;
    if (!game.user?.isGM) {
      ui.notifications?.warn("Синхронизация доступна только Мастеру.");
      return;
    }
    for (const key of keys) {
      const resource = RESOURCES.find((r) => r.key === key);
      const service = resource?.service(api);
      if (!service?.sync) continue;
      try {
        await service.sync({ notify: true });
      } catch (error) {
        ui.notifications?.error(`Синхронизация «${resource.label}» не удалась: ${error.message}`);
      }
    }
    await this.render();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element instanceof HTMLElement ? this.element : this.element?.[0];
    if (!el) return;

    for (const button of el.querySelectorAll("[data-action='sync']")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        button.disabled = true;
        await this._runSync([event.currentTarget.dataset.resource]);
      });
    }
    el.querySelector("[data-action='sync-all']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.currentTarget.disabled = true;
      await this._runSync(RESOURCES.map((r) => r.key));
    });
  }
}

/** Settings-menu entry point (registered from settings.js). */
export function openSiteCatalogSyncApp() {
  new SiteCatalogSyncApp().render(true);
}
