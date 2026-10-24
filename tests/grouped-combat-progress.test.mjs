import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import vm from "node:vm";
import { registerGroupedCombatRuntime } from "../scripts/integrations/grouped-combat-runtime.js";

const appRoot = process.env.REBREYA_FOUNDRY_APP_ROOT ?? "D:/FoundryVTT/Foundry Virtual Tabletop/resources/app";
const dataRoot = process.env.REBREYA_FOUNDRY_DATA_ROOT ?? "D:/FoundryVTT/Data";
const core = await readFile(join(appRoot, "client/documents/combat.mjs"), "utf8");
const dnd = await readFile(join(dataRoot, "systems/dnd5e/dnd5e.mjs"), "utf8");
const method = (source, name, from = 0) => {
  const start = source.indexOf(`  ${name}(`, from), end = source.indexOf("\n  }\n", start);
  if (start < 0 || end < 0) throw new Error(`Installed combat method missing: ${name}`);
  return source.slice(start, end + 4);
};

function fixture() {
  let sheets = 0, rings = 0, bookkeeping = 0;
  class Base { _onUpdate() { bookkeeping++; } _getCurrentState() { return this.current; } }
  const Core = vm.runInNewContext(`(class Combat extends Base { #recordPreviousState() { return false; } ${method(core, "_onUpdate")} ${method(core, "updateCombatantActors")} })`, { Base, foundry: { utils: { deepClone: structuredClone } } });
  const Combat = vm.runInNewContext(`(class Combat5e extends Core { ${method(dnd, "_onUpdate", dnd.indexOf("class Combat5e extends Combat"))} })`, { Core });
  class Combatant { refreshDynamicRing() { rings++; } }
  class Combatants extends Map { [Symbol.iterator]() { return this.values(); } }
  const combat = new Combat(), state = { mode: "active", pendingTransition: { operationId: "work" }, groups: [] };
  Object.assign(combat, { id: "fight", flags: { "rebreya-main": { groupedCombat: state } }, current: { round: 1, turn: 1, combatantId: "a" }, previous: { round: 1, turn: 0, combatantId: "b" }, combatants: new Combatants() });
  for (const id of ["a", "b", "c"]) { const c = new Combatant(); Object.assign(c, { id, parent: combat, actor: { render() { sheets++; } } }); combat.combatants.set(id, c); }
  const dispose = registerGroupedCombatRuntime({ groupedCombatService: { effects: { installNativeGuards() {} } } }, { CombatClass: Combat, CombatantClass: Combatant, Hooks: {} });
  return { combat, state, dispose, counts: () => ({ sheets, rings, bookkeeping }) };
}
const options = () => ({ render: false, turnEvents: false, "rebreya-main": { groupedCombatProgress: true } });
const progress = () => ({ _id: "fight", flags: { "rebreya-main": { groupedCombat: { revision: 2, receipts: { effect: { status: "running" } } } } } });

test("journal updates run native Document bookkeeping without per-receipt actor/ring refreshes", () => {
  const e = fixture();
  try { for (let i = 0; i < 40; i++) e.combat._onUpdate(progress(), options(), "gm"); assert.deepEqual(e.counts(), { sheets: 0, rings: 0, bookkeeping: 40 }); }
  finally { e.dispose(); }
});

test("final, ordinary, unmarked and mixed updates retain native actor/ring refreshes", () => {
  for (const variant of ["final", "ordinary", "unmarked", "position", "foreign", "mixed", "foreign-id"]) {
    const e = fixture(), changed = progress(), opts = options();
    if (variant === "final") delete e.state.pendingTransition;
    if (variant === "ordinary") e.combat.flags = {};
    if (variant === "unmarked") delete opts["rebreya-main"];
    if (variant === "position") changed.round = 2;
    if (variant === "foreign") changed.flags.other = {};
    if (variant === "mixed") changed.flags["rebreya-main"].other = {};
    if (variant === "foreign-id") changed._id = "another-combat";
    try { e.combat._onUpdate(changed, opts, "gm"); assert.deepEqual(e.counts(), { sheets: 3, rings: 2, bookkeeping: 1 }, variant); }
    finally { e.dispose(); }
  }
});
