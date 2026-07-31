import test from "node:test";
import assert from "node:assert/strict";

import {
  TransportInstanceService,
  normalizeTransportInstanceState,
  validateTransportImportPayload,
  validateTransportStatePayload
} from "../scripts/data/transport-instance-service.js";
import { normalizeGroupState } from "../scripts/data/group-context-service.js";

const validImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001"
};

const validWorldImport = {
  groupActorId: "group-a",
  sourceActorUuid: "Actor.world-lincoln"
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
  sourceManaged = true,
  existingTransport = false,
  groupStateMutationError = null,
  removeMemberError = null,
  deleteError = null
} = {}) {
  const createdActors = [];
  const addedMemberIds = [];
  const removedMemberIds = [];
  const roleUpdates = [];
  const groupStateMutations = [];
  const actorUpdates = [];
  const groupState = normalizeGroupState("group-a", {});
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
            sourceId: "transport-v01-existing",
            sourceActorUuid: validImport.sourceActorUuid,
            groupActorId: "group-a",
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
  const members = [ownedCharacter];
  if (existingTransport) members.unshift(vehicleActor);
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
        members.push(actor);
      },
      async removeMember(actorId) {
        removedMemberIds.push(actorId);
        if (removeMemberError) throw removeMemberError;
        const index = members.findIndex((member) => member.id === actorId);
        if (index >= 0) members.splice(index, 1);
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
          groupState,
          members,
          memberActorIds: members.map((member) => member.id),
          canManage: true
        };
      },
      async mutateGroupState(id, mutator) {
        assert.equal(id, "group-a");
        if (groupStateMutationError) throw groupStateMutationError;
        groupStateMutations.push(id);
        const result = mutator(groupState);
        const persisted = normalizeGroupState(id, groupState);
        for (const key of Object.keys(groupState)) delete groupState[key];
        Object.assign(groupState, persisted);
        return result;
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
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async delete() {
          if (deleteError) throw deleteError;
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
    groupState,
    groupStateMutations,
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
  assert.equal(validateTransportImportPayload(validWorldImport), true);
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

test("world transport templates resolve back to their canonical managed compendium Actor", async () => {
  const harness = createTransportInstanceHarness();
  const worldSource = {
    uuid: validWorldImport.sourceActorUuid,
    pack: null,
    type: "vehicle",
    _stats: {
      compendiumSource: validImport.sourceActorUuid
    },
    toObject: () => ({
      name: "Линкор из мира",
      type: "vehicle",
      _stats: {
        compendiumSource: validImport.sourceActorUuid
      },
      flags: {
        "rebreya-main": {
          managed: true,
          sourceId: "transport-v01-boevoy-kon",
          signature: "transport-v1:abc",
          transport: {
            instance: false,
            sourceId: "transport-v01-boevoy-kon"
          }
        }
      }
    }),
    getFlag(scope, key) {
      return this.toObject().flags?.[scope]?.[key];
    }
  };
  const service = new TransportInstanceService(harness.moduleApi, {
    ...harness.options,
    fromUuid: async (uuid) => {
      if (uuid === worldSource.uuid) return worldSource;
      if (uuid === harness.source.uuid) return harness.source;
      return null;
    }
  });

  const result = await service.importIntoGroup(validWorldImport, { sender: harness.gm });

  assert.equal(result.actorId, "vehicle-created-1");
  assert.equal(harness.createdActors[0].name, harness.source.name);
  assert.equal(
    harness.createdActors[0].flags["rebreya-main"].transport.sourceActorUuid,
    validImport.sourceActorUuid
  );
});

test("world transport templates with forged canonical identity are rejected", async () => {
  const harness = createTransportInstanceHarness();
  const forged = {
    uuid: validWorldImport.sourceActorUuid,
    pack: null,
    type: "vehicle",
    _stats: {
      compendiumSource: validImport.sourceActorUuid
    },
    toObject: () => ({
      type: "vehicle",
      _stats: {
        compendiumSource: validImport.sourceActorUuid
      },
      flags: {
        "rebreya-main": {
          managed: true,
          sourceId: "transport-v01-forged",
          signature: "transport-v1:forged",
          transport: {
            instance: false,
            sourceId: "transport-v01-forged"
          }
        }
      }
    }),
    getFlag(scope, key) {
      return this.toObject().flags?.[scope]?.[key];
    }
  };
  const service = new TransportInstanceService(harness.moduleApi, {
    ...harness.options,
    fromUuid: async (uuid) => {
      if (uuid === forged.uuid) return forged;
      if (uuid === harness.source.uuid) return harness.source;
      return null;
    }
  });

  await assert.rejects(
    () => service.importIntoGroup(validWorldImport, { sender: harness.gm }),
    /управляемым транспортом Ребреи/u
  );
  assert.equal(harness.createdActors.length, 0);
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

test("import creates an independent world Actor, assigns its target-group role, and activates it", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const first = await service.importIntoGroup(validImport, { sender: harness.gm });

  assert.deepEqual(harness.addedMemberIds, [first.actorId]);
  assert.deepEqual(harness.roleUpdates, []);
  assert.deepEqual(harness.groupStateMutations, ["group-a"]);
  assert.equal(harness.groupState.memberStateByActorId[first.actorId].role, "mount");
  assert.equal(harness.groupState.transportState.activeTransportId, `member:${first.actorId}`);
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

test("group import rejects a legacy instance whose source id is stored at module root", async () => {
  const harness = createTransportInstanceHarness({ existingTransport: true });
  harness.vehicleActor.getFlag = (_scope, key) => {
    if (key === "sourceId") return "transport-v01-existing";
    if (key !== "transport") return undefined;
    return {
      instance: true,
      sourceActorUuid: validImport.sourceActorUuid,
      groupActorId: "group-a"
    };
  };
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.importIntoGroup(validImport, { sender: harness.gm }),
    /транспорт/u
  );
  assert.equal(harness.createdActors.length, 0);
});

test("concurrent imports serialize per group and create only one concrete transport", async () => {
  const harness = createTransportInstanceHarness();
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const results = await Promise.allSettled([
    service.importIntoGroup(validImport, { sender: harness.gm }),
    service.importIntoGroup(validImport, { sender: harness.gm })
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(harness.createdActors.length, 1);
  assert.equal(harness.addedMemberIds.length, 1);
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

test("failed target-group state assignment removes membership and deletes the newly-created Actor", async () => {
  const harness = createTransportInstanceHarness({
    groupStateMutationError: new Error("role failed")
  });
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.importIntoGroup(validImport, { sender: harness.gm }),
    /role failed/u
  );
  assert.deepEqual(harness.removedMemberIds, ["vehicle-created-1"]);
  assert.equal(harness.createdActors[0].deleted, true);
});

test("failed rollback reports cleanup failures instead of hiding orphan risk", async () => {
  const harness = createTransportInstanceHarness({
    groupStateMutationError: new Error("role failed"),
    removeMemberError: new Error("membership cleanup failed"),
    deleteError: new Error("actor cleanup failed")
  });
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  await assert.rejects(
    () => service.importIntoGroup(validImport, { sender: harness.gm }),
    (error) => (
      error instanceof AggregateError
      && /role failed/u.test(error.message)
      && error.errors.some((entry) => /membership cleanup failed/u.test(entry.message))
      && error.errors.some((entry) => /actor cleanup failed/u.test(entry.message))
    )
  );
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
  const harness = createTransportInstanceHarness({ existingTransport: true });
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
  const harness = createTransportInstanceHarness({ existingTransport: true });
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

test("state update rejects unrelated and foreign-group vehicle members", async () => {
  const unrelatedHarness = createTransportInstanceHarness({ existingTransport: true });
  unrelatedHarness.vehicleActor.getFlag = () => ({ instance: false, groupActorId: "group-a" });
  const unrelatedService = new TransportInstanceService(unrelatedHarness.moduleApi, unrelatedHarness.options);
  await assert.rejects(
    () => unrelatedService.updateInstanceState(validState, { sender: unrelatedHarness.gm }),
    /транспорт/u
  );

  const foreignHarness = createTransportInstanceHarness({ existingTransport: true });
  foreignHarness.vehicleActor.getFlag = () => ({
    instance: true,
    sourceId: "transport-v01-existing",
    sourceActorUuid: validImport.sourceActorUuid,
    groupActorId: "group-b"
  });
  const foreignService = new TransportInstanceService(foreignHarness.moduleApi, foreignHarness.options);
  await assert.rejects(
    () => foreignService.updateInstanceState(validState, { sender: foreignHarness.gm }),
    /транспорт/u
  );
});
