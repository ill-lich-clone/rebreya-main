import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("inventory UI drag is accepted by the exact integration imported by the composition root", async () => {
  const owners = ["../scripts/ui/inventory-app.js", "../scripts/main.js"];
  const integrations = await Promise.all(owners.map(async owner => {
    const ownerUrl = new URL(owner, import.meta.url);
    const source = await readFile(ownerUrl, "utf8");
    const specifier = source.match(/from ["']([^"']*inventory-sync\.js[^"']*)["']/u)?.[1];
    assert.ok(specifier, `${owner} must use the inventory transfer integration`);
    return import(new URL(specifier, ownerUrl).href);
  }));
  const [uiIntegration, hookIntegration] = integrations;
  const previousGame = globalThis.game;
  globalThis.game = {
    user: { id: "player-import-graph" },
    users: { activeGM: { id: "gm", isGM: true, active: true } }
  };
  try {
    const source = { uuid: "Actor.group.Item.torch", name: "Torch", type: "loot", system: { quantity: 2 } };
    const target = { ...source, uuid: "Actor.hero.Item.copy", parent: { type: "character" } };
    uiIntegration.buildPartyInventoryItemDragData(source.uuid, source);
    let acceptedSource;
    const handled = await hookIntegration.handleAcceptedPartyInventoryItem(target, {}, game.user.id, {
      inventoryService: {
        async handleAcceptedPartyInventoryItem(_item, transfer) {
          acceptedSource = transfer.sourceItemUuid;
          return { handled: true };
        }
      }
    });
    // Consume the UI session even in the broken graph, to avoid leaving its TTL timer alive.
    if (!handled) await uiIntegration.handleAcceptedPartyInventoryItem(target, {}, game.user.id, {});
    assert.equal(handled, true, "the hook must see the session created by the inventory UI");
    assert.equal(acceptedSource, source.uuid);
  }
  finally { globalThis.game = previousGame; }
});
