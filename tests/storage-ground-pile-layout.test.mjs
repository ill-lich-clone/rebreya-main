import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGroundPileTokenLayout,
  isGroundPileCardinalRotation
} from "../scripts/data/storage-ground-pile-layout.js";

test("cardinal ground-pile rotation rejects coerced and out-of-range values", () => {
  for (const rotation of [0, 90, 180, 270]) {
    assert.equal(isGroundPileCardinalRotation(rotation), true);
  }
  for (const rotation of ["90", 45, -90, 360, null, undefined]) {
    assert.equal(isGroundPileCardinalRotation(rotation), false);
  }
});

test("cardinal furniture layout swaps sides and compensates rectangular texture scale", () => {
  assert.deepEqual(buildGroundPileTokenLayout({
    width: 1,
    height: 2,
    textureScale: 1,
    rotationMode: "cardinal"
  }, 0), { width: 1, height: 2, textureScale: 1, rotation: 0 });
  assert.deepEqual(buildGroundPileTokenLayout({
    width: 1,
    height: 2,
    textureScale: 1,
    rotationMode: "cardinal"
  }, 180), { width: 1, height: 2, textureScale: 1, rotation: 180 });
  assert.deepEqual(buildGroundPileTokenLayout({
    width: 1,
    height: 2,
    textureScale: 1,
    rotationMode: "cardinal"
  }, 90), { width: 2, height: 1, textureScale: 2, rotation: 90 });
  assert.deepEqual(buildGroundPileTokenLayout({
    width: 3,
    height: 2,
    textureScale: 1,
    rotationMode: "cardinal"
  }, 270), { width: 2, height: 3, textureScale: 1.5, rotation: 270 });
});

test("ground-pile layout rejects invalid dimensions, scale, and cardinal angles", () => {
  const valid = { width: 1, height: 2, textureScale: 1, rotationMode: "cardinal" };
  assert.throws(() => buildGroundPileTokenLayout({ ...valid, width: 0 }, 0), /positive finite/iu);
  assert.throws(() => buildGroundPileTokenLayout({ ...valid, height: Number.NaN }, 0), /positive finite/iu);
  assert.throws(() => buildGroundPileTokenLayout({ ...valid, textureScale: -1 }, 0), /positive finite/iu);
  assert.throws(() => buildGroundPileTokenLayout(valid, 45), /0, 90, 180, or 270/iu);
});
