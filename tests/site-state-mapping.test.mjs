import test from "node:test";
import assert from "node:assert/strict";

import {
  SITE_CONDITION_TO_STATUS,
  toSiteConditions,
  fromSiteConditions,
  diffStatuses,
  sumSpentHitDice,
  distributeSpentHitDice,
  stateSignature,
} from "../scripts/data/site-state-mapping.js";

test("all 14 site condition slugs map to dnd5e status ids and back", () => {
  assert.equal(Object.keys(SITE_CONDITION_TO_STATUS).length, 14);
  for (const [slug, id] of Object.entries(SITE_CONDITION_TO_STATUS)) {
    assert.deepEqual(toSiteConditions([id]), [slug]);
    assert.deepEqual(fromSiteConditions([slug]), [id]);
  }
});

test("unknown values pass through both ways; exhaustion never travels as a condition", () => {
  assert.deepEqual(toSiteConditions(["prone", "dead", "exhaustion", "prone"]), ["dead", "sbityy-s-nog"]);
  assert.deepEqual(fromSiteConditions(["sbityy-s-nog", "istoschenie", "bless-homebrew"]), ["bless-homebrew", "prone"]);
  assert.deepEqual(fromSiteConditions(null), []);
});

test("diffStatuses: mapped statuses follow the site; unknown local ones are never removed", () => {
  const { add, remove } = diffStatuses(["prone", "poisoned", "dead"], ["otravlennyy", "nevidimyy"]);
  assert.deepEqual(add, ["invisible"]);
  assert.deepEqual(remove, ["prone"]); // "dead" is not a synced status → left alone
});

test("hit dice: sum per class; spread the site total largest die first, capped by levels", () => {
  const classes = [
    { _id: "wiz", system: { levels: 5, hd: { denomination: "d6", spent: 0 } } },
    { _id: "ftr", system: { levels: 2, hd: { denomination: "d10", spent: 1 } } },
  ];
  assert.equal(sumSpentHitDice(classes), 1);
  assert.deepEqual(distributeSpentHitDice(classes, 4), [
    { _id: "ftr", "system.hd.spent": 2 },
    { _id: "wiz", "system.hd.spent": 2 },
  ]);
  assert.deepEqual(distributeSpentHitDice(classes, 1), []); // already matches → no update
  assert.deepEqual(distributeSpentHitDice(classes, 99).map((u) => u["system.hd.spent"]), [2, 5]);
});

test("stateSignature ignores key order and clientSync, changes with state", () => {
  const a = stateSignature({ currentHp: 5, currency: { gp: 1, sp: 2 }, clientSync: { actorUuid: "x" } });
  const b = stateSignature({ currency: { sp: 2, gp: 1 }, currentHp: 5, clientSync: { actorUuid: "y" } });
  assert.equal(a, b);
  assert.notEqual(a, stateSignature({ currentHp: 6, currency: { gp: 1, sp: 2 } }));
  assert.match(a, /^fnv1a:[0-9a-f]{8}$/u);
});
