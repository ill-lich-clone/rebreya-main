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
function fixture(callback = lL) {
  const Hooks = { events: { preUpdateCombat: [{ fn: callback }] }, on(name, fn) { (this.events[name] ??= []).push({ fn }); }, off(name, fn) { this.events[name] = (this.events[name] ?? []).filter(e => e.fn !== fn); } };
  const setting = { onChange: Function("Hooks", callback.name, `return function(enabled) { if (enabled) Hooks.on("preUpdateCombat", ${callback.name}); else Hooks.off("preUpdateCombat", ${callback.name}); }`)(Hooks, callback) };
  const game = { modules: new Map([["chris-premades", { active: true, version: "1.5.44" }]]), settings: { settings: new Map([["chris-premades.legendaryActionsPrompt", setting]]) } };
  return { hooks: Hooks, setting, game };
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
test("CPR compatibility survives newer versions and renamed callback", () => {
  const renamed = function otherName(combat, data, options) {
    const marker = "legendaryActionsUsed resources.legact.value identifiedItems lastPrompt CHRISPREMADES.Combat.LegendaryActions.Prompt.Title togglePause() .nextTurn()";
    if (!marker || options.direction !== 1) return;
    const candidates = combat.combatants.filter(c => c.id !== combat.current.combatantId);
    const groups = candidates.map(c => c.actor.identifiedItems.flat().filter(i => i.system.activities.some(a => a.activation.type === "legendary")));
    if (!candidates.length) return;
    return groups.map(g => g[0].actor.name);
  };
  const { hooks, game } = fixture(renamed); game.modules.get("chris-premades").version = "9.0.0";
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("CPR compatibility handles a setting initially disabled", () => {
  const { hooks, setting, game } = fixture();
  delete hooks.events.preUpdateCombat;
  installCprLegendaryActionCompat({ hooks, game });
  setting.onChange(true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("a near-match unrelated hook is never replaced", () => {
  const { hooks, game } = fixture();
  const unrelated = function () { return "legendaryActionsUsed resources.legact.value identifiedItems lastPrompt"; };
  hooks.events.preUpdateCombat.unshift({ fn: unrelated });
  installCprLegendaryActionCompat({ hooks, game });
  assert.equal(hooks.events.preUpdateCombat[0].fn, unrelated);
});
test("already fixed CPR callback is left untouched", () => {
  function fixed(combat, data, options) {
    const marker = "legendaryActionsUsed resources.legact.value identifiedItems lastPrompt CHRISPREMADES.Combat.LegendaryActions.Prompt.Title togglePause() .nextTurn()";
    const groups = combat.combatants.map(c => c.actor.identifiedItems.flat());
    return marker && groups.map(g => g[0]?.actor?.name);
  }
  const { hooks, setting, game } = fixture(fixed); game.modules.get("chris-premades").version = "9.0.0"; game.settings.get = () => true;
  const originalOnChange = setting.onChange;
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), false);
  assert.equal(hooks.events.preUpdateCombat[0].fn, fixed);
  assert.equal(setting.onChange, originalOnChange);
});
test("callback registered under an alias is detected by its vulnerable structure", () => {
  const { hooks, setting, game } = fixture(lL);
  const alias = lL; const Hooks = hooks;
  setting.onChange = function(enabled) { if (enabled) Hooks.on("preUpdateCombat", alias); else Hooks.off("preUpdateCombat", alias); };
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("an unrecognized enabled CPR callback emits a diagnostic", () => {
  function changed(combat) { return combat[0].actor; }
  const { hooks, game } = fixture(changed); game.settings.get = () => true;
  let messages = []; const previous = console.warn; console.warn = message => messages.push(message);
  try { assert.equal(installCprLegendaryActionCompat({ hooks, game }), false); assert.equal(messages.length, 1); }
  finally { console.warn = previous; }
});


test("asynchronous setting activation patches the registered hook", async () => {
  const { hooks, setting, game } = fixture(lL);
  delete hooks.events.preUpdateCombat;
  const Hooks = hooks;
  setting.onChange = async function(enabled) { await Promise.resolve(); if (enabled) Hooks.on("preUpdateCombat", lL); };
  installCprLegendaryActionCompat({ hooks, game });
  await setting.onChange(true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("callback registered through an object member is detected", () => {
  const { hooks, setting, game } = fixture(lL);
  const Hooks = hooks, combat = { legendary: lL };
  setting.onChange = function(enabled) { if (enabled) Hooks.on("preUpdateCombat", combat.legendary); else Hooks.off("preUpdateCombat", combat.legendary); };
  assert.equal(installCprLegendaryActionCompat({ hooks, game }), true);
  assert.deepEqual(hooks.events.preUpdateCombat[0].fn(makeCombat([false, true]), {}, { direction: 1 }), ["actor-1"]);
});
test("ambiguous matching callbacks are not modified", () => {
  const { hooks, game } = fixture(lL);
  const same = Function(`return (${lL.toString()})`)();
  hooks.events.preUpdateCombat.push({ fn: same });
  const previous = console.warn; console.warn = () => {};
  try { assert.equal(installCprLegendaryActionCompat({ hooks, game }), false); }
  finally { console.warn = previous; }
  assert.equal(hooks.events.preUpdateCombat[0].fn, lL);
  assert.equal(hooks.events.preUpdateCombat[1].fn, same);
});
