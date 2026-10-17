import test from "node:test";
import assert from "node:assert/strict";
import { runCreatureSizeMacro } from "../scripts/integrations/creature-size-macro.js";
import { buildCreatureSizeMacroData } from "../scripts/combat/grapple-macro-service.js";
test("managed macro uses public facade in the existing folder", () => {
  const data = buildCreatureSizeMacroData("folder");
  assert.equal(data.name, "Изменить размер");
  assert.equal(data.command, "await game.rebreyaMain?.resizeCreature?.();");
  assert.equal(data.folder, "folder");
});
test("cancel and no controlled owned Token perform no writes; dialog has all sizes and held weapon choices", async () => {
  let dialogs = 0, writes = 0;
  const token = { document: { uuid: "Scene.s.Token.t", actor: { isOwner: true }, isOwner: true, name: "<Hero>" } };
  const moduleApi = { equipmentSizeService: { getCreatureResizePreview: () => ({ actorUuid: "Actor.a", tokenUuid: token.document.uuid,
    size: "med", expected: {}, weaponRows: [{ id: "sword", name: "<Sword>", size: "med", quantity: 1 }] }), requestCreatureResize: () => writes++ } };
  const DialogV2 = { wait: async options => { dialogs++; assert.match(options.content, /value="grg"/); assert.match(options.content, /&lt;Sword&gt;/); return null; } };
  await runCreatureSizeMacro({ moduleApi, canvas: { tokens: { controlled: [] } }, DialogV2, notify: () => {} });
  await runCreatureSizeMacro({ moduleApi, canvas: { tokens: { controlled: [token] } }, DialogV2 });
  assert.equal(dialogs, 1); assert.equal(writes, 0);
});
test("one dialog submits only the selected Token and checked held weapons", async () => {
  let sent;
  const token = { document: { uuid: "Scene.s.Token.t", actor: { isOwner: true }, isOwner: true } };
  const preview = { actorUuid: "Actor.a", tokenUuid: token.document.uuid, size: "med", expected: { before: true }, weaponRows: [] };
  const moduleApi = { equipmentSizeService: { getCreatureResizePreview: () => preview, requestCreatureResize: p => sent = p } };
  await runCreatureSizeMacro({ moduleApi, canvas: { tokens: { controlled: [token] } }, DialogV2: { wait: async options => {
    const form = { querySelector: selector => selector.includes("token") ? { value: "0" } : { value: "huge" },
      querySelectorAll: () => [{ value: "sword" }] };
    return options.buttons[0].callback(null, { form });
  } } });
  assert.deepEqual(sent, { actorUuid: "Actor.a", tokenUuid: token.document.uuid, size: "huge", expected: preview.expected, weaponIds: ["sword"] });
});
