import test from "node:test";
import assert from "node:assert/strict";
import { resolveDisarmSelection, promptDisarm, promptDisarmBaseline, buildDisarmChatContent } from "../scripts/ui/disarm-dialog.js";
test("explicit tokens or exactly one controlled source and one target; no automatic guess",()=>{
  assert.throws(()=>resolveDisarmSelection({},[],[]));
  assert.throws(()=>resolveDisarmSelection({},[{uuid:"a"},{uuid:"b"}],[{uuid:"c"}]));
  assert.deepEqual(resolveDisarmSelection({},[{document:{uuid:"source"}}],[{document:{uuid:"target"}}]),{sourceTokenUuid:"source",targetTokenUuid:"target"});
  assert.deepEqual(resolveDisarmSelection({sourceTokenUuid:"a",targetTokenUuid:"b"},[],[]),{sourceTokenUuid:"a",targetTokenUuid:"b"});
});
test("cancel at selection or confirmation returns no mutation intent",async()=>{
  const previous=globalThis.foundry;
  const preview={sourceName:"A",targetName:"B",weapons:[{uuid:"w",name:"Blade",modes:[{mode:"melee",plan:{formula:"1d20 + 3 + 2"}}]}],items:[{uuid:"i",name:"Item",heldHands:2}]};
  try {
    globalThis.foundry={applications:{api:{DialogV2:{wait:async()=>null,confirm:async()=>false}}}};
    assert.equal(await promptDisarm(preview),null);
    foundry.applications.api.DialogV2.wait=async()=>({weapon:0,item:0});
    assert.equal(await promptDisarm(preview),null);
    foundry.applications.api.DialogV2.confirm=async()=>true;
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
