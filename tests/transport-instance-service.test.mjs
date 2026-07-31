import test from "node:test";
import assert from "node:assert/strict";

import {
  TransportInstanceService,
  normalizeTransportInstanceState,
  validateTransportImportPayload,
  validateTransportStatePayload
} from "../scripts/data/transport-instance-service.js";

const validImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
};

const validState = {
  groupActorId: "group-a",
  actorId: "vehicle-a",
  patch: {
    hpCurrent: 72,
    condition: "damaged",
    reserveCurrent: 8,
    reserveCapacity: 12
  }
};

function createTransportInstanceHarness({
  addMemberError = null,
  managedGroup = true,
  sourceManaged = true
} = {}) {
  const createdActors = [];
  const addedMemberIds = [];
  const removedMemberIds = [];
  const roleUpdates = [];
  const actorUpdates = [];
  const gm = { id: "gm", isGM: true };
  const player = { id: "player-a", isGM: false };
  const source = {
    uuid: validImport.sourceActorUuid,
    pack: "world.rebreya-transport",
    type: "vehicle",
    name: "Боевой конь",
    toObject: () => ({
      _id: "lchtransport0001",
      name: "Боевой конь",
      type: "vehicle",
      folder: "mounts",
      pack: "world.rebreya-transport",
      ownership: { default: 0 },
      flags: {
        "rebreya-main": {
          managed: sourceManaged,
          sourceId: "transport-v01-boevoy-kon",
          signature: "transport-v1:abc",
          transport: {
            defaultGroupRole: "mount",
            consumption: { kind: "feed", unit: "lb", raw: "4 фнт" }
          }
        }
      },
      system: { attributes: { hp: { value: 0, max: 0 } } }
    }),
    getFlag(scope, key) {
      return this.toObject().flags?.[scope]?.[key];
    }
  };
  const vehicleActor = {
    id: "vehicle-a",
    uuid: "Actor.vehicle-a",
    type: "vehicle",
    system: { attributes: { hp: { value: 100, max: 100 } } },
    getFlag(_scope, key) {
      return key === "transport"
        ? {
            instance: true,
            consumption: { kind: "fuel", unit: "gal" },
            instanceState: { reserveUnit: "gal" }
          }
        : undefined;
    },
    async update(patch) {
      actorUpdates.push(structuredClone(patch));
      return this;
    }
  };
  const ownedCharacter = {
    id: "character-a",
    type: "character",
    testUserPermission(user, level) {
      return user.id === player.id && level === "OWNER";
    }
  };
  const groupActor = {
    id: "group-a",
    type: "group",
    getFlag(scope, key) {
      return scope === "rebreya-main" && key === "managedPartyGroup" ? managedGroup : undefined;
    },
    system: {
      async addMember(actor) {
        if (addMemberError) throw addMemberError;
        addedMemberIds.push(actor.id);
      },
      async removeMember(actorId) {
        removedMemberIds.push(actorId);
      }
    }
  };
  const moduleApi = {
    groupContextService: {
      resolveForGroup(id) {
        assert.equal(id, "group-a");
        return {
          groupId: "group-a",
          groupActor,
          members: [vehicleActor, ownedCharacter],
          memberActorIds: [vehicleActor.id, ownedCharacter.id],
          canManage: true
        };
      }
    },
    inventoryService: {
      async updatePartyMember(actorId, patch) {
        roleUpdates.push([actorId, structuredClone(patch)]);
      }
    }
  };
  const Actor = {
    async create(data, options) {
      assert.deepEqual(options, { renderSheet: false, keepId: false });
      const actor = {
        ...structuredClone(data),
        id: `vehicle-created-${createdActors.length + 1}`,
        uuid: `Actor.vehicle-created-${createdActors.length + 1}`,
        deleted: false,
        async delete() {
          this.deleted = true;
        }
      };
      createdActors.push(actor);
      return actor;
    }
  };
  return {
    gm,
    player,
    moduleApi,
    source,
    vehicleActor,
    createdActors,
    addedMemberIds,
    removedMemberIds,
    roleUpdates,
    actorUpdates,
    options: {
      gameProvider: () => ({ user: gm }),
      actorProvider: () => Actor,
      fromUuid: async (uuid) => uuid === source.uuid ? source : null,
      idFactory: () => `instance-${createdActors.length + 1}`
    }
  };
}

test("transport payload validators enforce exact keys and the managed pack UUID", () => {
  assert.equal(validateTransportImportPayload(validImport), true);
  assert.equal(validateTransportImportPayload({ ...validImport, forged: true }), false);
  assert.equal(validateTransportImportPayload({
    ...validImport,
    sourceActorUuid: "Compendium.world.other-pack.Actor.lchtransport0001"
  }), false);
  assert.equal(validateTransportStatePayload(validState), true);
  assert.equal(validateTransportStatePayload({
    ...validState,
    patch: { ...validState.patch, forged: true }
  }), false);
});

test("instance state validates condition, non-negative values, and capacity", () => {
  assert.deepEqual(normalizeTransportInstanceState({
    condition: "operational",
    reserveCurrent: "4.5",
    reserveCapacity: "10"
  }, { reserveUnit: "gal" }), {
    condition: "operational",
    reserveCurrent: 4.5,
    reserveCapacity: 10,
    reserveUnit: "gal"
  });
  assert.throws(
    () => normalizeTransportInstanceState({ condition: "lost", reserveCurrent: 0 }),
    /Неизвестное состояние/u
  );
  assert.throws(
    () => normalizeTransportInstanceState({ condition: "broken", reserveCurrent: -1 }),
    /не может быть отрицательным/u
  );
  assert.throws(
    () => normalizeTransportInstanceState({
      condition: "damaged",
      reserveCurrent: 11,
      reserveCapacity: 10
    }),
    /не может превышать вместимость/u
  );
});

test("each import creates a separate world Actor and assigns its default role", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const first = await service.importIntoGroup(validImport, { sender: harness.gm });
  const second = await service.importIntoGroup(validImport, { sender: harness.gm });

  assert.notEqual(first.actorId, second.actorId);
  assert.deepEqual(harness.addedMemberIds, [first.actorId, second.actorId]);
  assert.deepEqual(harness.roleUpdates, [
    [first.actorId, { role: "mount" }],
    [second.actorId, { role: "mount" }]
  ]);
  const firstActor = harness.createdActors[0];
  assert.equal(firstActor._id, undefined);
  assert.equal(firstActor.folder, undefined);
  assert.equal(firstActor.pack, undefined);
  assert.equal(firstActor.ownership.default, 2);
  assert.equal(firstActor.flags["rebreya-main"].managed, undefined);
  assert.equal(firstActor.flags["rebreya-main"].transport.instance, true);
  assert.equal(firstActor.flags["rebreya-main"].transport.instanceState.reserveUnit, "lb");
  assert.equal(firstActor.flags["rebreya-main"].transport.sourceActorUuid, validImport.sourceActorUuid);
});

test("failed native group membership deletes the newly-created orphan", async () => {
  const harness = createTransportInstanceHarness({ addMemberError: new Error("membership failed") });
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.importIntoGroup(validImport, { sender: harness.gm }),
    /membership failed/u
  );
  assert.equal(harness.createdActors[0].deleted, true);
});

test("failed role assignment removes membership and deletes the newly-created Actor", async () => {
  const harness = createTransportInstanceHarness();
  harness.moduleApi.inventoryService.updatePartyMember = async () => {
    throw new Error("role failed");
  };
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.importIntoGroup(validImport, { sender: harness.gm }),
    /role failed/u
  );
  assert.deepEqual(harness.removedMemberIds, ["vehicle-created-1"]);
  assert.equal(harness.createdActors[0].deleted, true);
});

test("import rejects unmanaged sources and unmanaged group targets", async () => {
  const sourceHarness = createTransportInstanceHarness({ sourceManaged: false });
  await assert.rejects(
    () => new TransportInstanceService(sourceHarness.moduleApi, sourceHarness.options)
      .importIntoGroup(validImport, { sender: sourceHarness.gm }),
    /управляемым транспортом/u
  );

  const groupHarness = createTransportInstanceHarness({ managedGroup: false });
  await assert.rejects(
    () => new TransportInstanceService(groupHarness.moduleApi, groupHarness.options)
      .importIntoGroup(validImport, { sender: groupHarness.gm }),
    /управляемой группой/u
  );
});

test("sender authorization accepts GM or an owner of a group character", () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  assert.equal(service.canManageGroup("group-a", harness.gm), true);
  assert.equal(service.canManageGroup("group-a", harness.player), true);
  assert.equal(service.canManageGroup("group-a", { id: "stranger", isGM: false }), false);
});

test("state update writes native HP and bounded per-instance fuel", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const result = await service.updateInstanceState(validState, { sender: harness.gm });

  assert.deepEqual(harness.actorUpdates.at(-1), {
    "system.attributes.hp.value": 72,
    "flags.rebreya-main.transport.instanceState": {
      condition: "damaged",
      reserveCurrent: 8,
      reserveCapacity: 12,
      reserveUnit: "gal"
    }
  });
  assert.equal(result.actorId, "vehicle-a");
  assert.equal(result.hpCurrent, 72);
});

test("state update rejects actors outside the group and HP above maximum", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.updateInstanceState({ ...validState, actorId: "outside" }, { sender: harness.gm }),
    /не найден в выбранной группе/u
  );
  await assert.rejects(
    () => service.updateInstanceState({
      ...validState,
      patch: { ...validState.patch, hpCurrent: 101 }
    }, { sender: harness.gm }),
    /не могут превышать максимум/u
  );
});
