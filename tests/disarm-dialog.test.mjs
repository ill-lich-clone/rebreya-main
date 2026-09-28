import test from "node:test";
import assert from "node:assert/strict";
import { resolveDisarmSelection, promptDisarm, promptDisarmBaseline, buildDisarmChatContent } from "../scripts/ui/disarm-dialog.js";
import * as dialogs from "../scripts/ui/disarm-dialog.js";
test("explicit tokens or exactly one controlled source and one target; no automatic guess",()=>{
  assert.throws(()=>resolveDisarmSelection({},[],[]));
  assert.throws(()=>resolveDisarmSelection({},[{uuid:"a"},{uuid:"b"}],[{uuid:"c"}]));
  assert.deepEqual(resolveDisarmSelection({},[{document:{uuid:"source"}}],[{document:{uuid:"target"}}]),{sourceTokenUuid:"source",targetTokenUuid:"target"});
  assert.deepEqual(resolveDisarmSelection({sourceTokenUuid:"a",targetTokenUuid:"b"},[],[]),{sourceTokenUuid:"a",targetTokenUuid:"b"});
});

test("GM responder dialog carries the captured revision and escaped active users; cancel is inert",async()=>{
  assert.equal(typeof dialogs.promptDisarmResponder,"function");
  const previous=globalThis.foundry;let action="confirm";
  try {
    globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
      assert.ok(config.content.includes("&lt;owner&gt;"));assert.ok(!config.content.includes("Offline"));
      let onInput;const reason={value:"",addEventListener:(_event,callback)=>{onInput=callback;}},confirm={},cancel={};
      config.render({}, {element:{querySelector:selector=>selector.includes("name=")?reason:selector.includes("confirm")?confirm:cancel}});
      assert.equal(confirm.disabled,true);reason.value=" ";onInput();assert.equal(confirm.disabled,true);
      reason.value="Связь потеряна";onInput();assert.equal(confirm.disabled,false);assert.equal(cancel.formNoValidate,true);
      const button=config.buttons.find(b=>b.action===action);
      return button.callback({}, {form:{elements:{namedItem:name=>({value:name==="reason"?"Связь потеряна":"owner"})}}})??button.action;
    }}}}};
    const users=[{id:"owner",name:"<owner>",active:true},{id:"off",name:"Offline",active:false}];
    assert.deepEqual(await dialogs.promptDisarmResponder("op",2,users),{operationId:"op",expectedResponderRevision:2,responderUserId:"owner",reason:"Связь потеряна"});
    action="cancel";assert.equal(await dialogs.promptDisarmResponder("op",2,users),false);
  }finally{globalThis.foundry=previous;}
});

test("pending chat exposes reassignment revision and escapes the recorded reason",()=>{
  const html=buildDisarmChatContent({intent:{operationId:"op"},phase:"awaiting-save",responderUserId:"owner",responderRevision:2,responderDecisions:[{reason:"<img src=x onerror=alert(1)>"}]});
  assert.match(html,/data-disarm-reassign/u);assert.match(html,/data-responder-revision="2"/u);
  assert.match(html,/&lt;img/u);assert.ok(!html.includes("<img"));
});
test("cancel at selection or confirmation returns no mutation intent",async()=>{
  const previous=globalThis.foundry;
  const preview={sourceName:"A",targetName:"B",weapons:[{uuid:"w",name:"Blade",modes:[{mode:"melee",plan:{formula:"1d20 + 3 + 2"}}]}],items:[{uuid:"i",name:"Item",heldHands:2}]};
  try {
    globalThis.foundry={applications:{api:{DialogV2:{wait:async()=>null,confirm:async()=>false}}}};
    assert.equal(await promptDisarm(preview),null);
    foundry.applications.api.DialogV2.wait=async()=>({weapon:0,item:0});
    assert.equal(await promptDisarm(preview),null);
    preview.weapons[0].modes[0].plan.excludedModifiers=["<quality>"];
    preview.weapons[0].modes[0].plan.unresolvedModifiers=["ability-baseline","proficiency-baseline"];
    foundry.applications.api.DialogV2.confirm=async({content})=>{
      assert.match(content,/&lt;quality&gt;/u);assert.doesNotMatch(content,/<quality>/u);
      assert.match(content,/исходное значение характеристики/u);assert.match(content,/вклад владения оружием/u);
      return true;
    };
    assert.deepEqual(await promptDisarm(preview),{weaponItemUuid:"w",targetItemUuid:"i",weaponMode:"melee"});
  }finally{globalThis.foundry=previous;}
});
test("chat escapes actor names and explains one attack plus assigned defender",()=>{
  const html=buildDisarmChatContent({intent:{operationId:"x"},sourceName:"<script>x</script>",targetName:"B",itemName:"C",phase:"awaiting-save",attackPlan:{formula:"1d20 + 3 + 2"},attackRoll:{total:17},responderUserId:"owner",strSaveAdvantage:true});
  assert.ok(!html.includes("<script>"));assert.match(html,/1 атака/u);assert.match(html,/17/u);assert.match(html,/data-disarm-save="str"/u);assert.match(html,/преимуществ/u);
});

test("DialogV2 callback uses namedItem and cancellation survives native nullish action fallback", async () => {
  const previous = globalThis.foundry;
  const preview = { sourceName: "A", targetName: "B", weapons: [{ uuid: "w", name: "Blade", modes: [{ mode: "melee", plan: { formula: "1d20 + 3 + 2" } }] }], items: [{ uuid: "i", name: "Item", heldHands: 2 }] };
  let action = "select";
  try {
    globalThis.foundry = { applications: { api: { DialogV2: {
      async wait(config) {
        const button = config.buttons.find(b => b.action === action);
        const form = { elements: { weapon: { value: "0" }, item() {}, namedItem: () => ({ value: "0" }) } };
        return (await button.callback({}, { form })) ?? button.action;
      }, confirm: async () => true
    } } } };
    assert.deepEqual(await promptDisarm(preview), { weaponItemUuid: "w", targetItemUuid: "i", weaponMode: "melee" });
    action = "cancel";
    assert.equal(await promptDisarm(preview), null);
    assert.equal(Boolean(await promptDisarmBaseline("op")), false);
  } finally { globalThis.foundry = previous; }
});
