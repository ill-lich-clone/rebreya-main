import test from "node:test";
import assert from "node:assert/strict";

import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";

function installFoundryApplicationStub() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
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

function createModuleApi({ getGroupContext, partySnapshot = {} }) {
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
    getGroupContext
  };
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
