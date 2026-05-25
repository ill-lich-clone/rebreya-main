import test from "node:test";
import assert from "node:assert/strict";

import { patchEffectMacroCombatHooks } from "../scripts/integrations/effectmacro-compat.js";

test("effectmacro combat hook does not leave actorless appliedEffects rejections unhandled", async () => {
  const hookEntry = {
    fn: async function updateCombat() {
      throw new TypeError("Cannot read properties of undefined (reading 'appliedEffects')");
    }
  };
  const Hooks = {
    events: {
      updateCombat: [
        hookEntry,
        { fn: () => undefined }
      ]
    }
  };

  assert.equal(patchEffectMacroCombatHooks(Hooks), 1);
  assert.equal(patchEffectMacroCombatHooks(Hooks), 0);
  await assert.doesNotReject(() => hookEntry.fn({}, {}, {}));
});
