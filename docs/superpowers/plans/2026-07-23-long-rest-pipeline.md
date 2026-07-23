# Long Rest Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить независимые обработчики продолжительного отдыха одним расширяемым сервисом, который последовательно выполняет фоновые и интерактивные шаги и показывает `Шаг N/X`.

**Architecture:** Новый `LongRestPipelineService` хранит валидированный реестр шагов, строит план для одного Actor и сериализует запуски по Actor UUID. Отдельный Foundry-адаптер регистрирует единственный `dnd5e.restCompleted`, а существующие игровые сервисы самостоятельно добавляют фоновые и интерактивные провайдеры в реестр.

**Tech Stack:** JavaScript ES modules, Foundry VTT Hooks/Dialog/DialogV2, dnd5e 5.2.5, Node.js `node:test`, `node:assert/strict`.

## Global Constraints

- Работать только в `lich_branch`; перед каждой группой правок проверять `git status`, ветку и `git fetch origin`.
- Не изменять и не пушить `main`/`master`; не использовать force push.
- Один `dnd5e.restCompleted`-диспетчер обслуживает все типы отдыха.
- `dnd5e.preLongRest` остаётся отдельным синхронным хуком.
- Закрытие интерактивного окна пропускает только текущий шаг.
- Ошибка шага не прерывает последующие шаги.
- Фоновые шаги не входят в `N/X`.
- Сервис не создаёт постоянных Actor flags, Items или Active Effects.
- Два отдыха одного Actor сериализуются; разные Actor не блокируют друг друга.
- Производственный код пишется только после наблюдаемого падения соответствующего теста.
- Перед каждым коммитом запускать сфокусированные тесты и `git diff --check`.
- Перед финальным коммитом запускать полный `node --test tests/*.test.mjs`.

---

## File Structure

- Create `scripts/rest/long-rest-pipeline-service.js`: реестр, планирование, actor-очереди, прогресс, история и результаты.
- Create `scripts/integrations/long-rest-hooks.js`: единственный Foundry-хук и распознавание типа отдыха.
- Create `tests/long-rest-pipeline-service.test.mjs`: unit-тесты нейтрального сервиса.
- Create `tests/long-rest-hooks.test.mjs`: тесты маршрутизации long/short rest и идемпотентности хука.
- Create `tests/long-rest-provider-registration.test.mjs`: тест состава, порядка и source-level запрета прямых rest-хуков.
- Modify `scripts/main.js`: composition root, публичный API и регистрация нового хука.
- Modify `scripts/combat/hooks.js`: удалить прямые post-rest callback-ы, сохранить `preLongRest`.
- Modify `scripts/integrations/craftsman-gadget-hooks.js`: удалить прямой post-rest callback Ремесленника.
- Modify `tests/craftsman-gadget-hooks.test.mjs`: убрать ожидания старого rest-hook, сохранить остальные интеграционные проверки.
- Modify `scripts/combat/rune-knight-automation-service.js`: зарегистрировать фоновый long-rest шаг; short-rest остаётся доступен диспетчеру.
- Modify `scripts/combat/performer-automation-service.js`: зарегистрировать фоновую очистку.
- Modify `scripts/combat/sorcerer-automation-service.js`: зарегистрировать фоновое восстановление.
- Modify `scripts/combat/race-automation-service.js`: разделить восстановление ячейки и смену владения; добавить progress в окна.
- Modify `scripts/combat/fighter-automation-service.js`: разделить восстановление и выбор мультиатаки; добавить progress.
- Modify `scripts/combat/paladin-automation-service.js`: зарегистрировать выбор заклинаний; добавить progress.
- Modify `scripts/combat/craftsman-gadget-service.js`: зарегистрировать подготовку гаджетов; добавить progress.
- Modify `scripts/combat/craftsman-constructor-service.js`: зарегистрировать настройку Конструкта; добавить общий и внутренний прогресс.
- Modify соответствующие `tests/*-service.test.mjs`: проверить провайдеры и закрытие окна без мутаций.

---

### Task 1: Core LongRestPipelineService

**Files:**
- Create: `scripts/rest/long-rest-pipeline-service.js`
- Create: `tests/long-rest-pipeline-service.test.mjs`

**Interfaces:**
- Produces: `LongRestPipelineService`, `LONG_REST_HISTORY_LIMIT`, `LONG_REST_STEP_STATUS`.
- Produces: `registerStep(definition)`, `enqueue(actor, result, config)`, `run(actor, result, config)`, `getRecentRuns()`, `shutdown(reason)`.
- `run()` resolves to `{ runId, actorUuid, status, steps }`.

- [ ] **Step 1: Write failing validation and ordering tests**

Add imports and these first tests:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  LONG_REST_HISTORY_LIMIT,
  LongRestPipelineService
} from "../scripts/rest/long-rest-pipeline-service.js";

function actor(id) {
  return { id, uuid: `Actor.${id}` };
}

test("long-rest registry rejects invalid and duplicate providers", () => {
  const pipeline = new LongRestPipelineService();
  assert.throws(() => pipeline.registerStep({}), /id/u);
  assert.throws(() => pipeline.registerStep({ id: "broken" }), /run/u);
  pipeline.registerStep({ id: "valid", order: 100, run: async () => ({ status: "completed" }) });
  assert.throws(
    () => pipeline.registerStep({ id: "valid", order: 200, run: async () => ({ status: "completed" }) }),
    /already registered/u
  );
});

test("long-rest plan filters providers and sorts by order then id", async () => {
  const calls = [];
  const pipeline = new LongRestPipelineService({ idFactory: () => "run-1" });
  pipeline.registerStep({
    id: "z-last",
    order: 200,
    isEligible: () => true,
    run: async () => { calls.push("z-last"); return { status: "completed" }; }
  });
  pipeline.registerStep({
    id: "b-second",
    order: 100,
    isEligible: () => true,
    run: async () => { calls.push("b-second"); return { status: "completed" }; }
  });
  pipeline.registerStep({
    id: "a-first",
    order: 100,
    isEligible: () => true,
    run: async () => { calls.push("a-first"); return { status: "completed" }; }
  });
  pipeline.registerStep({
    id: "filtered",
    order: 50,
    isEligible: () => false,
    run: async () => { calls.push("filtered"); return { status: "completed" }; }
  });

  const result = await pipeline.run(actor("hero"), { type: "long" }, {});

  assert.deepEqual(calls, ["a-first", "b-second", "z-last"]);
  assert.deepEqual(result.steps.map((step) => step.id), calls);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test tests/long-rest-pipeline-service.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for
`scripts/rest/long-rest-pipeline-service.js`.

- [ ] **Step 3: Implement registration and sorted execution**

Create the service with these public constants and validation rules:

```js
export const LONG_REST_HISTORY_LIMIT = 32;
export const LONG_REST_STEP_STATUS = Object.freeze({
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed"
});

export class LongRestPipelineService {
  constructor(options = {}) {
    this.options = options;
    this._steps = new Map();
    this._actorQueues = new Map();
    this._seenResults = new WeakMap();
    this._recentRuns = [];
  }

  registerStep(definition = {}) {
    const id = String(definition.id ?? "").trim();
    if (!id) throw new TypeError("Long-rest step requires id");
    if (typeof definition.run !== "function") {
      throw new TypeError(`Long-rest step ${id} requires run`);
    }
    if (this._steps.has(id)) throw new Error(`Long-rest step ${id} is already registered`);
    const order = Number(definition.order ?? 500);
    if (!Number.isFinite(order)) throw new TypeError(`Long-rest step ${id} requires finite order`);
    this._steps.set(id, Object.freeze({ ...definition, id, order }));
    return this;
  }
}
```

Implement `run()` so it filters with `isEligible`, sorts by
`order || id`, awaits every `run`, normalizes unknown successful return values
to `completed`, and returns one step result per planned provider.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test tests/long-rest-pipeline-service.test.mjs
```

Expected: 2 tests pass.

- [ ] **Step 5: Add failing progress, skip and error-continuation tests**

Append:

```js
test("interactive progress excludes background steps and remains stable", async () => {
  const observed = [];
  const pipeline = new LongRestPipelineService({ idFactory: () => "run-progress" });
  pipeline.registerStep({
    id: "background",
    order: 100,
    interactive: false,
    run: async ({ progress }) => {
      observed.push(["background", progress.current, progress.total]);
      return { status: "completed" };
    }
  });
  for (const [id, order] of [["choice-a", 200], ["choice-b", 210]]) {
    pipeline.registerStep({
      id,
      label: id,
      order,
      interactive: true,
      run: async ({ progress }) => {
        observed.push([id, progress.current, progress.total, progress.title(id)]);
        return { status: id === "choice-a" ? "skipped" : "completed" };
      }
    });
  }

  await pipeline.run(actor("progress"), { type: "long" }, {});

  assert.deepEqual(observed, [
    ["background", 0, 2],
    ["choice-a", 1, 2, "Шаг 1/2 · choice-a"],
    ["choice-b", 2, 2, "Шаг 2/2 · choice-b"]
  ]);
});

test("failed step is recorded and later steps still run", async () => {
  const calls = [];
  const errors = [];
  const notifications = [];
  const pipeline = new LongRestPipelineService({
    logger: { error: (...args) => errors.push(args) },
    notifyError: (message) => notifications.push(message)
  });
  pipeline.registerStep({
    id: "broken",
    order: 100,
    run: async () => { throw new Error("broken step"); }
  });
  pipeline.registerStep({
    id: "healthy",
    order: 200,
    run: async () => { calls.push("healthy"); return { status: "completed" }; }
  });

  const result = await pipeline.run(actor("durable"), { type: "long" }, {});

  assert.deepEqual(calls, ["healthy"]);
  assert.deepEqual(result.steps.map((step) => step.status), ["failed", "completed"]);
  assert.equal(errors.length, 1);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /1/u);
});

test("provider is revalidated before execution", async () => {
  let eligible = true;
  let secondRuns = 0;
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "first",
    order: 100,
    run: async () => { eligible = false; return { status: "completed" }; }
  });
  pipeline.registerStep({
    id: "second",
    order: 200,
    isEligible: () => eligible,
    run: async () => { secondRuns += 1; return { status: "completed" }; }
  });

  const result = await pipeline.run(actor("revalidate"), { type: "long" }, {});

  assert.equal(secondRuns, 0);
  assert.equal(result.steps[1].status, "skipped");
});

test("shutdown aborts the signal supplied to providers", async () => {
  let observedSignal;
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "signal",
    run: async ({ signal }) => {
      observedSignal = signal;
      return { status: "completed" };
    }
  });
  await pipeline.run(actor("signal"), { type: "long" }, {});
  assert.equal(observedSignal.aborted, false);
  pipeline.shutdown("world-closed");
  assert.equal(observedSignal.aborted, true);
  assert.equal(observedSignal.reason, "world-closed");
});
```

- [ ] **Step 6: Run and verify RED**

Run the focused test. Expected failures: missing `progress`, provider exception
rejects the run, and revalidation does not produce `skipped`.

- [ ] **Step 7: Implement progress and per-step failure isolation**

Add a private progress builder that returns:

```js
{
  current,
  total,
  title: (label = defaultLabel, substep = "") => (
    `Шаг ${current}/${total} · ${label}${substep ? ` · ${substep}` : ""}`
  ),
  header: (label = defaultLabel, substep = "") => (
    `<p class="rebreya-long-rest-progress"><strong>`
    + `Шаг ${current}/${total} · ${escapeHtml(label)}`
    + `${substep ? ` · ${escapeHtml(substep)}` : ""}`
    + `</strong></p>`
  )
}
```

Catch errors around both revalidation and `run`. Record a safe `error` string,
call `logger.error`, and continue. Revalidation `false` records `skipped`
without calling `run`. After the plan, call `notifyError` exactly once with the
number of failed steps. Construct one `AbortController`, pass its signal to
every provider, and expose `shutdown(reason)` as
`this._abortController.abort(reason)`.

- [ ] **Step 8: Verify GREEN**

Run the focused test. Expected: 6 tests pass.

- [ ] **Step 9: Add failing actor-queue, deduplication and bounded-history tests**

Append tests that hold the first promise and assert exact order:

```js
test("same actor rests serialize while different actors can overlap", async () => {
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "gate",
    order: 100,
    run: async ({ result }) => {
      calls.push(`${result.id}:start`);
      if (result.id === "first") await firstGate;
      calls.push(`${result.id}:end`);
      return { status: "completed" };
    }
  });

  const first = pipeline.enqueue(actor("same"), { id: "first", type: "long" }, {});
  const second = pipeline.enqueue(actor("same"), { id: "second", type: "long" }, {});
  const other = pipeline.enqueue(actor("other"), { id: "other", type: "long" }, {});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["first:start", "other:start", "other:end"]);
  releaseFirst();
  await Promise.all([first, second, other]);
  assert.deepEqual(calls, [
    "first:start", "other:start", "other:end",
    "first:end", "second:start", "second:end"
  ]);
});

test("same result object is deduplicated and history remains bounded", async () => {
  let calls = 0;
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "count",
    run: async () => { calls += 1; return { status: "completed" }; }
  });
  const restResult = { type: "long" };
  const first = pipeline.enqueue(actor("duplicate"), restResult, {});
  const duplicate = pipeline.enqueue(actor("duplicate"), restResult, {});
  assert.strictEqual(duplicate, first);
  await first;
  assert.equal(calls, 1);

  for (let index = 0; index < LONG_REST_HISTORY_LIMIT + 5; index += 1) {
    await pipeline.enqueue(actor(`history-${index}`), { type: "long", index }, {});
  }
  assert.equal(pipeline.getRecentRuns().length, LONG_REST_HISTORY_LIMIT);
  assert.equal(pipeline._actorQueues.size, 0);
});
```

- [ ] **Step 10: Run RED, implement queues/history, then verify GREEN**

`enqueue()` must:

```js
const actorKey = String(actor?.uuid ?? actor?.id ?? "").trim();
const duplicate = result && typeof result === "object"
  ? this._seenResults.get(result)
  : null;
if (duplicate) return duplicate;
const previous = this._actorQueues.get(actorKey) ?? Promise.resolve();
const current = previous.catch(() => undefined).then(() => this.run(actor, result, config));
```

Store the promise in `_seenResults`, remove the Actor queue in `finally`, append
completed results to a 32-entry FIFO array, and return defensive copies from
`getRecentRuns()`.

Run:

```powershell
node --test tests/long-rest-pipeline-service.test.mjs
git diff --check
```

Expected: all pipeline tests pass and diff check exits 0.

- [ ] **Step 11: Commit core service**

```powershell
git add scripts/rest/long-rest-pipeline-service.js tests/long-rest-pipeline-service.test.mjs
git commit -m "feat: add long rest pipeline service"
```

---

### Task 2: One Foundry rest dispatcher and public module API

**Files:**
- Create: `scripts/integrations/long-rest-hooks.js`
- Create: `tests/long-rest-hooks.test.mjs`
- Modify: `scripts/main.js`

**Interfaces:**
- Consumes: `LongRestPipelineService.enqueue(actor, result, config)`.
- Produces: `registerLongRestHooks(moduleApi, options)`, `restKind(result, config)`.
- Produces on module API: `registerLongRestStep`, `runLongRestPipeline`, `getRecentLongRestRuns`.

- [ ] **Step 1: Write failing dispatcher tests**

Create a harness that stores arrays of listeners per hook and add:

```js
test("rest dispatcher sends long rest to pipeline and short rest to Rune Knight", async () => {
  const { Hooks, listeners } = hookHarness();
  const calls = [];
  registerLongRestHooks({
    longRestPipelineService: {
      enqueue: async (...args) => calls.push(["long", ...args])
    },
    runeKnightAutomationService: {
      handleRestCompleted: async (...args) => calls.push(["short", ...args])
    }
  }, { Hooks, game: {} });

  const actor = { uuid: "Actor.hero" };
  listeners.get("dnd5e.restCompleted")(actor, { type: "long" }, {});
  listeners.get("dnd5e.restCompleted")(actor, { type: "short" }, {});
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls.map((entry) => entry[0]), ["long", "short"]);
});

test("rest dispatcher registers exactly once and ignores unknown rests", async () => {
  const { Hooks, listeners, counts } = hookHarness();
  const game = {};
  const moduleApi = {
    longRestPipelineService: { enqueue: async () => assert.fail("must not run") }
  };
  registerLongRestHooks(moduleApi, { Hooks, game });
  registerLongRestHooks(moduleApi, { Hooks, game });
  assert.equal(counts.get("dnd5e.restCompleted"), 1);
  listeners.get("dnd5e.restCompleted")({}, {}, {});
  await new Promise((resolve) => setImmediate(resolve));
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test tests/long-rest-hooks.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the dispatcher**

Export `restKind` accepting `type`, `restType`, `period`, `longRest`, and
`shortRest` from both `result` and `config`. Register one guarded hook under
`${MODULE_ID}.longRestHooksRegistered`. The hook must start a promise and catch
errors through an injected/default logger, but always return `true` to Foundry.
Register `Hooks.once?.("closeWorld", () => pipeline.shutdown("world-closed"))`
under the same guard.

- [ ] **Step 4: Verify dispatcher tests GREEN**

Run the focused file. Expected: both tests pass.

- [ ] **Step 5: Write failing composition-root source test**

Read `scripts/main.js` and assert imports, construction before providers,
public methods, and `registerLongRestHooks(moduleApi)`.

```js
assert.match(source, /import \{ LongRestPipelineService \} from "\.\/rest\/long-rest-pipeline-service\.js";/u);
assert.match(source, /this\.longRestPipelineService = new LongRestPipelineService\(/u);
assert.match(source, /registerLongRestStep\(definition\) \{[\s\S]*?registerStep\(definition\)/u);
assert.match(source, /runLongRestPipeline\(actor, result = \{\}, config = \{\}\)/u);
assert.match(source, /registerLongRestHooks\(moduleApi\)/u);
```

- [ ] **Step 6: Run RED, wire `main.js`, then verify GREEN**

Add imports, construct the pipeline before class services, expose:

```js
registerLongRestStep(definition) {
  return this.longRestPipelineService.registerStep(definition);
}

runLongRestPipeline(actor, result = {}, config = {}) {
  return this.longRestPipelineService.enqueue(actor, result, config);
}

getRecentLongRestRuns() {
  return this.longRestPipelineService.getRecentRuns();
}
```

Register the new hook in `ready` near combat hooks. Run:

```powershell
node --test tests/long-rest-hooks.test.mjs
node --check scripts/integrations/long-rest-hooks.js
node --check scripts/main.js
git diff --check
```

- [ ] **Step 7: Commit dispatcher/API**

```powershell
git add scripts/integrations/long-rest-hooks.js scripts/main.js tests/long-rest-hooks.test.mjs
git commit -m "feat: route rests through one dispatcher"
```

---

### Task 3: Migrate background rest providers

**Files:**
- Modify: `scripts/combat/rune-knight-automation-service.js`
- Modify: `scripts/combat/performer-automation-service.js`
- Modify: `scripts/combat/sorcerer-automation-service.js`
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `scripts/combat/fighter-automation-service.js`
- Modify: `tests/rune-knight-automation-service.test.mjs`
- Modify: `tests/performer-automation-service.test.mjs`
- Modify: `tests/sorcerer-automation-service.test.mjs`
- Modify: `tests/race-automation-service.test.mjs`
- Modify: `tests/fighter-automation-service.test.mjs`

**Interfaces:**
- Consumes: `pipeline.registerStep(definition)`.
- Produces on each service: `registerLongRestSteps(pipeline)`.
- Orders: Rune `110`, Performer `120`, Fighter restore `130`, Sorcerer `140`, race spell slot `150`.

- [ ] **Step 1: Add failing provider-registration tests to each existing suite**

Use a recorder:

```js
function stepRecorder() {
  const steps = [];
  return {
    steps,
    pipeline: { registerStep(step) { steps.push(step); return this; } }
  };
}
```

For each service, call `registerLongRestSteps(pipeline)` and assert the exact
background IDs, orders and `interactive === false`:

```text
rune-knight.restore
performer.clear-state
fighter.restore
sorcerer.restore
race.restore-spell-slot
```

Execute each recorded provider with the same Actor fixture already used by its
existing `handleRestCompleted` test and assert the same resource/state result.

- [ ] **Step 2: Run the five focused service suites and verify RED**

Run:

```powershell
node --test tests/rune-knight-automation-service.test.mjs
node --test tests/performer-automation-service.test.mjs
node --test tests/fighter-automation-service.test.mjs
node --test tests/sorcerer-automation-service.test.mjs
node --test tests/race-automation-service.test.mjs
```

Expected: failures because `registerLongRestSteps` is undefined.

- [ ] **Step 3: Add minimal registration methods**

Each method must validate only `pipeline.registerStep`, register its exact
descriptor once per service instance, and return `true`.

For mixed services, extract narrow methods:

```js
async restoreAfterLongRest(actor) {
  await this.repairActor(actor);
  const secondWind = this.#findSecondWind(actor);
  if (secondWind?.system?.uses?.spent) {
    await this.#ensureSecondWindResource(actor, secondWind, { restore: true });
  }
  return true;
}
```

```js
async restoreRaceSpellSlotAfterLongRest(actor) {
  if (!this.#hasMechanic(actor, "spell-slot-scaling")) return false;
  return this.#restoreHighElfSpellSlot(actor);
}
```

Keep legacy `handleRestCompleted` behavior by calling the new narrow methods.
Do not register Foundry hooks from these services.

- [ ] **Step 4: Verify GREEN and regressions**

Run the same five suites. Expected: all pass.

- [ ] **Step 5: Wire background providers into composition root**

After all services are constructed, call:

```js
for (const service of [
  this.runeKnightAutomationService,
  this.performerAutomationService,
  this.fighterAutomationService,
  this.sorcererAutomationService,
  this.raceAutomationService
]) {
  service.registerLongRestSteps?.(this.longRestPipelineService);
}
```

Add a source assertion that these calls occur after
`this.longRestPipelineService` construction.

- [ ] **Step 6: Run focused tests, syntax checks and commit**

```powershell
node --test tests/long-rest-hooks.test.mjs tests/rune-knight-automation-service.test.mjs tests/performer-automation-service.test.mjs tests/fighter-automation-service.test.mjs tests/sorcerer-automation-service.test.mjs tests/race-automation-service.test.mjs
node --check scripts/combat/rune-knight-automation-service.js
node --check scripts/combat/performer-automation-service.js
node --check scripts/combat/fighter-automation-service.js
node --check scripts/combat/sorcerer-automation-service.js
node --check scripts/combat/race-automation-service.js
git diff --check
git add scripts/main.js scripts/combat/rune-knight-automation-service.js scripts/combat/performer-automation-service.js scripts/combat/fighter-automation-service.js scripts/combat/sorcerer-automation-service.js scripts/combat/race-automation-service.js tests
git commit -m "refactor: register background long rest steps"
```

---

### Task 4: Migrate interactive class and race providers with progress

**Files:**
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `scripts/combat/fighter-automation-service.js`
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `tests/race-automation-service.test.mjs`
- Modify: `tests/fighter-automation-service.test.mjs`
- Modify: `tests/paladin-automation-service.test.mjs`

**Interfaces:**
- Produces interactive IDs: `race.proficiency-swap` order `200`,
  `fighter.multiattack` order `210`, `paladin.prepared-spells` order `220`.
- Consumes: `execution.progress.title(label, substep)` and
  `execution.progress.header(label, substep)`.

- [ ] **Step 1: Write failing registration and skip tests**

For every service:

- assert exact provider `id`, `order`, `interactive: true`;
- use an ineligible Actor and assert `isEligible === false`;
- use an eligible existing Actor fixture and assert `isEligible === true`;
- inject prompt return `null`/`false`, run the provider, assert
  `{ status: "skipped" }` and unchanged Actor/Item state.

For progress, inject:

```js
const progress = {
  title: (label) => `Шаг 1/3 · ${label}`,
  header: () => "<p>Шаг 1/3</p>"
};
```

Capture the Dialog options and assert both strings are included.

- [ ] **Step 2: Run focused suites and verify RED**

Expected failures: missing interactive provider descriptors and missing
progress text.

- [ ] **Step 3: Implement narrow interactive methods**

Extract:

```js
async chooseRaceProficiencyAfterLongRest(actor, execution = {}) {
  if (!this.#hasMechanic(actor, "proficiency-swap")) {
    return { status: "skipped" };
  }
  const changed = await this.#promptSkillProficiencySwap(actor, execution.progress);
  return { status: changed ? "completed" : "skipped" };
}

async chooseFighterMultiattackAfterLongRest(actor, execution = {}) {
  const changed = await this.#handleMultiattackRestChoice(actor, execution.progress);
  return { status: changed ? "completed" : "skipped" };
}

async choosePaladinSpellsAfterLongRest(actor, execution = {}) {
  const changed = await this.#handlePreparedSpellRestChoice(actor, execution.progress);
  return { status: changed ? "completed" : "skipped" };
}
```

The actual code must reuse existing private selectors and mutations. It must
pass `execution.progress` into prompt helpers, prefix dialog content with
`progress.header(label)`, and use `progress.title(label)` for window titles.
When a prompt is closed or declined, return `{ status: "skipped" }` before any
mutation. Successful application returns `{ status: "completed" }`.

Keep legacy `handleRestCompleted` methods as compatibility wrappers that call
the background and/or interactive narrow methods without a progress object.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test tests/race-automation-service.test.mjs tests/fighter-automation-service.test.mjs tests/paladin-automation-service.test.mjs
```

- [ ] **Step 5: Register Paladin in composition root and verify all provider IDs**

Add Paladin to registration in `main.js`. Create
`tests/long-rest-provider-registration.test.mjs` that constructs recorder
providers or reads source and asserts every expected ID appears exactly once.

- [ ] **Step 6: Run syntax/diff checks and commit**

```powershell
node --test tests/long-rest-provider-registration.test.mjs tests/race-automation-service.test.mjs tests/fighter-automation-service.test.mjs tests/paladin-automation-service.test.mjs
node --check scripts/combat/race-automation-service.js
node --check scripts/combat/fighter-automation-service.js
node --check scripts/combat/paladin-automation-service.js
git diff --check
git add scripts/main.js scripts/combat/race-automation-service.js scripts/combat/fighter-automation-service.js scripts/combat/paladin-automation-service.js tests
git commit -m "refactor: queue long rest character choices"
```

---

### Task 5: Migrate Craftsman providers and remove legacy rest hooks

**Files:**
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Modify: `scripts/combat/craftsman-constructor-service.js`
- Modify: `scripts/integrations/craftsman-gadget-hooks.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `scripts/main.js`
- Modify: `tests/craftsman-gadget-service.test.mjs`
- Modify: `tests/craftsman-constructor-service.test.mjs`
- Modify: `tests/craftsman-gadget-hooks.test.mjs`
- Modify: `tests/long-rest-provider-registration.test.mjs`

**Interfaces:**
- Produces: `craftsman.gadgets` order `230`,
  `craftsman.constructor` order `240`.
- Constructor uses the same outer progress number and substeps `1/2`, `2/2`.

- [ ] **Step 1: Write failing Craftsman provider tests**

Assert:

```js
assert.deepEqual(
  steps.map(({ id, order, interactive }) => ({ id, order, interactive })),
  [{ id: "craftsman.gadgets", order: 230, interactive: true }]
);
```

and equivalent Constructor descriptor with order `240`.

Inject a progress formatter and capture dialog options:

```js
assert.equal(gadgetDialog.window.title, "Шаг 1/2 · Подготовка гаджетов");
assert.equal(constructorDialogs[0].window.title, "Шаг 2/2 · Сборка Конструкта · 1/2");
assert.equal(constructorDialogs[1].window.title, "Шаг 2/2 · Сборка Конструкта · 2/2");
```

Close each first dialog and assert the provider returns `skipped` without
deleting the prior gadget loadout or changing prepared construct state.

- [ ] **Step 2: Run focused Craftsman suites and verify RED**

Run:

```powershell
node --test tests/craftsman-gadget-service.test.mjs tests/craftsman-constructor-service.test.mjs
```

- [ ] **Step 3: Implement provider registration and progress**

Add `registerLongRestSteps()` to both services. Reuse current capacity,
subclass and ownership checks for `isEligible`. Pass progress through
`#replaceLoadout`, `#promptLoadout`, and `#promptConfiguration`. Normalize
closed dialogs to `{ status: "skipped" }`, while retaining current rollback
behavior on failed loadout creation.

- [ ] **Step 4: Verify Craftsman GREEN**

Run both focused suites. Expected: all tests pass.

- [ ] **Step 5: Write failing source-level one-hook guard**

In `tests/long-rest-provider-registration.test.mjs`, recursively read
`scripts/**/*.js` and assert:

```js
const registrations = sources
  .flatMap(({ path, source }) => [...source.matchAll(/Hooks\.on\("dnd5e\.restCompleted"/gu)]
    .map(() => path));
assert.deepEqual(registrations, ["scripts/integrations/long-rest-hooks.js"]);
```

Also assert `scripts/combat/hooks.js` still contains
`Hooks.on("dnd5e.preLongRest"` and that Craftsman activity/document hooks
remain registered.

- [ ] **Step 6: Run RED, remove legacy hooks and wire Craftsman providers**

Delete every direct `dnd5e.restCompleted` block from `scripts/combat/hooks.js`
and `scripts/integrations/craftsman-gadget-hooks.js`. Update the old gadget
hook tests so their expected call sets no longer contain `rest`. Add both
Craftsman services to the composition-root provider-registration list.

- [ ] **Step 7: Verify focused integration and commit**

```powershell
node --test tests/long-rest-hooks.test.mjs tests/long-rest-provider-registration.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-gadget-service.test.mjs tests/craftsman-constructor-service.test.mjs
node --check scripts/combat/hooks.js
node --check scripts/integrations/craftsman-gadget-hooks.js
node --check scripts/combat/craftsman-gadget-service.js
node --check scripts/combat/craftsman-constructor-service.js
git diff --check
git add scripts/main.js scripts/combat scripts/integrations tests
git commit -m "refactor: migrate rest mechanics to pipeline"
```

---

### Task 6: Full regression and P0 completion

**Files:**
- Modify only files required by a reproduced failing regression test.
- Update: `docs/superpowers/plans/2026-07-23-long-rest-pipeline.md` checkboxes.

**Interfaces:**
- Consumes the completed P0 API.
- Produces a verified branch ready for P1.

- [ ] **Step 1: Run source and syntax checks**

```powershell
git diff --check
node --check scripts/rest/long-rest-pipeline-service.js
node --check scripts/integrations/long-rest-hooks.js
node --check scripts/main.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run all focused P0 tests together**

```powershell
node --test tests/long-rest-pipeline-service.test.mjs tests/long-rest-hooks.test.mjs tests/long-rest-provider-registration.test.mjs tests/rune-knight-automation-service.test.mjs tests/performer-automation-service.test.mjs tests/fighter-automation-service.test.mjs tests/sorcerer-automation-service.test.mjs tests/race-automation-service.test.mjs tests/paladin-automation-service.test.mjs tests/craftsman-gadget-hooks.test.mjs tests/craftsman-gadget-service.test.mjs tests/craftsman-constructor-service.test.mjs
```

Expected: 0 failed tests.

- [ ] **Step 3: Run the complete suite**

```powershell
node --test tests/*.test.mjs
```

Expected: 0 failed tests.

- [ ] **Step 4: Inspect the final implementation diff**

```powershell
git status --short
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- scripts/rest scripts/integrations/long-rest-hooks.js scripts/combat/hooks.js scripts/main.js
```

Confirm manually:

- one rest hook;
- no provider-specific checks in the pipeline;
- no unbounded maps or arrays;
- all `_actorQueues` cleanup occurs in `finally`;
- all interactive providers return before mutation on close;
- progress is shown only for interactive providers.

- [ ] **Step 5: Commit any test-driven regression fix**

Only when Step 3 exposed a real failure: add a minimal failing test, observe
RED, implement the minimal fix, observe GREEN, then:

```powershell
git add scripts tests
git commit -m "fix: preserve long rest compatibility"
```

If no regression exists, do not create an empty commit.

- [ ] **Step 6: Mark P0 complete in the plan and commit the checklist**

```powershell
git add docs/superpowers/plans/2026-07-23-long-rest-pipeline.md
git commit -m "docs: record long rest pipeline completion"
```

After this task, begin the separate P1 Модифицирование specification and plan.
