import assert from "node:assert/strict";
import test from "node:test";

import {
  PARTY_INVENTORY_CREST_FLAG,
  resolvePartyInventoryCrest,
  openPartyInventoryCrestPicker
} from "../scripts/ui/party-inventory-crest.js";

test("resolvePartyInventoryCrest prefers the dedicated flag then Actor image", () => {
  const actor = {
    img: "actor.webp",
    getFlag(scope, key) {
      assert.equal(scope, "rebreya-main");
      assert.equal(key, PARTY_INVENTORY_CREST_FLAG);
      return "crest.webp";
    }
  };

  assert.equal(resolvePartyInventoryCrest(actor), "crest.webp");
  actor.getFlag = () => "";
  assert.equal(resolvePartyInventoryCrest(actor), "actor.webp");
  assert.equal(resolvePartyInventoryCrest(null), "icons/svg/mystery-man.svg");
});

test("openPartyInventoryCrestPicker uses the modern picker and persists selection", async () => {
  const calls = [];
  class Picker {
    constructor(options) {
      this.options = options;
      calls.push(["construct", options.type, options.current]);
    }

    render(force) {
      calls.push(["render", force]);
      return this;
    }
  }

  const actor = {
    async setFlag(scope, key, value) {
      calls.push(["setFlag", scope, key, value]);
    }
  };

  const picker = openPartyInventoryCrestPicker({
    actor,
    current: "old.webp",
    pickerClass: Picker
  });
  await picker.options.callback("new.webp");

  assert.deepEqual(calls, [
    ["construct", "image", "old.webp"],
    ["render", { force: true }],
    ["setFlag", "rebreya-main", PARTY_INVENTORY_CREST_FLAG, "new.webp"]
  ]);
});

test("openPartyInventoryCrestPicker leaves the crest unchanged on cancellation", () => {
  let persisted = false;
  class Picker {
    constructor(options) {
      this.options = options;
    }

    render() {
      return this;
    }
  }

  openPartyInventoryCrestPicker({
    actor: {
      setFlag: async () => {
        persisted = true;
      }
    },
    current: "old.webp",
    pickerClass: Picker
  });

  assert.equal(persisted, false);
});

test("openPartyInventoryCrestPicker reports persistence failure without replacing the crest", async () => {
  const failure = new Error("write failed");
  const reported = [];
  class Picker {
    constructor(options) {
      this.options = options;
    }

    render() {
      return this;
    }
  }

  const picker = openPartyInventoryCrestPicker({
    actor: {
      async setFlag() {
        throw failure;
      }
    },
    current: "old.webp",
    pickerClass: Picker,
    onError: (error) => reported.push(error)
  });
  await picker.options.callback("new.webp");

  assert.deepEqual(reported, [failure]);
});

test("openPartyInventoryCrestPicker does not report a post-save rerender failure as persistence failure", async () => {
  const failure = new Error("rerender failed");
  const reported = [];
  let persisted = false;
  class Picker {
    constructor(options) {
      this.options = options;
    }

    render() {
      return this;
    }
  }

  const picker = openPartyInventoryCrestPicker({
    actor: {
      async setFlag() {
        persisted = true;
      }
    },
    current: "old.webp",
    pickerClass: Picker,
    onSelected: async () => {
      throw failure;
    },
    onError: (error) => reported.push(error)
  });

  await assert.rejects(picker.options.callback("new.webp"), failure);
  assert.equal(persisted, true);
  assert.deepEqual(reported, []);
});
