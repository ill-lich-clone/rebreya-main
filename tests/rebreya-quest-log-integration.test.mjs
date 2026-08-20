import test from "node:test";
import assert from "node:assert/strict";

import { openRebreyaQuestLog } from "../scripts/integrations/rebreya-quest-log.js";

test("Rebreya quest log adapter opens the dedicated module through its public API", async () => {
  const calls = [];
  const moduleRecord = {
    active: true,
    api: {
      async openQuestLog(options) {
        calls.push(options);
        return "opened";
      }
    }
  };

  const result = await openRebreyaQuestLog({
    game: { modules: new Map([["rebreya-quest-log", moduleRecord]]) },
    options: { tabId: "active" }
  });

  assert.equal(result, "opened");
  assert.deepEqual(calls, [{ tabId: "active" }]);
});

test("Rebreya quest log adapter fails clearly when the dedicated module API is unavailable", async () => {
  await assert.rejects(
    openRebreyaQuestLog({ game: { modules: new Map() } }),
    /rebreya-quest-log/u
  );
});
