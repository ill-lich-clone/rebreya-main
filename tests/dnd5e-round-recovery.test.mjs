import test from "node:test";
import assert from "node:assert/strict";
import { installDnd5eRoundRecoveryOptimization } from "../scripts/integrations/dnd5e-round-recovery.js";

const round = new Map([["round", 1]]);
const noChanges = { updates: {}, rolls: [], destroy: undefined };

function setup(version = "6.0.6") {
  class NativeUses {
    calls = [];

    async recoverUses(periods, rollData) {
      // Marker for the stock implementation's UsesField.recoverUses.call path.
      this.calls.push({ periods, rollData });
      return { updates: { spent: 1 }, rolls: ["stock result"], destroy: true };
    }
  }
  class ItemModel extends NativeUses {}
  class OtherModel extends NativeUses {}
  class CustomModel extends ItemModel {
    async recoverUses() { return "custom result"; }
  }
  const options = {
    system: { id: "dnd5e", version },
    itemModels: { feat: ItemModel, weapon: OtherModel, custom: CustomModel }
  };
  const create = (recovery = [], activities = []) => Object.assign(new ItemModel(), {
    uses: { recovery }, activities
  });
  return { options, create, NativeUses, CustomModel };
}

test("stock round recovery takes the empty path for unrelated item and activity recovery", async () => {
  const { options, create, NativeUses, CustomModel } = setup();
  const original = NativeUses.prototype.recoverUses;
  installDnd5eRoundRecoveryOptimization(options);
  const wrapper = NativeUses.prototype.recoverUses;
  installDnd5eRoundRecoveryOptimization(options);
  assert.notEqual(wrapper, original);
  assert.equal(NativeUses.prototype.recoverUses, wrapper);
  const item = create([{ period: "lr", type: "formula" }], [{ uses: { recovery: [{ period: "turnStart" }] } }]);
  assert.deepEqual(await item.recoverUses(round), noChanges);
  assert.deepEqual(item.calls, []);
  for (const autoDestroy of [true, false]) {
    item.uses.autoDestroy = autoDestroy;
    assert.deepEqual(await item.recoverUses(round), { ...noChanges, destroy: false });
  }
  assert.equal(await new CustomModel().recoverUses(round), "custom result");
});

test("matching round profiles, unknown data and other recovery periods delegate to the system", async () => {
  const { options, create } = setup();
  installDnd5eRoundRecoveryOptimization(options);
  const rollData = { modifier: 2 };
  for (const [item, periods] of [
    [create([{ period: "round", type: "loseAll" }]), round],
    [create([], [{ uses: { recovery: [{ period: "round", type: "formula" }] } }]), round],
    [create([], [{ uses: { recovery: {} } }]), round],
    [create([], [{ uses: false }]), round],
    [create([null]), round],
    [create(), new Map([["round", 1], ["turnStart", 1]])],
    [create(), new Map([["encounter", 1]])],
    [create(), ["round"]]
  ]) {
    assert.deepEqual(await item.recoverUses(periods, rollData), {
      updates: { spent: 1 }, rolls: ["stock result"], destroy: true
    });
    assert.deepEqual(item.calls, [{ periods, rollData }]);
  }
});

test("the optimization leaves other system versions alone", async () => {
  const { options, create, NativeUses } = setup("6.0.7");
  const original = NativeUses.prototype.recoverUses;
  installDnd5eRoundRecoveryOptimization(options);
  assert.equal(NativeUses.prototype.recoverUses, original);
  assert.equal((await create().recoverUses(round)).destroy, true);
});
