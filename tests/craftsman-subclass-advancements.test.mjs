import test from "node:test";
import assert from "node:assert/strict";
import {
  getCraftsmanSubclassAdvancementClasses,
  registerCraftsmanSubclassAdvancements
} from "../scripts/integrations/craftsman-subclass-advancements.js";
import {
  CRAFTSMAN_ARCHETYPE_ID_FLAG,
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../scripts/constants.js";

function mergeObject(original, other, { inplace = true } = {}) {
  const target = inplace ? (original ?? {}) : { ...(original ?? {}) };
  for (const [key, value] of Object.entries(other ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Set)) {
      target[key] = mergeObject(target[key] ?? {}, value, { inplace: true });
    }
    else {
      target[key] = value;
    }
  }
  return target;
}

function getProperty(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const parts = path.split(".");
  const final = parts.pop();
  let target = object;
  for (const part of parts) target = target[part] ??= {};
  target[final] = value;
  return true;
}

function makeSubclass({
  id,
  track,
  archetypeId = `archetype-${id}`,
  classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER,
  managed = true,
  type = "subclass"
}) {
  return {
    id,
    _id: id,
    uuid: `Compendium.world.rebreya-subclasses.Item.${id}`,
    name: `Subclass ${id}`,
    type,
    system: { classIdentifier },
    flags: {
      [MODULE_ID]: {
        [CRAFTSMAN_ARCHETYPE_ID_FLAG]: archetypeId,
        [CRAFTSMAN_TRACK_FLAG]: track,
        managed
      },
      dnd5e: { sourceId: `Compendium.world.rebreya-subclasses.Item.${id}` }
    },
    toAnchor() {
      return { outerHTML: `<a data-id="${this.id}">${this.name}</a>` };
    },
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        system: { ...this.system },
        flags: structuredClone(this.flags)
      };
    }
  };
}

function makeActor(items = []) {
  const collection = new Map(items.map((item) => [item.id, item]));
  return {
    items: collection,
    updateSource(update) {
      for (const source of update.items ?? []) {
        const document = makeSubclass({
          id: source._id,
          track: source.flags?.[MODULE_ID]?.[CRAFTSMAN_TRACK_FLAG],
          classIdentifier: source.system?.classIdentifier,
          type: source.type
        });
        document.name = source.name;
        document.flags = structuredClone(source.flags ?? {});
        collection.set(document.id, document);
      }
    }
  };
}

function makeClass(actor, advancementByType = {}) {
  return {
    type: "class",
    actor,
    system: { identifier: CRAFTSMAN_CLASS_IDENTIFIER },
    get identifier() {
      return this.system.identifier;
    },
    advancement: { byType: advancementByType }
  };
}

function installDnd5eContractStubs() {
  const originals = Object.fromEntries(["CONFIG", "game", "foundry", "fromUuid", "Item", "ui"]
    .map((key) => [key, globalThis[key]]));
  const sources = new Map();
  const browserCalls = [];
  const warnings = [];
  const parentCalls = [];

  class SubclassFlow {
    static get defaultOptions() {
      return {
        classes: ["dnd5e", "advancement", "subclass"],
        dragDrop: [{ dropSelector: "form" }],
        template: "systems/dnd5e/templates/advancement/subclass-flow.hbs"
      };
    }

    constructor({ advancement, level = 0 } = {}) {
      this.advancement = advancement;
      this.item = advancement?.item;
      this.level = level;
      this.renderCount = 0;
    }

    render() {
      this.renderCount += 1;
    }
  }

  class SubclassAdvancement {
    static get typeName() {
      return this.name.replace(/Advancement$/, "");
    }

    static get metadata() {
      return {
        dataModels: { value: class SubclassValueData {} },
        order: 70,
        icon: "icons/skills/trades/mining-pickaxe-yellow-blue.webp",
        typeIcon: "systems/dnd5e/icons/svg/subclass.svg",
        title: "DND5E.ADVANCEMENT.Subclass.Title",
        hint: "DND5E.ADVANCEMENT.Subclass.Hint",
        apps: { flow: SubclassFlow }
      };
    }

    constructor({ item, actor } = {}) {
      this.item = item;
      this.actor = actor;
      this.value = {};
    }

    configuredForLevel() {
      return Object.keys(this.value ?? {}).length > 0;
    }

    async createItemData(uuid) {
      const source = sources.get(uuid);
      if (!source) return null;
      const data = source.toObject();
      data.flags.dnd5e.advancementOrigin = "origin-id";
      data.flags.dnd5e.advancementRoot = "root-id";
      return data;
    }

    updateSource(update) {
      if (update.value) this.value = { ...this.value, ...update.value };
    }

    async apply(level, data, retainedData) {
      parentCalls.push({ method: "apply", level, data, retainedData });
      const useRetained = data.uuid === getProperty(retainedData, "flags.dnd5e.sourceId");
      let itemData = useRetained ? structuredClone(retainedData) : null;
      if (!itemData) {
        itemData = await this.createItemData(data.uuid);
        delete itemData.flags?.dnd5e?.advancementOrigin;
        delete itemData.flags?.dnd5e?.advancementRoot;
        setProperty(itemData, "system.classIdentifier", this.item.identifier);
      }
      if (itemData) {
        this.actor.updateSource({ items: [itemData] });
        this.updateSource({ value: { document: itemData._id, uuid: data.uuid } });
      }
    }

    async restore(level, data) {
      parentCalls.push({ method: "restore", level, data });
      if (!data) return;
      this.actor.updateSource({ items: [data] });
      this.updateSource({
        value: {
          document: data._id,
          uuid: data._stats?.compendiumSource ?? data.flags?.dnd5e?.sourceId
        }
      });
    }

    async reverse(level) {
      parentCalls.push({ method: "reverse", level });
      const item = this.value.document ?? this.item.subclass;
      if (!item) return undefined;
      this.actor.items.delete(item.id);
      this.updateSource({ value: { document: null, uuid: null } });
      return item.toObject();
    }
  }

  globalThis.foundry = {
    utils: {
      getProperty,
      isEmpty: (value) => !value || Object.keys(value).length === 0,
      mergeObject,
      setProperty
    }
  };
  globalThis.CONFIG = { DND5E: { advancementTypes: {} } };
  globalThis.game = {
    dnd5e: {
      documents: { advancement: { SubclassAdvancement } },
      applications: {
        advancement: { SubclassFlow },
        CompendiumBrowser: {
          async selectOne(options) {
            browserCalls.push(options);
            return globalThis.__browserResult ?? null;
          }
        }
      }
    },
    i18n: { localize: (key) => key }
  };
  globalThis.fromUuid = async (uuid) => sources.get(uuid) ?? null;
  globalThis.Item = {
    implementation: {
      async fromDropData(data) {
        return sources.get(data.uuid) ?? null;
      }
    }
  };
  globalThis.ui = {
    notifications: {
      warn(key, options) {
        warnings.push({ key, options });
      }
    }
  };

  return {
    SubclassAdvancement,
    SubclassFlow,
    browserCalls,
    parentCalls,
    restore() {
      for (const [key, value] of Object.entries(originals)) globalThis[key] = value;
      delete globalThis.__browserResult;
    },
    sources,
    warnings
  };
}

test("tracked advancements and flows inherit the complete native subclass contracts", () => {
  const stubs = installDnd5eContractStubs();
  try {
    assert.equal(registerCraftsmanSubclassAdvancements(), true);
    const { ResearchSubclass, SpecialtySubclass, ResearchSubclassFlow, SpecialtySubclassFlow } =
      getCraftsmanSubclassAdvancementClasses();

    assert.equal(ResearchSubclass.prototype instanceof stubs.SubclassAdvancement, true);
    assert.equal(SpecialtySubclass.prototype instanceof stubs.SubclassAdvancement, true);
    assert.equal(ResearchSubclass.name, "ResearchSubclassAdvancement");
    assert.equal(SpecialtySubclass.name, "SpecialtySubclassAdvancement");
    assert.equal(ResearchSubclass.typeName, "ResearchSubclass");
    assert.equal(SpecialtySubclass.typeName, "SpecialtySubclass");
    assert.equal(ResearchSubclassFlow.prototype instanceof stubs.SubclassFlow, true);
    assert.equal(SpecialtySubclassFlow.prototype instanceof stubs.SubclassFlow, true);
    assert.equal(ResearchSubclass.metadata.apps.flow, ResearchSubclassFlow);
    assert.equal(SpecialtySubclass.metadata.apps.flow, SpecialtySubclassFlow);
    assert.equal(ResearchSubclassFlow.defaultOptions.template, "systems/dnd5e/templates/advancement/subclass-flow.hbs");
    assert.deepEqual(ResearchSubclassFlow.defaultOptions.dragDrop, [{ dropSelector: "form" }]);
    assert.equal(ResearchSubclass.metadata.order, 70);
    assert.equal(ResearchSubclass.metadata.typeIcon, "systems/dnd5e/icons/svg/subclass.svg");
    assert.equal(ResearchSubclass.metadata.icon, "systems/dnd5e/icons/classes/sage.webp");
    assert.equal(SpecialtySubclass.metadata.icon, "systems/dnd5e/icons/classes/fighter.webp");
    assert.deepEqual([...CONFIG.DND5E.advancementTypes.ResearchSubclass.validItemTypes], ["class"]);
    assert.deepEqual([...CONFIG.DND5E.advancementTypes.SpecialtySubclass.validItemTypes], ["class"]);
    assert.equal(CONFIG.DND5E.advancementTypes.ResearchSubclass.documentClass.typeName, "ResearchSubclass");
    assert.equal(CONFIG.DND5E.advancementTypes.SpecialtySubclass.documentClass.typeName, "SpecialtySubclass");
  }
  finally {
    stubs.restore();
  }
});

test("availability is restricted to the Craftsman class and one advancement per track", () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const actor = makeActor();

    assert.equal(ResearchSubclass.availableForItem(makeClass(actor)), true);
    assert.equal(SpecialtySubclass.availableForItem(makeClass(actor, { ResearchSubclass: [{}] })), true);
    assert.equal(ResearchSubclass.availableForItem(makeClass(actor, { ResearchSubclass: [{}] })), false);
    assert.equal(SpecialtySubclass.availableForItem(makeClass(actor, { SpecialtySubclass: [{}] })), false);
    assert.equal(ResearchSubclass.availableForItem({
      ...makeClass(actor), system: { identifier: "fighter-v01" }
    }), false);
    assert.equal(ResearchSubclass.availableForItem({
      ...makeClass(actor), type: "subclass"
    }), false);
  }
  finally {
    stubs.restore();
  }
});

test("each flow browses only native subclasses for its Craftsman track", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const actor = makeActor();
    const item = makeClass(actor);
    const researchAdvancement = new ResearchSubclass({ item, actor });
    const specialtyAdvancement = new SpecialtySubclass({ item, actor });
    const research = makeSubclass({ id: "research-browser", track: CRAFTSMAN_TRACKS.RESEARCH });
    const specialty = makeSubclass({ id: "specialty-browser", track: CRAFTSMAN_TRACKS.SPECIALTY });
    stubs.sources.set(research.uuid, research);
    stubs.sources.set(specialty.uuid, specialty);

    globalThis.__browserResult = research.uuid;
    const researchFlow = new ResearchSubclass.metadata.apps.flow({ advancement: researchAdvancement, level: 2 });
    await researchFlow._onBrowseCompendium({ preventDefault() {} });
    assert.equal(researchFlow.subclass, research);
    assert.deepEqual(stubs.browserCalls[0], {
      filters: {
        locked: {
          additional: { class: { [CRAFTSMAN_CLASS_IDENTIFIER]: 1 } },
          arbitrary: [{
            k: `flags.${MODULE_ID}.${CRAFTSMAN_TRACK_FLAG}`,
            o: "exact",
            v: CRAFTSMAN_TRACKS.RESEARCH
          }],
          types: new Set(["subclass"])
        }
      }
    });

    globalThis.__browserResult = specialty.uuid;
    const specialtyFlow = new SpecialtySubclass.metadata.apps.flow({ advancement: specialtyAdvancement, level: 3 });
    await specialtyFlow._onBrowseCompendium({ preventDefault() {} });
    assert.equal(stubs.browserCalls[1].filters.locked.arbitrary[0].o, "exact");
    assert.equal(stubs.browserCalls[1].filters.locked.arbitrary[0].v, CRAFTSMAN_TRACKS.SPECIALTY);
  }
  finally {
    stubs.restore();
  }
});

test("both tracked browsers preserve selection on cancel and reject unresolved or unmanaged sources", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const actor = makeActor();
    const item = makeClass(actor);
    const research = makeSubclass({ id: "research-selected", track: CRAFTSMAN_TRACKS.RESEARCH });
    const specialty = makeSubclass({ id: "specialty-selected", track: CRAFTSMAN_TRACKS.SPECIALTY });
    const flows = [
      new ResearchSubclass.metadata.apps.flow({ advancement: new ResearchSubclass({ item, actor }), level: 2 }),
      new SpecialtySubclass.metadata.apps.flow({ advancement: new SpecialtySubclass({ item, actor }), level: 3 })
    ];
    flows[0].subclass = research;
    flows[1].subclass = specialty;

    globalThis.__browserResult = null;
    await flows[0]._onBrowseCompendium({ preventDefault() {} });
    await flows[1]._onBrowseCompendium({ preventDefault() {} });
    assert.equal(flows[0].subclass, research);
    assert.equal(flows[1].subclass, specialty);

    globalThis.__browserResult = "Compendium.world.rebreya-subclasses.Item.missing";
    await flows[0]._onBrowseCompendium({ preventDefault() {} });
    assert.equal(flows[0].subclass, research);
    assert.equal(stubs.warnings.at(-1).key, "DND5E.ADVANCEMENT.Subclass.Warning.InvalidType");

    const unmanaged = makeSubclass({
      id: "specialty-unmanaged-browser",
      managed: false,
      track: CRAFTSMAN_TRACKS.SPECIALTY
    });
    stubs.sources.set(unmanaged.uuid, unmanaged);
    globalThis.__browserResult = unmanaged.uuid;
    await flows[1]._onBrowseCompendium({ preventDefault() {} });
    assert.equal(flows[1].subclass, specialty);
    assert.equal(stubs.warnings.at(-1).key, "REBREYA_MAIN.CraftsmanSubclass.InvalidSource");
  }
  finally {
    stubs.restore();
  }
});

test("drag-and-drop accepts only the requested Craftsman track and reports distinct failures", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass } = getCraftsmanSubclassAdvancementClasses();
    const existing = makeSubclass({ id: "existing-research", track: CRAFTSMAN_TRACKS.RESEARCH });
    const actor = makeActor();
    const advancement = new ResearchSubclass({ item: makeClass(actor), actor });
    const Flow = ResearchSubclass.metadata.apps.flow;
    const flow = new Flow({ advancement, level: 2 });
    const candidates = [
      makeSubclass({ id: "valid-research", track: CRAFTSMAN_TRACKS.RESEARCH }),
      makeSubclass({ id: "wrong-class", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: "fighter-v01" }),
      makeSubclass({ id: "wrong-track", track: CRAFTSMAN_TRACKS.SPECIALTY }),
      makeSubclass({ id: "wrong-type", track: CRAFTSMAN_TRACKS.RESEARCH, type: "feat" }),
      makeSubclass({ id: "unmanaged", managed: false, track: CRAFTSMAN_TRACKS.RESEARCH }),
      makeSubclass({ id: "missing-archetype", archetypeId: "", track: CRAFTSMAN_TRACKS.RESEARCH })
    ];
    for (const candidate of candidates) stubs.sources.set(candidate.uuid, candidate);
    const drop = (candidate) => flow._onDrop({
      dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: candidate.uuid }) }
    });

    await drop(candidates[0]);
    assert.equal(flow.subclass, candidates[0]);

    await drop(candidates[1]);
    await drop(candidates[2]);
    await drop(candidates[3]);
    await drop(candidates[4]);
    await drop(candidates[5]);
    assert.deepEqual(stubs.warnings.map(({ key }) => key), [
      "REBREYA_MAIN.CraftsmanSubclass.InvalidClass",
      "REBREYA_MAIN.CraftsmanSubclass.InvalidTrack",
      "DND5E.ADVANCEMENT.Subclass.Warning.InvalidType",
      "REBREYA_MAIN.CraftsmanSubclass.InvalidSource",
      "REBREYA_MAIN.CraftsmanSubclass.InvalidSource"
    ]);

    actor.items.set(existing.id, existing);
    await drop(candidates[0]);
    assert.equal(stubs.warnings.at(-1).key, "REBREYA_MAIN.CraftsmanSubclass.Duplicate");
    assert.equal(flow.subclass, candidates[0]);
  }
  finally {
    stubs.restore();
  }
});

test("drop handles unresolved UUIDs and accepts a valid Specialty independently", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const actor = makeActor([makeSubclass({ id: "research-other-axis", track: CRAFTSMAN_TRACKS.RESEARCH })]);
    const advancement = new SpecialtySubclass({ item: makeClass(actor), actor });
    const flow = new SpecialtySubclass.metadata.apps.flow({ advancement, level: 3 });

    await flow._onDrop({
      dataTransfer: {
        getData: () => JSON.stringify({
          type: "Item",
          uuid: "Compendium.world.rebreya-subclasses.Item.unresolved"
        })
      }
    });
    assert.equal(flow.subclass, undefined);
    assert.equal(stubs.warnings.at(-1).key, "DND5E.ADVANCEMENT.Subclass.Warning.InvalidType");

    const specialty = makeSubclass({ id: "specialty-drop-valid", track: CRAFTSMAN_TRACKS.SPECIALTY });
    stubs.sources.set(specialty.uuid, specialty);
    await flow._onDrop({
      dataTransfer: { getData: () => JSON.stringify({ type: "Item", uuid: specialty.uuid }) }
    });
    assert.equal(flow.subclass, specialty);
  }
  finally {
    stubs.restore();
  }
});

test("apply and restore delegate native creation while validating track and preventing duplicates", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const research = makeSubclass({ id: "research-source", track: CRAFTSMAN_TRACKS.RESEARCH });
    const research2 = makeSubclass({ id: "research-source-2", track: CRAFTSMAN_TRACKS.RESEARCH });
    const specialty = makeSubclass({ id: "specialty-source", track: CRAFTSMAN_TRACKS.SPECIALTY });
    for (const source of [research, research2, specialty]) stubs.sources.set(source.uuid, source);
    const actor = makeActor();
    const classItem = makeClass(actor);

    const researchAdvancement = new ResearchSubclass({ item: classItem, actor });
    await researchAdvancement.apply(2, { uuid: research.uuid });
    assert.equal(actor.items.get(research.id).system.classIdentifier, CRAFTSMAN_CLASS_IDENTIFIER);
    assert.equal(actor.items.get(research.id).flags.dnd5e.sourceId, research.uuid);
    assert.equal(actor.items.get(research.id).flags.dnd5e.advancementOrigin, undefined);
    assert.equal(stubs.parentCalls.at(-1).method, "apply");
    await assert.rejects(() => researchAdvancement.apply(2, { uuid: research2.uuid }), /duplicate/i);
    await assert.rejects(() => researchAdvancement.apply(2, { uuid: specialty.uuid }), /research/i);
    const unmanagedResearch = makeSubclass({
      id: "research-unmanaged-apply",
      managed: false,
      track: CRAFTSMAN_TRACKS.RESEARCH
    });
    stubs.sources.set(unmanagedResearch.uuid, unmanagedResearch);
    await assert.rejects(() => new ResearchSubclass({ item: classItem, actor: makeActor() })
      .apply(2, { uuid: unmanagedResearch.uuid }), /source|managed|archetype/i);

    const specialtyAdvancement = new SpecialtySubclass({ item: classItem, actor });
    await specialtyAdvancement.apply(3, { uuid: specialty.uuid });
    assert.equal(actor.items.has(research.id), true);
    assert.equal(actor.items.has(specialty.id), true);

    const restoredResearch = research2.toObject();
    await assert.rejects(() => new ResearchSubclass({ item: classItem, actor }).restore(2, restoredResearch), /duplicate/i);
    actor.items.delete(research.id);
    const restoredAdvancement = new ResearchSubclass({ item: classItem, actor });
    await restoredAdvancement.restore(2, restoredResearch);
    assert.equal(stubs.parentCalls.at(-1).method, "restore");
    assert.equal(actor.items.has(research2.id), true);

    const missingIdRestore = makeSubclass({
      id: "research-missing-id-restore",
      archetypeId: "",
      track: CRAFTSMAN_TRACKS.RESEARCH
    }).toObject();
    await assert.rejects(() => new ResearchSubclass({ item: classItem, actor: makeActor() })
      .restore(2, missingIdRestore), /source|managed|archetype/i);
  }
  finally {
    stubs.restore();
  }
});

test("apply validates eligible retained subclass data before native reuse", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass } = getCraftsmanSubclassAdvancementClasses();
    const source = makeSubclass({ id: "research-retained-source", track: CRAFTSMAN_TRACKS.RESEARCH });
    stubs.sources.set(source.uuid, source);

    const makeAdvancement = () => {
      const actor = makeActor();
      return { actor, advancement: new ResearchSubclass({ item: makeClass(actor), actor }) };
    };
    const retained = (overrides = {}) => {
      const data = source.toObject();
      data._id = "research-retained-embedded";
      data.flags.dnd5e.sourceId = source.uuid;
      return mergeObject(data, overrides, { inplace: true });
    };

    const valid = makeAdvancement();
    await valid.advancement.apply(2, { uuid: source.uuid }, retained());
    assert.equal(valid.actor.items.has("research-retained-embedded"), true);
    assert.equal(stubs.parentCalls.at(-1).retainedData._id, "research-retained-embedded");

    const invalidRetained = [
      retained({ type: "feat" }),
      retained({ system: { classIdentifier: "fighter-v01" } }),
      retained({ flags: { [MODULE_ID]: { [CRAFTSMAN_TRACK_FLAG]: CRAFTSMAN_TRACKS.SPECIALTY } } }),
      retained({ flags: { [MODULE_ID]: { managed: false } } }),
      retained({ flags: { [MODULE_ID]: { [CRAFTSMAN_ARCHETYPE_ID_FLAG]: "" } } }),
      retained({ flags: { dnd5e: { advancementOrigin: "origin", advancementRoot: "root" } } })
    ];
    for (const data of invalidRetained) {
      const { advancement } = makeAdvancement();
      await assert.rejects(() => advancement.apply(2, { uuid: source.uuid }, data));
    }

    const replacement = makeAdvancement();
    const staleRetained = retained({
      flags: { dnd5e: { sourceId: "Compendium.world.rebreya-subclasses.Item.previous-choice" } }
    });
    await replacement.advancement.apply(2, { uuid: source.uuid }, staleRetained);
    assert.equal(replacement.actor.items.has(source.id), true);
    assert.equal(replacement.actor.items.has(staleRetained._id), false);
    assert.equal(stubs.parentCalls.filter(({ method }) => method === "apply").length, 2);
  }
  finally {
    stubs.restore();
  }
});

test("summary and reverse use the advancement document and preserve the other track", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const research = makeSubclass({ id: "research-linked", track: CRAFTSMAN_TRACKS.RESEARCH });
    const specialty = makeSubclass({ id: "specialty-fallback", track: CRAFTSMAN_TRACKS.SPECIALTY });
    const actor = makeActor([research, specialty]);
    const classItem = makeClass(actor);
    classItem.subclass = research;

    const researchAdvancement = new ResearchSubclass({ item: classItem, actor });
    researchAdvancement.value = { document: research, uuid: research.uuid };
    assert.equal(researchAdvancement.summaryForLevel(2), research.toAnchor().outerHTML);
    assert.equal(researchAdvancement.summaryForLevel(2, { configMode: true }), "");

    const specialtyAdvancement = new SpecialtySubclass({ item: classItem, actor });
    specialtyAdvancement.value = { document: null, uuid: specialty.uuid };
    const reversed = await specialtyAdvancement.reverse(3);
    assert.equal(reversed._id, specialty.id);
    assert.equal(actor.items.has(specialty.id), false);
    assert.equal(actor.items.has(research.id), true);
    assert.deepEqual(specialtyAdvancement.value, { document: null, uuid: null });

    researchAdvancement.value.document = specialty;
    await assert.rejects(() => researchAdvancement.reverse(2), /research/i);
  }
  finally {
    stubs.restore();
  }
});

test("linked reverse fails closed on duplicate track state and succeeds for a unique managed source", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass } = getCraftsmanSubclassAdvancementClasses();
    const research = makeSubclass({ id: "research-linked-primary", track: CRAFTSMAN_TRACKS.RESEARCH });
    const duplicate = makeSubclass({ id: "research-linked-duplicate", track: CRAFTSMAN_TRACKS.RESEARCH });
    const specialty = makeSubclass({ id: "specialty-linked-other", track: CRAFTSMAN_TRACKS.SPECIALTY });
    const duplicateActor = makeActor([research, duplicate, specialty]);
    const duplicateAdvancement = new ResearchSubclass({ item: makeClass(duplicateActor), actor: duplicateActor });
    duplicateAdvancement.value = { document: research, uuid: research.uuid };

    await assert.rejects(() => duplicateAdvancement.reverse(2), /duplicate/i);
    assert.equal(duplicateActor.items.has(research.id), true);
    assert.equal(duplicateActor.items.has(duplicate.id), true);
    assert.equal(stubs.parentCalls.some(({ method }) => method === "reverse"), false);

    const actor = makeActor([research, specialty]);
    const advancement = new ResearchSubclass({ item: makeClass(actor), actor });
    advancement.value = { document: research, uuid: research.uuid };
    const reversed = await advancement.reverse(2);
    assert.equal(reversed._id, research.id);
    assert.equal(actor.items.has(research.id), false);
    assert.equal(actor.items.has(specialty.id), true);
    assert.equal(stubs.parentCalls.at(-1).method, "reverse");
  }
  finally {
    stubs.restore();
  }
});

test("linked and fallback reverse reject unmanaged or unidentified subclass data", async () => {
  const stubs = installDnd5eContractStubs();
  try {
    registerCraftsmanSubclassAdvancements();
    const { ResearchSubclass, SpecialtySubclass } = getCraftsmanSubclassAdvancementClasses();
    const unmanaged = makeSubclass({
      id: "research-unmanaged-reverse",
      managed: false,
      track: CRAFTSMAN_TRACKS.RESEARCH
    });
    const unmanagedActor = makeActor([unmanaged]);
    const linked = new ResearchSubclass({ item: makeClass(unmanagedActor), actor: unmanagedActor });
    linked.value = { document: unmanaged, uuid: unmanaged.uuid };
    await assert.rejects(() => linked.reverse(2), /source|managed|archetype/i);
    assert.equal(unmanagedActor.items.has(unmanaged.id), true);

    const missingId = makeSubclass({
      id: "specialty-missing-id-reverse",
      archetypeId: "",
      track: CRAFTSMAN_TRACKS.SPECIALTY
    });
    const fallbackActor = makeActor([missingId]);
    const fallback = new SpecialtySubclass({ item: makeClass(fallbackActor), actor: fallbackActor });
    fallback.value = { document: null, uuid: missingId.uuid };
    await assert.rejects(() => fallback.reverse(3), /source|managed|archetype/i);
    assert.equal(fallbackActor.items.has(missingId.id), true);
  }
  finally {
    stubs.restore();
  }
});

test("registration fails closed when the installed dnd5e subclass contracts are absent", () => {
  const stubs = installDnd5eContractStubs();
  try {
    delete game.dnd5e.applications.advancement.SubclassFlow;
    assert.equal(registerCraftsmanSubclassAdvancements(), false);
    assert.deepEqual(CONFIG.DND5E.advancementTypes, {});
  }
  finally {
    stubs.restore();
  }
});
