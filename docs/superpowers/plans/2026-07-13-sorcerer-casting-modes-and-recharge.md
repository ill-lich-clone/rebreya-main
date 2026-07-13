# Sorcerer Casting Modes and Recharge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every spell on a Rebreya Sorcerer use either Sorcery Points or native dnd5e consumption, apply metamagic in either mode, and advance cooldowns across both turn and round boundaries.

**Architecture:** Keep the behavior inside the existing `SorcererAutomationService` and its combat-hook adapter. Replace advancement-root eligibility with actor-class eligibility, add `castingMode: "sorcery" | "normal"` to the resolved cast plan, and make payment/consumption/cooldown mutations conditional on that mode. Extend the existing single `DialogV2` and route `combatRound` through the same direction-aware cooldown handler as `combatTurn`.

**Tech Stack:** Foundry VTT V13 hooks, dnd5e 5.2.5 activity usage configuration, JavaScript ES modules, Node.js `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not force-push.
- Preserve native dnd5e consumption in normal mode.
- Suppress spell-slot, direct-resource, and linked-source consumption only in Sorcery Points mode.
- Offer metamagic for every eligible spell, including cantrips and normal casts.
- Do not monkey-patch dnd5e tooltip internals.
- Keep payment and rollback actor-serialized through the existing payment lock.
- Stop if unrelated working-tree changes appear or `origin/main` no longer merges cleanly.

---

### Task 1: Actor-Based Eligibility and Independent Casting Modes

**Files:**
- Modify: `tests/sorcerer-automation-service.test.mjs`
- Modify: `scripts/combat/sorcerer-automation-service.js`

**Interfaces:**
- Consumes: existing `actorFrom`, `isSorcererClassItem`, `pointsFeature`, `spellBaseLevel`, `#prepareCastPlan`, and `#applyVirtualSlotPaymentLocked` behavior.
- Produces: `castingMode` values `"sorcery"` and `"normal"` in normalized selections, cast plans, and `usageConfig.spellCast`; actor-based spell eligibility; normal-mode metamagic payment without cooldown mutation.

- [ ] **Step 1: Replace the advancement-root regression with failing actor/source/mode tests**

Add these tests near the existing `Sorcerer casting spends points but preserves native slots` test:

```js
test("an external-source spell can use Sorcery Points on a Sorcerer actor", async () => {
  const actor = levelActor(3, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "sorcery",
    sorcererVirtualSpellLevel: 1,
    consume: { spellSlot: true, resources: [0] },
    cause: { activity: ".Item.scroll.Activity.cast", resources: [0] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 2);
  assert.equal(usageConfig.spellCast.castingMode, "sorcery");
  assert.equal(usageConfig.consume.spellSlot, false);
  assert.equal(usageConfig.consume.resources, false);
  assert.equal(usageConfig.cause.resources, false);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "chromatic-orb:1": { remaining: 1 }
  });
});

test("normal casting preserves native consumption and creates no cooldown", async () => {
  const actor = levelActor(3, { includePoints: true, pointsSpent: 17 });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "normal",
    consume: { spellSlot: true, resources: [0] },
    cause: { activity: ".Item.scroll.Activity.cast", resources: [0] }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 17);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.deepEqual(usageConfig.consume, { spellSlot: true, resources: [0] });
  assert.deepEqual(usageConfig.cause, { activity: ".Item.scroll.Activity.cast", resources: [0] });
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("normal casting spends only metamagic points", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererCastingMode: "normal",
    sorcererMetamagic: { ids: ["subtle-spell"] },
    consume: { spellSlot: true }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 1);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 1 });
  assert.equal(usageConfig.consume.spellSlot, true);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("a Sorcerer cantrip casts normally and still supports metamagic", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  const usageConfig = {
    sorcererMetamagic: { ids: ["subtle-spell"] },
    consume: { spellSlot: false }
  };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "ray-of-frost", baseLevel: 0, root: "" }), usageConfig, {}, {}
  ), true);
  assert.equal(pointsItem(actor).system.uses.spent, 1);
  assert.equal(usageConfig.spellCast.castingMode, "normal");
  assert.equal(usageConfig.spellCast.spellLevel, 0);
  assert.equal(usageConfig.consume.spellSlot, false);
});

test("a cancelled final normal cast rolls back metamagic payment", async () => {
  const actor = metamagicActor();
  const service = new SorcererAutomationService({
    chooseVirtualSpellLevel: async () => ({
      accepted: true,
      spellLevel: 1,
      castingMode: "normal"
    }),
    chooseMetamagic: async () => ({ accepted: true, ids: ["subtle-spell"] })
  });
  await service.syncSorceryPoints(actor);
  const activity = makeSorcererSpell(actor, { root: "" });
  let preflightUsageConfig;
  let finalUsageConfig;
  let calls = 0;
  activity.use = async (usageConfig) => {
    calls += 1;
    if (calls === 1) {
      preflightUsageConfig = usageConfig;
      return { updates: [] };
    }
    finalUsageConfig = usageConfig;
    return undefined;
  };

  assert.equal(service.deferDnd5ePreUseActivity(activity, {
    consume: { spellSlot: true }
  }, {}, {}), false);
  await waitForDeferredActivityUse();
  assert.equal(service.finalizeDnd5ePreUseActivity(
    activity,
    completeReactionCheck(preflightUsageConfig),
    {},
    {}
  ), false);
  await waitForDeferredActivityUse();

  assert.equal(pointsItem(actor).system.uses.spent, 0);
  assert.equal(finalUsageConfig.consume.spellSlot, true);
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), undefined);
});

test("a non-Sorcerer spell bypasses Sorcerer casting modes", async () => {
  const actor = levelActor(3, { includePoints: true });
  actor.items.contents = actor.items.contents.filter((item) => item !== actor.sorcererClassItem);
  delete actor.system.classes[SORCERER_ROOT];
  const service = new SorcererAutomationService({});
  const usageConfig = { consume: { spellSlot: true } };

  assert.equal(await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { root: "" }), usageConfig, {}, {}
  ), true);
  assert.deepEqual(usageConfig, { consume: { spellSlot: true } });
  assert.equal(pointsItem(actor).system.uses.spent, 0);
});
```

- [ ] **Step 2: Run the focused tests and verify the intended failures**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: the new external-source test fails because `advancementRoot` is absent; normal mode fails because the service does not recognize `sorcererCastingMode`; the cantrip test fails because level 0 produces no cast plan.

- [ ] **Step 3: Implement actor eligibility and casting-mode normalization**

Replace `isSorcererSpellActivity` and add casting-mode normalization beside `normalizeSelection`:

```js
function actorHasSorcererClass(actor) {
  return collectionValues(actor?.items).some(isSorcererClassItem);
}

function isSorcererSpellActivity(activity) {
  const item = activity?.item;
  if (item?.type !== "spell") {
    return false;
  }
  return actorHasSorcererClass(actorFrom(activity));
}

function normalizeCastingMode(value, baseLevel) {
  if (baseLevel <= 0) return "normal";
  return cleanText(value).toLowerCase() === "normal" ? "normal" : "sorcery";
}
```

Extend every return from `normalizeSelection` with:

```js
castingMode: normalizeCastingMode(value?.castingMode ?? value?.mode, fallbackLevel)
```

For numeric and implicit selections use:

```js
castingMode: normalizeCastingMode(undefined, fallbackLevel)
```

In `explicitSelection`, override the normalized mode from the public configuration:

```js
selection.castingMode = normalizeCastingMode(
  usageConfig?.sorcererCastingMode
    ?? dialogConfig?.sorcererCastingMode
    ?? usageConfig?.spellCast?.castingMode
    ?? selection.castingMode,
  fallbackLevel
);
```

Extend `hasExplicitSelection` with:

```js
|| Object.hasOwn(usageConfig ?? {}, "sorcererCastingMode")
|| Object.hasOwn(dialogConfig ?? {}, "sorcererCastingMode")
```

- [ ] **Step 4: Make plan validation, payment, consumption, and cooldowns mode-aware**

In `#prepareCastPlan`, allow cantrips and create a zero-cost cantrip choice:

```js
if (!actor || baseLevel < 0 || maxLevel < baseLevel) {
  return null;
}
const choices = baseLevel === 0
  ? [{ spellLevel: 0, cost: 0 }]
  : Object.entries(VIRTUAL_SLOT_COSTS)
    .map(([level, cost]) => ({ spellLevel: Number(level), cost }))
    .filter(({ spellLevel }) => spellLevel >= baseLevel && spellLevel <= maxLevel);
```

After resolving `selected`, derive and store the mode:

```js
const castingMode = normalizeCastingMode(selected.castingMode, baseLevel);
const usesSorcerySlot = castingMode === "sorcery";
const override = usesSorcerySlot
  && (selected.exhaustionOverride || explicitExhaustionOverride(usageConfig, dialogConfig));
const key = cooldownKey(activity, choice.spellLevel);
const activeCooldown = usesSorcerySlot && choice.spellLevel <= 5 && cooldownIsActive(cooldowns[key]);
const highLevelRepeat = usesSorcerySlot
  && choice.spellLevel >= 6
  && highLevelCasts[String(choice.spellLevel)] === true;
const virtualSlotCost = usesSorcerySlot ? choice.cost : 0;
const resourceCost = virtualSlotCost + metamagic.cost;
const spendResource = selected.consumeResource !== false;
const totalCost = spendResource ? resourceCost : 0;
if (totalCost > 0 && (!points || max - spent < totalCost)) {
  return null;
}
```

Add `castingMode` and `usesSorcerySlot` to the plan. Persist `castingMode` in `#persistResolvedPlan` and restore it in `#preflightPlan`.

In `#applyVirtualSlotPaymentLocked`, mutate cooldown, high-level use, exhaustion, and native consumption only when `usesSorcerySlot` is true:

```js
if (totalCost > 0) {
  await updateDocument(points, { "system.uses.spent": spent + totalCost });
  state.pointsChanged = true;
}
if (usesSorcerySlot && choice.spellLevel <= 5) {
  cooldowns[key] = { remaining: choice.spellLevel };
  await setActorFlag(actor, COOLDOWNS_FLAG, cooldowns);
  state.cooldownsChanged = true;
}
if (usesSorcerySlot && choice.spellLevel >= 6) {
  highLevelCasts[String(choice.spellLevel)] = true;
  await setActorFlag(actor, HIGH_LEVEL_CASTS_FLAG, highLevelCasts);
  state.highLevelCastsChanged = true;
}
```

Replace the unconditional native-consumption rewrite with:

```js
if (usesSorcerySlot) {
  const consume = usageConfig.consume && typeof usageConfig.consume === "object"
    ? usageConfig.consume
    : (usageConfig.consume = {});
  consume.spellSlot = false;
  consume.resources = false;
  if (usageConfig.cause && typeof usageConfig.cause === "object") {
    usageConfig.cause.resources = false;
  }
  usageConfig.spell ??= {};
  usageConfig.spell.slot = `spell${choice.spellLevel}`;
  usageConfig.scaling = Math.max(0, choice.spellLevel - baseLevel);
}
```

Add `castingMode` to `usageConfig.spellCast` and create cooldown card metadata only for Sorcery Points mode.

- [ ] **Step 5: Run the focused suite and keep existing virtual-slot tests green**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: all Sorcerer tests pass, including the existing virtual-slot, rollback, metamagic, and concurrent-payment tests.

- [ ] **Step 6: Commit the casting-mode core**

Run:

```powershell
git add -- scripts/combat/sorcerer-automation-service.js tests/sorcerer-automation-service.test.mjs
git commit -m "fix: support sorcerer casting modes"
```

---

### Task 2: One Dialog for Mode, Level, Affordability, and Metamagic

**Files:**
- Modify: `tests/sorcerer-automation-service.test.mjs`
- Modify: `scripts/combat/sorcerer-automation-service.js`

**Interfaces:**
- Consumes: Task 1 `castingMode`, `normalizeSelection`, mode-aware total cost, and existing `updateSorcererCastDialogControls`.
- Produces: a `castingMode` form field, live totals that exclude virtual-slot cost in normal mode, budget-aware confirmation, and one-time dialog sizing.

- [ ] **Step 1: Add failing dialog-mode tests**

Extend `makeCastDialogRoot` with a `castingMode` control and budget-aware application button:

```js
function makeCastDialogRoot({
  selectedLevel = 2,
  slotCost = 3,
  consume = true,
  castingMode = "sorcery",
  availablePoints = 20,
  metamagicInputs = []
} = {}) {
  const level = {
    value: String(selectedLevel),
    selectedOptions: [{
      value: String(selectedLevel),
      dataset: { sorcererCost: String(slotCost), sorcererExhaustion: "false" }
    }]
  };
  const mode = { value: castingMode };
  const consumeResource = { checked: consume };
  const total = { textContent: "" };
  const castButton = { disabled: false };
  const appWindow = {
    style: {},
    querySelector: (selector) => selector === '[data-action="cast"]' ? castButton : null
  };
  const fields = [{ dataset: { metamagicFields: "careful-spell" }, hidden: false }];
  const container = {
    dataset: { sorcererAvailablePoints: String(availablePoints) },
    matches: (selector) => selector === "[data-sorcerer-cast-dialog]",
    closest: () => appWindow,
    querySelector(selector) {
      if (selector === "[name=spellLevel]") return level;
      if (selector === "[name=castingMode]") return mode;
      if (selector === "[name=consumeResource]") return consumeResource;
      if (selector === "[data-sorcerer-total]") return total;
      if (selector === "[data-sorcerer-exhaustion-row]") return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "input[name=metamagic]") return metamagicInputs;
      if (selector === "[data-metamagic-fields]") return fields;
      return [];
    }
  };
  return { root: container, level, mode, total, castButton, appWindow, fields };
}
```

Add these assertions after the existing dialog updater tests:

```js
test("normal mode total contains metamagic cost but not virtual-slot cost", () => {
  const subtle = {
    checked: true,
    disabled: false,
    value: "subtle-spell",
    dataset: { cost: "1", minCost: "1", maxCost: "1", costMode: "fixed", stacking: "base" }
  };
  makeFakeMetamagicLabel(subtle);
  const { root, total, castButton } = makeCastDialogRoot({
    castingMode: "normal",
    slotCost: 5,
    availablePoints: 1,
    metamagicInputs: [subtle]
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(total.textContent, "1");
  assert.equal(castButton.disabled, false);
});

test("Sorcery Points mode disables confirmation when its live total exceeds the budget", () => {
  const { root, total, castButton } = makeCastDialogRoot({
    castingMode: "sorcery",
    slotCost: 5,
    availablePoints: 4
  });

  assert.equal(updateSorcererCastDialogControls(root), true);
  assert.equal(total.textContent, "5");
  assert.equal(castButton.disabled, true);
});
```

Update the existing `virtual-slot prompt combines resource, metamagic, and live total controls in one dialog` fixture so its form contains:

```js
castingMode: { value: "normal" }
```

and assert:

```js
assert.match(dialogs[0].content, /name="castingMode"/u);
assert.equal(usageConfig.spellCast.castingMode, "normal");
assert.deepEqual(usageConfig.spellCast.payment, { resource: "sorcery-points", cost: 1 });
```

- [ ] **Step 2: Run the focused suite and verify live totals fail in normal mode**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: normal mode still includes the slot cost, the prompt lacks `castingMode`, and the over-budget cast button remains enabled.

- [ ] **Step 3: Add casting mode and budget data to the combined dialog**

Inside `#chooseVirtualSpellLevel`, calculate the available resource and render the mode control:

```js
const points = pointsFeature(actor);
const availablePoints = Math.max(0,
  toInteger(points?.system?.uses?.max, 0) - toInteger(points?.system?.uses?.spent, 0)
);
const canUseSorceryMode = baseLevel > 0 && choices.some(({ cost }) => cost <= availablePoints);
const modeControl = baseLevel > 0
  ? `<label class="rebreya-sorcerer-field">Способ каста<select name="castingMode"><option value="sorcery"${canUseSorceryMode ? "" : " disabled"}>Единицы чародейства</option><option value="normal"${canUseSorceryMode ? "" : " selected"}>Обычный каст</option></select></label>`
  : `<input type="hidden" name="castingMode" value="normal">`;
```

Place `${modeControl}` before the spell-level field and add the budget dataset to the dialog root:

```js
data-sorcerer-available-points="${availablePoints}"
```

Return the form value from the dialog callback:

```js
castingMode: normalizeCastingMode(button?.form?.elements?.castingMode?.value, baseLevel)
```

- [ ] **Step 4: Make live totals, exhaustion, confirmation, and sizing mode-aware**

In `updateSorcererCastDialogControls`, read the mode and calculate slot cost conditionally:

```js
const castingMode = cleanText(container.querySelector("[name=castingMode]")?.value, selectedLevel > 0 ? "sorcery" : "normal");
const usesSorcerySlot = castingMode === "sorcery" && selectedLevel > 0;
const slotCost = spend && usesSorcerySlot
  ? toInteger(option?.dataset?.sorcererCost ?? level?.dataset?.sorcererCost, 0)
  : 0;
```

Show exhaustion only in Sorcery Points mode:

```js
const show = usesSorcerySlot && (
  option?.dataset?.sorcererExhaustion === "true"
  || level?.dataset?.sorcererExhaustion === "true"
);
```

After writing the total, update the confirmation button:

```js
const totalCost = slotCost + metamagicCost;
const availablePoints = Math.max(0, toInteger(container.dataset.sorcererAvailablePoints, 0));
const appWindow = container.closest?.(".application, .window-app");
const castButton = appWindow?.querySelector?.('[data-action="cast"]');
if (castButton) {
  castButton.disabled = spend && totalCost > availablePoints;
}
```

Remove `fitSorcererCastDialogWindow(container)` from `updateSorcererCastDialogControls` and call it once per container from `bindSorcererCastDialogControls` before the initial update. This avoids repeated width writes during input-driven layout updates.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: all Sorcerer tests pass and the dialog tests prove mode-independent metamagic totals and affordability.

- [ ] **Step 6: Commit the unified dialog**

Run:

```powershell
git add -- scripts/combat/sorcerer-automation-service.js tests/sorcerer-automation-service.test.mjs
git commit -m "fix: unify sorcerer casting choices"
```

---

### Task 3: Cooldown Progression Across Round Boundaries

**Files:**
- Modify: `tests/sorcerer-automation-service.test.mjs`
- Modify: `scripts/combat/sorcerer-automation-service.js`
- Modify: `scripts/combat/hooks.js`

**Interfaces:**
- Consumes: existing `handleCombatTurnChange(combat, updateData)` and `registerCombatHooks(moduleApi)`.
- Produces: `handleCombatTurnChange(combat, updateData, updateOptions)` that ignores negative direction and registrations for both `combatTurn` and `combatRound`.

- [ ] **Step 1: Add failing hook and rewind tests**

Add:

```js
test("combatRound advances a first-in-initiative Sorcerer cooldown", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const handlers = new Map();
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}
  );
  globalThis.Hooks = {
    on: (name, callback) => handlers.set(name, [...(handlers.get(name) ?? []), callback])
  };
  globalThis.game = { user: { id: "user", isGM: true }, messages: new Map() };

  try {
    const { registerCombatHooks } = await import("../scripts/combat/hooks.js");
    registerCombatHooks({ sorcererAutomationService: service });
    const combat = { turns: [{ actor }], combatant: { actor } };
    handlers.get("combatRound")?.[0](combat, { round: 2, turn: 0 }, { direction: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
      "fireball:3": { remaining: 2 }
    });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("rewinding combat does not decrement a Sorcerer cooldown", async () => {
  const actor = levelActor(5, { includePoints: true });
  const service = new SorcererAutomationService({});
  await service.syncSorceryPoints(actor);
  await service.applyDnd5ePreUseActivity(
    makeSorcererSpell(actor, { id: "fireball", baseLevel: 3 }), {}, {}, {}
  );

  await service.handleCombatTurnChange(
    { turns: [{ actor }], combatant: { actor } },
    { round: 1, turn: 0 },
    { direction: -1 }
  );
  assert.deepEqual(actor.getFlag(MODULE_ID, "sorcererAutomation.virtualSlotCooldowns"), {
    "fireball:3": { remaining: 3 }
  });
});
```

- [ ] **Step 2: Run the focused suite and verify the missing round hook and rewind guard**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: no `combatRound` callback exists and negative direction decrements the cooldown.

- [ ] **Step 3: Make the cooldown handler direction-aware**

Change the signature and add the guard:

```js
async handleCombatTurnChange(combat, updateData = {}, updateOptions = {}) {
  if (toInteger(updateOptions?.direction, 1) < 0) {
    return true;
  }
  const actor = this.#resolveCombatTurnActor(combat, updateData);
```

- [ ] **Step 4: Register the same Sorcerer callback for round transitions**

In `registerCombatHooks`, extract the Sorcerer call and register it for `combatRound`:

```js
const advanceSorcererCooldowns = (combat, updateData, updateOptions) => {
  moduleApi.sorcererAutomationService.handleCombatTurnChange(
    combat,
    updateData,
    updateOptions
  ).catch((error) => {
    console.error(`${MODULE_ID} | Failed to update Sorcerer virtual-slot cooldowns.`, error);
  });
};
```

Use it inside the existing `combatTurn` handler:

```js
if (hasSorcererService) {
  advanceSorcererCooldowns(combat, updateData, updateOptions);
}
```

and register:

```js
if (hasSorcererService) {
  Hooks.on("combatRound", advanceSorcererCooldowns);
}
```

- [ ] **Step 5: Run the focused suite**

Run:

```powershell
node --test tests\sorcerer-automation-service.test.mjs
```

Expected: all Sorcerer tests pass, including within-round, round-boundary, unrelated-actor, reaction, rewind, and chat-card cooldown tests.

- [ ] **Step 6: Commit the cooldown hook fix**

Run:

```powershell
git add -- scripts/combat/hooks.js scripts/combat/sorcerer-automation-service.js tests/sorcerer-automation-service.test.mjs
git commit -m "fix: advance sorcerer cooldowns each round"
```

---

### Task 4: Full Verification, Diff Review, and Publication

**Files:**
- Include: `docs/superpowers/plans/2026-07-13-sorcerer-casting-modes-and-recharge.md`
- Review: every file changed since `ca4b87b`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: a verified `lich_branch` pushed normally to `origin` with no unrelated changes.

- [ ] **Step 1: Run every Node test**

Run:

```powershell
node --test tests\*.test.mjs
```

Expected: every discovered test passes with no non-passing result categories.

- [ ] **Step 2: Run repository static checks available without `package.json`**

Run:

```powershell
node --check scripts\combat\sorcerer-automation-service.js
node --check scripts\combat\hooks.js
node --test tests\module-manifest.test.mjs tests\security.test.mjs
git diff --check origin/lich_branch...HEAD
```

Expected: every command exits 0 and `git diff --check` prints nothing.

- [ ] **Step 3: Inspect final scope and history**

Run:

```powershell
git status --short --branch
git diff --stat origin/lich_branch...HEAD
git diff origin/lich_branch...HEAD -- scripts/combat/sorcerer-automation-service.js scripts/combat/hooks.js tests/sorcerer-automation-service.test.mjs
git log --oneline origin/lich_branch..HEAD
```

Expected: only the approved design, implementation plan, Sorcerer service, combat hooks, and Sorcerer tests differ; history contains meaningful non-merge commits.

- [ ] **Step 4: Commit the implementation plan if it is still uncommitted**

Run:

```powershell
git add -- docs/superpowers/plans/2026-07-13-sorcerer-casting-modes-and-recharge.md
git commit -m "docs: add sorcerer casting implementation plan"
```

Expected: the plan is tracked and the working tree is clean.

- [ ] **Step 5: Re-fetch and ensure publication is non-destructive**

Run:

```powershell
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/main
git rev-list --left-right --count HEAD...origin/lich_branch
git status --short --branch
```

Expected: `HEAD` is not behind `origin/main`; any new `origin/lich_branch` commits are reviewed before pushing; the working tree is clean.

- [ ] **Step 6: Push without force**

Run:

```powershell
git push origin lich_branch
```

Expected: `origin/lich_branch` advances to the verified local HEAD.
