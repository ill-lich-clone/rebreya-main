import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { CraftsmanConstructorService } from "../scripts/combat/craftsman-constructor-service.js";
import { CraftsmanGadgetService } from "../scripts/combat/craftsman-gadget-service.js";
import { FighterAutomationService } from "../scripts/combat/fighter-automation-service.js";
import { PaladinAutomationService } from "../scripts/combat/paladin-automation-service.js";
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

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return javascriptFiles(target);
    }
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
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
    "raceAutomationService",
    "craftsmanGadgetService",
    "craftsmanConstructorService"
  ]) {
    assert.match(
      source.slice(pipelineIndex, registrationIndex),
      new RegExp(`this\\.${property}`, "u")
    );
  }
});

test("race, Fighter, and Paladin register ordered interactive long-rest choices", () => {
  const { pipeline, steps } = stepRecorder();
  const services = [
    new RaceAutomationService({}),
    new FighterAutomationService({}),
    new PaladinAutomationService({})
  ];

  for (const service of services) {
    service.registerLongRestSteps(pipeline);
  }

  assert.deepEqual(
    steps
      .filter((step) => step.interactive === true)
      .map(({ id, order, interactive }) => ({ id, order, interactive })),
    [
      { id: "race.proficiency-swap", order: 200, interactive: true },
      { id: "fighter.multiattack", order: 210, interactive: true },
      { id: "paladin.prepared-spells", order: 220, interactive: true }
    ]
  );
  for (const step of steps.filter((entry) => entry.interactive === true)) {
    assert.equal(typeof step.isEligible, "function", step.id);
    assert.equal(typeof step.run, "function", step.id);
  }
});

test("interactive long-rest dialogs consume pipeline progress", async () => {
  const sources = await Promise.all([
    "race-automation-service.js",
    "fighter-automation-service.js",
    "paladin-automation-service.js"
  ].map(async (file) => [
    file,
    await readFile(new URL(`../scripts/combat/${file}`, import.meta.url), "utf8")
  ]));
  const byFile = new Map(sources);

  assert.match(
    byFile.get("race-automation-service.js"),
    /progress\?\.title\?\.\(title, substep\)/u
  );
  assert.match(
    byFile.get("race-automation-service.js"),
    /progress\?\.header\?\.\(title, substep\)/u
  );
  assert.match(
    byFile.get("fighter-automation-service.js"),
    /progress\?\.title\?\.\("Воинская мультиатака"\)/u
  );
  assert.match(
    byFile.get("fighter-automation-service.js"),
    /progress\?\.header\?\.\("Воинская мультиатака"\)/u
  );
  assert.match(
    byFile.get("paladin-automation-service.js"),
    /progress\?\.title\?\.\("Заклинания паладина"\)/u
  );
  assert.match(
    byFile.get("paladin-automation-service.js"),
    /progress\?\.header\?\.\("Заклинания паладина"\)/u
  );
});

test("Craftsman services register gadget and Constructor choices after class choices", () => {
  const { pipeline, steps } = stepRecorder();
  const services = [
    new CraftsmanGadgetService({}),
    new CraftsmanConstructorService({})
  ];

  for (const service of services) {
    service.registerLongRestSteps(pipeline);
  }

  assert.deepEqual(
    steps.map(({ id, order, interactive }) => ({ id, order, interactive })),
    [
      { id: "craftsman.gadgets", order: 230, interactive: true },
      { id: "craftsman.constructor", order: 240, interactive: true }
    ]
  );
});

test("Craftsman long-rest dialogs use outer progress and Constructor substeps", async () => {
  const gadgetSource = await readFile(
    new URL("../scripts/combat/craftsman-gadget-service.js", import.meta.url),
    "utf8"
  );
  const constructorSource = await readFile(
    new URL("../scripts/combat/craftsman-constructor-service.js", import.meta.url),
    "utf8"
  );

  assert.match(
    gadgetSource,
    /progress\?\.title\?\.\("Подготовка гаджетов"\)/u
  );
  assert.match(
    gadgetSource,
    /progress\?\.header\?\.\("Подготовка гаджетов"\)/u
  );
  assert.match(
    constructorSource,
    /progress\?\.title\?\.\("Сборка Конструкта", "1\/2"\)/u
  );
  assert.match(
    constructorSource,
    /progress\?\.title\?\.\("Сборка Конструкта", "2\/2"\)/u
  );
  assert.match(
    constructorSource,
    /progress\?\.header\?\.\("Сборка Конструкта", "1\/2"\)/u
  );
  assert.match(
    constructorSource,
    /progress\?\.header\?\.\("Сборка Конструкта", "2\/2"\)/u
  );
});

test("module contains one restCompleted registration and preserves preLongRest", async () => {
  const scriptsRoot = fileURLToPath(new URL("../scripts/", import.meta.url));
  const files = await javascriptFiles(scriptsRoot);
  const registrations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const _match of source.matchAll(
      /Hooks\.on\("dnd5e\.restCompleted"/gu
    )) {
      registrations.push(
        path.relative(scriptsRoot, file).replaceAll("\\", "/")
      );
    }
  }

  assert.deepEqual(registrations, ["integrations/long-rest-hooks.js"]);
  const combatHooks = await readFile(
    new URL("../scripts/combat/hooks.js", import.meta.url),
    "utf8"
  );
  assert.match(combatHooks, /Hooks\.on\("dnd5e\.preLongRest"/u);
});
