import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";

function installFoundryApplicationStub() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      escapeHTML: (value) => String(value ?? "")
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
        .replace(/'/gu, "&#039;")
    },
    applications: {
      api: {
        ApplicationV2: class {
          constructor(_options = {}) {}
          async _onRender() {}
        },
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: {}
      }
    }
  };

  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function createFakeElement({ dataset = {}, closest = () => null } = {}) {
  return new HTMLElement({ dataset, closest });
}

function installMinimalDom() {
  const previousHTMLElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  let appendedMenu = null;

  globalThis.HTMLElement = class FakeHTMLElement {
    constructor({ dataset = {}, closest = () => null } = {}) {
      this.dataset = dataset;
      this.style = {};
      this.children = [];
      this.listeners = {};
      this.open = false;
      this.className = "";
      this.textContent = "";
      this.type = "";
      this.value = "";
      this.disabled = false;
      this.closest = closest;
    }

    addEventListener(type, listener, options = {}) {
      const signal = options?.signal;
      if (signal?.aborted) {
        return;
      }
      this.listeners[type] ??= [];
      this.listeners[type].push(listener);
      signal?.addEventListener("abort", () => {
        const index = this.listeners[type].indexOf(listener);
        if (index >= 0) {
          this.listeners[type].splice(index, 1);
        }
      }, { once: true });
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    setAttribute(name, value) {
      this[name] = value;
    }

    getBoundingClientRect() {
      return {
        width: 120,
        height: 80
      };
    }

    contains(target) {
      return target === this || this.children.includes(target);
    }

    remove() {
      this.removed = true;
    }
  };

  globalThis.window = {
    innerWidth: 1024,
    innerHeight: 768,
    clearTimeout() {},
    setTimeout() {
      return 0;
    },
    getComputedStyle: () => ({
      zIndex: "100"
    })
  };
  globalThis.document = {
    body: {
      appendChild(node) {
        appendedMenu = node;
      }
    },
    createElement: () => createFakeElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  return {
    get appendedMenu() {
      return appendedMenu;
    },
    restore() {
      globalThis.HTMLElement = previousHTMLElement;
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  };
}

function collectText(node) {
  return [
    node?.textContent ?? "",
    ...(node?.children ?? []).map((child) => collectText(child))
  ].join("");
}

function createModuleApi({
  getGroupContext,
  inventorySnapshot,
  partySnapshot = {},
  craftSnapshot,
  downtimeSnapshot,
  downtimeError,
  travelSnapshot,
  transportSnapshot,
  calendarSnapshot,
  calendarPreview,
  calls = []
}) {
  return {
    async getInventorySnapshot() {
      return inventorySnapshot ?? {
        actor: null,
        hasActor: false,
        items: [],
        allItems: [],
        emptyInventory: true,
        groupContextError: "",
        summary: {
          distinctCount: 0,
          totalQuantity: 0,
          totalWeight: 0,
          foodLb: 0,
          waterGal: 0,
          currencyLabel: "0 мм",
          currency: {
            pp: 0,
            gp: 0,
            sp: 0,
            cp: 0,
            totalCopper: 0,
            label: "0 мм"
          }
        }
      };
    },
    async getPartySnapshot() {
      return {
        availableActors: [],
        members: [],
        memberCount: 0,
        totalCapacityLb: 0,
        totalFoodPerDay: 0,
        totalWaterGalPerDay: 0,
        totalEnergyCurrent: 0,
        totalEnergyMax: 0,
        inventoryWeight: 0,
        freeCapacityLb: 0,
        foodDaysLeft: null,
        waterDaysLeft: null,
        canManage: false,
        ...partySnapshot
      };
    },
    async getCraftSnapshot() {
      return craftSnapshot ?? {
        crafters: [],
        queue: [],
        projects: []
      };
    },
    getCalendarSnapshot() {
      return calendarSnapshot ?? {
        isoDate: "0001-01-01",
        year: 1,
        month: 1,
        day: 1,
        cells: []
      };
    },
    previewCalendarTransition(options) {
      calls.push(["previewCalendarTransition", options]);
      return typeof calendarPreview === "function"
        ? calendarPreview(options)
        : calendarPreview;
    },
    async setCalendarDate(year, month, day, options) {
      calls.push(["setCalendarDate", year, month, day, options]);
      return {};
    },
    async advanceCalendarDays(value, options) {
      calls.push(["advanceCalendarDays", value, options]);
      return { daysAdvanced: value, cycles: {} };
    },
    async advanceCalendarWeeks(value, options) {
      calls.push(["advanceCalendarWeeks", value, options]);
      return { daysAdvanced: value * 7, cycles: {} };
    },
    async advanceCalendarMonths(value, options) {
      calls.push(["advanceCalendarMonths", value, options]);
      return { daysAdvanced: value * 30, cycles: {} };
    },
    async getTravelSnapshot() {
      calls.push(["getTravelSnapshot"]);
      return travelSnapshot ?? {
        available: true,
        canAdvance: false,
        cityOptions: [],
        modeOptions: [],
        plan: null,
        progress: {
          traveledMiles: 0,
          remainingMiles: 0,
          percent: 0
        }
      };
    },
    async getTransportSnapshot(options = {}) {
      calls.push(["getTransportSnapshot", options]);
      return transportSnapshot ?? {
        available: true,
        warning: "",
        canManage: false,
        vehicles: [],
        hasVehicles: false,
        activeVehicle: null,
        activeTransportId: "",
        effectiveSpeedMph: 3,
        speedLabel: "3 мили/час",
        speedSourceLabel: "Пешком",
        cargoLabel: "-",
        durabilityLabel: "-"
      };
    },
    async setActiveTransport(activeTransportId) {
      calls.push(["setActiveTransport", activeTransportId]);
      return {};
    },
    async updateTransportInstanceState(payload) {
      calls.push(["updateTransportInstanceState", payload]);
      return {};
    },
    async setTravelRoute(payload) {
      calls.push(["setTravelRoute", payload]);
      return {};
    },
    async advanceTravelHours(hours, options) {
      calls.push(["advanceTravelHours", hours, options]);
      return {};
    },
    async clearTravelRoute() {
      calls.push(["clearTravelRoute"]);
      return {};
    },
    openCityApp(cityId) {
      calls.push(["openCityApp", cityId]);
    },
    getDowntimeSnapshot() {
      calls.push(["getDowntimeSnapshot"]);
      if (downtimeError) {
        throw downtimeError;
      }
      return downtimeSnapshot ?? {
        canManage: false,
        canSubmit: false,
        members: [],
        requests: [],
        actionCatalog: []
      };
    },
    async grantDowntimeWeeks(payload) {
      calls.push(["grantDowntimeWeeks", payload]);
      return {};
    },
    async revokeDowntimeWeeks(payload) {
      calls.push(["revokeDowntimeWeeks", payload]);
      return {};
    },
    async clearDowntimeHistory() {
      calls.push(["clearDowntimeHistory"]);
      return {};
    },
    async createDowntimeRequest(payload) {
      calls.push(["createDowntimeRequest", payload]);
      return {};
    },
    async setDowntimeRequestStatus(requestId, status, options) {
      calls.push(["setDowntimeRequestStatus", requestId, status, options]);
      return {};
    },
    async setDowntimeRequestChecks(requestId, checks) {
      calls.push(["setDowntimeRequestChecks", requestId, checks]);
      return {};
    },
    async approveCraftDowntimeRequest(payload) {
      calls.push(["approveCraftDowntimeRequest", payload]);
      return { id: "craft-project-1" };
    },
    async pauseCraftProject(projectId, options) {
      calls.push(["pauseCraftProject", projectId, options]);
      return { id: projectId };
    },
    async resumeCraftProject(projectId, options) {
      calls.push(["resumeCraftProject", projectId, options]);
      return { id: projectId };
    },
    async cancelCraftProject(projectId, options) {
      calls.push(["cancelCraftProject", projectId, options]);
      return { id: projectId };
    },
    async reconcileCraftProject(projectId, options) {
      calls.push(["reconcileCraftProject", projectId, options]);
      return { id: projectId };
    },
    getGroupContext
  };
}

function createFakeControl({ dataset = {}, value = "", disabled = false } = {}) {
  const control = createFakeElement({ dataset });
  control.value = value;
  control.disabled = disabled;
  return control;
}

async function dispatchClick(button, { required = true } = {}) {
  const listener = button.listeners.click?.[0];
  if (!listener) {
    assert.equal(required, false, "expected click listener");
    return false;
  }
  await listener({
    currentTarget: button,
    preventDefault() {}
  });
  return true;
}

test("InventoryApp _prepareContext surfaces known no-group display context errors", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => {
      throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
    }
  }));

  try {
    const context = await app._prepareContext();

    assert.equal(context.hasError, false);
    assert.equal(context.group, null);
    assert.equal(context.groupContextError, GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp _prepareContext never creates Foundry documents while rendering", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const calls = [];
  const moduleApi = createModuleApi({
    calls,
    getGroupContext: () => null
  });
  const getInventorySnapshot = moduleApi.getInventorySnapshot.bind(moduleApi);
  moduleApi.getInventorySnapshot = async (options) => {
    calls.push(["getInventorySnapshot", options]);
    return getInventorySnapshot(options);
  };
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(moduleApi);

  try {
    await app._prepareContext();
    assert.deepEqual(calls.find((call) => call[0] === "getInventorySnapshot"), [
      "getInventorySnapshot",
      {
        search: "",
        typeFilter: "all",
        createActor: false
      }
    ]);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp keeps page width while book tabs render externally", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");

  try {
    assert.equal(InventoryApp.DEFAULT_OPTIONS.position.width, 1320);
    assert.equal(InventoryApp.DEFAULT_OPTIONS.position.height, 920);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp exposes the active group crest and edit permission", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const groupActor = {
    id: "group-a",
    name: "Workshop Crew",
    img: "group.webp",
    flags: { "rebreya-main": { partyInventoryCrest: "crest.webp" } },
    getFlag: () => "crest.webp",
    system: { members: [] }
  };
  const { InventoryApp } = await import(
    `../scripts/ui/inventory-app.js?crest-context=${Date.now()}`
  );
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor,
      groupId: "group-a",
      memberActorIds: []
    }),
    partySnapshot: { canManage: true }
  }));

  try {
    const context = await app._prepareContext();
    assert.deepEqual(context.partyIdentity, {
      name: "Workshop Crew",
      crestUrl: "crest.webp",
      canEditCrest: true
    });
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp keeps crest editing disabled for non-managers", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const groupActor = {
    id: "group-a",
    name: "Workshop Crew",
    img: "group.webp",
    getFlag: () => "",
    system: { members: [] }
  };
  const { InventoryApp } = await import(
    `../scripts/ui/inventory-app.js?crest-permission=${Date.now()}`
  );
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor,
      groupId: "group-a",
      memberActorIds: []
    }),
    partySnapshot: { canManage: false }
  }));

  try {
    const context = await app._prepareContext();
    assert.equal(context.partyIdentity.crestUrl, "group.webp");
    assert.equal(context.partyIdentity.canEditCrest, false);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp exposes the active tab label for the shared party header", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(
    `../scripts/ui/inventory-app.js?active-tab-label=${Date.now()}`
  );
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  const labels = new Map([
    ["inventory", "Инвентарь"],
    ["party", "Группа"],
    ["craft", "Крафт"],
    ["calendar", "Календарь"],
    ["travel", "Путешествие"],
    ["transport", "Транспорт"],
    ["downtime", "Простой"]
  ]);

  try {
    for (const [tab, label] of labels) {
      app.setActiveTab(tab, { render: false });
      const context = await app._prepareContext();
      assert.equal(context.activeTabLabel, label);
    }

    app.setActiveTab("unsupported-tab", { render: false });
    const fallbackContext = await app._prepareContext();
    assert.equal(fallbackContext.activeTab, "inventory");
    assert.equal(fallbackContext.activeTabLabel, "Инвентарь");
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp crest action persists a new image and rerenders", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const crestButton = createFakeElement();
  const root = createFakeElement({ closest: () => root });
  root.querySelector = (selector) => (
    selector === "[data-action='edit-party-crest']" ? crestButton : null
  );
  root.querySelectorAll = () => [];

  const flagWrites = [];
  const pickerRenders = [];
  let picker = null;
  class Picker {
    constructor(options) {
      this.options = options;
      picker = this;
    }

    render(options) {
      pickerRenders.push(options);
      return this;
    }
  }
  globalThis.foundry.applications.apps = {
    FilePicker: { implementation: Picker }
  };

  const groupActor = {
    img: "old-crest.webp",
    getFlag: () => "old-crest.webp",
    async setFlag(scope, key, value) {
      flagWrites.push([scope, key, value]);
    }
  };
  const { InventoryApp } = await import(
    `../scripts/ui/inventory-app.js?crest-action=${Date.now()}`
  );
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  let renderCalls = 0;
  app.element = root;
  app.groupActor = groupActor;
  app.render = async () => {
    renderCalls += 1;
  };

  try {
    await app._onRender({}, {});
    await dispatchClick(crestButton);
    await picker.options.callback("new-crest.webp");

    assert.deepEqual(pickerRenders, [{ force: true }]);
    assert.deepEqual(flagWrites, [
      ["rebreya-main", "partyInventoryCrest", "new-crest.webp"]
    ]);
    assert.equal(renderCalls, 1);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp renders a compact header summary without redundant warehouse details", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const pageIndex = template.indexOf('class="rm-shell rm-inventory-shell rm-inventory-shell--compact rm-inventory-book__page scrollable"');
  const tabsIndex = template.indexOf('class="rm-inventory-book__tabs"');

  assert.match(template, /class="rm-inventory-book"/u);
  assert.ok(pageIndex >= 0, "expected the scrollable book page");
  assert.ok(tabsIndex > pageIndex, "expected the tab rail after the book page");
  assert.match(template, /class="rm-inventory-book__controls"/u);
  assert.match(template, /class="rm-inventory-book__identity"/u);
  assert.match(template, /partyIdentity\.crestUrl/u);
  assert.match(template, /partyIdentity\.name/u);
  assert.match(template, /class="rm-inventory-book__section-title">\{\{activeTabLabel\}\}/u);
  assert.match(template, /class="rm-currency-compact rm-inventory-book__wallet"/u);
  assert.match(
    template,
    /\{\{#if partyIdentity\.canEditCrest\}\}[\s\S]*data-action="edit-party-crest"[\s\S]*\{\{else\}\}/u
  );
  assert.match(template, /class="rm-inventory-book__summary"/u);
  assert.match(template, /class="rm-inventory-book__cargo[^"]*"/u);
  assert.match(template, /class="rm-inventory-book__cargo-bar"[^>]*tabindex="0"[^>]*aria-describedby="rm-inventory-cargo-tooltip"/u);
  assert.match(template, /class="rm-inventory-book__cargo-tooltip"[^>]*id="rm-inventory-cargo-tooltip"/u);
  assert.match(template, /class="rm-inventory-book__supply-row"/u);
  assert.doesNotMatch(template, /class="rm-inventory-book__header-shade"/u);
  assert.doesNotMatch(template, /class="rm-compact-pill-strip rm-compact-pill-strip--primary"/u);
  assert.doesNotMatch(template, /Подробнее по складу/u);
  assert.doesNotMatch(template, /class="rm-compact-pill-details"/u);
  assert.doesNotMatch(
    template,
    /class="rm-inventory-book__cargo \{\{party\.dashboard\.weight\.className\}\}"/u
  );
  assert.doesNotMatch(
    template,
    /class="rm-inventory-book__supply \{\{party\.dashboard\.energy\.className\}\}"/u
  );
  assert.doesNotMatch(
    template,
    /rm-inventory-book__cargo-fill \{\{party\.dashboard\.weight\.meterClass\}\}/u
  );
  assert.doesNotMatch(template, /Партийная логистика/u);
  assert.doesNotMatch(template, /<span>Группа:\s*\{\{group\.name\}\}/u);
  assert.doesNotMatch(template, /<h3>Склад<\/h3>/u);
  assert.doesNotMatch(template, /Перетащите предмет в область склада/u);
  assert.doesNotMatch(template, /class="rm-inventory-value-summary"/u);
  assert.match(
    template,
    /class="rm-inventory-book__inventory-meta"[\s\S]*inventoryCount[\s\S]*totalItemValueLabel/u
  );

  const walletIndex = template.indexOf('class="rm-currency-compact rm-inventory-book__wallet"');
  const inventoryBranchIndex = template.indexOf("{{#if tabs.isInventory}}");
  assert.ok(walletIndex >= 0, "expected the shared currency wallet");
  assert.ok(walletIndex < inventoryBranchIndex, "expected the wallet outside the inventory-only branch");

  for (const tab of ["inventory", "party", "craft", "calendar", "travel", "transport", "downtime"]) {
    assert.match(template, new RegExp(`data-action="switch-tab"[^>]+data-tab="${tab}"`, "u"));
  }

  assert.match(template, /class="rm-inventory-book__actions"[\s\S]*data-action="open-actor-sheet"/u);
  assert.match(template, /\{\{#if canManage\}\}[\s\S]*data-action="add-food"[\s\S]*data-action="add-water"[\s\S]*\{\{\/if\}\}/u);
});

test("InventoryApp positions external book tabs and keeps the character-style artwork mask", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.rebreya-inventory-app \.window-content\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*visible;/u);
  assert.doesNotMatch(css, /\.rebreya-inventory-app \.window-content\s*\{[^}]*grid-template-columns:/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book\s*\{[^}]*display:\s*contents;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__page\s*\{[^}]*overflow-y:\s*auto;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__header\s*\{[^}]*height:\s*300px;[^}]*min-height:\s*300px;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__header::before\s*\{[^}]*var\(--rm-party-inventory-header-image\)[^}]*mask-image:\s*linear-gradient\(180deg,\s*#000 0%,\s*#000 58%,\s*rgb\(0 0 0 \/ 0\.72\) 75%,\s*transparent 100%\);/u);
  assert.doesNotMatch(css, /\.rebreya-inventory-app \.rm-inventory-book__header-shade/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__identity\s*\{[^}]*display:\s*grid;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__crest-button\s*\{/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__crest-image\s*\{/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__title\s*\{[^}]*font-family:\s*var\(--dnd5e-font-modesto\)[^}]*font-size:\s*36px;/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__section-title\s*\{[^}]*margin:\s*7px 0 0 80px;[^}]*font-family:\s*var\(--dnd5e-font-modesto\)[^}]*font-size:\s*32px;/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__wallet\s*\{[^}]*width:\s*260px;[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__wallet \.rm-coin-badge\s*\{[^}]*min-height:\s*28px;/u
  );
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__inventory-meta\s*\{/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__action\s*\{[^}]*min-height:\s*36px;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__tabs\s*\{[^}]*position:\s*absolute;[^}]*right:\s*-\d+px;[^}]*grid-auto-flow:\s*row;/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__summary\s*\{/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__cargo-tooltip\s*\{/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__cargo-fill\s*\{[^}]*background:\s*var\(--rm-inventory-meter-neutral\);/u
  );
  assert.doesNotMatch(css, /\.rm-inventory-book__cargo-fill\.is-warning/u);
  assert.doesNotMatch(css, /\.rm-inventory-book__cargo-fill\.is-danger/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__cargo-bar:hover \.rm-inventory-book__cargo-tooltip/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__cargo-bar:focus-visible \.rm-inventory-book__cargo-tooltip/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__tab\.is-active\s*\{/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__tab:hover/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__tab:focus-visible/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__tabs\s*\{[^}]*top:\s*16[0-9]px;/u
  );
});

test("InventoryApp hides its external book tabs while Foundry marks the window minimized", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(
    css,
    /\.rebreya-inventory-app\.minimized \.rm-inventory-book__tabs\s*\{[^}]*display:\s*none;/u
  );
});

test("InventoryApp keeps the party crest in a dedicated identity grid track", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.doesNotMatch(template, /rm-inventory-book__identity-column/u);
  assert.match(template, /class="rm-inventory-book__crest-button rm-inventory-book__identity-crest"/u);
  assert.match(template, /class="rm-inventory-book__crest rm-inventory-book__identity-crest"/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__identity\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*124px minmax\(0,\s*1fr\);[^}]*grid-template-areas:\s*"crest heading"\s*"wallet wallet";/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__identity-crest\s*\{[^}]*grid-area:\s*crest;[^}]*justify-self:\s*center;/u
  );
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__heading\s*\{[^}]*grid-area:\s*heading;/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__wallet\s*\{[^}]*grid-area:\s*wallet;[^}]*justify-self:\s*start;/u
  );
});

test("InventoryApp uses one surface component across compact header panels", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.equal((template.match(/rm-inventory-book__panel/gu) ?? []).length, 15);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header \.rm-inventory-book__panel\s*\{[^}]*border:\s*1px solid rgb\(var\(--rm-color-gold-rgb\) \/ 0\.3\);[^}]*border-radius:\s*6px;[^}]*background:\s*rgb\(var\(--rm-color-ink-rgb\) \/ 0\.94\);[^}]*box-shadow:/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app :is\(\s*\.rm-inventory-book__metric-heading span,\s*\.rm-inventory-book__supply span,\s*\.rm-inventory-book__wallet \.rm-coin-badge span\s*\)\s*\{[^}]*font-size:\s*10px;/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app :is\(\s*\.rm-inventory-book__metric-heading strong,\s*\.rm-inventory-book__supply strong,\s*\.rm-inventory-book__wallet \.rm-coin-badge strong\s*\)\s*\{[^}]*font-size:\s*13px;/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__wallet \.rm-coin-badge--gp strong\s*\{[^}]*color:\s*var\(--rm-accent\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__wallet \.rm-coin-badge--cp strong\s*\{[^}]*color:\s*#c7865a;/u
  );
});

test("InventoryApp uses its own workshop artwork without changing the character header", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const workshopAsset = await stat(new URL(
    "../assets/ui/rebreya-party-inventory-workshop.webp",
    import.meta.url
  ));

  assert.ok(workshopAsset.size > 0);
  assert.match(
    css,
    /--rm-party-inventory-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-party-inventory-workshop\.webp"\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header::before\s*\{[^}]*var\(--rm-party-inventory-header-image\)/u
  );
  assert.match(
    css,
    /--rm-character-sheet-header-image:\s*url\("\/modules\/rebreya-main\/assets\/ui\/rebreya-character-header\.webp"\);/u
  );
});

test("InventoryApp routes header artwork by tab and keeps one five-layer travel parallax", async () => {
  const template = await readFile(
    new URL("../templates/inventory-app.hbs", import.meta.url),
    "utf8"
  );
  const css = await readFile(
    new URL("../styles/main.css", import.meta.url),
    "utf8"
  );
  const headerIndex = template.indexOf("<header");
  const headerTagEnd = template.indexOf(">", headerIndex);
  const headerOpeningTag = template.slice(headerIndex, headerTagEnd + 1);
  const identityIndex = template.indexOf('class="rm-inventory-book__identity"');
  const travelGuardIndex = template.indexOf("{{#if tabs.isTravel}}", headerTagEnd);
  const travelGuardEnd = template.indexOf("\n        {{/if}}", travelGuardIndex);
  const travelBlock = template.slice(travelGuardIndex, travelGuardEnd);

  assert.ok(headerIndex >= 0, "expected the shared inventory header");
  assert.match(
    headerOpeningTag,
    /class="rm-inventory-book__header\{\{#if tabs\.isInventory\}\} rm-inventory-book__header--inventory\{\{\/if\}\}\{\{#if tabs\.isTravel\}\} rm-inventory-book__header--travel\{\{\/if\}\}\{\{#if tabs\.isTransport\}\} rm-inventory-book__header--transport\{\{\/if\}\}"/u
  );
  assert.ok(
    travelGuardIndex > headerIndex && travelGuardIndex < identityIndex,
    "expected the travel-only parallax before shared header content"
  );
  assert.equal((template.match(/<video\b/gu) ?? []).length, 0);
  assert.equal((travelBlock.match(/<video\b/gu) ?? []).length, 0);
  assert.equal((travelBlock.match(/<source\b/gu) ?? []).length, 0);
  assert.match(
    travelBlock,
    /class="rm-inventory-book__travel-parallax"[\s\S]*aria-hidden="true"/u
  );
  assert.equal(
    (travelBlock.match(/class="rm-inventory-book__travel-layer /gu) ?? []).length,
    5
  );
  assert.deepEqual(
    [...travelBlock.matchAll(/data-parallax-layer="([^"]+)"/gu)].map((match) => match[1]),
    ["sky", "far-mountains", "middle-ridges", "valley", "foreground"]
  );
  assert.doesNotMatch(travelBlock, /travelLandscape|select-travel-landscape|aria-pressed/u);
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header--travel::before\s*\{[^}]*content:\s*none;[^}]*background-image:\s*none;/su
  );
  assert.match(
    css,
    /--rm-party-inventory-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-party-inventory-workshop\.webp"\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header::before\s*\{[^}]*var\(--rm-party-inventory-header-image\)/su
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header--travel\s*\{[^}]*--rm-travel-repeat-width:\s*1280px;/su
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__travel-parallax\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*0;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;[^}]*pointer-events:\s*none;/su
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__travel-layer::before\s*\{[^}]*width:\s*calc\(100% \+ var\(--rm-travel-repeat-width\)\);[^}]*background-repeat:\s*repeat-x;[^}]*background-size:\s*var\(--rm-travel-repeat-width\) 300px;[^}]*animation:\s*rm-travel-parallax-scroll var\(--rm-travel-layer-duration\) linear infinite;/su
  );

  const layerStyles = [
    ["sky", "mountain-sky.webp", null],
    ["far-mountains", "mountain-far-mountains.webp", "600s"],
    ["middle-ridges", "mountain-middle-ridges.webp", "250s"],
    ["valley", "mountain-valley.webp", "115.38s"],
    ["foreground", "mountain-foreground.webp", "60s"]
  ];

  for (const [layer, filename, duration] of layerStyles) {
    const rule = css.match(new RegExp(
      `\\.rebreya-inventory-app \\.rm-inventory-book__travel-layer--${layer}::before\\s*\\{([^}]*)\\}`,
      "su"
    ));

    assert.ok(rule, `expected CSS for the ${layer} parallax layer`);
    assert.ok(
      rule[1].includes(`background-image: url("../assets/ui/travel-parallax/${filename}");`),
      `expected ${filename} on the ${layer} parallax layer`
    );
    if (duration) {
      assert.ok(
        rule[1].includes(`--rm-travel-layer-duration: ${duration};`),
        `expected ${duration} duration on the ${layer} parallax layer`
      );
    } else {
      assert.match(rule[1], /animation:\s*none;/u);
    }
  }

  assert.match(
    css,
    /@keyframes rm-travel-parallax-scroll\s*\{[\s\S]*?from\s*\{[^}]*transform:\s*translate3d\(0,\s*0,\s*0\);[^}]*\}[\s\S]*?to\s*\{[^}]*transform:\s*translate3d\(-1280px,\s*0,\s*0\);/u
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.rebreya-inventory-app \.rm-inventory-book__travel-layer::before\s*\{[^}]*animation:\s*none;/u
  );
  assert.doesNotMatch(css, /rm-inventory-book__travel-(?:video|selector|choice)/u);
});

test("InventoryApp sorts party inventory rows and exposes item value totals", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const items = [
    {
      itemId: "item-light",
      name: "Бета",
      quantity: 2,
      totalWeight: 1,
      priceCopper: 100,
      sourceTypeLabel: "Материал",
      itemTypeLabel: "Материал"
    },
    {
      itemId: "item-heavy",
      name: "Альфа",
      quantity: 1,
      totalWeight: 6,
      priceCopper: 20,
      sourceTypeLabel: "Снаряжение",
      itemTypeLabel: "Оружие"
    },
    {
      itemId: "item-supply",
      name: "Гамма",
      quantity: 5,
      totalWeight: 3,
      priceCopper: 0,
      sourceTypeLabel: "Запасы",
      itemTypeLabel: "Запасы"
    }
  ];
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?inventory-sort=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    inventorySnapshot: {
      actor: null,
      hasActor: true,
      items,
      allItems: items,
      emptyInventory: false,
      groupContextError: "",
      summary: {
        distinctCount: 3,
        totalQuantity: 8,
        totalWeight: 10,
        foodLb: 0,
        waterGal: 0,
        currencyLabel: "0 мм",
        currency: {
          pp: 0,
          gp: 0,
          sp: 0,
          cp: 0,
          totalCopper: 0,
          label: "0 мм"
        }
      }
    }
  }));
  app.sortMode = "weight-desc";

  try {
    const context = await app._prepareContext();

    assert.deepEqual(context.inventory.map((entry) => entry.name), ["Альфа", "Гамма", "Бета"]);
    assert.equal(context.sortMode, "weight-desc");
    assert.equal(context.sortOptions.find((option) => option.value === "weight-desc")?.selected, true);
    assert.equal(context.summary.totalItemValueCopper, 220);
    assert.equal(context.summary.totalItemValueLabel, "2 зм 2 см");
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp inventory toolbar exposes sorting and subdued total item value metadata", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /data-action="sort-mode"/u);
  assert.match(template, /sortOptions/u);
  assert.match(template, /summary\.totalItemValueLabel/u);
  assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__inventory-meta/u);
  assert.doesNotMatch(css, /\.rm-inventory-value-summary/u);
});

test("InventoryApp CSS does not cap the party inventory below its configured size", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.equal(css.includes("max-width: min(1120px"), false);
  assert.equal(css.includes("max-height: min(760px"), false);
});

test("InventoryApp _prepareContext disables member add controls for native group membership", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: {
        id: "group-a",
        name: "Native Group",
        type: "group",
        system: {
          members: []
        }
      },
      groupId: "group-a",
      memberActorIds: ["member-a"]
    }),
    partySnapshot: {
      canManage: true,
      availableActors: [{ id: "member-b", name: "Legacy Candidate" }],
      membershipManagedByNativeGroup: true
    }
  }));

  try {
    const context = await app._prepareContext();

    assert.equal(context.group.name, "Native Group");
    assert.equal(context.party.membershipManagedByNativeGroup, true);
    assert.equal(context.party.addMemberDisabled, true);
    assert.match(context.party.addMemberDisabledReason, /листом группы/u);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp context menu omits remove action for native group membership", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const row = createFakeElement({
    dataset: {
      actorId: "member-a",
      actorName: "Native Member"
    }
  });
  const summary = createFakeElement({
    closest: () => row
  });
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => {
    if (selector === ".rm-party-row[data-actor-id]") {
      return [row];
    }
    if (selector === ".rm-party-row__summary") {
      return [summary];
    }
    return [];
  };
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  app.element = root;
  app.canManage = true;
  app.partyMembershipManagedByNativeGroup = true;

  try {
    await app._onRender({}, {});
    summary.listeners.contextmenu[0]({
      currentTarget: summary,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {}
    });

    const menuText = collectText(dom.appendedMenu);
    assert.match(menuText, /Открыть лист/u);
    assert.doesNotMatch(menuText, /Удалить из группы/u);
    assert.equal(dom.appendedMenu.children.some((child) => String(child.className).includes("is-danger")), false);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp item service menu exposes stock actions without duplicate open actions", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?item-menu=${Date.now()}`);
  const buttonsBySelector = new Map([
    ["[data-action='open-compendium-entry']", createFakeElement()],
    ["[data-action='open-item-sheet']", createFakeElement()],
    ["[data-action='edit-item-quantity']", createFakeElement()],
    ["[data-action='break-item']", createFakeElement()],
    ["[data-action='take-item-self']", createFakeElement()],
    ["[data-action='sell-item']", createFakeElement()],
    ["[data-action='delete-item']", createFakeElement()]
  ]);
  const row = createFakeElement({
    dataset: {
      itemId: "item-a",
      itemName: "Silver Mirror",
      itemUuid: "Actor.group.Item.item-a",
      sourceType: "gear",
      sourceId: "mirror-a",
      sourceName: "Silver Mirror",
      quantity: "2"
    },
    closest: () => row
  });
  row.querySelector = (selector) => buttonsBySelector.get(selector) ?? null;
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => (selector === ".rm-compact-item" ? [row] : []);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  app.element = root;
  app.canManage = true;
  app.canDropInventoryItems = true;

  try {
    await app._onRender({}, {});
    row.listeners.contextmenu[0]({
      currentTarget: row,
      clientX: 10,
      clientY: 10,
      preventDefault() {},
      stopPropagation() {}
    });

    const menuText = collectText(dom.appendedMenu);
    assert.doesNotMatch(menuText, /Открыть запись/u);
    assert.doesNotMatch(menuText, /Лист предмета/u);
    assert.match(menuText, /Забрать себе/u);
    assert.match(menuText, /Продать/u);
    assert.match(menuText, /Удалить/u);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp currency dialog parses relative coin edits and uses the compact currency window class", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  const updates = [];
  globalThis.ui = {
    notifications: {
      info() {},
      error() {}
    },
    windows: {}
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?currency-relative=${Date.now()}`);
    const editButton = createFakeElement();
    const currencyRoot = createFakeElement({
      dataset: {
        currencyPp: "2",
        currencyGp: "249",
        currencySp: "8",
        currencyCp: "2"
      }
    });
    const appRoot = createFakeElement();
    appRoot.querySelector = (selector) => selector === "[data-action='edit-currency-root']"
      ? currencyRoot
      : null;
    appRoot.querySelectorAll = (selector) => selector === "[data-action='edit-currency']"
      ? [editButton]
      : [];
    const moduleApi = createModuleApi({
      getGroupContext: () => null
    });
    moduleApi.updatePartyCurrency = async (values) => {
      updates.push(values);
    };
    const app = new InventoryApp(moduleApi);
    app.element = appRoot;

    await app._onRender({}, {});
    const clickPromise = editButton.listeners.click[0]();
    const dialog = globalThis.Dialog.instances.at(-1);
    const fields = {
      "[data-field='currency-pp']": { value: "2" },
      "[data-field='currency-gp']": { value: "+70" },
      "[data-field='currency-sp']": { value: "-40" },
      "[data-field='currency-cp']": { value: "2" }
    };
    const dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => fields[selector] ?? null;
    dialog.config.buttons.save.callback(dialogRoot);
    await clickPromise;

    assert.equal(dialog.options.classes.includes("rm-currency-dialog-window"), true);
    assert.deepEqual(updates, [{
      pp: 2,
      gp: 319,
      sp: 0,
      cp: 2
    }]);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp item quantity and supply dialogs parse signed edits as relative deltas", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  const updates = [];
  const supplies = [];
  const editQuantityButton = createFakeElement({
    dataset: {
      itemId: "water-item",
      itemName: "Галлоны воды",
      quantity: "20"
    }
  });
  const addWaterButton = createFakeElement();
  const appRoot = createFakeElement();
  appRoot.querySelector = (selector) => selector === "[data-action='add-water']"
    ? addWaterButton
    : null;
  appRoot.querySelectorAll = (selector) => selector === "[data-action='edit-item-quantity']"
    ? [editQuantityButton]
    : [];
  globalThis.ui = {
    notifications: {
      info() {},
      error() {}
    },
    windows: {}
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?relative-quantity=${Date.now()}`);
    const moduleApi = createModuleApi({
      getGroupContext: () => null
    });
    moduleApi.updateInventoryItemQuantity = async (itemId, quantity) => {
      updates.push({ itemId, quantity });
    };
    moduleApi.addPartySupply = async (resourceKey, quantity) => {
      supplies.push({ resourceKey, quantity });
    };
    const app = new InventoryApp(moduleApi);
    app.element = appRoot;

    await app._onRender({}, {});
    let quantityPromise = editQuantityButton.listeners.click[0]({ currentTarget: editQuantityButton });
    let dialog = globalThis.Dialog.instances.at(-1);
    let fields = { "[data-field='numeric-value']": { value: "+10" } };
    let dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => fields[selector] ?? null;
    dialog.config.buttons.confirm.callback(dialogRoot);
    await quantityPromise;

    quantityPromise = editQuantityButton.listeners.click[0]({ currentTarget: editQuantityButton });
    dialog = globalThis.Dialog.instances.at(-1);
    fields = { "[data-field='numeric-value']": { value: "-10" } };
    dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => fields[selector] ?? null;
    dialog.config.buttons.confirm.callback(dialogRoot);
    await quantityPromise;

    const supplyPromise = addWaterButton.listeners.click[0]({ currentTarget: addWaterButton });
    dialog = globalThis.Dialog.instances.at(-1);
    fields = { "[data-field='numeric-value']": { value: "-5" } };
    dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => fields[selector] ?? null;
    dialog.config.buttons.confirm.callback(dialogRoot);
    await supplyPromise;

    assert.deepEqual(updates, [
      { itemId: "water-item", quantity: 30 },
      { itemId: "water-item", quantity: 10 }
    ]);
    assert.deepEqual(supplies, [{ resourceKey: "water", quantity: -5 }]);
    assert.match(dialog.config.content, /type="text"[^>]+inputmode="decimal"[^>]+data-field="numeric-value"/u);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp currency dialog uses text inputs and currency-specific button sizing", async () => {
  const [appSource, css] = await Promise.all([
    readFile(new URL("../scripts/ui/inventory-app.js", import.meta.url), "utf8"),
    readFile(new URL("../styles/main.css", import.meta.url), "utf8")
  ]);

  assert.match(appSource, /class="rm-purchase-dialog rm-currency-dialog"/u);
  assert.match(appSource, /type="text"[^>]+inputmode="numeric"[^>]+data-field="currency-gp"/u);
  assert.match(appSource, /classes:\s*\["rebreya-main",\s*"rebreya-trader-dialog",\s*"rm-currency-dialog-window"\]/u);
  assert.match(css, /\.rebreya-trader-dialog\.rm-currency-dialog-window\s+\.dialog-buttons\s+\.(?:dialog-button|[^,{]+button)/u);
});

test("InventoryApp allows inventory drop users to edit party currency through the template", async () => {
  const restoreFoundry = installFoundryApplicationStub();

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?currency-drop-users=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      inventorySnapshot: {
        actor: { id: "group-1", name: "Party", img: "", canEdit: false },
        hasActor: true,
        items: [],
        allItems: [],
        emptyInventory: true,
        summary: {
          distinctCount: 0,
          totalQuantity: 0,
          totalWeight: 0,
          foodLb: 0,
          waterGal: 0,
          currencyLabel: "1 зм",
          currency: { pp: 0, gp: 1, sp: 0, cp: 0, totalCopper: 100, label: "1 зм" }
        }
      },
      partySnapshot: {
        canManage: false,
        canDropInventoryItems: true
      }
    }));

    const context = await app._prepareContext();

    assert.equal(context.canManage, false);
    assert.equal(context.canDropInventoryItems, true);
    assert.equal(context.canEditCurrency, true);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp template gates currency buttons by canEditCurrency", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");

  assert.match(template, /\{\{#if canEditCurrency\}\}/u);
  assert.doesNotMatch(template, /\{\{#if canManage\}\}\s*<button type="button" class="rm-coin-badge/u);
});

test("InventoryApp template exposes stock item service actions to inventory drop users", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");

  assert.match(template, /data-action="take-item-self"/u);
  assert.match(template, /data-action="sell-item"/u);
  assert.match(template, /data-action="delete-item"/u);
  assert.match(template, /\{\{#if \.\.\/canDropInventoryItems\}\}/u);
  assert.doesNotMatch(template, /<span>Открыть запись<\/span>/u);
  assert.doesNotMatch(template, /<span>Лист предмета<\/span>/u);
});

test("InventoryApp _prepareContext does not hide unexpected display context errors", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const unexpectedError = new Error("resolver exploded");
  const previousConsoleError = console.error;
  console.error = () => {};
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => {
      throw unexpectedError;
    }
  }));

  try {
    const context = await app._prepareContext();

    assert.equal(context.hasError, true);
    assert.equal(context.errorMessage, unexpectedError.message);
  }
  finally {
    console.error = previousConsoleError;
    restoreFoundry();
  }
});

test("InventoryApp allows downtime tab and maps downtime snapshot into context options", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const descriptionHtml = "<h2>Research</h2><h3>Narrative request</h3><p>Full narrative.</p><h3>Resources</h3><p>Full resources.</p><h3>Consequences</h3><p>Full consequences.</p>";
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: {
        id: "group-a",
        name: "Downtime Group",
        system: {
          members: []
        }
      },
      groupId: "group-a",
      memberActorIds: ["actor-a"]
    }),
    downtimeSnapshot: {
      canManage: true,
      canSubmit: true,
      members: [{
        actorId: "actor-a",
        actorName: "Asha",
        canSubmit: true,
        balance: {
          availableWeeks: 3,
          reservedWeeks: 1,
          spentWeeks: 2,
          totalGrantedWeeks: 6
        }
      }],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "research",
        actionLabel: "Research",
        title: "Ancient map",
        description: "Find a route.",
        templateDescriptionHtml: descriptionHtml,
        weeks: 1,
        status: "pending",
        checks: [{
          id: "check-1",
          label: "Поиск следов",
          actionType: "choice",
          sourceType: "skill",
          ability: "wis",
          targetLabel: "Восприятие",
          outcomeMode: "dc",
          dc: 15,
          checkEffect: {
            trigger: "success",
            adapter: "rebreya",
            template: "project-progress"
          },
          downtimeEffect: {
            trigger: "complete",
            adapter: "rebreya",
            template: "group-event"
          }
        }],
        result: ""
      }, {
        id: "downtime-2",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "gambling",
        actionLabel: "Gambling",
        title: "Gambling",
        weeks: 1,
        status: "completed",
        checks: [],
        result: "21"
      }],
      actionCatalog: [
        {
          id: "research",
          label: "Research",
          rank: "1+",
          duration: "1 week",
          summary: "Find answers.",
          descriptionHtml: "<h2>Catalog fallback</h2><p>Should not replace request copy.</p>",
          requirements: ["Library"],
          targetActions: [{
            id: "research-cost",
            label: "Cost",
            actionType: "resources",
            resources: {
              cost: {
                amount: 10,
                currency: "gp",
                payer: "character"
              }
            }
          }, {
            id: "research-check",
            label: "Research check",
            actionType: "check",
            sourceType: "ability",
            ability: "int",
            targetLabel: "Intelligence"
          }]
        }
      ]
    }
  }));

  try {
    app.setActiveTab("downtime", { render: false });
    app.downtimeRequestActorId = "actor-a";
    app.downtimeRequestActionId = "research";

    const context = await app._prepareContext();

    assert.equal(context.activeTab, "downtime");
    assert.equal(context.tabs.isDowntime, true);
    assert.equal(context.downtime.canManage, true);
    assert.equal(context.downtime.canSubmit, true);
    assert.deepEqual(context.downtime.grantActorOptions.map((option) => option.value), ["all", "actor-a"]);
    assert.equal(context.downtime.requestActorOptions[0].selected, true);
    assert.equal(context.downtime.actionOptions.find((option) => option.value === "research").selected, true);
    assert.equal(context.downtime.members[0].availableWeeks, 3);
    assert.equal(context.downtime.members[0].reservedWeeks, 1);
    assert.equal(context.downtime.members[0].spentWeeks, 2);
    assert.equal(context.downtime.members[0].totalGrantedWeeks, 6);
    assert.equal(context.downtime.requests[0].statusLabel, "Ожидает");
    assert.equal(context.downtime.requests[0].checks[0].summary, "Проверка: Мудрость (Восприятие) | DC 15");
    assert.equal(context.downtime.requests[0].targetActions[0].summary, "Проверка: Мудрость (Восприятие) | DC 15");
    assert.equal(context.downtime.requests[0].targetActions[0].sourceTypeLabel, "Навык");
    assert.equal(context.downtime.requests[0].targetActions[0].outcomeModeLabel, "DC");
    assert.equal(context.downtime.requests[0].targetActions[0].outcomeSummary, "DC 15");
    assert.equal(context.downtime.requests[0].targetActions[0].checkEffectLabel, "После успеха: Rebreya Main / Записать прогресс");
    assert.equal(context.downtime.requests[0].targetActions[0].downtimeEffectLabel, "При завершении заявки: Rebreya Main / Изменить событие группы");
    assert.equal(context.downtime.requests[0].targetActionCount, 1);
    assert.equal(context.downtime.requests[0].targetActionLimitReached, undefined);
    assert.deepEqual(context.downtime.archiveRequests.map((request) => request.id), ["downtime-2"]);
    assert.equal(context.downtime.archiveCount, 1);
    assert.equal(context.downtime.showArchive, false);
    assert.equal(context.downtime.selectedRequest.id, "downtime-1");
    assert.equal(context.downtime.selectedRequest.templateSummary, "Find answers.");
    assert.equal(context.downtime.selectedRequest.templateDescriptionHtml, descriptionHtml);
    assert.equal(context.downtime.selectedRequest.hasTemplateDescriptionHtml, true);
    assert.equal(context.downtime.selectedRequest.resourceActions[0].outcomeSummary, "10 зм");
    assert.equal(context.downtime.selectedRequest.checkActions[0].summary, "Проверка: Интеллект");
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp allows travel tab and maps travel snapshot into context", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?travel-tab=${Date.now()}`);
    const calls = [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => ({
        groupActor: {
          id: "group-a",
          name: "Travel Group",
          system: {
            members: []
          }
        },
        groupId: "group-a",
        memberActorIds: []
      }),
      travelSnapshot: {
        available: true,
        canAdvance: true,
        mode: "land",
        cityOptions: [
          { value: "liara-ken", label: "Лиара’Кен", selectedOrigin: true, selectedDestination: false },
          { value: "stranbu", label: "Странбу", selectedOrigin: false, selectedDestination: true }
        ],
        modeOptions: [
          { value: "land", label: "Земля", selected: true, disabled: false }
        ],
        plan: {
          available: true,
          originName: "Лиара’Кен",
          destinationName: "Странбу",
          totalMiles: 180,
          totalHours: 60,
          legs: []
        },
        progress: {
          traveledMiles: 24,
          remainingMiles: 156,
          percent: 13.33,
          label: "24 / 180 миль"
        }
      },
      calls
    }));

    app.setActiveTab("travel", { render: false });

    const context = await app._prepareContext();

    assert.equal(context.activeTab, "travel");
    assert.equal(context.tabs.isTravel, true);
    assert.equal(context.travel.plan.totalMiles, 180);
    assert.equal(context.travel.progress.traveledMiles, 24);
    assert.equal("travelLandscape" in context, false);
    assert.deepEqual(calls.filter((call) => call[0] === "getTravelSnapshot"), [["getTravelSnapshot"]]);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp allows transport tab and maps the active group transport", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-tab=${Date.now()}`);
  const calls = [];
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: {
        id: "group-a",
        name: "Transport Group",
        system: {
          members: []
        }
      },
      groupId: "group-a",
      memberActorIds: []
    }),
    transportSnapshot: {
      available: true,
      warning: "",
      canManage: true,
      activeTransportId: "member:wagon",
      effectiveSpeedMph: 12,
      speedLabel: "12 миль/час",
      speedSourceLabel: "Тяжёлый гражданский фургон",
      cargoLabel: "5 000 фнт.",
      durabilityLabel: "200 / 200",
      hasVehicles: true,
      vehicles: [{
        id: "member:wagon",
        name: "Тяжёлый гражданский фургон",
        typeLabel: "Механический транспорт",
        sourceLabel: "Участник группы",
        speedMph: 12,
        speedLabel: "12 миль/час",
        cargoCapacityLb: 5000,
        cargoLabel: "5 000 фнт.",
        durabilityLabel: "200 / 200",
        active: true
      }],
      activeVehicle: {
        id: "member:wagon",
        name: "Тяжёлый гражданский фургон",
        speedMph: 12,
        cargoCapacityLb: 5000,
        durabilityLabel: "200 / 200"
      }
    },
    calls
  }));

  try {
    app.setActiveTab("transport", { render: false });

    const context = await app._prepareContext();

    assert.equal(context.activeTab, "transport");
    assert.equal(context.tabs.isTransport, true);
    assert.equal(context.transport.activeTransportId, "member:wagon");
    assert.equal(context.transport.effectiveSpeedMph, 12);
    assert.equal(context.transport.activeVehicle.name, "Тяжёлый гражданский фургон");
    const [transportCall] = calls.filter((call) => call[0] === "getTransportSnapshot");
    assert.ok(transportCall);
    assert.ok(transportCall[1].partySnapshot);
    assert.ok(transportCall[1].inventorySnapshot);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp transport selection delegates to the module API", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-select=${Date.now()}`);
  const calls = [];
  const selectButton = createFakeControl({ dataset: { transportId: "member:wagon" } });
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => {
    if (selector === "[data-action='transport-select']") {
      return [selectButton];
    }
    return [];
  };
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    calls
  }));
  app.element = root;

  try {
    await app._onRender({}, {});
    await dispatchClick(selectButton);

    assert.deepEqual(calls.filter((call) => call[0] === "setActiveTransport"), [[
      "setActiveTransport",
      "member:wagon"
    ]]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp prepares editable state for an Actor-backed transport", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-state-context=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: {
        id: "group-a",
        name: "Transport Group",
        system: { members: [] }
      },
      groupId: "group-a",
      memberActorIds: []
    }),
    transportSnapshot: {
      canManage: true,
      activeTransportId: "member:vehicle-a",
      activeVehicle: {
        id: "member:vehicle-a",
        actorId: "vehicle-a",
        isActorBacked: true,
        hpValue: 72,
        hpMax: 100,
        condition: "damaged",
        reserveCurrent: 8,
        reserveCapacity: 12,
        reserveUnit: "gal"
      },
      vehicles: []
    }
  }));

  try {
    app.setActiveTab("transport", { render: false });
    const context = await app._prepareContext();

    assert.equal(context.transport.activeVehicle.stateForm.canEdit, true);
    assert.equal(context.transport.activeVehicle.stateForm.hpCurrent, "72");
    assert.equal(context.transport.activeVehicle.stateForm.reserveCurrent, "8");
    assert.equal(context.transport.activeVehicle.stateForm.reserveCapacity, "12");
    assert.equal(
      context.transport.activeVehicle.stateForm.conditionOptions
        .find((option) => option.value === "damaged").selected,
      true
    );
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp preserves an unset manual transport capacity as an empty field", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-empty-capacity=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: { id: "group-a", name: "Transport Group", system: { members: [] } },
      groupId: "group-a",
      memberActorIds: []
    }),
    transportSnapshot: {
      canManage: true,
      activeVehicle: {
        actorId: "vehicle-a",
        isActorBacked: true,
        hpValue: 0,
        hpMax: 0,
        condition: "operational",
        reserveCurrent: 0,
        reserveCapacity: null,
        reserveUnit: "lb"
      },
      vehicles: []
    }
  }));

  try {
    app.setActiveTab("transport", { render: false });
    const context = await app._prepareContext();

    assert.equal(context.transport.activeVehicle.stateForm.reserveCapacity, "");
  }
  finally {
    restoreFoundry();
  }
});

test("transport state save delegates exact group and Actor ids", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?transport-state-save=${Date.now()}`);
  const calls = [];
  const saveButton = createFakeControl();
  const fields = new Map([
    ["hpCurrent", createFakeControl({ value: "70" })],
    ["condition", createFakeControl({ value: "damaged" })],
    ["reserveCurrent", createFakeControl({ value: "7" })],
    ["reserveCapacity", createFakeControl({ value: "12" })]
  ]);
  const form = createFakeElement({ dataset: { actorId: "vehicle-a" } });
  form.querySelector = (selector) => {
    const match = selector.match(/^\[name='(.+)'\]$/u);
    return match ? fields.get(match[1]) ?? null : null;
  };
  saveButton.closest = (selector) => selector === "[data-transport-state-form]" ? form : null;
  const root = createFakeElement();
  root.querySelector = (selector) => (
    selector === "[data-action='transport-state-save']" ? saveButton : null
  );
  root.querySelectorAll = () => [];
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    calls
  }));
  app.groupActor = { id: "group-a" };
  app.element = root;

  try {
    await app._onRender({}, {});
    await dispatchClick(saveButton);

    assert.deepEqual(calls.filter((call) => call[0] === "updateTransportInstanceState"), [[
      "updateTransportInstanceState",
      {
        groupActorId: "group-a",
        actorId: "vehicle-a",
        patch: {
          hpCurrent: 70,
          condition: "damaged",
          reserveCurrent: 7,
          reserveCapacity: 12
        }
      }
    ]]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp travel city autocomplete selects the preview with Enter", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?travel-search=${Date.now()}`);
  const calls = [];
  const queryInput = createFakeControl();
  const originValue = createFakeControl({ value: "" });
  const destinationValue = createFakeControl({ value: "stranbu" });
  const modeSelect = createFakeControl({ value: "land" });
  const resultRoot = createFakeElement();
  const aizenburg = createFakeControl({
    dataset: { role: "origin", cityId: "aizenburg", cityLabel: "Айзенбург", search: "Айзенбург Западная степь Луга" }
  });
  aizenburg.textContent = "Айзенбург";
  const riversted = createFakeControl({
    dataset: { role: "origin", cityId: "riversted", cityLabel: "Риверстед", search: "Риверстед Марфорд Вэлин Луга" }
  });
  riversted.textContent = "Риверстед";
  resultRoot.querySelectorAll = (selector) => (selector === "[data-action='travel-city-option'][data-role='origin']" ? [aizenburg, riversted] : []);

  const controls = new Map([
    ["[data-action='travel-origin-query']", queryInput],
    ["[data-action='travel-origin']", originValue],
    ["[data-action='travel-destination-query']", createFakeControl()],
    ["[data-action='travel-destination']", destinationValue],
    ["[data-action='travel-mode']", modeSelect],
    ["[data-travel-city-results='origin']", resultRoot]
  ]);
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = (selector) => controls.get(selector) ?? null;
  root.querySelectorAll = () => [];
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    calls
  }));
  app.element = root;

  try {
    await app._onRender({}, {});

    assert.ok(queryInput.listeners.input?.length, "expected travel autocomplete input listener");
    assert.ok(queryInput.listeners.keydown?.length, "expected travel autocomplete keydown listener");
    queryInput.value = "айзен";
    queryInput.listeners.input[0]({ currentTarget: queryInput });

    assert.equal(aizenburg.hidden, false);
    assert.equal(riversted.hidden, true);

    let prevented = false;
    await queryInput.listeners.keydown[0]({
      key: "Enter",
      currentTarget: queryInput,
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(originValue.value, "aizenburg");
    assert.equal(queryInput.value, "Айзенбург");
    assert.deepEqual(calls.filter((call) => call[0] === "setTravelRoute"), [[
      "setTravelRoute",
      {
        originCityId: "aizenburg",
        destinationCityId: "stranbu",
        mode: "land"
      }
    ]]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp travel advance updates the progress strip without rendering the whole app", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousGame = globalThis.game;
  globalThis.game = {
    settings: {
      get() {
        return 2;
      }
    }
  };

  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?travel-progress=${Date.now()}`);
  const calls = [];
  const rewindDayButton = createFakeControl({ dataset: { hours: "-8" } });
  const rewindHourButton = createFakeControl({ dataset: { hours: "-1" } });
  const advanceButton = createFakeControl({ dataset: { hours: "8" } });
  const secondAdvanceButton = createFakeControl({ dataset: { hours: "1" } });
  const trackTimeToggle = createFakeControl();
  trackTimeToggle.checked = true;
  const progressRoot = createFakeControl();
  const progressBar = createFakeControl();
  const progressToken = createFakeControl();
  const progressLabel = createFakeControl();
  const remainingMiles = createFakeControl();
  const remainingTime = createFakeControl();
  const controls = new Map([
    ["[data-action='travel-origin-query']", createFakeControl()],
    ["[data-action='travel-origin']", createFakeControl({ value: "liara-ken" })],
    ["[data-action='travel-destination-query']", createFakeControl()],
    ["[data-action='travel-destination']", createFakeControl({ value: "stranbu" })],
    ["[data-action='travel-mode']", createFakeControl({ value: "land" })],
    ["[data-action='travel-track-time']", trackTimeToggle],
    ["[data-travel-progress]", progressRoot],
    ["[data-travel-progress-bar]", progressBar],
    ["[data-travel-progress-token]", progressToken],
    ["[data-travel-progress-label]", progressLabel],
    ["[data-travel-remaining-miles]", remainingMiles],
    ["[data-travel-remaining-time]", remainingTime]
  ]);
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = (selector) => controls.get(selector) ?? null;
  root.querySelectorAll = (selector) => {
    if (selector === "[data-action='travel-advance']") {
      return [rewindDayButton, rewindHourButton, advanceButton, secondAdvanceButton];
    }
    return [];
  };
  const moduleApi = createModuleApi({
    getGroupContext: () => null,
    calls
  });
  moduleApi.advanceTravelHours = async (hours, options) => {
    calls.push(["advanceTravelHours", hours, options]);
    return {
      available: true,
      canAdvance: false,
      canRewind: true,
      plan: {
        available: true
      },
      progress: {
        percent: 33.33,
        remainingMiles: 200,
        remainingHours: 66.67,
        remainingTravelDays: 8.33,
        label: "100 / 300 миль"
      }
    };
  };
  const app = new InventoryApp(moduleApi);
  app.element = root;
  let renderCount = 0;
  app.render = async () => {
    renderCount += 1;
  };

  try {
    await app._onRender({}, {});
    await dispatchClick(advanceButton);

    assert.equal(renderCount, 0);
    assert.deepEqual(calls.filter((call) => call[0] === "advanceTravelHours"), [[
      "advanceTravelHours",
      8,
      {
        trackTime: true
      }
    ]]);
    assert.equal(progressRoot["aria-label"], "100 / 300 миль");
    assert.equal(progressBar.style.width, "33.33%");
    assert.equal(progressToken.style.left, "33.33%");
    assert.equal(remainingMiles.textContent, "200 миль");
    assert.equal(remainingTime.textContent, "8 дн. (66,67 ч.)");
    assert.equal(progressLabel.textContent, "100 / 300 миль • осталось 8 дн. (66,67 ч.)");
    assert.equal(rewindDayButton.disabled, false);
    assert.equal(rewindHourButton.disabled, false);
    assert.equal(advanceButton.disabled, true);
    assert.equal(secondAdvanceButton.disabled, true);
  }
  finally {
    globalThis.game = previousGame;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp travel leg city link opens the city database entry", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?travel-city-link=${Date.now()}`);
  const calls = [];
  const cityButton = createFakeControl({ dataset: { cityId: "aizenburg" } });
  const root = createFakeElement({
    closest: () => root
  });
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => {
    if (selector === "[data-action='travel-open-city']") {
      return [cityButton];
    }
    return [];
  };
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    calls
  }));
  app.element = root;

  try {
    await app._onRender({}, {});
    await dispatchClick(cityButton);

    assert.deepEqual(calls.filter((call) => call[0] === "openCityApp"), [["openCityApp", "aizenburg"]]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp travel autocomplete and progress token have readable styles", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /data-travel-progress-token/u);
  assert.match(template, /data-action="travel-track-time"/u);
  assert.match(template, /data-action="travel-open-city"/u);
  assert.match(template, /data-hours="-8"/u);
  assert.match(template, /data-hours="-1"/u);
  assert.match(template, /travel\.plan\.totalTravelDays precision=0/u);
  assert.match(template, /travel\.progress\.remainingTravelDays precision=0/u);
  assert.match(css, /\.rm-travel-city-option\s*\{[\s\S]*justify-items:\s*start/u);
  assert.match(css, /\.rm-travel-city-option\s*\{[\s\S]*line-height:\s*1\.2/u);
  assert.match(css, /\.rm-travel-city-option span\s*\{[\s\S]*font-weight:\s*700/u);
  assert.match(css, /\.rm-travel-progress-token\s*\{/u);
  assert.match(css, /\.rm-travel-leg-list\s*\{[\s\S]*max-height:/u);
  assert.match(css, /\.rm-travel-leg-list\s*\{[\s\S]*overflow-y:\s*auto/u);
});

test("InventoryApp template exposes the transport tab and active transport controls", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /data-tab="transport"/u);
  assert.match(template, /\{\{#if tabs\.isTransport\}\}/u);
  assert.match(template, /data-action="transport-select"/u);
  assert.match(template, /transport\.activeVehicle/u);
  assert.match(template, /transport\.speedSourceLabel/u);
  assert.match(template, /data-transport-state-form/u);
  assert.match(template, /data-action="transport-state-save"/u);
  assert.match(template, /name="reserveCapacity"/u);
  assert.match(css, /\.rm-transport-panel/u);
  assert.match(css, /\.rm-transport-row\.is-active/u);
  assert.match(css, /\.rm-transport-state\s*\{/u);
});

test("InventoryApp downtime context can switch queue pages to archive requests", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      canManage: true,
      groupId: "group-a",
      groupActor: null
    }),
    downtimeSnapshot: {
      canManage: true,
      canSubmit: true,
      members: [],
      requests: [{
        id: "downtime-active",
        title: "Active",
        status: "pending",
        checks: []
      }, {
        id: "downtime-archive",
        title: "Archive",
        status: "completed",
        checks: []
      }],
      actionCatalog: []
    }
  }));

  try {
    app.setActiveTab("downtime", { render: false });
    app.downtimeShowArchive = true;
    app.downtimeSelectedRequestId = "downtime-archive";

    const context = await app._prepareContext();

    assert.equal(context.downtime.showArchive, true);
    assert.deepEqual(context.downtime.visibleRequests.map((request) => request.id), ["downtime-archive"]);
    assert.equal(context.downtime.selectedRequest.id, "downtime-archive");
    assert.equal(context.downtime.archivePage.total, 1);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp downtime controls do not define duplicate tooltip attributes", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const downtimeTags = template
    .match(/<[^>]*data-action="downtime-[^"]+"[^>]*>/gu)
    ?? [];
  const duplicateTooltipTags = downtimeTags.filter((tag) => (
    /\stitle=/u.test(tag) && /\sdata-tooltip=/u.test(tag)
  ));

  assert.deepEqual(duplicateTooltipTags, []);
});

test("InventoryApp inventory rows are draggable without a redundant self-drag button", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const rowIndex = template.indexOf('class="rm-compact-item"');

  assert.ok(rowIndex >= 0, "inventory item row should exist");
  assert.match(
    template.slice(rowIndex, template.indexOf(">", rowIndex) + 1),
    /data-item-drag="true"[\s\S]*draggable="true"/u
  );
  assert.doesNotMatch(template, /data-action="drag-item-to-self"/u);
  assert.doesNotMatch(template, /rm-compact-item__self-drag/u);
  assert.doesNotMatch(template, /Перетащите себе/u);
});

test("InventoryApp preserveScroll render restores scroll positions after rerender", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?preserve-scroll=${Date.now()}`);
  const oldScroller = createFakeElement();
  oldScroller.scrollTop = 240;
  oldScroller.scrollLeft = 12;
  const oldRoot = createFakeElement();
  oldRoot.querySelector = () => null;
  oldRoot.querySelectorAll = (selector) => selector === ".scrollable, [data-rm-preserve-scroll]"
    ? [oldScroller]
    : [];
  const newScroller = createFakeElement();
  newScroller.scrollTop = 0;
  newScroller.scrollLeft = 0;
  const newRoot = createFakeElement();
  newRoot.querySelector = () => null;
  newRoot.querySelectorAll = (selector) => selector === ".scrollable, [data-rm-preserve-scroll]"
    ? [newScroller]
    : [];
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));

  try {
    app.element = oldRoot;
    await app.render({ force: true, preserveScroll: true });
    app.element = newRoot;
    await app._onRender({}, {});

    assert.equal(newScroller.scrollTop, 240);
    assert.equal(newScroller.scrollLeft, 12);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp supply prompt opens above the inventory window", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  const dialogs = [];
  const addFoodButton = createFakeElement();
  const inventoryWindow = createFakeElement({
    closest: () => inventoryWindow
  });
  inventoryWindow.style.zIndex = "500";
  const root = inventoryWindow;
  root.querySelector = (selector) => selector === "[data-action='add-food']"
    ? addFoodButton
    : null;
  root.querySelectorAll = () => [];
  globalThis.document.querySelectorAll = (selector) => selector === ".window-app, .application"
    ? [inventoryWindow, ...dialogs.map((dialog) => dialog.element)]
    : [];
  globalThis.window.getComputedStyle = (node) => ({
    zIndex: node?.style?.zIndex ?? "auto"
  });
  globalThis.window.setTimeout = (callback) => {
    callback?.();
    return 0;
  };
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.element = createFakeElement({
        closest: () => this.element
      });
      this.element.style.zIndex = "100";
      dialogs.push(this);
    }

    render() {}
  };
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?supply-dialog-z=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  app.element = root;

  try {
    await app._onRender({}, {});
    const clickPromise = addFoodButton.listeners.click[0]({
      currentTarget: addFoodButton,
      preventDefault() {}
    });
    await new Promise((resolve) => setImmediate(resolve));

    const dialog = dialogs.at(-1);
    dialog.config.buttons.cancel.callback();
    await clickPromise;

    assert.ok(dialog);
    assert.equal(Number(dialog.element.style.zIndex) > Number(inventoryWindow.style.zIndex), true);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp exposes a full inventory drop surface to players who can contribute items", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?player-inventory-drop=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({
      groupActor: {
        id: "group-a",
        name: "Native Group",
        type: "group",
        system: {
          members: []
        }
      },
      groupId: "group-a",
      memberActorIds: ["member-a"]
    }),
    partySnapshot: {
      canManage: false,
      canDropInventoryItems: true
    }
  }));

  try {
    const context = await app._prepareContext();

    assert.equal(context.canManage, false);
    assert.equal(context.canDropInventoryItems, true);
  }
  finally {
    restoreFoundry();
  }

  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const inventoryPanelStart = template.indexOf("    {{#if tabs.isInventory}}\n      <section");
  const inventoryPanelEnd = template.indexOf("{{#if tabs.isParty}}", inventoryPanelStart);
  const inventoryPanel = template.slice(inventoryPanelStart, inventoryPanelEnd);

  assert.match(inventoryPanel, /canDropInventoryItems/u);
  assert.match(inventoryPanel, /rm-inventory-drop-surface/u);
  assert.match(inventoryPanel, /data-action="inventory-dropzone"/u);
  assert.doesNotMatch(inventoryPanel, /rm-compact-dropzone/u);
  assert.match(css, /\.rm-inventory-drop-surface\.is-dragover/u);
});

test("InventoryApp downtime queue opens request details instead of rendering a fixed inspector column", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(template, /data-action="downtime-open-request"/u);
  assert.match(template, /rm-downtime-request__description[\s\S]*\{\{description\}\}/u);
  assert.match(template, /rm-downtime-request__description[\s\S]*\{\{templateSummary\}\}/u);
  assert.doesNotMatch(template, /rm-downtime-column--inspector/u);
  assert.doesNotMatch(template, /targetActionLimitReached/u);
  assert.match(css, /\.rm-downtime-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(210px,\s*250px\)\s*minmax\(520px,\s*1fr\)/u);
});

test("InventoryApp opens a full downtime request card dialog from the queue", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      Dialog.instances.push(this);
    }

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?request-card=${Date.now()}`);
    const requestCard = createFakeControl({
      dataset: {
        action: "downtime-open-request",
        requestId: "downtime-1"
      }
    });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='downtime-open-request']" ? [requestCard] : [];
    const app = new InventoryApp(createModuleApi({
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "research",
          actionLabel: "Research",
          title: "Ancient map",
          description: "Find a route.",
          templateDescriptionHtml: "<h2>Research</h2><h3>Resources</h3><p>Full resources.</p>",
          weeks: 1,
          status: "pending",
          checks: [{
            id: "check-1",
            label: "Arcana",
            actionType: "check",
            sourceType: "skill",
            ability: "int",
            targetLabel: "Arcana",
            outcomeMode: "dc",
            dc: 15
          }],
          result: ""
        }]
      }
    }));
    app.element = root;

    await app._onRender({}, {});
    const openPromise = dispatchClick(requestCard);
    await new Promise((resolve) => setImmediate(resolve));

    const dialog = globalThis.Dialog.instances.at(-1);
    assert.ok(dialog);
    assert.equal(dialog.options?.classes?.includes("rm-downtime-request-window"), true);
    assert.equal(dialog.config.content.includes("Find a route."), true);
    assert.equal(dialog.config.content.includes("<h2>Research</h2>"), true);
    assert.equal(dialog.config.content.includes("Arcana"), true);
    assert.equal(dialog.config.content.includes("data-action=\"downtime-target-action\""), true);
    dialog.close();
    await openPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp opens recorded target actions in a read-only details dialog", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      Dialog.instances.push(this);
    }

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?readonly-target=${Date.now()}`);
    const targetButton = createFakeControl({
      dataset: {
        action: "downtime-target-action",
        requestId: "downtime-1",
        checkId: "check-1"
      }
    });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']" ? [targetButton] : [];
    const app = new InventoryApp(createModuleApi({
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "research",
          actionLabel: "Research",
          title: "Ancient map",
          weeks: 1,
          status: "approved",
          checks: [{
            id: "check-1",
            label: "Arcana",
            actionType: "check",
            sourceType: "skill",
            ability: "int",
            targetLabel: "Arcana",
            outcomeMode: "dc",
            dc: 15,
            result: {
              total: 19,
              success: true
            }
          }],
          result: ""
        }]
      }
    }));
    app.element = root;

    await app._onRender({}, {});
    const targetPromise = dispatchClick(targetButton);
    await new Promise((resolve) => setImmediate(resolve));

    const dialog = globalThis.Dialog.instances.at(-1);
    assert.ok(dialog);
    assert.equal(dialog.config.content.includes("data-readonly=\"true\""), true);
    assert.equal(dialog.config.content.includes("Arcana"), true);
    assert.equal(dialog.config.content.includes("19"), true);
    assert.equal(dialog.config.content.includes("data-action=\"target-action-save\""), false);
    dialog.close();
    await targetPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp opens downtime requests from the whole request card", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      Dialog.instances.push(this);
    }

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {}
  };
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(createModuleApi({
    downtimeSnapshot: {
      canManage: true,
      canSubmit: true,
      members: [],
      requests: [{
        id: "downtime-2",
        actorId: "actor-a",
        actorName: "Asha",
        actionLabel: "Gambling",
        weeks: 1,
        status: "approved",
        checks: []
      }],
      actionCatalog: []
    }
  }));
  const requestCard = createFakeControl({
    dataset: {
      action: "downtime-open-request",
      requestId: "downtime-2"
    }
  });
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => selector === "[data-action='downtime-open-request']" ? [requestCard] : [];
  app.element = root;

  try {
    await app._onRender({}, {});
    const openPromise = dispatchClick(requestCard);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(app.downtimeSelectedRequestId, "downtime-2");
    const dialog = globalThis.Dialog.instances.at(-1);
    assert.equal(dialog?.options?.classes?.includes("rm-downtime-request-window"), true);
    dialog.close();
    await openPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime context converts known group errors into empty warning state", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    downtimeError: new Error(GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP)
  }));

  try {
    app.setActiveTab("downtime", { render: false });

    const context = await app._prepareContext();

    assert.equal(context.hasError, false);
    assert.equal(context.downtime.members.length, 0);
    assert.equal(context.downtime.requests.length, 0);
    assert.equal(context.downtime.warning, GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
    assert.equal(context.downtime.grantDisabled, true);
    assert.equal(context.downtime.submitDisabled, true);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp downtime controls call module API handlers", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const calls = [];
  globalThis.foundry.applications.api.DialogV2.confirm = async () => true;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      info() {},
      error() {}
    }
  };
  const previousDialog = globalThis.Dialog;
  const previousPrompt = globalThis.prompt;
  const dialogResponses = [
    "Returned for details"
  ];
  const createTargetActionDialogRoot = () => {
    const values = new Map([
      ["[data-field='target-action-type']", "check"],
      ["[data-field='target-action-outcome-mode']", "dc"],
      ["[data-field='target-action-dc']", "15"],
      ["[data-field='target-action-record-mode']", "total-success"],
      ["[data-field='target-action-check-effect-trigger']", "success"],
      ["[data-field='target-action-check-effect-adapter']", "rebreya"],
      ["[data-field='target-action-check-effect-template']", "project-progress"],
      ["[data-field='target-action-downtime-effect-trigger']", "complete"],
      ["[data-field='target-action-downtime-effect-adapter']", "rebreya"],
      ["[data-field='target-action-downtime-effect-template']", "group-event"]
    ]);
    const createChoice = ({ sourceType, ability, target, targetLabel, rollMode }) => {
      const choiceValues = new Map([
        ["[data-field='target-choice-source-type']", sourceType],
        ["[data-field='target-choice-ability']", ability],
        ["[data-field='target-choice-target']", target],
        ["[data-field='target-choice-roll-mode']", rollMode]
      ]);
      const choice = createFakeElement();
      choice.querySelector = (selector) => {
        if (selector === "[data-field='target-choice-target']") {
          return {
            value: target,
            selectedOptions: [{ textContent: targetLabel }]
          };
        }
        return { value: choiceValues.get(selector) ?? "" };
      };
      return choice;
    };
    const choices = [
      createChoice({
        sourceType: "skill",
        ability: "wis",
        target: "prc",
        targetLabel: "Восприятие",
        rollMode: "normal"
      }),
      createChoice({
        sourceType: "skill",
        ability: "wis",
        target: "ins",
        targetLabel: "Проницательность",
        rollMode: "normal"
      })
    ];
    const root = createFakeElement();
    root.querySelector = (selector) => ({ value: values.get(selector) ?? "" });
    root.querySelectorAll = (selector) => selector === "[data-target-choice]:not([hidden])" ? choices : [];
    return root;
  };
  globalThis.prompt = () => {
    throw new Error("prompt() is not supported.");
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      this.positionCalls = [];
      Dialog.instances.push(this);
    }

    setPosition(position) {
      this.positionCalls.push(position);
    }

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {
      if (this.config.title === "Целевое действие") {
        return;
      }

      const value = dialogResponses.shift() ?? "";
      const root = createFakeElement();
      root.querySelector = () => ({ value });
      this.config.buttons.confirm.callback(root);
    }
  };

  const { InventoryApp } = await import("../scripts/ui/inventory-app.js");
  const grantButton = createFakeControl({ dataset: { action: "downtime-grant" } });
  const revokeButton = createFakeControl({ dataset: { action: "downtime-revoke" } });
  const clearHistoryButton = createFakeControl({ dataset: { action: "downtime-clear-history" } });
  const submitButton = createFakeControl({ dataset: { action: "downtime-submit" } });
  const statusButton = createFakeControl({
    dataset: {
      action: "downtime-status",
      requestId: "downtime-1",
      status: "returned"
    }
  });
  const targetActionButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1"
    }
  });
  const fields = new Map([
    ["[data-action='downtime-grant-actor']", createFakeControl({ value: "actor-a" })],
    ["[data-action='downtime-grant-weeks']", createFakeControl({ value: "2" })],
    ["[data-action='downtime-request-actor']", createFakeControl({ value: "actor-a" })],
    ["[data-action='downtime-request-action']", createFakeControl({ value: "research" })],
    ["[data-action='downtime-request-weeks']", createFakeControl({ value: "1" })],
    ["[data-action='downtime-request-title']", createFakeControl({ value: "Map" })],
    ["[data-action='downtime-request-description']", createFakeControl({ value: "Find the pass." })]
  ]);
  const root = createFakeElement();
  root.querySelector = (selector) => fields.get(selector) ?? null;
  root.querySelectorAll = (selector) => {
    if (selector === "[data-action='downtime-grant']") {
      return [grantButton];
    }
    if (selector === "[data-action='downtime-revoke']") {
      return [revokeButton];
    }
    if (selector === "[data-action='downtime-clear-history']") {
      return [clearHistoryButton];
    }
    if (selector === "[data-action='downtime-submit']") {
      return [submitButton];
    }
    if (selector === "[data-action='downtime-status']") {
      return [statusButton];
    }
    if (selector === "[data-action='downtime-target-action']") {
      return [targetActionButton];
    }
    return [];
  };
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    downtimeSnapshot: {
      canManage: true,
      canSubmit: true,
      members: [],
      requests: [{
        id: "downtime-1",
        actorId: "actor-a",
        actorName: "Asha",
        actionId: "research",
        actionLabel: "Research",
        title: "Ancient map",
        description: "Find a route.",
        weeks: 1,
        status: "pending",
        checks: [],
        result: ""
      }],
      actionCatalog: []
    },
    calls
  }));
  app.element = root;

  try {
    await app._onRender({}, {});
    await dispatchClick(grantButton);
    await dispatchClick(revokeButton);
    await dispatchClick(clearHistoryButton);
    await dispatchClick(submitButton);
    await dispatchClick(statusButton);
    const targetActionPromise = dispatchClick(targetActionButton);
    await new Promise((resolve) => setImmediate(resolve));

    const targetDialog = globalThis.Dialog.instances.find((dialog) =>
      dialog.options?.classes?.includes("rm-downtime-target-action-window"));
    assert.equal(targetDialog?.options?.width, 620);
    assert.equal(targetDialog?.options?.height, 360);
    assert.equal(targetDialog?.config?.content.includes("До 5 задач"), false);
    assert.equal(targetDialog?.config?.content.includes("Недели, заявки"), false);
    assert.equal(targetDialog?.config?.content.includes("Можно собрать"), false);
    assert.equal(targetDialog?.config?.content.includes("DC проверяет"), false);
    assert.equal(targetDialog?.config?.content.includes("Выбор 1"), false);
    assert.equal(targetDialog?.config?.content.includes("data-field=\"target-action-target\""), false);
    assert.equal(targetDialog?.config?.content.includes("data-field=\"target-action-target-label\""), false);
    assert.equal(targetDialog?.config?.content.includes("data-field=\"target-choice-roll-mode\""), false);
    const actionTypeSelect = targetDialog?.config?.content.match(/<select data-field="target-action-type">([\s\S]*?)<\/select>/u)?.[1] ?? "";
    assert.equal((actionTypeSelect.match(/<option/g) ?? []).length, 9);
    assert.equal(actionTypeSelect.includes(">Проверка<"), true);
    assert.equal(actionTypeSelect.includes(">Блок описания<"), true);
    assert.equal(actionTypeSelect.includes(">Ресурсы<"), true);
    assert.equal(actionTypeSelect.includes(">Выбор ранга<"), true);
    assert.equal(actionTypeSelect.includes(">Выбор варианта<"), true);
    assert.equal(actionTypeSelect.includes(">Числовой ресурс<"), true);
    assert.equal(actionTypeSelect.includes(">Формула<"), true);
    assert.equal(actionTypeSelect.includes(">Итог простоя<"), true);
    assert.equal(actionTypeSelect.includes(">Свободный итог<"), true);
    assert.equal(actionTypeSelect.includes(">Выбор проверки<"), false);
    assert.equal(actionTypeSelect.includes(">Инструмент<"), false);
    assert.equal(actionTypeSelect.includes(">Действие листа<"), false);
    assert.equal(actionTypeSelect.includes(">Атака листа<"), false);
    assert.equal(targetDialog?.config?.content.includes("data-target-choice"), true);
    assert.equal(targetDialog?.config?.content.includes("data-target-choice-fields"), true);
    assert.match(targetDialog?.config?.content ?? "", /data-target-choice-target=(?:"|&quot;)skill(?:"|&quot;)/u);
    assert.equal(targetDialog?.config?.content.includes("data-target-choice-target=\"save\""), false);
    assert.equal(targetDialog?.config?.content.includes("Персонаж должен"), true);
    assert.equal(targetDialog?.config?.content.includes("Основной вариант"), false);
    assert.equal(targetDialog?.config?.content.includes("Альтернатива 1"), false);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-choice-edit\""), true);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-choice-remove\""), true);
    assert.equal(targetDialog?.config?.content.includes("Добавить альтернативу"), true);
    assert.equal(targetDialog?.config?.content.includes("Итог простоя"), true);
    assert.equal(targetDialog?.config?.content.includes("Пороги"), true);
    assert.equal(targetDialog?.config?.content.includes("data-outcome-thresholds-field"), true);
    assert.equal(targetDialog?.config?.content.includes("Ювелира"), false);
    assert.equal(targetDialog?.config?.content.includes("Камнелома"), false);
    assert.equal(targetDialog?.config?.content.includes("title=\"Определяет, какой тип задачи получит игрок.\""), true);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-action-step\""), true);
    assert.match(targetDialog?.config?.content ?? "", /data-step-panel="basis"[^>]*>/u);
    assert.match(targetDialog?.config?.content ?? "", /data-step-panel="variants"[^>]*hidden/u);
    assert.match(targetDialog?.config?.content ?? "", /data-step-panel="outcome"[^>]*hidden/u);
    assert.match(targetDialog?.config?.content ?? "", /data-step-panel="effects"[^>]*hidden/u);
    assert.match(targetDialog?.config?.content ?? "", /data-outcome-dc-field[^>]*hidden/u);
    assert.match(targetDialog?.config?.content ?? "", /data-effect-fields="check"[^>]*hidden/u);
    assert.match(targetDialog?.config?.content ?? "", /data-effect-fields="downtime"[^>]*hidden/u);
    assert.deepEqual(Object.keys(targetDialog?.config?.buttons ?? {}), []);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-action-previous\""), true);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-action-next\""), true);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-action-save\""), true);
    assert.equal(targetDialog?.config?.content.includes("data-action=\"target-action-cancel\""), true);
    assert.equal(calls.some((call) => call[0] === "setDowntimeRequestChecks"), false);

    const previousTargetActionStep = createFakeControl({ dataset: { action: "target-action-step", step: "basis" } });
    const nextTargetActionStep = createFakeControl({ dataset: { action: "target-action-step", step: "variants" } });
    const finalTargetActionStep = createFakeControl({ dataset: { action: "target-action-step", step: "effects" } });
    const previousTargetActionButton = createFakeControl({ dataset: { action: "target-action-previous" } });
    const nextTargetActionButton = createFakeControl({ dataset: { action: "target-action-next" } });
    const saveTargetActionButton = createFakeControl({ dataset: { action: "target-action-save" } });
    const cancelTargetActionButton = createFakeControl({ dataset: { action: "target-action-cancel" } });
    const targetChoiceSummary = createFakeElement();
    targetChoiceSummary.textContent = "Мудрость · Восприятие";
    const liveTargetChoiceTarget = createFakeControl({ value: "ani" });
    liveTargetChoiceTarget.selectedOptions = [{ textContent: "Уход за животными" }];
    const liveTargetChoiceAbility = createFakeControl({ value: "wis" });
    liveTargetChoiceAbility.selectedOptions = [{ textContent: "Мудрость" }];
    const liveTargetChoiceSource = createFakeControl({ value: "skill" });
    liveTargetChoiceSource.selectedOptions = [{ textContent: "Навык листа" }];
    const liveTargetChoiceFields = createFakeElement();
    liveTargetChoiceFields.innerHTML = "";
    const liveTargetChoice = createFakeElement();
    liveTargetChoice.querySelector = (selector) => {
      if (selector === "[data-target-choice-summary]") return targetChoiceSummary;
      if (selector === "[data-field='target-choice-target']") return liveTargetChoiceTarget;
      if (selector === "[data-field='target-choice-ability']") return liveTargetChoiceAbility;
      if (selector === "[data-field='target-choice-source-type']") return liveTargetChoiceSource;
      if (selector === "[data-target-choice-fields]") return liveTargetChoiceFields;
      return null;
    };
    const targetActionRoot = createTargetActionDialogRoot();
    targetActionRoot.querySelector = (selector) => {
      if (selector === "[data-action='target-action-previous']") return previousTargetActionButton;
      if (selector === "[data-action='target-action-next']") return nextTargetActionButton;
      if (selector === "[data-action='target-action-save']") return saveTargetActionButton;
      if (selector === "[data-action='target-action-cancel']") return cancelTargetActionButton;
      return createTargetActionDialogRoot().querySelector(selector);
    };
    targetActionRoot.querySelectorAll = (selector) => {
      if (selector === "[data-action='target-action-step']") {
        return [previousTargetActionStep, nextTargetActionStep, finalTargetActionStep];
      }
      if (selector === "[data-step-panel]") {
        return [
          createFakeElement({ dataset: { stepPanel: "basis" } }),
          createFakeElement({ dataset: { stepPanel: "variants" } }),
          createFakeElement({ dataset: { stepPanel: "outcome" } }),
          createFakeElement({ dataset: { stepPanel: "effects" } })
        ];
      }
      if (selector === "[data-target-choice]") {
        return [liveTargetChoice];
      }
      return createTargetActionDialogRoot().querySelectorAll(selector);
    };
    targetDialog.config.render(targetActionRoot);
    assert.deepEqual(targetDialog.positionCalls[0], { width: 620, height: 360 });
    assert.ok(liveTargetChoiceSource.listeners.change?.length, "expected source choice change listener");
    liveTargetChoiceSource.value = "save";
    liveTargetChoiceSource.listeners.change[0]({ currentTarget: liveTargetChoiceSource, preventDefault() {} });
    assert.equal(liveTargetChoiceFields.innerHTML.includes("Спасбросок смерти"), true);
    assert.equal(liveTargetChoiceFields.innerHTML.includes("Восприятие"), false);
    assert.ok(liveTargetChoiceTarget.listeners.change?.length, "expected target choice change listener");
    liveTargetChoiceSource.value = "skill";
    liveTargetChoiceTarget.listeners.change[0]({ currentTarget: liveTargetChoiceTarget, preventDefault() {} });
    assert.equal(targetChoiceSummary.textContent, "Мудрость · Уход за животными");
    assert.ok(nextTargetActionButton.listeners.click?.length, "expected next step listener");
    await dispatchClick(nextTargetActionButton);
    assert.deepEqual(targetDialog.positionCalls.at(-1), { width: 820, height: 560 });
    assert.equal(targetDialog.closed, false);
    assert.equal(calls.some((call) => call[0] === "setDowntimeRequestChecks"), false);
    assert.ok(saveTargetActionButton.listeners.click?.length, "expected save listener");
    await dispatchClick(saveTargetActionButton);
    assert.equal(targetDialog.closed, true);
    await targetActionPromise;

    assert.deepEqual(calls, [
      ["grantDowntimeWeeks", { actorIds: ["actor-a"], weeks: 2, reason: "" }],
      ["revokeDowntimeWeeks", { actorIds: ["actor-a"], weeks: 2, reason: "" }],
      ["clearDowntimeHistory"],
      ["createDowntimeRequest", {
        actorId: "actor-a",
        actionId: "research",
        title: "Map",
        description: "Find the pass.",
        weeks: 1
      }],
      ["setDowntimeRequestStatus", "downtime-1", "returned", { result: "Returned for details" }],
      ["getDowntimeSnapshot"],
      ["setDowntimeRequestChecks", "downtime-1", [
        {
          id: "check-1",
          label: "Восприятие",
          actionType: "choice",
          sourceType: "skill",
          ability: "wis",
          target: "prc",
          targetLabel: "Восприятие",
          outcomeMode: "dc",
          dc: 15,
          rollMode: "normal",
          recordMode: "total-success",
          choices: [
            {
              sourceType: "skill",
              ability: "wis",
              target: "prc",
              targetLabel: "Восприятие",
              rollMode: "normal",
              label: "Восприятие"
            },
            {
              sourceType: "skill",
              ability: "wis",
              target: "ins",
              targetLabel: "Проницательность",
              rollMode: "normal",
              label: "Проницательность"
            }
          ],
          checkEffect: {
            trigger: "success",
            adapter: "rebreya",
            template: "project-progress"
          },
          downtimeEffect: {
            trigger: "complete",
            adapter: "rebreya",
            template: "group-event"
          }
        }
      ]]
    ]);
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.prompt = previousPrompt;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime target dialog edits and removes variant choices", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      Dialog.instances.push(this);
    }

    setPosition() {}

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {}
  };

  const createChoiceRow = ({ sourceType = "skill", ability = "wis", target, targetLabel }) => {
    const summary = createFakeElement();
    const editButton = createFakeControl({ dataset: { action: "target-choice-edit" } });
    const removeButton = createFakeControl({ dataset: { action: "target-choice-remove" } });
    const sourceField = createFakeControl({ value: sourceType });
    const abilityField = createFakeControl({ value: ability });
    const targetField = createFakeControl({ value: target });
    targetField.selectedOptions = [{ textContent: targetLabel }];
    const row = createFakeElement();
    row.hidden = false;
    row.open = false;
    row.querySelector = (selector) => {
      if (selector === "[data-target-choice-summary]") return summary;
      if (selector === "[data-action='target-choice-edit']") return editButton;
      if (selector === "[data-action='target-choice-remove']") return removeButton;
      if (selector === "[data-field='target-choice-source-type']") return sourceField;
      if (selector === "[data-field='target-choice-ability']") return abilityField;
      if (selector === "[data-field='target-choice-target']") return targetField;
      if (selector === "[data-target-choice-fields]") return createFakeElement();
      return null;
    };
    return { row, editButton, removeButton };
  };

  const calls = [];
  const targetButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1",
      checkId: "check-1"
    }
  });
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']" ? [targetButton] : [];

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?choice-controls=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      calls,
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "unique",
          actionLabel: "Unique",
          title: "Test",
          weeks: 1,
          status: "pending",
          checks: [{
            id: "check-1",
            label: "Восприятие",
            actionType: "choice",
            sourceType: "skill",
            ability: "wis",
            target: "prc",
            targetLabel: "Восприятие",
            outcomeMode: "dc",
            dc: 12,
            recordMode: "total-success",
            choices: [
              { sourceType: "skill", ability: "wis", target: "prc", targetLabel: "Восприятие", rollMode: "normal" },
              { sourceType: "skill", ability: "str", target: "ath", targetLabel: "Атлетика", rollMode: "normal" }
            ]
          }]
        }]
      }
    }));
    app.element = root;
    await app._onRender({}, {});

    const targetActionPromise = dispatchClick(targetButton);
    await new Promise((resolve) => setImmediate(resolve));
    const dialog = globalThis.Dialog.instances.at(-1);

    const primary = createChoiceRow({ target: "prc", targetLabel: "Восприятие" });
    const alternative = createChoiceRow({ ability: "str", target: "ath", targetLabel: "Атлетика" });
    const saveButton = createFakeControl({ dataset: { action: "target-action-save" } });
    const values = new Map([
      ["[data-field='target-action-type']", "check"],
      ["[data-field='target-action-outcome-mode']", "dc"],
      ["[data-field='target-action-dc']", "12"],
      ["[data-field='target-action-record-mode']", "total-success"]
    ]);
    const dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => {
      if (selector === "[data-action='target-action-save']") return saveButton;
      return { value: values.get(selector) ?? "" };
    };
    dialogRoot.querySelectorAll = (selector) => {
      if (selector === "[data-target-choice]") return [primary.row, alternative.row];
      if (selector === "[data-target-choice]:not([hidden])") {
        return [primary.row, alternative.row].filter((row) => row.hidden !== true);
      }
      return [];
    };
    dialog.config.render(dialogRoot);

    await dispatchClick(primary.editButton);
    assert.equal(primary.row.open, true);
    await dispatchClick(alternative.removeButton);
    assert.equal(alternative.row.hidden, true);
    assert.equal(alternative.row.open, false);
    await dispatchClick(saveButton);
    await targetActionPromise;

    const updateCall = calls.find((call) => call[0] === "setDowntimeRequestChecks");
    assert.equal(updateCall?.[1], "downtime-1");
    assert.equal(updateCall?.[2]?.length, 1);
    assert.equal(updateCall?.[2]?.[0]?.actionType, "check");
    assert.equal(updateCall?.[2]?.[0]?.choices.length, 1);
    assert.equal(updateCall?.[2]?.[0]?.choices[0].target, "prc");
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime target dialog saves resource costs and optional purchases", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      this.closed = false;
      Dialog.instances.push(this);
    }

    setPosition() {}

    close() {
      this.closed = true;
      this.config.close?.();
    }

    render() {}
  };

  const calls = [];
  const targetButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1"
    }
  });
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']" ? [targetButton] : [];

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?resource-action=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      calls,
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "research",
          actionLabel: "Исследование",
          title: "Research",
          weeks: 1,
          status: "pending",
          checks: []
        }]
      }
    }));
    app.element = root;
    await app._onRender({}, {});

    const targetActionPromise = dispatchClick(targetButton);
    await new Promise((resolve) => setImmediate(resolve));
    const dialog = globalThis.Dialog.instances.at(-1);
    assert.equal(dialog.config.content.includes(">Ресурсы<"), true);
    assert.equal(dialog.config.content.includes("data-field=\"target-action-resource-amount\""), true);
    assert.equal(dialog.config.content.includes("data-field=\"target-action-resource-narrative\""), true);
    assert.equal(dialog.config.content.includes("data-resource-purchase-row"), true);

    const saveButton = createFakeControl({ dataset: { action: "target-action-save" } });
    const values = new Map([
      ["[data-field='target-action-type']", "resources"],
      ["[data-field='target-action-resource-amount']", "10000"],
      ["[data-field='target-action-resource-currency']", "gp"],
      ["[data-field='target-action-resource-payer']", "character"],
      ["[data-field='target-action-resource-timing']", "onApproval"],
      ["[data-field='target-action-resource-narrative']", "Доступ к библиотеке и мудрецу."],
      ["[data-field='target-action-outcome-mode']", "freeform"],
      ["[data-field='target-action-dc']", ""],
      ["[data-field='target-action-record-mode']", "gm"]
    ]);
    const purchaseValues = new Map([
      ["[data-field='target-action-purchase-label']", "Нанять ассистента"],
      ["[data-field='target-action-purchase-amount']", "250"],
      ["[data-field='target-action-purchase-currency']", "gp"],
      ["[data-field='target-action-purchase-effect-type']", "bonus"],
      ["[data-field='target-action-purchase-effect-value']", "1d4"],
      ["[data-field='target-action-purchase-scope']", "next-check"]
    ]);
    const purchaseRow = createFakeElement();
    purchaseRow.hidden = false;
    purchaseRow.querySelector = (selector) => ({ value: purchaseValues.get(selector) ?? "" });
    const dialogRoot = createFakeElement();
    dialogRoot.querySelector = (selector) => {
      if (selector === "[data-action='target-action-save']") return saveButton;
      return { value: values.get(selector) ?? "" };
    };
    dialogRoot.querySelectorAll = (selector) => {
      if (selector === "[data-target-choice]:not([hidden])") return [];
      if (selector === "[data-resource-purchase-row]:not([hidden])") return [purchaseRow];
      return [];
    };
    dialog.config.render(dialogRoot);

    await dispatchClick(saveButton);
    await targetActionPromise;

    const updateCall = calls.find((call) => call[0] === "setDowntimeRequestChecks");
    assert.equal(updateCall?.[1], "downtime-1");
    assert.equal(updateCall?.[2]?.length, 1);
    assert.deepEqual(updateCall?.[2]?.[0], {
      id: "check-1",
      label: "Ресурсы",
      actionType: "resources",
      sourceType: "",
      ability: "",
      target: "",
      targetLabel: "",
      outcomeMode: "freeform",
      dc: 0,
      rollMode: "normal",
      recordMode: "gm",
      choices: [],
      resources: {
        narrative: "Доступ к библиотеке и мудрецу.",
        cost: {
          amount: 10000,
          currency: "gp",
          payer: "character",
          timing: "onApproval"
        },
        purchases: [{
          label: "Нанять ассистента",
          cost: {
            amount: 250,
            currency: "gp"
          },
          effect: {
            type: "bonus",
            value: "1d4"
          },
          scope: "next-check"
        }]
      }
    });
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime target dialog preserves constructor action types", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    setPosition() {}
    close() {
      this.config.close?.();
    }
    render() {}
  };

  const rankButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1",
      checkId: "research-rank"
    }
  });
  const stepsButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1",
      checkId: "research-steps"
    }
  });
  const resultButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1",
      checkId: "research-result"
    }
  });
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']"
    ? [rankButton, stepsButton, resultButton]
    : [];

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?constructor-types=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "research",
          actionLabel: "Исследование",
          title: "Research",
          weeks: 1,
          status: "pending",
          checks: [{
            id: "research-rank",
            label: "Ранг вопроса",
            actionType: "rankChoice",
            rankChoice: {
              min: 1,
              max: 9,
              default: 1,
              rows: [{ rank: 1, label: "Ранг 1", baseCost: 10, unitCost: 5 }]
            }
          }, {
            id: "research-steps",
            label: "Шаги",
            actionType: "numericInput",
            input: {
              min: 0,
              max: 5,
              step: 1,
              default: 0,
              unit: "шаг."
            }
          }, {
            id: "research-check",
            label: "Проверка исследования",
            actionType: "check",
            sourceType: "ability",
            ability: "int",
            target: "int",
            outcomeMode: "thresholds",
            recordMode: "pass-thresholds",
            thresholds: [{
              from: 1,
              to: 10,
              label: "Провал",
              outcome: "failure"
            }, {
              from: 11,
              to: 16,
              label: "Частичный успех",
              outcome: "partial"
            }]
          }, {
            id: "research-result",
            label: "Фрагменты сведений",
            actionType: "downtimeResult",
            outcomeMode: "pass-thresholds",
            recordMode: "single-result",
            resultMapping: {
              sourceActionId: "research-check",
              sourceField: "thresholdOutcome",
              outputField: "fragments",
              rows: [{
                sourceOutcome: "failure",
                value: 0,
                label: "0 фрагментов"
              }, {
                sourceOutcome: "partial",
                value: 1,
                label: "1 фрагмент"
              }]
            }
          }]
        }]
      }
    }));
    const downtimeSnapshot = app.moduleApi.getDowntimeSnapshot();
    app.element = root;
    await app._onRender({}, {});

    let dialogPromise = dispatchClick(rankButton);
    await new Promise((resolve) => setImmediate(resolve));
    const rankDialog = globalThis.Dialog.instances.at(-1);
    assert.match(rankDialog.config.content, /<option value="rankChoice"[^>]*selected[^>]*>Выбор ранга<\/option>/u);
    assert.equal(rankDialog.config.content.includes("data-rank-choice-panel"), true);
    rankDialog.close?.();
    await dialogPromise;

    const descriptionButton = createFakeControl({
      dataset: {
        action: "downtime-target-action",
        requestId: "downtime-1",
        checkId: "research-description"
      }
    });
    root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']"
      ? [descriptionButton]
      : [];
    app.element = root;
    downtimeSnapshot.requests[0].checks.push({
      id: "research-description",
      label: "Описание проекта",
      actionType: "descriptionBlock",
      descriptionBlock: {
        title: "Проект",
        description: "Описание"
      }
    });
    await app._onRender({}, {});

    dialogPromise = dispatchClick(descriptionButton);
    await new Promise((resolve) => setImmediate(resolve));
    const descriptionDialog = globalThis.Dialog.instances.at(-1);
    assert.match(descriptionDialog.config.content, /<option value="descriptionBlock"[^>]*selected[^>]*>Блок описания<\/option>/u);
    assert.equal(descriptionDialog.config.content.includes("data-description-block-panel"), true);
    assert.equal(descriptionDialog.config.content.includes("data-field=\"target-action-description-title\""), true);
    assert.equal(descriptionDialog.config.content.includes("data-field=\"target-action-description-text\""), true);
    descriptionDialog.close?.();
    await dialogPromise;

    root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']"
      ? [stepsButton, resultButton]
      : [];
    await app._onRender({}, {});

    dialogPromise = dispatchClick(stepsButton);
    await new Promise((resolve) => setImmediate(resolve));
    const numericDialog = globalThis.Dialog.instances.at(-1);
    assert.match(numericDialog.config.content, /<option value="numericInput"[^>]*selected[^>]*>Числовой ресурс<\/option>/u);
    assert.equal(numericDialog.config.content.includes("data-numeric-input-panel"), true);
    numericDialog.close?.();
    await dialogPromise;

    dialogPromise = dispatchClick(resultButton);
    await new Promise((resolve) => setImmediate(resolve));
    const resultDialog = globalThis.Dialog.instances.at(-1);
    assert.match(resultDialog.config.content, /<option value="downtimeResult"[^>]*selected[^>]*>Итог простоя<\/option>/u);
    assert.equal(resultDialog.config.content.includes("data-result-mapping-panel"), true);
    assert.equal(resultDialog.config.content.includes("data-result-expression-panel"), false);
    assert.equal(resultDialog.config.content.includes("data-step=\"outcome\""), false);
    assert.equal(resultDialog.config.content.includes("research-check"), true);
    assert.equal(resultDialog.config.content.includes("data-target-choice"), false);
    assert.equal(resultDialog.config.content.includes("data-field=\"target-choice-target\""), false);
    resultDialog.close?.();
    await dialogPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime target dialog renders formula result actions", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    setPosition() {}
    close() {
      this.config.close?.();
    }
    render() {}
  };

  const resultButton = createFakeControl({
    dataset: {
      action: "downtime-target-action",
      requestId: "downtime-1",
      checkId: "gambling-result"
    }
  });
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']"
    ? [resultButton]
    : [];

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?formula-result-dialog=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "gambling",
          actionLabel: "Gambling",
          title: "Gambling",
          weeks: 1,
          status: "pending",
          checks: [{
            id: "gambling-insight",
            label: "Insight",
            actionType: "check",
            sourceType: "skill",
            ability: "wis",
            target: "ins",
            outcomeMode: "dc",
            recordMode: "total-success"
          }, {
            id: "gambling-deception",
            label: "Deception",
            actionType: "check",
            sourceType: "skill",
            ability: "cha",
            target: "dec",
            outcomeMode: "dc",
            recordMode: "total-success"
          }, {
            id: "gambling-result",
            label: "Stake result",
            actionType: "downtimeResult",
            outcomeMode: "thresholds",
            recordMode: "single-result",
            resultFormula: {
              outputField: "successes",
              terms: [{
                actionId: "gambling-insight",
                field: "success",
                operator: "+"
              }, {
                actionId: "gambling-deception",
                field: "success",
                operator: "+"
              }]
            },
            thresholds: [{
              from: 0,
              to: 0,
              label: "Lose",
              outcome: "failure"
            }, {
              from: 1,
              label: "Win",
              outcome: "success"
            }]
          }]
        }]
      }
    }));
    app.element = root;
    await app._onRender({}, {});

    const dialogPromise = dispatchClick(resultButton);
    await new Promise((resolve) => setImmediate(resolve));
    const resultDialog = globalThis.Dialog.instances.at(-1);

    assert.equal(resultDialog.config.content.includes("data-result-expression-panel"), true);
    assert.equal(resultDialog.config.content.includes("data-result-mapping-panel\""), false);
    assert.equal(resultDialog.config.content.includes("data-threshold-rows"), true);
    assert.equal(resultDialog.config.content.includes("gambling-insight"), true);
    assert.equal(resultDialog.config.content.includes("successes"), true);
    resultDialog.close?.();
    await dialogPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp background render does not bring the window to front", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?quiet-render=${Date.now()}`);
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null
  }));
  const root = createFakeElement();
  root.querySelector = () => null;
  root.querySelectorAll = () => [];
  app.element = root;
  let bringToFrontCount = 0;
  app.bringToFront = () => {
    bringToFrontCount += 1;
  };

  try {
    await app._onRender({}, {});

    assert.equal(bringToFrontCount, 0);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp downtime target dialog renders actor actions and attacks from the sheet", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.game = {
    actors: new Map([["actor-a", {
      id: "actor-a",
      items: new Map([
        ["sword", {
          id: "sword",
          name: "Longsword",
          system: {
            activities: new Map([["slash", {
              id: "slash",
              name: "Slash",
              type: "attack"
            }]])
          }
        }],
        ["second-wind", {
          id: "second-wind",
          name: "Second Wind",
          system: {
            activities: new Map([["heal", {
              id: "heal",
              name: "Recover",
              type: "heal"
            }]])
          }
        }]
      ])
    }]])
  };
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    close() {
      this.config.close?.();
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?actor-actions=${Date.now()}`);
    const attackButton = createFakeControl({
      dataset: {
        action: "downtime-target-action",
        requestId: "downtime-1",
        checkId: "attack-check"
      }
    });
    const actionButton = createFakeControl({
      dataset: {
        action: "downtime-target-action",
        requestId: "downtime-1",
        checkId: "action-check"
      }
    });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='downtime-target-action']"
      ? [attackButton, actionButton]
      : [];
    const app = new InventoryApp(createModuleApi({
      downtimeSnapshot: {
        canManage: true,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          actionId: "unique",
          actionLabel: "Unique",
          title: "Test",
          weeks: 1,
          status: "pending",
          checks: [{
            id: "attack-check",
            label: "Attack",
            sourceType: "attack",
            target: "sword:slash",
            targetLabel: "Longsword: Slash",
            choices: [{
              sourceType: "attack",
              target: "sword:slash",
              targetLabel: "Longsword: Slash"
            }]
          }, {
            id: "action-check",
            label: "Action",
            sourceType: "sheetAction",
            target: "second-wind:heal",
            targetLabel: "Second Wind: Recover",
            choices: [{
              sourceType: "sheetAction",
              target: "second-wind:heal",
              targetLabel: "Second Wind: Recover"
            }]
          }]
        }]
      }
    }));
    app.element = root;

    await app._onRender({}, {});
    const attackPromise = dispatchClick(attackButton);
    await new Promise((resolve) => setImmediate(resolve));
    const attackDialog = globalThis.Dialog.instances.at(-1);
    assert.equal(attackDialog.config.content.includes("Longsword: Slash"), true);
    assert.equal(attackDialog.config.content.includes("Second Wind: Recover"), false);
    assert.match(attackDialog.config.content, /data-target-choice-target=(?:"|&quot;)attack(?:"|&quot;)/u);
    attackDialog.close();
    await attackPromise;

    const actionPromise = dispatchClick(actionButton);
    await new Promise((resolve) => setImmediate(resolve));
    const actionDialog = globalThis.Dialog.instances.at(-1);
    assert.equal(actionDialog.config.content.includes("Second Wind: Recover"), true);
    assert.equal(actionDialog.config.content.includes("Longsword: Slash"), false);
    assert.match(actionDialog.config.content, /data-target-choice-target=(?:"|&quot;)sheetAction(?:"|&quot;)/u);
    actionDialog.close();
    await actionPromise;
  }
  finally {
    globalThis.Dialog = previousDialog;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp joins every scheduled downtime status into calendar cells with stable dominance and entries", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-context=${Date.now()}`);
  const statuses = ["free", "pending", "approved", "processed", "blocked"];
  const isoDates = statuses.map((_, index) => `2026-07-${String(20 + index).padStart(2, "0")}`);
  const mixedIsoDate = "2026-07-25";
  const requests = statuses
    .filter((status) => status !== "free")
    .map((status) => ({
      id: `request-${status}`,
      actorId: `actor-${status}`,
      actorName: status === "pending" ? "Asha" : `Actor ${status}`,
      actionLabel: "Craft",
      title: status === "pending" ? "Build compass" : `Request ${status}`,
      status,
      ownedWorkshop: status === "pending",
      hoursPerDay: 8,
      checks: []
    }));
  const scheduleSlots = statuses.map((status, index) => ({
    id: `slot-${status}`,
    actorId: `actor-${status}`,
    isoDate: isoDates[index],
    status,
    requestId: status === "free" ? null : `request-${status}`,
    hours: status === "pending" ? 10 : null,
    blockReason: status === "blocked" ? "Missing materials" : null
  }));
  scheduleSlots.push(...statuses.map((status) => ({
    id: `slot-mixed-${status}`,
    actorId: `actor-mixed-${status}`,
    isoDate: mixedIsoDate,
    status,
    requestId: null,
    hours: null,
    blockReason: null
  })));
  const calendarByIsoDate = Object.fromEntries(isoDates.map((isoDate, index) => [isoDate, {
    isoDate,
    total: 1,
    counts: Object.fromEntries(statuses.map((status) => [status, status === statuses[index] ? 1 : 0]))
  }]));
  calendarByIsoDate[mixedIsoDate] = {
    isoDate: mixedIsoDate,
    total: 5,
    counts: Object.fromEntries(statuses.map((status) => [status, 1]))
  };
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => null,
    calendarSnapshot: {
      isoDate: "2026-07-20",
      year: 2026,
      month: 7,
      day: 20,
      cells: [...isoDates, mixedIsoDate].map((isoDate, index) => ({
        isoDate,
        year: 2026,
        month: 7,
        day: 20 + index,
        isOutsideMonth: false,
        isCurrentDay: index === 0
      }))
    },
    downtimeSnapshot: {
      canManage: true,
      canSubmit: false,
      members: [],
      requests,
      actionCatalog: [],
      calendarByIsoDate,
      scheduleSlots
    }
  }));

  try {
    const context = await app._prepareContext();

    assert.deepEqual(
      context.calendar.cells.slice(0, statuses.length).map((cell) => cell.downtime.dominantStatus),
      statuses
    );
    assert.equal(context.calendar.cells.at(-1).downtime.total, 5);
    assert.equal(context.calendar.cells.at(-1).downtime.dominantStatus, "blocked");
    assert.deepEqual(
      context.calendar.cells.at(-1).downtime.markers.map(({ status, count }) => ({ status, count })),
      statuses.map((status) => ({ status, count: 1 }))
    );
    assert.deepEqual(context.calendar.cells[1].downtime.counts, {
      free: 0,
      pending: 1,
      approved: 0,
      processed: 0,
      blocked: 0
    });
    assert.deepEqual(context.calendar.cells[1].downtime.entries[0], {
      actorName: "Asha",
      title: "Build compass",
      status: "pending",
      statusLabel: "Ожидает",
      hours: 10,
      workshop: "owned",
      workshopLabel: "Собственная мастерская",
      blockReason: ""
    });
    assert.equal(context.calendar.cells[4].downtime.entries[0].blockReason, "Missing materials");
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp calendar template renders fixed status markers, workday balances, and no legacy day controls", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");

  assert.match(template, /rm-calendar-grid__day-number/u);
  assert.match(template, /rm-calendar-grid__total/u);
  assert.match(template, /rm-calendar-grid__markers/u);
  assert.match(template, /\{\{#each downtime\.markers\}\}[\s\S]*is-\{\{status\}\}[\s\S]*\{\{count\}\}/u);
  assert.match(template, /aria-label="\{\{label\}\}: \{\{count\}\}"/u);
  assert.match(template, /is-downtime-\{\{downtime\.dominantStatus\}\}/u);
  assert.match(template, /data-iso-date="\{\{isoDate\}\}"/u);
  assert.match(template, /totalGrantedWorkdays precision=0/u);
  assert.match(template, /availableWorkdays precision=0/u);
  assert.match(template, /reservedWorkdays precision=0/u);
  assert.match(template, /spentWorkdays precision=0/u);
  assert.match(template, /<label>Недели<\/label>[\s\S]*data-action="downtime-grant-weeks"/u);
  assert.doesNotMatch(template, /data-action="(?:craft-process-day|consume-day)"/u);
  assert.doesNotMatch(template, /Списать день/u);
});

test("InventoryApp craft context separates pending requests from active projects", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?craft-project-context=${Date.now()}`);
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      craftSnapshot: {
        crafters: [{ actorId: "actor-a", actorName: "Asha", selected: true }],
        projects: [{
          id: "craft-project-1",
          requestId: "downtime-2",
          crafterActorId: "actor-a",
          status: "in-progress",
          operationalStatus: "active",
          outputs: [{ name: "Longsword", quantity: 1 }],
          targetGold: 20,
          progressGold: 5,
          hoursPerDay: 12,
          ownedWorkshop: true,
          reservationSummary: {},
          reconciliation: { required: false }
        }]
      },
      downtimeSnapshot: {
        canManage: true,
        members: [{ actorId: "actor-a", actorName: "Asha", canSubmit: true, balance: {} }],
        actionCatalog: [],
        calendarByIsoDate: {},
        scheduleSlots: [],
        requests: [{
          id: "downtime-1",
          actorId: "actor-a",
          actorName: "Asha",
          status: "pending",
          weeks: 2,
          workdays: 10,
          craftProject: {
            outputs: [{ sourceType: "gear", sourceId: "longsword", quantity: 2 }],
            hoursPerDay: 12,
            ownedWorkshop: true
          }
        }]
      }
    }));

    const context = await app._prepareContext();

    assert.equal(context.craft.pendingRequestCount, 1);
    assert.equal(context.craft.pendingRequests[0].outputLabel, "longsword x2");
    assert.equal(context.craft.pendingRequests[0].workshopLabel, "Собственная");
    assert.equal(context.craft.projects[0].outputLabel, "Longsword");
    assert.equal(context.craft.projects[0].progressPercent, 25);
    assert.equal(context.craft.projects[0].canPause, true);
    assert.equal(context.craft.projects[0].canResume, false);
  }
  finally {
    restoreFoundry();
  }
});

test("InventoryApp craft template uses downtime project actions instead of the legacy queue", async () => {
  const template = await readFile(new URL("../templates/inventory-app.hbs", import.meta.url), "utf8");

  assert.match(template, /data-action="craft-approve-request"/u);
  assert.match(template, /data-action="craft-return-request"/u);
  assert.match(template, /data-action="craft-reject-request"/u);
  assert.match(template, /data-action="craft-pause-project"/u);
  assert.match(template, /data-action="craft-resume-project"/u);
  assert.match(template, /data-action="craft-cancel-project"/u);
  assert.doesNotMatch(template, /data-action="craft-queue"/u);
  assert.doesNotMatch(template, /Очередь крафта/u);
});

test("InventoryApp retries craft approval with the same mutation identity", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  const previousConsoleError = console.error;
  globalThis.ui = { notifications: { info() {}, error() {} } };
  console.error = () => {};

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?craft-approval-retry=${Date.now()}`);
    const approveButton = createFakeControl({
      dataset: { requestId: "downtime-1", requestName: "Длинный меч" }
    });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => (
      selector === "[data-action='craft-approve-request']" ? [approveButton] : []
    );
    const calls = [];
    const api = createModuleApi({ getGroupContext: () => null });
    api.approveCraftDowntimeRequest = async (payload) => {
      calls.push(payload);
      if (calls.length === 1) {
        throw new Error("lost response");
      }
      return { id: "craft-project-1" };
    };
    const app = new InventoryApp(api);
    app.element = root;
    app.render = () => {};

    await app._onRender({}, {});
    await dispatchClick(approveButton);
    await dispatchClick(approveButton);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].requestId, "downtime-1");
    assert.equal(calls[0].mutationId, calls[1].mutationId);
    assert.match(calls[0].mutationId, /^craft-ui:approve:downtime-1:/u);
  }
  finally {
    console.error = previousConsoleError;
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp binds project resume to the craft downtime lifecycle API", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { info() {}, error() {} } };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?craft-resume=${Date.now()}`);
    const resumeButton = createFakeControl({
      dataset: { projectId: "craft-project-1", projectName: "Длинный меч" }
    });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => (
      selector === "[data-action='craft-resume-project']" ? [resumeButton] : []
    );
    const calls = [];
    const api = createModuleApi({ getGroupContext: () => null });
    api.resumeCraftProject = async (projectId, options) => {
      calls.push([projectId, options]);
      return { id: projectId };
    };
    const app = new InventoryApp(api);
    app.element = root;
    app.render = () => {};

    await app._onRender({}, {});
    await dispatchClick(resumeButton);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "craft-project-1");
    assert.match(calls[0][1].mutationId, /^craft-ui:resume:craft-project-1:/u);
  }
  finally {
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp previews and confirms set, pick, day, week, and month calendar changes before mutation", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  const calls = [];
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.foundry.applications.api.DialogV2.confirm = async (config) => {
    calls.push(["confirmCalendarTransition", config]);
    return true;
  };
  const calendarPreview = ({ toIsoDate }) => ({
    from: { isoDate: "2026-07-20", dateLabel: "20 июля 2026" },
    to: { isoDate: toIsoDate, dateLabel: toIsoDate },
    fromIsoDate: "2026-07-20",
    toIsoDate,
    direction: "forward",
    crossedDates: ["2026-07-21", "2026-07-22", "2026-07-23"],
    monthResetCount: toIsoDate === "2026-08-20" ? 1 : 0,
    counts: {
      crossedDates: 3,
      affectedDowntimeRequests: 2
    }
  });

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-confirm=${Date.now()}`);
    const setButton = createFakeControl();
    const pickButton = createFakeControl({ dataset: { year: "2026", month: "7", day: "21", isoDate: "2026-07-21" } });
    const dayButton = createFakeControl({ dataset: { unit: "day", value: "1" } });
    const weekButton = createFakeControl({ dataset: { unit: "week", value: "1" } });
    const monthButton = createFakeControl({ dataset: { unit: "month", value: "1" } });
    const fields = new Map([
      ["[data-action='calendar-set']", setButton],
      ["[data-field='calendar-year']", createFakeControl({ value: "2026" })],
      ["[data-field='calendar-month']", createFakeControl({ value: "7" })],
      ["[data-field='calendar-day']", createFakeControl({ value: "25" })]
    ]);
    const root = createFakeElement();
    root.querySelector = (selector) => fields.get(selector) ?? null;
    root.querySelectorAll = (selector) => {
      if (selector === "[data-action='calendar-pick-day']") return [pickButton];
      if (selector === "[data-action='calendar-advance']") return [dayButton, weekButton, monthButton];
      return [];
    };
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calls,
      calendarPreview,
      calendarSnapshot: {
        isoDate: "2026-07-20",
        year: 2026,
        month: 7,
        day: 20,
        cells: []
      }
    }));
    app.element = root;

    await app._onRender({}, {});
    await dispatchClick(setButton);
    await dispatchClick(pickButton);
    await dispatchClick(dayButton);
    await dispatchClick(weekButton);
    await dispatchClick(monthButton);

    assert.deepEqual(calls.map((call) => call[0]), [
      "previewCalendarTransition", "confirmCalendarTransition", "setCalendarDate",
      "previewCalendarTransition", "confirmCalendarTransition", "setCalendarDate",
      "previewCalendarTransition", "confirmCalendarTransition", "setCalendarDate",
      "previewCalendarTransition", "confirmCalendarTransition", "setCalendarDate",
      "previewCalendarTransition", "confirmCalendarTransition", "setCalendarDate"
    ]);
    assert.deepEqual(
      calls.filter((call) => call[0] === "previewCalendarTransition").map((call) => call[1].toIsoDate),
      ["2026-07-25", "2026-07-21", "2026-07-21", "2026-07-27", "2026-08-20"]
    );
    assert.deepEqual(
      calls.filter((call) => call[0] === "previewCalendarTransition").map((call) => call[1].processSupplies),
      [false, false, true, true, true]
    );
    for (const previewCall of calls.filter((call) => call[0] === "previewCalendarTransition")) {
      assert.equal(previewCall[1].processDowntime, true);
      assert.equal(previewCall[1].reason, "calendar-ui");
    }
    for (const confirmCall of calls.filter((call) => call[0] === "confirmCalendarTransition")) {
      assert.match(confirmCall[1].content, /20 июля 2026/u);
      assert.match(confirmCall[1].content, /Направление:[\s\S]*Вперёд/u);
      assert.match(confirmCall[1].content, /Пересечено дней:[\s\S]*3/u);
      assert.match(confirmCall[1].content, /Затронуто заявок:[\s\S]*2/u);
    }
    assert.deepEqual(
      calls.filter((call) => call[0] === "setCalendarDate").map((call) => call.slice(1, 4)),
      [
        [2026, 7, 25],
        [2026, 7, 21],
        [2026, 7, 21],
        [2026, 7, 27],
        [2026, 8, 20]
      ]
    );
    assert.equal(calls.some((call) => /^advanceCalendar/u.test(call[0])), false);
    for (const mutationCall of calls.filter((call) => call[0] === "setCalendarDate").slice(2)) {
      assert.equal(mutationCall[4].processDailyCycles, true);
      assert.equal(mutationCall[4].processSupplies, true);
      assert.equal(mutationCall[4].consumeSupplies, true);
      assert.equal(mutationCall[4].applyEnergy, true);
      assert.equal(mutationCall[4].processCraft, true);
    }
    assert.equal(calls.filter((call) => call[0] === "setCalendarDate").at(-1)[4].monthResetCount, 1);
  }
  finally {
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp commits a confirmed relative transition once to its absolute preview target", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  const calls = [];
  const confirmResolvers = [];
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.foundry.applications.api.DialogV2.confirm = (config) => {
    calls.push(["confirmCalendarTransition", config]);
    return new Promise((resolve) => confirmResolvers.push(resolve));
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-double-click=${Date.now()}`);
    const dayButton = createFakeControl({ dataset: { unit: "day", value: "1" } });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='calendar-advance']" ? [dayButton] : [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calls,
      calendarPreview: ({ toIsoDate }) => ({
        from: { isoDate: "2026-07-20" },
        to: { isoDate: toIsoDate },
        fromIsoDate: "2026-07-20",
        toIsoDate,
        direction: "forward",
        crossedDates: [toIsoDate],
        monthResetCount: 0,
        counts: { crossedDates: 1, affectedDowntimeRequests: 0 }
      }),
      calendarSnapshot: {
        isoDate: "2026-07-20",
        year: 2026,
        month: 7,
        day: 20,
        cells: []
      }
    }));
    app.element = root;
    await app._onRender({}, {});

    const firstClick = dispatchClick(dayButton);
    const secondClick = dispatchClick(dayButton);
    await Promise.resolve();
    for (const resolve of confirmResolvers) {
      resolve(true);
    }
    await Promise.all([firstClick, secondClick]);

    assert.deepEqual(calls.map((call) => call[0]), [
      "previewCalendarTransition",
      "confirmCalendarTransition",
      "setCalendarDate"
    ]);
    assert.deepEqual(calls.at(-1).slice(1, 4), [2026, 7, 21]);
  }
  finally {
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp rejects a confirmed calendar preview when the current date changed during confirmation", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  const calls = [];
  const warnings = [];
  const calendarSnapshot = {
    isoDate: "2026-07-20",
    year: 2026,
    month: 7,
    day: 20,
    cells: []
  };
  globalThis.ui = {
    notifications: {
      info() {},
      error() {},
      warn(message) { warnings.push(message); }
    }
  };
  globalThis.foundry.applications.api.DialogV2.confirm = async (config) => {
    calls.push(["confirmCalendarTransition", config]);
    calendarSnapshot.isoDate = "2026-07-22";
    calendarSnapshot.year = 2026;
    calendarSnapshot.month = 7;
    calendarSnapshot.day = 22;
    return true;
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-stale-preview=${Date.now()}`);
    const dayButton = createFakeControl({ dataset: { unit: "day", value: "1" } });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='calendar-advance']" ? [dayButton] : [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calls,
      calendarPreview: ({ toIsoDate }) => ({
        from: { isoDate: "2026-07-20" },
        to: { isoDate: toIsoDate },
        fromIsoDate: "2026-07-20",
        toIsoDate,
        direction: "forward",
        crossedDates: [toIsoDate],
        monthResetCount: 0,
        counts: { crossedDates: 1, affectedDowntimeRequests: 0 }
      }),
      calendarSnapshot
    }));
    app.element = root;
    await app._onRender({}, {});

    await dispatchClick(dayButton);

    assert.deepEqual(calls.map((call) => call[0]), [
      "previewCalendarTransition",
      "confirmCalendarTransition"
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /дата календаря изменилась/iu);
  }
  finally {
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp calendar advance parses ISO years with one or more digits", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousUi = globalThis.ui;
  const calls = [];
  globalThis.ui = { notifications: { info() {}, error() {} } };
  globalThis.foundry.applications.api.DialogV2.confirm = async (config) => {
    calls.push(["confirmCalendarTransition", config]);
    return true;
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-year-100=${Date.now()}`);
    const dayButton = createFakeControl({ dataset: { unit: "day", value: "1" } });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='calendar-advance']" ? [dayButton] : [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calls,
      calendarPreview: ({ toIsoDate }) => ({
        from: { isoDate: "100-01-01" },
        to: { isoDate: toIsoDate },
        fromIsoDate: "100-01-01",
        toIsoDate,
        direction: "forward",
        crossedDates: [toIsoDate],
        monthResetCount: 0,
        counts: { crossedDates: 1, affectedDowntimeRequests: 0 }
      }),
      calendarSnapshot: {
        isoDate: "100-01-01",
        year: 100,
        month: 1,
        day: 1,
        cells: []
      }
    }));
    app.element = root;
    await app._onRender({}, {});
    await dispatchClick(dayButton);

    assert.equal(calls[0][1].toIsoDate, "100-01-02");
    assert.deepEqual(calls.at(-1).slice(0, 4), ["setCalendarDate", 100, 1, 2]);
  }
  finally {
    globalThis.ui = previousUi;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp cancel after calendar preview performs no mutation", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const calls = [];
  globalThis.foundry.applications.api.DialogV2.confirm = async (config) => {
    calls.push(["confirmCalendarTransition", config]);
    return false;
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-cancel=${Date.now()}`);
    const pickButton = createFakeControl({ dataset: { year: "2026", month: "7", day: "21", isoDate: "2026-07-21" } });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='calendar-pick-day']" ? [pickButton] : [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calls,
      calendarPreview: ({ toIsoDate }) => ({
        from: { isoDate: "2026-07-20" },
        to: { isoDate: toIsoDate },
        direction: "forward",
        crossedDates: [toIsoDate],
        counts: { crossedDates: 1, affectedDowntimeRequests: 0 }
      })
    }));
    app.element = root;

    await app._onRender({}, {});
    await dispatchClick(pickButton);

    assert.deepEqual(calls.map((call) => call[0]), ["previewCalendarTransition", "confirmCalendarTransition"]);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp calendar contextmenu prevents the browser menu and opens populated or empty compact dialogs safely", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousDialog = globalThis.Dialog;
  globalThis.Dialog = class Dialog {
    static instances = [];

    constructor(config, options = {}) {
      this.config = config;
      this.options = options;
      Dialog.instances.push(this);
    }

    render() {}
  };

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?calendar-contextmenu=${Date.now()}`);
    const populatedButton = createFakeControl({ dataset: { isoDate: "2026-07-21" } });
    const emptyButton = createFakeControl({ dataset: { isoDate: "2026-07-22" } });
    const root = createFakeElement();
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => selector === "[data-action='calendar-pick-day']"
      ? [populatedButton, emptyButton]
      : [];
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null,
      calendarSnapshot: {
        isoDate: "2026-07-20",
        year: 2026,
        month: 7,
        day: 20,
        cells: [
          { isoDate: "2026-07-21", year: 2026, month: 7, day: 21 },
          { isoDate: "2026-07-22", year: 2026, month: 7, day: 22 }
        ]
      },
      downtimeSnapshot: {
        canManage: false,
        canSubmit: false,
        members: [],
        actionCatalog: [],
        requests: [{
          id: "request-a",
          actorId: "actor-a",
          actorName: '<img src=x onerror="alert(1)">Asha',
          title: "</p><script>alert(2)</script>Build compass",
          actionLabel: "Craft",
          ownedWorkshop: true,
          checks: []
        }],
        calendarByIsoDate: {
          "2026-07-21": {
            isoDate: "2026-07-21",
            total: 1,
            counts: { free: 0, pending: 0, approved: 0, processed: 0, blocked: 1 }
          }
        },
        scheduleSlots: [{
          id: "slot-a",
          actorId: "actor-a",
          isoDate: "2026-07-21",
          requestId: "request-a",
          status: "blocked",
          hours: 12,
          blockReason: '"><svg onload="alert(3)">Missing materials'
        }]
      }
    }));
    app.element = root;
    await app._prepareContext();
    await app._onRender({}, {});

    let prevented = false;
    populatedButton.listeners.contextmenu[0]({
      currentTarget: populatedButton,
      preventDefault() { prevented = true; },
      stopPropagation() {}
    });
    emptyButton.listeners.contextmenu[0]({
      currentTarget: emptyButton,
      preventDefault() {},
      stopPropagation() {}
    });

    assert.equal(prevented, true);
    assert.equal(globalThis.Dialog.instances.length, 2);
    assert.equal(globalThis.Dialog.instances[0].options.classes.includes("rm-calendar-day-dialog-window"), true);
    assert.match(globalThis.Dialog.instances[0].config.content, /Asha/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /Build compass/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /Заблокировано/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /12 ч\./u);
    assert.match(globalThis.Dialog.instances[0].config.content, /Собственная мастерская/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /Missing materials/u);
    assert.doesNotMatch(globalThis.Dialog.instances[0].config.content, /<(?:img|script|svg)\b/iu);
    assert.match(globalThis.Dialog.instances[0].config.content, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;Asha/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /&lt;\/p&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;Build compass/u);
    assert.match(globalThis.Dialog.instances[0].config.content, /&quot;&gt;&lt;svg onload=&quot;alert\(3\)&quot;&gt;Missing materials/u);
    assert.match(globalThis.Dialog.instances[1].config.content, /Нет запланированного простоя/u);
  }
  finally {
    globalThis.Dialog = previousDialog;
    dom.restore();
    restoreFoundry();
  }
});

test("InventoryApp no longer binds independent legacy day controls", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();

  try {
    const { InventoryApp } = await import(`../scripts/ui/inventory-app.js?no-craft-day=${Date.now()}`);
    const craftProcessButton = createFakeControl();
    const consumeDayButton = createFakeControl();
    const root = createFakeElement();
    root.querySelector = (selector) => {
      if (selector === "[data-action='craft-process-day']") return craftProcessButton;
      if (selector === "[data-action='consume-day']") return consumeDayButton;
      return null;
    };
    root.querySelectorAll = () => [];
    const app = new InventoryApp(createModuleApi({ getGroupContext: () => null }));
    app.element = root;

    await app._onRender({}, {});

    assert.equal(craftProcessButton.listeners.click, undefined);
    assert.equal(consumeDayButton.listeners.click, undefined);
  }
  finally {
    dom.restore();
    restoreFoundry();
  }
});
