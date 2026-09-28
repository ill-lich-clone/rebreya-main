# Native Instrument Spell Activities Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` while implementing this plan. Execute the RED/GREEN steps in order and do not add runtime automation.

**Goal:** Publish native dnd5e cast activities for `Бандура Фоклучан`, `Лира Кли`, and `Лютня Досс`, with one independent use per spell per dawn and no actor-specific migration.

**Architecture:** Extend the existing magic-item compendium builder only. A static definition table keyed by the normalized `magicItemId` produces deterministic dnd5e `cast` activity source data. The same generated source is included in the managed signature only for the three target items, so their compendium documents update without a global template-version bump. dnd5e owns linked/cached spell creation, spellbook display, consumption, recovery, and deletion.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5 native activity data, JavaScript ES modules, Node test runner.

**Approved design:** `docs/superpowers/specs/2026-08-16-native-instrument-spell-activities-design.md`

## Non-negotiable constraints

- Read the approved design before changing code.
- Work only on `lich_branch` and follow the complete Git preflight/finalization process from `AGENTS.md`.
- Do not add hooks, sockets, macros, Active Effects, actor scans, actor repairs, actor UUIDs, fallback spell copies, or a new service.
- Do not change hero-doll/equipment-slot behavior.
- Do not aggregate overlapping spells into a shared resource. Each instrument activity is an independent `1/dawn` resource.
- Do not bump global `MAGIC_TEMPLATE_VERSION`; only the three target signatures should change.
- Do not modify `magicItem.js` unless a source description is proven inconsistent with the approved spell matrix.
- Do not bump `module.json` or add a forwarder in this feature commit; release publication is a separate repository phase.
- Preserve UTF-8 Cyrillic.

## Native activity source contract

For each definition, emit one entry in `system.activities` keyed by a deterministic 16-character ID. The source object should contain only normal dnd5e fields:

```js
{
  _id: activityId,
  type: "cast",
  name: spell.name,
  activation: {
    type: "action",
    value: 1,
    condition: ""
  },
  consumption: {
    scaling: {
      allowed: false,
      max: ""
    },
    spellSlot: false,
    targets: [{
      type: "activityUses",
      value: "1"
    }]
  },
  uses: {
    spent: 0,
    max: "1",
    recovery: [{
      period: "dawn",
      type: "recoverAll",
      formula: ""
    }]
  },
  spell: {
    ability: "",
    challenge: {
      override: false
    },
    level: spell.level,
    properties: ["vocal", "somatic", "material"],
    spellbook: true,
    uuid: `Compendium.dnd5e.spells.Item.${spell.id}`
  }
}
```

The component property set is the native CastActivity mechanism for ignoring the linked spell's ordinary components when the item casts it. The empty ability and non-overridden challenge leave attack/save calculation to the actor's spellcasting ability. `spellSlot: false`, native linked consumption, and the cached spell's `cachedFor` relationship ensure actor spell slots are not consumed.

The activity ID seed must contain both `item.id` and the official spell Item ID, for example:

```js
stableHashId(`magic-item:${item.id}:spell:${spell.id}`, "magic-item-activity")
```

## Canonical definition matrix

Use normalized magic item IDs, not mutable display-name matching:

```js
const NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION = 1;

const NATIVE_INSTRUMENT_SPELLS = {
  "бандура-фоклучан": [
    { name: "Дубинка", id: "VzgFzcmocr1X1cp4", level: 0 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огонь фей", id: "nqBDWkVOfcGZt4YU", level: 1 },
    { name: "Опутывание", id: "gMrWeG8fMDPRFiVe", level: 1 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Разговор с животными", id: "aL1F8fvYLtNzUbKu", level: 1 }
  ],
  "лира-кли": [
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Изменение формы камня", id: "QvGcdRUSNRKEQJlK", level: 4 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Огненная стена", id: "X3DrXgxjwI2dvkD6", level: 4 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 },
    { name: "Стена ветров", id: "ew6GA8dJy2spQmFW", level: 3 }
  ],
  "лютня-досс": [
    { name: "Дружба с животными", id: "hDOENzjuj5WpLq7B", level: 1 },
    { name: "Защита от энергии (только огонь)", id: "j8NtLXOOJ3GAKF8I", level: 3 },
    { name: "Защита от яда", id: "MAxM77CDUu8dgIRQ", level: 2 },
    { name: "Защита от зла и добра", id: "xmDBqZhRVrtLP8h2", level: 1 },
    { name: "Левитация", id: "MRxldJd6C4bsBo3O", level: 2 },
    { name: "Невидимость", id: "1N8dDMMgZ1h1YJ3B", level: 2 },
    { name: "Полёт", id: "yfbK8gZqESlaoY5t", level: 3 }
  ]
};
```

Do not create a specialized copy of `Protection from Energy`. Link the official generic spell and preserve the fire-only restriction in the explicit activity name and existing item description.

### Task 1: Add the focused RED contract

**Files:**

- Modify: `tests/magic-items-compendium.test.mjs`
- Reference: `docs/superpowers/specs/2026-08-16-native-instrument-spell-activities-design.md`

**Step 1: Add one table-driven test for exact spell matrices**

Append a test named `magic instruments expose independent native cast activities`.

Build the three source records through the existing public path:

```js
const sourceItems = new Map(MAGIC_ITEMS.map((item) => [item.name, item]));
const names = ["Бандура Фоклучан", "Лира Кли", "Лютня Досс"];
const normalized = magicItemsCompendium.normalizeMagicItems(
  names.map((name) => sourceItems.get(name))
);
const byName = new Map(normalized.map((item) => [item.name, item]));
```

For each created Item, compare `Object.values(created.system.activities ?? {})` against a local expected matrix containing exact activity names, levels, and full spell UUIDs. Assert counts `8`, `7`, `7`.

**Step 2: Assert the complete native subset for every activity**

For every activity assert:

```js
assert.equal(activity.type, "cast");
assert.deepEqual(activity.activation, { type: "action", value: 1, condition: "" });
assert.equal(activity.consumption.spellSlot, false);
assert.deepEqual(activity.consumption.targets, [{ type: "activityUses", value: "1" }]);
assert.deepEqual(activity.uses, {
  spent: 0,
  max: "1",
  recovery: [{ period: "dawn", type: "recoverAll", formula: "" }]
});
assert.equal(activity.spell.ability, "");
assert.deepEqual(activity.spell.challenge, { override: false });
assert.deepEqual(activity.spell.properties, ["vocal", "somatic", "material"]);
assert.equal(activity.spell.spellbook, true);
```

Also assert that each object key equals its `_id`, all IDs are 16 characters, IDs are stable across two calls to `createMagicItemData`, and the three `Fly` activity IDs are distinct.

**Step 3: Assert fire-only labeling, targeted signature, and negative control**

- Assert the `j8NtLXOOJ3GAKF8I` activity is named `Защита от энергии (только огонь)`.
- Parse `created.flags["rebreya-main"].signature`; assert the three targets contain `nativeInstrumentSpellActivities.version === 1` and the same activity source used in `system.activities`.
- Create `Инструмент иллюзий` as a negative control. Assert it has no generated activities and its parsed signature has no `nativeInstrumentSpellActivities` property.

Do not assert private helper exports; test the existing public builder contract.

**Step 4: Run the focused test and confirm RED**

Run:

```powershell
node --test tests/magic-items-compendium.test.mjs
```

Expected: the new test fails because the three target Items do not yet have `system.activities`. Existing tests must remain green. Record the real failing assertion; do not weaken it.

### Task 2: Implement the minimal native activity builder

**Files:**

- Modify: `scripts/data/magic-items-compendium.js`
- Test: `tests/magic-items-compendium.test.mjs`

**Step 1: Add static definitions beside existing magic-item constants**

Add `NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION` and the exact matrix from this plan. Keep it module-private. Key it by normalized `item.id` (`бандура-фоклучан`, `лира-кли`, `лютня-досс`), not by `normalizeMatchText(item.name)`.

Do not put these definitions into `resolveMagicItemAutomationDefinition()`: that flag is a Rebreya automation contract, while this feature is native Item data.

**Step 2: Add the two narrowly owned helpers**

Add near `buildMagicItemEffectId()`:

```js
function resolveNativeInstrumentSpellDefinition(item) {
  return NATIVE_INSTRUMENT_SPELLS[String(item?.id ?? "").trim()] ?? null;
}

function buildNativeInstrumentSpellActivities(item) {
  const spells = resolveNativeInstrumentSpellDefinition(item);
  if (!spells) {
    return null;
  }

  return Object.fromEntries(spells.map((spell) => {
    const activityId = stableHashId(
      `magic-item:${item.id}:spell:${spell.id}`,
      "magic-item-activity"
    );
    return [activityId, {
      // Exact native source contract from this plan.
    }];
  }));
}
```

Return `null` for non-target items so callers can omit the property entirely. Do not mutate the definition table or the normalized source record.

**Step 3: Wire activities into Item system data**

In `createMagicItemData()` compute the activities once, immediately after `systemData`:

```js
const nativeInstrumentSpellActivities = buildNativeInstrumentSpellActivities(item);
if (nativeInstrumentSpellActivities) {
  systemData.activities = nativeInstrumentSpellActivities;
}
```

Do not add custom flags describing runtime usage. The existing managed signature is the only module metadata that needs the generated shape.

**Step 4: Make only target signatures change**

In `buildMagicSignature(item)`, generate the same activities and append a conditional property:

```js
const nativeInstrumentSpellActivities = buildNativeInstrumentSpellActivities(item);

return JSON.stringify({
  // existing fields unchanged
  ...(nativeInstrumentSpellActivities ? {
    nativeInstrumentSpellActivities: {
      version: NATIVE_INSTRUMENT_SPELL_ACTIVITY_VERSION,
      activities: nativeInstrumentSpellActivities
    }
  } : {})
});
```

Do not change `MAGIC_TEMPLATE_VERSION`. A non-target signature must serialize exactly as before.

**Step 5: Run focused tests and confirm GREEN**

Run:

```powershell
node --test tests/magic-items-compendium.test.mjs
```

Expected: all tests in the file pass, including exact activity counts, UUIDs, independent uses, deterministic IDs, and the negative control.

### Task 3: Update the function passport

**Files:**

- Modify: `docs/function-passport.md` around `### 15. Managed-компендиумы и каталоги`
- Reference: `scripts/data/magic-items-compendium.js`
- Test: `tests/magic-items-compendium.test.mjs`

**Step 1: Document current owner and methods**

Add one concise bullet to section 15 covering:

- `resolveNativeInstrumentSpellDefinition(item)` selects the exact static spell matrix by stable normalized magic-item ID;
- `buildNativeInstrumentSpellActivities(item)` emits deterministic native `cast` activities with official `dnd5e.spells` UUIDs, actor spellcasting, ignored components, `activityUses:1`, `1/dawn`, and no actor spell slots;
- `createMagicItemData()` attaches those activities only to the three instruments;
- `buildMagicSignature()` includes versioned activity source only for the targets;
- dnd5e, not Rebreya, owns cached spell lifecycle;
- focused owner test is `tests/magic-items-compendium.test.mjs`.

Do not turn the passport into history and do not add an API entry: the helpers remain private.

**Step 2: Re-run the focused test**

```powershell
node --test tests/magic-items-compendium.test.mjs
```

Expected: all pass. Do not rerun again on the same HEAD unless another code/test edit occurs.

### Task 4: Verify, inspect, commit, and push

**Files:**

- Verify only the three files in this implementation:
  - `scripts/data/magic-items-compendium.js`
  - `tests/magic-items-compendium.test.mjs`
  - `docs/function-passport.md`

**Step 1: Confirm scope before the full suite**

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs docs/function-passport.md
```

Stop if unrelated user changes appeared or the diff adds any hook/service/actor mutation.

**Step 2: Run the complete repository verification once**

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Report passed/failed counts and real errors, not the full successful log. If any check fails, fix only failures caused by this change and rerun the smallest affected check before the final full verification on the new HEAD.

**Step 3: Inspect the final diff and stage only task files**

```powershell
git diff --check
git diff --stat
git diff -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs docs/function-passport.md
git add -- scripts/data/magic-items-compendium.js tests/magic-items-compendium.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
```

The final diff must show no `Actor.J10Qou0x62CNVbj0`, no hooks, no custom resource, no global template-version bump, and no changes outside the three target instruments.

**Step 4: Commit and push**

```powershell
git commit -m "feat: add native instrument spell activities"
git push -u origin lich_branch
```

Then verify:

```powershell
git status --short --branch
git rev-list --left-right --count HEAD...origin/lich_branch
git log -1 --oneline
```

Expected: clean worktree, `0 0` against `origin/lich_branch`, and the feature commit at HEAD.

## Manual Foundry smoke check after implementation

This check validates dnd5e runtime behavior but must not mutate Kэссиди automatically. Use an already authenticated Foundry session when available; if login is required, ask the user and never store credentials in repository files or logs.

1. As active GM, reload the world/module so the magic-items managed sync completes.
2. On `Actor.J10Qou0x62CNVbj0`, manually remove the old three instruments and previously hand-created spell duplicates.
3. Re-add `Бандура Фоклучан`, `Лира Кли`, and `Лютня Досс` from the updated magic-items compendium.
4. Confirm cached spells appear in the spellbook with separate sources.
5. Cast `Fly` from one instrument; confirm only that instrument's activity use is spent and no spell slot is spent.
6. Confirm `Fly` remains available from each of the other two instruments.
7. Run dawn recovery and confirm all three independent uses restore.
8. Delete one instrument and confirm only its cached spells disappear.

If a runtime discrepancy appears, diagnose the exact native source shape before adding any field. Do not solve it with Rebreya runtime code.
