import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { isDeadNpcStorageTarget } from "../scripts/data/storage-corpse-target.js";
import {
  isNativeStorageObject,
  storageObjectKind
} from "../scripts/data/storage-object-kind.js";

test("storage object kind recognizes Rebreya chest and ground-pile flags", () => {
  assert.equal(storageObjectKind({
    flags: { [MODULE_ID]: { storage: { version: 1, state: "opened" } } }
  }), "chest");
  assert.equal(storageObjectKind({
    flags: {
      [MODULE_ID]: {
        storage: { version: 1, state: "opened" },
        groundPile: { enabled: true }
      }
    }
  }), "groundPile");
});

test("ground-pile actor prototypes win over their generic storage marker", () => {
  const actor = {
    flags: {
      [MODULE_ID]: {
        storage: { enabled: true },
        groundPilePrototype: { enabled: true }
      }
    }
  };

  assert.equal(storageObjectKind(actor), "groundPile");
  assert.equal(isNativeStorageObject(actor), true);
});

test("unrelated module flags do not identify a native storage object", () => {
  assert.equal(storageObjectKind({
    flags: { "foreign-module": { data: { enabled: true } } }
  }), null);
  assert.equal(isNativeStorageObject(null), false);
});

test("unmarked dead NPC loot state does not identify a chest before materialization", () => {
  const token = { actor: { type: "npc", flags: {}, statuses: new Set(["dead"]), system: { attributes: { hp: { value: 0 } } } },
    flags: { [MODULE_ID]: { storage: { version: 1, state: "unopened" } } } };
  assert.equal(storageObjectKind(token), null); assert.equal(isDeadNpcStorageTarget(token), true);
  token.actor.system.attributes.hp.value = 18;
  assert.equal(isDeadNpcStorageTarget(token), true, "explicitly dead NPC stays openable after legacy18HP projection");
  token.actor.statuses.clear(); token.flags[MODULE_ID].objectDurability = { hp: { value: 18, max: 18 } };
  assert.equal(isDeadNpcStorageTarget(token), false, "object durability alone does not prove that a token is a corpse");
  token.actor.flags[MODULE_ID] = { storage: { enabled: true } };
  assert.equal(storageObjectKind(token), "chest", "authored storage Actor remains an object");
});

test("materialized corpse storage remains a creature instead of a native object", () => {
  const corpse = {
    actor: { type: "npc", flags: {} },
    flags: {
      [MODULE_ID]: {
        storage: {
          version: 1,
          state: "opened",
          corpseMaterialization: {
            version: 1,
            status: "complete",
            sourceActorUuid: "Actor.champion",
            sourceActorId: "champion"
          }
        }
      }
    }
  };

  assert.equal(storageObjectKind(corpse), null);
  assert.equal(isNativeStorageObject(corpse), false);
});

test("classifier follows actor and token document relationships", () => {
  const tokenDocument = {
    flags: { [MODULE_ID]: { groundPile: { enabled: true } } }
  };
  const actor = { token: { document: tokenDocument } };

  assert.equal(storageObjectKind(actor), "groundPile");
});
