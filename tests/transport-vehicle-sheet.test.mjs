import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { MODULE_ID } from "../scripts/constants.js";
import {
  buildTransportSpecifications,
  injectTransportSpecifications,
  registerTransportVehicleSheetHooks
} from "../scripts/integrations/transport-vehicle-sheet.js";

function createTransportActor(transport, { type = "vehicle" } = {}) {
  return {
    id: "vehicle-a",
    type,
    getFlag(scope, key) {
      return scope === MODULE_ID && key === "transport" ? transport : undefined;
    }
  };
}

function createSheetDom() {
  const ownerDocument = {
    createElement(tagName) {
      return createNode(tagName);
    }
  };
  function createNode(tagName) {
    return {
      tagName: String(tagName).toUpperCase(),
      className: "",
      textContent: "",
      children: [],
      attributes: {},
      dataset: {},
      disabled: false,
      value: "",
      listeners: new Map(),
      ownerDocument,
      setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === "name") this.name = String(value);
        if (name.startsWith("data-")) {
          const key = name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase());
          this.dataset[key] = String(value);
        }
      },
      addEventListener(name, listener) {
        this.listeners.set(name, listener);
      },
      async dispatch(name) {
        await this.listeners.get(name)?.({ currentTarget: this, preventDefault() {} });
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
      querySelector(selector) {
        if (selector === "aside" && this.tagName === "ASIDE") return this;
        if (selector.startsWith(".") && this.className.split(/\s+/u).includes(selector.slice(1))) {
          return this;
        }
        const nameMatch = selector.match(/^\[name="([^"]+)"\]$/u);
        if (nameMatch && this.name === nameMatch[1]) return this;
        const actionMatch = selector.match(/^\[data-action="([^"]+)"\]$/u);
        if (actionMatch && this.dataset.action === actionMatch[1]) return this;
        for (const child of this.children) {
          const found = child.querySelector?.(selector);
          if (found) return found;
        }
        return null;
      }
    };
  }
  const root = createNode("div");
  const aside = createNode("aside");
  root.append(aside);
  return {
    root,
    aside,
    html: {
      querySelector(selector) {
        return selector === ".window-content" ? root : root.querySelector(selector);
      }
    }
  };
}

test("vehicle specifications expose every Rebreya field absent from the native sheet", () => {
  const rows = buildTransportSpecifications(createTransportActor({
    inventionYear: "318",
    rentalPrice: { value: 10, denomination: "gp", raw: "10 зм" },
    rank: 3,
    accelerationFt: 40,
    breakdownThreshold: 5,
    consumption: { raw: "1 галлон на милю" },
    raw: { cargoCapacity: "5/500 тонн" }
  }));

  assert.deepEqual(rows, [
    { label: "Год изобретения", value: "318" },
    { label: "Цена аренды", value: "10 зм" },
    { label: "Ранг", value: "3" },
    { label: "Разгон", value: "40 фт." },
    { label: "Граница поломки", value: "5" },
    { label: "Расход топлива или корма", value: "1 галлон на милю" },
    { label: "Исходная грузоподъёмность", value: "5/500 тонн" }
  ]);
});

test("vehicle specifications omit empty optional source values", () => {
  const rows = buildTransportSpecifications(createTransportActor({
    inventionYear: "—",
    rank: null,
    accelerationFt: 0,
    breakdownThreshold: "",
    consumption: { raw: "—" },
    raw: { cargoCapacity: "" }
  }));

  assert.deepEqual(rows, []);
});

test("vehicle specifications expose a secondary combat-speed mode", () => {
  const rows = buildTransportSpecifications(createTransportActor({
    combatSpeed: {
      primaryFt: 300,
      secondaryFt: 600,
      raw: "300/600 футов"
    }
  }));

  assert.deepEqual(rows, [
    { label: "Скорость в бою (режимы)", value: "300/600 футов" }
  ]);
});

test("sheet injection only touches Rebreya vehicle actors and never duplicates the panel", () => {
  const vehicleDom = createSheetDom();
  const characterDom = createSheetDom();
  const unrelatedDom = createSheetDom();
  const vehicleApp = { actor: createTransportActor({ inventionYear: "318" }) };
  const characterApp = { actor: createTransportActor({ inventionYear: "318" }, { type: "character" }) };
  const unrelatedVehicleApp = { actor: createTransportActor(undefined) };

  assert.equal(injectTransportSpecifications(vehicleApp, vehicleDom.html), true);
  assert.equal(injectTransportSpecifications(vehicleApp, vehicleDom.html), true);
  assert.equal(vehicleDom.aside.children.length, 1);
  assert.equal(vehicleDom.aside.children[0].children[0].textContent, "Характеристики Ребреи");
  assert.equal(injectTransportSpecifications(characterApp, characterDom.html), false);
  assert.equal(injectTransportSpecifications(unrelatedVehicleApp, unrelatedDom.html), false);
});

test("vehicle sheet hooks register generic and D&D5e render callbacks once", () => {
  const calls = [];
  const Hooks = {
    on(name, callback) {
      calls.push([name, callback]);
    }
  };

  assert.equal(registerTransportVehicleSheetHooks({}, { Hooks }), true);
  assert.equal(registerTransportVehicleSheetHooks({}, { Hooks }), false);
  assert.deepEqual(calls.map(([name]) => name), [
    "renderApplicationV2",
    "renderActorSheet",
    "renderActorSheet5eVehicle"
  ]);
});

test("vehicle sheet exposes specifications without transport fuel controls", () => {
  const dom = createSheetDom();
  const actor = createTransportActor({
    inventionYear: "318",
    instance: true,
    groupActorId: "group-a",
    instanceState: {
      fuelItemId: "liquid-coal",
      fuelItemName: "Жидкий уголь",
      fuelPerMile: 0.125
    }
  });
  assert.equal(injectTransportSpecifications({ actor }, dom.html), true);
  assert.equal(dom.root.querySelector('[name="fuelItemId"]'), null);
  assert.equal(dom.root.querySelector('[name="fuelPerMile"]'), null);
  assert.equal(dom.root.querySelector('[data-action="save-transport-fuel"]'), null);
});

test("vehicle sheet specifications use a compact control surface", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(css, /\.rm-rebreya-transport-specs\s*\{/u);
  assert.match(css, /\.rm-rebreya-transport-specs\s+p\s*\{/u);
  assert.doesNotMatch(css, /\.rm-rebreya-transport-fuel\s*\{/u);
});
