import test from "node:test";
import assert from "node:assert/strict";
import * as sheet from "../scripts/integrations/dnd5e-sheet-extensions.js";
for (const [mode, native, keep] of [["advantage","adv","kh"],["disadvantage","dis","kl"],["advantage","adv2","kh"]]) {
  test("heroic "+native+" uses three dice and one selection rule, including after reconfiguration", () => {
    const roll = {validD20Roll:true,options:{rebreyaHeroicMode:mode},d20:{number:1,modifiers:["r1=1",native,"min10"]},resetFormula(){}};
    for(let i=0;i<2;i++) sheet.applyHeroicD20RollModifiers(roll);
    assert.equal(roll.d20.number,3);
    assert.deepEqual(roll.d20.modifiers,["r1=1","min10",keep]);
  });
}
