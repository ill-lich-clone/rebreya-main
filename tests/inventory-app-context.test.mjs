import test from "node:test";
import assert from "node:assert/strict";

import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";

function installFoundryApplicationStub() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      escapeHTML: (value) => String(value ?? "")
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

    addEventListener(type, listener) {
      this.listeners[type] ??= [];
      this.listeners[type].push(listener);
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

function createModuleApi({ getGroupContext, partySnapshot = {}, downtimeSnapshot, downtimeError, calls = [] }) {
  return {
    async getInventorySnapshot() {
      return {
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
      return {
        crafters: [],
        queue: []
      };
    },
    getCalendarSnapshot() {
      return {
        year: 1,
        month: 1,
        day: 1
      };
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
    getGroupContext
  };
}

function createFakeControl({ dataset = {}, value = "", disabled = false } = {}) {
  const control = createFakeElement({ dataset });
  control.value = value;
  control.disabled = disabled;
  return control;
}

async function dispatchClick(button) {
  assert.ok(button.listeners.click?.length, "expected click listener");
  await button.listeners.click[0]({
    currentTarget: button,
    preventDefault() {}
  });
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
        weeks: 1,
        status: "pending",
        checks: [{ id: "check-1", label: "INT", dc: 15, ability: "int" }],
        result: ""
      }],
      actionCatalog: [
        { id: "unique", label: "Unique" },
        { id: "research", label: "Research" }
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
    assert.equal(context.downtime.requests[0].checks[0].summary, "INT | DC 15 | int");
  }
  finally {
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
    "Returned for details",
    "Survival|12|wis\nTools|15|dex"
  ];
  globalThis.prompt = () => {
    throw new Error("prompt() is not supported.");
  };
  globalThis.Dialog = class Dialog {
    constructor(config) {
      this.config = config;
    }

    render() {
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
  const checksButton = createFakeControl({
    dataset: {
      action: "downtime-checks",
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
    if (selector === "[data-action='downtime-checks']") {
      return [checksButton];
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
    await dispatchClick(grantButton);
    await dispatchClick(revokeButton);
    await dispatchClick(clearHistoryButton);
    await dispatchClick(submitButton);
    await dispatchClick(statusButton);
    await dispatchClick(checksButton);

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
      ["setDowntimeRequestChecks", "downtime-1", [
        { label: "Survival", dc: 12, ability: "wis" },
        { label: "Tools", dc: 15, ability: "dex" }
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
