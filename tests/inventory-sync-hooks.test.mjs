import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPartyInventoryItemDragData,
  handleAcceptedPartyInventoryItem,
  registerInventorySyncHooks
} from "../scripts/integrations/inventory-sync.js";

test("party inventory drag data marks the source item and accepted character item depletes it", async () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    user: {
      id: "player-1"
    }
  };
  const sourceItemUuid = "Actor.group-1.Item.torch";
  const dragData = buildPartyInventoryItemDragData(sourceItemUuid);
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
  const acceptedItem = {
    uuid: "Actor.hero.Item.torch-copy",
    parent: {
      type: "character"
    }
  };

  try {
    assert.deepEqual(dragData, {
      type: "Item",
      uuid: sourceItemUuid,
      flags: {
        "rebreya-main": {
          partyInventoryTransfer: {
            sourceItemUuid
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
  await hooks.listeners.createItem[0]({ parent: { type: "character" } }, {}, "user-1");
  await hooks.listeners.updateActor[0]({ type: "character" }, { system: { attributes: { encumbrance: {} } } }, {}, "user-1");

  assert.deepEqual(calls, ["refresh", "refresh"]);
});
