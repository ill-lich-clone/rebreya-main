import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPartyInventoryItemDragData,
  handleAcceptedPartyInventoryItem,
  registerInventorySyncHooks
} from "../scripts/integrations/inventory-sync.js";
import {
  SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT
} from "../scripts/data/inventory-service.js";

const SOCKET_CHANNEL = "module.rebreya-main";

test("container mechanics updates refresh the exact owning actor scope", async () => {
  const listeners = {};
  const calls = [];
  registerInventorySyncHooks({ refreshInventoryViews: async scope => calls.push(scope.actorIds) }, {
    Hooks: { on(name, callback) { listeners[name] = callback; } }, debounceMs: 0, force: true
  });
  for (const type of ["character", "group"]) {
    const item = { id: "bag", type: "container", parent: { id: type, type } };
    for (const field of ["container", "capacity.weight.value", "capacity.weight.units", "properties", "quantity", "weight.value"]) {
      listeners.updateItem(item, { [`system.${field}`]: 1 }, {}, "remote");
      await flushAsyncHooks();
      assert.deepEqual(calls.at(-1), [type]);
    }
  }
  assert.equal(calls.length, 12);
});

async function flushAsyncHooks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createTransferItem({
  id,
  uuid,
  sourceId = id,
  quantity = 1,
  parentType = "character",
  calls = []
}) {
  return {
    id,
    uuid,
    name: sourceId,
    type: "loot",
    parent: { type: parentType },
    system: { quantity },
    flags: {
      ["rebreya-main"]: {
        sourceType: "gear",
        sourceId
      }
    },
    toObject() {
      return {
        name: this.name,
        type: this.type,
        system: { quantity: this.system.quantity },
        flags: structuredClone(this.flags)
      };
    },
    async update(patch) {
      calls.push(["update", this.uuid, patch["system.quantity"]]);
      this.system.quantity = patch["system.quantity"];
      return this;
    },
    async delete() {
      calls.push(["delete", this.uuid]);
      return this;
    }
  };
}

test("party inventory drag requires an explicit active GM", () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "player-no-gm" },
    users: { activeGM: null }
  };
  const sourceItemUuid = "Actor.group.Item.no-active-gm";
  const sourceItem = createTransferItem({
    id: "no-active-gm",
    uuid: sourceItemUuid,
    parentType: "group"
  });

  try {
    assert.throws(
      () => buildPartyInventoryItemDragData(sourceItemUuid, sourceItem),
      /active GM/iu
    );
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("party inventory drag data marks the source item and accepted character item depletes it", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: {
      id: "player-1"
    },
    users: { activeGM: { id: "gm", isGM: true, active: true } }
  };
  const sourceItemUuid = "Actor.group-1.Item.torch";
  const sourceItem = createTransferItem({
    id: "torch",
    uuid: sourceItemUuid,
    sourceId: "torch",
    parentType: "group"
  });
  const dragData = buildPartyInventoryItemDragData(sourceItemUuid, sourceItem);
  const calls = [];
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item, transfer) {
        calls.push(["accepted", item.uuid, transfer.sourceItemUuid]);
        return { handled: true };
      }
    },
    async refreshInventoryViews() {
      calls.push(["refresh"]);
    }
  };
  const acceptedItem = createTransferItem({
    id: "torch-copy",
    uuid: "Actor.hero.Item.torch-copy",
    sourceId: "torch"
  });

  try {
    const transferId = dragData.flags["rebreya-main"].partyInventoryTransfer.transferId;
    assert.match(transferId, /^party-transfer:/u);
    assert.deepEqual(dragData, {
      type: "Item",
      uuid: sourceItemUuid,
      flags: {
        "rebreya-main": {
          partyInventoryTransfer: {
            sourceItemUuid,
            transferId,
            expectedIdentity: {
              sourceType: "gear",
              sourceId: "torch",
              itemType: "",
              normalizedName: "",
              durability: "uninitialized"
            },
            expectedQuantity: 1
          }
        }
      }
    });

    const handled = await handleAcceptedPartyInventoryItem(acceptedItem, {}, "player-1", moduleApi);

    assert.equal(handled, true);
    assert.deepEqual(calls, [
      ["accepted", acceptedItem.uuid, sourceItemUuid],
      ["refresh"]
    ]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a mismatched target identity does not consume the pending transfer", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "player-identity" },
    users: { activeGM: { id: "gm", isGM: true, active: true } }
  };
  const sourceItemUuid = "Actor.group.Item.identity-source";
  const sourceItem = createTransferItem({
    id: "identity-source",
    uuid: sourceItemUuid,
    sourceId: "identity-source",
    parentType: "group"
  });
  const calls = [];
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item) {
        calls.push(item.uuid);
        return { handled: true };
      }
    },
    async initializeItem() {}
  };

  try {
    buildPartyInventoryItemDragData(sourceItemUuid, sourceItem);
    const mismatched = await handleAcceptedPartyInventoryItem(createTransferItem({
      id: "wrong-target",
      uuid: "Actor.hero.Item.wrong-target",
      sourceId: "different-source"
    }), { eventType: "createItem" }, "player-identity", moduleApi);
    const matched = await handleAcceptedPartyInventoryItem(createTransferItem({
      id: "right-target",
      uuid: "Actor.hero.Item.right-target",
      sourceId: "identity-source"
    }), { eventType: "createItem" }, "player-identity", moduleApi);

    assert.equal(mismatched, false);
    assert.equal(matched, true);
    assert.deepEqual(calls, ["Actor.hero.Item.right-target"]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a mismatched target quantity does not consume the pending transfer", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "player-quantity" },
    users: { activeGM: { id: "gm", isGM: true, active: true } }
  };
  const sourceItemUuid = "Actor.group.Item.quantity-source";
  const sourceItem = createTransferItem({
    id: "quantity-source",
    uuid: sourceItemUuid,
    sourceId: "quantity-source",
    quantity: 2,
    parentType: "group"
  });
  const calls = [];
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item) {
        calls.push(item.uuid);
        return { handled: true };
      }
    },
    async initializeItem() {}
  };

  try {
    buildPartyInventoryItemDragData(sourceItemUuid, sourceItem);
    const mismatched = await handleAcceptedPartyInventoryItem(createTransferItem({
      id: "wrong-quantity",
      uuid: "Actor.hero.Item.wrong-quantity",
      sourceId: "quantity-source",
      quantity: 1
    }), { eventType: "createItem" }, "player-quantity", moduleApi);
    const matched = await handleAcceptedPartyInventoryItem(createTransferItem({
      id: "right-quantity",
      uuid: "Actor.hero.Item.right-quantity",
      sourceId: "quantity-source",
      quantity: 2
    }), { eventType: "createItem" }, "player-quantity", moduleApi);

    assert.equal(mismatched, false);
    assert.equal(matched, true);
    assert.deepEqual(calls, ["Actor.hero.Item.right-quantity"]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("inventory sync hooks refresh inventory views for item and actor changes", async () => {
  const calls = [];
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const moduleApi = {
    async initializeItem(item) {
      calls.push(`initialize:${item.id ?? "item"}`);
    },
    async refreshInventoryViews() {
      calls.push("refresh");
    }
  };

  const registered = registerInventorySyncHooks(moduleApi, {
    Hooks: hooks,
    debounceMs: 0,
    force: true
  });

  assert.equal(registered, true);
  hooks.listeners.createItem[0]({ id: "sword", parent: { type: "character" } }, {}, "user-1");
  await flushAsyncHooks();
  hooks.listeners.updateActor[0]({ type: "character" }, { system: { attributes: { encumbrance: {} } } }, {}, "user-1");
  await flushAsyncHooks();

  assert.deepEqual(calls, ["initialize:sword", "refresh", "refresh"]);
});

test("inventory sync hooks coalesce affected Actor ids through the existing hook set", async () => {
  const calls = [];
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const moduleApi = {
    async refreshInventoryViews(options) {
      calls.push(options);
    }
  };

  registerInventorySyncHooks(moduleApi, {
    Hooks: hooks,
    debounceMs: 0,
    force: true
  });

  assert.deepEqual(Object.keys(hooks.listeners).sort(), [
    "createItem",
    "deleteItem",
    "updateActor",
    "updateItem"
  ]);
  hooks.listeners.updateActor[0]({ id: "group-a", type: "group" }, {
    flags: { "rebreya-main": { inventoryFolders: { version: 1 } } }
  }, {}, "gm");
  hooks.listeners.updateItem[0]({ id: "item-b", parent: { id: "group-b", type: "group" } }, {}, {}, "gm");
  await flushAsyncHooks();

  assert.deepEqual(calls, [{ actorIds: ["group-a", "group-b"] }]);
});

test("createItem defers legacy durability until delayed GM source depletion is observable", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const socketListeners = new Map();
  globalThis.game = {
    user: {
      id: "player-legacy"
    },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: {
      on(channel, listener) {
        socketListeners.set(channel, listener);
      }
    }
  };
  const sourceItemUuid = "Actor.group-1.Item.legacy-sword";
  const sourceItem = createTransferItem({
    id: "legacy-sword",
    uuid: sourceItemUuid,
    sourceId: "legacy-sword",
    parentType: "group"
  });
  let sourceExists = true;
  globalThis.fromUuid = async (uuid) => uuid === sourceItemUuid && sourceExists
    ? sourceItem
    : null;
  const transferId = buildPartyInventoryItemDragData(sourceItemUuid, sourceItem)
    .flags["rebreya-main"].partyInventoryTransfer.transferId;
  const calls = [];
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const acceptedItem = createTransferItem({
    id: "legacy-sword-copy",
    uuid: "Actor.hero.Item.legacy-sword-copy",
    sourceId: "legacy-sword"
  });
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item, transfer) {
        calls.push(["transfer", item.flags["rebreya-main"]?.durability ?? null, transfer.sourceItemUuid]);
        return {
          handled: true,
          requested: true,
          transferId: transfer.transferId,
          sourceItemUuid: transfer.sourceItemUuid,
          targetItemUuid: item.uuid,
          targetReceipt: transfer.targetReceipt
        };
      }
    },
    async initializeItem(item) {
      calls.push(["initialize", item.id]);
      item.flags["rebreya-main"] = {
        durability: {
          state: "intact"
        }
      };
    },
    async refreshInventoryViews() {
      calls.push(["refresh"]);
    }
  };

  try {
    registerInventorySyncHooks(moduleApi, {
      Hooks: hooks,
      debounceMs: 0,
      force: true
    });

    hooks.listeners.createItem[0](acceptedItem, {}, "player-legacy");
    await flushAsyncHooks();

    assert.deepEqual(calls, [
      ["transfer", null, sourceItemUuid],
      ["refresh"]
    ]);

    socketListeners.get(SOCKET_CHANNEL)?.({
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-legacy",
      transferId,
      sourceItemUuid,
      targetItemUuid: acceptedItem.uuid,
      ok: true
    });
    await flushAsyncHooks();
    assert.equal(calls.some(([kind]) => kind === "initialize"), false);

    sourceExists = false;
    hooks.listeners.deleteItem[0]({ uuid: sourceItemUuid, parent: { type: "group" } });
    await flushAsyncHooks();
    await flushAsyncHooks();

    assert.equal(calls.some(([kind, id]) => kind === "initialize" && id === acceptedItem.id), true);
    assert.equal(acceptedItem.flags["rebreya-main"].durability.state, "intact");
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("failed delayed source depletion removes the uninitialized accepted legacy copy", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const socketListeners = new Map();
  globalThis.game = {
    user: { id: "player-failed-transfer" },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: {
      on(channel, listener) {
        socketListeners.set(channel, listener);
      }
    }
  };
  const sourceItemUuid = "Actor.group-1.Item.failed-sword";
  const sourceItem = createTransferItem({
    id: "failed-sword",
    uuid: sourceItemUuid,
    sourceId: "failed-sword",
    parentType: "group"
  });
  globalThis.fromUuid = async (uuid) => uuid === sourceItemUuid ? sourceItem : null;
  const transferId = buildPartyInventoryItemDragData(sourceItemUuid, sourceItem)
    .flags["rebreya-main"].partyInventoryTransfer.transferId;
  const calls = [];
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const acceptedItem = createTransferItem({
    id: "failed-sword-copy",
    uuid: "Actor.hero.Item.failed-sword-copy",
    sourceId: "failed-sword",
    calls
  });
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item, transfer) {
        calls.push(["transfer", transfer.sourceItemUuid]);
        return {
          handled: true,
          requested: true,
          transferId: transfer.transferId,
          sourceItemUuid: transfer.sourceItemUuid,
          targetItemUuid: item.uuid,
          targetReceipt: transfer.targetReceipt
        };
      }
    },
    async initializeItem(item) {
      calls.push(["initialize", item.id]);
    },
    async refreshInventoryViews() {
      calls.push(["refresh"]);
    }
  };

  try {
    registerInventorySyncHooks(moduleApi, { Hooks: hooks, debounceMs: 0, force: true });
    hooks.listeners.createItem[0](acceptedItem, {}, "player-failed-transfer");
    await flushAsyncHooks();

    socketListeners.get(SOCKET_CHANNEL)?.({
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-failed-transfer",
      transferId,
      sourceItemUuid,
      targetItemUuid: acceptedItem.uuid,
      ok: false,
      error: "rejected"
    });
    await flushAsyncHooks();

    assert.deepEqual(calls, [
      ["transfer", sourceItemUuid],
      ["refresh"],
      ["delete", acceptedItem.uuid]
    ]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("failed updateItem depletion restores the merge receipt without deleting the target stack", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const socketListeners = new Map();
  globalThis.game = {
    user: { id: "player-merge-rollback" },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: {
      on(channel, listener) {
        socketListeners.set(channel, listener);
      }
    }
  };
  const calls = [];
  const sourceItemUuid = "Actor.group.Item.merge-source";
  const sourceItem = createTransferItem({
    id: "merge-source",
    uuid: sourceItemUuid,
    sourceId: "merge-source",
    quantity: 2,
    parentType: "group"
  });
  globalThis.fromUuid = async (uuid) => uuid === sourceItemUuid ? sourceItem : null;
  const transferId = buildPartyInventoryItemDragData(sourceItemUuid, sourceItem)
    .flags["rebreya-main"].partyInventoryTransfer.transferId;
  const targetItem = createTransferItem({
    id: "merge-target",
    uuid: "Actor.hero.Item.merge-target",
    sourceId: "merge-source",
    quantity: 5,
    calls
  });
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(_item, transfer) {
        calls.push(["transfer", structuredClone(transfer.targetReceipt)]);
        return {
          handled: true,
          requested: true,
          transferId: transfer.transferId,
          sourceItemUuid: transfer.sourceItemUuid,
          targetItemUuid: transfer.targetItemUuid,
          targetReceipt: transfer.targetReceipt
        };
      }
    },
    async refreshInventoryViews() {
      calls.push(["refresh"]);
    }
  };

  try {
    registerInventorySyncHooks(moduleApi, { Hooks: hooks, debounceMs: 0, force: true });
    hooks.listeners.updateItem[0](targetItem, { "system.quantity": 5 }, {}, "player-merge-rollback");
    await flushAsyncHooks();

    socketListeners.get(SOCKET_CHANNEL)?.({
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-merge-rollback",
      transferId,
      sourceItemUuid,
      targetItemUuid: targetItem.uuid,
      ok: false
    });
    await flushAsyncHooks();

    assert.deepEqual(calls, [
      ["transfer", {
        targetItemUuid: targetItem.uuid,
        created: false,
        beforeQuantity: 3,
        afterQuantity: 5,
        delta: 2
      }],
      ["refresh"],
      ["update", targetItem.uuid, 3]
    ]);
    assert.equal(targetItem.system.quantity, 3);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("active GM native drag rolls back the accepted target when source debit is confirmed unchanged", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const gm = { id: "gm-local-rollback", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  const sourceItemUuid = "Actor.group.Item.local-failed-source";
  const sourceItem = createTransferItem({
    id: "local-failed-source",
    uuid: sourceItemUuid,
    sourceId: "local-failed-source",
    parentType: "group"
  });
  globalThis.fromUuid = async (uuid) => uuid === sourceItemUuid ? sourceItem : null;
  buildPartyInventoryItemDragData(sourceItemUuid, sourceItem);
  const calls = [];
  const acceptedItem = createTransferItem({
    id: "local-failed-target",
    uuid: "Actor.hero.Item.local-failed-target",
    sourceId: "local-failed-source",
    calls
  });
  const error = Object.assign(new Error("source debit failed"), {
    code: "source-debit-failed",
    inventoryTransferMode: "simple"
  });
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem() {
        calls.push(["transfer"]);
        throw error;
      }
    }
  };

  try {
    await assert.rejects(
      handleAcceptedPartyInventoryItem(acceptedItem, {}, gm.id, moduleApi),
      (caught) => caught === error
    );
    assert.deepEqual(calls, [["transfer"], ["delete", acceptedItem.uuid]]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("active GM native drag reports manual review when its accepted target drifts before rollback", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const gm = { id: "gm-local-drift", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  const source = createTransferItem({
    id: "local-drift-source",
    uuid: "Actor.group.Item.local-drift-source",
    sourceId: "local-drift-source",
    parentType: "group"
  });
  globalThis.fromUuid = async (uuid) => uuid === source.uuid ? source : null;
  buildPartyInventoryItemDragData(source.uuid, source);
  const calls = [];
  const target = createTransferItem({
    id: "local-drift-target",
    uuid: "Actor.hero.Item.local-drift-target",
    sourceId: "local-drift-source",
    calls
  });
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem() {
        target.system.quantity = 2;
        const error = new Error("source debit failed");
        error.code = "source-debit-failed";
        error.inventoryTransferMode = "simple";
        throw error;
      }
    }
  };

  try {
    await assert.rejects(
      handleAcceptedPartyInventoryItem(target, {}, gm.id, moduleApi),
      (error) => error?.code === "transfer-manual-review"
        && error?.inventoryTransferMode === "simple"
    );
    assert.equal(target.system.quantity, 2);
    assert.deepEqual(calls, []);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("an observed source delete settles once before its delayed response", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const socketListeners = new Map();
  globalThis.game = {
    user: { id: "player-observed-delete" },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: {
      on(channel, listener) {
        socketListeners.set(channel, listener);
      }
    }
  };
  const calls = [];
  const sourceItemUuid = "Actor.group.Item.observed-source";
  const sourceItem = createTransferItem({
    id: "observed-source",
    uuid: sourceItemUuid,
    sourceId: "observed-source",
    parentType: "group"
  });
  let sourceExists = true;
  globalThis.fromUuid = async (uuid) => uuid === sourceItemUuid && sourceExists ? sourceItem : null;
  const transferId = buildPartyInventoryItemDragData(sourceItemUuid, sourceItem)
    .flags["rebreya-main"].partyInventoryTransfer.transferId;
  const targetItem = createTransferItem({
    id: "observed-target",
    uuid: "Actor.hero.Item.observed-target",
    sourceId: "observed-source"
  });
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(_item, transfer) {
        return {
          handled: true,
          requested: true,
          transferId: transfer.transferId,
          sourceItemUuid: transfer.sourceItemUuid,
          targetItemUuid: transfer.targetItemUuid,
          targetReceipt: transfer.targetReceipt
        };
      }
    },
    async initializeItem(item) {
      calls.push(["initialize", item.uuid]);
    },
    async refreshInventoryViews() {}
  };

  try {
    registerInventorySyncHooks(moduleApi, { Hooks: hooks, debounceMs: 0, force: true });
    hooks.listeners.createItem[0](targetItem, {}, "player-observed-delete");
    await flushAsyncHooks();

    sourceExists = false;
    hooks.listeners.deleteItem[0](sourceItem);
    await flushAsyncHooks();
    await flushAsyncHooks();

    const response = {
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-observed-delete",
      transferId,
      sourceItemUuid,
      targetItemUuid: targetItem.uuid,
      ok: true
    };
    socketListeners.get(SOCKET_CHANNEL)?.(response);
    socketListeners.get(SOCKET_CHANNEL)?.(response);
    await flushAsyncHooks();

    assert.deepEqual(calls, [["initialize", targetItem.uuid]]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("out-of-order depletion responses settle only their exact accepted transfer", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const socketListeners = new Map();
  globalThis.game = {
    user: { id: "player-two-transfers" },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: {
      on(channel, listener) {
        socketListeners.set(channel, listener);
      }
    }
  };
  const sourceA = "Actor.group-1.Item.source-a";
  const sourceB = "Actor.group-1.Item.source-b";
  const targetA = "Actor.hero.Item.target-a";
  const targetB = "Actor.hero.Item.target-b";
  const calls = [];
  const sourceItemA = createTransferItem({
    id: "source-a",
    uuid: sourceA,
    sourceId: "source-a",
    parentType: "group"
  });
  const sourceItemB = createTransferItem({
    id: "source-b",
    uuid: sourceB,
    sourceId: "source-b",
    parentType: "group"
  });
  const existingSources = new Map([[sourceB, sourceItemB]]);
  globalThis.fromUuid = async (uuid) => existingSources.get(uuid) ?? null;
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const acceptedA = createTransferItem({
    id: "target-a",
    uuid: targetA,
    sourceId: "source-a",
    calls
  });
  const acceptedB = createTransferItem({
    id: "target-b",
    uuid: targetB,
    sourceId: "source-b",
    calls
  });
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(item, transfer) {
        return {
          handled: true,
          requested: true,
          transferId: transfer.transferId,
          sourceItemUuid: transfer.sourceItemUuid,
          targetItemUuid: item.uuid,
          targetReceipt: transfer.targetReceipt
        };
      }
    },
    async initializeItem(item) {
      calls.push(["initialize", item.uuid]);
    },
    async refreshInventoryViews() {}
  };

  try {
    registerInventorySyncHooks(moduleApi, { Hooks: hooks, debounceMs: 0, force: true });
    const dragA = buildPartyInventoryItemDragData(sourceA, sourceItemA);
    hooks.listeners.createItem[0](acceptedA, {}, "player-two-transfers");
    await flushAsyncHooks();
    const dragB = buildPartyInventoryItemDragData(sourceB, sourceItemB);
    hooks.listeners.createItem[0](acceptedB, {}, "player-two-transfers");
    await flushAsyncHooks();

    const transferA = dragA.flags["rebreya-main"].partyInventoryTransfer.transferId;
    const transferB = dragB.flags["rebreya-main"].partyInventoryTransfer.transferId;
    assert.notEqual(transferA, transferB);

    socketListeners.get(SOCKET_CHANNEL)?.({
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-two-transfers",
      transferId: transferB,
      sourceItemUuid: sourceB,
      targetItemUuid: targetB,
      ok: false
    });
    socketListeners.get(SOCKET_CHANNEL)?.({
      type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT,
      forUserId: "player-two-transfers",
      transferId: transferA,
      sourceItemUuid: sourceA,
      targetItemUuid: targetA,
      ok: true
    });
    await flushAsyncHooks();
    await flushAsyncHooks();

    assert.deepEqual(calls.toSorted(([left], [right]) => left.localeCompare(right)), [
      ["delete", targetB],
      ["initialize", targetA]
    ]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("createItem initializes an ordinary embedded item only on the current client", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: {
      id: "player-current"
    }
  };
  const hooks = {
    listeners: {},
    on(hookName, listener) {
      this.listeners[hookName] ??= [];
      this.listeners[hookName].push(listener);
    }
  };
  const calls = [];
  const moduleApi = {
    async initializeItem(item) {
      calls.push(`initialize:${item.id}`);
    },
    async refreshInventoryViews() {
      calls.push("refresh");
    }
  };

  try {
    registerInventorySyncHooks(moduleApi, {
      Hooks: hooks,
      debounceMs: 0,
      force: true
    });

    hooks.listeners.createItem[0]({ id: "remote", parent: { type: "character" } }, {}, "player-remote");
    await flushAsyncHooks();
    hooks.listeners.createItem[0]({ id: "current", parent: { type: "character" } }, {}, "player-current");
    await flushAsyncHooks();

    assert.deepEqual(calls, [
      "refresh",
      "initialize:current",
      "refresh"
    ]);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("a GM rejection received while the mutation waits for UI refresh still rolls back the accepted copy", async () => {
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const calls = [];
  let socketListener;
  const source = createTransferItem({ id: "source", sourceId: "torch", uuid: "Actor.group.Item.source", parentType: "group" });
  const target = createTransferItem({ id: "copy", sourceId: "torch", uuid: "Actor.hero.Item.copy", calls });
  globalThis.game = {
    user: { id: "player-early-rejection" },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    socket: { on(_channel, listener) { socketListener = listener; } }
  };
  globalThis.fromUuid = async uuid => uuid === source.uuid ? source : target;
  const moduleApi = {
    inventoryService: {
      async handleAcceptedPartyInventoryItem(_item, transfer) {
        return { ...transfer, handled: true, requested: true };
      }
    },
    async runInventoryMutation(operation) {
      const result = await operation();
      socketListener({
        type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT, forUserId: game.user.id,
        transferId: result.transferId, sourceItemUuid: source.uuid, targetItemUuid: target.uuid,
        ok: false, error: "rejected"
      });
      await flushAsyncHooks();
      return result;
    }
  };
  try {
    registerInventorySyncHooks(moduleApi, { Hooks: { on() {} }, force: true });
    buildPartyInventoryItemDragData(source.uuid, source);
    await handleAcceptedPartyInventoryItem(target, {}, game.user.id, moduleApi);
    assert.deepEqual(calls, [["delete", target.uuid]]);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.fromUuid = previousFromUuid;
  }
});
