# Unified Equipment Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended when the user explicitly authorizes subagents) or `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Replace the separate equipment import scripts with one reliable Google Sheets API importer that synchronizes all equipment and magic items while preserving stable Foundry identities and rejecting ambiguous data.

**Architecture:** A single Node.js CLI owns orchestration. Small internal modules implement the Google API boundary, strict parsing, catalog adapters, validation, diffing, deterministic serialization, and transactional writes. Every sheet value enters as a string, is converted only by an explicit field parser, and is validated as one complete bundle before any tracked runtime file is replaced.

**Tech Stack:** Node.js ESM, built-in `node:test`, Google Sheets v4 REST API with service-account JWT authentication, existing Foundry VTT 13/dnd5e catalog services.

**Spec:** `docs/superpowers/specs/2026-08-22-unified-equipment-importer-design.md`

## Global constraints

- Work only on `lich_branch`; run the repository Git preflight before editing and push every completed task commit to `origin/lich_branch`.
- Use one public entrypoint: `node tools/import-equipment.mjs`. Internal modules are implementation details, not additional importer commands.
- Keep Google access read-only. Default to dry-run. Only `--apply` may mutate the tracked generated catalogs.
- Preserve current runtime filenames and consumer contracts: `data/gear.json`, `data/upgrades.json`, `data/materials.json`, `data/implants.json`, `data/rebreya-transport-v01.json`, and `magicItem.js`.
- Treat every Sheets cell as a string at the input boundary by requesting `valueRenderOption=FORMATTED_VALUE`. Never infer type from JavaScript truthiness or a generic number coercion.
- Reject unknown non-empty columns, duplicate headers, missing required columns, duplicate stable IDs, invalid references, malformed numbers, malformed fractions, and unrecognized enum tokens.
- Preserve existing stable IDs and manual Foundry enrichment through the tracked `data/equipment-import-overrides.json`. A sheet-owned gameplay field may not be silently overridden.
- Validate the entire output bundle before writing any file. Stage all files, replace them transactionally, and restore every original if any replacement fails.
- Any deletion requires `--allow-removals`. Large deletion sets additionally require `--allow-large-diff`. Identity churn is always a hard error.
- Add or update focused tests before implementation. Do not weaken an existing assertion merely to accept malformed source data.
- Update the relevant section of `docs/function-passport.md` in the same commit as every new, changed, or removed method. Update the importer section of `README.md` when the CLI contract becomes public.

## Locked file structure

```text
tools/import-equipment.mjs                         # the only CLI entrypoint
tools/equipment-import/sheet-registry.mjs         # sheet/range/header/output declarations
tools/equipment-import/validation.mjs             # structured diagnostics and bundle checks
tools/equipment-import/google-sheets-client.mjs   # service-account JWT and read-only Sheets calls
tools/equipment-import/snapshot.mjs                # raw string snapshot construction
tools/equipment-import/parsers.mjs                 # strict typed field parsers
tools/equipment-import/overrides.mjs               # stable identity/manual enrichment schema
tools/equipment-import/adapters/base-gear.mjs
tools/equipment-import/adapters/weapons.mjs
tools/equipment-import/adapters/armor.mjs
tools/equipment-import/adapters/ammunition.mjs
tools/equipment-import/adapters/explosives.mjs
tools/equipment-import/adapters/attachments.mjs
tools/equipment-import/adapters/upgrades.mjs
tools/equipment-import/adapters/materials.mjs
tools/equipment-import/adapters/implants.mjs
tools/equipment-import/adapters/transport.mjs
tools/equipment-import/adapters/magic-items.mjs
tools/equipment-import/pipeline.mjs                 # bundle composition and cross-reference validation
tools/equipment-import/diff.mjs                     # semantic diff and destructive guards
tools/equipment-import/serialization.mjs            # deterministic JSON/ESM rendering
tools/equipment-import/transactional-writer.mjs     # staged all-or-nothing apply
data/equipment-import-overrides.json                # tracked identities and manual enrichment
tests/fixtures/equipment-import/*.json              # compact raw snapshots and expected catalogs
tests/equipment-import-*.test.mjs                   # focused importer tests
```

Do not create another application service, Foundry hook, UI, socket route, or world-setting owner. The generated data remains consumed through the existing compendium services and the existing `scripts/main.js` composition root.

---

### Task 1: Establish the sheet registry and strict raw snapshot boundary

**Files:**

- Create: `tools/equipment-import/sheet-registry.mjs`
- Create: `tools/equipment-import/validation.mjs`
- Create: `tools/equipment-import/snapshot.mjs`
- Create: `tests/equipment-import-snapshot.test.mjs`
- Modify: `docs/function-passport.md` in the managed-compendium/import tooling section

**Interfaces:**

```js
export const EQUIPMENT_SPREADSHEET_ID = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk";
export const SHEET_REGISTRY = Object.freeze({
  baseGear: { sheetTitle: "Общий компендиум снаряжения V0.1", adapter: "baseGear" },
  equipmentReferences: { sheetTitle: "_СПРАВОЧНИК_СНАРЯЖЕНИЯ", adapter: "references" },
  weapons: { sheetTitle: "Оружие V0.36", adapter: "weapons" },
  weaponGroups: { sheetTitle: "Оружейные группы", adapter: "weapons" },
  firearms: { sheetTitle: "Огнестрел V0.36", adapter: "weapons" },
  attachments: { sheetTitle: "Улучшения и обвесы V0.2", adapter: "attachments" },
  ammunition: { sheetTitle: "Боеприпасы", adapter: "ammunition" },
  specialAmmunition: {
    sheetTitle: "Особые боеприпасы",
    adapter: "ammunition",
    legacyMirrors: [{ sheetTitle: "Особые боеприпа", requireEquivalent: true }],
  },
  armor: { sheetTitle: "Доспехи V0.1", adapter: "armor" },
  explosives: { sheetTitle: "Взрывчатка V0.0", adapter: "explosives" },
  implants: { sheetTitle: "Импланты V0.1", adapter: "implants" },
  upgrades: { sheetTitle: "Усовершенствования V0.21", adapter: "upgrades" },
  materials: { sheetTitle: "Энциклопедия материалов", adapter: "materials" },
  transport: { sheetTitle: "Транспорт V0.1", adapter: "transport" },
  magicItems: { sheetTitle: "Магические предметы V0", adapter: "magicItems" },
});

export class ImportDiagnosticError extends Error {
  constructor(message, diagnostics);
}

export function buildRawSheetSnapshot({ sheetKey, range, values, declaration });
export function buildRawWorkbookSnapshot({ spreadsheetId, metadata, valueRanges, registry });
export function validateHeaders({ sheetKey, headers, declaration });
export function throwIfDiagnostics(diagnostics, message);
```

Each full registry declaration must extend the locked title mapping above with the exact metadata-resolved grid range, header-row number, required headers, recognized optional headers, stable-key header, adapter name, and generated output catalog. Capture those values in the failing fixture directly from a sanitized live `FORMATTED_VALUE` response before implementation. Keep spelling aliases explicit and local to the declaration; do not introduce fuzzy header matching. `_SYS`, legacy, and calculation sheets are excluded unless a declaration names a specific verified join.

**Step 1: Write the failing tests**

Cover these behaviors:

```js
test("snapshot retains 1/4 фнт as the exact source string", () => {
  const snapshot = buildRawSheetSnapshot({
    sheetKey: "gear",
    range: "Общий компендиум снаряжения V0.1!A1:F2",
    declaration: registryForTest,
    values: [["Название", "Вес"], ["Дротик", "1/4 фнт"]],
  });

  assert.equal(snapshot.rows[0].cells.Вес, "1/4 фнт");
  assert.equal(snapshot.rows[0].rowNumber, 2);
});

test("snapshot rejects duplicate, missing, and unknown non-empty headers", () => {
  assert.throws(() => buildRawSheetSnapshot(invalidHeaderInput), ImportDiagnosticError);
});

test("snapshot rejects mixed API scalar types instead of coercing them", () => {
  assert.throws(
    () => buildRawSheetSnapshot({ ...validInput, values: [["Название", "Вес"], ["Дротик", 0.25]] }),
    /expected formatted string/,
  );
});
```

Also assert that missing trailing cells become `""`, API `null`/omitted cells follow the declared blank-cell policy, any other non-string scalar is rejected, row numbers refer to the actual spreadsheet row, and a completely blank row is omitted without shifting subsequent row numbers. The workbook snapshot must contain `spreadsheetId`, resolved sheet IDs/titles/ranges, normalized string rows, and a deterministic SHA-256 fingerprint; it must not contain a timestamp or credential data.

**Step 2: Run the test to verify RED**

Run:

```powershell
node --test tests/equipment-import-snapshot.test.mjs
```

Expected: FAIL because the new modules do not exist.

**Step 3: Implement the minimal boundary**

- Declare every approved equipment/magic-item source sheet and its exact accepted headers from the live spreadsheet. Resolve required visible and hidden sheets against metadata before requesting ranges; guessed default titles are forbidden.
- Normalize only transport-level concerns: pad absent cells with `""`, trim header edge whitespace for comparison, and retain the original cell text in each row.
- Produce diagnostics shaped as `{ code, sheetKey, range, rowNumber, column, value, message }` and sort them by registry order, row, and column before throwing.
- Reject duplicate headers, missing required headers, and non-empty cells under unknown headers. Allow a declared optional column to be blank.
- Do not parse booleans or numbers in this layer.
- Canonically hash the spreadsheet ID plus ordered resolved ranges and normalized string matrices. Equal source data must produce the same fingerprint regardless of fetch time.

**Step 4: Run the test to verify GREEN**

Run:

```powershell
node --test tests/equipment-import-snapshot.test.mjs
```

Expected: all snapshot tests pass.

**Step 5: Update the passport and checkpoint**

Document the registry as the owner of sheet layout and the snapshot as the only raw-string boundary, including signatures, diagnostics, and focused test.

```powershell
git add tools/equipment-import/sheet-registry.mjs tools/equipment-import/validation.mjs tools/equipment-import/snapshot.mjs tests/equipment-import-snapshot.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "test: define equipment import snapshot boundary"
git push -u origin lich_branch
```

---

### Task 2: Add a read-only Google Sheets API client

**Files:**

- Create: `tools/equipment-import/google-sheets-client.mjs`
- Create: `tests/equipment-import-google-client.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function loadGoogleServiceAccount({ credentialsPath, env = process.env });
export function createServiceAccountJwt({ serviceAccount, now, cryptoImpl });
export function createGoogleSheetsClient({ fetchImpl = fetch, sleep = defaultSleep, now = Date.now });

// returned client
await client.fetchSpreadsheetMetadata({ spreadsheetId, serviceAccount, maxRetries = 4 });
await client.fetchRanges({ spreadsheetId, ranges, serviceAccount, maxRetries = 4 });
```

`loadGoogleServiceAccount` must use `GOOGLE_APPLICATION_CREDENTIALS` when set, otherwise default to `tools/google-credentials.json`. The credentials file stays ignored and is never printed, copied, committed, or embedded into an artifact.

**Step 1: Write the failing tests**

Use injected `fetchImpl`, time, and sleep; never contact Google in unit tests. Assert:

- JWT assertion uses RS256, the service-account email, the Sheets read-only scope, and a one-hour-or-less lifetime.
- token and values requests never place the private key in URL, body diagnostics, or thrown error text.
- `spreadsheets.values.batchGet` uses repeated `ranges`, `majorDimension=ROWS`, and `valueRenderOption=FORMATTED_VALUE`.
- spreadsheet metadata is fetched first and resolves exact visible/hidden sheet titles and grid limits before values are requested.
- 429 and 5xx responses retry at most four times with bounded exponential backoff plus injected jitter; 400/401/403 fail immediately with sanitized diagnostics.
- returned ranges preserve the registry request order even if the response omits an empty range.

Representative assertion:

```js
assert.match(valuesUrl, /valueRenderOption=FORMATTED_VALUE/);
assert.doesNotMatch(JSON.stringify(result), /BEGIN PRIVATE KEY/);
```

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-google-client.test.mjs
```

Expected: FAIL because the client module does not exist.

**Step 3: Implement the client**

- Build and sign the OAuth JWT with `node:crypto`; exchange it at `https://oauth2.googleapis.com/token`.
- Call only the Google Sheets v4 spreadsheet-metadata and values batch-get endpoints.
- Use a stable user agent and abort each HTTP attempt after a fixed timeout.
- Return `{ range, values }` arrays without applying domain conversion.
- Sanitize response excerpts and filenames in errors; include status, attempt count, and requested ranges.
- Make retries deterministic under test by injecting `sleep`, `now`, and jitter/randomness.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-google-client.test.mjs
```

Expected: all Google client tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/google-sheets-client.mjs tests/equipment-import-google-client.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: add read-only sheets api client"
git push -u origin lich_branch
```

---

### Task 3: Implement strict, field-specific parsers

**Files:**

- Create: `tools/equipment-import/parsers.mjs`
- Create: `tests/equipment-import-parsers.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function parseRequiredText(raw, context);
export function parseOptionalText(raw, context);
export function parseBooleanToken(raw, context, options);
export function parseInteger(raw, context, options);
export function parseDecimal(raw, context, options);
export function parseWeight(raw, context);
export function parseAttachmentWeightModifier(raw, context);
export function parseTransportWeight(raw, context);
export function parseCurrency(raw, context);
export function parseRange(raw, context);
export function parseDamageFormula(raw, context);
export function parseDelimitedList(raw, context, options);
export function parseEnum(raw, context, options);
```

No exported `parseAny`, `coerceValue`, or type-guessing helper is allowed. Each adapter must select the parser appropriate to the declared field.

**Step 1: Write the failing tests**

Build table-driven cases that prove:

```js
test.each([
  ["1/4 фнт", 0.25],
  ["1/2 фунта", 0.5],
  ["1 1/4 фнт", 1.25],
  ["¼ фнт", 0.25],
  ["½ фнт", 0.5],
  ["¾ фнт", 0.75],
  ["2 фнт", 2],
  ["0,25 фнт", 0.25],
])("parseWeight(%s) -> %s", (raw, expected) => {
  assert.equal(parseWeight(raw, ctx), expected);
});

test.each(["1/0 фнт", "1//4", "14/", "полфунта", "NaN", "Infinity"])(
  "parseWeight rejects %s",
  (raw) => assert.throws(() => parseWeight(raw, ctx), ImportDiagnosticError),
);
```

Also cover Unicode dashes, comma decimals, signed values, spaces as thousands separators, explicit blank/null policy, equipment `Незнач. -> 0`, equipment dash `-> null`, ordinary negative-weight rejection, allowed negative attachment modifiers, transport tons represented as `{ value, unit: "ton" }`, integer-only rejection, Cyrillic dice `к -> d`, damage dice, range `30/90`, reload, misfire, capacity, list delimiters, recognized Russian yes/no tokens, and rejection of unexpected booleans/enums. Price tests must distinguish fixed `{ kind: "fixed", raw, value, denomination, goldEquivalent }`, variable `{ kind: "variable", raw }`, and `null`; `20–1 500 зм (по уровню)` must remain variable rather than becoming `20`.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-parsers.test.mjs
```

Expected: FAIL because parsers do not exist.

**Step 3: Implement minimal strict parsing**

- Trim only outer whitespace; retain meaningful internal text.
- For fractions, require exactly `numerator/denominator`, finite integers, and non-zero denominator before division.
- Support whole-plus-fraction inputs and the Unicode `¼`, `½`, and `¾` forms through an explicit numeric grammar.
- Strip only an explicit allowlist of unit suffixes after validating the complete input. Never delete every non-digit character.
- Accept decimal comma only where the field declaration permits it.
- Return `null` only for fields explicitly declared optional; otherwise emit a contextual diagnostic.
- Return canonical enums/property tokens only through explicit maps maintained near the relevant adapter.
- Keep field policy outside the shared numeric grammar: only equipment weight recognizes `Незнач.`, only attachments allow a negative weight modifier, and only transport accepts tons.

The regression invariant is exact:

```js
assert.equal(parseWeight("1/4 фнт", ctx), 0.25);
assert.notEqual(parseWeight("1/4 фнт", ctx), 14);
```

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-parsers.test.mjs
```

Expected: all parser tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/parsers.mjs tests/equipment-import-parsers.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: add strict equipment field parsers"
git push -u origin lich_branch
```

---

### Task 4: Define stable identity and manual enrichment overrides

**Files:**

- Create: `tools/equipment-import/overrides.mjs`
- Create: `data/equipment-import-overrides.json`
- Create: `tests/equipment-import-overrides.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export const EQUIPMENT_OVERRIDE_SCHEMA_VERSION = 1;
export function validateEquipmentOverrides(rawOverrides, context);
export function resolveStableIdentity({ catalog, sourceKey, sourceName, overrides });
export function applyManualEnrichment({ catalog, stableId, generated, overrides, allowedFields });
export function buildInitialEquipmentOverrides({ gear, implants, transport, magicItems });
```

Schema shape:

```json
{
  "schemaVersion": 1,
  "identities": {
    "gear": { "Дротик": "dart" },
    "magicItems": { "Название предмета": "stable-slug" }
  },
  "enrichment": {
    "gear": {
      "dart": {
        "foundryBaseItem": "dart",
        "foundryFolder": "Weapons"
      }
    }
  }
}
```

The real file is generated from existing catalogs in Task 14; at this stage commit only the valid empty schema fixture needed to establish the contract.

**Step 1: Write the failing tests**

Assert:

- a known source key resolves to its current stable ID;
- duplicate stable IDs across two source keys are rejected;
- a source rename without an explicit identity mapping is reported as delete+add later, never silently guessed;
- enrichment permits only adapter-declared manual fields;
- attempts to override sheet-owned `weight`, `price`, `weapon`, `armor`, firearm statistics, or magic-item description fail;
- initial migration detects duplicate names/IDs instead of overwriting them.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-overrides.test.mjs
```

Expected: FAIL because override handling does not exist.

**Step 3: Implement schema and identity resolution**

- Key identities by catalog plus a normalized source key based on the sheet's declared stable-key column.
- Preserve explicit IDs exactly; slug generation is allowed only for a genuinely new row and must fail on collisions.
- Define per-adapter enrichment allowlists. For base gear, the initial manual candidates are `foundryType`, `foundrySubtype`, `foundrySubtypeExtra`, `foundryBaseItem`, `foundryFolder`, `itemSlot`, `heroDollSlots`, `multipleAppearance`, `containerCapacity`, and `containerContents` when the source registry does not own them.
- Treat `weapon`, `armor`, `firearmClass`, ammunition/explosive/attachment profiles, prices, weights, and descriptions as sheet-owned once their adapters exist.
- Validate all override keys so stale entries become actionable errors, not ignored configuration.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-overrides.test.mjs
```

Expected: all override tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/overrides.mjs data/equipment-import-overrides.json tests/equipment-import-overrides.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: define equipment identity overrides"
git push -u origin lich_branch
```

---

### Task 5: Build the shared reference index and base gear adapter

**Files:**

- Create: `tools/equipment-import/adapters/base-gear.mjs`
- Create: `tests/equipment-import-base-gear.test.mjs`
- Create: `tests/fixtures/equipment-import/base-gear-raw.json`
- Create: `tests/fixtures/equipment-import/base-gear-expected.json`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function buildEquipmentReferenceIndex({ snapshots, overrides });
export function adaptBaseGear({ snapshot, referenceIndex, overrides, diagnostics });
export function mergeGearFragments({ baseItems, fragmentsByAdapter, diagnostics });
```

**Step 1: Write the failing tests**

The fixture must include at least:

- `Дротик` with raw weight `1/4 фнт` and its existing stable ID;
- a container item with manual capacity enrichment;
- one row referenced by a weapon/armor profile;
- one malformed or duplicate reference in a separate negative fixture.

Assert the expected object shape exactly, including key order-independent deep equality, weight `0.25`, deterministic stable ID, source-derived price/category/description fields, and allowed manual enrichment. Assert two fragments cannot both own the same field.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-base-gear.test.mjs
```

Expected: FAIL because the adapter does not exist.

**Step 3: Implement the adapter**

- Build a single reference index before adapting profiles. `_СПРАВОЧНИК_СНАРЯЖЕНИЯ` supplies canonical references in the form `Лист!A<row>`; validate the referenced sheet, row, and canonical fields, then index those exact references plus reviewed override aliases.
- A normalized display name may appear only in a diagnostic suggesting a missing mapping. It may never choose a join or stable ID automatically.
- Map base rows to the current `gear.json` contract.
- Apply typed parsers field by field and attach diagnostics to source sheet/range/row/column.
- Merge profile fragments only through `mergeGearFragments`; fail on conflicting ownership rather than last-write-wins.
- Apply identity and permitted enrichment after source fields are parsed but before bundle validation.
- Sort output by stable ID for deterministic serialization unless the existing runtime consumer requires a documented alternative.
- Successfully route transport rows out of ordinary `gear.json` and into the transport adapter; an unrouteable transport row remains an error rather than being dropped.

**Step 4: Run GREEN plus the regression test**

```powershell
node --test tests/equipment-import-base-gear.test.mjs tests/equipment-import-parsers.test.mjs
```

Expected: all tests pass and the `1/4 фнт -> 0.25` invariant remains green.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/adapters/base-gear.mjs tests/equipment-import-base-gear.test.mjs tests/fixtures/equipment-import/base-gear-raw.json tests/fixtures/equipment-import/base-gear-expected.json docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: adapt base equipment catalog"
git push -u origin lich_branch
```

### Task 6: Adapt weapons and complete firearm profiles

**Files:**

- Create: `tools/equipment-import/adapters/weapons.mjs`
- Create: `tests/equipment-import-weapons.test.mjs`
- Create: `tests/fixtures/equipment-import/weapons-raw.json`
- Create: `tests/fixtures/equipment-import/weapons-expected.json`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function adaptWeaponProfiles({ snapshots, referenceIndex, diagnostics });
export function parseWeaponProperties(raw, context);
export function parseFirearmProfile(row, context);
```

The adapter returns fragments keyed by the referenced base-gear stable ID. It does not create duplicate base items.

**Step 1: Write the failing tests**

Include and deep-compare representative profiles:

- `Боевой посох`: `damageFormula: "1d6"`, damage type `bludgeoning`, `versatile: "1d8"`, `dashDice: "1d2"`, and canonical properties `ver`, `lchDash`, `lchSwing`.
- `Кремневый пистолет`: ranges `30/90`, misfire `3`, ammunition `Мушкетные`, fire mode `Одиночные`, reload count/text according to the current runtime contract, firearm class `primitive`, and all current property tokens.
- firearm invention year, strength requirement, every declared mode, ammo-family property, and additional property value are present when supplied by `Огнестрел V0.36`.
- a non-firearm weapon with no firearm-only fields.
- negative fixtures for unknown property token, impossible range, malformed dice, missing ammunition reference, and firearm-only values on a non-firearm row.

Assert exact current `weapon` object shape; do not merely assert selected fields.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-weapons.test.mjs
```

Expected: FAIL because the weapon adapter does not exist.

**Step 3: Implement explicit profile mapping**

- Define exact Russian/source-token maps for damage types, weapon categories, properties, firearm classes, ammunition types, and fire modes.
- Parse normal/long range independently and enforce `long >= normal` when both are present.
- Permit firearm-only fields only for declared firearm rows and require every field needed by the current dnd5e consumer.
- Resolve ammunition through the shared reference index; report the source cell when missing.
- Keep formula text canonical but never evaluate dice.
- Return owned fields as `{ weapon, firearmClass }`, with the firearm subprofile containing invention year, modes, ammunition family/properties, reload, misfire, ranges, strength requirement, and additional property values. Base gear remains the sole owner of name, description, price, and weight.

**Step 4: Run GREEN with base merge coverage**

```powershell
node --test tests/equipment-import-weapons.test.mjs tests/equipment-import-base-gear.test.mjs
```

Expected: all weapon and merge tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/adapters/weapons.mjs tests/equipment-import-weapons.test.mjs tests/fixtures/equipment-import/weapons-raw.json tests/fixtures/equipment-import/weapons-expected.json docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: import weapon and firearm profiles"
git push -u origin lich_branch
```

---

### Task 7: Adapt armor, ammunition, explosives, attachments, and upgrades

**Files:**

- Create: `tools/equipment-import/adapters/armor.mjs`
- Create: `tools/equipment-import/adapters/ammunition.mjs`
- Create: `tools/equipment-import/adapters/explosives.mjs`
- Create: `tools/equipment-import/adapters/attachments.mjs`
- Create: `tools/equipment-import/adapters/upgrades.mjs`
- Create: `tests/equipment-import-gear-profiles.test.mjs`
- Create: `tests/fixtures/equipment-import/gear-profiles-raw.json`
- Create: `tests/fixtures/equipment-import/gear-profiles-expected.json`
- Modify: `scripts/data/gear-compendium.js`
- Modify: `tests/gear-compendium.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function adaptArmorProfiles({ snapshot, referenceIndex, diagnostics });
export function adaptAmmunitionProfiles({ snapshot, referenceIndex, diagnostics });
export function adaptExplosiveProfiles({ snapshot, referenceIndex, diagnostics });
export function adaptAttachmentProfiles({ snapshot, referenceIndex, diagnostics });
export function adaptUpgradeCatalog({ snapshot, referenceIndex, overrides, diagnostics });
```

Add the new sheet-owned profiles to the existing gear signature and metadata projection; keep the exact public export names already used by `scripts/data/gear-compendium.js`.

**Step 1: Write failing adapter and consumer tests**

Required cases:

- `Стёганый доспех`: armor type `light`, base item `padded`, value `11`, no dex cap, strength `0`, and `stealthDisadvantage`.
- ammunition resolves its compatible weapon/ammunition references and preserves typed quantity/damage modifiers.
- `Боеприпасы` is a raw two-table source (`B3:F17`, `B19:G...`); the second table's blank rank header and global hand-cannon die-step rule are declared by the registry rather than inferred from cell types.
- explosive radius, save DC/ability, damage formula/type, uses, and properties are typed and validated.
- attachment slot/compatibility/properties resolve through declared enum/reference maps.
- upgrades retain stable IDs, price/weight/effects, and explicit compatibility references.
- the gear compendium signature changes when any new profile changes; metadata rows expose the fields required for debugging without changing document ownership.

Negative cases must include a dangling base-item reference, unknown armor type, malformed AC, illegal dex cap, and attachment compatibility targeting a missing item.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-gear-profiles.test.mjs tests/gear-compendium.test.mjs
```

Expected: FAIL because the adapters and signature coverage do not exist.

**Step 3: Implement one owner per profile**

- Each adapter maps only its declared sheet and returns one named fragment per base ID.
- Reuse strict parsers and the shared reference index; do not copy ad-hoc coercion helpers.
- Define profile fields from the live headers and current runtime consumer needs. If a live header has no approved destination, fail the registry/adapter test and amend the design before inventing a field.
- Extend `buildGearSignature` and the existing metadata-row builder to include ammunition, explosive, attachment, and any other new runtime profiles in stable key order.
- Keep the compendium document schema backward-compatible for items without the new profiles.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-gear-profiles.test.mjs tests/gear-compendium.test.mjs tests/gear-catalog-sync.test.mjs
```

Expected: all profile and existing gear-sync tests pass.

**Step 5: Update passport and checkpoint**

Document every adapter and the changed signature/metadata data flow.

```powershell
git add tools/equipment-import/adapters/armor.mjs tools/equipment-import/adapters/ammunition.mjs tools/equipment-import/adapters/explosives.mjs tools/equipment-import/adapters/attachments.mjs tools/equipment-import/adapters/upgrades.mjs tests/equipment-import-gear-profiles.test.mjs tests/fixtures/equipment-import/gear-profiles-raw.json tests/fixtures/equipment-import/gear-profiles-expected.json scripts/data/gear-compendium.js tests/gear-compendium.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: import complete equipment profiles"
git push -u origin lich_branch
```

---

### Task 8: Adapt materials, implants, and transport

**Files:**

- Create: `tools/equipment-import/adapters/materials.mjs`
- Create: `tools/equipment-import/adapters/implants.mjs`
- Create: `tools/equipment-import/adapters/transport.mjs`
- Create: `tests/equipment-import-secondary-catalogs.test.mjs`
- Create: `tests/fixtures/equipment-import/secondary-catalogs-raw.json`
- Create: `tests/fixtures/equipment-import/secondary-catalogs-expected.json`
- Modify: `scripts/data/material-catalog-sync.js`
- Modify: `scripts/data/transport-actor-builder.js` only if the generated transport contract can be made typed without breaking current consumers
- Modify: `tests/material-catalog-sync.test.mjs`
- Modify: `tests/transport-actor-builder.test.mjs` if its contract changes
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function adaptMaterialsCatalog({ snapshot, overrides, diagnostics });
export function adaptImplantsCatalog({ snapshot, referenceIndex, overrides, diagnostics });
export function adaptTransportCatalog({ snapshots, referenceIndex, overrides, diagnostics });
```

Retain `buildBaseRawMaterialIndex(materials)` as the runtime material lookup used by crafting. Remove or replace importer-era normalizers only after `rg` confirms they have no runtime callers.

**Step 1: Write failing tests**

Assert exact generated catalog shapes for at least one material, one implant, and one transport entry. Cover:

- material numeric fields and base-raw-material aliases;
- only real `Энциклопедия материалов` rows are generated from Sheets; any runtime-required synthetic material is preserved solely by a curated override with an explicit non-sheet source kind;
- implant price, weight, slot/category, properties, and stable identity;
- transport actor statistics, movement, capacity, crew, weapons/equipment references, and any multi-sheet composition;
- missing or malformed cross-sheet references with row/column diagnostics.

Replace the old PowerShell baseline assertion in `tests/material-catalog-sync.test.mjs` with an adapter behavior assertion. The replacement must prove the Node importer owns material generation; it must not depend on `Get-FileHash`, PowerShell availability, or an untracked baseline file.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-secondary-catalogs.test.mjs tests/material-catalog-sync.test.mjs tests/transport-actor-builder.test.mjs
```

Expected: FAIL because adapters are absent and the legacy material test still describes the old importer.

**Step 3: Implement and retire duplicated parsing ownership**

- Use the central parsers for all generated fields.
- Preserve the current runtime catalog contracts unless a focused consumer test proves the safer typed representation is accepted.
- If transport JSON must retain a textual field for a consumer, validate the source with a typed parser and serialize its canonical text form; document that exception.
- Remove `normalizeMaterialSheetRows` and `mergeMaterialCatalog` only when no runtime code calls them. Keep `buildBaseRawMaterialIndex` and its tests.
- Do not delete `tools/import-materials.ps1` yet; final removal happens only after live parity in Task 15.
- Do not recreate the old synthetic-from-goods expansion from the out-of-scope economy workbook.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-secondary-catalogs.test.mjs tests/material-catalog-sync.test.mjs tests/materials-data.test.mjs tests/materials-compendium.test.mjs tests/implants-catalog.test.mjs tests/transport-compendium.test.mjs tests/transport-actor-builder.test.mjs
```

Expected: all secondary-catalog and existing runtime consumer tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/adapters/materials.mjs tools/equipment-import/adapters/implants.mjs tools/equipment-import/adapters/transport.mjs tests/equipment-import-secondary-catalogs.test.mjs tests/fixtures/equipment-import/secondary-catalogs-raw.json tests/fixtures/equipment-import/secondary-catalogs-expected.json scripts/data/material-catalog-sync.js tests/material-catalog-sync.test.mjs docs/function-passport.md
if (git diff --name-only -- scripts/data/transport-actor-builder.js tests/transport-actor-builder.test.mjs) { git add scripts/data/transport-actor-builder.js tests/transport-actor-builder.test.mjs }
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: import secondary equipment catalogs"
git push -u origin lich_branch
```

---

### Task 9: Adapt magic items with explicit stable IDs

**Files:**

- Create: `tools/equipment-import/adapters/magic-items.mjs`
- Create: `tests/equipment-import-magic-items.test.mjs`
- Create: `tests/fixtures/equipment-import/magic-items-raw.json`
- Create: `tests/fixtures/equipment-import/magic-items-expected.json`
- Modify: `tests/magic-items-compendium.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function adaptMagicItemsCatalog({ snapshots, overrides, referenceIndex, diagnostics });
export function renderMagicItemsModule(items);
```

The adapter returns the existing 16-field item contract plus an explicit stable `id`. `scripts/data/magic-items-compendium.js` already accepts `rawItem.id ?? name`, so runtime behavior must remain compatible.

**Step 1: Write the failing tests**

Use representative mundane-linked and standalone magic items. Assert:

- exact source description and gameplay fields map to the existing contract;
- price/weight/charges/bonuses use explicit parsers;
- rarity, attunement, type, damage, properties, spells/effects, and base-item references validate against explicit enums or reference indexes;
- every item receives the stable ID migrated from the current `magicItem.js` slug behavior;
- duplicate names, duplicate IDs, missing required descriptions, and dangling gear references fail with contextual diagnostics;
- `renderMagicItemsModule` is deterministic and importable as ESM.

Add a consumer test proving explicit IDs are honored and that an unchanged item retains the same Foundry signature/document identity.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-magic-items.test.mjs tests/magic-items-compendium.test.mjs
```

Expected: FAIL because the adapter/renderer do not exist.

**Step 3: Implement magic-item adaptation**

- Compose all declared magic-item ranges through registry order; never infer which sheet a row belongs to.
- Preserve HTML/text according to the current consumer contract without trimming meaningful content.
- Resolve any base-equipment relation through the shared index.
- Apply explicit migrated identity before rendering.
- Emit `magicItem.js` as a generated ESM module with a short generated-file header and `export const MAGIC_ITEMS = [...];` compatible with current imports. Stable key and record ordering provides determinism; do not add a runtime wrapper unless existing consumer tests require it.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-magic-items.test.mjs tests/magic-items-compendium.test.mjs
```

Expected: all magic-item adapter and runtime consumer tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/adapters/magic-items.mjs tests/equipment-import-magic-items.test.mjs tests/fixtures/equipment-import/magic-items-raw.json tests/fixtures/equipment-import/magic-items-expected.json tests/magic-items-compendium.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: import magic items with stable ids"
git push -u origin lich_branch
```

---

### Task 10: Compose and validate one complete catalog bundle

**Files:**

- Create: `tools/equipment-import/pipeline.mjs`
- Create: `tests/equipment-import-pipeline.test.mjs`
- Create: `tests/fixtures/equipment-import/complete-snapshot.json`
- Create: `tests/fixtures/equipment-import/complete-bundle.json`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export const GENERATED_CATALOG_PATHS = Object.freeze({
  gear: "data/gear.json",
  upgrades: "data/upgrades.json",
  materials: "data/materials.json",
  implants: "data/implants.json",
  transport: "data/rebreya-transport-v01.json",
  magicItems: "magicItem.js",
});

export function buildEquipmentBundle({ workbookSnapshot, overrides });
export function validateEquipmentBundle({ bundle, workbookSnapshot, overrides });
```

Successful in-memory shape:

```js
{
  schemaVersion: 1,
  source: { spreadsheetId, fingerprint },
  catalogs: { gear, upgrades, materials, implants, transport, magicItems },
  diagnostics: [],
}
```

**Step 1: Write the failing tests**

The complete fixture should be small but include every adapter and at least three cross-catalog references. Assert:

- exact deep equality of the full bundle;
- all catalog IDs are unique within their namespaces;
- every base/profile/reference target exists;
- the same source row cannot produce two IDs;
- no declared non-empty source row is silently unconsumed;
- all diagnostics across adapters are accumulated, sorted, and reported together;
- diagnostics are capped at 100 detailed entries and report how many additional errors were suppressed;
- adapters receive immutable snapshots and cannot mutate another adapter's output.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-pipeline.test.mjs
```

Expected: FAIL because bundle orchestration does not exist.

**Step 3: Implement bundle composition**

- Validate every snapshot first, build the shared reference index second, run adapters third, merge gear fragments fourth, and validate the resulting bundle last.
- Collect diagnostics instead of failing after the first malformed row, except for unusable global inputs such as invalid credentials or a missing required sheet. Retain at most 100 detailed entries and a suppressed count.
- Deep-freeze adapter inputs in tests/development mode to detect mutation.
- Validate output contracts required by existing compendium consumers before returning.
- Return the locked `{ schemaVersion, source, catalogs, diagnostics }` shape only after the complete bundle is valid; generated metadata contains spreadsheet ID and fingerprint, never a timestamp.

**Step 4: Run GREEN and all adapter tests**

```powershell
node --test tests/equipment-import-*.test.mjs
```

Expected: all importer unit tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/pipeline.mjs tests/equipment-import-pipeline.test.mjs tests/fixtures/equipment-import/complete-snapshot.json tests/fixtures/equipment-import/complete-bundle.json docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: compose unified equipment bundle"
git push -u origin lich_branch
```

---

### Task 11: Add semantic diffing and destructive-change guards

**Files:**

- Create: `tools/equipment-import/diff.mjs`
- Create: `tests/equipment-import-diff.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function diffEquipmentBundles({ currentBundle, nextBundle });
export function evaluateDestructiveGuards({ diff, flags, sourceSummary });
export function formatEquipmentDiffReport({ diff, sourceSummary, mode });
```

Diff shape must expose per catalog: `added`, `changed`, `unchanged`, `removed`, and `identityChurn`; each entry includes stable ID and source/display name. Changed entries include stable field paths, not an unreadable full-object dump.

**Step 1: Write the failing tests**

Cover:

- identical bundles yield zero changes;
- a field edit is `changed`, not delete+add;
- same source identity moving to another stable ID is `identityChurn` and always blocks;
- one deletion blocks without `--allow-removals` and passes with it;
- 11 deletions out of 100 and 26 out of 400 are large diffs and additionally require `--allow-large-diff`;
- 10% exactly is not greater than the threshold, while 10% plus one is;
- an empty required catalog or loss of more than 50% always blocks regardless of flags;
- report ordering is deterministic and never includes credential content.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-diff.test.mjs
```

Expected: FAIL because diffing does not exist.

**Step 3: Implement guards exactly**

Use these rules:

```js
const removalRate = previousCount === 0 ? 0 : removedCount / previousCount;
const isLargeRemoval = removedCount > 25 || removalRate > 0.10;
const isCatastrophic = nextCount === 0 || removalRate > 0.50;
```

- Any removal requires `allowRemovals`.
- A large removal additionally requires `allowLargeDiff`. It triggers when either limit is exceeded: more than 25 records or more than 10% of that catalog, which is equivalent to using the smaller applicable threshold.
- Catastrophic loss and identity churn always throw; no CLI flag bypasses them.
- A source sheet that unexpectedly returns no data for a required catalog is also catastrophic.
- Format dry-run output as per-catalog counts followed by changed/removed IDs and field paths. Keep it concise enough for code review.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-diff.test.mjs
```

Expected: all diff and guard tests pass.

**Step 5: Update passport and checkpoint**

```powershell
git add tools/equipment-import/diff.mjs tests/equipment-import-diff.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: guard equipment import diffs"
git push -u origin lich_branch
```

---

### Task 12: Add deterministic serialization and transactional writes

**Files:**

- Create: `tools/equipment-import/serialization.mjs`
- Create: `tools/equipment-import/transactional-writer.mjs`
- Create: `tests/equipment-import-serialization.test.mjs`
- Create: `tests/equipment-import-transaction.test.mjs`
- Modify: `docs/function-passport.md`

**Interfaces:**

```js
export function serializeEquipmentBundle(bundle);
export function parseCurrentEquipmentBundle({ filesByPath });
export async function applyGeneratedFilesTransaction({ filesByPath, fsImpl, tempRoot });
export async function recoverInterruptedEquipmentTransaction({ fsImpl, tempRoot });
```

`serializeEquipmentBundle` returns a map of repository-relative output paths to UTF-8 strings. JSON uses two-space indentation and one final newline. `magicItem.js` uses deterministic ESM rendering.

**Step 1: Write failing serializer tests**

Assert:

- two semantically identical bundles with different insertion order serialize byte-for-byte identically;
- each current generated file can be parsed and serialized without losing supported fields;
- JSON parses and `magicItem.js` imports successfully;
- no `undefined`, `NaN`, `Infinity`, platform-dependent newline, or absolute path appears in output.

**Step 2: Write failing transaction/rollback tests**

Use a temporary test directory and an injected filesystem adapter. Assert:

- dry-run never calls a mutation method;
- all output files are first written under a staging directory on the same volume;
- successful apply replaces every file and removes staging/backup artifacts;
- injected failure on the third replacement restores the first two and leaves all originals byte-for-byte intact;
- a missing original can be created on success and removed during rollback;
- output hashes are verified after replacement and a mismatch triggers rollback;
- simulated process interruption leaves a compact manifest from which the next invocation restores originals before starting a new apply;
- cleanup errors are reported without hiding the primary failure.

**Step 3: Run RED**

```powershell
node --test tests/equipment-import-serialization.test.mjs tests/equipment-import-transaction.test.mjs
```

Expected: FAIL because both modules are absent.

**Step 4: Implement deterministic all-or-nothing apply**

- Render the full map in memory and validate it before touching disk.
- Create staging and backup directories inside the repository output volume using unique names.
- Write every staged file with UTF-8, flush/close it, and parse/check staged content before replacement.
- Back up all existing targets before replacing the first target.
- Persist a compact transaction manifest listing exact target/staged/backup paths, original existence, expected hashes, and transaction phase. Update it before each irreversible rename.
- Replace targets in stable path order, then reread every target and verify its expected SHA-256. On error, restore every existing original and remove any newly created target named by this manifest.
- On startup, detect an interrupted manifest and deterministically finish restoration before permitting dry-run/apply. Do not start a second transaction while recovery is pending.
- Resolve and verify every target is one of `GENERATED_CATALOG_PATHS`; reject traversal and arbitrary output paths.
- Never include credentials or their directory in the transaction.
- Delete staging, backups, and manifest after verified success. If restoration cannot finish, retain the manifest and return a recovery error with exact safe next steps.

**Step 5: Run GREEN**

```powershell
node --test tests/equipment-import-serialization.test.mjs tests/equipment-import-transaction.test.mjs
```

Expected: all deterministic serialization and rollback tests pass.

**Step 6: Update passport and checkpoint**

```powershell
git add tools/equipment-import/serialization.mjs tools/equipment-import/transactional-writer.mjs tests/equipment-import-serialization.test.mjs tests/equipment-import-transaction.test.mjs docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: write equipment catalogs transactionally"
git push -u origin lich_branch
```

---

### Task 13: Expose the single importer CLI

**Files:**

- Create: `tools/import-equipment.mjs`
- Create: `tests/equipment-import-cli.test.mjs`
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**CLI contract:**

```text
node tools/import-equipment.mjs [options]

Options:
  --apply                 write the validated bundle; default is dry-run
  --allow-removals        permit non-catastrophic removals
  --allow-large-diff      permit a catalog loss exceeding 25 records or 10%
  --credentials <path>    service-account JSON; defaults to env or ignored tools file
  --spreadsheet-id <id>   defaults to the approved primary spreadsheet
  --snapshot <path>       read a local raw snapshot instead of Google (test/debug only)
  --write-snapshot <path> save fetched raw string snapshot for debugging
  --help                  print usage
```

`--snapshot` and `--write-snapshot` must never contain OAuth tokens or service-account fields. They contain only spreadsheet ID, fetched ranges, string values, and fetch timestamp/source summary.

**Step 1: Write failing CLI tests**

Spawn Node against fixture snapshots with a temporary working tree. Assert:

- no arguments performs a dry-run and leaves every output byte unchanged;
- `--apply` writes a valid small bundle;
- unknown flags, conflicting snapshot options, missing credential file, invalid snapshot, and guard failures return non-zero;
- `--help` returns zero and documents every option;
- stdout distinguishes `DRY-RUN` from `APPLIED`, reports all catalog counts, and never exposes secret values;
- stdout includes spreadsheet ID, snapshot fingerprint, resolved sheets/ranges, and warning/error counts without dumping full source rows;
- an interrupted transaction is recovered before source access, and an unrecoverable manifest blocks both dry-run and apply;
- warnings go to stderr and validation failures use a stable concise summary.

**Step 2: Run RED**

```powershell
node --test tests/equipment-import-cli.test.mjs
```

Expected: FAIL because the CLI does not exist.

**Step 3: Implement thin orchestration**

Execution order:

```text
parse flags
  -> recover or reject an interrupted prior transaction
  -> load/validate overrides
  -> fetch API ranges or load raw snapshot
  -> build and validate complete bundle
  -> load current generated bundle
  -> semantic diff + destructive guards
  -> print report
  -> stop for dry-run OR transactionally apply all files
  -> verify written hashes and reparse every target before reporting APPLIED
```

- Keep business logic in internal modules; the CLI only wires dependencies and exit handling.
- Refuse `--allow-large-diff` unless `--allow-removals` is also present.
- Ignore `--apply` until bundle validation and guards both succeed.
- Emit non-zero exit codes by category: `2` usage/config, `3` source/API, `4` validation, `5` destructive guard, `6` transactional write.
- Set no global process hooks beyond a top-level caught promise.

**Step 4: Run GREEN**

```powershell
node --test tests/equipment-import-cli.test.mjs tests/equipment-import-*.test.mjs
```

Expected: CLI and all importer tests pass.

**Step 5: Document public usage and checkpoint**

Update the existing README import-tools section with the one command, default dry-run behavior, credentials lookup, flags, generated files, and safe operator sequence. Update the passport with the CLI orchestration and exit contracts.

```powershell
git add tools/import-equipment.mjs tests/equipment-import-cli.test.mjs README.md docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: add unified equipment importer cli"
git push -u origin lich_branch
```

---

### Task 14: Migrate current identities, generate from the live sheet, and prove idempotency

**Files:**

- Modify: `data/equipment-import-overrides.json`
- Modify: `data/gear.json`
- Modify: `data/upgrades.json`
- Modify: `data/materials.json`
- Modify: `data/implants.json`
- Modify: `data/rebreya-transport-v01.json`
- Modify: `magicItem.js`
- Create: `tests/equipment-import-generated-data.test.mjs`
- Modify: relevant existing catalog-data tests only when the approved sheet is now authoritative
- Modify: `docs/function-passport.md` only if migration reveals a changed method/contract

**Step 1: Generate the initial identity/enrichment map from current catalogs**

Run the migration helper once and review the resulting file before any live apply:

```powershell
node --input-type=module -e "import { readFile, writeFile } from 'node:fs/promises'; import { buildInitialEquipmentOverrides } from './tools/equipment-import/overrides.mjs'; const [{ MAGIC_ITEMS }, gear, implants, transport] = await Promise.all([import('./magicItem.js'), readFile('./data/gear.json', 'utf8').then(JSON.parse), readFile('./data/implants.json', 'utf8').then(JSON.parse), readFile('./data/rebreya-transport-v01.json', 'utf8').then(JSON.parse)]); const result = buildInitialEquipmentOverrides({ gear, implants, transport, magicItems: MAGIC_ITEMS }); await writeFile('./data/equipment-import-overrides.json', JSON.stringify(result, null, 2) + '\n', 'utf8');"
```

Review duplicate/missing identity diagnostics and compare every migrated ID count to the current catalogs. Do not hand-edit around a collision; fix the declared source key or add one explicit reviewed mapping.

**Step 2: Add the generated-data regression test before live apply**

The test loads the tracked catalogs plus overrides and asserts:

- all generated files parse/import;
- stable IDs are unique and match the override identities;
- `Дротик.weight === 0.25`;
- all cross-catalog references resolve;
- required representative weapon, firearm, armor, material, implant, transport, and magic-item fields are present;
- no current tracked catalog loses fields that the runtime consumers require.

Run:

```powershell
node --test tests/equipment-import-generated-data.test.mjs
```

Expected before live apply: FAIL at least on `Дротик.weight`, currently corrupted to `14`, and on any newly required generated profile.

**Step 3: Fetch the live sheet in dry-run mode**

```powershell
node tools/import-equipment.mjs
```

Expected: successful Google authentication using the ignored token file, complete source/bundle validation, and a deterministic `DRY-RUN` diff. If it reports removals, identity churn, an empty required source, or more than the expected data corrections, stop. List exact affected stable IDs in the implementation report and request explicit user approval before adding removal flags. Never guess that a source row was intentionally deleted.

**Step 4: Apply the approved live bundle**

For a diff without removals:

```powershell
node tools/import-equipment.mjs --apply
```

For user-approved non-catastrophic removals only:

```powershell
node tools/import-equipment.mjs --apply --allow-removals
```

Add `--allow-large-diff` only when the user explicitly approved the exact large removal list. Catastrophic loss and identity churn must remain impossible.

**Step 5: Prove idempotency immediately**

```powershell
node tools/import-equipment.mjs
```

Expected: zero additions, changes, removals, and identity churn in every catalog. A non-zero second diff is a bug in normalization/order/serialization; fix it before committing generated data.

**Step 6: Run focused generated/runtime tests**

```powershell
node --test tests/equipment-import-generated-data.test.mjs tests/gear-compendium.test.mjs tests/materials-compendium.test.mjs tests/implants-catalog.test.mjs tests/transport-compendium.test.mjs tests/magic-items-compendium.test.mjs
```

Expected: all pass, including `1/4 фнт -> 0.25`.

**Step 7: Review and checkpoint only exact generated files**

```powershell
git add data/equipment-import-overrides.json data/gear.json data/upgrades.json data/materials.json data/implants.json data/rebreya-transport-v01.json magicItem.js tests/equipment-import-generated-data.test.mjs
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "data: sync equipment and magic items"
git push -u origin lich_branch
```

The implementation report for this task must include live source row counts, per-catalog add/change/remove counts, explicit removal approvals if any, and the second dry-run zero-diff result.

---

### Task 15: Retire the superseded importers and complete repository verification

**Files:**

- Delete: `tools/import-gear.ps1`
- Delete: `tools/import-materials.ps1`
- Preserve: `tools/import-xlsx.ps1` because it owns the separate economy workbook workflow
- Modify: `tests/gear-import-script.test.mjs`
- Modify: any tests that still name the deleted scripts
- Modify: `README.md`
- Modify: `docs/function-passport.md`

**Step 1: Prove parity before deletion**

Run searches and focused suites:

```powershell
rg -n "import-gear\.ps1|import-materials\.ps1|normalizeMaterialSheetRows|mergeMaterialCatalog" README.md docs scripts tests tools
node --test tests/equipment-import-*.test.mjs tests/gear-import-script.test.mjs tests/material-catalog-sync.test.mjs
```

Expected before edits: references identify only the legacy entrypoints/tests/docs that must be replaced. If a runtime caller still depends on a legacy helper, stop and migrate that caller before deleting its owner.

**Step 2: Rewrite the legacy script contract test**

Replace `tests/gear-import-script.test.mjs` with a compatibility test for the single CLI. It must assert:

- `tools/import-equipment.mjs` is the sole Google-sheet equipment importer entrypoint;
- registry coverage includes gear and material sheets formerly handled by PowerShell;
- the parser regression maps `1/4 фнт` to `0.25`;
- the generated output path list includes all six runtime sources;
- neither deleted PowerShell path exists.

Run the test before deletion and confirm it fails on the final two assertions.

**Step 3: Delete only the two superseded scripts**

Use `apply_patch` to delete `tools/import-gear.ps1` and `tools/import-materials.ps1`. Do not delete `tools/import-xlsx.ps1`, the ignored credentials file, unrelated economy import tooling, or current user data.

Update README/passport to remove the old commands and describe the Node importer as the single owner. Remove obsolete passport method entries and retain the current-state data flow only.

**Step 4: Run focused verification**

```powershell
node --test tests/equipment-import-*.test.mjs tests/gear-import-script.test.mjs tests/material-catalog-sync.test.mjs tests/gear-compendium.test.mjs tests/materials-compendium.test.mjs tests/implants-catalog.test.mjs tests/transport-compendium.test.mjs tests/magic-items-compendium.test.mjs tests/main-composition-root.test.mjs
```

Expected: all focused tests pass.

**Step 5: Run the mandatory full verification once on the final HEAD**

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: zero failed tests; every tracked JS/MJS file passes syntax checking; every tracked JSON file parses; `git diff --check` is clean. The pre-existing PowerShell `Get-FileHash` failure must be gone because its obsolete importer test has been replaced by Node behavior coverage.

**Step 6: Inspect the final change set and checkpoint**

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff
git add tools/import-gear.ps1 tools/import-materials.ps1 tests/gear-import-script.test.mjs README.md docs/function-passport.md
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "refactor: retire legacy equipment importers"
git push -u origin lich_branch
git status --short --branch
```

Expected final state: clean `lich_branch`, synchronized with `origin/lich_branch`; only `tools/import-equipment.mjs` is the equipment/magic-item importer; a fresh dry-run reports zero diff; all runtime compendium services still initialize through the existing `scripts/main.js` composition root.

## Definition of done

- The Google Sheets API is the only external source path for the primary equipment spreadsheet, with fixture snapshots available for deterministic tests.
- One command dry-runs or atomically applies the complete equipment + magic-items bundle.
- The source string `1/4 фнт` becomes the numeric weight `0.25`, and malformed mixed types fail instead of being guessed.
- Weapon, firearm, armor, ammunition, explosive, attachment, upgrade, material, implant, transport, and magic-item data is synchronized into the existing runtime files.
- Stable IDs and approved manual Foundry enrichment survive repeated imports through the tracked override file.
- Invalid source data, dangling references, duplicates, removals, large diffs, catastrophic losses, and identity churn are guarded as specified.
- A post-apply live dry-run is byte/semantic idempotent and reports zero changes.
- The two superseded PowerShell importers are gone; the separate economy XLSX importer remains.
- Focused and full test suites pass, syntax/JSON validation passes, README/passport are current, and every task commit is pushed to `origin/lich_branch`.

---
