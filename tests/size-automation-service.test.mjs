import test from "node:test";
import assert from "node:assert/strict";

globalThis.CONST ??= { ACTIVE_EFFECT_MODES: { ADD: 2 } };

const { getCharacterSizeRule, buildCharacterSizeEffectData } = await import(
  "../scripts/combat/size-automation-service.js"
);

test("Teyvankal character size table exposes AC, checks, and base reach", () => {
  const expected = {
    tiny: [2, -2, 2, 0],
    sm: [1, -1, 1, 5],
    med: [0, 0, 0, 5],
    lg: [-1, 1, -1, 10],
    huge: [-2, 2, -2, 15],
    grg: [-3, 3, -3, 20]
  };

  for (const [size, values] of Object.entries(expected)) {
    const rule = getCharacterSizeRule(size);
    assert.deepEqual(
      [rule.ac, rule.strengthChecks, rule.dexterityChecks, rule.baseReachFeet],
      values
    );
  }
});

test("Medium has no managed modifier effect and Large has three visible changes", () => {
  assert.equal(buildCharacterSizeEffectData("med"), null);

  const large = buildCharacterSizeEffectData("lg");
  assert.deepEqual(large.changes.map(({ key, value }) => [key, value]), [
    ["system.attributes.ac.bonus", "-1"],
    ["system.abilities.str.bonuses.check", "1"],
    ["system.abilities.dex.bonuses.check", "-1"]
  ]);
  assert.equal(large.flags["rebreya-main"].sizeAutomation.managed, true);
});
