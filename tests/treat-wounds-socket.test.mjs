import test from "node:test";
import assert from "node:assert/strict";
import { isValidTreatWoundsPayload,authorizeTreatWoundsSender } from "../scripts/infrastructure/foundry/treat-wounds-command-contract.js";
const tokens={sourceTokenUuid:"Scene.aaaaaaaaaaaaaaaa.Token.bbbbbbbbbbbbbbbb",targetTokenUuid:"Scene.aaaaaaaaaaaaaaaa.Token.cccccccccccccccc"};
test("typed contract rejects extra result data, invalid tiers and foreign UUIDs",()=>{
  const start={...tokens,operationId:"op",kitItemUuid:"Actor.dddddddddddddddd.Item.eeeeeeeeeeeeeeee",groupActorId:"",tierDc:15,customDc:null};
  assert.equal(isValidTreatWoundsPayload("start",start),true);
  for(const patch of [{amount:50},{tierDc:30},{customDc:NaN},{kitItemUuid:"JournalEntry.secret"},{groupActorId:"bad"}])assert.equal(isValidTreatWoundsPayload("start",{...start,...patch}),false);
  assert.equal(isValidTreatWoundsPayload("continue",{operationId:"op"}),true);
  assert.equal(isValidTreatWoundsPayload("preview",tokens),true);
});
test("typed contract permits an explicit kitless request and rejects forged combinations",()=>{
  const start={...tokens,operationId:"op",kitItemUuid:"",groupActorId:"",tierDc:15,customDc:null,ignoreMissingKit:true};
  assert.equal(isValidTreatWoundsPayload("start",start),true);
  assert.equal(isValidTreatWoundsPayload("start",{...start,ignoreMissingKit:false}),false);
  assert.equal(isValidTreatWoundsPayload("start",{...start,groupActorId:"aaaaaaaaaaaaaaaa"}),false);
  assert.equal(isValidTreatWoundsPayload("start",{...start,ignoreMissingKit:"true"}),false);
});
test("custom DC is GM-only and sender must be live authenticated user",()=>{
  const player={id:"p"},gm={id:"g",isGM:true};const game={users:{get:id=>id==="p"?player:gm}};
  assert.equal(authorizeTreatWoundsSender("start",{customDc:12},{sender:player,game}),false);
  assert.equal(authorizeTreatWoundsSender("start",{customDc:12},{sender:gm,game}),true);
  assert.equal(authorizeTreatWoundsSender("start",{customDc:null},{sender:player,game}),true);
  assert.equal(authorizeTreatWoundsSender("start",{customDc:null},{sender:{id:"p"},game}),false);
});
