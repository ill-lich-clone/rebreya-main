import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "rebreya-main";

function getPath(source, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce((current, part) => (
    current && typeof current === "object" ? current[part] : undefined
  ), source);
}

function makeShield({
  id = "shield",
  equipped = true,
  heldHands = [],
  value = 2
} = {}) {
  return {
    id,
    _id: id,
    name: id,
    type: "equipment",
    system: {
      equipped,
      type: {
        value: "shield"
      },
      armor: {
        value
      }
    },
    flags: heldHands.length ? {
      [MODULE_ID]: {
        heldHands
      }
    } : {},
    getFlag(scope, key) {
      return getPath(this.flags?.[scope], key);
    }
  };
}

function makeActor(items = []) {
  return {
    itemTypes: {
      equipment: items
    },
    items: {
      contents: items
    }
  };
}

function installConfig(characterModel, npcModel = characterModel) {
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    Actor: {
      dataModels: {
        character: characterModel,
        npc: npcModel
      }
    }
  };

  return () => {
    globalThis.CONFIG = previousConfig;
  };
}

test("held shield armor class patch removes shield AC when the shield is only worn", async () => {
  const { registerHeldShieldArmorClassPatch } = await import(`../scripts/integrations/held-shield-ac.js?only-worn=${Date.now()}`);
  const shield = makeShield({ equipped: true, heldHands: [], value: 2 });
  class CharacterData {
    constructor(parent) {
      this.parent = parent;
      this.attributes = {
        ac: {}
      };
    }

    prepareDerivedData() {
      this.attributes.ac = {
        min: 0,
        value: 16,
        shield: 2,
        equippedShield: shield
      };
    }
  }
  class NpcData {
    constructor(parent) {
      this.parent = parent;
      this.attributes = {
        ac: {}
      };
    }

    prepareDerivedData() {
      this.attributes.ac = {
        min: 0,
        value: 16,
        shield: 2,
        equippedShield: shield
      };
    }
  }
  const restoreConfig = installConfig(CharacterData, NpcData);
  try {
    assert.deepEqual(registerHeldShieldArmorClassPatch(), ["character", "npc"]);
    const data = new CharacterData(makeActor([shield]));

    data.prepareDerivedData();

    assert.equal(data.attributes.ac.shield, 0);
    assert.equal(data.attributes.ac.value, 14);
    assert.equal(data.attributes.ac.equippedShield, null);
  }
  finally {
    restoreConfig();
  }
});

test("held shield armor class patch adds shield AC when the shield is in hand", async () => {
  const { registerHeldShieldArmorClassPatch } = await import(`../scripts/integrations/held-shield-ac.js?held=${Date.now()}`);
  const shield = makeShield({ equipped: false, heldHands: ["left"], value: 2 });
  class CharacterData {
    constructor(parent) {
      this.parent = parent;
      this.attributes = {
        ac: {}
      };
    }

    prepareDerivedData() {
      this.attributes.ac = {
        min: 0,
        value: 14,
        shield: 0,
        equippedShield: null
      };
    }
  }
  const restoreConfig = installConfig(CharacterData);
  try {
    registerHeldShieldArmorClassPatch();
    const data = new CharacterData(makeActor([shield]));

    data.prepareDerivedData();

    assert.equal(data.attributes.ac.shield, 2);
    assert.equal(data.attributes.ac.value, 16);
    assert.equal(data.attributes.ac.equippedShield, shield);
  }
  finally {
    restoreConfig();
  }
});

test("held shield armor class patch does not double-count an equipped held shield", async () => {
  const { registerHeldShieldArmorClassPatch } = await import(`../scripts/integrations/held-shield-ac.js?no-double=${Date.now()}`);
  const shield = makeShield({ equipped: true, heldHands: ["right"], value: 3 });
  class NpcData {
    constructor(parent) {
      this.parent = parent;
      this.attributes = {
        ac: {}
      };
    }

    prepareDerivedData() {
      this.attributes.ac = {
        min: 0,
        value: 18,
        shield: 3,
        equippedShield: shield
      };
    }
  }
  const restoreConfig = installConfig(null, NpcData);
  try {
    assert.deepEqual(registerHeldShieldArmorClassPatch(), ["npc"]);
    const data = new NpcData(makeActor([shield]));

    data.prepareDerivedData();

    assert.equal(data.attributes.ac.shield, 3);
    assert.equal(data.attributes.ac.value, 18);
    assert.equal(data.attributes.ac.equippedShield, shield);
  }
  finally {
    restoreConfig();
  }
});
