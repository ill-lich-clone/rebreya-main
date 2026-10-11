import test from "node:test";
import assert from "node:assert/strict";
import { getTreatWoundsTiers, resolveTreatWoundsOutcome } from "../scripts/application/treat-wounds-rules.js";

test("healer thresholds preserve lower choices and fractional CR", () => {
  for (const [level, dcs] of [[0.5,[10]],[4,[10]],[5,[10,15]],[10,[10,15]],[11,[10,15,20]],[16,[10,15,20]],[17,[10,15,20,25]]]) {
    assert.deepEqual(getTreatWoundsTiers(level).map(t=>t.dc),dcs);
  }
  assert.deepEqual(getTreatWoundsTiers(17).map(t=>t.bonus),[0,10,30,50]);
});
test("four margins use authored dice; custom DC does not change selected bonus", () => {
  for (const [total,kind,formula,bonus] of [[25,"critical-success","4d8",30],[20,"success","2d8",30],[19,"failure",null,0],[16,"failure",null,0],[15,"critical-failure","1d8",0]]) {
    const result=resolveTreatWoundsOutcome({total,dc:20,bonus:30});
    assert.equal(result.kind,kind); assert.equal(result.formula,formula); assert.equal(result.bonus,bonus);
    assert.equal(result.canContinue,total>=20);
  }
  assert.equal(resolveTreatWoundsOutcome({total:1,dc:1,bonus:10}).kind,"success");
  assert.equal(resolveTreatWoundsOutcome({total:20,dc:26,bonus:50}).kind,"critical-failure");
  assert.throws(()=>resolveTreatWoundsOutcome({total:NaN,dc:10,bonus:0}));
});
