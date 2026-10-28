import test from "node:test";
import assert from "node:assert/strict";
import { makeInstanceDocumentsFixture } from "./helpers/item-instance-documents-fixture.mjs";
import { InventoryIngressPlanner } from "../scripts/application/inventory-ingress-planner.js";
import { InventoryIngressRuleCompilerCache } from "../scripts/data/inventory-ingress-rules.js";
import { buildInventoryIngressDescriptor, resolveInventoryDismantleOutputs } from "../scripts/data/inventory-ingress-descriptor.js";
import { readInventoryItemQuantity, withInventoryItemQuantity } from "../scripts/data/inventory-material-quantity.js";
import { captureRuntimeItemGraph } from "../scripts/data/runtime-item-graph.js";

const previousHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import("../scripts/main.js?native-owner-tests");
globalThis.Hooks = previousHooks;

function nativeFixture({ quantity = 10 } = {}) {
  const f = makeInstanceDocumentsFixture({ quantity });
  game.user = { id: "player", isGM: false }; game.users.activeGM = null;
  game.packs = new Map();
  f.group.flags["rebreya-main"].managedPartyGroup = true;
  f.group.system = { currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 }, members: [{ actor: f.hero }] };
  f.group.canUserModify = f.hero.canUserModify = user => user.id === "player";
  f.api.inventoryService.getInventoryActor = async ({ groupActorId } = {}) => {
    if (groupActorId && groupActorId !== "g") throw new Error("wrong group"); return f.group;
  };
  const forbidden = label => () => { assert.fail(`native owner used ${label}`); };
  for (const method of ["find", "listPending", "start", "checkpoint", "finish", "recordTerminal"]) f.api.inventoryService.mutationJournal[method] = forbidden(`journal.${method}`);
  for (const method of ["run", "runIdempotent", "runScoped", "runIdempotentScoped"]) f.api.worldMutationCoordinator[method] = forbidden(`coordinator.${method}`);
  f.api.socketCommandBus = { request: forbidden("custom socket") };
  f.api.executeItemQuantityMutation = forbidden("GM quantity route");
  f.model = { materialById: new Map([["iron", { id: "iron", name: "Iron", weight: 1, priceGold: 2 }]]) };
  f.api.getModel = async () => f.model;
  f.api.inventoryIngressPlanner = new InventoryIngressPlanner({
    readRules: id => f.api.inventoryService.getInventoryIngressRuleState({ groupActorId: id }),
    buildDescriptor: data => buildInventoryIngressDescriptor(data, { model: f.model }),
    compilerCache: new InventoryIngressRuleCompilerCache(), resolveDismantleOutputs: (data, quantity) => resolveInventoryDismantleOutputs(data, quantity, { model: f.model }),
    confirm: async () => ({ rootOverrideSourceKeys: [] })
  });
  return f;
}

async function nativeTree(f, source = f.group) {
  if (source !== f.group) { f.group.items.contents = []; f.source.parent = source; source.items.contents.push(f.source); }
  Object.assign(f.source.data.flags["rebreya-main"], {
    itemUpgrades: { installed: [{ itemId: "up", slotIndex: 0 }] },
    itemSourceUuid: "Item.original-root"
  });
  await source.createEmbeddedDocuments("Item", [
    { _id: "up", name: "Upgrade", type: "loot", system: { quantity: 1 }, flags: { "rebreya-main": { installedUpgrade: { hostItemId: "rope", hostActorId: source.id, slotIndex: 0 } } } },
    { _id: "nested", name: "Nested bag", type: "container", system: { quantity: 1, container: "rope", currency: { gp: 7 } }, flags: {} },
    { _id: "child", name: "Contents", type: "loot", system: { quantity: 3, container: "nested" }, flags: { custom: { note: "preserved" } } }
  ]);
  const deletes = [];
  for (const actor of [f.group, f.hero]) actor.deleteEmbeddedDocuments = async (type, ids) => {
    deletes.push({ actorId: actor.id, ids: [...ids] });
    for (const id of ids) await actor.items.get(id)?.delete();
  };
  return deletes;
}

function assertNativeTree(actor, rootId) {
  const root = actor.items.get(rootId), upgrade = actor.items.contents.find(item => item.name === "Upgrade");
  const bag = actor.items.contents.find(item => item.name === "Nested bag"), child = actor.items.contents.find(item => item.name === "Contents");
  assert.equal(root.flags["rebreya-main"].itemUpgrades.installed[0].itemId, upgrade.id);
  assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostItemId, root.id);
  assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostActorId, actor.id);
  assert.equal(bag.system.container, root.id); assert.equal(bag.system.currency.gp, 7);
  assert.equal(child.system.container, bag.id); assert.equal(child.system.quantity, 3);
  assert.equal(child.flags.custom.note, "preserved");
  assert.equal(root.flags["rebreya-main"].itemSourceUuid, "Item.original-root");
}

test("native owned tree take remaps nested contents and upgrades with one source batch", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    const deletes = await nativeTree(f);
    const request = { actorId: "hero", groupActorId: "g", quantity: 1, expectedSourceQuantity: 1, mutationId: "native-tree" };
    const result = await f.api.inventoryService.takeInventoryItemToCharacter("rope", request);
    assert.equal(f.group.items.contents.length, 0); assert.equal(f.hero.items.contents.length, 4);
    assert.equal(deletes.length, 1); assert.equal(deletes[0].ids.length, 4);
    assertNativeTree(f.hero, result.createdItemId);
    assert.deepEqual(await f.api.inventoryService.takeInventoryItemToCharacter("rope", request), result);
    assert.equal(f.hero.items.contents.length, 4);
  } finally { f.restore(); }
});

test("native owned tree import preserves ingress folder and history without journals", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f, f.hero);
    const request = { uuid: f.source.uuid, mutationId: "native-tree-import" };
    const options = { groupActorId: "g", folderId: "bag", quantity: 1, expectedSourceQuantity: 1 };
    const result = await f.api.inventoryService.importDroppedItem(request, options);
    assert.equal(f.hero.items.contents.length, 0); assert.equal(f.group.items.contents.length, 4);
    const rootId = result.rows[0].targetItemIds[0]; assertNativeTree(f.group, rootId);
    assert.equal(f.group.flags["rebreya-main"].inventoryFolders.itemFolderIds[rootId], "bag");
    assert.equal(f.group.items.get(rootId).getFlag("rebreya-main", "inventoryAcquisitionHistory").entries.length, 1);
    assert.deepEqual(await f.api.inventoryService.importDroppedItem(request, options), result);
  } finally { f.restore(); }
});

for (const phase of ["create", "delete"]) test(`native tree ${phase} rejection preserves source and cleans target`, async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f); f.failAt(phase, "before");
    await assert.rejects(f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g" }), /fault/);
    assert.equal(f.group.items.contents.length, 4); assert.equal(f.hero.items.contents.length, 0);
  } finally { f.restore(); }
});

test("native tree partial source deletion keeps complete target and reports failure", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f); f.failAt("delete", "after");
    await assert.rejects(f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g" }));
    assert.equal(f.group.items.contents.length, 3); assert.equal(f.hero.items.contents.length, 4);
  } finally { f.restore(); }
});

test("native tree take remaps installed weapon attachments", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f);
    f.source.flags["rebreya-main"].weaponMods = { version: 1, attachments: [{ itemId: "mod", sourceId: "scope", mountIds: ["top"] }], modernizedParts: [] };
    await f.group.createEmbeddedDocuments("Item", [{ _id: "mod", name: "Scope", type: "loot", system: { quantity: 1, container: "rope" }, flags: { "rebreya-main": {
      gearId: "scope", installedWeaponMod: { version: 1, kind: "weaponAttachment", hostItemId: "rope", hostActorId: "g", mountIds: ["top"] }
    } } }]);
    const result = await f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g" });
    assertNativeTree(f.hero, result.createdItemId);
    const root = f.hero.items.get(result.createdItemId), mod = f.hero.items.contents.find(item => item.name === "Scope");
    assert.equal(root.flags["rebreya-main"].weaponMods.attachments[0].itemId, mod.id);
    assert.equal(mod.flags["rebreya-main"].installedWeaponMod.hostItemId, root.id);
    assert.equal(mod.flags["rebreya-main"].installedWeaponMod.hostActorId, "hero");
  } finally { f.restore(); }
});

test("native tree import respects skip rule without touching either Actor", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f, f.hero);
    await f.api.inventoryService.createInventoryIngressRule({ groupActorId: "g", operationId: "tree-skip", expectedRevision: 0,
      rule: { id: "skip", name: "Skip", conditions: [{ field: "documentType", operator: "is", value: "equipment" }], action: { type: "skip" } } });
    const result = await f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", quantity: 1 });
    assert.equal(result.changed, false); assert.equal(f.group.items.contents.length, 0); assert.equal(f.hero.items.contents.length, 4);
  } finally { f.restore(); }
});

for (const direction of ["take", "import"]) {
  for (const failure of ["cancel-create", "partial-create", "cancel-delete", "partial-delete"]) {
    test(`native tree ${direction} handles ${failure} without silent item loss`, async () => {
      const f = nativeFixture({ quantity: 1 }); try {
        const source = direction === "take" ? f.group : f.hero, target = direction === "take" ? f.hero : f.group;
        await nativeTree(f, source);
        if (failure === "cancel-create") target.createEmbeddedDocuments = async () => [];
        if (failure === "partial-create") {
          const create = target.createEmbeddedDocuments.bind(target);
          target.createEmbeddedDocuments = async (type, rows) => { await create(type, rows.slice(0, 2)); throw new Error("partial create"); };
        }
        if (failure === "cancel-delete") source.deleteEmbeddedDocuments = async () => [];
        if (failure === "partial-delete") f.failAt("delete", "after");
        const operation = direction === "take"
          ? f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g" })
          : f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", quantity: 1 });
        await assert.rejects(operation);
        if (failure === "partial-delete") { assert.equal(source.items.contents.length, 3); assert.equal(target.items.contents.length, 4); }
        else { assert.equal(source.items.contents.length, 4); assert.equal(target.items.contents.length, 0); }
      } finally { f.restore(); }
    });
  }
  test(`native tree ${direction} rejects a partial or equipped root`, async () => {
    const f = nativeFixture({ quantity: 1 }); try {
      const source = direction === "take" ? f.group : f.hero;
      await nativeTree(f, source);
      const run = quantity => direction === "take"
        ? f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity, groupActorId: "g" })
        : f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", quantity });
      await assert.rejects(run(0.5));
      f.source.data.system.equipped = true; await assert.rejects(run(1));
      assert.equal(source.items.contents.length, 4);
    } finally { f.restore(); }
  });
}

test("native graph capability fallback retains existing GM request", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f); f.hero.canUserModify = () => false;
    const calls = []; f.api.socketCommandBus.request = async (command, payload) => { calls.push({ command, payload }); return { requested: true }; };
    assert.deepEqual(await f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g", mutationId: "fallback-tree" }), { requested: true });
    assert.equal(calls.length, 1); assert.equal(calls[0].payload.targetActorId, "hero"); assert.equal(f.group.items.contents.length, 4);
  } finally { f.restore(); }
});

test("native import never trusts a raw runtime graph flag on a loose Item", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    f.source.flags["rebreya-main"].runtimeItemGraph = captureRuntimeItemGraph(f.group, f.source);
    f.group.items.contents = []; f.source.parent = f.hero; f.hero.items.contents.push(f.source);
    await assert.rejects(f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", quantity: 1 }), error => error.code === "invalid-runtime-graph");
    assert.equal(f.hero.items.contents.length, 1); assert.equal(f.group.items.contents.length, 0);
  } finally { f.restore(); }
});

test("native graph import rechecks complete target after folder placement before source debit", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f, f.hero);
    const setFlag = f.group.setFlag.bind(f.group);
    f.group.setFlag = async (...args) => {
      const result = await setFlag(...args);
      const child = f.group.items.contents.find(item => item.name === "Contents"); if (child) await child.delete();
      return result;
    };
    await assert.rejects(f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", folderId: "bag", quantity: 1 }));
    assert.equal(f.hero.items.contents.length, 4); assert.equal(f.group.items.contents.length, 0);
  } finally { f.restore(); }
});

test("native graph rollback preserves a target changed by a subsequent action", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f);
    f.group.deleteEmbeddedDocuments = async () => {
      f.hero.items.contents[0].data.flags.custom = { laterEdit: "keep" }; return [];
    };
    await assert.rejects(f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 1, groupActorId: "g" }));
    assert.equal(f.group.items.contents.length, 4); assert.equal(f.hero.items.contents.length, 4);
    assert.equal(f.hero.items.contents[0].data.flags.custom.laterEdit, "keep");
  } finally { f.restore(); }
});

test("native graph canceled folder placement leaves source intact and removes target tree", async () => {
  const f = nativeFixture({ quantity: 1 }); try {
    await nativeTree(f, f.hero); f.group.setFlag = async () => undefined;
    await assert.rejects(f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid }, { groupActorId: "g", folderId: "bag", quantity: 1 }));
    assert.equal(f.hero.items.contents.length, 4); assert.equal(f.group.items.contents.length, 0);
  } finally { f.restore(); }
});

test("native owner edits quantity and removes Item without GM, journal or coordinator", async () => {
  const f = nativeFixture(); try {
    assert.equal(await f.api.inventoryService.updateItemQuantity("rope", 2.5, { groupActorId: "g", expectedSourceQuantity: 10 }), f.source);
    assert.equal(f.source.system.quantity, 2.5);
    await f.api.inventoryService.deleteItem("rope"); assert.equal(f.group.items.contents.length, 0);
  } finally { f.restore(); }
});

test("composition routes owned folder and quantity actions locally without active GM", async () => {
  const f = nativeFixture(); try {
    const api = new RebreyaMainModule(); api.inventoryService = f.api.inventoryService;
    api.socketCommandBus = f.api.socketCommandBus; api.refreshInventoryViews = async () => {};
    await api.createInventoryFolder({ groupActorId: "g", folderId: "new", name: "New", parentId: null });
    await api.executeItemQuantityMutation({ groupActorId: "g", itemId: "rope", nextQuantity: 4, expectedSourceQuantity: 10 });
    assert.equal(f.source.system.quantity, 4);
    assert.ok(f.group.getFlag("rebreya-main", "inventoryFolders").folders.some(folder => folder.id === "new"));
  } finally { f.restore(); }
});

test("native catalog material addition keeps logical quantity and acquisition history", async () => {
  const f = nativeFixture(); try {
    const result = await f.api.inventoryService.addModelItemToInventory("material", "iron", 0.125, { groupActorId: "g", batchMutationId: "catalog" });
    const target = f.group.items.get(result.rows[0].targetItemIds[0]);
    assert.equal(readInventoryItemQuantity(target.toObject()), 0.125);
    assert.equal(target.getFlag("rebreya-main", "inventoryAcquisitionHistory").entries.length, 1);
  } finally { f.restore(); }
});

test("native composition catalog addition uses the real ingress dispatcher without GM", async () => {
  const f = nativeFixture(); try {
    const api = new RebreyaMainModule(); api.inventoryService = f.api.inventoryService;
    api.inventoryIngressPlanner = f.api.inventoryIngressPlanner; api.socketCommandBus = f.api.socketCommandBus;
    api.refreshInventoryViews = async () => {};
    const result = await api.addModelItemToInventory("material", "iron", 0.5, { groupActorId: "g", batchMutationId: "ui-catalog" });
    assert.equal(readInventoryItemQuantity(f.group.items.get(result.rows[0].targetItemIds[0]).toObject()), 0.5);
  } finally { f.restore(); }
});

test("native compendium copy works without a source Actor", async () => {
  const f = nativeFixture(); try {
    f.source.parent = null; Object.defineProperty(f.source, "uuid", { value: "Compendium.test.Item.rope" });
    globalThis.fromUuid = async () => f.source; f.group.items.contents = [];
    const result = await f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid, mutationId: "copy" }, { groupActorId: "g", quantity: 2 });
    assert.equal(f.group.items.get(result.rows[0].targetItemIds[0]).system.quantity, 2);
  } finally { f.restore(); }
});

test("native import dismantle rule uses canonical output calculation and spends selected source", async () => {
  const f = nativeFixture(); try {
    f.source.data.flags["rebreya-main"].predominantMaterialId = "iron";
    f.source.data.system.weight = { value: 3, units: "lb" };
    f.group.items.contents = []; f.source.parent = f.hero; f.hero.items.contents.push(f.source);
    const expected = resolveInventoryDismantleOutputs(f.source.toObject(), 2, { model: f.model })[0];
    assert.ok(expected);
    await f.api.inventoryService.createInventoryIngressRule({ groupActorId: "g", operationId: "dismantle-rule", expectedRevision: 0,
      rule: { id: "dismantle", name: "Dismantle", conditions: [{ field: "documentType", operator: "is", value: "equipment" }], action: { type: "dismantle" } } });
    const result = await f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid, mutationId: "dismantle-import" }, { groupActorId: "g", quantity: 2, expectedSourceQuantity: 10 });
    assert.equal(f.source.system.quantity, 8);
    const target = f.group.items.get(result.rows[0].targetItemIds[0]);
    assert.equal(readInventoryItemQuantity(target.toObject()), expected.quantity);
    assert.equal(target.getFlag("rebreya-main", "sourceId"), "iron");
  } finally { f.restore(); }
});

test("native quantity composition entry works without active GM", async () => {
  const f = nativeFixture(); try {
    const result = await f.api.inventoryService.executeItemQuantityMutation({ groupActorId: "g", itemId: "rope", nextQuantity: 4, expectedSourceQuantity: 10 });
    assert.equal(result.quantity, 4); assert.equal(f.source.system.quantity, 4);
  } finally { f.restore(); }
});

for (const action of [{ type: "skip" }, { type: "folder", folderId: "bag" }]) {
  test(`native imported stack applies ${action.type} ingress rule and acquisition history`, async () => {
    const f = nativeFixture(); try {
      f.group.items.contents = []; f.source.parent = f.hero; f.hero.items.contents.push(f.source);
      await f.api.inventoryService.createInventoryIngressRule({ groupActorId: "g", operationId: "rule", expectedRevision: 0,
        rule: { id: "rule", name: "Equipment", conditions: [{ field: "documentType", operator: "is", value: "equipment" }], action } });
      const result = await f.api.inventoryService.importDroppedItem({ uuid: f.source.uuid, mutationId: "import-rule" },
        { groupActorId: "g", quantity: 2.5, expectedSourceQuantity: 10 });
      if (action.type === "skip") { assert.equal(result.changed, false); assert.equal(f.source.system.quantity, 10); assert.equal(f.group.items.contents.length, 0); }
      else {
        assert.equal(f.source.system.quantity, 7.5); const target = f.group.items.contents[0]; assert.equal(target.system.quantity, 2.5);
        assert.equal(f.group.getFlag("rebreya-main", "inventoryFolders").itemFolderIds[target.id], "bag");
        assert.equal(target.getFlag("rebreya-main", "inventoryAcquisitionHistory").entries.length, 1);
      }
    } finally { f.restore(); }
  });
}

test("native material take preserves tiny logical units, weight and price", async () => {
  const f = nativeFixture(); try {
    f.source.data.flags["rebreya-main"].sourceType = "material"; f.source.data.flags["rebreya-main"].sourceId = "iron";
    f.source.data.system.weight = { value: 2, units: "lb" }; f.source.data.system.price = { value: 3, denomination: "gp" };
    f.source.data = withInventoryItemQuantity(f.source.data, 0.000000000005);
    await f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 0.000000000002, groupActorId: "g" });
    assert.equal(readInventoryItemQuantity(f.source.toObject()), 0.000000000003);
    assert.equal(readInventoryItemQuantity(f.hero.items.contents[0].toObject()), 0.000000000002);
  } finally { f.restore(); }
});

test("native sale rollback restores currency after a rejected debit", async () => {
  const f = nativeFixture(); try {
    f.source.data.system.price = { value: 2, denomination: "gp" }; f.failAt("debit", "before");
    await assert.rejects(f.api.inventoryService.sellInventoryItem("rope", 2), /fault debit/);
    assert.equal(f.source.system.quantity, 10); assert.equal(f.group.system.currency.gp, 0);
  } finally { f.restore(); }
});

test("native canceled target creation leaves source stock untouched", async () => {
  const f = nativeFixture(); try {
    f.hero.createEmbeddedDocuments = async () => [];
    await assert.rejects(f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 2, groupActorId: "g" }));
    assert.equal(f.source.system.quantity, 10); assert.equal(f.hero.items.contents.length, 0);
  } finally { f.restore(); }
});

test("native canceled sale currency credit leaves source stock untouched", async () => {
  const f = nativeFixture(); try {
    f.source.data.system.price = { value: 2, denomination: "gp" };
    f.group.update = async () => undefined;
    await assert.rejects(f.api.inventoryService.sellInventoryItem("rope", 2));
    assert.equal(f.source.system.quantity, 10); assert.equal(f.group.system.currency.gp, 0);
  } finally { f.restore(); }
});

test("native manual dismantle preserves canonical output and source-folder routing", async () => {
  const f = nativeFixture(); try {
    f.model.materialById.get("iron").weight = 2;
    const added = await f.api.inventoryService.addModelItemToInventory("material", "iron", 1, { groupActorId: "g", batchMutationId: "root-iron" });
    const rootIron = f.group.items.get(added.rows[0].targetItemIds[0]);
    f.source.data.flags["rebreya-main"].predominantMaterialId = "iron";
    f.source.data.system.weight = { value: 3, units: "lb" };
    f.group.flags["rebreya-main"].inventoryFolders.itemFolderIds.rope = "bag";
    const expected = resolveInventoryDismantleOutputs(f.source.toObject(), 2, { model: f.model })[0];
    const result = await f.api.inventoryService.breakItemToMaterial("rope", 2, { mutationId: "manual-dismantle" });
    assert.equal(f.source.system.quantity, 8); assert.equal(result.breakQuantity, 2);
    const target = f.group.items.contents.find(item => item !== f.source && item !== rootIron);
    assert.equal(readInventoryItemQuantity(rootIron.toObject()), 1);
    assert.ok(target, "dismantle output must remain in the source folder");
    assert.equal(readInventoryItemQuantity(target.toObject()), expected.quantity);
    assert.equal(f.group.flags["rebreya-main"].inventoryFolders.itemFolderIds[target.id], "bag");
    assert.equal(result.materialWeight, 3, "result reports physical pounds, not material units");
  } finally { f.restore(); }
});

test("native folder sale uses the same direct warehouse sale", async () => {
  const f = nativeFixture(); try {
    f.source.data.system.price = { value: 2, denomination: "gp" };
    f.group.flags["rebreya-main"].inventoryFolders.itemFolderIds.rope = "bag";
    const result = await f.api.inventoryService.executeInventoryFolderBatch({ groupActorId: "g", folderId: "bag", action: "sell", includeDescendants: false, operationId: "folder-sale" });
    assert.equal(result.failed.length, 0); assert.equal(result.processed.length, 1);
    assert.equal(f.group.items.contents.length, 0); assert.equal(f.group.system.currency.pp * 10 + f.group.system.currency.gp, 10);
  } finally { f.restore(); }
});

test("native take rejects partial independent state before creating a target", async () => {
  const f = nativeFixture(); try {
    f.source.data.effects = [{ _id: "effect" }];
    await assert.rejects(f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", quantity: 2, groupActorId: "g" }), /индивидуальным состоянием/);
    assert.equal(f.hero.items.contents.length, 0); assert.equal(f.source.system.quantity, 10);
  } finally { f.restore(); }
});

test("native direct coin grant uses existing denominations without journal or queue", async () => {
  const f = nativeFixture(); try {
    await f.api.inventoryService.addCurrencyToInventoryOnce({ gp: 2, sp: 5 }, "manual-coins", { groupActorId: "g", native: true });
    assert.equal(f.group.system.currency.gp, 2); assert.equal(f.group.system.currency.sp, 5);
  } finally { f.restore(); }
});

test("native ingress rule repeats share their original outcome", async () => {
  const f = nativeFixture(); try {
    const request = { groupActorId: "g", operationId: "rule-repeat", expectedRevision: 0,
      rule: { id: "skip", name: "Skip", conditions: [{ field: "documentType", operator: "is", value: "equipment" }], action: { type: "skip" } } };
    const first = await f.api.inventoryService.createInventoryIngressRule(request);
    assert.deepEqual(await f.api.inventoryService.createInventoryIngressRule(request), first);
    assert.equal((await f.api.inventoryService.getInventoryIngressRuleState({ groupActorId: "g" })).revision, 1);
  } finally { f.restore(); }
});

test("native owner changes and converts group currency without GM", async () => {
  const f = nativeFixture(); try {
    await f.api.inventoryService.updateCurrency({ gp: 2, sp: 5 });
    assert.equal(f.group.system.currency.gp, 2); assert.equal(f.group.system.currency.sp, 5);
    await f.api.inventoryService.convertCurrency("normalized");
    assert.equal(f.group.system.currency.gp * 100 + f.group.system.currency.sp * 10 + f.group.system.currency.cp, 250);
  } finally { f.restore(); }
});

test("native owner folder CRUD and partial movement use existing rules without locks or journal", async () => {
  const f = nativeFixture(); try {
    await f.api.inventoryService.createInventoryFolder({ groupActorId: "g", folderId: "new", name: "New" });
    await f.api.inventoryService.renameInventoryFolder({ groupActorId: "g", folderId: "new", name: "Renamed" });
    const result = await f.api.inventoryService.moveInventoryItemToFolder({ groupActorId: "g", itemId: "rope", folderId: "new", quantity: 3, expectedSourceQuantity: 10, operationId: "native-split" });
    assert.equal(f.source.system.quantity, 7); assert.equal(f.group.items.get(result.itemId).system.quantity, 3);
    assert.equal(f.group.getFlag("rebreya-main", "inventoryFolders").itemFolderIds[result.itemId], "new");
    assert.equal(f.total(), 10);
    const replay = await f.api.inventoryService.moveInventoryItemToFolder({ groupActorId: "g", itemId: "rope", folderId: "new", quantity: 3, expectedSourceQuantity: 10, operationId: "native-split" });
    assert.equal(replay.itemId, result.itemId); assert.equal(f.source.system.quantity, 7); assert.equal(f.total(), 10);
  } finally { f.restore(); }
});

test("native owner sale preserves warehouse quote and credits currency without GM", async () => {
  const f = nativeFixture(); try {
    f.source.data.system.price = { value: 2, denomination: "gp" };
    const result = await f.api.inventoryService.sellInventoryItem("rope", 2, { mutationId: "native-sale" });
    assert.equal(result.gainedCopper, 200); assert.equal(f.source.system.quantity, 8);
    assert.equal(f.group.system.currency.gp, 2);
  } finally { f.restore(); }
});

test("native owner takes a selected stack to an owned group member without GM", async () => {
  const f = nativeFixture(); try {
    const result = await f.api.inventoryService.takeInventoryItemToCharacter("rope", { actorId: "hero", groupActorId: "g", quantity: 3, expectedSourceQuantity: 10, mutationId: "native-take" });
    assert.equal(f.source.system.quantity, 7); assert.equal(f.hero.items.contents.length, 1);
    assert.equal(f.hero.items.contents[0].system.quantity, 3); assert.equal(result.quantity, 3);
  } finally { f.restore(); }
});
