import test from "node:test";
import assert from "node:assert/strict";

import { promptDurabilityOutcome } from "../scripts/ui/durability-outcome-dialog.js";

test("durability outcome dialog exposes exact manual actions", async () => {
  let config;
  const dialog = {
    async wait(value) {
      config = value;
      return value.buttons[0].callback();
    }
  };

  assert.equal(await promptDurabilityOutcome({ name: "Сундук <тест>", dialog }), "broken");
  assert.equal(config.window.title, "Сундук <тест>: 0 HP");
  assert.deepEqual(config.buttons.map(({ action, label }) => ({ action, label })), [
    { action: "broken", label: "Сломать предмет" },
    { action: "destroyed", label: "Разрушить предмет" }
  ]);
  assert.doesNotMatch(config.content, /<тест>/u);
});

test("destroy action returns destroyed and close returns null", async () => {
  const destroyedDialog = {
    wait: async (config) => config.buttons[1].callback()
  };
  const closedDialog = {
    wait: async (config) => config.close()
  };

  assert.equal(await promptDurabilityOutcome({ dialog: destroyedDialog }), "destroyed");
  assert.equal(await promptDurabilityOutcome({ dialog: closedDialog }), null);
  assert.equal(await promptDurabilityOutcome({ dialog: null }), null);
});
