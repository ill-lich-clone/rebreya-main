import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../scripts/constants.js";
import * as sheetIntegration from "../scripts/integrations/craftsman-archetype-sheet.js";

const MODULE_FEATURES_TEMPLATE = `modules/${MODULE_ID}/templates/craftsman-character-features.hbs`;
const NATIVE_CHARACTER_FEATURES_URL = new URL(
  "../../../systems/dnd5e/templates/actors/tabs/character-features.hbs",
  import.meta.url
);
const NATIVE_ACTOR_CLASSES_URL = new URL(
  "../../../systems/dnd5e/templates/actors/parts/actor-classes.hbs",
  import.meta.url
);
const ORIGINAL_GLOBALS = {
  game: globalThis.game,
  libWrapper: globalThis.libWrapper
};

function makeItem({
  id,
  type,
  name,
  img = `icons/${id}.webp`,
  identifier = "",
  classIdentifier = "",
  levels = 0,
  track = null,
  advancement = { byType: {} }
}) {
  const item = {
    id,
    _id: id,
    uuid: `Actor.actor-1.Item.${id}`,
    type,
    name,
    img,
    identifier: identifier || undefined,
    system: {
      identifier: identifier || undefined,
      classIdentifier: classIdentifier || undefined,
      levels
    },
    advancement,
    flags: track ? { [MODULE_ID]: { [CRAFTSMAN_TRACK_FLAG]: track } } : {}
  };
  item.getFlag = (scope, key) => item.flags?.[scope]?.[key];
  return item;
}

function attachActor(items) {
  const contents = [...items];
  contents.get = (id) => contents.find((item) => item.id === id) ?? null;
  const actor = {
    id: "actor-1",
    type: "character",
    items: contents,
    itemTypes: {
      class: contents.filter((item) => item.type === "class"),
      subclass: contents.filter((item) => item.type === "subclass")
    }
  };
  for (const item of contents) {
    item.actor = actor;
    item.parent = actor;
  }
  return actor;
}

function makeStandardFixture({
  level = 3,
  research = true,
  specialty = true,
  includeOrdinaryClass = true
} = {}) {
  const craftsman = makeItem({
    id: "craftsman-class",
    type: "class",
    name: "Ремесленник V0.1",
    identifier: CRAFTSMAN_CLASS_IDENTIFIER,
    levels: level,
    advancement: {
      byType: {
        ResearchSubclass: [{ level: 2 }],
        SpecialtySubclass: [{ level: 3 }]
      }
    }
  });
  const researchItem = research ? makeItem({
    id: "research-1",
    type: "subclass",
    name: "Механик",
    identifier: "mechanic",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.RESEARCH
  }) : null;
  const specialtyItem = specialty ? makeItem({
    id: "specialty-1",
    type: "subclass",
    name: "Конструктор",
    identifier: "constructor",
    classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
    track: CRAFTSMAN_TRACKS.SPECIALTY
  }) : null;
  const fighter = includeOrdinaryClass ? makeItem({
    id: "fighter-class",
    type: "class",
    name: "Воин",
    identifier: "fighter",
    levels: 2,
    advancement: { byType: { Subclass: [{ level: 2 }] } }
  }) : null;
  const champion = includeOrdinaryClass ? makeItem({
    id: "champion",
    type: "subclass",
    name: "Чемпион",
    identifier: "champion",
    classIdentifier: "fighter"
  }) : null;
  const feature = makeItem({ id: "feature-1", type: "feat", name: "Feature" });
  const items = [craftsman, researchItem, specialtyItem, fighter, champion, feature].filter(Boolean);
  const actor = attachActor(items);
  craftsman.subclass = researchItem;
  if (fighter) fighter.subclass = champion;

  const subclasses = [specialtyItem, champion, researchItem].filter(Boolean);
  const context = {
    actor,
    editable: true,
    itemCategories: {
      classes: [fighter, craftsman].filter(Boolean),
      subclasses,
      features: [feature]
    },
    itemContext: {
      [craftsman.id]: { prefixedImage: "craftsman.webp", nativeSentinel: "craftsman" },
      ...(fighter ? { [fighter.id]: { prefixedImage: "fighter.webp", nativeSentinel: "ordinary" } } : {})
    }
  };
  return { actor, champion, context, craftsman, fighter, researchItem, specialtyItem };
}

function createCharacterActorSheetClass({ onNativePrepare } = {}) {
  return class CharacterActorSheet {
    static PARTS = {
      header: { template: "header.hbs" },
      features: { template: "systems/dnd5e/templates/actors/tabs/character-features.hbs" },
      spells: { template: "spells.hbs" }
    };

    static DEFAULT_OPTIONS = {
      actions: {
        existingAction: () => "existing"
      }
    };

    constructor(actor) {
      this.actor = actor;
      this.nativePrepareCalls = 0;
    }

    async _prepareFeaturesContext(context, _options) {
      this.nativePrepareCalls += 1;
      context.subclasses = context.itemCategories.subclasses ?? [];
      context.classes = (context.itemCategories.classes ?? [])
        .sort((lhs, rhs) => rhs.system.levels - lhs.system.levels);
      onNativePrepare?.(context);
      for (const cls of context.classes) {
        const ctx = context.itemContext[cls.id] ??= {};
        const index = context.subclasses.findIndex(
          (subclass) => subclass.system.classIdentifier === cls.identifier
        );
        const subclass = index < 0 ? null : context.subclasses.splice(index, 1)[0];
        if (!subclass) {
          const subclassAdvancement = cls.advancement.byType.Subclass?.[0];
          if (subclassAdvancement && subclassAdvancement.level <= cls.system.levels) {
            ctx.needsSubclass = true;
          }
        }
      }
      const looseItems = [
        ...(context.itemCategories.features ?? []),
        ...context.subclasses
      ];
      context.sections = [
        { id: "active", items: looseItems },
        {
          id: "prepared-copy",
          items: context.subclasses.map((item) => ({ ...item, system: { ...item.system } }))
        }
      ];
      return context;
    }
  };
}

function installDirectGlobals(AdvancementManager = null) {
  globalThis.game = {
    modules: { get: () => null },
    dnd5e: { applications: { advancement: { AdvancementManager } } }
  };
  globalThis.libWrapper = undefined;
}

afterEach(() => {
  sheetIntegration.unregisterCraftsmanClassCardIntegration?.();
  globalThis.game = ORIGINAL_GLOBALS.game;
  globalThis.libWrapper = ORIGINAL_GLOBALS.libWrapper;
});

test("Standard context orders Research before Specialty for native linking and scrubs every loose Specialty copy", async () => {
  assert.equal(typeof sheetIntegration.registerCraftsmanClassCardIntegration, "function");
  const orderSeenByNative = [];
  const CharacterActorSheet = createCharacterActorSheetClass({
    onNativePrepare: (context) => orderSeenByNative.push(...context.subclasses.map((item) => item.id))
  });
  const fixture = makeStandardFixture();
  const ordinaryContextBefore = structuredClone(fixture.context.itemContext[fixture.fighter.id]);
  installDirectGlobals();

  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  const sheet = new CharacterActorSheet(fixture.actor);
  const prepared = await sheet._prepareFeaturesContext(fixture.context, { parts: ["features"] });

  assert.equal(sheet.nativePrepareCalls, 1, "the installed native method is called exactly once");
  assert.deepEqual(orderSeenByNative, ["research-1", "champion", "specialty-1"]);
  assert.equal(fixture.craftsman.subclass, fixture.researchItem, "the native singleton remains Research");
  assert.deepEqual(prepared.subclasses, []);
  assert.equal(
    prepared.sections.flatMap((section) => section.items).some((item) => (item.id ?? item._id) === "specialty-1"),
    false,
    "Specialty is removed from native and copied prepared feature sections"
  );
  assert.deepEqual(prepared.itemContext[fixture.fighter.id], ordinaryContextBefore);
});

test("Standard context exposes plain native Item view models for both Craftsman axes", () => {
  assert.equal(typeof sheetIntegration.prepareCraftsmanClassCardContext, "function");
  const { context, craftsman } = makeStandardFixture();
  context.classes = context.itemCategories.classes;
  context.subclasses = [context.itemCategories.subclasses[0]];
  context.sections = [{ id: "active", items: [...context.subclasses] }];
  context.itemContext[craftsman.id].needsSubclass = true;

  const prepared = sheetIntegration.prepareCraftsmanClassCardContext(context);
  const axes = prepared.itemContext[craftsman.id].craftsmanSubclasses;
  assert.deepEqual(axes, {
    research: {
      track: CRAFTSMAN_TRACKS.RESEARCH,
      label: "Исследование",
      name: "Механик",
      img: "icons/research-1.webp",
      uuid: "Actor.actor-1.Item.research-1",
      itemId: "research-1",
      requiredLevel: 2,
      needsSelection: false
    },
    specialty: {
      track: CRAFTSMAN_TRACKS.SPECIALTY,
      label: "Специальность",
      name: "Конструктор",
      img: "icons/specialty-1.webp",
      uuid: "Actor.actor-1.Item.specialty-1",
      itemId: "specialty-1",
      requiredLevel: 3,
      needsSelection: false
    }
  });
  assert.equal(Object.getPrototypeOf(axes.research), Object.prototype);
  assert.equal(Object.getPrototypeOf(axes.specialty), Object.prototype);
  assert.equal("needsSubclass" in prepared.itemContext[craftsman.id], false);
  assert.equal("document" in axes.research, false);
});

test("missing Craftsman selections become independently actionable only at levels 2 and 3", () => {
  assert.equal(typeof sheetIntegration.prepareCraftsmanClassCardContext, "function");
  const expected = {
    1: { research: false, specialty: false },
    2: { research: true, specialty: false },
    3: { research: true, specialty: true }
  };

  for (const level of [1, 2, 3]) {
    const { context, craftsman } = makeStandardFixture({
      level,
      research: false,
      specialty: false,
      includeOrdinaryClass: false
    });
    context.classes = context.itemCategories.classes;
    context.subclasses = [];
    context.sections = [{ id: "active", items: [] }];
    context.itemContext[craftsman.id].needsSubclass = true;

    sheetIntegration.prepareCraftsmanClassCardContext(context);
    const axes = context.itemContext[craftsman.id].craftsmanSubclasses;
    assert.deepEqual(
      {
        research: axes.research.needsSelection,
        specialty: axes.specialty.needsSelection
      },
      expected[level],
      `level ${level}`
    );
    assert.equal(axes.research.name, "Не выбрано");
    assert.equal(axes.specialty.name, "Не выбрано");
    assert.equal("needsSubclass" in context.itemContext[craftsman.id], false);
  }
});

test("ordinary classes and their prepared item context remain untouched", () => {
  assert.equal(typeof sheetIntegration.prepareCraftsmanClassCardContext, "function");
  const fighter = makeItem({
    id: "fighter-class",
    type: "class",
    name: "Воин",
    identifier: "fighter",
    levels: 3,
    advancement: { byType: { Subclass: [{ level: 3 }] } }
  });
  const champion = makeItem({
    id: "champion",
    type: "subclass",
    name: "Чемпион",
    classIdentifier: "fighter"
  });
  attachActor([fighter, champion]);
  const ordinaryItemContext = { prefixedImage: "fighter.webp", needsSubclass: false, native: { stable: true } };
  const context = {
    classes: [fighter],
    subclasses: [champion],
    sections: [{ id: "active", items: [champion] }],
    itemContext: { [fighter.id]: ordinaryItemContext }
  };
  const classesBefore = [...context.classes];
  const subclassesBefore = [...context.subclasses];
  const sectionItemsBefore = [...context.sections[0].items];

  assert.strictEqual(sheetIntegration.prepareCraftsmanClassCardContext(context), context);
  assert.deepEqual(context.classes, classesBefore);
  assert.deepEqual(context.subclasses, subclassesBefore);
  assert.deepEqual(context.sections[0].items, sectionItemsBefore);
  assert.strictEqual(context.itemContext[fighter.id], ordinaryItemContext);
});

test("Standard registration replaces only the native features template, delegates actions, and tears down cleanly", async () => {
  assert.equal(typeof sheetIntegration.registerCraftsmanClassCardIntegration, "function");
  assert.equal(typeof sheetIntegration.unregisterCraftsmanClassCardIntegration, "function");
  const modifyCalls = [];
  class AdvancementManager {
    static forModifyChoices(actor, classId, level) {
      modifyCalls.push({ actor, classId, level });
      return {
        steps: [{}],
        render(options) {
          this.renderOptions = options;
        }
      };
    }
  }
  const CharacterActorSheet = createCharacterActorSheetClass();
  const originalFeaturesTemplate = CharacterActorSheet.PARTS.features.template;
  const originalPrepare = CharacterActorSheet.prototype._prepareFeaturesContext;
  const originalAction = CharacterActorSheet.DEFAULT_OPTIONS.actions.existingAction;
  const fixture = makeStandardFixture();
  installDirectGlobals(AdvancementManager);

  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  const ownedPrepare = CharacterActorSheet.prototype._prepareFeaturesContext;
  const ownedAction = CharacterActorSheet.DEFAULT_OPTIONS.actions.openCraftsmanSubclassChoice;
  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  assert.strictEqual(CharacterActorSheet.prototype._prepareFeaturesContext, ownedPrepare, "registration does not stack");
  assert.strictEqual(CharacterActorSheet.DEFAULT_OPTIONS.actions.openCraftsmanSubclassChoice, ownedAction);
  assert.deepEqual(Object.keys(CharacterActorSheet.PARTS), ["header", "features", "spells"]);
  assert.equal(CharacterActorSheet.PARTS.features.template, MODULE_FEATURES_TEMPLATE);
  assert.strictEqual(CharacterActorSheet.DEFAULT_OPTIONS.actions.existingAction, originalAction);

  const sheet = new CharacterActorSheet(fixture.actor);
  await ownedAction.call(sheet, {}, {
    dataset: { classId: fixture.craftsman.id, track: CRAFTSMAN_TRACKS.RESEARCH }
  });
  await ownedAction.call(sheet, {}, {
    dataset: { classId: fixture.craftsman.id, track: CRAFTSMAN_TRACKS.SPECIALTY }
  });
  assert.deepEqual(modifyCalls.map(({ classId, level }) => ({ classId, level })), [
    { classId: fixture.craftsman.id, level: 2 },
    { classId: fixture.craftsman.id, level: 3 }
  ]);

  sheetIntegration.unregisterCraftsmanClassCardIntegration();
  assert.equal(CharacterActorSheet.PARTS.features.template, originalFeaturesTemplate);
  assert.strictEqual(CharacterActorSheet.prototype._prepareFeaturesContext, originalPrepare);
  assert.equal("openCraftsmanSubclassChoice" in CharacterActorSheet.DEFAULT_OPTIONS.actions, false);
  assert.strictEqual(CharacterActorSheet.DEFAULT_OPTIONS.actions.existingAction, originalAction);
});

test("Standard teardown never overwrites later template, action, or method owners", () => {
  assert.equal(typeof sheetIntegration.registerCraftsmanClassCardIntegration, "function");
  const CharacterActorSheet = createCharacterActorSheetClass();
  installDirectGlobals();
  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  const thirdPartyPrepare = async function(context) { return context; };
  const thirdPartyAction = () => "third-party";
  CharacterActorSheet.PARTS.features.template = "modules/third-party/features.hbs";
  CharacterActorSheet.DEFAULT_OPTIONS.actions.openCraftsmanSubclassChoice = thirdPartyAction;
  CharacterActorSheet.prototype._prepareFeaturesContext = thirdPartyPrepare;

  sheetIntegration.unregisterCraftsmanClassCardIntegration();

  assert.equal(CharacterActorSheet.PARTS.features.template, "modules/third-party/features.hbs");
  assert.strictEqual(CharacterActorSheet.DEFAULT_OPTIONS.actions.openCraftsmanSubclassChoice, thirdPartyAction);
  assert.strictEqual(CharacterActorSheet.prototype._prepareFeaturesContext, thirdPartyPrepare);
});

test("libWrapper registration uses one MIXED public-method wrapper and unregisters by ID", () => {
  assert.equal(typeof sheetIntegration.registerCraftsmanClassCardIntegration, "function");
  const CharacterActorSheet = createCharacterActorSheetClass();
  const calls = [];
  globalThis.game = {
    modules: { get: (id) => id === "lib-wrapper" ? { active: true } : null },
    dnd5e: { applications: { actor: { CharacterActorSheet } } }
  };
  globalThis.libWrapper = {
    register(packageId, target, wrapper, type) {
      calls.push({ action: "register", packageId, target, type, wrapper });
      return 73;
    },
    unregister(packageId, id) {
      calls.push({ action: "unregister", packageId, id });
    }
  };

  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  assert.equal(sheetIntegration.registerCraftsmanClassCardIntegration(CharacterActorSheet), true);
  const registrations = calls.filter((call) => call.action === "register");
  assert.equal(registrations.length, 1);
  assert.deepEqual(
    {
      packageId: registrations[0].packageId,
      target: registrations[0].target,
      type: registrations[0].type
    },
    {
      packageId: MODULE_ID,
      target: "game.dnd5e.applications.actor.CharacterActorSheet.prototype._prepareFeaturesContext",
      type: "MIXED"
    }
  );

  sheetIntegration.unregisterCraftsmanClassCardIntegration();
  assert.deepEqual(calls.at(-1), { action: "unregister", packageId: MODULE_ID, id: 73 });
});

test("module templates pin installed dnd5e structure and keep both axes in one native class pill", () => {
  const nativeFeatures = readFileSync(NATIVE_CHARACTER_FEATURES_URL, "utf8");
  const nativeClasses = readFileSync(NATIVE_ACTOR_CLASSES_URL, "utf8");
  const featuresTemplateUrl = new URL("../templates/craftsman-character-features.hbs", import.meta.url);
  const classesTemplateUrl = new URL("../templates/craftsman-actor-classes.hbs", import.meta.url);
  assert.equal(existsSync(featuresTemplateUrl), true, "module features template exists");
  assert.equal(existsSync(classesTemplateUrl), true, "module class partial exists");
  const featuresTemplate = readFileSync(featuresTemplateUrl, "utf8");
  const classesTemplate = readFileSync(classesTemplateUrl, "utf8");
  const hash = (source) => createHash("sha256").update(source).digest("hex");

  assert.equal(hash(nativeFeatures), "f580249840dab53955fe0a8735491992e90c57f23014a7de0e285ba6ed5e442c");
  assert.equal(hash(nativeClasses), "5f8d379291f78d00d70c51cef2d82922b8c3295dd80a333e72598b9a80a23666");
  assert.equal(featuresTemplate, nativeFeatures.replace(
    '{{> "dnd5e.actor-classes" }}',
    '{{> "modules/rebreya-main/templates/craftsman-actor-classes.hbs" }}'
  ));

  const pillStart = classesTemplate.indexOf('<div class="class pill-lg');
  const pillEnd = classesTemplate.indexOf("{{/dnd5e-itemContext}}", pillStart);
  const classPill = classesTemplate.slice(pillStart, pillEnd);
  assert.ok(pillStart >= 0 && pillEnd > pillStart);
  assert.match(classPill, /ctx\.craftsmanSubclasses\.research/u);
  assert.match(classPill, /ctx\.craftsmanSubclasses\.specialty/u);
  assert.ok(
    classPill.indexOf("ctx.craftsmanSubclasses.research")
      < classPill.indexOf("ctx.craftsmanSubclasses.specialty"),
    "Research markup precedes Specialty markup"
  );
  assert.match(classPill, /data-action="showDocument"[\s\S]*data-item-id="\{\{ axis\.itemId \}\}"/u);
  assert.match(classPill, /data-action="deleteDocument"[\s\S]*data-item-id="\{\{ axis\.itemId \}\}"/u);
  assert.match(classPill, /data-action="openCraftsmanSubclassChoice"/u);
  assert.match(classPill, /data-class-id="\{\{ cls\.id \}\}"/u);
  assert.doesNotMatch(classesTemplate, /Архетипы Ремесленника/u);

  for (const nativeOrdinaryFragment of [
    'data-action="findItem" data-item-type="subclass"',
    'data-class-identifier="{{ cls.identifier }}" data-tooltip="DND5E.SubclassAdd"',
    '<select class="level-selector">',
    '{{ selectOptions ctx.availableLevels selected=0 }}',
    '{{#if @root.showClassDrop}}'
  ]) {
    assert.ok(classesTemplate.includes(nativeOrdinaryFragment), `preserves native fragment: ${nativeOrdinaryFragment}`);
  }

  const nativePillStart = nativeClasses.indexOf('<div class="class pill-lg"');
  const nativePillEnd = nativeClasses.indexOf("    {{/dnd5e-itemContext}}", nativePillStart);
  const ordinaryMarker = "{{!-- Ordinary classes keep the installed native pill byte-for-byte. --}}";
  const moduleOrdinaryStart = classesTemplate.indexOf('<div class="class pill-lg"', classesTemplate.indexOf(ordinaryMarker));
  const moduleOrdinaryEnd = classesTemplate.indexOf("    {{/if}}\n    {{/dnd5e-itemContext}}", moduleOrdinaryStart);
  assert.equal(
    classesTemplate.slice(moduleOrdinaryStart, moduleOrdinaryEnd).trimEnd(),
    nativeClasses.slice(nativePillStart, nativePillEnd).trimEnd(),
    "the ordinary-class pill is an exact installed-native fixture"
  );
});

test("obsolete Standard part and standalone-section CSS are removed in favor of class-pill modifiers", () => {
  const css = readFileSync(new URL("../styles/main.css", import.meta.url), "utf8");
  const integrationSource = readFileSync(
    new URL("../scripts/integrations/craftsman-archetype-sheet.js", import.meta.url),
    "utf8"
  );

  assert.equal(
    existsSync(new URL("../templates/craftsman-archetypes-standard.hbs", import.meta.url)),
    false
  );
  assert.doesNotMatch(css, /\.rebreya-craftsman-archetypes(?:__|\s|\{)/u);
  assert.match(css, /\.class\.pill-lg\.rebreya-craftsman-class/u);
  assert.match(css, /\.rebreya-craftsman-axis/u);
  assert.doesNotMatch(integrationSource, /RESEARCH_ITEM_TYPE|SPECIALTY_ITEM_TYPE/u);
  assert.doesNotMatch(integrationSource, /craftsmanArchetypes|craftsman-archetypes-standard/u);
});
