import { WorldMutationCoordinator } from "../../scripts/application/world-mutation-coordinator.js";
import { InventoryService } from "../../scripts/data/inventory-service.js";

export function makeInstanceDocumentsFixture({ quantity = 10, itemFlags = {}, itemSystem = {} } = {}) {
  const previous=Object.fromEntries(["Actor","Item","game","foundry","fromUuid"].map(key=>[key,globalThis[key]]));
  const clone=value=>value==null?value:structuredClone(value);
  const get=(data,path)=>path.split(".").reduce((value,key)=>value?.[key],data);
  const set=(data,path,value)=>{const parts=path.split(".");let parent=data;for(const key of parts.slice(0,-1))parent=parent[key]??={};const key=parts.at(-1);if(key.startsWith("-="))delete parent[key.slice(2)];else parent[key.startsWith("==")?key.slice(2):key]=clone(value);};
  let failure=null;const calls=[];const actors=new Map();const settings=new Map();
  const hit=(phase,timing)=>{if(failure?.phase===phase&&failure.timing===timing){const current=failure;failure=null;current.edit?.();throw Error(`fault ${phase} ${timing}`);}};
  class FakeItem {
    constructor(data,parent){this.data=clone(data);this.parent=parent;}
    get id(){return this.data._id;} get uuid(){return `${this.parent.uuid}.Item.${this.id}`;}
    get system(){return this.data.system;} get name(){return this.data.name;} get type(){return this.data.type;}
    get flags(){return this.data.flags;} get isOwner(){return true;}
    getFlag(scope,key){return this.data.flags?.[scope]?.[key];}
    toObject(){return clone(this.data);}
    async update(patch){const phase=Object.hasOwn(patch,"system.quantity")?"debit":"equip";hit(phase,"before");calls.push([phase,this.id]);for(const [path,value]of Object.entries(patch))set(this.data,path,value);hit(phase,"after");return this;}
    async delete(){hit("delete","before");this.parent.items.contents=this.parent.items.contents.filter(item=>item!==this);hit("delete","after");}
  }
  class FakeActor {
    constructor(id,type){this.id=id;this.uuid=`Actor.${id}`;this.type=type;this.name=id;this.isOwner=true;this.ownership={gm:3,player:3};this.flags={"rebreya-main":{inventoryFolders:{version:1,folders:[{id:"bag",name:"Bag",parentId:null,color:null}],itemFolderIds:{}}}};this.items={contents:[],get:id=>this.items.contents.find(item=>item.id===id)};actors.set(this.uuid,this);}
    getFlag(scope,key){return this.flags?.[scope]?.[key];}
    testUserPermission(user){return user.isGM||this.ownership[user.id]>=3;}
    toObject(){return {flags:clone(this.flags)};}
    async update(patch){hit("placement","before");calls.push(["placement",this.id]);for(const [path,value]of Object.entries(patch))set(this,path,value);hit("placement","after");return this;}
    async setFlag(scope,key,value){this.flags[scope]??={};this.flags[scope][key.startsWith("==")?key.slice(2):key]=clone(value);return this;}
    async createEmbeddedDocuments(type,rows){hit("create","before");calls.push(["create",this.id]);const result=rows.map(row=>new FakeItem({_id:`generated${this.items.contents.length}`, ...row},this));this.items.contents.push(...result);hit("create","after");return result;}
  }
  globalThis.Actor=FakeActor;globalThis.Item=FakeItem;
  const group=new FakeActor("g","group"),hero=new FakeActor("hero","character");
  const source=new FakeItem({_id:"rope",name:"Амулет",type:"equipment",flags:{"rebreya-main":{heroDollSlots:["neck"],...itemFlags}},system:{quantity,equipped:false,...itemSystem}},group);group.items.contents.push(source);
  const gm={id:"gm",isGM:true,active:true};const users=new Map([[gm.id,gm]]);users.activeGM=gm;
  globalThis.game={user:gm,users,actors:{get:id=>actors.get(`Actor.${id}`)},i18n:{lang:"ru"},settings:{get:(_,key)=>clone(settings.get(key)),set:async(_,key,value)=>{settings.set(key,clone(value));return value;}}};
  globalThis.foundry={utils:{deepClone:clone,getProperty:get,setProperty:set,hasProperty:(data,path)=>get(data,path)!==undefined,mergeObject:(a,b)=>({...clone(a),...clone(b)})}};
  globalThis.fromUuid=async uuid=>{const parts=uuid.split(".Item.");return parts.length===1?actors.get(uuid):actors.get(parts[0])?.items.get(parts[1]);};
  const api={worldMutationCoordinator:new WorldMutationCoordinator(),groupContextService:{resolveForGroup:id=>({groupActor:actors.get(`Actor.${id}`),members:[hero]})}};
  api.inventoryService=new InventoryService(api);
  return {api,group,hero,source,calls,actors,settings,failAt:(phase,timing,edit)=>failure={phase,timing,edit},
    restore(){for(const [key,value]of Object.entries(previous))globalThis[key]=value;},
    total:()=>[...actors.values()].flatMap(actor=>actor.items.contents).reduce((sum,item)=>sum+item.system.quantity,0)};
}
