import test from "node:test";
import assert from "node:assert/strict";
import { installCprLegendaryActionCompat } from "../scripts/integrations/cpr-legendary-compat.js";

function lL(combat, data, options) {
  // Signatures identify the original CPR handler, never unrelated hooks.
  const marker = "legendaryActionsUsed resources.legact.value identifiedItems lastPrompt CHRISPREMADES.Combat.LegendaryActions.Prompt.Title togglePause() .nextTurn()";
  if (!marker || options.direction !== 1) return;
  const candidates = combat.combatants.filter(c => c.id !== combat.current.combatantId);
  const groups = candidates.map(c => c.actor.identifiedItems.flat().filter(i => i.system.activities.some(a => a.activation.type === "legendary")));
  if (!candidates.length) return;
  return groups.map(g => g[0].actor.name);
}
function makeCombat(valid) {
  const actors = valid.map((ok, i) => { const actor = { name: `actor-${i}`, system: { resources: { legact: { value: 3 } } } }; actor.identifiedItems = [[...(ok ? [{ actor, system: { activities: [{ activation: { type: "legendary", value: 1 }, consumption: { targets: [] } }] } }] : [])]]; return { id: `${i}`, actor }; });
  return { combatants: actors, current: { combatantId: "current" }, flags: {} };
}
function fixture() {
  let hooks = { events: { preUpdateCombat: [{ fn: lL }] } };
  let setting = { onChange(enabled) { if (!enabled) hooks.events.preUpdateCombat = hooks.events.preUpdateCombat.filter(e => e.fn !== lL); else hooks.events.preUpdateCombat.push({ fn: lL }); } };
  let game = { modules: new Map([["chris-premades", { active: true, version: "1.5.44" }]]), settings: { settings: new Map([["chris-premades.legendaryActionsPrompt", setting]]) } };
  return { hooks, setting, game };
}
test("CPR compatibility preserves valid actors and ignores empty action groups", () => {
  const { hooks, setting, game } = fixture();
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), true);
  let run = () => hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 });
  assert.deepEqual(run(), ["actor-1"]);
  assert.equal(hooks.events.preUpdateCombat[0].fn(makeCombat([false]), {}, { direction: 1 }), undefined);
  setting.onChange(false); assert.equal(hooks.events.preUpdateCombat.length, 0);
  setting.onChange(true); assert.deepEqual(run(), ["actor-1"]);
  installCprLegendaryActionCompat({ hooks, game }); assert.deepEqual(run(), ["actor-1"]);
});
test("CPR compatibility leaves unknown version and unrelated hooks untouched", () => {
  const { hooks, game } = fixture(); game.modules.get("chris-premades").version = "9.0.0";
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), false);
  assert.equal(hooks.events.preUpdateCombat[0].fn, lL);
});
test("CPR compatibility handles a setting initially disabled", () => {
  const { hooks, setting, game } = fixture();
  delete hooks.events.preUpdateCombat;
  setting.onChange = enabled => { if (enabled) hooks.events.preUpdateCombat = [{ fn: lL }]; };
  installCprLegendaryActionCompat({ hooks, game });
  setting.onChange(true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("active unsupported CPR version produces a diagnostic", () => {
  const { hooks, game } = fixture(); game.modules.get("chris-premades").version = "9.0.0";
  let messages = []; const previous = console.warn; console.warn = message => messages.push(message);
  try { assert.equal(installCprLegendaryActionCompat({ hooks, game }), false); assert.equal(messages.length, 1); }
  finally { console.warn = previous; }
});
test("a near-match unrelated hook is never replaced", () => {
  const { hooks, game } = fixture();
  const unrelated = function () { return "legendaryActionsUsed resources.legact.value identifiedItems lastPrompt"; };
  hooks.events.preUpdateCombat.unshift({ fn: unrelated });
  installCprLegendaryActionCompat({ hooks, game });
  assert.equal(hooks.events.preUpdateCombat[0].fn, unrelated);
});
