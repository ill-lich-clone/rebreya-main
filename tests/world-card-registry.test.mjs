import test from "node:test";
import assert from "node:assert/strict";
import { registerCprCardHandlers } from "../scripts/integrations/world-card-automations/hooks.js";

globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
const { definitions } = await import("../scripts/integrations/world-card-automations/registry.js");

// Roots recorded on actors and scene tokens in testovyj3. Effects and granted actions have additional private entries.
const cards2014 =
  "absorbElements antagonize bless boomingBlade brandingSmite chillTouch darkness dash disengage divineSmite dodge eldritchSmite findSteed grapple greenFlameBlade hex hexbladesCurse holdPerson hypnoticPattern magicMissile mistyStep quickenedSpell rayOfEnfeeblement rimesBindingIce scorchingRay shield shockingGrasp shove spiritShroud tashasCausticBrew vortexWarp wardingBond wrathfulSmite".split(
    " "
  );
const cards2024 =
  "bane bless blur compelledDuel detectMagic eldritchBlast faerieFire heatMetal magicMissile mistyStep scorchingRay shield shieldOfFaith".split(
    " "
  );

test("both editions of every world card resolve without CPR or CAT", () => {
  for (const [book, names] of [
    [definitions.legacy, cards2014],
    [definitions.modern, cards2024]
  ]) {
    for (const id of names) assert.ok(Object.hasOwn(book, id), id);
  }
  assert.notEqual(definitions.legacy.magicMissile, definitions.modern.magicMissile);
  const hooks = new Map();
  const Hooks = { on: (name, fn) => hooks.set(name, fn) };
  const unsupported = registerCprCardHandlers({ Hooks, game: {}, definitions });
  assert.deepEqual(unsupported, []);
  assert.ok(hooks.has("updateCombat") && hooks.has("midi-qol.preDamageRollComplete"));
});

test("the actual quickened spell and booming blade handlers retain their resource and movement stages", () => {
  assert.ok(definitions.legacy.quickenedSpell.midi);
  assert.equal(
    typeof definitions.legacy.boomingBladeMoved.movement.find((row) => row.pass === "moved").macro,
    "function"
  );
  assert.equal(typeof definitions.legacy.grappleEscape.midi.item[0].macro, "function");
});

test("the saved Heat Metal variant keeps both native 2d8 rolls, without a synthetic damage or extra slot", async (t) => {
  const root = "../scripts/integrations/world-card-automations/selected/";
  const { cardActivityRole } = await import("../scripts/integrations/world-card-automations/activity-role.js");
  const { effectUtils } = await import(root + "lib/utilities/effectUtils.js");
  const { workflowUtils } = await import(root + "lib/utilities/workflowUtils.js");
  const { dialogUtils } = await import(root + "lib/utilities/dialogUtils.js");
  const { socketUtils } = await import(root + "lib/utilities/socketUtils.js");
  const item = {
    name: "Нагрев металла",
    actor: {},
    flags: { "chris-premades": { info: { identifier: "heatMetal" }, activityIdentifiers: { heatMetal: "stale" } } },
    system: {}
  };
  const [cast, pulse, held] = (item.system.activities = [
    { id: "2jWlvr2titPfBMEm", type: "damage", item },
    { id: "YPEmwJHX7g68307N", type: "damage", item },
    { id: "dnd5eactivity000", type: "save", item }
  ]);
  assert.deepEqual([cast, pulse, held].map(cardActivityRole), ["heatMetal", "heatMetalPulse", "heatMetalHeld"]);
  let created;
  const target = { document: { uuid: "Scene.s.Token.t" }, actor: {} };
  t.mock.method(effectUtils, "getConcentrationEffect", () => null);
  t.mock.method(effectUtils, "createEffect", (_actor, data) => (created = data));
  t.mock.method(effectUtils, "getEffectByIdentifier", () => created);
  t.mock.method(workflowUtils, "syntheticActivityRoll", () => assert.fail("native damage rolled twice"));
  t.mock.method(dialogUtils, "buttonDialog", () => true);
  t.mock.method(socketUtils, "firstOwner", () => ({ id: "owner" }));
  const oldResolve = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (id) => (id === target.document.uuid ? { object: target } : null);
  t.after(() => {
    globalThis.fromUuidSync = oldResolve;
  });
  const handlers = definitions.modern.heatMetal.midi.item.filter((row) => row.pass === "rollFinished");
  for (const activity of [cast, pulse]) {
    const workflow = { activity, item, actor: item.actor, targets: new Set([target]), castData: { castLevel: 3 } };
    await handlers.find((row) => row.activities.includes(cardActivityRole(activity))).macro({ workflow });
  }
  assert.equal(created.flags["chris-premades"].heatMetal.targetUuid, target.document.uuid);
});
