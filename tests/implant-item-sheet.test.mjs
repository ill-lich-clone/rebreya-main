import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { renderImplantItemSheetActions } from "../scripts/integrations/implant-item-sheet.js";

function mechanismItem(actor) {
  return {
    id: "reload-implant",
    name: "Механизм перезарядки оружия",
    type: "loot",
    actor,
    parent: actor,
    flags: {
      [MODULE_ID]: {
        gearId: "mekhanizm-perezaryadki-oruzhiya"
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function sheetRoot() {
  const listeners = new Map();
  const button = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async click() {
      await listeners.get("click")?.({
        preventDefault() {},
        stopPropagation() {}
      });
    }
  };
  return {
    inserted: "",
    button,
    querySelector(selector) {
      if (selector === "[data-rebreya-implant-reload-action]") {
        return this.inserted ? button : null;
      }
      if (selector === "form") return this;
      return null;
    },
    insertAdjacentHTML(_position, html) {
      this.inserted = html;
    }
  };
}

test("reload mechanism Item sheet renders one loading action and delegates it to the firearm service", async () => {
  const actor = { id: "hero" };
  const item = mechanismItem(actor);
  const root = sheetRoot();
  const calls = [];
  const moduleApi = {
    implantAutomationService: {
      hasCapability: (candidate, type) => (
        candidate === actor && type === "reloadWithoutFreeHand"
      )
    },
    promptImplantReloadReservoir: async () => ({
      ammunitionItemId: "ammo",
      amount: 12
    }),
    combatAttackService: {
      loadImplantReloadReservoir: async (...args) => calls.push(args)
    }
  };

  assert.equal(renderImplantItemSheetActions({ document: item }, root, moduleApi), true);
  assert.match(root.inserted, /Загрузить механизм/u);
  assert.equal(renderImplantItemSheetActions({ document: item }, root, moduleApi), true);

  await root.button.click();

  assert.deepEqual(calls, [[actor, {
    ammunitionItemId: "ammo",
    amount: 12
  }]]);
});

test("implant Item sheet action ignores unrelated and inactive Items", () => {
  const actor = { id: "hero" };
  const inactiveRoot = sheetRoot();
  const unrelatedRoot = sheetRoot();
  const moduleApi = {
    implantAutomationService: {
      hasCapability: () => false
    },
    combatAttackService: {
      loadImplantReloadReservoir: async () => {}
    }
  };
  const unrelated = {
    ...mechanismItem(actor),
    flags: {
      [MODULE_ID]: {
        gearId: "navesnaya-bronya"
      }
    }
  };

  assert.equal(renderImplantItemSheetActions({ document: mechanismItem(actor) }, inactiveRoot, moduleApi), false);
  assert.equal(renderImplantItemSheetActions({ document: unrelated }, unrelatedRoot, moduleApi), false);
  assert.equal(inactiveRoot.inserted, "");
  assert.equal(unrelatedRoot.inserted, "");
});
