import test from "node:test";
import assert from "node:assert/strict";
import { isValidCurseSaveRequest, authorizeCurseSaveRequest, registerCurseUpgradeSocketCommands } from "../scripts/integrations/curse-upgrade-socket.js";
const payload = () => ({ actorUuid: "Actor.target", eventId: "save1", saved: false, death: false, damageOnly: false });
test("save command validates exact keys and rejects malformed booleans and chains", () => {
  assert.equal(isValidCurseSaveRequest(payload()), true);
  for (const patch of [{ saved: "false" }, { actorUuid: "" }, { kind: "other" }, { kind: "chains" }, { arbitraryUpdate: {} }]) assert.equal(isValidCurseSaveRequest({ ...payload(), ...patch }), false);
});
test("native decisions require target ownership; source ownership alone cannot forge target evidence", async () => {
  const target = { uuid: "Actor.target", items: new Map(), testUserPermission: u => u.id === "owner" };
  globalThis.fromUuid = async uuid => uuid === target.uuid ? target : null;
  assert.equal(await authorizeCurseSaveRequest(payload(), { sender: { id: "owner" } }), true);
  assert.equal(await authorizeCurseSaveRequest(payload(), { sender: { id: "other" } }), false);
});
test("workflow decisions bind exact activity, card author and actual target", async () => {
  const source = { uuid: "Actor.source", items: new Map(), testUserPermission: u => u.id === "caster" };
  const target = { uuid: "Actor.target", items: new Map() };
  const token = { uuid: "Scene.s.Token.t", actor: target };
  const activity = { uuid: "Actor.source.Item.i.Activity.a", actor: source, type: "save", item: { uuid: "Actor.source.Item.i" } };
  const card = { uuid: "ChatMessage.card", id: "card", author: { id: "caster" }, flags: { dnd5e: { activity: { uuid: activity.uuid }, item: { uuid: activity.item.uuid }, targets: [{ uuid: target.uuid }] } } };
  const docs = new Map([source, target, token, activity, card].map(d => [d.uuid, d]));
  globalThis.fromUuid = async uuid => docs.get(uuid);
  const p = { ...payload(), sourceActorUuid: source.uuid, activityUuid: activity.uuid, targetUuid: token.uuid, itemCardUuid: card.uuid, workflowId: card.uuid, eventId: `curse-save:${card.uuid}:${target.uuid}` };
  assert.equal(await authorizeCurseSaveRequest(p, { sender: { id: "caster" } }), true);
  card.flags.dnd5e.targets = [];
  assert.equal(await authorizeCurseSaveRequest(p, { sender: { id: "caster" } }), false);
  card.flags.dnd5e.targets = [{ uuid: target.uuid }]; card.flags.dnd5e.activity.uuid = "different";
  assert.equal(await authorizeCurseSaveRequest(p, { sender: { id: "caster" } }), false);
});
test("four typed commands register with validation and authorization", () => {
  const commands = new Map(); registerCurseUpgradeSocketCommands({ socketCommandBus: { register: (key, value) => commands.set(key, value) }, curseUpgradeAutomationService: {} });
  assert.equal(commands.size, 4);
  for (const command of commands.values()) for (const name of ["validate", "authorize", "execute"]) assert.equal(typeof command[name], "function");
});
