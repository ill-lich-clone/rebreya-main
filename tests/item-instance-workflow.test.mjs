import test from "node:test";
import assert from "node:assert/strict";
import { makeItemInstanceFixture } from "./helpers/item-instance-fixture.mjs";

test("instance replay and restart keep one target and conserve quantity", async () => {
  const fx=makeItemInstanceFixture();
  const first=await fx.workflow.run(fx.intent,fx.context);
  fx.restart();
  const second=await fx.workflow.run(fx.intent,fx.context);
  assert.equal(second.itemId,first.itemId); assert.equal(second.replayed,true);
  assert.equal(fx.quantity("rope"),7); assert.equal(fx.quantity(first.itemId),3);
  assert.equal(fx.calls.filter(x=>x==="createTarget").length,1);
  await assert.rejects(fx.workflow.run({...fx.intent,quantity:2},fx.context),e=>e.code==="operation-conflict");
});
for(const phase of ["createTarget","debitSource","writePlacement"]) for(const timing of ["before","after"]) {
  test(`instance failure ${timing} ${phase} compensates without losing or duplicating units`,async()=>{
    const fx=makeItemInstanceFixture();fx.failAt(phase,timing);
    await assert.rejects(fx.workflow.run(fx.intent,fx.context));
    assert.equal(fx.total(),10);assert.equal(fx.quantity("rope"),10);
    fx.restart();await assert.rejects(fx.workflow.run(fx.intent,fx.context));
    assert.equal(fx.total(),10);
  });
}
test("journal finish failure resumes committed Documents without a second debit",async()=>{
  const fx=makeItemInstanceFixture();fx.failAt("finish","before");
  await assert.rejects(fx.workflow.run(fx.intent,fx.context));
  assert.equal(fx.total(),10);fx.restart();
  await fx.workflow.run(fx.intent,fx.context);
  assert.equal(fx.quantity("rope"),7);
  assert.equal(fx.calls.filter(x=>x==="debitSource").length,1);
});
test("conflicting external edits are left untouched for manual review",async()=>{
  const fx=makeItemInstanceFixture();fx.failAt("debitSource","after",()=>fx.setQuantity("rope",6));
  await assert.rejects(fx.workflow.run(fx.intent,fx.context),e=>e.code==="manual-review");
  assert.equal(fx.quantity("rope"),6);fx.restart();
  await assert.rejects(fx.workflow.run(fx.intent,fx.context),e=>e.code==="manual-review");
  await assert.rejects(fx.workflow.run({...fx.intent,operationId:"other"},fx.context),e=>e.code==="pending-instance-operation");
});
test("concurrent identical requests serialize and permission is rechecked on replay",async()=>{
  const fx=makeItemInstanceFixture();
  const [a,b]=await Promise.all([fx.workflow.run(fx.intent,fx.context),fx.workflow.run(fx.intent,fx.context)]);
  assert.equal(a.itemId,b.itemId);assert.equal(fx.total(),10);
  await assert.rejects(fx.workflow.run(fx.intent,{...fx.context,authorize:()=>{throw Error("denied")}}),/denied/);
});


for(const phase of ["createTarget","debitSource","writePlacement"]) {
  test(`authority loss after ${phase} resumes on the next GM without duplicate units`,async()=>{
    const fx=makeItemInstanceFixture();let lost=false;
    const context={...fx.context,assertAuthority:()=>{if(lost)throw Error("authority lost");}};
    fx.failAt(phase,"after",()=>{lost=true;});
    await assert.rejects(fx.workflow.run(fx.intent,context),/authority lost/);
    fx.restart();await fx.workflow.run(fx.intent,fx.context);
    assert.equal(fx.total(),10);assert.equal(fx.quantity("rope"),7);
  });
}

test("missing target after debit blocks replay and never issues replacement",async()=>{
  const fx=makeItemInstanceFixture();fx.failAt("finish","before");
  await assert.rejects(fx.workflow.run(fx.intent,fx.context));fx.removeItem("target");fx.restart();
  await assert.rejects(fx.workflow.run(fx.intent,fx.context),e=>e.code==="manual-review");
  assert.equal(fx.quantity("rope"),7);assert.equal(fx.quantity("target"),0);
});
