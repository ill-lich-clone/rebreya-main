import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
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
