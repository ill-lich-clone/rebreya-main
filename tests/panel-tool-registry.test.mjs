import assert from "node:assert/strict";
import test from "node:test";

import { PanelToolRegistry } from "../scripts/ui/panel-tool-registry.js";

function definition(overrides = {}) {
  return {
    name: "rebreya-gen-purchase",
    title: "Закупка",
    icon: "fa-solid fa-cart-shopping",
    order: 45,
    visible: () => true,
    onChange: () => undefined,
    ...overrides
  };
}

function createRegistry({ activeModules = ["rebreya-gen"], loadedModules = [] } = {}) {
  const refreshes = [];
  const registry = new PanelToolRegistry({
    moduleProvider: (id) => ({
      id,
      active: activeModules.includes(id),
      ...(loadedModules.includes(id) ? { api: {} } : {})
    }),
    refresh: () => refreshes.push("refresh")
  });
  return { refreshes, registry };
}

test("panel registry registers one active owner and returns detached sorted tools", () => {
  const { refreshes, registry } = createRegistry();
  const purchase = definition();
  registry.register("rebreya-gen", definition({ name: "later", order: 50 }));
  const result = registry.register("rebreya-gen", purchase);

  const listed = registry.list();
  listed[0].title = "changed by caller";

  assert.equal(result.registered, true);
  assert.deepEqual(registry.list().map((tool) => tool.name), ["rebreya-gen-purchase", "later"]);
  assert.equal(registry.list()[0].title, "Закупка");
  assert.equal(refreshes.length, 2);
});

test("panel registry accepts an owner whose runtime API proves its module code is loaded", () => {
  const { refreshes, registry } = createRegistry({
    activeModules: [],
    loadedModules: ["rebreya-gen"]
  });

  const result = registry.register("rebreya-gen", definition());

  assert.equal(result.registered, true);
  assert.equal(refreshes.length, 1);
});

test("panel registry is idempotent only for the identical owner definition", () => {
  const { refreshes, registry } = createRegistry();
  const purchase = definition();

  const first = registry.register("rebreya-gen", purchase);
  const duplicate = registry.register("rebreya-gen", purchase);

  assert.equal(first.registered, true);
  assert.equal(duplicate.registered, false);
  assert.equal(refreshes.length, 1);
  assert.throws(
    () => registry.register("rebreya-gen", { ...purchase, title: "Другая кнопка" }),
    /already registered/u
  );
});

test("panel registry rejects another module claiming an existing tool name", () => {
  const { registry } = createRegistry({ activeModules: ["rebreya-gen", "other-module"] });
  registry.register("rebreya-gen", definition());

  assert.throws(
    () => registry.register("other-module", definition()),
    /already owned by 'rebreya-gen'/u
  );
});

test("panel registry unregisters only through the owning module", () => {
  const { refreshes, registry } = createRegistry({ activeModules: ["rebreya-gen", "other-module"] });
  const registration = registry.register("rebreya-gen", definition());

  assert.equal(registry.unregister("other-module", "rebreya-gen-purchase"), false);
  assert.equal(registry.list().length, 1);
  assert.equal(registration.unregister(), true);
  assert.equal(registry.list().length, 0);
  assert.equal(refreshes.length, 2);
});

test("panel registry rejects inactive owners and malformed definitions", () => {
  const { registry } = createRegistry({ activeModules: [] });
  assert.throws(() => registry.register("rebreya-gen", definition()), /is not active/u);

  const active = createRegistry().registry;
  assert.throws(() => active.register("rebreya-gen", definition({ name: "" })), /name/u);
  assert.throws(() => active.register("rebreya-gen", definition({ order: Number.NaN })), /order/u);
  assert.throws(() => active.register("rebreya-gen", definition({ onChange: null })), /onChange/u);
});
