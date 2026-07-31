import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAVEL_LANDSCAPES,
  createTravelLandscapeStorageKey,
  loadTravelLandscapeId,
  normalizeTravelLandscapeId,
  prepareTravelLandscapeContext,
  saveTravelLandscapeId
} from "../scripts/ui/travel-landscape-selector.js";

test("travel landscapes expose three distinct panoramic media pairs", () => {
  assert.deepEqual(
    TRAVEL_LANDSCAPES.map(({ id, number }) => ({ id, number })),
    [
      { id: "industrial", number: 1 },
      { id: "wilderness", number: 2 },
      { id: "city", number: 3 }
    ]
  );
  for (const landscape of TRAVEL_LANDSCAPES) {
    assert.match(landscape.videoUrl, /^\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-.+\.webm$/u);
    assert.match(landscape.posterUrl, /^\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-.+-poster\.webp$/u);
  }
});

test("travel landscape ids fall back to industrial", () => {
  assert.equal(normalizeTravelLandscapeId("wilderness"), "wilderness");
  assert.equal(normalizeTravelLandscapeId(" city "), "city");
  assert.equal(normalizeTravelLandscapeId("unknown"), "industrial");
  assert.equal(normalizeTravelLandscapeId(null), "industrial");
});

test("travel landscape storage is scoped by world and user", () => {
  assert.equal(
    createTravelLandscapeStorageKey({ worldId: "reb-world", userId: "player-7" }),
    "rebreya-main.travelLandscape:reb-world:player-7"
  );
});

test("travel landscape storage keys preserve distinct scope components", () => {
  assert.notEqual(
    createTravelLandscapeStorageKey({ worldId: "a:b", userId: "c" }),
    createTravelLandscapeStorageKey({ worldId: "a", userId: "b:c" })
  );
  assert.notEqual(
    createTravelLandscapeStorageKey({ worldId: "%3A", userId: "c" }),
    createTravelLandscapeStorageKey({ worldId: ":", userId: "c" })
  );
});

test("travel landscape storage reads, writes, and fails closed", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
  const options = { storage, worldId: "world-a", userId: "user-b" };
  assert.equal(loadTravelLandscapeId(options), "industrial");
  assert.equal(saveTravelLandscapeId("city", options), "city");
  assert.equal(loadTravelLandscapeId(options), "city");
  assert.equal(saveTravelLandscapeId("invalid", options), "industrial");
  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    }
  };
  assert.equal(loadTravelLandscapeId({ ...options, storage: throwingStorage }), "industrial");
  assert.equal(saveTravelLandscapeId("wilderness", { ...options, storage: throwingStorage }), "wilderness");
});

test("travel landscape context selects exactly one active option", () => {
  const context = prepareTravelLandscapeContext("wilderness");
  assert.equal(context.active.id, "wilderness");
  assert.deepEqual(
    context.options.map(({ id, selected, ariaPressed }) => ({ id, selected, ariaPressed })),
    [
      { id: "industrial", selected: false, ariaPressed: "false" },
      { id: "wilderness", selected: true, ariaPressed: "true" },
      { id: "city", selected: false, ariaPressed: "false" }
    ]
  );
});
