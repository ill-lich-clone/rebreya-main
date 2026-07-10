# Sorcerer and Spell Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Implement V0.11 Sorcerer virtual-slot casting and metamagic, plus a reusable Counterspell reaction workflow.

**Architecture:** SpellAutomationService owns generic cast contexts, visibility, reaction queues, Counterspell chains, and cancellation. SorcererAutomationService owns only the Sorcerer class, points, virtual slots, cooldowns, exhaustion, and metamagic. They exchange only flags.rebreya-main.spellCast on usage configurations and MIDI workflows.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, MIDI-QOL, ES modules, Node.js built-in test runner.

## Global Constraints

- Work only on lich_branch; never commit or push directly to main or master.
- Before every edit run git status --short, git branch --show-current, and git fetch origin; stop for foreign changes or a main-branch conflict.
- Use apply_patch for source, tests, and documentation.
- SpellAutomationService must not contain a Sorcerer identifier, resource rule, or metamagic rule.
- SorcererAutomationService must not create a Counterspell reaction queue.
- Preserve native dnd5e behavior for casts without a Rebreya spell-cast context.
- Use red-green TDD for every task and make one focused commit per task.
- Live Foundry checks remain read-only unless the user separately authorizes world changes.

---

### Task 1: Create the Rebreya spells compendium and Counterspell copy

**Files:**

- Create: data/rebreya-spells-v01.json
- Create: scripts/data/spells-compendium.js
- Modify: scripts/constants.js
- Modify: scripts/main.js
- Modify: scripts/data/classes-compendium.js
- Create: tests/spells-compendium.test.mjs
- Modify: tests/classes-compendium.test.mjs

**Interfaces:**

- SpellsCompendiumService.sync() creates world.rebreya-spells.
- The managed spell identifier is counterspell-rebreya.
- classData.spellChoices[].additionalSpellIds resolves into native ItemChoice configuration.pool UUIDs.

- [ ] **Step 1: Write failing data and choice tests**

~~~js
test("Rebreya Counterspell is a third-level reaction spell", () => {
  const item = buildRebreyaSpellItem(counterspellSource());
  assert.equal(item.system.identifier, "counterspell-rebreya");
  assert.equal(item.system.level, 3);
  assert.equal(item.system.activities.counterspell.activation.type, "reaction");
  assert.deepEqual(item.flags[MODULE_ID].spellAutomation, { kind: "counterspell" });
});

test("Sorcerer known-spell choice includes the Rebreya Counterspell UUID", () => {
  const choices = buildClassAdvancement(sorcerer.classData, {
    spellUuidById: new Map([["counterspell-rebreya", "Compendium.world.rebreya-spells.Item.counterspell0001"]])
  });
  assert.equal(choices.find(entry => entry.title === "Известные заклинания").configuration.pool.length, 1);
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="Rebreya Counterspell|Sorcerer known-spell choice" tests/spells-compendium.test.mjs tests/classes-compendium.test.mjs

Expected: FAIL because no Rebreya spell service or additional spell pool exists.

- [ ] **Step 3: Implement the spell pack**

Create the source JSON and a compendium service that clones dnd5e's Counterspell document at synchronization time, preserving its third-level spell activity, V/S components, 60-foot range, reaction activation, and upcast schema. Override the stable identifier, Rebreya source, ownership, and flags.rebreya-main.spellAutomation.kind = "counterspell".

Add spell-pack constants and initialize/sync the service before class synchronization. Extend class spell-choice normalization and builder context with additionalSpellIds/spellUuidById; append only resolved Rebreya UUIDs to the existing dnd5e spell ItemChoice pool. Add counterspell-rebreya to the Sorcerer known-spell choice beginning at level 5, never as an automatic grant.

- [ ] **Step 4: Run green verification**

Run: node --test tests/spells-compendium.test.mjs tests/classes-compendium.test.mjs

Expected: all tests pass and legacy spell choices preserve their existing restrictions.

- [ ] **Step 5: Commit**

Run: git add data/rebreya-spells-v01.json scripts/constants.js scripts/data/spells-compendium.js scripts/main.js scripts/data/classes-compendium.js tests/spells-compendium.test.mjs tests/classes-compendium.test.mjs; git commit -m "feat: add Rebreya counterspell spell"

### Task 2: Implement the independent generic spell service

**Files:**

- Create: scripts/combat/spell-automation-service.js
- Modify: scripts/combat/hooks.js
- Modify: scripts/main.js
- Create: tests/spell-automation-service.test.mjs

**Interfaces:**

- SpellAutomationService.applyDnd5ePreUseActivity(activity, usageConfig, dialogConfig, messageConfig)
- SpellAutomationService.applyMidiWorkflow(workflow)
- Cast context fields: id, parentId, actorUuid, activityUuid, spellUuid, spellLevel, rangeFeet, components, visible, targetUuids, cancelled, modifiers.
- Reuses combatAttackService.canUseReaction and consumeReaction for the common reaction ledger.

- [ ] **Step 1: Write failing reaction tests**

~~~js
test("Counterspell cancels a visible verbal cast in range", async () => {
  const result = await service.resolveCast(rootCast({ components: { verbal: true, somatic: false } }));
  assert.equal(result.cancelled, true);
});

test("a Counterspell on Counterspell restores the original cast", async () => {
  const result = await service.resolveCast(rootCast());
  assert.equal(result.cancelled, false);
  assert.equal(result.chain.length, 3);
});

test("a cast without V or S opens no Counterspell prompt", async () => {
  await service.resolveCast(rootCast({ components: { verbal: false, somatic: false } }));
  assert.equal(promptCalls, 0);
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="Counterspell cancels|Counterspell on Counterspell|without V or S" tests/spell-automation-service.test.mjs

Expected: FAIL because SpellAutomationService does not exist.

- [ ] **Step 3: Implement generic cast resolution**

At dnd5e.preUseActivity, create or complete a cast context from only item/activity data, token visibility, targets, and usage configuration. Discover Counterspell owners by the generic automation flag, an available reaction, visibility, 60-foot range, and visible V/S components. Prompt candidates in deterministic combat order, then actor id; a decline continues to the next candidate.

A Counterspell is a child attempt. Spend its reaction and normal spell payment before resolution. It automatically cancels a target cast at or below its selected level; otherwise roll the reactor's spellcasting ability against DC 10 + parent spell level. Compute root cancellation from the tree so a successful counterspell on a counterspell restores its parent. Return false only for a cancelled root cast. This file must not import or name the Sorcerer service.

- [ ] **Step 4: Run green tests**

Run: node --test tests/spell-automation-service.test.mjs

Expected: automatic success, failed check, no visibility, no reaction, no V/S, payment, and a three-node chain pass.

- [ ] **Step 5: Commit**

Run: git add scripts/combat/spell-automation-service.js scripts/combat/hooks.js scripts/main.js tests/spell-automation-service.test.mjs; git commit -m "feat: automate counterspell reactions"

### Task 3: Add Sorcery Points and virtual-slot casting

**Files:**

- Create: scripts/combat/sorcerer-automation-service.js
- Modify: data/sorcerer-rework-v011.json
- Modify: scripts/data/classes-compendium.js
- Modify: scripts/combat/hooks.js
- Modify: scripts/main.js
- Create: tests/sorcerer-automation-service.test.mjs
- Modify: tests/classes-compendium.test.mjs

**Interfaces:**

- SorcererAutomationService.handleCreatedItem, handleUpdatedItem, handleRestCompleted, applyDnd5ePreUseActivity.
- Owned resource feature identifier: sorcerer-sorcery-points.
- Writes spellCast.spellLevel, spellCast.components, spellCast.payment, and spellCast.modifiers only.

- [ ] **Step 1: Write failing resource tests**

~~~js
test("Sorcery Points synchronize to the level-three scale and recover on long rest", async () => {
  await service.syncSorceryPoints(actorAtLevel(3));
  assert.equal(points.system.uses.max, 17);
  await service.handleRestCompleted(actor, { longRest: true });
  assert.equal(points.system.uses.spent, 0);
});

test("Sorcerer casting spends points but preserves native slots", async () => {
  await service.applyDnd5ePreUseActivity(levelOneSorcererSpell, usageConfig, {}, {});
  assert.equal(points.system.uses.spent, 2);
  assert.equal(usageConfig.consumeSpellSlot, false);
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="Sorcery Points synchronize|spends points but preserves" tests/sorcerer-automation-service.test.mjs

Expected: FAIL because the resource and service are absent.

- [ ] **Step 3: Implement resource and payment mechanics**

Grant one native uses resource at class level 1 and synchronize its maximum from system.scale.sorcerer-rework-v011.sorcery-points. Its long-rest recovery restores all uses. Identify only spell items whose advancement root is sorcerer-rework-v011; a multiclass spell on the same actor keeps native casting.

For every legal virtual level from spell base level through maximum-spell-level, show exact costs 1:2, 2:3, 3:5, 4:6, 5:7, 6:9, 7:10, 8:11, 9:13. Confirmation increments item uses.spent, records the chosen virtual level, and disables native slot consumption. Cancellation, invalid level, and insufficient points modify nothing.

Record a level 1–5 cooldown keyed by spell identifier and virtual level for that many rounds. Permit an explicit override that adds one exhaustion level. Record one safe level 6–9 cast per level until a long rest; a second use requires the same exhaustion override. Clear both records on long rest.

- [ ] **Step 4: Run green tests**

Run: node --test tests/sorcerer-automation-service.test.mjs tests/classes-compendium.test.mjs

Expected: all costs, rejected casts, cooldowns, exhaustion overrides, high-level records, multiclass roots, and rest reset cases pass.

- [ ] **Step 5: Commit**

Run: git add data/sorcerer-rework-v011.json scripts/data/classes-compendium.js scripts/combat/sorcerer-automation-service.js scripts/combat/hooks.js scripts/main.js tests/sorcerer-automation-service.test.mjs tests/classes-compendium.test.mjs; git commit -m "feat: automate sorcerer spell points"

### Task 4: Add metamagic choices, compact UI, and base nine handlers

**Files:**

- Modify: data/sorcerer-rework-v011.json
- Modify: scripts/data/classes-compendium.js
- Modify: scripts/combat/sorcerer-automation-service.js
- Modify: styles/main.css
- Modify: tests/classes-compendium.test.mjs
- Modify: tests/sorcerer-automation-service.test.mjs

**Interfaces:**

- Owned option flags: sourceType = "sorcererMetamagic", metamagicId, cost, stacking.
- Native ItemChoice grants three choices at level 3, one at level 10, and one at level 17.
- The dialog uses .rebreya-sorcerer-choice-row for non-wrapping horizontal controls.

- [ ] **Step 1: Write failing choice and effect tests**

~~~js
test("Sorcerer gains three native metamagic choices at level three", () => {
  const choices = buildClassAdvancement(sorcerer.classData, context).filter(entry => entry.title === "Метамагия");
  assert.equal(choices[0].configuration.choices["3"].count, 3);
});

test("Subtle Spell removes V and S from the shared cast context", async () => {
  await service.applyDnd5ePreUseActivity(spell, configFor("subtle-spell"), {}, {});
  assert.deepEqual(config.flags[MODULE_ID].spellCast.components, { verbal: false, somatic: false, material: true });
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="three native metamagic|Subtle Spell removes" tests/classes-compendium.test.mjs tests/sorcerer-automation-service.test.mjs

Expected: FAIL because selectable metamagic items and cast modifiers are absent.

- [ ] **Step 3: Implement base options**

Create selectable items for Careful, Distant, Heightened, Subtle, Extended, Twinned, Empowered, Quickened, and Seeking Spell. Permit one option per cast except Empowered or Seeking may stack with one other valid option. Enforce each source cost and precondition before payment.

Implement automatic selected saves, range/touch changes, first-save disadvantage, V/S removal, duration doubling with a 24-hour cap, exactly one valid second target, selected damage-die rerolls, current-use bonus action, and missed spell-attack reroll.

Render virtual-level amounts, variable spends, toggles, and multi-target checkboxes in a single horizontal flex row with no wrap and horizontal overflow. A selected amount updates total point cost before confirmation.

- [ ] **Step 4: Run green tests**

Run: node --test --test-name-pattern="metamagic|Careful|Distant|Heightened|Subtle|Extended|Twinned|Empowered|Quickened|Seeking" tests/classes-compendium.test.mjs tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs

Expected: each base option modifies a workflow, target, save, duration, or roll; no option is chat-only.

- [ ] **Step 5: Commit**

Run: git add data/sorcerer-rework-v011.json scripts/data/classes-compendium.js scripts/combat/sorcerer-automation-service.js styles/main.css tests/classes-compendium.test.mjs tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs; git commit -m "feat: automate sorcerer metamagic"

### Task 5: Implement advanced, epic, and origin metamagic

**Files:**

- Modify: data/sorcerer-rework-v011.json
- Modify: scripts/combat/spell-automation-service.js
- Modify: scripts/combat/sorcerer-automation-service.js
- Modify: tests/sorcerer-automation-service.test.mjs
- Modify: tests/spell-automation-service.test.mjs

**Interfaces:**

- SpellAutomationService accepts generic reaction descriptors with id, eligible, and resolve; it still owns queueing.
- SorcererAutomationService contributes descriptors through neutral cast-context data and never owns reaction ordering.
- Epic option uses are stored on their owned option item and recover on long rest.

- [ ] **Step 1: Write failing advanced tests**

~~~js
test("Spell Shatter uses the generic queue and restores two points on a failed enemy check", async () => {
  const result = await spellService.resolveCast(enemyCast);
  assert.equal(result.cancelled, true);
  assert.equal(sorceryPoints.system.uses.spent, startingSpent - 2);
});

test("Dragon Protection has zero cost and grants resistance until the next turn", async () => {
  await sorcererService.applyDnd5ePreUseActivity(fireSpell, configFor("dragon-protection"), {}, {});
  assert.equal(sorceryPoints.system.uses.spent, startingSpent);
  assert.equal(actor.effects.some(effect => effect.name === "Драконья защита"), true);
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="Spell Shatter|Dragon Protection" tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs

Expected: FAIL because neither advanced handler nor generic descriptor exists.

- [ ] **Step 3: Implement all remaining V0.11 entries before exposing them**

Implement Mana Storm and Spell Shatter; Adaptive Spell, Spell Creation, and Echo Spell; Ancestral Spell, Dragon Protection, Dragon Curse, and Dragon Wing; Chaotic and Swift Spell; Nonlethal Spell, Divine Healing, Divine Justice, and Divine Radiance; Shadow Spell and Shadow Swiftness; Storm Vortex; Flexible Magic and Infection; and Lunar Sorcery's phase cost reduction.

Use source costs; Dragon Protection is zero cost because no price is stated. Variable spends use the one-line amount buttons and enforce their maximum. Apply the stated lasting effects, temporary hit points, resistance, movement, poison triggers, damage/save overrides, reactions, and long-rest limits. Register Spell Shatter as a generic reaction descriptor, leaving queue ownership in SpellAutomationService.

- [ ] **Step 4: Run green extended tests**

Run: node --test --test-name-pattern="Mana Storm|Spell Shatter|Adaptive|Spell Creation|Echo|Dragon|Chaotic|Divine|Shadow|Storm Vortex|Flexible|Infection|Lunar" tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs

Expected: all selectable remaining options change rules; any unimplemented option is absent from its selection pool.

- [ ] **Step 5: Commit**

Run: git add data/sorcerer-rework-v011.json scripts/combat/spell-automation-service.js scripts/combat/sorcerer-automation-service.js tests/sorcerer-automation-service.test.mjs tests/spell-automation-service.test.mjs; git commit -m "feat: add extended sorcerer metamagic"

### Task 6: Complete service wiring, verify, and publish

**Files:**

- Modify: scripts/main.js
- Modify: scripts/combat/hooks.js
- Modify: tests/spell-automation-service.test.mjs
- Modify: tests/sorcerer-automation-service.test.mjs
- Verify: docs/superpowers/specs/2026-07-11-sorcerer-spell-automation-design.md

**Interfaces:**

- RebreyaMainModule exposes spellAutomationService and sorcererAutomationService.
- Pre-use hook order: Sorcerer enrichment, generic spell resolution, existing combat pre-use behavior.

- [ ] **Step 1: Write failing isolation and order tests**

~~~js
test("combat hooks run Sorcerer enrichment before generic spell resolution", async () => {
  await invokePreUseHooks(activity, usageConfig);
  assert.deepEqual(callOrder, ["sorcerer", "spell", "attack"]);
});

test("generic spell automation has no Sorcerer class dependency", () => {
  const source = readFileSync(new URL("../scripts/combat/spell-automation-service.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /sorcerer-rework-v011|SorcererAutomationService/u);
});
~~~

- [ ] **Step 2: Run red tests**

Run: node --test --test-name-pattern="Sorcerer enrichment|no Sorcerer class dependency" tests/spell-automation-service.test.mjs

Expected: FAIL until explicit hook order and both service initializations exist.

- [ ] **Step 3: Wire initialization and safe errors**

Instantiate both services in RebreyaMainModule, call initialize() with isolated errors, and register create/update/rest/pre-use/MIDI hooks in registerCombatHooks. Preserve all existing hooks. A service exception must notify/log and return true so it cannot break unrelated native casts.

- [ ] **Step 4: Run full verification**

Run: node --test tests/*.test.mjs; git diff --check origin/main...HEAD

Expected: all suites pass and git diff --check prints nothing.

- [ ] **Step 5: Perform non-destructive Foundry verification and publish**

Inspect the Rebreya spells pack, Counterspell item, and Sorcery Point UI in the CODEX profile without creating or changing world documents. Then run: git add scripts/main.js scripts/combat/hooks.js tests/spell-automation-service.test.mjs tests/sorcerer-automation-service.test.mjs; git commit -m "feat: wire sorcerer spell automation"; git push origin lich_branch

Expected: git status --short --branch reports lich_branch...origin/lich_branch with no local changes or divergence.
