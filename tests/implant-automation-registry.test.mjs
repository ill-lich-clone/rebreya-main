import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  SUPPORTED_MECHANICAL_IMPLANT_IDS,
  compileMechanicalImplants,
  getMechanicalImplantDefinition
} from "../scripts/data/implant-automation-registry.js";

const EXPECTED_IDS = [
  "nastroennye-servoprivody",
  "sokrushitelnye-konechnosti",
  "pomoshch-v-postroenii-traektorii",
  "dopolnitelnaya-konechnost",
  "kondensator-magii",
  "impulsnye-nogi",
  "modul-chuvstva-zhizni",
  "ultrazvukovye-datchiki",
  "modul-pareniya",
  "telepaticheskiy-modul",
  "silnye-nogi",
  "mekhanizm-perezaryadki-oruzhiya",
  "velikoe-khranilishche-energii",
  "sintezator-yada",
  "monolitnoe-telo",
  "otkalibrovannye-servoprivody",
  "navesnaya-bronya",
  "vstroennyy-stanok",
  "modul-nochnogo-zreniya",
  "impulsnye-dvigateli",
  "modul-s-preparatami",
  "sistema-termokontrolya",
  "ukreplyonnye-sustavy",
  "modul-ukrepleniya-tela",
  "mnogofunktsionalnyy-zakhvat",
  "razrisovannyy-korpus",
  "usilennye-ladoni",
  "krepkiy-sharnir",
  "magnitnaya-ladon",
  "mozg-chudovishcha",
  "raketnaya-tyaga",
  "modul-vosstanovleniya",
  "konteyner-dlya-familyara",
  "simbioticheskiy-mozg",
  "ruka-boga",
  "khranilishche-neveroyatnoy-pronitsatelnosti"
];

function implantItem(gearId, {
  kind = "mechanical",
  type = "Общая"
} = {}) {
  return {
    id: `item-${gearId}`,
    name: gearId,
    flags: {
      [MODULE_ID]: {
        gearId,
        implant: {
          kind,
          magical: kind === "magical",
          type
        }
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("registry resolves exactly the 36 supported non-transport mechanical implants", () => {
  assert.deepEqual(
    [...SUPPORTED_MECHANICAL_IMPLANT_IDS].sort(),
    [...EXPECTED_IDS].sort()
  );

  for (const gearId of EXPECTED_IDS) {
    assert.equal(getMechanicalImplantDefinition(implantItem(gearId))?.id, gearId);
  }

  assert.equal(
    getMechanicalImplantDefinition(implantItem("kolyaska-dlya-mototsikla", {
      type: "Транспортный узел"
    })),
    null
  );
  assert.equal(
    getMechanicalImplantDefinition(implantItem("kozha-krakena", {
      kind: "magical",
      type: "Древняя"
    })),
    null
  );
});

test("compiler emits deterministic native bonuses and runtime capabilities", () => {
  const ids = [
    "nastroennye-servoprivody",
    "sokrushitelnye-konechnosti",
    "pomoshch-v-postroenii-traektorii",
    "dopolnitelnaya-konechnost",
    "ultrazvukovye-datchiki",
    "modul-pareniya",
    "silnye-nogi",
    "monolitnoe-telo",
    "otkalibrovannye-servoprivody",
    "navesnaya-bronya",
    "modul-nochnogo-zreniya",
    "sistema-termokontrolya",
    "ukreplyonnye-sustavy",
    "modul-ukrepleniya-tela",
    "mozg-chudovishcha",
    "simbioticheskiy-mozg"
  ];
  const planned = ids.map((gearId) => ({
    item: implantItem(gearId),
    state: {
      installed: true,
      installedCount: gearId === "dopolnitelnaya-konechnost" ? 2 : 1
    },
    effective: true
  }));

  const compiled = compileMechanicalImplants(planned);

  assert.deepEqual(compiled.changes, [
    { key: "system.abilities.con.bonuses.check", mode: 2, value: "1", priority: 20 },
    { key: "system.abilities.con.bonuses.save", mode: 2, value: "1", priority: 20 },
    { key: "system.abilities.dex.save.roll.mode", mode: 5, value: "1", priority: 20 },
    { key: "system.abilities.dex.value", mode: 2, value: "2", priority: 20 },
    { key: "system.abilities.int.bonuses.check", mode: 2, value: "2", priority: 20 },
    { key: "system.abilities.int.value", mode: 2, value: "1", priority: 20 },
    { key: "system.abilities.str.save.roll.mode", mode: 5, value: "1", priority: 20 },
    { key: "system.abilities.str.value", mode: 4, value: "19", priority: 20 },
    { key: "system.attributes.ac.bonus", mode: 2, value: "1", priority: 20 },
    { key: "system.attributes.init.bonus", mode: 2, value: "2", priority: 20 },
    { key: "system.attributes.movement.hover", mode: 5, value: "true", priority: 20 },
    { key: "system.attributes.movement.walk", mode: 2, value: "10", priority: 20 },
    { key: "system.attributes.senses.blindsight", mode: 4, value: "10", priority: 20 },
    { key: "system.attributes.senses.darkvision", mode: 4, value: "60", priority: 20 },
  ]);
  assert.deepEqual(compiled.actorFlags, {
    abilityMaximums: { dex: 22, int: 20 },
    carryingStrengthBonus: 2,
    extremeTemperatureAdaptation: true,
    secondaryHands: 2
  });
  assert.equal(compiled.capabilities.some(({ type }) => type === "symbioticSpells"), true);
  assert.deepEqual(compiled.warnings, []);
});

test("compiler carries the selected built-in artisan tool into its runtime capability", () => {
  const compiled = compileMechanicalImplants([{
    item: implantItem("vstroennyy-stanok"),
    state: {
      installed: true,
      installedCount: 1,
      artisanToolId: "tool-smith"
    },
    effective: true
  }]);

  assert.deepEqual(compiled.capabilities, [{
    implantId: "vstroennyy-stanok",
    count: 1,
    type: "artisanToolBonus",
    value: 2,
    toolItemId: "tool-smith"
  }]);
});

test("compiler ignores unsupported, ineffective, and uninstalled implants", () => {
  const compiled = compileMechanicalImplants([
    { item: implantItem("navesnaya-bronya"), state: { installed: false, installedCount: 0 }, effective: true },
    { item: implantItem("navesnaya-bronya"), state: { installed: true, installedCount: 1 }, effective: false },
    { item: implantItem("kolyaska-dlya-mototsikla"), state: { installed: true, installedCount: 1 }, effective: true }
  ]);

  assert.deepEqual(compiled, {
    changes: [],
    actorFlags: {},
    capabilities: [],
    warnings: []
  });
});
