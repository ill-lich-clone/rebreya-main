import test from "node:test";
import assert from "node:assert/strict";
import { consumeTreatWoundsKitOnce } from "../scripts/application/treat-wounds-kit-consumption.js";
import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { TreatWoundsDnd5eAdapter } from "../scripts/integrations/treat-wounds-dnd5e-adapter.js";
function fixture(quantity=2,group=false){
  let state={records:[]},updates=0,deletes=0,allowed=true;
  const sender={id:"p"};const actor={id:group?"group":"healer",uuid:group?"Actor.group":"Actor.healer",items:new Map(),testUserPermission:()=>true};
  const kit={uuid:`${actor.uuid}.Item.k`,id:"k",parent:actor,name:"Комплект целителя",flags:{"rebreya-main":{gearId:"komplekt-tselitelya"}},system:{quantity,uses:{spent:0,max:"10"}},
    async update(p){updates++;this.system.quantity=p["system.quantity"];this.flags["rebreya-main"].treatWoundsKitReceipt=p["flags.rebreya-main.treatWoundsKitReceipt"];},async delete(){deletes++;actor.items.delete("k");}};
  actor.items.set("k",kit);
  const owner={mutationCoordinator:new WorldMutationCoordinator(),mutationJournal:new DurableMutationJournal({readState:()=>state,writeState:s=>{state=s;}}),moduleApi:{groupContextService:{canManageGroupForUser:()=>allowed}},
    getInventoryActor:async()=>actor};
  const context={sender,assertAuthority:async()=>{}};const payload={operationId:"op",sourceActorUuid:"Actor.healer",groupActorId:group?"group":"",kitItemUuid:kit.uuid};
  const options={adapter:new TreatWoundsDnd5eAdapter(),resolve:async uuid=>uuid===actor.uuid?actor:null};
  return{owner,payload,context,options,kit,actor,deny:()=>allowed=false,counts:()=>({updates,deletes})};
}
test("one full kit debited from stack; durable repeat cannot debit twice",async()=>{
  const f=fixture();await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);
  assert.equal(f.kit.system.quantity,1);assert.deepEqual(f.counts(),{updates:1,deletes:0});
});
test("last kit deleted once; missing prepared item verifies prior deletion",async()=>{
  const f=fixture(1);await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);
  assert.equal(f.actor.items.size,0);assert.equal(f.counts().deletes,1);
});
test("group source permission checked for original sender even during replay",async()=>{
  const f=fixture(2,true);await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);f.deny();
  await assert.rejects(consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options));assert.equal(f.kit.system.quantity,1);
});
test("part-used kit rejected without debit and same ID changed source rejected",async()=>{
  const f=fixture();f.kit.system.uses.spent=1;await assert.rejects(consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options));assert.equal(f.counts().updates,0);
  f.kit.system.uses.spent=0;await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);
  await assert.rejects(consumeTreatWoundsKitOnce(f.owner,{...f.payload,kitItemUuid:"Actor.healer.Item.other"},f.context,f.options));
});
test("lost acknowledgement after stack write reuses document receipt",async()=>{
  const f=fixture();const update=f.kit.update.bind(f.kit);f.kit.update=async p=>{await update(p);throw Error("lost ack");};
  await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);await consumeTreatWoundsKitOnce(f.owner,f.payload,f.context,f.options);
  assert.equal(f.kit.system.quantity,1);assert.equal(f.counts().updates,1);
});
