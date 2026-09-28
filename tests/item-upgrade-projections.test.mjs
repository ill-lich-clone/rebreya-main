import test from "node:test";
import assert from "node:assert/strict";
import { buildSimpleUpgradeContributions, buildUpgradeContributionKey, projectSimpleUpgradeItem } from "../scripts/automation/item-upgrade-projections.js";

const host = (sourceId, patch = {}) => ({ id: "host", descriptor: { isEquipped: true, isHeld: true, isBroken: false },
  source: { system: { properties: [], strength: 13, weight: { value: 15, units: "lb" } } },
  upgrades: [{ id: "upgrade", sourceId, valid: true }], ...patch });
const project = hosts => buildSimpleUpgradeContributions({ actor: { uuid: "Actor.a", type: "character", source: { system: { attributes: { hp: { max: null } } } } }, hosts });
const cases = [
  ["dushevnoe-zacharovanie", [["system.skills.per.bonuses.check", 1], ["system.skills.prf.bonuses.check", 1]]],
  ["oskolok-cherepa-chudovishcha", [["system.skills.itm.bonuses.check", 1]]],
  ["koren-drakonego-dereva", [["system.attributes.hp.bonuses.overall", 5]]],
  ["maloe-zacharovanie-stoykosti", [["system.bonuses.abilities.save", 1]]],
  ["maloe-zacharovanie-zashchity", [["system.attributes.ac.bonus", 1]]],
  ["zacharovanie-zashchity", [["system.attributes.ac.bonus", 1], ["system.bonuses.abilities.save", 1]]],
  ["poroshok-drokhuby", [["system.attributes.movement.walk", 10]]],
  ["sherst-griffona", [["system.attributes.movement.walk", 5]]]
];
for (const [id, expected] of cases) test(`${id} contributes its complete native actor bonus`, () => {
  const input = host(id), before = structuredClone(input);
  assert.deepEqual(project([input]).contributions.map(c => [c.path, c.value]), expected);
  assert.deepEqual(input, before);
  input.descriptor.isEquipped = false;
  assert.equal(project([input]).contributions.length, 0);
  input.descriptor.isEquipped = true; input.descriptor.isBroken = true;
  assert.equal(project([input]).contributions.length, 0);
});
test("identity separates identical hosts and keys cannot collide at separators", () => {
  const a = host("maloe-zacharovanie-zashchity"), b = host("maloe-zacharovanie-zashchity", { id: "host2", upgrades: [{ id: "upgrade2", sourceId: "maloe-zacharovanie-zashchity", valid: true }] });
  const result = project([a,b]);
  assert.equal(new Set(result.contributions.map(c => c.key)).size, 2);
  for (const contribution of result.contributions) {
    assert.equal(contribution.effectKey, "0");
    assert.equal(JSON.parse(contribution.key)[3], contribution.effectKey);
  }
  assert.notEqual(buildUpgradeContributionKey({ actorUuid: "a:b", hostItemId: "c" }), buildUpgradeContributionKey({ actorUuid: "a", hostItemId: "b:c" }));
  a.upgrades[0].valid = false;
  assert.equal(project([a]).contributions.length, 0);
});
test("chitin, mithral and moon metal remove only native armor restrictions, moon checks original stealth", () => {
  for (const id of ["khitinovoe-pokrytie", "mifrilovaya-peredelka-dospekha", "lunnyy-metall"]) {
    const h = host(id); h.source.system.properties = ["stealthDisadvantage", "magical"];
    const contributions = project([h]).contributions;
    const system = structuredClone(h.source.system); system.properties = new Set(system.properties);
    projectSimpleUpgradeItem(system, contributions);
    assert.deepEqual([...system.properties], ["magical"]);
    assert.equal(system.strength, id === "mifrilovaya-peredelka-dospekha" ? 0 : 13);
    assert.equal(contributions.filter(c => c.scope === "actor").length, 0);
  }
  const h = host("lunnyy-metall");
  assert.deepEqual(project([h]).contributions.filter(c => c.scope === "actor").map(c => [c.path, c.value]), [["system.skills.ste.roll.mode", 1]]);
});
test("weight subtracts ten pounds, clamps at zero and preserves each fresh source edit", () => {
  const h = host("zacharovanie-lyogkosti"); h.descriptor.isEquipped = false;
  for (const [value, units, expected] of [[15,"lb",5],[5,"lb",0],[10,"kg",5.4640763],[40,"lb",30]]) {
    const system = { weight: { value, units } };
    projectSimpleUpgradeItem(system, project([h]).contributions);
    assert.ok(Math.abs(system.weight.value - expected) < 1e-7);
  }
  assert.equal(h.source.system.weight.value, 15);
});

test("HP uses the native hard-coded maximum path for NPC and explicit character max", () => {
  for (const type of ["npc", "character"]) {
    const result = buildSimpleUpgradeContributions({ actor: { uuid: "a", type, source: { system: { attributes: { hp: { max: 20 } } } } }, hosts: [host("koren-drakonego-dereva")] });
    assert.equal(result.contributions[0].path, "system.attributes.hp.max");
  }
});

test("holy steel doubles only the weapon's base dice and changes their type, leaving extra fire dice", () => {
  const h = host("svyashchennaya-stal");
  h.source.system.damage = { base: { number: 1, denomination: 8, bonus: "", types: ["slashing"] }, versatile: { number: 1, denomination: 10, bonus: "", types: ["slashing"] } };
  const system = structuredClone(h.source.system);
  system.damage.base.types = new Set(system.damage.base.types); system.damage.versatile.types = new Set(system.damage.versatile.types);
  system.extraDamage = { number: 1, denomination: 6, types: new Set(["fire"]) };
  projectSimpleUpgradeItem(system, project([h]).contributions);
  assert.equal(system.damage.base.number, 2); assert.equal(system.damage.versatile.number, 2);
  assert.deepEqual([...system.damage.base.types], ["radiant"]);
  assert.equal(system.extraDamage.number, 1); assert.deepEqual([...system.extraDamage.types], ["fire"]);
  assert.equal(h.source.system.damage.base.number, 1);
  h.source.system.damage.base.custom = { enabled: true, formula: "2d6 + 1d4" };
  assert.equal(project([h]).contributions.length, 0); assert.equal(project([h]).unavailable.length, 1);
});
