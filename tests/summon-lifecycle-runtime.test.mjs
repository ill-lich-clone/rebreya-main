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
  const {
    registry = new SpellAutomationRegistry(),
    operationIdFactory = () => `summon-operation-${++nextOperation}`,
    now = () => 1_000,
    ...runtimeOptions
  } = options;
  return new SummonLifecycleRuntime({
    registry,
    operationIdFactory,
    now,
    ...runtimeOptions
  });
}

function bindManagedClaim(runtime, context) {
  const claim = runtime.claimPreUse(context);
  const summonOptions = context.usageConfig.summons[MODULE_ID];
  runtime.bindPreSummon({ activity: context.activity, summonOptions });
  return { claim, summonOptions };
}

function createScene(uuid = "Scene.main") {
  const tokens = new Map();
  const deletes = [];
  return {
    uuid,
    tokens,
    deletes,
    async deleteEmbeddedDocuments(type, ids) {
      assert.equal(type, "Token");
      deletes.push([...ids]);
      for (const id of ids) tokens.delete(id);
    }
  };
}

function createToken(scene, id, link = null) {
  const token = {
    id,
    uuid: `${scene.uuid}.Token.${id}`,
    parent: scene,
    scene,
    flags: link ? { [MODULE_ID]: { [SUMMON_LINK_FLAG]: structuredClone(link) } } : {},
    updates: [],
    async update(patch) {
      this.updates.push(structuredClone(patch));
      this.flags = patch.flags ?? this.flags;
      return this;
    }
  };
  scene.tokens.set(id, token);
  return token;
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

test("stamps a complete common link while allowing only provider token patches", () => {
  const runtime = createRuntime();
  runtime.registerProvider({
    ...summonDeclaration(),
    prepareToken() {
      return {
        name: "Animated chair",
        texture: { src: "chair.webp" },
        flags: { [MODULE_ID]: { provider: { size: "small" } } }
      };
    }
  });
  const context = managedContext({ operationId: "stamp" });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const tokenData = { _id: "forbidden", actorId: "forbidden", flags: { other: { retained: true } } };

  runtime.prepareSummonToken({ activity: context.activity, summonOptions, tokenData });

  assert.deepEqual(tokenData.flags[MODULE_ID][SUMMON_LINK_FLAG], buildSummonLink({
    declaration: context.declaration, operationId: "stamp", activity: context.activity, sourceToken: context.token
  }));
  assert.equal(tokenData.name, "Animated chair");
  assert.equal(tokenData.texture.src, "chair.webp");
  assert.deepEqual(tokenData.flags[MODULE_ID].provider, { size: "small" });
  assert.equal(tokenData._id, "forbidden");
  assert.equal(tokenData.actorId, "forbidden");
  assert.deepEqual(tokenData.flags.other, { retained: true });
});

test("rejects provider attempts to replace the common link or escape the patch allowlist", () => {
  const runtime = createRuntime();
  runtime.registerProvider({
    ...summonDeclaration(),
    prepareToken() {
      return { _id: "replacement", flags: { foreign: { escaped: true } } };
    }
  });
  const context = managedContext({ operationId: "bad-patch" });
  const { summonOptions } = bindManagedClaim(runtime, context);

  assert.throws(() => runtime.prepareSummonToken({ activity: context.activity, summonOptions, tokenData: {} }), TypeError);
});

test("uses exact options bindings to stamp two operations independently", () => {
  const runtime = createRuntime();
  runtime.registerProvider(summonDeclaration());
  const first = managedContext({ operationId: "one" });
  const second = managedContext({ activity: activity("Actor.source.Item.item.Activity.second"), operationId: "two" });
  const firstBinding = bindManagedClaim(runtime, first);
  const secondBinding = bindManagedClaim(runtime, second);
  const firstData = {};
  const secondData = {};

  runtime.prepareSummonToken({ activity: first.activity, summonOptions: firstBinding.summonOptions, tokenData: firstData });
  runtime.prepareSummonToken({ activity: second.activity, summonOptions: secondBinding.summonOptions, tokenData: secondData });
  assert.equal(runtime.prepareSummonToken({ activity: first.activity, summonOptions: secondBinding.summonOptions, tokenData: {} }), null);

  assert.equal(firstData.flags[MODULE_ID][SUMMON_LINK_FLAG].operationId, "one");
  assert.equal(secondData.flags[MODULE_ID][SUMMON_LINK_FLAG].operationId, "two");
});

test("finalizes matching operation tokens sequentially, freezes the list, and clears success", async () => {
  const events = [];
  const runtime = createRuntime({
    addDependent: async (_effect, token) => events.push(`link:${token.id}`)
  });
  runtime.registerProvider({
    ...summonDeclaration(),
    async finalizeToken(context) {
      assert.ok(Object.isFrozen(context.tokens));
      events.push(`token:${context.token.id}`);
    },
    async finalizeSummon(context) {
      events.push(`summon:${context.tokens.map((token) => token.id).join(",")}`);
    }
  });
  const context = managedContext({ operationId: "finalize", controllingEffect: { uuid: "Actor.source.ActiveEffect.concentration" } });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const scene = createScene();
  const link = buildSummonLink({ declaration: context.declaration, operationId: "finalize", activity: context.activity, sourceToken: context.token, controllingEffect: context.controllingEffect });
  const first = createToken(scene, "one", link);
  const second = createToken(scene, "two", link);
  createToken(scene, "foreign", { ...link, operationId: "foreign" });

  await runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [first, second, scene.tokens.get("foreign")], controllingEffect: context.controllingEffect });

  assert.deepEqual(events, ["link:one", "token:one", "link:two", "token:two", "summon:one,two"]);
  assert.equal(runtime.pendingClaimCount, 0);
});

test("repairs a matching incomplete link before finalizing and links its controlling effect", async () => {
  const linked = [];
  const runtime = createRuntime({ addDependent: async (_effect, token) => linked.push(token.id) });
  runtime.registerProvider(summonDeclaration());
  const context = managedContext({ operationId: "repair", controllingEffect: { uuid: "Actor.source.ActiveEffect.concentration" } });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const scene = createScene();
  const complete = buildSummonLink({ declaration: context.declaration, operationId: "repair", activity: context.activity, sourceToken: context.token, controllingEffect: context.controllingEffect });
  const token = createToken(scene, "repair", { ...complete, sourceItemUuid: "" });

  await runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [token], controllingEffect: context.controllingEffect });

  assert.deepEqual(token.updates, [{ flags: { [MODULE_ID]: { [SUMMON_LINK_FLAG]: complete } } }]);
  assert.deepEqual(linked, ["repair"]);
});

test("provider failure deletes only matching operation tokens grouped by scene", async () => {
  const runtime = createRuntime();
  runtime.registerProvider({ ...summonDeclaration(), async finalizeToken() { throw new Error("finalize failed"); } });
  const context = managedContext({ operationId: "rollback" });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const sceneA = createScene("Scene.a");
  const sceneB = createScene("Scene.b");
  const link = buildSummonLink({ declaration: context.declaration, operationId: "rollback", activity: context.activity, sourceToken: context.token });
  const first = createToken(sceneA, "one", link);
  const second = createToken(sceneB, "two", link);

  await assert.rejects(runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [first, second] }), /finalize failed/u);

  assert.deepEqual(sceneA.deletes, [["one"]]);
  assert.deepEqual(sceneB.deletes, [["two"]]);
  assert.equal(runtime.pendingClaimCount, 0);
});

test("failure preserves foreign and unlinked tokens and calls cleanup once", async () => {
  const cleaned = [];
  const runtime = createRuntime();
  runtime.registerProvider({
    ...summonDeclaration(),
    async finalizeToken() { throw new Error("fail safely"); },
    async cleanup(context) { cleaned.push({ error: context.error.message, tokens: context.tokens }); }
  });
  const context = managedContext({ operationId: "safe-rollback" });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const scene = createScene();
  const link = buildSummonLink({ declaration: context.declaration, operationId: "safe-rollback", activity: context.activity, sourceToken: context.token });
  const owned = createToken(scene, "owned", link);
  const foreign = createToken(scene, "foreign", { ...link, operationId: "other" });
  const unlinked = createToken(scene, "unlinked");

  await assert.rejects(runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [owned, foreign, unlinked] }), /fail safely/u);

  assert.deepEqual(scene.deletes, [["owned"]]);
  assert.deepEqual(cleaned.map((entry) => ({ error: entry.error, tokens: entry.tokens.map((token) => token.id) })), [{ error: "fail safely", tokens: ["owned"] }]);
  assert.ok(Object.isFrozen(cleaned[0].tokens));
});

test("a repeated finalize operation is idempotent", async () => {
  let finalizeCalls = 0;
  const runtime = createRuntime();
  runtime.registerProvider({ ...summonDeclaration(), async finalizeSummon() { finalizeCalls += 1; } });
  const context = managedContext({ operationId: "repeat" });
  const { summonOptions } = bindManagedClaim(runtime, context);
  const scene = createScene();
  const link = buildSummonLink({ declaration: context.declaration, operationId: "repeat", activity: context.activity, sourceToken: context.token });
  const token = createToken(scene, "repeat", link);

  await runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [token] });
  await runtime.finalizeSummon({ activity: context.activity, summonOptions, tokens: [token] });

  assert.equal(finalizeCalls, 1);
});
