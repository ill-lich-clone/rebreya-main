import test from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_REFERENCE_DATA,
  getStatusReferenceDefinition,
  renderStatusReferenceDescription
} from "../scripts/data/status-reference-data.js";

test("shared status definitions include prone and keep sheet presentation text", () => {
  const prone = getStatusReferenceDefinition("prone");
  assert.equal(prone.canonicalName, "Сбитый с ног");
  assert.ok(prone.aliases.includes("Лежащий ничком"));
  assert.match(renderStatusReferenceDescription(prone), /только ползая/u);
  assert.match(renderStatusReferenceDescription(prone), /<ul>/u);
});

test("shared status definitions include exact bloodied source metadata and feat aliases", () => {
  const bloodied = getStatusReferenceDefinition("bloodied");
  assert.equal(bloodied.canonicalName, "Окровавленный");
  assert.deepEqual(bloodied.aliases, ["окровавленного", "окровавленным"]);
  assert.equal(bloodied.source.file, "Глоссарий.txt");
  assert.match(renderStatusReferenceDescription(bloodied), /меньше половины хитов/u);
  assert.match(renderStatusReferenceDescription(bloodied), /Максимальные хиты/u);
});

test("shared owner preserves every existing sheet status id", () => {
  const expected = ["unconscious", "incapacitated", "exhaustion", "invisible", "deafened", "petrified", "prone", "poisoned", "charmed", "stunned", "paralyzed", "grappled", "blinded", "restrained", "frightened",
    "rebreya-discreet", "rebreya-gaseous", "rebreya-surrounded", "rebreya-open-position", "rebreya-entangled-mind", "rebreya-frostbitten", "rebreya-nauseated", "rebreya-hasted", "rebreya-slowed", "rebreya-weakened", "rebreya-clumsy", "rebreya-decaying-damage", "rebreya-charged", "rebreya-provoked", "rebreya-twisted", "rebreya-swallowed", "rebreya-possessed"];
  assert.deepEqual(Object.keys(STATUS_REFERENCE_DATA).filter((id) => id !== "bloodied"), expected);
  assert.ok(Object.isFrozen(STATUS_REFERENCE_DATA));
  assert.ok(Object.values(STATUS_REFERENCE_DATA).every(Object.isFrozen));
});
