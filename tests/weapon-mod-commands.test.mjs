import test from "node:test";
import assert from "node:assert/strict";
import {optionalModule,required} from "./helpers/weapon-mod-fixture.mjs";
const commands=await optionalModule(new URL("../scripts/application/weapon-mod-mutation-commands.js",import.meta.url));
const valid=name=>required(commands,name);
const base={actorUuid:"Actor.hero",hostItemId:"weapon",componentItemId:"mod",operationId:"request"};
test("attachment, approval and activity commands accept only exact typed payloads",()=>{
  const install=valid("isValidWeaponAttachmentInstallPayload"),remove=valid("isValidWeaponAttachmentRemovePayload"),approval=valid("isValidWeaponModernizationApprovalPayload"),activity=valid("isValidWeaponModActivityPayload");
  assert.equal(install(base),true);assert.equal(install({...base,mountId:"bottom-2"}),true);assert.equal(remove(base),true);
  assert.equal(install({...base,mountId:"top",mountIds:["top","side-1"]}),true);
  assert.equal(install({...base,mountIds:["top","top"]}),false);
  assert.equal(install({...base,mountIds:["top","unknown"]}),false);
  for(const p of [{...base,profile:{}},{...base,sender:{id:"gm"}},{...base,mountId:"unknown"},{...base,operationId:""}])assert.equal(install(p),false);
  assert.equal(remove({...base,mountId:"top"}),false);
  const a={actorUuid:base.actorUuid,hostItemId:base.hostItemId,sourceId:"part",profileSignature:"signature",operationId:"approval"};
  assert.equal(approval(a),true);assert.equal(approval({...a,approvedByUserId:"gm"}),false);
  const use={actorUuid:base.actorUuid,hostItemId:"weapon",childItemId:"mod",activityId:"aim",operationId:"use",decision:null};
  assert.equal(activity(use),true);assert.equal(activity({...use,decision:{arbitrary:true}}),false);
  assert.equal(activity({...use,decision:{kind:"target-effects",targetUuid:"Token.t",attackMessageId:"attack",targetVisible:null,canHear:true,hiddenFromTarget:true,materialTarget:null}}),true);
  for(const decision of [{kind:"launcher-prepare",grenadeItemId:"grenade"},{kind:"launcher-consume",prepareOperationId:"p",grenadeItemId:"g"},{kind:"launcher-ack",prepareOperationId:"p",cardId:"c"}]){
    assert.equal(activity({...use,decision}),true);assert.equal(activity({...use,decision:{...decision,approvedByUserId:"forged"}}),false);
  }
  const modernize=valid("isValidWeaponModernizationInstallPayload");
  assert.equal(modernize(base),true);assert.equal(modernize({...base,removeItemId:"old",approvalReceiptId:"gm-audit"}),true);
  assert.equal(modernize({...base,completionReceipt:{approved:true}}),false);assert.equal(modernize({...base,costCp:0}),false);
});
test("command executor resolves live Items and uses authenticated sender, reserved activities do not write",async()=>{
  const registrations=new Map(),seen=[],sender={id:"player",isGM:false},actor={items:{get:id=>({id,parent:actor})},testUserPermission:()=>true};
  const old=globalThis.fromUuid;globalThis.fromUuid=async()=>actor;
  try{
    valid("registerWeaponModCommands")({itemUpgradeService:{installWeaponAttachment:async(...args)=>{seen.push(args);return {changed:true};}}},{register:(name,value)=>registrations.set(name,value)});
    const command=registrations.get("item-mod.attachment.install"),context={sender,assertActiveGm:()=>{}};
    assert.equal(await command.authorize(base,context),true);await command.execute(base,context);
    assert.equal(seen[0][2].sender,sender);assert.equal(seen[0][0].id,"weapon");assert.equal(seen[0][1].id,"mod");
    await assert.rejects(()=>registrations.get("item-mod.activity.use").execute({...base,activityId:"aim"},context),e=>e.code==="unsupported-weapon-mod-activity");
    assert.equal(seen.length,1);
  }finally{globalThis.fromUuid=old;}
});
