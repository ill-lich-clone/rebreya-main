import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

const combatDirectory = new URL("../scripts/combat/", import.meta.url);
const dialogPattern = /(?:\bnew\s+Dialog(?:V2)?\s*\(|\bDialog(?:V2)?\.wait\s*\()/u;
const dialogAllowlist = new Set([
  "attack-roll-boost-service.js",
  "fighter-automation-service.js",
  "paladin-automation-service.js",
  "race-automation-service.js",
  "reaction-queue-service.js",
  "sorcerer-automation-service.js",
  "status-service.js"
]);

test("combat dialogs stay in the global reaction owner or explicit non-reaction allowlist", async () => {
  const files = (await readdir(combatDirectory)).filter((name) => name.endsWith(".js"));
  const offenders = [];
  for (const name of files) {
    const source = await readFile(new URL(name, combatDirectory), "utf8");
    if (dialogPattern.test(source) && !dialogAllowlist.has(name)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);

  for (const name of [
    "attack-service.js",
    "rune-knight-automation-service.js",
    "spell-automation-service.js"
  ]) {
    const source = await readFile(new URL(name, combatDirectory), "utf8");
    assert.doesNotMatch(source, dialogPattern, `${name} must delegate reaction windows to ReactionQueueService`);
  }
});

test("reaction and Rune Knight hot paths contain no polling or world actor scans", async () => {
  for (const name of [
    "reaction-capability-index.js",
    "reaction-queue-service.js",
    "rune-knight-automation-service.js"
  ]) {
    const source = await readFile(new URL(name, combatDirectory), "utf8");
    assert.doesNotMatch(source, /\bsetInterval\s*\(|\brequestAnimationFrame\s*\(/u, `${name} must be event-driven`);
    assert.doesNotMatch(source, /\bgame\?*\.actors\b|\bglobalThis\.game\?*\.actors\b/u, `${name} must stay actor-local`);
  }
});
