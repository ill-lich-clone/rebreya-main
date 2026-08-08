import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object),
    setProperty: (object, path, value) => {
      const keys = String(path ?? "").split(".").filter(Boolean);
      let cursor = object;
      while (keys.length > 1) {
        const key = keys.shift();
        if (cursor instanceof Map) {
          if (!cursor.has(key)) cursor.set(key, {});
          cursor = cursor.get(key);
        }
        else {
          cursor[key] ??= {};
          cursor = cursor[key];
        }
      }
      if (cursor instanceof Map) cursor.set(keys[0], value);
      else cursor[keys[0]] = value;
      return true;
    }
  }
};

const {
  inferWeaponAmmunitionSubtype,
  inferAmmunitionItemSubtype,
  isCompatibleAmmunition,
  repairActorAmmunitionCompatibility,
  repairWorldAmmunitionCompatibility
} = await import("../scripts/data/ammunition-compatibility.js");

function makeDocument(data) {
  const document = structuredClone(data);
  document.updateCalls = [];
  document.getFlag = (scope, key) => document.flags?.[scope]?.[key];
  document.update = async (patch) => {
    document.updateCalls.push(structuredClone(patch));
    for (const [path, value] of Object.entries(patch)) {
      foundry.utils.setProperty(document, path, value);
    }
    return document;
  };
  return document;
}

test("ordinary ranged weapon families map to exact dnd5e ammunition subtypes", () => {
  const cases = [
    [{ type: "weapon", system: { type: { baseItem: "longbow" }, properties: ["amm"] } }, "arrow"],
    [{ type: "weapon", system: { type: { baseItem: "handcrossbow" }, properties: ["amm"] } }, "crossbowBolt"],
    [{ type: "weapon", system: { type: { baseItem: "blowgun" }, properties: ["amm"] } }, "blowgunNeedle"],
    [{ type: "weapon", system: { type: { baseItem: "sling" }, properties: ["amm"] } }, "slingBullet"]
  ];

  for (const [weapon, expected] of cases) {
    assert.equal(inferWeaponAmmunitionSubtype(weapon), expected);
  }
});

test("managed ammunition identities recover a missing dnd5e subtype", () => {
  const cases = [
    ["strely-20", "arrow"],
    ["arbaletnye-bolty-20", "crossbowBolt"],
    ["igly-dlya-trubki-50", "blowgunNeedle"],
    ["snaryady-dlya-prashchi-20", "slingBullet"],
    ["mushketnyy-patron-20", "firearmBullet"],
    ["batareya-4", "firearmBullet"]
  ];

  for (const [gearId, expected] of cases) {
    const ammunition = {
      type: "consumable",
      system: { type: { value: "ammo", subtype: "" }, quantity: 20 },
      flags: { "rebreya-main": { gearId } }
    };
    assert.equal(inferAmmunitionItemSubtype(ammunition), expected);
  }
});

test("ammunition compatibility requires matching subtype and positive quantity", () => {
  const weapon = {
    type: "weapon",
    system: {
      type: { baseItem: "handcrossbow" },
      properties: ["amm"],
      ammunition: { type: "crossbowBolt" }
    }
  };

  assert.equal(isCompatibleAmmunition(weapon, {
    type: "consumable",
    system: { type: { value: "ammo", subtype: "crossbowBolt" }, quantity: 1 }
  }), true);
  assert.equal(isCompatibleAmmunition(weapon, {
    type: "consumable",
    system: { type: { value: "ammo", subtype: "firearmBullet" }, quantity: 20 }
  }), false);
  assert.equal(isCompatibleAmmunition(weapon, {
    type: "consumable",
    system: { type: { value: "ammo", subtype: "crossbowBolt" }, quantity: 0 }
  }), false);
});

test("actor repair types old items and clears persisted incompatible ammunition without replacing other data", async () => {
  const musketAmmo = makeDocument({
    id: "musket-ammo",
    name: "Боеприпас для мушкета",
    type: "consumable",
    system: { type: { value: "ammo", subtype: "" }, quantity: 5 },
    flags: { "rebreya-main": { gearId: "mushketnyy-patron-20" } }
  });
  const bolts = makeDocument({
    id: "bolts",
    name: "Арбалетные болты",
    type: "consumable",
    system: { type: { value: "ammo", subtype: "" }, quantity: 20 },
    flags: { "rebreya-main": { gearId: "arbaletnye-bolty-20" } }
  });
  const crossbow = makeDocument({
    id: "crossbow",
    name: "Арбалет, ручной",
    type: "weapon",
    system: {
      type: { value: "martialR", baseItem: "handcrossbow" },
      properties: ["amm", "lgt"],
      ammunition: { type: "firearmBullet" },
      magicalBonus: 1,
      activities: new Map([
        ["attack", { type: "attack", ammunition: "musket-ammo", damage: { includeBase: true } }]
      ])
    },
    flags: {
      dnd5e: { last: { attack: { ammunition: "musket-ammo", attackMode: "oneHanded" } } },
      "rebreya-main": { gearId: "arbalet-ruchnoy", customMarker: true }
    }
  });
  const actor = { items: { contents: [crossbow, musketAmmo, bolts] } };

  const first = await repairActorAmmunitionCompatibility(actor);

  assert.deepEqual(first, { updatedWeapons: 1, updatedAmmunition: 2 });
  assert.equal(crossbow.system.ammunition.type, "crossbowBolt");
  assert.equal(crossbow.system.activities.get("attack").ammunition, "");
  assert.equal(crossbow.flags.dnd5e.last.attack.ammunition, "");
  assert.equal(crossbow.system.magicalBonus, 1);
  assert.equal(crossbow.flags["rebreya-main"].customMarker, true);
  assert.equal(musketAmmo.system.type.subtype, "firearmBullet");
  assert.equal(bolts.system.type.subtype, "crossbowBolt");

  const second = await repairActorAmmunitionCompatibility(actor);
  assert.deepEqual(second, { updatedWeapons: 0, updatedAmmunition: 0 });
});

test("world ammunition repair runs only on the active GM and isolates actor failures", async () => {
  const goodAmmo = makeDocument({
    id: "arrows",
    name: "Стрелы",
    type: "consumable",
    system: { type: { value: "ammo", subtype: "" }, quantity: 20 },
    flags: { "rebreya-main": { gearId: "strely-20" } }
  });
  const failingWeapon = makeDocument({
    id: "crossbow",
    name: "Broken Crossbow",
    type: "weapon",
    system: { type: { baseItem: "handcrossbow" }, properties: ["amm"], ammunition: { type: "" } },
    flags: {}
  });
  failingWeapon.update = async () => {
    throw new Error("database write failed");
  };
  const activeGm = { id: "gm", isGM: true, active: true };
  const game = {
    user: activeGm,
    users: { activeGM: activeGm, contents: [activeGm] },
    actors: {
      contents: [
        { name: "Good", items: { contents: [goodAmmo] } },
        { name: "Bad", items: { contents: [failingWeapon] } }
      ]
    }
  };
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await repairWorldAmmunitionCompatibility(game);
    assert.deepEqual(result, {
      skipped: false,
      actors: 1,
      updatedWeapons: 0,
      updatedAmmunition: 1,
      failedActors: 1
    });
  }
  finally {
    console.warn = previousWarn;
  }

  const playerResult = await repairWorldAmmunitionCompatibility({
    ...game,
    user: { id: "player", isGM: false, active: true }
  });
  assert.equal(playerResult.skipped, true);
});

test("actor repair removes native ammunition selection from self-ammunition darts", async () => {
  const dart = makeDocument({
    id: "dart",
    name: "Дротик",
    type: "weapon",
    system: {
      type: { value: "simpleR", baseItem: "dart" },
      properties: ["amm", "lchDeadly"],
      activities: { attack: { type: "attack", ammunition: "wrong-ammo" } }
    },
    flags: {
      dnd5e: { last: { attack: { ammunition: "wrong-ammo" } } },
      "rebreya-main": { gearId: "drotik" }
    }
  });

  const result = await repairActorAmmunitionCompatibility({ items: { contents: [dart] } });

  assert.deepEqual(result, { updatedWeapons: 1, updatedAmmunition: 0 });
  assert.deepEqual(dart.system.properties, ["lchDeadly"]);
  assert.equal(dart.system.activities.attack.ammunition, "");
  assert.equal(dart.flags.dnd5e.last.attack.ammunition, "");
});
