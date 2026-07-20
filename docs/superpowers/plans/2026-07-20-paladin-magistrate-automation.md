# Paladin Magistrate Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the playable mechanics of `paladin-oath-magistrate` while keeping the subclass inline in `data/paladin-rework-v01.json`.

**Architecture:** Class data owns stable feature metadata and generated dnd5e activities/effects. `PaladinAutomationService` owns runtime saves, smite outcomes, legal statuses, and Magistrate feature flow. Shared systems remain shared: reactions go through `ReactionQueueService`, reaction availability through `CombatAttackService`, and d20 roll modifiers through the existing dnd5e d20 hooks.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, MIDI-QOL hooks, Active Effects, Active Auras, ES modules, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Before every edit cycle run `git status --short --branch`, `git branch --show-current`, and `git fetch origin`.
- Stop for foreign uncommitted changes or if `origin/main` is ahead and conflicts with the task.
- Keep `paladin-oath-magistrate` inline in `data/paladin-rework-v01.json`; do not add `subclassDataPaths`.
- Use stable IDs and `flags.rebreya-main.paladinAutomation`; Russian names are fallback only.
- New runtime behavior uses red-green TDD.
- Cross-owner document updates route through the active GM.
- Reactions use `ReactionQueueService`, never direct ad-hoc reaction dialogs.
- Full implementation must satisfy `docs/superpowers/specs/2026-07-20-paladin-magistrate-automation-design.md`.

---

## File Map

- `data/paladin-rework-v01.json`: source metadata for Magistrate feature automation.
- `scripts/data/classes-compendium.js`: generated activities, effects, uses, and copied automation flags.
- `scripts/combat/paladin-automation-service.js`: Magistrate runtime owner.
- `scripts/combat/attack-service.js`: reaction suppression integration.
- `scripts/combat/hooks.js`: Paladin hook registration for d20 rolls, combat turn cleanup, and damage/reaction hooks.
- `scripts/main.js`: service composition only if public methods are added.
- `tests/classes-compendium.test.mjs`: data and generated document coverage.
- `tests/paladin-automation-service.test.mjs`: Paladin runtime coverage.
- `tests/combat-attack-service.test.mjs`: reaction suppression coverage.
- `tests/reaction-queue-service.test.mjs`: only touched if shared reaction semantics change.
- `README.md`: automation catalog update after runtime behavior ships.

---

### Task 1: Restore Inline Magistrate Data And Add Metadata

**Files:**
- Modify: `data/paladin-rework-v01.json`
- Modify: `scripts/data/classes-compendium.js`
- Modify: `tests/classes-compendium.test.mjs`

**Interfaces:**
- Consumes: existing `feature.featureId`, `feature.sourceType`, and generated feature flags.
- Produces: generated items/activities with `flags.rebreya-main.paladinAutomation`.

- [ ] **Step 1: Write the failing tests**

Add this test to `tests/classes-compendium.test.mjs`:

```js
test("paladin magistrate oath stays inline in the paladin data file", () => {
  const paladinSource = loadJson("data/paladin-rework-v01.json");
  const magistrate = paladinSource.subclasses.find((subclass) => subclass.identifier === "paladin-oath-magistrate");

  assert.equal(paladinSource.subclassDataPaths, undefined);
  assert.equal(magistrate?.identifier, "paladin-oath-magistrate");
  assert.equal(magistrate.features.some((feature) => feature.id === "magistrate-high-magistrate"), true);
});

test("paladin magistrate features expose automation metadata", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const definitions = buildFeatureDefinitions(paladin);
  const accusation = definitions.find((definition) => definition.featureId.endsWith("magistrate-accusation-smite"));
  const detention = definitions.find((definition) => definition.featureId.endsWith("magistrate-detention-smite"));
  const jurisdiction = definitions.find((definition) => definition.featureId.endsWith("magistrate-sovereign-jurisdiction"));

  assert.deepEqual(accusation.paladinAutomation, {
    kind: "magistrateSmite",
    variant: "accusation",
    saveAbility: "cha",
    duration: "sourceNextTurn"
  });
  assert.deepEqual(detention.paladinAutomation, {
    kind: "magistrateSmite",
    variant: "detention",
    saveAbility: "wis",
    duration: "sourceNextTurn"
  });
  assert.equal(jurisdiction.paladinAutomation.kind, "magistrateJurisdiction");
});
```

- [ ] **Step 2: Run red tests**

Run:

```powershell
node --test --test-name-pattern="paladin magistrate oath stays inline|paladin magistrate features expose" tests\classes-compendium.test.mjs
```

Expected: the inline test passes after the revert, and the metadata test fails because `paladinAutomation` is not copied yet.

- [ ] **Step 3: Implement data and builder copying**

In `data/paladin-rework-v01.json`, keep the Magistrate subclass inline and add automation metadata to the listed feature entries:

```json
"automation": {
  "kind": "magistrateSmite",
  "variant": "accusation",
  "saveAbility": "cha",
  "duration": "sourceNextTurn"
}
```

In `scripts/data/classes-compendium.js`, copy `feature.automation` into the feature definition:

```js
paladinAutomation: feature.automation && typeof feature.automation === "object"
  ? foundry.utils.deepClone(feature.automation)
  : null
```

When creating item data, write non-null metadata to:

```js
flags: {
  [MODULE_ID]: {
    paladinAutomation: definition.paladinAutomation
  }
}
```

- [ ] **Step 4: Run green tests**

Run:

```powershell
node --test tests\classes-compendium.test.mjs
```

Expected: all class compendium tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add data/paladin-rework-v01.json scripts/data/classes-compendium.js tests/classes-compendium.test.mjs
git commit -m "feat: mark magistrate paladin automation data"
```

### Task 2: Automate Magistrate Smite Saves And Effects

**Files:**
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/paladin-automation-service.test.mjs`

**Interfaces:**
- Consumes: selected Divine Smite variants from `#validatedSmiteVariantIds`.
- Produces: temporary Active Effects flagged as `paladinAutomation.kind = "magistrateEffect"`.

- [ ] **Step 1: Write failing smite tests**

Add tests:

```js
test("Magistrate accusation smite strips target advantage after a failed Charisma save", async () => {
  const paladin = magistratePaladinWithSmiteVariant("magistrate-accusation-smite");
  const target = new TestActor({ id: "target" });
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({ slotLevel: 1, variantIds: ["magistrate-accusation-smite"] }),
    rollPaladinSave: async () => ({ success: false, total: 7, dc: 15 })
  });

  await service.applyMidiPreDamageRoll(makeWeaponWorkflow({ actor: paladin, target }), null, makeDamageConfig());

  assert.equal(target.effects.contents.some((effect) => effect.flags["rebreya-main"].paladinAutomation.effect === "accusationNoAdvantage"), true);
});

test("Magistrate detention smite slows on success and suppresses reactions on failure", async () => {
  const paladin = magistratePaladinWithSmiteVariant("magistrate-detention-smite");
  const target = new TestActor({ id: "target" });
  const service = new PaladinAutomationService({}, {
    promptDivineSmite: async () => ({ slotLevel: 1, variantIds: ["magistrate-detention-smite"] }),
    rollPaladinSave: async () => ({ success: false, total: 6, dc: 15 })
  });

  await service.applyMidiPreDamageRoll(makeWeaponWorkflow({ actor: paladin, target }), null, makeDamageConfig());

  const effects = target.effects.contents.map((effect) => effect.flags["rebreya-main"].paladinAutomation.effect);
  assert.ok(effects.includes("detentionSlow"));
  assert.ok(effects.includes("detentionNoReaction"));
});
```

- [ ] **Step 2: Run red tests**

Run:

```powershell
node --test --test-name-pattern="Magistrate accusation|Magistrate detention" tests\paladin-automation-service.test.mjs
```

Expected: FAIL because selected Magistrate variants only change the damage label.

- [ ] **Step 3: Implement smite effects**

Add save and effect helpers in `PaladinAutomationService`:

```js
async #resolvePaladinSave(target, { sourceActor, ability, disadvantage = false, flavor = "" }) {
  if (typeof this._options.rollPaladinSave === "function") {
    return this._options.rollPaladinSave(target, { sourceActor, ability, disadvantage, flavor });
  }
  const dc = this.#paladinSaveDc(sourceActor);
  const result = await target.rollAbilitySave?.(ability, { dc, disadvantage, flavor });
  return { success: Number(result?.total ?? 0) >= dc, total: Number(result?.total ?? 0), dc };
}
```

After spell-slot spending succeeds, call `#applyMagistrateSmiteVariant` for each selected Magistrate variant. Apply the flagged effects with `createEmbeddedDocuments("ActiveEffect", [effectData])` when local, otherwise route to active GM.

- [ ] **Step 4: Register d20 advantage stripping**

Add Paladin handling to `dnd5e.preRollD20Test` in `scripts/combat/hooks.js`:

```js
moduleApi.paladinAutomationService.applyDnd5ePreRollD20Test(rollConfig, dialogConfig, messageConfig);
```

`applyDnd5ePreRollD20Test` strips requested advantage when the actor has `accusationNoAdvantage`.

- [ ] **Step 5: Run green tests**

Run:

```powershell
node --test tests\paladin-automation-service.test.mjs
```

Expected: smite damage tests still pass, and new Magistrate save/effect tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/combat/paladin-automation-service.js scripts/combat/hooks.js tests/paladin-automation-service.test.mjs
git commit -m "feat: automate magistrate smite variants"
```

### Task 3: Integrate Reaction Suppression And Status Cleanup

**Files:**
- Modify: `scripts/combat/attack-service.js`
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/combat-attack-service.test.mjs`
- Modify: `tests/paladin-automation-service.test.mjs`

**Interfaces:**
- Consumes: Active Effects with `paladinAutomation.effect = "detentionNoReaction"`.
- Produces: `canUseReaction(...).reason = "reactionSuppressed"` when blocked.

- [ ] **Step 1: Write failing reaction suppression test**

Add to `tests/combat-attack-service.test.mjs`:

```js
test("combat reaction ledger rejects actors suppressed by Magistrate detention", () => {
  const actor = actorWithReactionState({
    effects: [{
      disabled: false,
      flags: {
        "rebreya-main": {
          paladinAutomation: {
            kind: "magistrateEffect",
            effect: "detentionNoReaction"
          }
        }
      }
    }]
  });
  const result = service.canUseReaction(actor, 1);

  assert.equal(result.canUse, false);
  assert.equal(result.reason, "reactionSuppressed");
});
```

- [ ] **Step 2: Run red test**

Run:

```powershell
node --test --test-name-pattern="Magistrate detention" tests\combat-attack-service.test.mjs
```

Expected: FAIL because `canUseReaction` only checks the reaction ledger.

- [ ] **Step 3: Implement suppression check**

In `CombatAttackService.canUseReaction`, before returning success, inspect actor
effects:

```js
if (actorHasReactionSuppression(state.actor)) {
  return { actorId: state.actorId, canUse: false, requiredUses: safeRequiredUses, reason: "reactionSuppressed", state };
}
```

Use a local helper that checks enabled effects for
`flags.rebreya-main.paladinAutomation.effect === "detentionNoReaction"` or
`"lawNoReaction"`.

- [ ] **Step 4: Add cleanup tests**

Add Paladin tests for `sourceNextTurn` cleanup:

```js
test("Magistrate source-next-turn effects expire at the start of the Paladin turn", async () => {
  await service.handleCombatTurnChange(combat, { current: { actor: paladin } });
  assert.equal(target.deletedEffects.includes("detentionNoReaction"), true);
});
```

- [ ] **Step 5: Run green tests**

Run:

```powershell
node --test tests\combat-attack-service.test.mjs tests\paladin-automation-service.test.mjs
```

Expected: reaction suppression and cleanup pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add scripts/combat/attack-service.js scripts/combat/paladin-automation-service.js scripts/combat/hooks.js tests/combat-attack-service.test.mjs tests/paladin-automation-service.test.mjs
git commit -m "feat: suppress reactions from magistrate effects"
```

### Task 4: Add Sovereign Jurisdiction And Inevitable Sentence

**Files:**
- Modify: `scripts/data/classes-compendium.js`
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `tests/paladin-automation-service.test.mjs`

**Interfaces:**
- Produces activity automation `paladin-magistrate-jurisdiction`.
- Produces status effects `protectedByLaw`, `supervisedByLaw`, and `lawOrphan`.
- Consumes `supervisedByLaw` in Divine Smite turn-limit and save-disadvantage checks.

- [ ] **Step 1: Write failing activity tests**

Add to class tests:

```js
test("Sovereign Jurisdiction generates a bonus-action target activity", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const jurisdiction = buildFeatureDefinitions(paladin).find((definition) => definition.featureId.endsWith("magistrate-sovereign-jurisdiction"));
  const data = createFeatureEntryData(jurisdiction, new Map(), {});
  const activity = Object.values(data.system.activities).find((entry) => entry.flags["rebreya-main"].automation === "paladin-magistrate-jurisdiction");

  assert.equal(activity.activation.type, "bonus");
  assert.equal(activity.range.value, 60);
  assert.equal(activity.target.affects.count, "1");
});
```

- [ ] **Step 2: Run red tests**

Run:

```powershell
node --test --test-name-pattern="Sovereign Jurisdiction" tests\classes-compendium.test.mjs tests\paladin-automation-service.test.mjs
```

Expected: FAIL because the activity and runtime handler do not exist.

- [ ] **Step 3: Implement jurisdiction activity and runtime**

Generate a utility activity with automation `paladin-magistrate-jurisdiction`.
In `applyDnd5ePostUseActivity`, dispatch to `#useSovereignJurisdiction`.
Resolve one target, prompt for relationship if token disposition is ambiguous,
remove previous jurisdiction from the same Paladin, then apply the selected
one-minute status.

- [ ] **Step 4: Add Inevitable Sentence behavior**

Write and pass tests where a target with `supervisedByLaw` from the same Paladin:

```js
assert.equal(secondSmiteConfig.rolls.length, 1);
assert.equal(saveOptions.disadvantage, true);
```

Do not bypass the turn key for unsupervised targets or targets supervised by a
different Paladin.

- [ ] **Step 5: Run green tests**

Run:

```powershell
node --test tests\classes-compendium.test.mjs tests\paladin-automation-service.test.mjs
```

Expected: jurisdiction status and inevitable sentence tests pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add data/paladin-rework-v01.json scripts/data/classes-compendium.js scripts/combat/paladin-automation-service.js scripts/combat/hooks.js tests/classes-compendium.test.mjs tests/paladin-automation-service.test.mjs
git commit -m "feat: automate magistrate jurisdiction"
```

### Task 5: Add Civic Order, High Magistrate, Voice Of Law Shell, And Docs

**Files:**
- Modify: `scripts/data/classes-compendium.js`
- Modify: `scripts/combat/paladin-automation-service.js`
- Modify: `scripts/combat/hooks.js`
- Modify: `README.md`
- Modify: `tests/classes-compendium.test.mjs`
- Modify: `tests/paladin-automation-service.test.mjs`
- Modify: `tests/reaction-queue-service.test.mjs`

**Interfaces:**
- Produces reaction kind `paladin-magistrate-civic-order`.
- Produces activity automation `paladin-magistrate-high-magistrate`.
- Produces activity automation `paladin-magistrate-voice-of-law`.

- [ ] **Step 1: Write failing reaction tests**

Add:

```js
test("Civic Order redirects exact target damage through the reaction queue", async () => {
  const result = await service.applyMidiPreDamageRollComplete(workflowWithProtectedTargetDamage());

  assert.equal(queue.calls[0].kind, "paladin-magistrate-civic-order");
  assert.equal(target.damagePrevented, 12);
  assert.equal(paladin.damageTaken, 12);
});
```

- [ ] **Step 2: Run red tests**

Run:

```powershell
node --test --test-name-pattern="Civic Order|High Magistrate|Voice Of Law" tests\paladin-automation-service.test.mjs tests\classes-compendium.test.mjs
```

Expected: FAIL because no reaction provider, high stance, or law shell exists.

- [ ] **Step 3: Implement Civic Order reaction**

Register a reaction capability/provider during Paladin service initialization.
Eligibility checks match the design spec. On accepted reaction, consume the
ordinary reaction through the queue transaction, prevent the target damage, and
apply unreduced damage to the Paladin. If payment fails, no damage is changed.

- [ ] **Step 4: Implement High Magistrate stance**

Generate a bonus-action self activity with one long-rest use. Runtime applies a
ten-minute self effect. A secondary refresh path spends one 5th-level spell slot
to restore the use. While active, jurisdiction aura logic upgrades ally AC and
enemy frightened value as described in the design spec.

- [ ] **Step 5: Implement Voice of Law shell**

Generate a one-hour activity that prompts for the law. Store the selected law in
the self effect and post a chat card. Enforce only `noAdvantage`, `noReaction`,
and `noFlight`; mark the other choices as manual in the chat card.

- [ ] **Step 6: Update README and run full verification**

Update the Paladin automation row in `README.md` to mention Magistrate smites,
jurisdiction, civic order, and high magistrate.

Run:

```powershell
node --test tests\paladin-automation-service.test.mjs tests\classes-compendium.test.mjs tests\combat-attack-service.test.mjs tests\reaction-queue-service.test.mjs
node --test tests\*.test.mjs
git diff --check
```

Expected: all tests pass and `git diff --check` reports no errors.

- [ ] **Step 7: Commit and push**

Run:

```powershell
git add data/paladin-rework-v01.json scripts/data/classes-compendium.js scripts/combat/paladin-automation-service.js scripts/combat/hooks.js README.md tests/classes-compendium.test.mjs tests/paladin-automation-service.test.mjs tests/combat-attack-service.test.mjs tests/reaction-queue-service.test.mjs
git commit -m "feat: automate magistrate paladin oath"
git push origin lich_branch
```
