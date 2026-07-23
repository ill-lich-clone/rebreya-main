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
  pipeline.registerStep({
    id: "valid",
    order: 100,
    run: async () => ({ status: "completed" })
  });
  assert.throws(
    () => pipeline.registerStep({
      id: "valid",
      order: 200,
      run: async () => ({ status: "completed" })
    }),
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
    run: async () => {
      calls.push("z-last");
      return { status: "completed" };
    }
  });
  pipeline.registerStep({
    id: "b-second",
    order: 100,
    isEligible: () => true,
    run: async () => {
      calls.push("b-second");
      return { status: "completed" };
    }
  });
  pipeline.registerStep({
    id: "a-first",
    order: 100,
    isEligible: () => true,
    run: async () => {
      calls.push("a-first");
      return { status: "completed" };
    }
  });
  pipeline.registerStep({
    id: "filtered",
    order: 50,
    isEligible: () => false,
    run: async () => {
      calls.push("filtered");
      return { status: "completed" };
    }
  });

  const result = await pipeline.run(actor("hero"), { type: "long" }, {});

  assert.deepEqual(calls, ["a-first", "b-second", "z-last"]);
  assert.deepEqual(result.steps.map((step) => step.id), calls);
});

test("interactive progress excludes background steps and remains stable", async () => {
  const observed = [];
  const pipeline = new LongRestPipelineService({
    idFactory: () => "run-progress"
  });
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
    run: async () => {
      throw new Error("broken step");
    }
  });
  pipeline.registerStep({
    id: "healthy",
    order: 200,
    run: async () => {
      calls.push("healthy");
      return { status: "completed" };
    }
  });

  const result = await pipeline.run(actor("durable"), { type: "long" }, {});

  assert.deepEqual(calls, ["healthy"]);
  assert.deepEqual(
    result.steps.map((step) => step.status),
    ["failed", "completed"]
  );
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
    run: async () => {
      eligible = false;
      return { status: "completed" };
    }
  });
  pipeline.registerStep({
    id: "second",
    order: 200,
    isEligible: () => eligible,
    run: async () => {
      secondRuns += 1;
      return { status: "completed" };
    }
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

test("same actor rests serialize while different actors can overlap", async () => {
  const calls = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "gate",
    order: 100,
    run: async ({ result }) => {
      calls.push(`${result.id}:start`);
      if (result.id === "first") {
        await firstGate;
      }
      calls.push(`${result.id}:end`);
      return { status: "completed" };
    }
  });

  const first = pipeline.enqueue(
    actor("same"),
    { id: "first", type: "long" },
    {}
  );
  const second = pipeline.enqueue(
    actor("same"),
    { id: "second", type: "long" },
    {}
  );
  const other = pipeline.enqueue(
    actor("other"),
    { id: "other", type: "long" },
    {}
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["first:start", "other:start", "other:end"]);
  releaseFirst();
  await Promise.all([first, second, other]);
  assert.deepEqual(calls, [
    "first:start",
    "other:start",
    "other:end",
    "first:end",
    "second:start",
    "second:end"
  ]);
});

test("same result object is deduplicated and history remains bounded", async () => {
  let calls = 0;
  const pipeline = new LongRestPipelineService();
  pipeline.registerStep({
    id: "count",
    run: async () => {
      calls += 1;
      return { status: "completed" };
    }
  });
  const restResult = { type: "long" };
  const first = pipeline.enqueue(actor("duplicate"), restResult, {});
  const duplicate = pipeline.enqueue(actor("duplicate"), restResult, {});

  assert.strictEqual(duplicate, first);
  await first;
  assert.equal(calls, 1);

  for (let index = 0; index < LONG_REST_HISTORY_LIMIT + 5; index += 1) {
    await pipeline.enqueue(
      actor(`history-${index}`),
      { type: "long", index },
      {}
    );
  }
  const recent = pipeline.getRecentRuns();
  assert.equal(recent.length, LONG_REST_HISTORY_LIMIT);
  assert.equal(pipeline._actorQueues.size, 0);
  recent[0].steps.length = 0;
  assert.notEqual(pipeline.getRecentRuns()[0].steps.length, 0);
});
