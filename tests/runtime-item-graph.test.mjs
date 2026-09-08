import test from "node:test";
import assert from "node:assert/strict";
import { captureRuntimeItemGraph, buildRuntimeGraphDocuments, materializeRuntimeItemGraph } from "../scripts/data/runtime-item-graph.js";
const doc=data=>({id:data._id,system:data.system,toObject:()=>structuredClone(data)});
function fixture(){
  const root=doc({_id:"host",name:"Клинок",type:"weapon",system:{quantity:1,equipped:true},flags:{"rebreya-main":{heldHands:["left"],durability:{hp:{value:2,max:5}},itemUpgrades:{installed:[{itemId:"upgrade",slotIndex:0}]}}}});
  const upgrade=doc({_id:"upgrade",name:"Огонь",type:"loot",system:{quantity:1},flags:{"rebreya-main":{installedUpgrade:{hostItemId:"host",slotIndex:0}},custom:{x:2}}});
  const items=new Map([[root.id,root],[upgrade.id,upgrade]]); items.contents=[root,upgrade];
  return {root,actor:{items}};
}
test("physical graph preserves state and rewrites host/upgrade identity without retaining held grip",()=>{
  const f=fixture();const graph=captureRuntimeItemGraph(f.actor,f.root);
  const result=buildRuntimeGraphDocuments(graph,"grant",{...f.root.toObject(),system:{quantity:1,equipped:false}});
  assert.equal(result.documents.length,2);const [root,upgrade]=result.documents;
  assert.equal(root.flags["rebreya-main"].itemUpgrades.installed[0].itemId,upgrade._id);
  assert.equal(upgrade.flags["rebreya-main"].installedUpgrade.hostItemId,root._id);
  assert.equal(root.flags["rebreya-main"].durability.hp.value,2);assert.equal(upgrade.flags.custom.x,2);
  assert.equal(root.system.equipped,false);assert.deepEqual(root.flags["rebreya-main"].heldHands,[]);
  assert.equal(f.root.toObject().system.equipped,true);
});
test("native container contents and their upgrades retain a single parent graph",()=>{
  const f=fixture();const bag=doc({_id:"bag",type:"container",name:"Мешок",system:{quantity:1,currency:{gp:5}}});
  const data=f.root.toObject();data.system.container="bag";const child=doc(data);f.actor.items.set(child.id,child);f.actor.items.set(bag.id,bag);f.actor.items.contents=[bag,child,f.actor.items.get("upgrade")];
  const graph=captureRuntimeItemGraph(f.actor,bag);assert.equal(graph.nodes.length,3);
  const result=buildRuntimeGraphDocuments(graph,"bag-grant",bag.toObject());
  const host=result.documents.find(d=>d.name==="Клинок");assert.equal(host.system.container,result.rootItemId);
  assert.equal(result.documents[0].system.currency.gp,5);
});
test("graph creation acknowledges throw-after-write; partial creation never blindly recreates children",async()=>{
  const f=fixture(),graph=captureRuntimeItemGraph(f.actor,f.root); const items=new Map();
  const actor={items,async createEmbeddedDocuments(_type,data){for(const d of data)items.set(d._id,doc(d));throw new Error("ack lost");}};
  const root=await materializeRuntimeItemGraph(actor,graph,"one",f.root.toObject());
  assert.ok(root);const size=items.size;await materializeRuntimeItemGraph(actor,graph,"one",f.root.toObject());assert.equal(items.size,size);
  items.delete([...items.keys()].find(id=>id!==root.id));
  await assert.rejects(materializeRuntimeItemGraph(actor,graph,"one",f.root.toObject()),e=>e.code==="graph-manual-review");
});
