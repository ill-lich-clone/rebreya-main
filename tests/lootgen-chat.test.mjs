import test from "node:test";
import assert from "node:assert/strict";

test("lootgen chat createItem hook ignores item drops from other users", async () => {
  const previousGame = globalThis.game;
  const previousHooks = globalThis.Hooks;
  const listeners = [];
  let handled = 0;

  globalThis.game = {
    user: {
      id: "player-1"
    }
  };
  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
    }
  };

  try {
    const { registerLootgenChatHooks } = await import(`../scripts/ui/lootgen-chat.js?other-user=${Date.now()}`);
    registerLootgenChatHooks({
      handleLootgenChatItemCreated: async () => {
        handled += 1;
      }
    });

    const createItemListener = listeners.find((entry) => entry.hookName === "createItem")?.listener;
    assert.equal(typeof createItemListener, "function");

    createItemListener({}, {}, "player-2");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(handled, 0);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.Hooks = previousHooks;
  }
});
