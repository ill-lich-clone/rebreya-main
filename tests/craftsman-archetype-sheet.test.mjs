import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  buildCraftsmanArchetypeSheetState,
  ensureCraftsmanArchetypePartDefinition,
  registerCraftsmanTidyContent
} = await import("../scripts/integrations/craftsman-archetype-sheet.js");

function makeItem({ id, uuid, type, name, system = {}, renderCalls = [] }) {
  return {
    id,
    uuid,
    type,
    name,
    system,
    sheet: {
      render(force) {
        renderCalls.push([id, force]);
      }
    }
  };
}

function makeActor({ level = 3, includeClass = true, research = true, specialty = true } = {}) {
  const renderCalls = [];
  const items = [];
  if (includeClass) {
    items.push(makeItem({
      id: "class-1",
      uuid: "Actor.actor-1.Item.class-1",
      type: "class",
      name: "Ремесленник V0.1",
      system: { identifier: "craftsman-v01", levels: level },
      renderCalls
    }));
  }
  if (research) {
    items.push(makeItem({
      id: "research-1",
      uuid: "Actor.actor-1.Item.research-1",
      type: "rebreya-main.research",
      name: "Механик",
      system: { classIdentifier: "craftsman-v01" },
      renderCalls
    }));
  }
  if (specialty) {
    items.push(makeItem({
      id: "specialty-1",
      uuid: "Actor.actor-1.Item.specialty-1",
      type: "rebreya-main.specialty",
      name: "Конструктор",
      system: { classIdentifier: "craftsman-v01" },
      renderCalls
    }));
  }
  items.get = (id) => items.find((item) => item.id === id);
  return { id: "actor-1", items, renderCalls };
}

test("craftsman sheet state exposes both independently selected archetypes", () => {
  const actor = makeActor();

  assert.deepEqual(buildCraftsmanArchetypeSheetState(actor), {
    visible: true,
    title: "Архетипы Ремесленника",
    research: {
      label: "Исследование",
      name: "Механик",
      itemId: "research-1",
      itemUuid: "Actor.actor-1.Item.research-1",
      requiredLevel: 2,
      selected: true
    },
    specialty: {
      label: "Специальность",
      name: "Конструктор",
      itemId: "specialty-1",
      itemUuid: "Actor.actor-1.Item.specialty-1",
      requiredLevel: 3,
      selected: true
    }
  });
});

test("craftsman sheet state shows honest empty choices and stays hidden without the class", () => {
  for (const level of [1, 2]) {
    const state = buildCraftsmanArchetypeSheetState(makeActor({ level, research: false, specialty: false }));
    assert.equal(state.visible, true);
    assert.deepEqual(state.research, {
      label: "Исследование",
      name: "Не выбрано",
      itemId: "",
      itemUuid: "",
      requiredLevel: 2,
      selected: false
    });
    assert.deepEqual(state.specialty, {
      label: "Специальность",
      name: "Не выбрано",
      itemId: "",
      itemUuid: "",
      requiredLevel: 3,
      selected: false
    });
  }

  assert.deepEqual(buildCraftsmanArchetypeSheetState(makeActor({ includeClass: false })), {
    visible: false,
    title: "Архетипы Ремесленника",
    research: {
      label: "Исследование",
      name: "Не выбрано",
      itemId: "",
      itemUuid: "",
      requiredLevel: 2,
      selected: false
    },
    specialty: {
      label: "Специальность",
      name: "Не выбрано",
      itemId: "",
      itemUuid: "",
      requiredLevel: 3,
      selected: false
    }
  });
});

test("standard dnd5e sheet receives a feature-tab part and a safe open action", async () => {
  const existingAction = () => "existing";
  class CharacterActorSheet {
    static TABS = [{ tab: "features" }, { tab: "spells" }];
    static PARTS = {
      header: { template: "header.hbs" },
      features: { template: "features.hbs" },
      spells: { template: "spells.hbs" }
    };
    static DEFAULT_OPTIONS = { actions: { existingAction } };
  }
  const tabsBefore = structuredClone(CharacterActorSheet.TABS);
  const originalParts = { ...CharacterActorSheet.PARTS };

  ensureCraftsmanArchetypePartDefinition(CharacterActorSheet);
  ensureCraftsmanArchetypePartDefinition(CharacterActorSheet);

  assert.deepEqual(CharacterActorSheet.TABS, tabsBefore);
  assert.deepEqual(Object.keys(CharacterActorSheet.PARTS), ["header", "features", "craftsmanArchetypes", "spells"]);
  assert.strictEqual(CharacterActorSheet.PARTS.header, originalParts.header);
  assert.strictEqual(CharacterActorSheet.PARTS.features, originalParts.features);
  assert.strictEqual(CharacterActorSheet.PARTS.spells, originalParts.spells);
  assert.deepEqual(CharacterActorSheet.PARTS.craftsmanArchetypes.container, {
    classes: ["tab-body"],
    id: "tabs"
  });
  assert.match(CharacterActorSheet.PARTS.craftsmanArchetypes.template, /craftsman-archetypes-standard\.hbs$/u);
  assert.strictEqual(CharacterActorSheet.DEFAULT_OPTIONS.actions.existingAction, existingAction);

  const actor = makeActor();
  const sheet = { actor };
  const action = CharacterActorSheet.DEFAULT_OPTIONS.actions.openCraftsmanArchetype;
  await action.call(sheet, {}, { dataset: { itemId: "research-1" } });
  await action.call(sheet, {}, { dataset: { itemId: "not-on-actor" } });
  assert.deepEqual(actor.renderCalls, [["research-1", true]]);
});

test("Tidy5e registration uses its custom-content API and binds one embedded-item listener", async () => {
  const originalHooks = globalThis.Hooks;
  let readyHandler;
  globalThis.Hooks = {
    once(hook, handler) {
      assert.equal(hook, "tidy5e-sheet.ready");
      readyHandler = handler;
    }
  };

  try {
    registerCraftsmanTidyContent();
    assert.equal(typeof readyHandler, "function");

    const registrations = [];
    class HandlebarsContent {
      constructor(options) {
        Object.assign(this, options);
      }
    }
    const api = {
      models: { HandlebarsContent },
      registerCharacterContent(content, options) {
        registrations.push({ content, options });
      }
    };
    readyHandler(api);

    assert.equal(registrations.length, 1);
    const { content, options } = registrations[0];
    assert.equal(content instanceof HandlebarsContent, true);
    assert.equal(content.path, "/modules/rebreya-main/templates/craftsman-archetypes.hbs");
    assert.deepEqual(content.injectParams, {
      selector: "[data-tab-contents-for='features']",
      position: "afterbegin"
    });
    assert.deepEqual(options, { layout: ["classic", "quadrone"] });
    assert.equal(content.enabled({ actor: makeActor() }), true);
    assert.equal(content.enabled({ actor: makeActor({ includeClass: false }) }), false);
    assert.equal(content.getData({ actor: makeActor() }).research.name, "Механик");

    const listeners = new Set();
    const element = {
      addEventListener(type, listener) {
        assert.equal(type, "click");
        listeners.add(listener);
      },
      removeEventListener(type, listener) {
        assert.equal(type, "click");
        listeners.delete(listener);
      }
    };
    const actor = makeActor();
    content.onRender({ app: { actor }, element });
    content.onRender({ app: { actor }, element });
    assert.equal(listeners.size, 1);

    let propagationStopped = false;
    const row = { dataset: { itemId: "specialty-1" } };
    const event = {
      target: { closest: (selector) => selector === "[data-action='openCraftsmanArchetype'][data-item-id]" ? row : null },
      preventDefault() {},
      stopPropagation() { propagationStopped = true; }
    };
    await [...listeners][0](event);
    assert.equal(propagationStopped, true);
    assert.deepEqual(actor.renderCalls, [["specialty-1", true]]);
  }
  finally {
    globalThis.Hooks = originalHooks;
  }
});

test("standard craftsman sheet part remains available when Tidy5e is absent", () => {
  const originalHooks = globalThis.Hooks;
  globalThis.Hooks = { on() {} };
  class CharacterActorSheet {
    static PARTS = { features: { template: "features.hbs" } };
    static DEFAULT_OPTIONS = { actions: {} };
  }

  try {
    assert.doesNotThrow(() => registerCraftsmanTidyContent());
    ensureCraftsmanArchetypePartDefinition(CharacterActorSheet);
    assert.match(CharacterActorSheet.PARTS.craftsmanArchetypes.template, /craftsman-archetypes-standard\.hbs$/u);
  }
  finally {
    globalThis.Hooks = originalHooks;
  }
});

test("late Tidy5e registration uses the active module API without duplicating the ready hook", () => {
  const originalGame = globalThis.game;
  const originalHooks = globalThis.Hooks;
  const registrations = [];
  let readyHandler;
  class HandlebarsContent {
    constructor(options) {
      Object.assign(this, options);
    }
  }
  const api = {
    models: { HandlebarsContent },
    registerCharacterContent(content, options) {
      registrations.push({ content, options });
    }
  };
  globalThis.game = {
    modules: new Map([["tidy5e-sheet", { active: true, api }]])
  };
  globalThis.Hooks = {
    once(hook, handler) {
      assert.equal(hook, "tidy5e-sheet.ready");
      readyHandler = handler;
    }
  };

  try {
    registerCraftsmanTidyContent();
    assert.equal(registrations.length, 1);
    readyHandler(api);
    assert.equal(registrations.length, 1);
  }
  finally {
    globalThis.game = originalGame;
    globalThis.Hooks = originalHooks;
  }
});

test("sheet templates use native feature context-menu selectors without fake item rows", () => {
  const sharedTemplate = readFileSync(new URL("../templates/craftsman-archetypes.hbs", import.meta.url), "utf8");
  const standardTemplate = readFileSync(new URL("../templates/craftsman-archetypes-standard.hbs", import.meta.url), "utf8");
  const integrationSource = readFileSync(new URL("../scripts/integrations/craftsman-archetype-sheet.js", import.meta.url), "utf8");

  assert.match(sharedTemplate, /rebreya-craftsman-archetypes/u);
  assert.match(sharedTemplate, /pills-lg/u);
  assert.match(sharedTemplate, /data-action="openCraftsmanArchetype"/u);
  assert.match(sharedTemplate, /data-item-id="\{\{research\.itemId\}\}"/u);
  assert.match(sharedTemplate, /data-item-id="\{\{specialty\.itemId\}\}"/u);
  assert.match(sharedTemplate, /\{\{else\}\}[\s\S]*Не выбрано/u);
  assert.match(standardTemplate, /data-tab="features"/u);
  assert.match(standardTemplate, /data-group="primary"/u);
  assert.match(standardTemplate, /^\s*<section[^>]*>[\s\S]*\{\{#if craftsmanArchetypes\.visible\}\}/u);
  assert.match(standardTemplate, /\{\{>\s*"modules\/rebreya-main\/templates\/craftsman-archetypes\.hbs"/u);
  assert.doesNotMatch(integrationSource, /insertAdjacentHTML|renderActorSheet/u);
});

test("craftsman archetype styles stay scoped to their sheet block", () => {
  const css = readFileSync(new URL("../styles/main.css", import.meta.url), "utf8");
  const selectors = css.match(/[^{}]+(?=\{)/gu) ?? [];
  const craftsmanSelectors = selectors.filter((selector) => selector.includes("craftsman-archetype"));

  assert.ok(craftsmanSelectors.length >= 5);
  assert.equal(craftsmanSelectors.every((selector) => selector.trim().startsWith(".rebreya-craftsman-archetypes")), true);
});
