import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_TRIGGER_PROMPT_REQUEST,
  STORAGE_TRIGGER_PROMPT_RESULT,
  StorageTriggerPromptBroker
} from "../scripts/infrastructure/foundry/storage-trigger-prompt-broker.js";

function game(user, users, emitted) {
  return { user, users: { activeGM: users.find((entry) => entry.isGM && entry.active), contents: users }, socket: { emit(_channel, message) { emitted.push(message); } } };
}

test("storage trigger prompt broker authenticates GM request and requester result", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const gmEmitted = [];
  const playerEmitted = [];
  const gmBroker = new StorageTriggerPromptBroker({ gameProvider: () => game(gm, [gm, player], gmEmitted), idFactory: () => "prompt-1" });
  const playerBroker = new StorageTriggerPromptBroker({
    gameProvider: () => game(player, [gm, player], playerEmitted),
    showDialog: async (prompt) => { assert.equal(prompt.message, "Открыть?"); return true; }
  });

  const pending = gmBroker.request({ senderId: player.id }, { title: "Сундук", message: "Открыть?" });
  const request = gmEmitted[0];
  assert.equal(request.type, STORAGE_TRIGGER_PROMPT_REQUEST);
  assert.equal(await playerBroker.handleMessage(request, gm.id), true);
  const result = playerEmitted[0];
  assert.equal(result.type, STORAGE_TRIGGER_PROMPT_RESULT);
  assert.equal(await gmBroker.handleMessage(result, player.id), true);
  assert.equal(await pending, true);
});

test("storage trigger prompt broker ignores spoofed requester and non-active GM", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const emitted = [];
  let dialogs = 0;
  const broker = new StorageTriggerPromptBroker({
    gameProvider: () => game(player, [gm, player], emitted),
    showDialog: async () => { dialogs += 1; return true; }
  });
  const message = {
    type: STORAGE_TRIGGER_PROMPT_REQUEST, requestId: "p", gmId: gm.id, targetUserId: player.id,
    prompt: { title: "x", message: "y", confirmLabel: "Да", cancelLabel: "Нет" }
  };
  assert.equal(await broker.handleMessage(message, "attacker"), true);
  assert.equal(dialogs, 0);
  assert.deepEqual(emitted, []);
});
