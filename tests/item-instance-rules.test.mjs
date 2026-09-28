import test from "node:test";
import assert from "node:assert/strict";
import { planItemInstanceMutation as plan } from "../scripts/data/item-instance-rules.js";

const source = { quantity: 10, step: 1 };
const request = { source, quantity: 3, sameActor: true, sameFolder: false, forHeroSlot: false };
test("partial instance transfer conserves quantity and whole membership preserves identity", () => {
  assert.deepEqual(plan(request), {kind:"split",quantity:3,sourceRemaining:7,preserveSourceId:false});
  assert.deepEqual(plan({...request,quantity:10}), {kind:"membership",quantity:10,sourceRemaining:10,preserveSourceId:true});
  assert.equal(plan({...request,sameFolder:true}).kind,"noop");
  assert.equal(plan({...request,sameActor:false,sameFolder:true,quantity:10}).kind,"move");
  assert.equal(plan({...request,sameActor:false,quantity:10}).sourceRemaining,0);
});
test("instance quantity uses exact step units and rejects invalid boundaries", () => {
  for (const quantity of [0,-1,NaN,Infinity,11,1.25]) assert.throws(()=>plan({...request,quantity}));
  assert.throws(()=>plan({...request,source:{quantity:0,step:1}}));
  assert.throws(()=>plan({...request,source:{quantity:10,step:0}}));
  assert.equal(plan({...request,source:{quantity:10,step:0.01},quantity:1.25}).sourceRemaining,8.75);
  assert.equal(plan({...request,source:{quantity:0.3,step:0.00001},quantity:0.1}).sourceRemaining,0.2);
});
test("partial cloning rejects instance state; hero placement requires exactly one", () => {
  for (const key of ["hasContents","hasInstalledUpgrades","hasIndependentState","isEquipped","isHeld"]) {
    assert.throws(()=>plan({...request,source:{...source,[key]:true}}),/состояни/);
    assert.equal(plan({...request,source:{...source,[key]:true},quantity:10}).kind,"membership");
  }
  assert.throws(()=>plan({...request,forHeroSlot:true}));
  assert.equal(plan({...request,quantity:1,forHeroSlot:true,sameFolder:true}).kind,"split");
});
