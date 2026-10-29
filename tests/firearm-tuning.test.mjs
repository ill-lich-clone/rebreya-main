import test from "node:test";
import assert from "node:assert/strict";
import { applyFirearmTuning, startFirearmTuning, canApplyFirearmTuning, allowMagicalFirearmTuning, startTuningForAreaFire } from "../scripts/combat/firearm-tuning.js";

function fixture(){
 const writes=[];
 const effect={flags:{"rebreya-main":{firearmTuning:{startedAt:null}}},duration:{startTime:80,seconds:null},update:async update=>{writes.push(update);effect.duration={...effect.duration,...update.duration};effect.flags["rebreya-main"].firearmTuning=update["flags.rebreya-main.firearmTuning"];}};
 const item={type:"weapon",system:{type:{value:"firearmPrimitive"}},effects:{contents:[effect]}};
 return {effect,item,writes};
}
test("tuning adds one attack bonus until one minute after the first confirmed shot",async()=>{
 const {item,writes}=fixture(),roll={parts:["@mod"],options:{}},config={rolls:[roll]};
 applyFirearmTuning(item,config,100);applyFirearmTuning(item,config,100);
 assert.deepEqual(roll.parts,["@mod","1"]);assert.equal(writes.length,0);
 await startFirearmTuning(item,100);await startFirearmTuning(item,110);
 assert.equal(writes.length,1);assert.deepEqual(writes[0].duration,{startTime:100,seconds:60});
 assert.deepEqual(writes[0]["flags.rebreya-main.firearmTuning"],{startedAt:100});
 const before={rolls:[{parts:[]}]};applyFirearmTuning(item,before,159);assert.deepEqual(before.rolls[0].parts,["1"]);
 const after={rolls:[{parts:[]}]};applyFirearmTuning(item,after,160);assert.deepEqual(after.rolls[0].parts,[]);
});
test("tuning affects only firearms, ignores disabled or missing enchantments, and never damages authored formulas",()=>{
 const {item,effect}=fixture(),config={rolls:[{parts:["@mod", "2"]}]};
 item.system.type.value="simpleR";applyFirearmTuning(item,config,10);assert.deepEqual(config.rolls[0].parts,["@mod","2"]);
 item.system.type.value="firearmPrimitive";effect.disabled=true;applyFirearmTuning(item,config,10);assert.deepEqual(config.rolls[0].parts,["@mod","2"]);
});
test("tuning enchantment only permits firearms and reapplication resets rather than stacking",async()=>{
 const {item,effect,writes}=fixture(),activity={flags:{"rebreya-main":{firearmTuning:true}}};
 item.system.type.value="simpleR";assert.equal(canApplyFirearmTuning(item,activity),false);
 item.system.type.value="firearmPrimitive";effect.flags["rebreya-main"].firearmTuning.startedAt=100;
 assert.equal(canApplyFirearmTuning(item,activity),false);await Promise.resolve();
 assert.deepEqual(writes[0]["flags.rebreya-main.firearmTuning"],{startedAt:null});
 item.effects.contents=[];assert.equal(canApplyFirearmTuning(item,activity),true);
 assert.equal(canApplyFirearmTuning({type:"loot"},{flags:{}}),true);
});
test("existing owned master enchantment receives the timed marker without doubling its authored +1",()=>{
 const {item}=fixture();item.effects.contents=[];
 const activity={type:"enchant",name:"Настройка огнестрельного оружия",item:{system:{identifier:"master-ognestrelnogo-oruzhiya"}}};
 const data={flags:{},changes:[{key:"activities[attack].attack.bonus",mode:2,value:"1"},{key:"name",mode:5,value:"{}"}]};
 assert.equal(canApplyFirearmTuning(item,activity,data),true);
 assert.deepEqual(data.flags["rebreya-main"].firearmTuning,{startedAt:null});
 assert.deepEqual(data.changes,[{key:"name",mode:5,value:"{}"}]);
});
test("existing tuning can enchant a magical firearm without removing unrelated restriction errors",()=>{
 const {item}=fixture(),activity={type:"enchant",name:"Настройка огнестрельного оружия",item:{system:{identifier:"master-ognestrelnogo-oruzhiya"}}};
 const old=globalThis.game;globalThis.game={i18n:{localize:()=>"magic forbidden"}};
 try{const errors=[new Error("magic forbidden"),new Error("wrong type")];allowMagicalFirearmTuning(activity,item,errors);assert.deepEqual(errors.map(e=>e.message),["wrong type"]);}finally{globalThis.game=old;}
});
test("only completed automatic or semi-automatic activities start tuning",async()=>{
 const {item,effect}=fixture();await startTuningForAreaFire({item,flags:{"rebreya-main":{automation:"firearm-reload"}}},50);
 assert.equal(effect.flags["rebreya-main"].firearmTuning.startedAt,null);
 await startTuningForAreaFire({item,flags:{"rebreya-main":{automation:"firearm-automatic-fire"}}},50);
 assert.equal(effect.flags["rebreya-main"].firearmTuning.startedAt,50);
});
test("simultaneous first shots start one timer at the earliest confirmed shot",async()=>{
 const {item,effect}=fixture();let resolve,writes=[];
 effect.update=patch=>{writes.push(patch);return new Promise(done=>{resolve=done;});};
 const first=startFirearmTuning(item,100),second=startFirearmTuning(item,106);
 assert.equal(writes.length,1);assert.equal(writes[0]["flags.rebreya-main.firearmTuning"].startedAt,100);
 resolve();await Promise.all([first,second]);
});
