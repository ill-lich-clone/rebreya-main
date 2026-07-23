import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FighterAutomationService } from "../scripts/combat/fighter-automation-service.js";
import { PerformerAutomationService } from "../scripts/combat/performer-automation-service.js";
import { RaceAutomationService } from "../scripts/combat/race-automation-service.js";
import { RuneKnightAutomationService } from "../scripts/combat/rune-knight-automation-service.js";
import { SorcererAutomationService } from "../scripts/combat/sorcerer-automation-service.js";

function stepRecorder() {
  const steps = [];
  return {
    steps,
    pipeline: {
      registerStep(step) {
        steps.push(step);
        return this;
      }
    }
  };
}

test("background automation services register ordered non-interactive long-rest steps", () => {
  const { pipeline, steps } = stepRecorder();
  const services = [
    new RuneKnightAutomationService({}),
    new PerformerAutomationService({}),
    new FighterAutomationService({}),
    new SorcererAutomationService({}),
    new RaceAutomationService({})
  ];

  for (const service of services) {
    service.registerLongRestSteps(pipeline);
  }

  assert.deepEqual(
    steps
      .filter((step) => step.interactive === false)
      .map(({ id, order, interactive }) => ({ id, order, interactive })),
    [
      { id: "rune-knight.restore", order: 110, interactive: false },
      { id: "performer.clear-state", order: 120, interactive: false },
      { id: "fighter.restore", order: 130, interactive: false },
      { id: "sorcerer.restore", order: 140, interactive: false },
      { id: "race.restore-spell-slot", order: 150, interactive: false }
    ]
  );
  for (const step of steps) {
    assert.equal(typeof step.isEligible, "function", step.id);
    assert.equal(typeof step.run, "function", step.id);
  }
});

test("composition root registers background services after constructing the pipeline", async () => {
  const source = await readFile(
    new URL("../scripts/main.js", import.meta.url),
    "utf8"
  );
  const pipelineIndex = source.indexOf(
    "this.longRestPipelineService = new LongRestPipelineService("
  );
  const registrationIndex = source.indexOf(
    "service.registerLongRestSteps?.(this.longRestPipelineService)"
  );

  assert.ok(pipelineIndex >= 0);
  assert.ok(registrationIndex > pipelineIndex);
  for (const property of [
    "runeKnightAutomationService",
    "performerAutomationService",
    "fighterAutomationService",
    "sorcererAutomationService",
    "raceAutomationService"
  ]) {
    assert.match(
      source.slice(pipelineIndex, registrationIndex),
      new RegExp(`this\\.${property}`, "u")
    );
  }
});
