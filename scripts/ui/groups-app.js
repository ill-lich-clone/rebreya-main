import { MODULE_ID } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toTimestamp(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function formatDateTime(value) {
  const timestamp = toTimestamp(value);
  if (!timestamp) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(new Date(timestamp));
  }
  catch (_error) {
    return String(timestamp);
  }
}

function formatCurrency(currency = {}) {
  const rows = [
    ["pp", "пм"],
    ["gp", "зм"],
    ["sp", "см"],
    ["cp", "мм"]
  ];

  return rows
    .map(([key, label]) => `${Math.max(0, Math.floor(Number(currency[key] ?? 0) || 0))} ${label}`)
    .join(", ");
}

function getGroupActors() {
  return toArray(game.actors?.contents)
    .filter((actor) => actor?.type === "group")
    .sort((left, right) => String(left?.name ?? "").localeCompare(String(right?.name ?? ""), "ru"));
}

function getGroupMemberCount(actor) {
  return toArray(actor?.system?.members).length;
}

function mapMigrationInfo(groupState = {}) {
  const migration = groupState?.migration && typeof groupState.migration === "object" ? groupState.migration : {};
  const legacyMergedAt = toTimestamp(migration.legacyInventoryMergedAt);
  const legacyInventoryActorId = String(migration.legacyInventoryActorId ?? "").trim();
  const mergePairs = migration.legacyInventoryMergePairs && typeof migration.legacyInventoryMergePairs === "object"
    ? Object.values(migration.legacyInventoryMergePairs)
    : [];
  const completedPairCount = mergePairs.filter((pair) => toTimestamp(pair?.completedAt)).length;

  return {
    hasLegacyMerge: Boolean(legacyMergedAt || completedPairCount || legacyInventoryActorId),
    legacyMergedAtLabel: formatDateTime(legacyMergedAt),
    legacyInventoryActorId,
    completedPairCount
  };
}

function mapGroupActor(actor, registry) {
  const groupState = registry?.groupsById?.[actor.id] ?? null;
  const initializedAt = toTimestamp(groupState?.initializedAt);
  const migration = mapMigrationInfo(groupState ?? {});

  return {
    id: actor.id,
    name: actor.name ?? "Группа",
    img: actor.img || "icons/svg/mystery-man.svg",
    memberCount: getGroupMemberCount(actor),
    registered: Boolean(groupState),
    active: String(registry?.activeGroupActorId ?? "") === actor.id,
    initializedAtLabel: formatDateTime(initializedAt),
    hasInitializedAt: Boolean(initializedAt),
    migration,
    canRegister: !groupState,
    canSetActive: Boolean(groupState) && String(registry?.activeGroupActorId ?? "") !== actor.id,
    canMergeLegacy: Boolean(groupState)
  };
}

function mergeResultMessage(result = {}) {
  if (result.noop) {
    return "Legacy-инвентарь уже перенесён или источник не найден.";
  }

  return [
    `Объединено позиций: ${Number(result.mergedItems ?? 0)}`,
    `создано: ${Number(result.createdItems ?? 0)}`,
    `монеты: ${formatCurrency(result.mergedCurrency)}`
  ].join("; ");
}

export class GroupsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-groups-app`,
    classes: ["rebreya-main", "rebreya-groups-app"],
    window: {
      title: "Группы Rebreya",
      icon: "fa-solid fa-users",
      resizable: true
    },
    position: {
      width: 920,
      height: 720
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/groups-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
  }

  async _prepareContext() {
    const registry = this.moduleApi?.getGroupRegistry?.() ?? { activeGroupActorId: "", groupsById: {} };
    const groups = getGroupActors().map((actor) => mapGroupActor(actor, registry));

    return {
      groups,
      hasGroups: groups.length > 0,
      registeredCount: groups.filter((group) => group.registered).length,
      activeGroupName: groups.find((group) => group.active)?.name ?? ""
    };
  }

  async #openGroupSheet(groupId) {
    const actor = game.actors?.get?.(groupId) ?? game.actors?.contents?.find((entry) => entry?.id === groupId) ?? null;
    if (!actor) {
      ui.notifications?.warn("Группа не найдена.");
      return;
    }

    const sheet = actor.sheet ?? null;
    if (!sheet || typeof sheet.render !== "function") {
      ui.notifications?.warn("Лист группы недоступен.");
      return;
    }

    await sheet.render({ force: true });
    bringAppToFront(sheet);
  }

  async #runGroupAction(groupId, action) {
    const safeGroupId = String(groupId ?? "").trim();
    if (!safeGroupId) {
      return;
    }

    try {
      if (action === "open-sheet") {
        await this.#openGroupSheet(safeGroupId);
        return;
      }

      if (action === "register-group") {
        await this.moduleApi.registerPartyGroup(safeGroupId);
        ui.notifications?.info("Группа зарегистрирована в Rebreya.");
      }
      else if (action === "set-active-group") {
        await this.moduleApi.setActivePartyGroup(safeGroupId);
        ui.notifications?.info("Активная группа Rebreya обновлена.");
      }
      else if (action === "merge-legacy-inventory") {
        const result = await this.moduleApi.mergeLegacyInventoryIntoGroup(safeGroupId);
        ui.notifications?.info(mergeResultMessage(result));
      }

      await this.render({ force: true });
      bringAppToFront(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Groups app action '${action}' failed.`, error);
      ui.notifications?.error(error?.message || "Не удалось выполнить действие с группой.");
      await this.render({ force: true });
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    element.querySelectorAll("[data-action][data-group-id]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const target = event.currentTarget;
        void this.#runGroupAction(target.dataset.groupId, target.dataset.action);
      });
    });
  }
}
