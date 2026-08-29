import test from "node:test";
import assert from "node:assert/strict";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
      return;
    }
    delete globalThis[name];
  };
}

test("data reload automatically syncs owned magic item copies through the managed compendium lifecycle", async () => {
  const events = [];
  const restores = [
    replaceGlobal("Hooks", { once() {}, on() {} }),
    replaceGlobal("foundry", {
      utils: {
        deepClone: (value) => structuredClone(value),
        escapeHTML: (value) => String(value ?? "")
      },
      applications: {
        api: {
          ApplicationV2: class {},
          HandlebarsApplicationMixin: (Base) => class extends Base {},
          DialogV2: {}
        }
      }
    }),
    replaceGlobal("game", {
      system: { id: "test" },
      user: { id: "gm", isGM: true, active: true },
      users: { activeGM: { id: "gm", isGM: true, active: true }, contents: [] },
      modules: new Map([["rebreya-main", { version: "lifecycle-test" }]]),
      i18n: { localize: (key) => key, format: (key) => key }
    }),
    replaceGlobal("ui", { notifications: { warn() {} } }),
    replaceGlobal("CONFIG", {})
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?magic-owned-lifecycle=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    moduleApi.repository = {
      async reload() {
        return { materials: [], gear: [] };
      }
    };
    moduleApi.traderService = { invalidatePackCache() {} };
    for (const property of [
      "materialsCompendium",
      "gearCompendium",
      "featsCompendium",
      "statesCompendium",
      "backgroundsCompendium",
      "racesCompendium",
      "transportCompendium",
      "craftsmanConstructCompendium",
      "classesCompendium",
      "actionsCompendium",
      "downtimeCompendium"
    ]) {
      moduleApi[property] = { async sync() {} };
    }
    moduleApi.spellsCompendium = null;
    moduleApi.magicItemsCompendium = {
      async sync() {
        events.push("pack-only");
      },
      async syncOwnedMagicItems(options) {
        events.push({ operation: "owned-copies", options });
        return { updated: [], errors: [] };
      }
    };

    await moduleApi.reloadData({ notify: false, rerender: false });

    assert.deepEqual(events, [{
      operation: "owned-copies",
      options: { reportToConsole: false }
    }]);
  }
  finally {
    for (const restore of restores.reverse()) restore();
  }
});
