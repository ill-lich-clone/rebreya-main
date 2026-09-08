import test from "node:test";
import assert from "node:assert/strict";
import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";

import { MODULE_ID } from "../scripts/constants.js";
import { buildStorageContainerRow } from "../scripts/data/storage-container-snapshot.js";
import {
  StorageContainerItemService,
  buildStorageContainerSnapshotFromToken
} from "../scripts/data/storage-container-item-service.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function createActor() {
  let sequence = 0;
  const contents = [];
  const actor = {
    id: "hero",
    uuid: "Actor.hero",
    type: "character",
    items: {
      contents,
      get(id) { return contents.find((item) => item.id === id) ?? null; },
      [Symbol.iterator]() { return contents[Symbol.iterator](); }
    },
    async createEmbeddedDocuments(_type, documents) {
      return documents.map((source) => {
        const data = clone(source);
        const item = {
          ...data,
          id: data._id || `item-${++sequence}`,
          parent: actor,
          documentName: "Item",
          get uuid() { return `${actor.uuid}.Item.${this.id}`; },
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          toObject() {
            const { parent: _parent, getFlag: _getFlag, toObject: _toObject, update: _update, ...plain } = this;
            return clone(plain);
          },
          async update(patch) {
            for (const [path, value] of Object.entries(patch)) {
              const parts = path.split(".");
              let cursor = this;
              for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
              cursor[parts.at(-1)] = clone(value);
            }
          }
        };
        contents.push(item);
        return item;
      });
    },
    async deleteEmbeddedDocuments(_type, ids) {
      for (const id of ids) {
        const index = contents.findIndex((item) => item.id === id);
        if (index >= 0) contents.splice(index, 1);
      }
      return ids;
    }
  };
  return actor;
}

function bagSnapshot() {
  const pouch = {
    containerId: "pouch-1",
    storageKind: "bag",
    name: "Кошель",
    img: "icons/pouch.webp",
    state: {
      baseName: "Кошель",
      state: "opened",
      manualRows: [{
        rowId: "gem-row",
        name: "Самоцвет",
        img: "icons/gem.webp",
        quantity: 2,
        itemData: { name: "Самоцвет", type: "loot", img: "icons/gem.webp", system: { quantity: 2 } }
      }],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  };
  return {
    containerId: "bag-1",
    storageKind: "bag",
    name: "Сумка хранения",
    img: "icons/bag.webp",
    state: {
      baseName: "Сумка хранения",
      state: "opened",
      manualRows: [
        {
          rowId: "rope-row",
          name: "Верёвка",
          img: "icons/rope.webp",
          quantity: 3,
          itemData: { name: "Верёвка", type: "loot", img: "icons/rope.webp", system: { quantity: 3 } }
        },
        buildStorageContainerRow(pouch, { rowId: "pouch-row" })
      ],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    },
    presentation: { actorId: "storage-actor" }
  };
}

function durableOptions() {
  let state = {version:1,records:[]};
  const journal = new DurableMutationJournal({readState:()=>clone(state),writeState:next=>{state=clone(next);}});
  return {journal};
}

test("durable container grant records the complete plan before writes and resumes a partial batch after restart", async () => {
  const actor=createActor(), options=durableOptions(), snapshot=bagSnapshot();
  const create=actor.createEmbeddedDocuments.bind(actor);let calls=0;
  actor.createEmbeddedDocuments=async(type,documents,opts)=>{
    calls++;
    const pending=await options.journal.listPending();
    assert.equal(pending.length,1);assert.equal(pending[0].expectedItemIds.length,4);
    if(calls===1){await create(type,documents.slice(0,2),opts);throw new Error("partial write");}
    assert.equal(documents.length,2);return create(type,documents,opts);
  };
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-partial"));
  assert.equal(actor.items.contents.length,2);
  const root=await new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-partial");
  assert.equal(actor.items.contents.length,4);assert.equal(root.type,"container");
  assert.equal((await options.journal.listPending()).length,0);
  await root.update({name:"Renamed after grant"});
  assert.equal((await new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-partial")).name,"Renamed after grant");
  assert.equal(calls,2);
});

test("durable container receipt binds destination and snapshot and never resurrects a deleted terminal root",async()=>{
  const actor=createActor(),options=durableOptions(),snapshot=bagSnapshot(),service=new StorageContainerItemService(options);
  const root=await service.materializeToActorOnce(actor,snapshot,"durable-terminal");
  await assert.rejects(service.materializeToActorOnce(actor,{...snapshot,name:"different"},"durable-terminal"),e=>e.code==="storage-container-manual-review");
  await assert.rejects(service.materializeToActorOnce(actor,snapshot,"durable-terminal",{parentContainerId:"other"}),e=>e.code==="storage-container-manual-review");
  await actor.deleteEmbeddedDocuments("Item",[root.id]);
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-terminal"),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,3);
});

test("enabling durable storage never duplicates a pre-existing legacy mutation root",async()=>{
  const actor=createActor(),snapshot=bagSnapshot();
  await new StorageContainerItemService().materializeToActorOnce(actor,snapshot,"legacy-grant");
  await assert.rejects(new StorageContainerItemService(durableOptions()).materializeToActorOnce(actor,snapshot,"legacy-grant"),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,4);
});

test("partial container conflicts preserve changed children and durable receipt",async()=>{
  const actor=createActor(),options=durableOptions(),snapshot=bagSnapshot(),create=actor.createEmbeddedDocuments.bind(actor);
  actor.createEmbeddedDocuments=async(type,documents,opts)=>{await create(type,documents.slice(0,2),opts);throw new Error("partial");};
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-conflict"));
  await actor.items.contents[1].update({"system.quantity":99});
  actor.createEmbeddedDocuments=()=>{throw new Error("must not write");};
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"durable-conflict"),e=>e.code==="graph-manual-review");
  assert.equal(actor.items.contents.length,2);assert.equal(actor.items.contents[1].system.quantity,99);
  assert.equal((await options.journal.listPending()).length,1);
});

test("pending container source cannot be granted under another ID and observed partial Items cannot be resurrected",async()=>{
  const actor=createActor(),options=durableOptions(),snapshot=bagSnapshot(),create=actor.createEmbeddedDocuments.bind(actor);
  actor.createEmbeddedDocuments=async(type,documents,opts)=>{await create(type,documents.slice(0,2),opts);throw new Error("partial");};
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"reserved-first"));
  actor.createEmbeddedDocuments=()=>{throw new Error("no further writes");};
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"reserved-second"),e=>e.code==="storage-container-manual-review");
  await actor.deleteEmbeddedDocuments("Item",[actor.items.contents[1].id]);
  await assert.rejects(new StorageContainerItemService(options).materializeToActorOnce(actor,snapshot,"reserved-first"),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,1);
});

test("durable container grant keeps an external destination parent and handles lost complete-write acknowledgement",async()=>{
  const actor=createActor(),options=durableOptions(),create=actor.createEmbeddedDocuments.bind(actor);
  await create("Item",[{_id:"parent",name:"Parent",type:"container",system:{quantity:1}}]);
  actor.createEmbeddedDocuments=async(type,documents,opts)=>{await create(type,documents,opts);throw new Error("lost acknowledgement");};
  const root=await new StorageContainerItemService(options).materializeToActorOnce(actor,bagSnapshot(),"durable-parent",{parentContainerId:"parent"});
  assert.equal(root.system.container,"parent");assert.equal(actor.items.contents.length,5);
  assert.equal((await options.journal.listPending()).length,0);
});

const composition=(id,sourceId,upgrades=[])=>({version:2,instanceKey:id,sourceType:"gear",sourceId,isBroken:false,upgrades});
function catalogTreeOptions() {
  let sequence=0;
  return {...durableOptions(),createDocumentId:()=>String(++sequence).padStart(16,"0"),
    getManifest:async()=>[{productId:"zacharovanie-ostroty",profile:{compatibility:["weapon"]},decision:"simple-implemented"}],
    buildItemData:async row=>({name:`Catalog ${row.sourceId}`,type:row.sourceId==="sword"?"weapon":"container",
      system:{quantity:1,price:{value:12,denomination:"gp"},capacity:{weight:{value:300,units:"lb"}},weight:{value:25,units:"lb"}},
      flags:{[MODULE_ID]:{gearId:row.sourceId}}})};
}
function catalogTreeSnapshot() {
  const snapshot=bagSnapshot();snapshot.state.lootgenComposition=composition("shell","chest");
  snapshot.state.manualCoins={gp:3};
  snapshot.state.manualRows[0]={rowId:"sword-row",name:"Sword",quantity:1,
    composition:composition("sword-instance","sword",[{instanceKey:"sharp-instance",sourceId:"zacharovanie-ostroty",slotIndex:1,choices:{}}])};
  return snapshot;
}

test("canonical container planner preserves catalog shell and child upgrades in one bounded graph",async()=>{
  const options=catalogTreeOptions(),snapshot=catalogTreeSnapshot(),service=new StorageContainerItemService(options);
  const graph=await service.prepareItemGraph(snapshot,{actorId:"hero"});
  assert.equal(graph.nodes.length,5);assert.equal(new Set(graph.nodes.map(d=>d._id)).size,5);
  const root=graph.nodes[0],sword=graph.nodes.find(d=>d.name==="Catalog sword"),upgrade=graph.nodes.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  assert.equal(root.type,"container");assert.equal(root.system.price.value,12);assert.equal(root.system.capacity.weight.value,300);
  assert.equal(root.system.currency.gp,3);assert.equal(root.flags[MODULE_ID].gearId,"chest");
  assert.equal(sword.system.container,root._id);assert.equal(upgrade.system.container,sword._id);
  assert.equal(sword.flags[MODULE_ID].itemUpgrades.installed[0].itemId,upgrade._id);
  assert.equal(upgrade.flags[MODULE_ID].installedUpgrade.hostActorId,"hero");
  assert.equal(sword.flags[MODULE_ID].storageContainerMember.composition.sourceId,"sword");
  assert.equal(snapshot.state.manualRows[0].itemData,undefined);
  const actor=createActor();const granted=await service.materializeToActorOnce(actor,snapshot,"catalog-tree");
  assert.equal(actor.items.contents.length,5);assert.equal(granted.system.price.value,12);
  const liveSword=actor.items.contents.find(d=>d.name==="Catalog sword"),liveUpgrade=actor.items.contents.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  assert.equal(liveUpgrade.system.container,liveSword.id);assert.equal(liveUpgrade.flags[MODULE_ID].installedUpgrade.hostItemId,liveSword.id);
});

test("container planner rejects duplicate composition identities, cycles and the 200-document limit before writes",async()=>{
  const service=new StorageContainerItemService(catalogTreeOptions());
  const duplicate=catalogTreeSnapshot();duplicate.state.manualRows.push(clone(duplicate.state.manualRows[0]));
  await assert.rejects(service.prepareItemGraph(duplicate));
  const cycle=bagSnapshot();cycle.state.manualRows.push({rowKind:"container",rowId:"cycle",container:cycle});
  await assert.rejects(service.prepareItemGraph(cycle));
  const large=bagSnapshot();large.state.manualRows=Array.from({length:200},(_,i)=>({rowId:`r${i}`,quantity:1,itemData:{name:"plain",type:"loot",system:{quantity:1}}}));
  await assert.rejects(service.prepareItemGraph(large),e=>e.code==="storage-container-manual-review");
});

test("capture and restore retain live upgraded items and catalog shell without restoring extracted contents",async()=>{
  const actor=createActor(),options=catalogTreeOptions(),service=new StorageContainerItemService(options);
  const root=await service.materializeToActorOnce(actor,catalogTreeSnapshot(),"capture-catalog");
  const sword=actor.items.contents.find(d=>d.name==="Catalog sword"),upgrade=actor.items.contents.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  await sword.update({name:"Renamed sword","system.customField":"keep",effects:[{name:"Custom live effect"}]});
  await root.update({"system.currency":{pp:0,gp:2,ep:1,sp:0,cp:0}});
  const pouch=actor.items.contents.find(d=>d.name==="Кошель");
  await pouch.update({"system.container":null});
  const snapshot=await service.captureFromItem(root);
  assert.equal(snapshot.state.manualRows.length,1);
  assert.equal(snapshot.state.manualRows[0].composition.sourceId,"sword");
  assert.equal(snapshot.state.manualRows[0].composition.upgrades.length,1);
  assert.deepEqual(snapshot.state.manualCoins,{pp:0,gp:2,sp:5,cp:0});
  const destination=createActor();destination.id="other";destination.uuid="Actor.other";
  options.buildItemData=()=>{throw new Error("captured live data must not be rebuilt from catalog");};
  const restored=await new StorageContainerItemService(options).materializeToActorOnce(destination,snapshot,"restore-catalog");
  assert.equal(destination.items.contents.length,3);assert.equal(restored.system.price.value,12);
  const restoredSword=destination.items.contents.find(d=>d.name==="Renamed sword"),restoredUpgrade=destination.items.contents.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  assert.equal(restoredSword.system.customField,"keep");assert.equal(restoredSword.effects[0].name,"Custom live effect");
  assert.equal(restoredUpgrade.system.container,restoredSword.id);
  assert.equal(restoredUpgrade.flags[MODULE_ID].installedUpgrade.hostActorId,"other");
  assert.notEqual(restoredUpgrade.id,upgrade.id);
});

test("capture folds shell upgrades into shell data and removes detached upgrades from composition",async()=>{
  const actor=createActor(),options=catalogTreeOptions(),service=new StorageContainerItemService(options);
  const root=await service.materializeToActorOnce(actor,catalogTreeSnapshot(),"capture-detach");
  const sword=actor.items.contents.find(d=>d.name==="Catalog sword"),upgrade=actor.items.contents.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  await sword.update({"flags.rebreya-main.itemUpgrades.installed":[]});
  await upgrade.update({"system.container":null,"flags.rebreya-main.installedUpgrade":null});
  let snapshot=await service.captureFromItem(root);
  assert.deepEqual(snapshot.state.manualRows.find(r=>r.composition?.sourceId==="sword").composition.upgrades,[]);
  await root.update({"flags.rebreya-main.itemUpgrades":{category:"armor",capacity:1,installed:[{itemId:upgrade.id,slotIndex:1}]}});
  await upgrade.update({"system.container":root.id,"flags.rebreya-main.installedUpgrade":{hostActorId:actor.id,hostItemId:root.id,slotIndex:1,category:"armor"}});
  snapshot=await service.captureFromItem(root);
  assert.equal(snapshot.state.manualRows.length,2);
  assert.equal(snapshot.presentation.itemData.flags[MODULE_ID].runtimeItemGraph.nodes.length,2);
  assert.equal(snapshot.state.lootgenComposition.upgrades.length,1);
});

test("capture rejects broken installed links before removing any physical item",async()=>{
  const actor=createActor(),service=new StorageContainerItemService(catalogTreeOptions());
  const root=await service.materializeToActorOnce(actor,catalogTreeSnapshot(),"capture-conflict");
  const upgrade=actor.items.contents.find(d=>d.flags?.[MODULE_ID]?.installedUpgrade);
  await upgrade.update({"system.container":null});
  await assert.rejects(service.removeItemTree(root),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,5);
});

test("capture refuses lossy stacked hosts and unrepresented ordinary-host descendants before deletion",async()=>{
  const actor=createActor(),service=new StorageContainerItemService(catalogTreeOptions());
  const root=await service.materializeToActorOnce(actor,catalogTreeSnapshot(),"invalid-live-host");
  const sword=actor.items.contents.find(d=>d.name==="Catalog sword");
  await sword.update({"system.quantity":2});
  await assert.rejects(service.removeItemTree(root),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,5);
  await sword.update({"system.quantity":1});
  await actor.createEmbeddedDocuments("Item",[{_id:"unexpected-child",name:"Extra",type:"loot",system:{quantity:1,container:sword.id}}]);
  await assert.rejects(service.removeItemTree(root),e=>e.code==="storage-container-manual-review");
  assert.equal(actor.items.contents.length,6);
});

test("portable storage materializes as native dnd5e container hierarchy and captures live quantities", async () => {
  const actor = createActor();
  const service = new StorageContainerItemService();
  const root = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-1");

  assert.equal(root.type, "container");
  assert.equal(root.system.quantity, 1);
  assert.equal(actor.items.contents.length, 4);
  const rope = actor.items.contents.find((item) => item.name === "Верёвка");
  const pouch = actor.items.contents.find((item) => item.name === "Кошель");
  const gem = actor.items.contents.find((item) => item.name === "Самоцвет");
  assert.equal(rope.system.container, root.id);
  assert.equal(pouch.type, "container");
  assert.equal(pouch.system.container, root.id);
  assert.equal(gem.system.container, pouch.id);

  await rope.update({ "system.quantity": 1 });
  const captured = await service.captureFromItem(root);
  assert.equal(captured.state.manualRows.find((row) => row.name === "Верёвка").quantity, 1);
  assert.equal(captured.state.manualRows.find((row) => row.name === "Кошель").container.state.manualRows[0].quantity, 2);

  const repeated = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-1");
  assert.equal(repeated.id, root.id);
  assert.equal(actor.items.contents.length, 4);
});

test("portable storage creates its complete item tree in one actor batch", async () => {
  const actor = createActor();
  const originalCreate = actor.createEmbeddedDocuments.bind(actor);
  const calls = [];
  actor.createEmbeddedDocuments = async (type, documents, options) => {
    calls.push({ type, documents: clone(documents), options: clone(options) });
    return originalCreate(type, documents, options);
  };

  const root = await new StorageContainerItemService().materializeToActorOnce(
    actor,
    bagSnapshot(),
    "single-batch"
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "Item");
  assert.equal(calls[0].documents.length, 4);
  assert.equal(calls[0].options.keepId, true);
  assert.equal(actor.items.contents.length, 4);
  assert.equal(actor.items.contents.find((item) => item.name === "Верёвка").system.container, root.id);
});

test("portable storage materializes only Items and keeps Journal references in its snapshot", async () => {
  const actor = createActor();
  const originalCreate = actor.createEmbeddedDocuments.bind(actor);
  const calls = [];
  actor.createEmbeddedDocuments = async (type, documents, options) => {
    calls.push({ type, documents: clone(documents), options: clone(options) });
    return originalCreate(type, documents, options);
  };
  const snapshot = {
    containerId: "journal-bag",
    storageKind: "bag",
    name: "Сумка",
    img: "icons/bag.webp",
    state: {
      baseName: "Сумка",
      state: "opened",
      manualRows: [
        {
          rowId: "rope-row",
          name: "Верёвка",
          img: "icons/rope.webp",
          quantity: 2,
          itemData: { name: "Верёвка", type: "loot", img: "icons/rope.webp", system: { quantity: 2 } }
        },
        {
          rowKind: "journal",
          rowId: "journal-row",
          sourceId: "JournalEntry.secret-notes",
          sourceType: "journal",
          name: "Полевые заметки",
          img: "icons/book.webp",
          quantity: 1
        }
      ],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  };

  const root = await new StorageContainerItemService().materializeToActorOnce(actor, snapshot, "journal-row");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].documents.length, 2);
  assert.deepEqual(calls[0].documents.map((item) => item.name).sort(), ["Верёвка", "Сумка"]);
  const captured = await new StorageContainerItemService().captureFromItem(root);
  assert.deepEqual(captured.state.manualRows.find((row) => row.rowId === "journal-row"), {
    rowKind: "journal",
    rowId: "journal-row",
    stackKey: "",
    sourceId: "JournalEntry.secret-notes",
    sourceType: "journal",
    sourceDocumentName: "JournalEntry",
    name: "Полевые заметки",
    img: "icons/book.webp",
    quantity: 1
  });
});

test("capturing an unopened portable container resets generated Journal references into deduplicated manual rows", async () => {
  const actor = createActor();
  const journal = (rowId, sourceId, name) => ({
    rowKind: "journal",
    rowId,
    sourceId,
    sourceType: "journal",
    name,
    img: "icons/book.webp",
    quantity: 1
  });
  const root = await new StorageContainerItemService().materializeToActorOnce(actor, {
    containerId: "unopened-journal-bag",
    storageKind: "bag",
    name: "Unopened bag",
    state: {
      baseName: "Unopened bag",
      state: "unopened",
      manualRows: [journal("manual-journal", "JournalEntry.manual", "Manual journal")],
      generatedRows: [
        journal("generated-journal", "JournalEntry.generated", "Generated journal"),
        journal("manual-journal", "JournalEntry.duplicate", "Duplicate journal")
      ],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  }, "unopened-journal-capture");

  const captured = await new StorageContainerItemService().captureFromItem(root);

  assert.equal(captured.state.state, "unopened");
  assert.deepEqual(captured.state.manualRows.map((row) => row.rowId), ["manual-journal", "generated-journal"]);
  assert.equal(captured.state.manualRows[0].sourceId, "JournalEntry.manual");
  assert.deepEqual(captured.state.generatedRows, []);
});

test("removing and restoring a portable container moves its entire item tree", async () => {
  const actor = createActor();
  const service = new StorageContainerItemService();
  const root = await service.materializeToActorOnce(actor, bagSnapshot(), "grant-remove");

  const receipt = await service.removeItemTree(root);
  assert.equal(actor.items.contents.length, 0);
  assert.equal(receipt.snapshot.containerId, "bag-1");

  const restored = await service.restoreItemTree(receipt);
  assert.equal(restored.type, "container");
  assert.equal(actor.items.contents.length, 4);
});

test("an ordinary native dnd5e container is captured with all of its live contents", async () => {
  const actor = createActor();
  const [bag] = await actor.createEmbeddedDocuments("Item", [{
    name: "Походный рюкзак",
    type: "container",
    img: "icons/backpack.webp",
    system: {
      quantity: 1,
      container: null,
      type: { value: "backpack" },
      currency: { gp: 3 }
    },
    flags: {}
  }]);
  await actor.createEmbeddedDocuments("Item", [{
    name: "Факел",
    type: "consumable",
    img: "icons/torch.webp",
    system: { quantity: 4, container: bag.id },
    flags: {}
  }]);

  const snapshot = await new StorageContainerItemService().captureFromItem(bag);

  assert.equal(snapshot.storageKind, "bag");
  assert.equal(snapshot.name, "Походный рюкзак");
  assert.equal(snapshot.state.manualRows.length, 1);
  assert.equal(snapshot.state.manualRows[0].name, "Факел");
  assert.equal(snapshot.state.manualRows[0].quantity, 4);
  assert.equal(snapshot.state.manualCoins.gp, 3);
});

test("scene storage snapshots preserve actor and token presentation", () => {
  const token = {
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    name: "Сундук",
    actor: { id: "storage-actor" },
    texture: { src: "modules/rebreya-main/assets/chests/open.webp", scaleX: 1.2, scaleY: 1.2 },
    width: 1,
    height: 1,
    disposition: 0,
    flags: {
      [MODULE_ID]: {
        storage: {
          containerId: "chest-1",
          storageKind: "chest",
          baseName: "Сундук",
          state: "opened",
          manualRows: [],
          generatedRows: []
        }
      }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };

  const snapshot = buildStorageContainerSnapshotFromToken(token);
  assert.equal(snapshot.containerId, "chest-1");
  assert.equal(snapshot.presentation.actorId, "storage-actor");
  assert.equal(snapshot.presentation.tokenData.texture.scaleX, 1.2);
  assert.equal(snapshot.img, token.texture.src);
});

test("portable container restores to a scene token once with the same storage state", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(type, documents) {
      created.push({ type, documents: clone(documents) });
      const token = {
        ...clone(documents[0]),
        id: "restored-token",
        getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
      };
      this.tokens.contents.push(token);
      return [token];
    }
  };
  const actor = {
    id: "storage-actor",
    async getTokenDocument() {
      return { toObject: () => ({
        actorId: this.id,
        texture: { src: "prototype.webp" },
        width: 1,
        height: 1,
        sight: { enabled: true, range: 30 }
      }) };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: (id) => id === scene.id ? scene : null,
    resolveActor: (id) => id === actor.id ? actor : null
  });

  const snapshot = bagSnapshot();
  snapshot.presentation.tokenData = { sight: { enabled: true, range: 60 } };
  const first = await service.restoreSnapshotToScene(snapshot, {
    sceneId: scene.id,
    x: 100,
    y: 200,
    mutationId: "scene-restore"
  });
  const second = await service.restoreSnapshotToScene(snapshot, {
    sceneId: scene.id,
    x: 999,
    y: 999,
    mutationId: "scene-restore"
  });

  assert.equal(first.id, second.id);
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "Token");
  assert.equal(created[0].documents[0].x, 100);
  assert.equal(created[0].documents[0].y, 200);
  assert.deepEqual(created[0].documents[0].sight, { enabled: false, range: 60 });
  assert.equal(created[0].documents[0].flags[MODULE_ID].storage.containerId, "bag-1");
  assert.equal(created[0].documents[0].flags[MODULE_ID].storageContainerMutation.id, "scene-restore");
});

test("a player who drops a container owns its synthetic scene actor", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "owned-container" }];
    }
  };
  const actor = {
    id: "storage-actor",
    async getTokenDocument() {
      return { toObject: () => ({ actorId: this.id, width: 1, height: 1 }) };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => actor
  });

  await service.restoreSnapshotToScene(bagSnapshot(), {
    sceneId: "scene",
    x: 100,
    y: 200,
    mutationId: "owned-container",
    ownerUserId: "player-1"
  });

  assert.equal(created[0].delta.ownership["player-1"], 3);
});

test("a native container without a stored actor uses the Rebreya fallback storage actor on scene restore", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "bag-token" }];
    }
  };
  const fallbackActor = {
    id: "ground-storage",
    async getTokenDocument() {
      return { toObject: () => ({ actorId: this.id, width: 1, height: 1, texture: { src: "fallback.webp" } }) };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => null,
    resolveFallbackActor: () => fallbackActor
  });
  const snapshot = bagSnapshot();
  snapshot.presentation = { itemSystem: { type: { value: "backpack" } } };

  await service.restoreSnapshotToScene(snapshot, {
    sceneId: "scene",
    x: 100,
    y: 200,
    mutationId: "native-bag-scene"
  });

  assert.equal(created[0].actorId, fallbackActor.id);
  assert.equal(created[0].name, snapshot.name);
  assert.equal(created[0].texture.src, snapshot.img);
});

test("a canonical gear container restores to the scene with its top-down presentation", async () => {
  const actor = createActor();
  const [pouch] = await actor.createEmbeddedDocuments("Item", [{
    name: "Кошель",
    type: "container",
    img: "modules/rebreya-main/assets/gear/koshel.webp",
    system: {
      quantity: 1,
      type: { value: "pouch" },
      currency: {},
      capacity: { volume: { value: 0.2, units: "ft3" }, weight: { value: 6, units: "lb" } }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        sourceId: "koshel",
        gearId: "koshel"
      }
    }
  }]);
  const snapshot = await new StorageContainerItemService().captureFromItem(pouch);
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "pouch-token" }];
    }
  };
  const fallbackActor = {
    id: "ground-storage",
    async getTokenDocument() {
      return { toObject: () => ({ actorId: this.id, width: 1, height: 1, texture: { src: "fallback.webp" } }) };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => null,
    resolveFallbackActor: () => fallbackActor
  });

  await service.restoreSnapshotToScene(snapshot, {
    sceneId: scene.id,
    x: 100,
    y: 200,
    mutationId: "koshel-scene"
  });

  assert.equal(
    created[0].texture.src,
    "modules/rebreya-main/assets/top-down/items/gear/koshel.webp"
  );
  assert.equal(created[0].width, 0.5);
  assert.equal(created[0].height, 0.5);
  assert.equal(created[0].rotation, 52);
});

test("a restored bag does not inherit the fallback ground-pile marker", async () => {
  const created = [];
  const scene = {
    id: "scene",
    tokens: { contents: [] },
    async createEmbeddedDocuments(_type, documents) {
      created.push(clone(documents[0]));
      return [{ ...clone(documents[0]), id: "bag-token" }];
    }
  };
  const fallbackActor = {
    id: "ground-storage",
    async getTokenDocument() {
      return {
        toObject: () => ({
          actorId: this.id,
          width: 1,
          height: 1,
          flags: { [MODULE_ID]: { groundPile: { enabled: true } } }
        })
      };
    }
  };
  const service = new StorageContainerItemService({
    resolveScene: () => scene,
    resolveActor: () => null,
    resolveFallbackActor: () => fallbackActor
  });

  await service.restoreSnapshotToScene(bagSnapshot(), {
    sceneId: "scene",
    x: 100,
    y: 200,
    mutationId: "bag-with-fallback-prototype"
  });

  assert.equal(created[0].flags[MODULE_ID].storage.storageKind, "bag");
  assert.equal(created[0].flags[MODULE_ID].groundPile, undefined);
});

test("prepared container capture freezes every host and upgrade before catalog changes",async()=>{
  const {makePreparedContainerGraph}=await import("./helpers/lootgen-prepared-container-fixture.mjs");
  const {buildLootgenPreparedItem}=await import("../scripts/data/lootgen-prepared-item.js");
  const {descriptor,graph}=await makePreparedContainerGraph();
  graph.documents[1].effects=[{_id:"customEffect0001",name:"Saved effect",changes:[]}];
  const itemData=buildLootgenPreparedItem(descriptor,{graph,unitValue:7000}),before=structuredClone(itemData);
  const service=new StorageContainerItemService({buildItemData:()=>{throw new Error("saved items must not use the catalog");}});
  const snapshot=await service.capturePreparedContainer(itemData);
  assert.equal(snapshot.state.manualRows.length,1);assert.equal(snapshot.state.lootgenComposition.instanceKey,descriptor.instanceKey);
  assert.equal(snapshot.state.manualRows[0].composition.upgrades.length,1);
  assert.equal(snapshot.state.manualRows[0].itemData.flags[MODULE_ID].runtimeItemGraph.nodes.length,2);
  const restored=await service.prepareItemGraph(snapshot);
  assert.equal(restored.nodes.length,3);assert.deepEqual(restored.nodes[1].effects,graph.documents[1].effects);
  assert.equal(restored.nodes[2].system.container,restored.nodes[1]._id);
  assert.equal(restored.nodes[0].system.currency.cp,1000);
  assert.deepEqual(itemData,before);
  const corrupt=structuredClone(itemData);corrupt.flags[MODULE_ID].runtimeItemGraph.nodes.pop();
  await assert.rejects(service.capturePreparedContainer(corrupt));
});
