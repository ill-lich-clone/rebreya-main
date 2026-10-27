import test from "node:test";
import assert from "node:assert/strict";
import { GroupContextService } from "../scripts/data/group-context-service.js";
import { registerGroupRegistryLifecycleHooks } from "../scripts/integrations/group-registry-lifecycle.js";

test("registered group grants OWNER to character owners and restores only its own grants", async () => {
  const previous = globalThis.game;
  const gm = { id: "gm", isGM: true, active: true }, a = { id: "a" }, b = { id: "b" }, manual = { id: "manual" };
  const users = new Map([gm, a, b, manual].map(user => [user.id, user])); users.activeGM = gm;
  const hero = { id: "hero", type: "character", ownership: { a: 3, b: 3 } };
  const group = { id: "g", type: "group", ownership: { default: 0, a: 1, manual: 3 }, flags: { "rebreya-main": { managedPartyGroup: true } }, system: { members: [{ actor: hero }] },
    getFlag(scope, key) { return this.flags[scope]?.[key]; }, writes: [],
    async update(patch) { this.writes.push(structuredClone(patch)); for (const [path, value] of Object.entries(patch)) {
      const keys = path.split("."); let parent = this; for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
      const key = keys.at(-1); if (key.startsWith("-=")) delete parent[key.slice(2)]; else parent[key.startsWith("==") ? key.slice(2) : key] = structuredClone(value);
    } }
  };
  const state = { activeGroupActorId: "g", groupsById: { g: { groupActorId: "g" } } };
  globalThis.game = { user: gm, users, actors: { contents: [group, hero], get: id => id === "g" ? group : id === "hero" ? hero : null } };
  const service = new GroupContextService({ groupStateRepository: { read: () => state } });
  try {
    await service.syncInventoryOwnership();
    assert.deepEqual(group.ownership, { default: 0, a: 3, b: 3, manual: 3 });
    assert.equal(group.writes.length, 1);
    await service.syncInventoryOwnership(); assert.equal(group.writes.length, 1);
    hero.ownership = { b: 3 }; await service.syncInventoryOwnership("g");
    assert.deepEqual(group.ownership, { default: 0, a: 1, b: 3, manual: 3 });
    group.system.members = []; await service.syncInventoryOwnership("g");
    assert.deepEqual(group.ownership, { default: 0, a: 1, manual: 3 });
    game.user = a; hero.ownership.a = 3; group.system.members = [{ actor: hero }];
    const writes = group.writes.length; await service.syncInventoryOwnership(); assert.equal(group.writes.length, writes);
  } finally { globalThis.game = previous; }
});

test("ownership lifecycle reacts to membership/ownership and User changes, not unrelated edits", async () => {
  const listeners = new Map(), calls = []; let active = true;
  registerGroupRegistryLifecycleHooks({ hooks: { on: (name, fn) => listeners.set(name, fn) },
    groupContextService: { syncInventoryOwnership: async id => calls.push(id), pruneMissingGroups: async () => ({}) },
    isActiveGmClient: () => active, gameProvider: () => ({}), schedule: fn => fn() });
  await listeners.get("updateActor")({ id: "g", type: "group" }, { "system.members": [] });
  await listeners.get("updateActor")({ id: "hero", type: "character" }, { ownership: { a: 3 } });
  await listeners.get("updateActor")({ id: "hero", type: "character" }, { "system.attributes.hp.value": 1 });
  await listeners.get("updateUser")({}, { role: 1 });
  assert.deepEqual(calls, ["g", undefined, undefined]);
  active = false; await listeners.get("updateActor")({ id: "g", type: "group" }, { "system.members": [] });
  assert.equal(calls.length, 3);
});
