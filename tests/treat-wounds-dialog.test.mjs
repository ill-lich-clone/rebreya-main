import test from "node:test";
import assert from "node:assert/strict";
import { resolveTreatWoundsSelection,promptTreatWounds,promptTreatWoundsContinuation,buildTreatWoundsChatContent } from "../scripts/ui/treat-wounds-dialog.js";
test("selection defaults to self but rejects ambiguous targets",()=>{
  const healer={document:{uuid:"Scene.s.Token.h"}};
  assert.deepEqual(resolveTreatWoundsSelection({},[healer],[]),{sourceTokenUuid:"Scene.s.Token.h",targetTokenUuid:"Scene.s.Token.h"});
  assert.throws(()=>resolveTreatWoundsSelection({},[],[]));assert.throws(()=>resolveTreatWoundsSelection({},[healer],[healer,healer]));
});
test("ambiguous selection exposes expected invalid-tokens without accepting an arbitrary healer",()=>{
  assert.throws(()=>resolveTreatWoundsSelection({},[],[]),error=>error.code==="invalid-tokens");
});
test("native dialog supports group kit and GM custom DC, escapes labels and cancels explicitly",async()=>{
  let config;
  const DialogV2={async wait(c){config=c;return c.buttons.find(b=>b.action==="cancel").callback();}};
  const preview={sourceName:"<img>",targetName:"Пациент",tiers:[{dc:10,bonus:0},{dc:15,bonus:10}],kits:[{uuid:"kit",groupActorId:"group",name:"<kit>",sourceName:"Группа",quantity:2}],canSetDc:false};
  assert.equal(await promptTreatWounds(preview,{DialogV2}),false);
  assert.match(config.content,/&lt;img&gt;/);assert.equal(config.content.includes('name="customDc"'),false);assert.match(config.content,/Группа/);
  const form={elements:{namedItem:name=>({value:name==="kit"?"0":name==="tierDc"?"15":"12"})}};
  assert.deepEqual(config.buttons[0].callback(null,{form}),{kitItemUuid:"kit",groupActorId:"group",tierDc:15,customDc:null,ignoreMissingKit:false});
  const checkedForm={elements:{namedItem:name=>name==="ignoreMissingKit"?{checked:true}:{value:name==="kit"?"0":"15"}}};
  assert.deepEqual(config.buttons[0].callback(null,{form:checkedForm}),{kitItemUuid:"kit",groupActorId:"group",tierDc:15,customDc:null,ignoreMissingKit:true});
  await promptTreatWounds({...preview,canSetDc:true},{DialogV2});assert.equal(config.buttons[0].callback(null,{form}).customDc,12);
  assert.equal(config.rejectClose,false);
});
test("empty kits open the dialog and require the explicit checkbox",async()=>{
  let config; const DialogV2={async wait(c){config=c;return false;}};
  await promptTreatWounds({sourceName:"Лекарь",targetName:"Пациент",kits:[],tiers:[{dc:10}],canSetDc:false},{DialogV2});
  assert.match(config.content,/Игнорировать отсутствие комплекта целителя/);
  let checked=false; const form={elements:{namedItem:name=>name==="ignoreMissingKit"?{checked}:{value:name==="tierDc"?"10":""}}};
  let change; const checkbox={checked:false,addEventListener:(_type,handler)=>{change=handler;}};const confirm={disabled:false};
  config.render(null,{element:{querySelector:selector=>selector.includes('ignoreMissingKit')?checkbox:confirm}});
  assert.equal(confirm.disabled,true);checkbox.checked=true;change();assert.equal(confirm.disabled,false);
  assert.equal(config.buttons[0].callback(null,{form}),false);
  checked=true; assert.deepEqual(config.buttons[0].callback(null,{form}),{kitItemUuid:"",groupActorId:"",tierDc:10,customDc:null,ignoreMissingKit:true});
});
test("all four outcomes show roll total and DC, failures have no continuation",()=>{
  for(const kind of ["critical-success","success","failure","critical-failure"]){
    const record={intent:{operationId:"op"},sourceName:"<Лекарь>",targetName:"Пациент",medicineRoll:{total:14},dc:15,amount:19,outcome:{kind,canContinue:kind.includes("success")},phase:"completed",startTime:1000};
    const content=buildTreatWoundsChatContent(record);assert.match(content,/14/);assert.match(content,/15/);assert.match(content,/&lt;Лекарь&gt;/);
    assert.equal(content.includes('data-treat-wounds-action="continue"'),kind.includes("success"));
  }
});
test("failed application remains visible; continuation confirms saved amount without new roll",async()=>{
  const record={intent:{operationId:"op"},sourceName:"Лекарь",targetName:"Пациент",medicineRoll:{total:17},dc:15,amount:19,outcome:{kind:"success",canContinue:true},phase:"health-prepared",applicationError:"<ошибка>",startTime:0};
  assert.match(buildTreatWoundsChatContent(record),/&lt;ошибка&gt;/);
  let config;const DialogV2={async wait(c){config=c;return c.buttons[0].callback();}};
  assert.equal(await promptTreatWoundsContinuation(record,{DialogV2}),true);assert.match(config.content,/50/);assert.match(config.content,/19/);
});
test("custom DC card preserves selected healing tier and remaining world-time cooldown",()=>{
  const record={intent:{operationId:"op",tierDc:15},sourceName:"Лекарь",targetName:"Пациент",medicineRoll:{total:17},dc:12,bonus:10,amount:19,outcome:{kind:"success",canContinue:true},phase:"completed",startTime:1000};
  const content=buildTreatWoundsChatContent(record,{worldTime:1600});
  assert.match(content,/Ступень лечения: Сл 15/);assert.match(content,/\+10/);assert.match(content,/50 мин/);
});
