import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAFTSMAN_CLASS_IDENTIFIER,
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
  classIdentifier = CRAFTSMAN_CLASS_IDENTIFIER,
  type = "subclass",
  name = "Name must not affect track detection"
} = {}) {
  return {
    id,
    type,
    name,
    system: { classIdentifier },
    flags: { [MODULE_ID]: { [CRAFTSMAN_TRACK_FLAG]: track } }
  };
}

test("Craftsman track constants use the fixed class identifier and two native axes", () => {
  assert.equal(CRAFTSMAN_CLASS_IDENTIFIER, "craftsman-v01");
  assert.deepEqual(Object.values(CRAFTSMAN_TRACKS).sort(), ["research", "specialty"]);
});

test("native subclass track detection requires type, Craftsman class identifier, and a supported flag", () => {
  const research = makeSubclass({ id: "research", track: CRAFTSMAN_TRACKS.RESEARCH });

  assert.equal(getCraftsmanSubclassTrack(research), CRAFTSMAN_TRACKS.RESEARCH);
  assert.equal(assertValidCraftsmanSubclass(research, CRAFTSMAN_TRACKS.RESEARCH), research);
  assert.equal(getCraftsmanSubclassTrack(makeSubclass({ id: "legacy", track: CRAFTSMAN_TRACKS.RESEARCH, type: "rebreya-main.research" })), null);
  assert.equal(getCraftsmanSubclassTrack(makeSubclass({ id: "other-class", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: "fighter-v01" })), null);
  assert.equal(getCraftsmanSubclassTrack(makeSubclass({ id: "padded-class", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: ` ${CRAFTSMAN_CLASS_IDENTIFIER}` })), null);
  assert.equal(getCraftsmanSubclassTrack(makeSubclass({ id: "padded-axis", track: ` ${CRAFTSMAN_TRACKS.RESEARCH}` })), null);
  assert.equal(getCraftsmanSubclassTrack(makeSubclass({ id: "unknown-axis", track: "research-and-specialty" })), null);
  assert.equal(getCraftsmanSubclassTrack({ id: "unflagged", type: "subclass", system: { classIdentifier: CRAFTSMAN_CLASS_IDENTIFIER } }), null);
  assert.throws(() => assertValidCraftsmanSubclass(research, CRAFTSMAN_TRACKS.SPECIALTY), /specialty/i);
});

test("Craftsman subclasses are resolved by track regardless of actor item order", () => {
  const research = makeSubclass({ id: "research", track: CRAFTSMAN_TRACKS.RESEARCH, name: "Deliberately misleading specialty name" });
  const specialty = makeSubclass({ id: "specialty", track: CRAFTSMAN_TRACKS.SPECIALTY, name: "Deliberately misleading research name" });
  const actor = {
    id: "actor-1",
    items: { contents: [specialty, makeSubclass({ id: "foreign", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: "fighter-v01" }), research] }
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
  const foreignSubclass = makeSubclass({ id: "foreign", track: CRAFTSMAN_TRACKS.RESEARCH, classIdentifier: "fighter-v01" });
  const actor = { id: "actor-foreign", items: [ordinaryClass, foreignSubclass] };

  assert.equal(isCraftsmanClass(ordinaryClass), false);
  assert.equal(getCraftsmanSubclassTrack(foreignSubclass), null);
  assert.deepEqual(getCraftsmanSubclasses(actor), { research: null, specialty: null });
});
