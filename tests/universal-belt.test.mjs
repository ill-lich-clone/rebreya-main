import test from "node:test";
import assert from "node:assert/strict";

function installFoundryStubs() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      },
      getProperty(source, path) {
        return String(path ?? "").split(".").reduce((current, part) => (
          current && typeof current === "object" ? current[part] : undefined
        ), source);
      },
      hasProperty(source, path) {
        return this.getProperty(source, path) !== undefined;
      },
      setProperty(source, path, value) {
        const parts = String(path ?? "").split(".").filter(Boolean);
        let target = source;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = value;
        return true;
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function makeActor({ flags = {}, currency = {} } = {}) {
  return {
    type: "character",
    flags,
    system: { currency },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function makeItem({ type = "loot", quantity, flags = {} } = {}) {
  return {
    type,
    flags,
    system: quantity === undefined ? {} : { quantity },
    toObject() {
      return { type: this.type, flags: this.flags, system: this.system };
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

test("universal belt slot count defaults to one and clamps actor flag values", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      getUniversalBeltUnlockedSlotCount
    } = await import(`../scripts/integrations/universal-belt.js?helpers=${Date.now()}`);

    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor()), 1);
    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 0 } } }
    })), 1);
    assert.equal(getUniversalBeltUnlockedSlotCount(makeActor({
      flags: { "rebreya-main": { universalBelt: { unlockedSlots: 99 } } }
    })), 3);
  }
  finally {
    restore();
  }
});

test("universal belt accepts physical quantity items and rejects non-physical documents", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      isUniversalBeltEligibleItem
    } = await import(`../scripts/integrations/universal-belt.js?eligibility=${Date.now()}`);

    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "weapon", quantity: 1 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "equipment", quantity: 1 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "loot", quantity: 0 })), true);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "spell" })), false);
    assert.equal(isUniversalBeltEligibleItem(makeItem({ type: "class" })), false);
  }
  finally {
    restore();
  }
});

test("universal belt purchase spends gp first and makes pp change into gp", async () => {
  const restore = installFoundryStubs();
  try {
    const {
      calculateUniversalBeltPayment
    } = await import(`../scripts/integrations/universal-belt.js?payment=${Date.now()}`);

    assert.deepEqual(calculateUniversalBeltPayment({ gp: 800, pp: 2 }), {
      ok: true,
      currency: { gp: 300, pp: 2 }
    });
    assert.deepEqual(calculateUniversalBeltPayment({ gp: 495, pp: 1 }), {
      ok: true,
      currency: { gp: 5, pp: 0 }
    });
    assert.deepEqual(calculateUniversalBeltPayment({ gp: 499, pp: 0 }), {
      ok: false,
      currency: { gp: 499, pp: 0 }
    });
  }
  finally {
    restore();
  }
});
