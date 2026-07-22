import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAFTSMAN_ARCHETYPE_REGISTRY,
  CRAFTSMAN_CLASS_IDENTIFIER,
  CRAFTSMAN_SUBCLASS_COMPENDIUM_ID,
  CRAFTSMAN_TRACK_FLAG,
  CRAFTSMAN_TRACKS,
  MODULE_ID
} from "../scripts/constants.js";
import {
  assertValidCraftsmanSubclass,
  getCraftsmanSubclasses,
  getCraftsmanSubclassTrack,
  hasCraftsmanTrackDuplicate,
  isCraftsmanClass
} from "../scripts/integrations/craftsman-subclass-tracks.js";

function makeClass({ id = "craftsman-class", identifier = CRAFTSMAN_CLASS_IDENTIFIER, actor = null } = {}) {
  return {
    id,
    type: "class",
    system: { identifier },
    actor
  };
}

function makeSubclass({
  id,
  track,
  archetypeId = track === CRAFTSMAN_TRACKS.SPECIALTY
    ? "craftsman-specialty-constructor"
    : "craftsman-research-weaponsmith",
  classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER,
  type = "subclass",
  name = "Name must not affect track detection"
} = {}) {
  const documentId = archetypeId === "craftsman-specialty-constructor"
    ? "1xoogq41lnvp5q00"
    : "fjf9y91usmmvo000";
  return {
    id,
    type,
    name,
    system: { classIdentifier },
    flags: {
      [MODULE_ID]: {
        [CRAFTSMAN_TRACK_FLAG]: track,
        archetypeId,
        classIdentifier,
        managed: true,
        sourceType: "subclass"
      },
      dnd5e: { sourceId: `Compendium.world.rebreya-subclasses.Item.${documentId}` }
    }
  };
}

test("Craftsman track constants use the fixed class identifier and two native axes", () => {
  assert.equal(CRAFTSMAN_CLASS_IDENTIFIER, "craftsman-v01");
  assert.deepEqual(Object.values(CRAFTSMAN_TRACKS).sort(), ["research", "specialty"]);
  assert.equal(Object.keys(CRAFTSMAN_ARCHETYPE_REGISTRY).length, 12);
  assert.equal(
    Object.values(CRAFTSMAN_ARCHETYPE_REGISTRY)
      .filter(({ track }) => track === CRAFTSMAN_TRACKS.RESEARCH).length,
    7
  );
  assert.equal(
    Object.values(CRAFTSMAN_ARCHETYPE_REGISTRY)
      .filter(({ track }) => track === CRAFTSMAN_TRACKS.SPECIALTY).length,
    5
  );
  for (const definition of Object.values(CRAFTSMAN_ARCHETYPE_REGISTRY)) {
    assert.equal(
      definition.uuid,
      `Compendium.${CRAFTSMAN_SUBCLASS_COMPENDIUM_ID}.Item.${definition.documentId}`
    );
  }
});

test("native subclass track detection requires type, Craftsman class identifier, and a supported flag", () => {
  const research = makeSubclass({ id: "research", track: CRAFTSMAN_TRACKS.RESEARCH });

  assert.equal(getCraftsmanSubclassTrack(research), CRAFTSMAN_TRACKS.RESEARCH);
  assert.equal(assertValidCraftsmanSubclass(research, CRAFTSMAN_TRACKS.RESEARCH), research);
  assert.throws(() => getCraftsmanSubclassTrack(makeSubclass({ id: "legacy", track: CRAFTSMAN_TRACKS.RESEARCH, type: "rebreya-main.research" })), /subclass/i);
  assert.throws(() => getCraftsmanSubclassTrack(makeSubclass({ id: "other-class", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: "fighter-v01" })), /class/i);
  assert.throws(() => getCraftsmanSubclassTrack(makeSubclass({ id: "padded-class", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: ` ${CRAFTSMAN_CLASS_IDENTIFIER}` })), /class/i);
  assert.throws(() => getCraftsmanSubclassTrack(makeSubclass({ id: "padded-axis", track: ` ${CRAFTSMAN_TRACKS.RESEARCH}` })), /track/i);
  assert.throws(() => getCraftsmanSubclassTrack(makeSubclass({ id: "unknown-axis", track: "research-and-specialty" })), /track/i);
  assert.throws(() => getCraftsmanSubclassTrack({ id: "unflagged", type: "subclass", system: { classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER } }), /class|track|source/i);
  assert.throws(() => assertValidCraftsmanSubclass(research, CRAFTSMAN_TRACKS.SPECIALTY), /specialty/i);
});

test("Craftsman subclasses are resolved by track regardless of actor item order", () => {
  const research = makeSubclass({ id: "research", track: CRAFTSMAN_TRACKS.RESEARCH, name: "Deliberately misleading specialty name" });
  const specialty = makeSubclass({ id: "specialty", track: CRAFTSMAN_TRACKS.SPECIALTY, name: "Deliberately misleading research name" });
  const actor = {
    id: "actor-1",
    items: { contents: [
      specialty,
      { id: "foreign", type: "subclass", system: { classIdentifier: "fighter-v01" }, flags: {} },
      research
    ] }
  };
  const craftsmanClass = makeClass({ actor });

  assert.deepEqual(getCraftsmanSubclasses(craftsmanClass), { research, specialty });
});

test("Craftsman subclass resolution supports collection values and rejects duplicate tracks", () => {
  const research = makeSubclass({ id: "research", track: CRAFTSMAN_TRACKS.RESEARCH });
  const specialty = makeSubclass({ id: "specialty", track: CRAFTSMAN_TRACKS.SPECIALTY });
  const actor = {
    id: "actor-42",
    items: new Map([[research.id, research], [specialty.id, specialty]])
  };
  const craftsmanClass = makeClass({ actor });

  assert.deepEqual(getCraftsmanSubclasses(craftsmanClass), { research, specialty });

  actor.items.set("research-duplicate", makeSubclass({ id: "research-duplicate", track: CRAFTSMAN_TRACKS.RESEARCH }));
  assert.throws(() => getCraftsmanSubclasses(craftsmanClass), /(?=.*actor-42)(?=.*research)/i);
});

test("duplicate track diagnostics use a non-empty fallback for an Actor without an id", () => {
  const actor = {
    items: [
      makeSubclass({ id: "research-a", track: CRAFTSMAN_TRACKS.RESEARCH }),
      makeSubclass({ id: "research-b", track: CRAFTSMAN_TRACKS.RESEARCH })
    ]
  };

  assert.throws(() => getCraftsmanSubclasses(actor), /Actor unknown\./);
});

test("track duplicate detection ignores only the explicitly excluded item", () => {
  const existingResearch = makeSubclass({ id: "research-existing", track: CRAFTSMAN_TRACKS.RESEARCH });
  const actor = { items: [existingResearch] };
  const candidate = makeSubclass({ id: "research-candidate", track: CRAFTSMAN_TRACKS.RESEARCH });

  assert.equal(hasCraftsmanTrackDuplicate(actor, candidate), true);
  assert.equal(hasCraftsmanTrackDuplicate(actor, candidate, { excludeId: existingResearch.id }), false);
  assert.equal(hasCraftsmanTrackDuplicate(actor, makeSubclass({ id: "specialty", track: CRAFTSMAN_TRACKS.SPECIALTY })), false);
});

test("ordinary classes and subclasses from another class are never treated as Craftsman", () => {
  const ordinaryClass = makeClass({ identifier: "fighter-v01" });
  const foreignSubclass = {
    id: "foreign",
    type: "subclass",
    system: { classIdentifier: "fighter-v01" },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "subclass",
        classIdentifier: "fighter-v01",
        subclassId: "fighter-champion"
      }
    }
  };
  const actor = { id: "actor-foreign", items: [ordinaryClass, foreignSubclass] };

  assert.equal(isCraftsmanClass(ordinaryClass), false);
  assert.equal(getCraftsmanSubclassTrack(foreignSubclass), null);
  assert.deepEqual(getCraftsmanSubclasses(actor), { research: null, specialty: null });
});

test("Craftsman identity is canonical across archetype, axis, persisted source, and compendium document", () => {
  const sourceUuid = "Compendium.world.rebreya-subclasses.Item.fjf9y91usmmvo000";
  const canonical = {
    ...makeSubclass({ id: "embedded-research", track: CRAFTSMAN_TRACKS.RESEARCH }),
    flags: {
      [MODULE_ID]: {
        [CRAFTSMAN_TRACK_FLAG]: CRAFTSMAN_TRACKS.RESEARCH,
        archetypeId: "craftsman-research-weaponsmith",
        classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER,
        managed: true,
        sourceType: "subclass"
      },
      dnd5e: { sourceId: sourceUuid }
    }
  };

  assert.equal(assertValidCraftsmanSubclass(canonical, CRAFTSMAN_TRACKS.RESEARCH), canonical);
  assert.throws(() => assertValidCraftsmanSubclass({
    ...canonical,
    flags: {
      ...canonical.flags,
      [MODULE_ID]: { ...canonical.flags[MODULE_ID], archetypeId: "craftsman-research-fake" }
    }
  }, CRAFTSMAN_TRACKS.RESEARCH), /archetype|source|canonical/i);
  assert.throws(() => assertValidCraftsmanSubclass({
    ...canonical,
    flags: {
      ...canonical.flags,
      [MODULE_ID]: {
        ...canonical.flags[MODULE_ID],
        archetypeId: " craftsman-research-weaponsmith "
      }
    }
  }, CRAFTSMAN_TRACKS.RESEARCH), /archetype|source|canonical/i);
  assert.throws(() => assertValidCraftsmanSubclass({
    ...canonical,
    flags: {
      ...canonical.flags,
      [MODULE_ID]: {
        ...canonical.flags[MODULE_ID],
        archetypeId: "craftsman-specialty-constructor"
      }
    }
  }, CRAFTSMAN_TRACKS.RESEARCH), /research|track|canonical/i);
  const wrongSource = "Compendium.world.rebreya-subclasses.Item.selfconsistentbad";
  assert.throws(() => assertValidCraftsmanSubclass({
    ...canonical,
    id: "selfconsistentbad",
    _id: "selfconsistentbad",
    uuid: wrongSource,
    flags: { ...canonical.flags, dnd5e: { sourceId: wrongSource } }
  }, CRAFTSMAN_TRACKS.RESEARCH), /source|uuid|document|canonical/i);
  assert.throws(() => assertValidCraftsmanSubclass({
    ...canonical,
    flags: {
      ...canonical.flags,
      dnd5e: { sourceId: ` ${sourceUuid} ` }
    }
  }, CRAFTSMAN_TRACKS.RESEARCH), /source|provenance|canonical/i);

  const actor = { id: "actor-invalid-persisted", items: [
    {
      ...canonical,
      flags: {
        ...canonical.flags,
        dnd5e: { sourceId: "Compendium.world.rebreya-subclasses.Item.wrongpersisted" }
      }
    }
  ] };
  assert.throws(() => getCraftsmanSubclasses(actor), /source|uuid|canonical/i);
});
