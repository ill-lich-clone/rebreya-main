import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { TravelMapService } from "../scripts/data/travel-map-service.js";

test("TravelMapService updates an existing group token on the world map scene", async () => {
  const updates = [];
  const scene = {
    name: "Карта мира",
    tokens: [
      {
        id: "token-a",
        actorId: "group-a",
        getFlag(moduleId, key) {
          return moduleId === MODULE_ID && key === "travelGroupActorId" ? "group-a" : "";
        }
      }
    ],
    async updateEmbeddedDocuments(documentName, documents) {
      updates.push([documentName, documents]);
      return documents;
    }
  };
  const service = new TravelMapService({
    gameProvider: () => ({
      scenes: {
        getName(name) {
          return name === "Карта мира" ? scene : null;
        }
      }
    })
  });

  const result = await service.syncGroupToken({
    groupActor: {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    },
    position: {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    }
  });

  assert.equal(result.synced, true);
  assert.equal(result.action, "updated");
  assert.deepEqual(updates, [[
    "Token",
    [{
      _id: "token-a",
      x: 120,
      y: 240,
      flags: {
        [MODULE_ID]: {
          travelGroupActorId: "group-a"
        }
      }
    }]
  ]]);
});

test("TravelMapService creates a group token when it is missing", async () => {
  const creates = [];
  const scene = {
    name: "Карта мира",
    tokens: [],
    async createEmbeddedDocuments(documentName, documents) {
      creates.push([documentName, documents]);
      return documents;
    }
  };
  const service = new TravelMapService({
    gameProvider: () => ({
      scenes: {
        contents: [scene]
      }
    })
  });

  const result = await service.syncGroupToken({
    groupActor: {
      id: "group-a",
      name: "Рассвет порядка 1",
      img: "icons/group.webp"
    },
    position: {
      available: true,
      sceneName: "Карта мира",
      sceneX: 120,
      sceneY: 240
    }
  });

  assert.equal(result.synced, true);
  assert.equal(result.action, "created");
  assert.equal(creates[0][0], "Token");
  assert.equal(creates[0][1][0].actorId, "group-a");
  assert.equal(creates[0][1][0].name, "Рассвет порядка 1");
  assert.equal(creates[0][1][0].x, 120);
  assert.equal(creates[0][1][0].y, 240);
  assert.equal(creates[0][1][0].flags[MODULE_ID].travelGroupActorId, "group-a");
});
