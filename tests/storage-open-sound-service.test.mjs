import test from "node:test";
import assert from "node:assert/strict";

import { StorageOpenSoundService } from "../scripts/data/storage-open-sound-service.js";

test("opening sound emits one transient positional playback without a persistent AmbientSound", async () => {
  const emitted = [];
  const scene = {
    async createEmbeddedDocuments() { assert.fail("one-shot playback must not persist an AmbientSound document"); }
  };
  const service = new StorageOpenSoundService({
    gameProvider: () => ({ user: { isGM: true }, users: { activeGM: { isGM: true } } }),
    isActiveGm: () => true,
    soundsLayer: {
      async emitAtPosition(...args) { emitted.push(structuredClone(args)); }
    }
  });
  await service.playForToken({ parent: scene, x: 100, y: 200, width: 1, height: 1 });

  assert.deepEqual(emitted, [[
    "modules/rebreya-main/assets/storage/sounds/chest-open.mp3",
    { x: 150, y: 250 },
    10,
    { volume: 0.8, easing: true, walls: true, gmAlways: true }
  ]]);
});
