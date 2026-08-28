import assert from "node:assert/strict";
import test from "node:test";

function makeActor({
  size = "med",
  racialReachBonusFeet = 0,
  runeReach = 0,
  disabled = false,
  suppressed = false,
  appliedSize = "huge"
} = {}) {
  const effects = runeReach > 0 ? [{
    disabled,
    isSuppressed: suppressed,
    flags: {
      "rebreya-main": {
        runeKnight: {
          automation: "giant-might-form",
          reachBonus: runeReach,
          form: { appliedActorSize: appliedSize }
        }
      }
    }
  }] : [];
  return {
    system: { traits: { size } },
    flags: {
      "rebreya-main": {
        racialReachBonusFeet,
        weaponReachBonusFeet: 100
      }
    },
    effects: { contents: effects },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("natural reach combines size, racial, and active Rune Knight bonuses without weapon data", async () => {
  const { getNaturalReachFeet } = await import("../scripts/combat/natural-reach.js");

  assert.equal(getNaturalReachFeet(makeActor({ size: "tiny" })), 0);
  assert.equal(getNaturalReachFeet(makeActor({ size: "lg" })), 10);
  assert.equal(getNaturalReachFeet(makeActor({
    size: "huge",
    racialReachBonusFeet: 5,
    runeReach: 5
  })), 25);
});

test("natural reach ignores inactive and non-Huge Rune Knight effects", async () => {
  const { getNaturalReachFeet } = await import("../scripts/combat/natural-reach.js");

  assert.equal(getNaturalReachFeet(makeActor({ size: "huge", runeReach: 5, disabled: true })), 15);
  assert.equal(getNaturalReachFeet(makeActor({ size: "huge", runeReach: 5, suppressed: true })), 15);
  assert.equal(getNaturalReachFeet(makeActor({ size: "lg", runeReach: 5, appliedSize: "lg" })), 10);
});
