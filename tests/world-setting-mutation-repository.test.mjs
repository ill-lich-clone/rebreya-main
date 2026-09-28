import assert from "node:assert/strict";
import test from "node:test";

import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

let WorldSettingMutationRepository;
try {
  ({ WorldSettingMutationRepository } = await import(
    "../scripts/infrastructure/foundry/world-setting-mutation-repository.js"
  ));
}
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

function clone(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function requireRepository() {
  assert.equal(
    typeof WorldSettingMutationRepository,
    "function",
    "WorldSettingMutationRepository must be exported by the Batch 1 module"
  );
  return WorldSettingMutationRepository;
}

function createSettings(initialValue, { setFailure = null } = {}) {
  let currentValue = clone(initialValue);
  const reads = [];
  const writes = [];
  return {
    settings: {
      get(moduleId, settingKey) {
        reads.push({ moduleId, settingKey, value: currentValue });
        return currentValue;
      },
      async set(moduleId, settingKey, value) {
        writes.push({ moduleId, settingKey, value: clone(value) });
        if (setFailure) throw setFailure;
        currentValue = clone(value);
      }
    },
    get reads() {
      return reads;
    },
    get value() {
      return clone(currentValue);
    },
    get writes() {
      return writes;
    },
    overwrite(value) {
      currentValue = clone(value);
    }
  };
}

function createMutationGateway({ assertActiveGm = () => {} } = {}) {
  const coordinator = new WorldMutationCoordinator();
  const commits = [];
  return {
    commits,
    commit(queueKey, operation) {
      commits.push(queueKey);
      return coordinator.run(queueKey, () => operation(Object.freeze({ assertActiveGm })));
    }
  };
}

function createRepository(initialValue, options = {}) {
  const settingStore = createSettings(initialValue, options);
  const mutationGateway = createMutationGateway(options);
  const Repository = requireRepository();
  const repository = new Repository({
    mutationGateway,
    gameProvider: () => ({ settings: settingStore.settings })
  });
  return { mutationGateway, repository, settingStore };
}

test("readObject returns a detached normalized object and defaults non-object settings to an empty object", () => {
  const { repository, settingStore } = createRepository({ nested: { value: 1 } });

  const read = repository.readObject("cityPresentationOverrides");
  read.nested.value = 99;

  assert.deepEqual(read, { nested: { value: 99 } });
  assert.deepEqual(settingStore.value, { nested: { value: 1 } });

  settingStore.overwrite(["not", "an", "object"]);
  assert.deepEqual(repository.readObject("cityPresentationOverrides"), {});

  settingStore.overwrite(new Date("2026-08-25T00:00:00.000Z"));
  assert.deepEqual(repository.readObject("cityPresentationOverrides"), {});
});

test("mutateObject enters the setting queue before its fresh read", async () => {
  const { mutationGateway, repository, settingStore } = createRepository({ stale: true });
  const releaseQueue = deferred();
  const blocker = mutationGateway.commit("setting:cityPresentationOverrides", async () => {
    await releaseQueue.promise;
  });
  let receivedDraft;
  const mutation = repository.mutateObject("cityPresentationOverrides", (draft) => {
    receivedDraft = clone(draft);
    draft.saved = true;
  });

  settingStore.overwrite({ fresh: true });
  releaseQueue.resolve();

  await Promise.all([blocker, mutation]);
  assert.deepEqual(receivedDraft, { fresh: true });
  assert.deepEqual(settingStore.value, { fresh: true, saved: true });
  assert.deepEqual(mutationGateway.commits, [
    "setting:cityPresentationOverrides",
    "setting:cityPresentationOverrides"
  ]);
});

test("mutateObject passes a detached draft, normalizes before writing, and runs afterCommit after success", async () => {
  const { repository, settingStore } = createRepository({ count: -4, ignored: true, nested: { value: 1 } });
  const events = [];
  const result = await repository.mutateObject(
    "cityPresentationOverrides",
    (draft) => {
      assert.notStrictEqual(draft, settingStore.reads.at(-1).value);
      assert.notStrictEqual(draft.nested, settingStore.reads.at(-1).value.nested);
      draft.count = 2.8;
      draft.nested.value = 7;
      draft.ignored = false;
      return { result: "authoritative" };
    },
    {
      normalize(value) {
        return {
          count: Math.max(0, Math.trunc(Number(value?.count) || 0)),
          nested: typeof value?.nested === "object" && value.nested !== null
            ? { value: Number(value.nested.value) || 0 }
            : { value: 0 }
        };
      },
      afterCommit(mutationResult, committed) {
        events.push({ mutationResult, committed, writes: settingStore.writes.length });
        committed.count = 99;
        return mutationResult;
      }
    }
  );

  assert.deepEqual(result, { result: "authoritative" });
  assert.deepEqual(settingStore.writes.map(({ value }) => value), [{ count: 2, nested: { value: 7 } }]);
  assert.deepEqual(settingStore.value, { count: 2, nested: { value: 7 } });
  assert.deepEqual(events, [{
    mutationResult: { result: "authoritative" },
    committed: { count: 99, nested: { value: 7 } },
    writes: 1
  }]);
});

test("mutateObject skips writes and afterCommit when the mutator fails", async () => {
  const { repository, settingStore } = createRepository({ count: 1 });
  let afterCommitCalls = 0;

  await assert.rejects(
    repository.mutateObject(
      "cityPresentationOverrides",
      () => {
        throw new Error("domain mutation failed");
      },
      { afterCommit: () => { afterCommitCalls += 1; } }
    ),
    /domain mutation failed/u
  );

  assert.deepEqual(settingStore.writes, []);
  assert.equal(afterCommitCalls, 0);
});

test("mutateObject returns a rejected draft result without a durable write", async () => {
  const { repository, settingStore } = createRepository({ count: 1 });
  let afterCommitCalls = 0;

  const result = await repository.mutateObject(
    "cityPresentationOverrides",
    (draft) => {
      draft.count = 2;
      return { changed: false };
    },
    {
      shouldCommit: (mutationResult) => mutationResult.changed === true,
      afterCommit: () => {
        afterCommitCalls += 1;
        return "unexpected";
      }
    }
  );

  assert.deepEqual(result, { changed: false });
  assert.deepEqual(settingStore.value, { count: 1 });
  assert.deepEqual(settingStore.writes, []);
  assert.equal(afterCommitCalls, 0);
});

test("mutateObject skips afterCommit when the setting write fails", async () => {
  const writeFailure = new Error("durable setting write failed");
  const { repository, settingStore } = createRepository(
    { count: 1 },
    { setFailure: writeFailure }
  );
  let afterCommitCalls = 0;

  await assert.rejects(
    repository.mutateObject(
      "cityPresentationOverrides",
      (draft) => { draft.count = 2; },
      { afterCommit: () => { afterCommitCalls += 1; } }
    ),
    /durable setting write failed/u
  );

  assert.equal(settingStore.writes.length, 1);
  assert.equal(afterCommitCalls, 0);
});

test("mutateObject checks active-GM authority immediately before and after its single write", async () => {
  const guardWriteCounts = [];
  const writeFailure = new Error("active GM changed after write");
  const settingStore = createSettings({ count: 1 });
  const mutationGateway = createMutationGateway({
    assertActiveGm() {
      guardWriteCounts.push(settingStore.writes.length);
      if (guardWriteCounts.length === 2) throw writeFailure;
    }
  });
  const Repository = requireRepository();
  const repository = new Repository({
    mutationGateway,
    gameProvider: () => ({ settings: settingStore.settings })
  });
  let afterCommitCalls = 0;

  await assert.rejects(
    repository.mutateObject(
      "cityPresentationOverrides",
      (draft) => { draft.count = 2; },
      { afterCommit: () => { afterCommitCalls += 1; } }
    ),
    /active GM changed after write/u
  );

  assert.deepEqual(guardWriteCounts, [0, 1]);
  assert.deepEqual(settingStore.value, { count: 2 });
  assert.equal(settingStore.writes.length, 1);
  assert.equal(afterCommitCalls, 0);
});

test("concurrent independent mutations preserve both edits from fresh drafts", async () => {
  const { repository, settingStore } = createRepository({ base: true });
  const firstMutatorStarted = deferred();
  const releaseFirstMutator = deferred();
  const first = repository.mutateObject("cityPresentationOverrides", async (draft) => {
    draft.first = true;
    firstMutatorStarted.resolve();
    await releaseFirstMutator.promise;
  });
  await firstMutatorStarted.promise;
  const second = repository.mutateObject("cityPresentationOverrides", (draft) => {
    draft.second = true;
  });

  releaseFirstMutator.resolve();
  await Promise.all([first, second]);

  assert.deepEqual(settingStore.value, { base: true, first: true, second: true });
});

test("replaceObject commits a detached normalized replacement through the setting queue", async () => {
  const { mutationGateway, repository, settingStore } = createRepository({ stale: true, remove: true });
  const releaseQueue = deferred();
  const blocker = mutationGateway.commit("setting:cityPresentationOverrides", async () => {
    await releaseQueue.promise;
  });
  const replacement = { nested: { value: 1 }, ignored: true };
  const replacing = repository.replaceObject("cityPresentationOverrides", replacement, {
    normalize(value) {
      return { nested: { value: Number(value?.nested?.value) || 0 } };
    }
  });
  replacement.nested.value = 99;
  releaseQueue.resolve();

  await Promise.all([blocker, replacing]);
  assert.deepEqual(settingStore.value, { nested: { value: 1 } });
  assert.deepEqual(mutationGateway.commits, [
    "setting:cityPresentationOverrides",
    "setting:cityPresentationOverrides"
  ]);
});
