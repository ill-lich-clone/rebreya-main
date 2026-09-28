import test from "node:test";
import assert from "node:assert/strict";
import { getUpgradeChoiceOptions, validateUpgradeChoices } from "../scripts/data/item-upgrade-choices.js";

test("absorption choices are finite and intersect the supported system damage types", () => {
  assert.deepEqual(getUpgradeChoiceOptions("cheshuya-monstra", ["fire","slashing"]), ["fire"]);
  assert.deepEqual(getUpgradeChoiceOptions("zacharovanie-pogloshcheniya", ["fire","healing","invented","slashing"]), ["fire","slashing"]);
  assert.deepEqual(validateUpgradeChoices("cheshuya-monstra", {damageType:"fire"}), {damageType:"fire"});
  for(const value of [null,{}, {damageType:"slashing"}, {damageType:"fire",arbitrary:true}]) {
    assert.throws(()=>validateUpgradeChoices("cheshuya-monstra",value),e=>e.code==="invalid-choice");
  }
  assert.deepEqual(validateUpgradeChoices("zacharovanie-ostroty", undefined),{});
  assert.throws(()=>validateUpgradeChoices("zacharovanie-ostroty",{damageType:"fire"}));
});

test("choice dialog cancellation does not call installation; selected value is passed to the canonical service", async () => {
  const { installItemUpgradeWithChoices } = await import("../scripts/integrations/item-upgrade-sheet.js");
  const previous = { foundry:globalThis.foundry, game:globalThis.game, CONFIG:globalThis.CONFIG };
  let answer=false, installs=0, received;
  globalThis.game={i18n:{localize:s=>s}};globalThis.CONFIG={DND5E:{damageTypes:{fire:{label:"Fire"}}}};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
    assert.equal(config.buttons[1].callback(),false);assert.equal(config.close(),false);
    return answer ? config.buttons[0].callback(null,{form:{elements:{namedItem:()=>({value:"fire"})}}}) : false;
  }}}}};
  const api={itemUpgradeService:{getUpgradeProjection:async()=>({requiresChoice:true,availability:{available:true},choiceOptions:["fire"]})},installItemUpgrade:async(_host,_upgrade,options)=>{installs++;received=options;return {};}};
  try {
    assert.equal(await installItemUpgradeWithChoices({}, {name:"Scale"},api),null);assert.equal(installs,0);
    answer=true;await installItemUpgradeWithChoices({}, {name:"Scale"},api);
    assert.equal(installs,1);assert.deepEqual(received,{choices:{damageType:"fire"}});
  } finally { Object.assign(globalThis,previous); }
});
