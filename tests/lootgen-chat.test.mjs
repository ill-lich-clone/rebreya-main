import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class FakeElement {
  constructor({ className = "", dataset = {}, queryMap = {} } = {}) {
    this.className = className;
    this.dataset = dataset;
    this.queryMap = queryMap;
    this.listeners = {};
  }

  addEventListener(type, listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  matches(selector) {
    return selector === ".rm-chat-loot" && String(this.className).split(/\s+/u).includes("rm-chat-loot");
  }

  querySelectorAll(selector) {
    return this.queryMap[selector] ?? [];
  }
}

function installLootgenChatFoundryStubs() {
  const previousFoundry = globalThis.foundry;
  const previousHTMLElement = globalThis.HTMLElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.foundry = {
    utils: {
      escapeHTML: (value) => String(value ?? "")
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
    }
  };

  return () => {
    globalThis.foundry = previousFoundry;
    globalThis.HTMLElement = previousHTMLElement;
  };
}

function createBoundLootgenChatCard({ state, rowDataset = {} }) {
  const row = new FakeElement({
    dataset: {
      lootgenChatRowId: state.rows[0].rowId,
      ...rowDataset
    }
  });
  const claimButton = new FakeElement({
    dataset: {
      lootgenChatId: state.lootId,
      lootgenChatRowId: state.rows[0].rowId
    }
  });
  const claimAllButton = new FakeElement({
    dataset: {
      lootgenChatId: state.lootId
    }
  });
  const card = new FakeElement({
    className: "rm-chat-loot",
    dataset: {
      lootgenChatId: state.lootId
    },
    queryMap: {
      "[data-lootgen-chat-drag='true']": [row],
      "[data-lootgen-chat-action='claim-row']": [claimButton],
      "[data-lootgen-chat-action='claim-coins']": [],
      "[data-lootgen-chat-action='claim-all']": [claimAllButton]
    }
  });
  card.queryMap["[data-lootgen-chat-action='undo-clear']"] = [];

  return { card, row, claimButton, claimAllButton };
}

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

test("lootgen chat rows render a real claim button without dnd5e item uuid hooks", async () => {
  const restoreFoundry = installLootgenChatFoundryStubs();

  try {
    const { buildLootgenChatContent } = await import(`../scripts/ui/lootgen-chat.js?render-claim=${Date.now()}`);
    const content = buildLootgenChatContent({
      lootId: "loot-1",
      rows: [{
        rowId: "row-1",
        itemUuid: "Actor.loot.Item.deleted",
        name: "Test Relic",
        quantity: 1,
        itemData: {
          name: "Test Relic",
          type: "loot"
        }
      }]
    });

    assert.match(content, /<button[^>]+data-lootgen-chat-action="claim-row"/u);
    assert.match(content, /data-lootgen-chat-row-id="row-1"/u);
    assert.doesNotMatch(content, /data-item-uuid=/u);
  }
  finally {
    restoreFoundry();
  }
});

test("lootgen chat renders broken condition from persisted item data without renaming the item", async () => {
  const restoreFoundry = installLootgenChatFoundryStubs();

  try {
    const { buildLootgenChatContent } = await import(`../scripts/ui/lootgen-chat.js?render-broken=${Date.now()}`);
    const content = buildLootgenChatContent({
      lootId: "loot-broken",
      rows: [{
        rowId: "row-broken",
        name: "Длинный меч",
        quantity: 1,
        itemData: {
          name: "Длинный меч",
          type: "weapon",
          flags: {
            "rebreya-main": {
              durability: { state: "broken", breakStage: 1 }
            }
          }
        }
      }]
    });

    assert.match(content, />Длинный меч</u);
    assert.match(content, /Сломано/u);
    assert.match(content, /rm-chat-loot__condition--broken/u);
    assert.doesNotMatch(content, /Длинный меч \(сломано\)/iu);
  }
  finally {
    restoreFoundry();
  }
});

test("lootgen chat claim button takes a row through the module API", async () => {
  const restoreFoundry = installLootgenChatFoundryStubs();
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const calls = [];
  const state = {
    lootId: "loot-1",
    rows: [{
      rowId: "row-1",
      name: "Test Relic",
      itemData: {
        name: "Test Relic",
        type: "loot"
      }
    }]
  };

  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
    }
  };
  globalThis.game = {
    user: {
      id: "player-1"
    },
    rebreyaMain: {
      async claimLootgenChatRowToInventory(lootId, rowId) {
        calls.push([lootId, rowId]);
      }
    }
  };

  try {
    const { registerLootgenChatHooks } = await import(`../scripts/ui/lootgen-chat.js?claim-click=${Date.now()}`);
    registerLootgenChatHooks({});
    const renderListener = listeners.find((entry) => entry.hookName === "renderChatMessage")?.listener;
    const { card, claimButton } = createBoundLootgenChatCard({ state });

    renderListener({
      getFlag: () => state
    }, card);

    assert.equal(typeof claimButton.listeners.click?.[0], "function");
    await claimButton.listeners.click[0]({
      currentTarget: claimButton,
      preventDefault() {}
    });

    assert.deepEqual(calls, [["loot-1", "row-1"]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("lootgen chat renders and binds a take all button for the party inventory", async () => {
  const restoreFoundry = installLootgenChatFoundryStubs();
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const calls = [];
  const state = {
    lootId: "loot-1",
    rows: [{
      rowId: "row-1",
      name: "Test Relic",
      itemData: {
        name: "Test Relic",
        type: "loot"
      }
    }]
  };

  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
    }
  };
  globalThis.game = {
    user: {
      id: "player-1"
    },
    rebreyaMain: {
      async claimLootgenChatAllToInventory(lootId) {
        calls.push([lootId]);
      }
    }
  };

  try {
    const { buildLootgenChatContent, registerLootgenChatHooks } = await import(`../scripts/ui/lootgen-chat.js?claim-all=${Date.now()}`);
    const content = buildLootgenChatContent({
      ...state,
      coins: {
        cp: 3,
        totalCopper: 3
      }
    });

    assert.match(content, /data-lootgen-chat-action="claim-all"/u);
    assert.match(content, /Забрать всё/u);

    registerLootgenChatHooks({});
    const renderListener = listeners.find((entry) => entry.hookName === "renderChatMessage")?.listener;
    const { card, claimAllButton } = createBoundLootgenChatCard({ state });

    renderListener({
      getFlag: () => state
    }, card);

    assert.equal(typeof claimAllButton.listeners.click?.[0], "function");
    await claimAllButton.listeners.click[0]({
      currentTarget: claimAllButton,
      preventDefault() {}
    });

    assert.deepEqual(calls, [["loot-1"]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("lootgen app no longer posts a generated status message to chat", async () => {
  const source = await readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8");

  assert.equal(source.includes("Добыча сгенерирована."), false);
});

test("lootgen chat drag uses embedded item data instead of a temporary item uuid", async () => {
  const restoreFoundry = installLootgenChatFoundryStubs();
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const transfers = [];
  const state = {
    lootId: "loot-1",
    rows: [{
      rowId: "row-1",
      name: "Test Relic",
      itemUuid: "Actor.loot.Item.deleted",
      itemData: {
        name: "Test Relic",
        type: "loot",
        flags: {
          "rebreya-main": {
            lootgenChat: {
              lootId: "loot-1",
              rowId: "row-1"
            }
          }
        }
      }
    }]
  };

  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
    }
  };
  globalThis.game = {
    user: {
      id: "player-1"
    }
  };

  try {
    const { registerLootgenChatHooks } = await import(`../scripts/ui/lootgen-chat.js?drag-data=${Date.now()}`);
    registerLootgenChatHooks({});
    const renderListener = listeners.find((entry) => entry.hookName === "renderChatMessage")?.listener;
    const { card, row } = createBoundLootgenChatCard({
      state,
      rowDataset: {
        itemUuid: "Actor.loot.Item.deleted"
      }
    });

    renderListener({
      getFlag: () => state
    }, card);
    row.listeners.dragstart[0]({
      currentTarget: row,
      dataTransfer: {
        set effectAllowed(value) {
          transfers.push(["effectAllowed", value]);
        },
        setData(type, value) {
          transfers.push([type, JSON.parse(value)]);
        }
      }
    });

    const plainPayload = transfers.find(([type]) => type === "text/plain")?.[1];
    assert.equal(plainPayload.type, "Item");
    assert.equal(plainPayload.uuid, undefined);
    assert.equal(plainPayload.data.name, "Test Relic");
    assert.equal(plainPayload.data.flags["rebreya-main"].lootgenChat.rowId, "row-1");
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    restoreFoundry();
  }
});

test("LootgenApp does not post the old extra chat status after sending loot", async () => {
  const source = await readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Добыча отправлена в чат\. Предметы можно перетаскивать в лист персонажа\./u);
});

test("only the active GM handles economic lootgen socket claims", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  for (const eventName of [
    "SOCKET_EVENT_LOOTGEN_CLAIM_ROW",
    "SOCKET_EVENT_LOOTGEN_CLAIM_ROW_TO_INVENTORY",
    "SOCKET_EVENT_LOOTGEN_CLAIM_ALL_TO_INVENTORY",
    "SOCKET_EVENT_LOOTGEN_CLAIM_COINS"
  ]) {
    assert.match(source, new RegExp(`message\\.type === ${eventName} && isActiveGmClient\\(game\\)`, "u"));
    assert.doesNotMatch(source, new RegExp(`message\\.type === ${eventName} && game\\.user\\?\\.isGM`, "u"));
  }
});

test("lootgen trusts only GM-authored chat state and journals direct grants", async () => {
  const [mainSource, appSource] = await Promise.all([
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/ui/lootgen-app.js", import.meta.url), "utf8")
  ]);

  assert.match(mainSource, /const createdBy = String\(state\?\.createdBy/u);
  assert.match(mainSource, /messageUserId === createdBy/u);
  assert.match(mainSource, /author\?\.isGM === true/u);
  assert.match(mainSource, /addLootgenRowToInventoryOnce\(row, mutationId\)/u);
  assert.match(mainSource, /addCurrencyToInventoryOnce\(coins, stableMutationId\)/u);
  assert.match(appSource, /directGrantId: `lootgen:\$\{directBatchId\}:row:\$\{index\}`/u);
  assert.match(appSource, /directCoinGrantId: `lootgen:\$\{directBatchId\}:coins`/u);
  assert.doesNotMatch(appSource, /updatePartyCurrency\(\{/u);
});
