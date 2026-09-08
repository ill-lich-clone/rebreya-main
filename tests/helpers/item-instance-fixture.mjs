import { ItemInstanceWorkflow } from "../../scripts/application/item-instance-workflow.js";
import { DurableMutationJournal } from "../../scripts/application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../../scripts/application/world-mutation-coordinator.js";

export function makeItemInstanceFixture({ quantity = 10 } = {}) {
  let state = {version:1,records:[]};
  const items = new Map([["rope",{quantity,folderId:null}]]);
  let fault = null;
  const calls=[];
  const check = (phase,timing) => {
    if(fault?.phase===phase && fault.timing===timing) {
      const hit=fault;fault=null;hit.edit?.();throw Error(`fault ${phase} ${timing}`);
    }
  };
  const documents = {
    async readActors(){return {sourceActor:{id:"g"},targetActor:{id:"g"}};},
    async readSource(){const row=items.get("rope");if(!row)throw Error("missing source");return {...row,step:1};},
    async prepare(intent,plan,source){return {itemId:plan.preserveSourceId?"rope":"target",before:source.quantity};},
    async createTarget(record){calls.push("createTarget");check("createTarget","before");if(!record.plan.preserveSourceId)items.set(record.itemId,{quantity:record.intent.quantity,folderId:null});check("createTarget","after");},
    async debitSource(record){calls.push("debitSource");check("debitSource","before");items.get("rope").quantity=record.plan.sourceRemaining;check("debitSource","after");},
    async writePlacement(record){calls.push("writePlacement");check("writePlacement","before");items.get(record.itemId).folderId=record.intent.targetFolderId;check("writePlacement","after");},
    async verifyCommitted(record){if(!items.has(record.itemId)||items.get("rope")?.quantity!==record.plan.sourceRemaining)throw Error("conflict");},
    async compensate(record){
      const source=items.get("rope"),target=items.get(record.itemId);
      if(!source||![record.before,record.plan.sourceRemaining].includes(source.quantity))throw Error("conflict");
      if(source.quantity!==record.before&&!target)throw Error("missing target");
      if(target&&record.itemId!=="rope"&&target.quantity!==record.intent.quantity)throw Error("changed target");
      source.quantity=record.before;source.folderId=null;if(record.itemId!=="rope")items.delete(record.itemId);
    }
  };
  const fx={calls,context:{sender:{id:"gm"},assertAuthority:()=>{},authorize:()=>{}},
    intent:{operationId:"split-1",sourceActorUuid:"Actor.g",sourceItemId:"rope",destinationActorUuid:"Actor.g",quantity:3,targetFolderId:"bag",heroSlotId:null,expectedSourceQuantity:quantity},
    quantity:id=>items.get(id)?.quantity??0,total:()=>[...items.values()].reduce((sum,row)=>sum+row.quantity,0),
    setQuantity:(id,q)=>items.get(id).quantity=q,
    removeItem:id=>items.delete(id),
    failAt:(phase,timing,edit)=>fault={phase,timing,edit},
    restart(){
      const journal=new DurableMutationJournal({readState:()=>structuredClone(state),writeState:next=>{state=structuredClone(next);}});
      const finish=journal.finish.bind(journal);
      journal.finish=async(...args)=>{check("finish","before");const result=await finish(...args);check("finish","after");return result;};
      fx.workflow=new ItemInstanceWorkflow({journal,coordinator:new WorldMutationCoordinator(),documents});
    }
  };
  fx.restart();return fx;
}
