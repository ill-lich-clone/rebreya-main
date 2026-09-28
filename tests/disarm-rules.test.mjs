import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDisarmRules, resolveDisarmOutcome, calculateDisarmDropCell, buildDisarmAttackFormula } from "../scripts/combat/disarm-rules.js";

test("size limit, actual grip and the defender's chosen save determine modes", () => {
  const base = { attackerSize: "sm", targetSize: "med", heldHands: 2, saveAbility: "str" };
  assert.deepEqual(evaluateDisarmRules(base), { allowed: true, reason: null, attackMode: "disadvantage", saveMode: "advantage" });
  assert.equal(evaluateDisarmRules({ ...base, saveAbility: "dex" }).saveMode, "normal");
  assert.equal(evaluateDisarmRules({ ...base, heldHands: 1 }).attackMode, "normal");
  assert.equal(evaluateDisarmRules({ ...base, targetSize: "lg" }).allowed, false);
  assert.equal(evaluateDisarmRules({ ...base, targetSize: "tiny" }).saveMode, "normal");
  assert.equal(evaluateDisarmRules({ ...base, attackerSize: "med" }).saveMode, "normal");
  const cancelled = evaluateDisarmRules({ ...base, attackAdvantage: true, saveDisadvantage: true });
  assert.equal(cancelled.attackMode, "normal"); assert.equal(cancelled.saveMode, "normal");
  assert.equal(evaluateDisarmRules({ ...base, heldHands: 1, attackAdvantage: true }).attackMode, "advantage");
});

test("save ties succeed; natural die outcomes do not override the comparison", () => {
  assert.deepEqual(resolveDisarmOutcome({ attackTotal: 17, saveTotal: 17 }), { dc: 17, success: false, dropped: false });
  assert.deepEqual(resolveDisarmOutcome({ attackTotal: 17, saveTotal: 16 }), { dc: 17, success: true, dropped: true });
  assert.equal(resolveDisarmOutcome({ attackTotal: 1, saveTotal: 0 }).dropped, true);
  assert.equal(resolveDisarmOutcome({ attackTotal: 20, saveTotal: 21 }).dropped, false);
  assert.equal(buildDisarmAttackFormula({ abilityModifier: -1, proficiencyContribution: 3 }), "1d20 - 1 + 3");
});

test("d8 gives the external square clockwise from north, including large footprints", () => {
  const expected = [[150,50],[250,50],[250,150],[250,250],[150,250],[50,250],[50,150],[50,50]];
  for (let direction = 1; direction <= 8; direction++) {
    assert.deepEqual(calculateDisarmDropCell({ tokenBounds: { x:100,y:100,width:100,height:100 }, gridSize:100, direction }), { x:expected[direction-1][0], y:expected[direction-1][1] });
  }
  const tokenBounds = { x:100,y:100,width:200,height:300 };
  assert.deepEqual(calculateDisarmDropCell({ tokenBounds,gridSize:100,direction:1 }), {x:150,y:50});
  assert.deepEqual(calculateDisarmDropCell({ tokenBounds,gridSize:100,direction:4 }), {x:350,y:450});
  for (let direction=1; direction<=8; direction++) {
    const p=calculateDisarmDropCell({tokenBounds,gridSize:100,direction});
    assert.ok(p.x<100 || p.x>300 || p.y<100 || p.y>400);
  }
});

test("unknown rules and geometry reject instead of inventing a roll", () => {
  for (const patch of [{attackerSize:"unknown"},{heldHands:0},{saveAbility:"wis"},{attackAdvantage:"yes"}]) {
    assert.throws(()=>evaluateDisarmRules({attackerSize:"med",targetSize:"med",heldHands:1,saveAbility:"str",...patch}), e=>e.code==="invalid-disarm-rules");
  }
  for (const saveTotal of [NaN,Infinity,"17",undefined]) assert.throws(()=>resolveDisarmOutcome({attackTotal:17,saveTotal}));
  for (const patch of [{direction:0},{direction:9},{gridSize:0},{gridSize:NaN},{tokenBounds:{x:0,y:0,width:-1,height:100}}]) {
    assert.throws(()=>calculateDisarmDropCell({tokenBounds:{x:0,y:0,width:100,height:100},gridSize:100,direction:1,...patch}));
  }
  assert.throws(()=>buildDisarmAttackFormula({abilityModifier:NaN,proficiencyContribution:2}));
});
