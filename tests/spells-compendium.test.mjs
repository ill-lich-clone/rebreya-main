import test from "node:test";
import assert from "node:assert/strict";

const { buildRebreyaSpellItem } = await import("../scripts/data/spells-compendium.js");

function counterspellSource() {
  return {
    _id: "nativecountersp01",
    name: "Counterspell",
    type: "spell",
    img: "icons/magic/defensive/barrier-shield-dome-blue.webp",
    system: {
      identifier: "counterspell",
      level: 3,
      source: {
        custom: "Player's Handbook"
      },
      properties: ["vocal", "somatic"],
      range: {
        value: "60",
        units: "ft",
        special: ""
      },
      activities: {
        counterspell: {
          _id: "counterspell",
          type: "utility",
          activation: {
            type: "reaction",
            value: 1,
            condition: "when you see a creature casting a spell"
          },
          consumption: {
            targets: [],
            scaling: {
              allowed: true,
              max: ""
            }
          },
          spell: {
            level: 3,
            scaling: {
              mode: "level",
              formula: ""
            }
          }
        }
      }
    },
    effects: [],
    flags: {
      dnd5e: {
        riders: {
          activity: []
        }
      }
    }
  };
}

test("Rebreya Counterspell is a third-level reaction spell", () => {
  const item = buildRebreyaSpellItem(counterspellSource());

  assert.equal(item.system.identifier, "counterspell-rebreya");
  assert.equal(item.system.level, 3);
  assert.equal(item.system.activities.counterspell.activation.type, "reaction");
  assert.deepEqual(item.flags["rebreya-main"].spellAutomation, { kind: "counterspell" });
  assert.deepEqual(item.system.properties, ["vocal", "somatic"]);
  assert.deepEqual(item.system.range, { value: "60", units: "ft", special: "" });
  assert.deepEqual(item.system.activities.counterspell.spell.scaling, {
    mode: "level",
    formula: ""
  });
});

test("Rebreya Counterspell strips native check activities so automation owns the roll outcome", () => {
  const source = counterspellSource();
  source.system.activities.counterspell = {
    ...source.system.activities.counterspell,
    type: "check",
    check: {
      ability: "int",
      dc: {
        calculation: "spellcasting"
      }
    }
  };
  source.system.activities.backup = {
    _id: "backup",
    type: "utility",
    activation: {
      type: "reaction",
      value: 1,
      condition: ""
    },
    consumption: {
      targets: [],
      scaling: {
        allowed: true,
        max: ""
      }
    },
    spell: {
      level: 3,
      scaling: {
        mode: "level",
        formula: ""
      }
    }
  };

  const item = buildRebreyaSpellItem(source);

  assert.deepEqual(Object.keys(item.system.activities), ["counterspell"]);
  assert.equal(item.system.activities.counterspell.type, "utility");
  assert.equal(item.system.activities.counterspell.check, undefined);
});
