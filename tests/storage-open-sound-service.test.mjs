import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageOpenSoundService } from "../scripts/data/storage-open-sound-service.js";

test("opening sound creates and removes one native positional AmbientSound", async () => {
  const created = [];
  const deleted = [];
  const timers = [];
  const scene = {
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "AmbientSound");
      created.push(structuredClone(data[0]));
      return [{ id: "sound-1" }];
    },
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "AmbientSound");
      deleted.push(...ids);
    }
  };
  const service = new StorageOpenSoundService({
    gameProvider: () => ({ user: { isGM: true }, users: { activeGM: { isGM: true } } }),
    isActiveGm: () => true,
    audioHelper: { preloadSound: async () => {} },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); }
  });
  await service.playForToken({ parent: scene, x: 100, y: 200, width: 1, height: 1 });

  assert.deepEqual(created[0], {
    x: 150, y: 250,
    path: "modules/rebreya-main/assets/storage/sounds/chest-open.mp3",
    radius: 10, repeat: false, volume: 0.8, easing: true, walls: true, hidden: false,
    flags: { [MODULE_ID]: { temporaryStorageOpenSound: true } }
  });
  assert.equal(timers[0].delay, 1250);
  await timers[0].callback();
  assert.deepEqual(deleted, ["sound-1"]);
});
