import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await import("../scripts/combat/whirlwind-attack.js?v=1.5.1");
let calculateDamage;
try {
  const map = JSON.parse(await readFile(new URL("../../../systems/dnd5e/dnd5e-compiled.mjs.map", import.meta.url), "utf8"));
  const source = map.sourcesContent[map.sources.indexOf("module/documents/actor/actor.mjs")];
  const start = source.indexOf("  calculateDamage(damages, options={}) {");
  const end = source.indexOf("\n    return damages;\n  }", start) + "\n    return damages;\n  }".length;
  if (start >= 0 && end > start) calculateDamage = new Function(`return ({${source.slice(start, end)}}).calculateDamage`)();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

test("installed dnd5e calculator preserves mixed damage rounding, resistance, immunity, critical totals and native targeting", { skip: !calculateDamage && "Installed dnd5e source map unavailable" }, () => {
  assert.equal(typeof rules.applyWhirlwindDamage, "function");
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };
  globalThis.CONFIG = { DND5E: { damageTypes: { slashing: { isPhysical: true }, fire: {} }, healingTypes: { healing: {}, temphp: {} } } };
  globalThis.Hooks = { call: (name, actor, damages, options) => name === "dnd5e.preCalculateDamage" ? rules.applyWhirlwindDamage(actor, damages, options) : true };
  const actor = { system: { traits: {} }, getRollData: () => ({}) };
  const packet = (value, type = "slashing", extra = false) => ({ value, type, properties: new Set(["rebreyaWhirlHalf", ...(extra ? ["rebreyaWhirlTarget:Token.A"] : [])]) });
  assert.equal(calculateDamage.call(actor, [packet(5), packet(5, "fire")]).amount, 5);
  assert.equal(calculateDamage.call(actor, [packet(10), packet(6, "slashing", true)], { rebreyaWhirlwindTargetUuid: "Token.A" }).amount, 8);
  assert.equal(calculateDamage.call(actor, [packet(10), packet(6, "slashing", true)], { rebreyaWhirlwindTargetUuid: "Token.B" }).amount, 5);
  actor.system.traits.dr = { value: new Set(["slashing"]), bypasses: new Set() };
  assert.equal(calculateDamage.call(actor, [packet(18)]).amount, 4);
  actor.system.traits.di = { value: new Set(["fire"]), bypasses: new Set() };
  assert.equal(calculateDamage.call(actor, [packet(18), packet(20, "fire")]).amount, 4);
  assert.equal(calculateDamage.call(actor, [{ value: 18, type: "slashing", properties: new Set() }]).amount, 9);
});

test("installed MIDI damage aggregation respects serializable per-target roll properties", async () => {
  const path = new URL("../../midi-qol/midi-qol.js", import.meta.url);
  let source;
  try { source = await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  assert.match(source, /aggregateDamageRolls\(rolls, \{ respectProperties: true \}\)/);
  assert.match(source, /properties: new Set\(roll2.options.properties \?\? \[\]\)/);
  assert.match(source, /targetUuid: token.document.uuid/);
});
