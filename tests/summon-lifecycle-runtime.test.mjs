import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_ID } from "../scripts/constants.js";
import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";
import {
  SUMMON_LINK_FLAG,
  SummonLifecycleRuntime,
  buildSummonLink,
  readSummonLink
} from "../scripts/combat/summon-lifecycle-runtime.js";

function summonDeclaration(overrides = {}) {
  return {
    runtime: "summon",
    recipe: "animate-objects",
    version: 1,
    ...overrides
  };
}

function activity(uuid = "Actor.source.Item.item.Activity.summon") {
  return {
    uuid,
    actor: { uuid: "Actor.source" },
    item: { uuid: "Actor.source.Item.item" }
  };
}

function managedContext(overrides = {}) {
  const usageConfig = overrides.usageConfig ?? {};
  return {
    activity: overrides.activity ?? activity(),
    declaration: overrides.declaration ?? summonDeclaration(),
    usageConfig,
    operationId: overrides.operationId,
    token: overrides.token ?? { uuid: "Scene.main.Token.source" },
    ...overrides
  };
}

function createRuntime(options = {}) {
  let nextOperation = 0;
  return new SummonLifecycleRuntime({
    registry: options.registry ?? new SpellAutomationRegistry(),
    operationIdFactory: options.operationIdFactory ?? (() => `summon-operation-${++nextOperation}`),
    now: options.now ?? (() => 1_000),
    claimTimeoutMs: options.claimTimeoutMs,
    maxPendingClaims: options.maxPendingClaims
  });
}

test("registers an explicit summon recipe through the shared registry", () => {
  const registry = new SpellAutomationRegistry();
  const runtime = createRuntime({ registry });

  const provider = runtime.registerProvider({
    ...summonDeclaration(),
    validate() {}
  });

  assert.equal(registry.resolve(summonDeclaration()), provider);
  assert.equal(provider.runtime, "summon");
  assert.equal(provider.recipe, "animate-objects");
  assert.ok(Object.isFrozen(provider));
  assert.ok(Object.isFrozen(provider.handlers));
});

test("rejects duplicate providers and malformed lifecycle callbacks", () => {
  const runtime = createRuntime();
  const provider = summonDeclaration();

  runtime.registerProvider(provider);

  assert.throws(() => runtime.registerProvider(provider), /already registered/u);
  assert.throws(() => runtime.registerProvider({ ...summonDeclaration({ recipe: "bad-callback" }), validate: true }), TypeError);
  assert.throws(() => runtime.registerProvider({ ...summonDeclaration({ recipe: "unknown-callback" }), beforeSummon: () => {} }), TypeError);
  assert.throws(() => runtime.registerProvider({ ...summonDeclaration({ recipe: "async" }), prepareToken: async () => {} }), TypeError);
  assert.throws(() => runtime.registerProvider({ ...summonDeclaration({ recipe: "bad-config" }), config: { __proto__: { polluted: true } } }), TypeError);
});

test("ignores an unmanaged native summon", () => {
  const runtime = createRuntime();
  const result = runtime.claimPreUse({ activity: activity(), usageConfig: {} });

  assert.equal(result, null);
  assert.equal(runtime.pendingClaimCount, 0);
});

test("ignores the legacy craftsmanConstructor declaration", () => {
  const runtime = createRuntime();
  const result = runtime.claimPreUse({
    activity: {
      ...activity(),
      flags: { [MODULE_ID]: { craftsmanConstructor: { kind: "constructSummon", version: 1 } } }
    },
    declaration: summonDeclaration(),
    usageConfig: {}
  });

  assert.equal(result, null);
  assert.equal(runtime.pendingClaimCount, 0);
});

test("returns a frozen provider token list", () => {
  const runtime = createRuntime();
  let receivedTokens;
  runtime.registerProvider({
    ...summonDeclaration(),
    prepareToken(context) {
      receivedTokens = context.tokens;
    }
  });
  const context = managedContext({ operationId: "frozen-tokens" });

  runtime.claimPreUse(context);
  runtime.bindPreSummon({ activity: context.activity, summonOptions: context.usageConfig.summons[MODULE_ID] });
  runtime.prepareSummonToken({ activity: context.activity, summonOptions: context.usageConfig.summons[MODULE_ID], tokenData: {} });

  assert.deepEqual(receivedTokens, []);
  assert.ok(Object.isFrozen(receivedTokens));
  assert.throws(() => receivedTokens.push("Token.other"), TypeError);
});

test("pre-use creates one operation claim for a managed summon", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const context = managedContext({ operationId: "claim-one" });

  const claim = runtime.claimPreUse(context);

  assert.deepEqual(claim, {
    operationId: "claim-one",
    activityUuid: context.activity.uuid,
    declaration: summonDeclaration(),
    createdAt: 1_000
  });
  assert.deepEqual(context.usageConfig.summons[MODULE_ID], {
    operationId: "claim-one",
    runtime: "summon",
    recipe: "animate-objects",
    version: 1
  });
  assert.equal(runtime.pendingClaimCount, 1);
});

test("provider validation can reject a managed summon before it creates a claim", () => {
  const runtime = createRuntime();
  runtime.registerProvider({
    ...summonDeclaration(),
    validate(context) {
      assert.ok(Object.isFrozen(context.tokens));
      return false;
    }
  });

  const result = runtime.claimPreUse(managedContext({ operationId: "rejected" }));

  assert.equal(result, null);
  assert.equal(runtime.pendingClaimCount, 0);
});

test("repeated pre-use with the same operation id reuses the claim", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ operationId: "same-operation" });
  const second = managedContext({ operationId: "same-operation" });

  const initialClaim = runtime.claimPreUse(first);
  const repeatedClaim = runtime.claimPreUse(second);

  assert.equal(repeatedClaim, initialClaim);
  assert.equal(runtime.pendingClaimCount, 1);
});

test("preSummon binds the oldest matching activity claim to the options object", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ operationId: "first" });
  const second = managedContext({ operationId: "second" });
  runtime.claimPreUse(first);
  runtime.claimPreUse(second);
  const options = {};

  const bound = runtime.bindPreSummon({ activity: first.activity, summonOptions: options });

  assert.equal(bound.operationId, "first");
  assert.equal(runtime.bindPreSummon({ activity: first.activity, summonOptions: options }), bound);
});

test("an explicit options operation id wins over FIFO fallback", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ operationId: "first" });
  const second = managedContext({ operationId: "second" });
  runtime.claimPreUse(first);
  runtime.claimPreUse(second);
  const options = { [MODULE_ID]: { operationId: "second" } };

  const bound = runtime.bindPreSummon({ activity: first.activity, summonOptions: options });

  assert.equal(bound.operationId, "second");
  assert.equal(runtime.bindPreSummon({ activity: first.activity, summonOptions: { [MODULE_ID]: { operationId: "foreign" } } }), null);
});

test("parallel activities keep distinct claims", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ activity: activity("Activity.one"), operationId: "one" });
  const second = managedContext({ activity: activity("Activity.two"), operationId: "two" });

  runtime.claimPreUse(first);
  runtime.claimPreUse(second);

  assert.equal(runtime.bindPreSummon({ activity: first.activity, summonOptions: {} }).operationId, "one");
  assert.equal(runtime.bindPreSummon({ activity: second.activity, summonOptions: {} }).operationId, "two");
});

test("cancellation and failure clear the claim", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ operationId: "cancelled" });
  const second = managedContext({ operationId: "failed" });
  const firstClaim = runtime.claimPreUse(first);
  const secondClaim = runtime.claimPreUse(second);

  assert.equal(runtime.cancelClaim(firstClaim), true);
  assert.equal(runtime.failClaim(secondClaim), true);
  assert.equal(runtime.pendingClaimCount, 0);
  assert.equal(runtime.bindPreSummon({ activity: first.activity, summonOptions: { [MODULE_ID]: { operationId: "cancelled" } } }), null);
});

test("expired claims are removed in memory without document work", () => {
  let now = 1_000;
  const runtime = createRuntime({ now: () => now, claimTimeoutMs: 50 });
  runtime.registerProvider(summonDeclaration());
  runtime.claimPreUse(managedContext({ operationId: "expired" }));

  now += 51;

  assert.equal(runtime.pendingClaimCount, 0);
});

test("claim count remains bounded", () => {
  const runtime = createRuntime({ maxPendingClaims: 2 });
  runtime.registerProvider(summonDeclaration());
  runtime.claimPreUse(managedContext({ operationId: "first" }));
  runtime.claimPreUse(managedContext({ operationId: "second" }));
  runtime.claimPreUse(managedContext({ operationId: "third" }));

  assert.equal(runtime.pendingClaimCount, 2);
  assert.equal(runtime.bindPreSummon({ activity: activity(), summonOptions: { [MODULE_ID]: { operationId: "first" } } }), null);
  assert.equal(runtime.bindPreSummon({ activity: activity(), summonOptions: { [MODULE_ID]: { operationId: "second" } } }).operationId, "second");
});

test("builds and reads only strict serializable summon links", () => {
  const link = buildSummonLink({
    declaration: summonDeclaration(),
    operationId: "summon-link",
    activity: activity(),
    sourceToken: { uuid: "Scene.main.Token.source" },
    controllingEffect: { uuid: "Actor.source.ActiveEffect.effect" }
  });

  assert.equal(SUMMON_LINK_FLAG, "summonLink");
  assert.deepEqual(link, {
    runtime: "summon",
    recipe: "animate-objects",
    version: 1,
    operationId: "summon-link",
    sourceActorUuid: "Actor.source",
    sourceTokenUuid: "Scene.main.Token.source",
    sourceItemUuid: "Actor.source.Item.item",
    sourceActivityUuid: "Actor.source.Item.item.Activity.summon",
    controllingEffectUuid: "Actor.source.ActiveEffect.effect"
  });
  assert.deepEqual(readSummonLink({ flags: { [MODULE_ID]: { [SUMMON_LINK_FLAG]: link } } }), link);
  assert.equal(readSummonLink({ flags: { [MODULE_ID]: { [SUMMON_LINK_FLAG]: { ...link, recipe: "" } } } }), null);
  assert.throws(() => buildSummonLink({ declaration: { ...summonDeclaration(), recipe: "__proto__" }, operationId: "x" }), TypeError);
});
