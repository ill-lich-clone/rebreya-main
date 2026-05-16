import { MODULE_ID } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toInteger(value, fallback = 0) {
  return Math.floor(toNumber(value, fallback));
}

function normalizeInventorySourceType(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\-\s]+/gu, "");

  if (["material", "materials", "материал", "материалы"].includes(text)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(text)) {
    return "gear";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(text)) {
    return "magicItem";
  }

  if (["supply", "supplies", "resource", "resources", "запасы"].includes(text)) {
    return "supply";
  }

  return text || "";
}

function normalizeLookupText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function resolveCapacitySeverity(freeCapacityLb, usedPercentRaw) {
  if (toNumber(freeCapacityLb, 0) < 0) {
    return "danger";
  }
  if (toNumber(usedPercentRaw, 0) >= 90) {
    return "warning";
  }
  return "good";
}

function resolveSupplySeverity(daysLeft, hasEstimate) {
  if (!hasEstimate) {
    return "info";
  }
  const safeDays = toNumber(daysLeft, 0);
  if (safeDays <= 0) {
    return "danger";
  }
  if (safeDays <= 1) {
    return "warning";
  }
  return "good";
}

function resolveEnergySeverity(current, max) {
  const safeMax = toNumber(max, 0);
  if (safeMax <= 0) {
    return "info";
  }
  const ratioPercent = (toNumber(current, 0) / safeMax) * 100;
  if (ratioPercent <= 30) {
    return "danger";
  }
  if (ratioPercent <= 60) {
    return "warning";
  }
  return "good";
}

function toStateClass(severity) {
  const safeSeverity = ["danger", "warning", "good", "info"].includes(severity) ? severity : "info";
  return `rm-state-${safeSeverity}`;
}

function toStatusBadgeType(severity) {
  if (severity === "danger" || severity === "warning" || severity === "good") {
    return severity;
  }
  return "info";
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

function readCurrencyValuesFromRoot(root) {
  return {
    pp: toInteger(root?.querySelector("[data-field='currency-pp']")?.value, 0),
    gp: toInteger(root?.querySelector("[data-field='currency-gp']")?.value, 0),
    sp: toInteger(root?.querySelector("[data-field='currency-sp']")?.value, 0),
    cp: toInteger(root?.querySelector("[data-field='currency-cp']")?.value, 0)
  };
}

async function promptNumericValue({ title, label, value = "", min = 0, step = "0.01", confirmLabel = "Сохранить" }) {
  return new Promise((resolve) => {
    let settled = false;

    const dialog = new Dialog({
      title,
      content: `
        <form class="rm-purchase-dialog">
          <div class="rm-field">
            <label for="rm-number-prompt">${foundry.utils.escapeHTML(label)}</label>
            <input
              id="rm-number-prompt"
              type="number"
              min="${foundry.utils.escapeHTML(String(min))}"
              step="${foundry.utils.escapeHTML(String(step))}"
              value="${foundry.utils.escapeHTML(String(value ?? ""))}"
              data-field="numeric-value"
            >
          </div>
        </form>
      `,
      buttons: {
        confirm: {
          label: confirmLabel,
          callback: (html) => {
            const root = getDialogRoot(html);
            const input = root?.querySelector("[data-field='numeric-value']");
            settled = true;
            resolve(input?.value ?? null);
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
        const input = root?.querySelector("[data-field='numeric-value']");
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
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

async function confirmAction(title, content) {
  if (typeof DialogV2?.confirm === "function") {
    return DialogV2.confirm({
      window: {
        title
      },
      content
    });
  }

  return new Promise((resolve) => {
    Dialog.confirm({
      title,
      content,
      yes: () => resolve(true),
      no: () => resolve(false),
      defaultYes: false,
      close: () => resolve(false)
    });
  });
}

async function promptCurrencyDialog(currency = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const safeCurrency = {
      pp: toInteger(currency.pp, 0),
      gp: toInteger(currency.gp, 0),
      sp: toInteger(currency.sp, 0),
      cp: toInteger(currency.cp, 0)
    };

    const resolveWith = (payload) => {
      settled = true;
      resolve(payload);
    };

    const dialog = new Dialog({
      title: "Монеты склада",
      content: `
        <form class="rm-purchase-dialog rm-currency-dialog">
          <div class="rm-currency-dialog__grid">
            <div class="rm-field rm-field--narrow">
              <label>Пм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.pp}" data-field="currency-pp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Зм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.gp}" data-field="currency-gp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>См</label>
              <input type="number" min="0" step="1" value="${safeCurrency.sp}" data-field="currency-sp">
            </div>
            <div class="rm-field rm-field--narrow">
              <label>Мм</label>
              <input type="number" min="0" step="1" value="${safeCurrency.cp}" data-field="currency-cp">
            </div>
          </div>
          <p class="rm-muted">Сначала отредактируйте значения, затем при необходимости примените конвертацию.</p>
        </form>
      `,
      buttons: {
        save: {
          label: "Сохранить",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "save",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        normalized: {
          label: "Нормализация",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "normalized",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toGold: {
          label: "В золото",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "gp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toSilver: {
          label: "В серебро",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "sp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        toCopper: {
          label: "В медь",
          callback: (html) => {
            const root = getDialogRoot(html);
            resolveWith({
              action: "convert",
              mode: "cp",
              values: readCurrencyValuesFromRoot(root)
            });
          }
        },
        cancel: {
          label: "Отмена",
          callback: () => resolveWith(null)
        }
      },
      default: "save",
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

export class InventoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["rebreya-main", "rebreya-inventory-app"],
    window: {
      title: "Партийный инвентарь",
      icon: "fa-solid fa-box-open",
      resizable: true
    },
    position: {
      width: 1320,
      height: 900
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/inventory-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.activeTab = "inventory";
    this.search = "";
    this.typeFilter = "all";
    this.selectedNewMemberId = "";
    this.newMemberQuery = "";
    this.availablePartyActors = [];
    this.craftSearch = "";
    this.craftCrafterActorId = "";
    this.expandedPartyMembers = new Set();
    this.searchRenderTimeout = null;
    this.craftSearchRenderTimeout = null;
    this.actionFeedbackTimeout = null;
    this.contextMenuCleanup = null;
    this.focusRestore = null;
    this.renderListenersAbortController = null;
    this.actionFeedback = null;
  }

  get id() {
    return `${MODULE_ID}-inventory-app`;
  }

  setActiveTab(tab, { render = true } = {}) {
    const allowedTabs = new Set(["inventory", "party", "craft", "calendar"]);
    const nextTab = allowedTabs.has(tab) ? tab : "inventory";
    if (this.activeTab === nextTab) {
      return;
    }

    this.activeTab = nextTab;
    if (render) {
      this.render({ force: true });
    }
  }

  #setActionFeedback(type, message) {
    const safeType = ["success", "error", "warning", "info"].includes(type) ? type : "info";
    const safeMessage = String(message ?? "").trim();
    if (!safeMessage) {
      return;
    }

    this.actionFeedback = {
      type: safeType,
      message: safeMessage
    };

    window.clearTimeout(this.actionFeedbackTimeout);
    const feedbackMarker = `${safeType}:${safeMessage}`;
    this.actionFeedbackTimeout = window.setTimeout(() => {
      const currentMarker = this.actionFeedback
        ? `${this.actionFeedback.type}:${this.actionFeedback.message}`
        : "";
      if (currentMarker !== feedbackMarker) {
        return;
      }

      this.actionFeedback = null;
      this.actionFeedbackTimeout = null;
      if (getAppElement(this)) {
        this.render({ force: true });
      }
    }, 3500);
  }

  #resolveAvailableActorIdByName(query, availableActors = null) {
    const source = Array.isArray(availableActors) ? availableActors : this.availablePartyActors;
    const safeQuery = normalizeLookupText(query);
    if (!safeQuery || !source.length) {
      return "";
    }

    const exactMatch = source.find((actor) => normalizeLookupText(actor.name) === safeQuery) ?? null;
    if (exactMatch) {
      return exactMatch.id;
    }

    const startsWithMatches = source.filter((actor) => normalizeLookupText(actor.name).startsWith(safeQuery));
    if (startsWithMatches.length === 1) {
      return startsWithMatches[0].id;
    }

    return "";
  }

  #closeContextMenu() {
    if (typeof this.contextMenuCleanup === "function") {
      this.contextMenuCleanup();
    }
    this.contextMenuCleanup = null;
  }

  #openContextMenu({ x, y, title = "", actions = [] }) {
    this.#closeContextMenu();
    if (!Array.isArray(actions) || !actions.length) {
      return;
    }

    const menuRoot = document.createElement("div");
    menuRoot.className = "rm-context-menu";
    menuRoot.setAttribute("role", "menu");

    if (title) {
      const titleNode = document.createElement("p");
      titleNode.className = "rm-context-menu__title";
      titleNode.textContent = title;
      menuRoot.appendChild(titleNode);
    }

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rm-context-menu__item${action.danger ? " is-danger" : ""}`;
      if (action.icon) {
        const iconNode = document.createElement("i");
        iconNode.className = action.icon;
        button.appendChild(iconNode);
      }

      const labelNode = document.createElement("span");
      labelNode.textContent = action.label ?? "";
      button.appendChild(labelNode);

      button.addEventListener("click", () => {
        this.#closeContextMenu();
        try {
          action.callback?.();
        }
        catch (error) {
          console.error(`${MODULE_ID} | Context menu action failed.`, error);
        }
      });
      menuRoot.appendChild(button);
    }

    document.body.appendChild(menuRoot);

    const bounds = menuRoot.getBoundingClientRect();
    const maxLeft = window.innerWidth - bounds.width - 8;
    const maxTop = window.innerHeight - bounds.height - 8;
    const safeLeft = Math.max(8, Math.min(x, maxLeft));
    const safeTop = Math.max(8, Math.min(y, maxTop));

    menuRoot.style.left = `${safeLeft}px`;
    menuRoot.style.top = `${safeTop}px`;

    const handlePointerDown = (event) => {
      if (!menuRoot.contains(event.target)) {
        this.#closeContextMenu();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        this.#closeContextMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    this.contextMenuCleanup = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      menuRoot.remove();
    };
  }

  async #removePartyMember(actorId, actorName, element) {
    const safeActorId = String(actorId ?? "").trim();
    const safeActorName = String(actorName ?? "участника").trim() || "участника";
    if (!safeActorId) {
      return;
    }

    const confirmed = await confirmAction(
      "Удалить из группы",
      `<p>Удалить «${foundry.utils.escapeHTML(safeActorName)}» из состава группы?</p>`
    );
    if (!confirmed) {
      return;
    }

    try {
      this.#rememberExpandedPartyMembers(element);
      await this.moduleApi.removePartyMember(safeActorId);
      this.#setActionFeedback("success", `Участник «${safeActorName}» удалён из группы.`);
      ui.notifications?.info(`Участник «${safeActorName}» удалён из группы.`);
      bringAppToFront(this);
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to remove party member.`, error);
      const message = error.message || "Не удалось удалить участника группы.";
      this.#setActionFeedback("error", message);
      this.render({ force: true });
      ui.notifications?.error(message);
    }
  }

  async #resolveDroppedActor(dragData) {
    if (!dragData || typeof dragData !== "object") {
      return null;
    }

    const droppedDocument = dragData.uuid ? await fromUuid(dragData.uuid) : null;
    if (droppedDocument instanceof Actor) {
      return droppedDocument;
    }

    if (droppedDocument?.actor instanceof Actor) {
      return droppedDocument.actor;
    }

    if (dragData.type === "Actor" && dragData.id) {
      return game.actors.get(dragData.id) ?? null;
    }

    return null;
  }

  async _prepareContext() {
    try {
      const inventorySnapshot = await this.moduleApi.getInventorySnapshot({
        search: this.search,
        typeFilter: this.typeFilter,
        createActor: true
      });
      const partySnapshot = await this.moduleApi.getPartySnapshot();
      const craftSnapshot = await this.moduleApi.getCraftSnapshot({
        search: this.craftSearch,
        crafterActorId: this.craftCrafterActorId
      });
      const calendarSnapshot = this.moduleApi.getCalendarSnapshot();
      const availableActors = partySnapshot.availableActors ?? [];
      this.availablePartyActors = availableActors.map((actor) => ({
        id: actor.id,
        name: actor.name
      }));
      const totalCapacityLb = toNumber(partySnapshot.totalCapacityLb, 0);
      const inventoryWeight = toNumber(partySnapshot.inventoryWeight, 0);
      const freeCapacityLb = roundNumber(toNumber(partySnapshot.freeCapacityLb, 0), 2);
      const capacityUsedRawPercent = totalCapacityLb > 0
        ? roundNumber((inventoryWeight / totalCapacityLb) * 100, 1)
        : 0;
      const capacityUsedPercent = totalCapacityLb > 0
        ? Math.min(100, Math.max(0, capacityUsedRawPercent))
        : 0;
      const hasFoodEstimate = partySnapshot.foodDaysLeft !== null;
      const hasWaterEstimate = partySnapshot.waterDaysLeft !== null;
      const foodDaysLeft = hasFoodEstimate ? roundNumber(toNumber(partySnapshot.foodDaysLeft, 0), 1) : null;
      const waterDaysLeft = hasWaterEstimate ? roundNumber(toNumber(partySnapshot.waterDaysLeft, 0), 1) : null;
      const totalFoodPerDay = roundNumber(toNumber(partySnapshot.totalFoodPerDay, 0), 2);
      const totalWaterPerDay = roundNumber(toNumber(partySnapshot.totalWaterGalPerDay, 0), 2);
      const totalEnergyCurrent = toNumber(partySnapshot.totalEnergyCurrent, 0);
      const totalEnergyMax = toNumber(partySnapshot.totalEnergyMax, 0);
      const energyPercent = totalEnergyMax > 0
        ? Math.max(0, Math.min(100, roundNumber((totalEnergyCurrent / totalEnergyMax) * 100, 0)))
        : 0;

      const weightSeverity = resolveCapacitySeverity(freeCapacityLb, capacityUsedRawPercent);
      const foodSeverity = resolveSupplySeverity(foodDaysLeft, hasFoodEstimate);
      const waterSeverity = resolveSupplySeverity(waterDaysLeft, hasWaterEstimate);
      const energySeverity = resolveEnergySeverity(totalEnergyCurrent, totalEnergyMax);
      const overloadLb = roundNumber(Math.abs(freeCapacityLb), 2);

      const dashboard = {
        weight: {
          className: toStateClass(weightSeverity),
          badgeType: toStatusBadgeType(weightSeverity),
          badgeLabel: freeCapacityLb < 0
            ? `Перегруз ${overloadLb} фнт.`
            : `Загрузка ${roundNumber(capacityUsedRawPercent, 1)}%`,
          note: freeCapacityLb < 0
            ? `Свободно: -${overloadLb} фнт.`
            : `Свободно: ${roundNumber(freeCapacityLb, 2)} фнт.`,
          meterClass: `is-${weightSeverity}`,
          meterPercent: capacityUsedPercent
        },
        food: {
          className: toStateClass(foodSeverity),
          badgeType: toStatusBadgeType(foodSeverity),
          daysLabel: hasFoodEstimate ? `${foodDaysLeft} дн.` : "Без нормы",
          note: hasFoodEstimate
            ? (foodDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalFoodPerDay} / день`)
            : "Задайте расход в группе"
        },
        water: {
          className: toStateClass(waterSeverity),
          badgeType: toStatusBadgeType(waterSeverity),
          daysLabel: hasWaterEstimate ? `${waterDaysLeft} дн.` : "Без нормы",
          note: hasWaterEstimate
            ? (waterDaysLeft <= 0 ? "Запас исчерпан" : `Расход ${totalWaterPerDay} / день`)
            : "Задайте расход в группе"
        },
        energy: {
          className: toStateClass(energySeverity),
          badgeType: toStatusBadgeType(energySeverity),
          ratioLabel: `${roundNumber(totalEnergyCurrent, 0)} / ${roundNumber(totalEnergyMax, 0)}`,
          note: totalEnergyMax > 0
            ? `Готовность ${energyPercent}%`
            : "Нет участников"
        }
      };

      const currency = inventorySnapshot.summary.currency ?? {
        pp: 0,
        gp: 0,
        sp: 0,
        cp: 0,
        totalCopper: 0,
        label: inventorySnapshot.summary.currencyLabel
      };
      const partyMembers = (partySnapshot.members ?? []).map((member) => ({
        ...member,
        expanded: this.expandedPartyMembers.has(member.actorId)
      }));
      const addMemberDisabled = availableActors.length === 0;
      const consumeDayDisabled = toInteger(partySnapshot.memberCount, 0) <= 0;
      const craftHasCrafters = (craftSnapshot.crafters ?? []).length > 0;
      const processDayDisabled = (craftSnapshot.queue ?? []).length === 0;
      const partyAlerts = [];
      if (freeCapacityLb < 0) {
        partyAlerts.push({
          type: "danger",
          message: `Перегруз: ${overloadLb} фнт.`
        });
      }
      if (hasFoodEstimate && toNumber(foodDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Еда закончилась: пополните запас."
        });
      }
      if (hasWaterEstimate && toNumber(waterDaysLeft, 0) <= 0) {
        partyAlerts.push({
          type: "warning",
          message: "Вода закончилась: пополните запас."
        });
      }
      const actionFeedback = this.actionFeedback
        ? {
            ...this.actionFeedback,
            className: `rm-inline-status rm-inline-status--${this.actionFeedback.type}`
          }
        : null;

      if (!availableActors.some((actor) => actor.id === this.selectedNewMemberId)) {
        this.selectedNewMemberId = "";
      }

      const resolvedActorIdByQuery = this.#resolveAvailableActorIdByName(this.newMemberQuery, this.availablePartyActors);
      if (resolvedActorIdByQuery) {
        this.selectedNewMemberId = resolvedActorIdByQuery;
      }

      if (!String(this.newMemberQuery ?? "").trim() && this.selectedNewMemberId) {
        const selectedActor = availableActors.find((actor) => actor.id === this.selectedNewMemberId) ?? null;
        this.newMemberQuery = selectedActor?.name ?? "";
      }

      if (!craftSnapshot.crafters?.some((entry) => entry.actorId === this.craftCrafterActorId)) {
        this.craftCrafterActorId = craftSnapshot.crafters?.[0]?.actorId ?? "";
      }

      return {
        hasError: false,
        actor: inventorySnapshot.actor ?? {
          id: "",
          name: "Партийный инвентарь",
          img: "icons/svg/item-bag.svg",
          currencyLabel: inventorySnapshot.summary.currencyLabel,
          canEdit: false
        },
        activeTab: this.activeTab,
        appDomId: this.id,
        search: this.search,
        typeFilter: this.typeFilter,
        craftSearch: this.craftSearch,
        craftCrafterActorId: this.craftCrafterActorId,
        inventory: inventorySnapshot.items,
        inventoryCount: inventorySnapshot.items.length,
        emptyInventory: inventorySnapshot.emptyInventory,
        summary: {
          ...inventorySnapshot.summary,
          currency,
          partyCapacityLb: partySnapshot.totalCapacityLb,
          freeCapacityLb,
          freeCapacityClass: freeCapacityLb < 0 ? "rm-negative" : "rm-positive"
        },
        party: {
          ...partySnapshot,
          freeCapacityLb,
          foodDaysLeft,
          waterDaysLeft,
          members: partyMembers,
          capacityUsedPercent,
          capacityUsedRawPercent,
          alerts: partyAlerts,
          dashboard,
          addMemberDisabled,
          addMemberDisabledReason: addMemberDisabled
            ? "Нет доступных актёров для добавления в группу."
            : "",
          consumeDayDisabled,
          consumeDayDisabledReason: consumeDayDisabled
            ? "Добавьте хотя бы одного участника, чтобы списать день."
            : "",
          availableActors: availableActors.map((actor) => ({
            ...actor,
            selected: actor.id === this.selectedNewMemberId
          })),
          addMemberQuery: this.newMemberQuery,
          hasFoodEstimate,
          hasWaterEstimate
        },
        craft: {
          ...craftSnapshot,
          crafters: (craftSnapshot.crafters ?? []).map((entry) => ({
            ...entry,
            selected: entry.actorId === this.craftCrafterActorId
          })),
          hasQueue: (craftSnapshot.queue ?? []).length > 0,
          hasCrafters: craftHasCrafters,
          queueDisabledReason: craftHasCrafters
            ? ""
            : "Добавьте участника в группу, чтобы запустить крафт.",
          processDayDisabled,
          processDayDisabledReason: processDayDisabled
            ? "Очередь крафта пуста."
            : ""
        },
        calendar: {
          ...calendarSnapshot,
          yearValue: calendarSnapshot.year,
          monthValue: calendarSnapshot.month,
          dayValue: calendarSnapshot.day
        },
        typeOptions: [
          { value: "all", label: "Все", selected: this.typeFilter === "all" },
          { value: "gear", label: "Снаряжение", selected: this.typeFilter === "gear" },
          { value: "material", label: "Материалы", selected: this.typeFilter === "material" },
          { value: "supply", label: "Запасы", selected: this.typeFilter === "supply" },
          { value: "custom", label: "Прочее", selected: this.typeFilter === "custom" }
        ],
        tabs: {
          isInventory: this.activeTab === "inventory",
          isParty: this.activeTab === "party",
          isCraft: this.activeTab === "craft",
          isCalendar: this.activeTab === "calendar"
        },
        actionFeedback,
        canManage: game.user?.isGM === true
      };
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to prepare inventory app.`, error);
      return {
        hasError: true,
        errorMessage: error.message || "Не удалось подготовить партийный инвентарь."
      };
    }
  }

  async #openItemSheet(itemId) {
    const actor = await this.moduleApi.inventoryService.getInventoryActor({ create: true });
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет уже не найден в складе.");
    }

    await item.sheet?.render?.(true);
    bringAppToFront(item.sheet);
  }

  async #promptSupply(resourceKey) {
    const quantity = await promptNumericValue({
      title: resourceKey === "water" ? "Добавить воду" : "Добавить еду",
      label: resourceKey === "water" ? "Сколько галлонов добавить" : "Сколько фунтов добавить",
      value: "0",
      min: 0,
      step: "0.01",
      confirmLabel: "Добавить"
    });

    if (quantity === null) {
      return;
    }

    await this.moduleApi.addPartySupply(resourceKey, quantity);
    const successMessage = resourceKey === "water"
      ? "Запас воды обновлён."
      : "Запас еды обновлён.";
    this.#setActionFeedback("success", successMessage);
    ui.notifications?.info(successMessage);
    bringAppToFront(this);
  }

  #readCurrencyFromElement(element) {
    const root = element.querySelector("[data-action='edit-currency-root']");
    return {
      pp: toInteger(root?.dataset.currencyPp, 0),
      gp: toInteger(root?.dataset.currencyGp, 0),
      sp: toInteger(root?.dataset.currencySp, 0),
      cp: toInteger(root?.dataset.currencyCp, 0)
    };
  }

  #rememberExpandedPartyMembers(element) {
    const rows = element.querySelectorAll(".rm-party-row[data-actor-id]");
    if (!rows.length) {
      return;
    }

    const expanded = new Set();
    rows.forEach((row) => {
      const actorId = String(row.dataset.actorId ?? "").trim();
      if (actorId && row.open) {
        expanded.add(actorId);
      }
    });
    this.expandedPartyMembers = expanded;
  }

  #restoreFocusToInput(element) {
    const focus = this.focusRestore;
    this.focusRestore = null;
    if (!focus?.action) {
      return;
    }

    const selector = focus.action === "craft-search"
      ? "[data-action='craft-search']"
      : "[data-action='search']";
    const input = element.querySelector(selector);
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    input.focus();
    const start = Math.max(0, Math.min(toInteger(focus.start, input.value.length), input.value.length));
    const end = Math.max(start, Math.min(toInteger(focus.end, input.value.length), input.value.length));
    input.setSelectionRange(start, end);
  }

  async #notifyAdvanceResult(result) {
    const supplyTotals = result?.cycles?.supplyTotals ?? {};
    const craftCompleted = Number(result?.cycles?.craft?.completedCount ?? 0);
    const shortageParts = [];
    const traderReset = result?.traderReset ?? {};

    if (toNumber(supplyTotals.foodShortage, 0) > 0) {
      shortageParts.push(`еда: нехватка ${roundNumber(supplyTotals.foodShortage, 2)}`);
    }
    if (toNumber(supplyTotals.waterShortage, 0) > 0) {
      shortageParts.push(`вода: нехватка ${roundNumber(supplyTotals.waterShortage, 2)}`);
    }

    const shortageText = shortageParts.length ? ` (${shortageParts.join(", ")})` : "";
    const dateLabel = result?.to?.dateLabel ? ` Текущая дата: ${result.to.dateLabel}.` : "";
    const traderResetText = traderReset?.triggered
      ? ` Ассортименты торговцев обновлены (${toInteger(traderReset.monthResetCount, 0)} мес. переходов).`
      : "";
    const eventActivation = result?.eventActivation ?? {};
    const eventText = (toNumber(eventActivation?.started?.length, 0) > 0 || toNumber(eventActivation?.ended?.length, 0) > 0)
      ? ` Ивенты: старт ${toInteger(eventActivation?.started?.length, 0)}, завершение ${toInteger(eventActivation?.ended?.length, 0)}.`
      : "";
    const message = `Пропущено ${result.daysAdvanced} дн.: еда -${roundNumber(supplyTotals.foodSpent ?? 0, 2)}, вода -${roundNumber(supplyTotals.waterSpent ?? 0, 2)}, завершено крафта ${craftCompleted}.${shortageText}${dateLabel}${traderResetText}${eventText}`;
    this.#setActionFeedback("success", message);
    ui.notifications?.info(message);
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) {
      return;
    }

    this.#closeContextMenu();
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = new AbortController();
    const listenerOptions = { signal: this.renderListenersAbortController.signal };

    bringAppToFront(this);
    this.#rememberExpandedPartyMembers(element);

    element.querySelectorAll(".rm-party-row[data-actor-id]").forEach((row) => {
      row.addEventListener("toggle", (event) => {
        const actorId = String(event.currentTarget.dataset.actorId ?? "").trim();
        if (!actorId) {
          return;
        }

        if (event.currentTarget.open) {
          this.expandedPartyMembers.add(actorId);
        }
        else {
          this.expandedPartyMembers.delete(actorId);
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-item-drag]").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const uuid = event.currentTarget.dataset.itemUuid;
        if (!uuid || !event.dataTransfer) {
          return;
        }

        event.dataTransfer.effectAllowed = "all";
        const payload = JSON.stringify({
          type: "Item",
          uuid
        });

        for (const mimeType of ["text/plain", "text", "application/json", "text/uri-list"]) {
          try {
            event.dataTransfer.setData(mimeType, payload);
          }
          catch (_error) {
            // Ignore unsupported mime types
          }
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='switch-tab']").forEach((button) => {
      button.addEventListener("click", (event) => {
        this.setActiveTab(event.currentTarget.dataset.tab || "inventory");
      }, listenerOptions);
    });

    element.querySelector("[data-action='open-actor-sheet']")?.addEventListener("click", async () => {
      try {
        const actor = await this.moduleApi.openPartyInventorySheet();
        bringAppToFront(actor?.sheet);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to open party inventory sheet.`, error);
        ui.notifications?.error(error.message || "Не удалось открыть лист партийного инвентаря.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='add-food']")?.addEventListener("click", async () => {
      try {
        await this.#promptSupply("food");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party food.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить запас еды.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='add-water']")?.addEventListener("click", async () => {
      try {
        await this.#promptSupply("water");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party water.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить запас воды.");
      }
    }, listenerOptions);

    element.querySelector("[data-action='search']")?.addEventListener("input", (event) => {
      this.search = event.currentTarget.value ?? "";
      this.focusRestore = {
        action: "search",
        start: event.currentTarget.selectionStart ?? this.search.length,
        end: event.currentTarget.selectionEnd ?? this.search.length
      };
      window.clearTimeout(this.searchRenderTimeout);
      this.searchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='type-filter']")?.addEventListener("change", (event) => {
      this.typeFilter = event.currentTarget.value || "all";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='edit-currency']").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const currentCurrency = this.#readCurrencyFromElement(element);
          const action = await promptCurrencyDialog(currentCurrency);
          if (!action) {
            return;
          }

          if (action.values) {
            await this.moduleApi.updatePartyCurrency(action.values);
          }

          if (action.action === "convert") {
            await this.moduleApi.convertPartyCurrency(action.mode || "normalized");
            ui.notifications?.info("Монеты конвертированы.");
          }
          else {
            ui.notifications?.info("Монеты обновлены.");
          }
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to edit currency.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить монеты.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-compendium-entry']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const { sourceType, sourceId, sourceName } = event.currentTarget.dataset;
        const normalizedSourceType = normalizeInventorySourceType(sourceType);
        try {
          const document = await this.moduleApi.openTradeEntry(normalizedSourceType, sourceId, sourceName);
          bringAppToFront(document?.sheet);
          if (!document) {
            ui.notifications?.warn("Не удалось найти запись в компендии.");
          }
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory compendium entry '${normalizedSourceType}:${sourceId}'.`, error);
          ui.notifications?.error("Не удалось открыть запись предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='open-item-sheet']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.#openItemSheet(event.currentTarget.dataset.itemId);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to open inventory item sheet.`, error);
          ui.notifications?.error(error.message || "Не удалось открыть лист предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='edit-item-quantity']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const currentQuantity = event.currentTarget.dataset.quantity ?? "0";
        const itemName = event.currentTarget.dataset.itemName ?? "Предмет";

        try {
          const nextQuantity = await promptNumericValue({
            title: `Количество: ${itemName}`,
            label: "Новое количество",
            value: currentQuantity,
            min: 0,
            step: "0.01",
            confirmLabel: "Сохранить"
          });

          if (nextQuantity === null) {
            return;
          }

          await this.moduleApi.updateInventoryItemQuantity(itemId, nextQuantity);
          ui.notifications?.info(`Количество предмета «${itemName}» обновлено.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update inventory item quantity.`, error);
          ui.notifications?.error(error.message || "Не удалось изменить количество предмета.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='break-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const maxQuantity = Math.max(1, toInteger(event.currentTarget.dataset.quantity, 1));
        try {
          const quantity = await promptNumericValue({
            title: `Разбор: ${itemName}`,
            label: `Сколько разбирать (1-${maxQuantity})`,
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Разобрать"
          });
          if (quantity === null) {
            return;
          }

          const safeQuantity = Math.max(1, Math.min(maxQuantity, toInteger(quantity, 1)));
          const result = await this.moduleApi.breakInventoryItemToMaterial(itemId, safeQuantity);
          ui.notifications?.info(`Разобрано: ${result.breakQuantity} x ${result.itemName} -> ${result.materialWeight} фнт. (${result.materialName}).`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to break inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось разобрать предмет.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='delete-item']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const itemId = event.currentTarget.dataset.itemId;
        const itemName = event.currentTarget.dataset.itemName ?? "предмет";
        const confirmed = await confirmAction(
          "Удалить предмет",
          `<p>Удалить «${foundry.utils.escapeHTML(itemName)}» из партийного склада?</p>`
        );
        if (!confirmed) {
          return;
        }

        try {
          await this.moduleApi.deleteInventoryItem(itemId);
          ui.notifications?.info(`Предмет «${itemName}» удалён из партийного склада.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to delete inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось удалить предмет.");
        }
      }, listenerOptions);
    });

    const dropzone = element.querySelector("[data-action='inventory-dropzone']");
    if (dropzone) {
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("is-dragover");
      }, listenerOptions);

      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");

        try {
          const dragData = TextEditor.getDragEventData(event);
          await this.moduleApi.importInventoryDrop(dragData);
          ui.notifications?.info("Предмет перенесён в партийный склад.");
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to import dropped inventory item.`, error);
          ui.notifications?.error(error.message || "Не удалось перенести предмет в склад.");
        }
      }, listenerOptions);
    }

    const addMemberQueryInput = element.querySelector("[data-action='add-member-query']");
    const syncAddMemberSelection = () => {
      const query = addMemberQueryInput?.value ?? "";
      this.newMemberQuery = query;
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(query);
    };

    addMemberQueryInput?.addEventListener("input", syncAddMemberSelection, listenerOptions);
    addMemberQueryInput?.addEventListener("change", syncAddMemberSelection, listenerOptions);

    element.querySelector("[data-action='add-member']")?.addEventListener("click", async () => {
      this.selectedNewMemberId = this.#resolveAvailableActorIdByName(this.newMemberQuery);
      if (!this.selectedNewMemberId) {
        this.#setActionFeedback("warning", "Введите имя участника и выберите актёра из доступных.");
        this.render({ force: true });
        ui.notifications?.warn("Выберите доступного актёра по имени.");
        return;
      }

      try {
        const actorName = this.availablePartyActors.find((actor) => actor.id === this.selectedNewMemberId)?.name ?? "участник";
        await this.moduleApi.addPartyMember(this.selectedNewMemberId);
        this.newMemberQuery = "";
        this.selectedNewMemberId = "";
        this.#setActionFeedback("success", "Участник добавлен в группу.");
        ui.notifications?.info(`Участник «${actorName}» добавлен в группу.`);
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to add party member.`, error);
        const message = error.message || "Не удалось добавить участника группы.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    const partyDropzone = element.querySelector("[data-action='party-dropzone']");
    if (partyDropzone) {
      partyDropzone.addEventListener("dragover", (event) => {
        let dragData = null;
        try {
          dragData = TextEditor.getDragEventData(event);
        }
        catch (_error) {
          return;
        }

        const isActorDrag = dragData?.type === "Actor" || String(dragData?.uuid ?? "").includes("Actor.");
        if (!isActorDrag) {
          return;
        }

        event.preventDefault();
        partyDropzone.classList.add("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("dragleave", () => {
        partyDropzone.classList.remove("is-dragover");
      }, listenerOptions);

      partyDropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        partyDropzone.classList.remove("is-dragover");

        try {
          const dragData = TextEditor.getDragEventData(event);
          const actorDocument = await this.#resolveDroppedActor(dragData);
          if (!(actorDocument instanceof Actor)) {
            ui.notifications?.warn("Перетащите лист персонажа или актёра.");
            return;
          }

          const isAvailable = this.availablePartyActors.some((actor) => actor.id === actorDocument.id);
          if (!isAvailable) {
            ui.notifications?.warn(`«${actorDocument.name}» нельзя добавить: актёр недоступен или уже в группе.`);
            return;
          }

          const confirmed = await confirmAction(
            "Добавить участника",
            `<p>Добавить «${foundry.utils.escapeHTML(actorDocument.name)}» в группу?</p>`
          );
          if (!confirmed) {
            return;
          }

          await this.moduleApi.addPartyMember(actorDocument.id);
          this.newMemberQuery = "";
          this.selectedNewMemberId = "";
          this.#setActionFeedback("success", `Участник «${actorDocument.name}» добавлен в группу.`);
          ui.notifications?.info(`Участник «${actorDocument.name}» добавлен в группу.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to add party member by drop.`, error);
          ui.notifications?.error(error.message || "Не удалось добавить участника из перетаскивания.");
        }
      }, listenerOptions);
    }

    element.querySelectorAll("[data-action='party-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const fieldName = event.currentTarget.dataset.field;
        const nextValue = event.currentTarget.value ?? "";
        if (!actorId || !fieldName) {
          return;
        }

        const patch = {};
        patch[fieldName] = nextValue;

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMember(actorId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member field '${fieldName}'.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить участника группы.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-energy-current']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const currentEnergy = event.currentTarget.value;
        if (!actorId) {
          return;
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.setPartyMemberEnergy(actorId, currentEnergy);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to set party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить энергию участника.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-restore-energy']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const actorName = event.currentTarget.dataset.actorName ?? "участник";
        if (!actorId) {
          return;
        }

        try {
          const daysValue = await promptNumericValue({
            title: `Восстановить энергию: ${actorName}`,
            label: "На сколько дней восстановить энергию",
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Восстановить"
          });
          if (daysValue === null) {
            return;
          }

          const days = Math.max(1, toInteger(daysValue, 1));
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.restorePartyMemberEnergy(actorId, days);
          ui.notifications?.info(`Энергия ${actorName} восстановлена на ${days} дн.`);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to restore party member energy.`, error);
          ui.notifications?.error(error.message || "Не удалось восстановить энергию.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='party-tool-field']").forEach((field) => {
      field.addEventListener("change", async (event) => {
        const actorId = event.currentTarget.dataset.actorId;
        const toolId = event.currentTarget.dataset.toolId;
        const fieldName = event.currentTarget.dataset.field;
        if (!actorId || !toolId || !fieldName) {
          return;
        }

        const patch = {};
        if (fieldName === "owned" || fieldName === "prof") {
          patch[fieldName] = Boolean(event.currentTarget.checked);
        }
        else {
          patch[fieldName] = toNumber(event.currentTarget.value, 0);
        }

        try {
          this.#rememberExpandedPartyMembers(element);
          await this.moduleApi.updatePartyMemberTool(actorId, toolId, patch);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to update party member tool state.`, error);
          ui.notifications?.error(error.message || "Не удалось обновить инструмент участника.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='consume-day']")?.addEventListener("click", async () => {
      try {
        const result = await this.moduleApi.advanceCalendarDays(1, {
          consumeSupplies: true,
          applyEnergy: true,
          processCraft: true
        });
        await this.#notifyAdvanceResult(result);
        bringAppToFront(this);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to consume party day.`, error);
        const message = error.message || "Не удалось списать день группы.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    element.querySelector("[data-action='craft-search']")?.addEventListener("input", (event) => {
      this.craftSearch = event.currentTarget.value ?? "";
      this.focusRestore = {
        action: "craft-search",
        start: event.currentTarget.selectionStart ?? this.craftSearch.length,
        end: event.currentTarget.selectionEnd ?? this.craftSearch.length
      };
      window.clearTimeout(this.craftSearchRenderTimeout);
      this.craftSearchRenderTimeout = window.setTimeout(() => {
        this.render({ force: true });
      }, 180);
    }, listenerOptions);

    element.querySelector("[data-action='craft-crafter']")?.addEventListener("change", (event) => {
      this.craftCrafterActorId = event.currentTarget.value || "";
      this.render({ force: true });
    }, listenerOptions);

    element.querySelectorAll("[data-action='craft-queue']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const gearId = event.currentTarget.dataset.gearId;
        const gearName = event.currentTarget.dataset.gearName ?? "предмет";
        try {
          const quantityValue = await promptNumericValue({
            title: `Крафт: ${gearName}`,
            label: "Сколько единиц поставить в крафт",
            value: "1",
            min: 1,
            step: "1",
            confirmLabel: "Запустить"
          });
          if (quantityValue === null) {
            return;
          }

          await this.moduleApi.queueCraftTask({
            gearId,
            quantity: Math.max(1, toInteger(quantityValue, 1)),
            crafterActorId: this.craftCrafterActorId
          });
          this.#setActionFeedback("success", `Крафт «${gearName}» добавлен в очередь.`);
          ui.notifications?.info(`Крафт «${gearName}» добавлен в очередь.`);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to queue craft task.`, error);
          const message = error.message || "Не удалось запустить крафт.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    element.querySelectorAll(".rm-party-row__summary").forEach((summaryNode) => {
      summaryNode.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-party-row[data-actor-id]");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const actorId = String(row.dataset.actorId ?? "").trim();
        const actorName = String(row.dataset.actorName ?? "").trim() || "участника";
        if (!actorId) {
          return;
        }

        this.#openContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: actorName,
          actions: [
            {
              label: "Удалить из группы",
              icon: "fa-solid fa-user-minus",
              danger: true,
              callback: async () => {
                await this.#removePartyMember(actorId, actorName, element);
              }
            }
          ]
        });
      }, listenerOptions);
    });

    element.querySelectorAll(".rm-compact-item").forEach((itemRow) => {
      itemRow.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const row = event.currentTarget.closest(".rm-compact-item");
        if (!(row instanceof HTMLElement)) {
          return;
        }

        const itemName = String(row.dataset.itemName ?? "Предмет").trim() || "Предмет";
        const actionButtons = {
          openCompendium: row.querySelector("[data-action='open-compendium-entry']"),
          openItemSheet: row.querySelector("[data-action='open-item-sheet']"),
          editQuantity: row.querySelector("[data-action='edit-item-quantity']"),
          breakItem: row.querySelector("[data-action='break-item']"),
          deleteItem: row.querySelector("[data-action='delete-item']")
        };

        const actions = [];
        if (actionButtons.openCompendium) {
          actions.push({
            label: "Открыть запись",
            icon: "fa-solid fa-circle-question",
            callback: () => actionButtons.openCompendium.click()
          });
        }
        if (actionButtons.openItemSheet) {
          actions.push({
            label: "Лист предмета",
            icon: "fa-solid fa-file-lines",
            callback: () => actionButtons.openItemSheet.click()
          });
        }
        if (actionButtons.editQuantity) {
          actions.push({
            label: "Изменить количество",
            icon: "fa-solid fa-pen",
            callback: () => actionButtons.editQuantity.click()
          });
        }
        if (actionButtons.breakItem) {
          actions.push({
            label: "Разобрать",
            icon: "fa-solid fa-hammer",
            callback: () => actionButtons.breakItem.click()
          });
        }
        if (actionButtons.deleteItem) {
          actions.push({
            label: "Удалить",
            icon: "fa-solid fa-trash",
            danger: true,
            callback: () => actionButtons.deleteItem.click()
          });
        }

        this.#openContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: itemName,
          actions
        });
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='craft-cancel']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const taskId = event.currentTarget.dataset.taskId;
        const taskName = event.currentTarget.dataset.taskName ?? "задача";
        const confirmed = await confirmAction(
          "Отменить крафт",
          `<p>Отменить «${foundry.utils.escapeHTML(taskName)}»?</p>`
        );
        if (!confirmed) {
          return;
        }

        try {
          await this.moduleApi.cancelCraftTask(taskId);
          ui.notifications?.info("Задача крафта отменена.");
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to cancel craft task.`, error);
          ui.notifications?.error(error.message || "Не удалось отменить крафт.");
        }
      }, listenerOptions);
    });

    element.querySelector("[data-action='craft-process-day']")?.addEventListener("click", async () => {
      try {
        const result = await this.moduleApi.processCraftOneDay();
        this.#setActionFeedback("success", `Продвинут день крафта. Завершено: ${result.completedCount}.`);
        ui.notifications?.info(`Продвинут день крафта. Завершено: ${result.completedCount}.`);
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to process craft day.`, error);
        const message = error.message || "Не удалось продвинуть крафт на день.";
        this.#setActionFeedback("error", message);
        this.render({ force: true });
        ui.notifications?.error(message);
      }
    }, listenerOptions);

    element.querySelector("[data-action='calendar-set']")?.addEventListener("click", async () => {
      try {
        const year = toInteger(element.querySelector("[data-field='calendar-year']")?.value, 1);
        const month = toInteger(element.querySelector("[data-field='calendar-month']")?.value, 1);
        const day = toInteger(element.querySelector("[data-field='calendar-day']")?.value, 1);
        await this.moduleApi.setCalendarDate(year, month, day);
        ui.notifications?.info("Календарь обновлён.");
      }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to set calendar date.`, error);
        ui.notifications?.error(error.message || "Не удалось изменить дату календаря.");
      }
    }, listenerOptions);

    element.querySelectorAll("[data-action='calendar-pick-day']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          const year = toInteger(event.currentTarget.dataset.year, 1);
          const month = toInteger(event.currentTarget.dataset.month, 1);
          const day = toInteger(event.currentTarget.dataset.day, 1);
          await this.moduleApi.setCalendarDate(year, month, day);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to pick calendar day.`, error);
          ui.notifications?.error(error.message || "Не удалось выбрать дату календаря.");
        }
      }, listenerOptions);
    });

    element.querySelectorAll("[data-action='calendar-advance']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const unit = event.currentTarget.dataset.unit || "day";
        const value = Math.max(1, toInteger(event.currentTarget.dataset.value, 1));
        try {
          let result = null;
          if (unit === "week") {
            result = await this.moduleApi.advanceCalendarWeeks(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }
          else if (unit === "month") {
            result = await this.moduleApi.advanceCalendarMonths(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }
          else {
            result = await this.moduleApi.advanceCalendarDays(value, {
              consumeSupplies: true,
              applyEnergy: true,
              processCraft: true
            });
          }

          await this.#notifyAdvanceResult(result);
          bringAppToFront(this);
        }
        catch (error) {
          console.error(`${MODULE_ID} | Failed to advance calendar.`, error);
          const message = error.message || "Не удалось продвинуть календарь.";
          this.#setActionFeedback("error", message);
          this.render({ force: true });
          ui.notifications?.error(message);
        }
      }, listenerOptions);
    });

    this.#restoreFocusToInput(element);
  }

  async _preClose(options) {
    this.#closeContextMenu();
    window.clearTimeout(this.searchRenderTimeout);
    window.clearTimeout(this.craftSearchRenderTimeout);
    window.clearTimeout(this.actionFeedbackTimeout);
    this.searchRenderTimeout = null;
    this.craftSearchRenderTimeout = null;
    this.actionFeedbackTimeout = null;
    this.renderListenersAbortController?.abort();
    this.renderListenersAbortController = null;
    return super._preClose ? super._preClose(options) : undefined;
  }
}

