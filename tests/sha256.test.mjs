import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "../scripts/shared/sha256.js";

test("synchronous UTF-8 SHA-256 agrees with Node crypto across padding boundaries and Unicode",()=>{
  for(const value of ["","abc","Сундук с усовершенствованиями 🎲",...Array.from({length:130},(_,length)=>"x".repeat(length)),"long".repeat(50000)]){
    assert.equal(sha256Hex(value),createHash("sha256").update(value,"utf8").digest("hex"));
  }
  assert.throws(()=>sha256Hex(null),TypeError);
});
