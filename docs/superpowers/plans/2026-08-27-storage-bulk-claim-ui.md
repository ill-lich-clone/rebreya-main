# Storage Bulk Claim UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken inline storage bulk controls with one guarded bottom action that opens a standard Foundry destination dialog and delegates to the existing bulk claim transaction.

**Architecture:** `StorageApp` remains the sole presentation owner. A pure exported dialog helper maps Foundry `DialogV2.wait()` output to `"self" | "party" | null`; the app owns one pending guard spanning dialog and claim, while the template and storage CSS render a separate rounded bottom control.

**Tech Stack:** Foundry VTT 13 ApplicationV2/DialogV2, Handlebars, CSS, Node.js test runner.

**Spec:** `docs/superpowers/specs/2026-08-27-storage-bulk-claim-ui-design.md`

## Global Constraints

- Foundry VTT 13 and the current dnd5e/statuscounter requirements remain unchanged.
- Do not change claim payloads, authorization, inventory ingress, recovery, refresh coordination, or ground-pile deletion.
- `claimStorageAll(tokenUuid, destination, mutationId, request)` remains the only authoritative bulk mutation entrypoint.
- UI must not write world settings or storage flags.
- New or changed methods must be recorded in section 8 of `docs/function-passport.md` in the implementation commit.
- Preserve UTF-8 Russian copy exactly: `Забрать всё`, `Забрать всё себе`, `Забрать в инвентарь`.

---

### Task 1: Guarded bottom bulk-claim action

**Files:**
- Modify: `tests/storage-app.test.mjs:20-187`
- Modify: `scripts/ui/storage-app.js:13-107, 220-255, 422-428, 470-542`
- Modify: `templates/storage-app.hbs:74-114`
- Modify: `styles/main.css:13030-13129, 13375-13423`
- Modify: `docs/function-passport.md:179`

**Interfaces:**
- Consumes: existing `moduleApi.claimStorageAll(tokenUuid, destination, mutationId, request)` and `StorageApp.#pathRequest()`.
- Produces: `promptStorageClaimAllDestination(DialogV2?) -> Promise<"self" | "party" | null>`; context field `claimAllPending:boolean`; template action `storage-claim-all`.

- [x] **Step 1: Replace the old template assertions and add failing dialog/pending tests**

Extend the fake Foundry API with an injectable `DialogV2.wait`, import the exported helper, and replace the current direct-party bulk test with assertions equivalent to:

```js
assert.doesNotMatch(template, />Залутать всё/u);
assert.doesNotMatch(template, /storage-claim-all-(?:self|party)/u);
assert.match(template, /data-action="storage-claim-all"/u);
assert.match(template, />Забрать всё</u);
assert.match(template, /\{\{#if hasGridItems\}\}[\s\S]*\{\{\/if\}\}[\s\S]*\{\{#if canClaimAll\}\}[\s\S]*data-action="storage-claim-all"/u);

const selections = [];
globalThis.foundry.applications.api.DialogV2.wait = async (config) => {
  selections.push(config);
  return config.buttons[1].callback();
};
assert.equal(await promptStorageClaimAllDestination(), "party");
assert.equal(selections[0].buttons[0].label, "Забрать всё себе");
assert.equal(selections[0].buttons[1].label, "Забрать в инвентарь");
assert.equal(selections[0].buttons[2].label, "Отмена");
```

Add click-level coverage where `DialogV2.wait()` returns `null`, `"self"`, and `"party"`; assert zero/one exact `bulkClaimCalls`. Hold the first `claimStorageAll` promise unresolved, click twice, and assert the second click does not open another dialog or dispatch another claim. Assert `_prepareContext().claimAllPending` becomes true while pending and false after resolution. Preserve the existing Journal-only and `sourceDeleted` assertions.

- [x] **Step 2: Run the focused test and verify the new assertions fail**

Run:

```powershell
node --test tests/storage-app.test.mjs
```

Expected: failure because `promptStorageClaimAllDestination`, `storage-claim-all`, and `claimAllPending` do not exist and the old template still contains the inline controls.

- [x] **Step 3: Add the standard dialog helper and pending state**

At module scope in `scripts/ui/storage-app.js`, add:

```js
export async function promptStorageClaimAllDestination(
  DialogV2 = globalThis.foundry?.applications?.api?.DialogV2
) {
  if (typeof DialogV2?.wait !== "function") {
    throw new Error("Диалог выбора назначения добычи недоступен.");
  }
  const destination = await DialogV2.wait({
    window: { title: "Забрать всё" },
    content: "<p>Куда перенести содержимое хранилища?</p>",
    buttons: [
      { action: "self", label: "Забрать всё себе", icon: "fa-solid fa-user", default: true, callback: () => "self" },
      { action: "party", label: "Забрать в инвентарь", icon: "fa-solid fa-box-open", callback: () => "party" },
      { action: "cancel", label: "Отмена", callback: () => null }
    ],
    rejectClose: false,
    close: () => null
  });
  return destination === "self" || destination === "party" ? destination : null;
}
```

Initialize `this.claimAllPending = false` in the constructor, expose it as `claimAllPending` from `_prepareContext()`, and replace the two direct click branches with one guarded route:

```js
async #promptAndClaimAll() {
  if (this.claimAllPending) return null;
  this.claimAllPending = true;
  await this.#renderCurrent();
  let result = null;
  try {
    const destination = await promptStorageClaimAllDestination();
    if (!destination) return null;
    result = await this.#claimAll(destination);
    return result;
  }
  finally {
    this.claimAllPending = false;
    if (!result) await this.#renderCurrent();
  }
}
```

The click branch calls the helper, returns immediately on cancellation, retains `sourceDeleted` close behavior, and otherwise continues through the existing single snapshot refresh path. The `finally` render is presentation-only and occurs only for cancellation, a falsey stale result, or an error so the disabled control is restored without requesting a snapshot.

- [x] **Step 4: Replace the template strip and add storage-specific styling**

Remove the old lines containing `rm-storage-item__actions rm-storage-claim-all`. After the grid block, render:

```hbs
{{#if canClaimAll}}
  <div class="rm-storage-claim-all-footer">
    <button
      type="button"
      class="rm-button rm-button--primary rm-storage-claim-all-button"
      data-action="storage-claim-all"
      {{#if claimAllPending}}disabled{{/if}}
    >
      <i class="fa-solid fa-hand" aria-hidden="true"></i>
      <span>Забрать всё</span>
    </button>
  </div>
{{/if}}
```

Add storage-scoped CSS:

```css
.rm-storage-claim-all-footer {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.rm-storage-claim-all-button {
  width: 100%;
  min-height: 38px;
  justify-content: center;
  border-radius: var(--rm-ui-section-radius);
}
```

Do not place the footer inside `.rm-storage-grid` or reuse `.rm-storage-item__actions`.

- [x] **Step 5: Run focused tests and fix only owner-scope failures**

Run:

```powershell
node --test tests/storage-app.test.mjs
```

Expected: all storage-app tests pass, including cancellation, both destinations, pending duplicate suppression, Journal-only visibility, and final-pile close behavior.

- [x] **Step 6: Update the function passport**

In storage section 8, replace the old bulk-control description with the new bottom-button/DialogV2 flow and document `promptStorageClaimAllDestination()` plus the app-local pending guard. State explicitly that authoritative `claimStorageAll()` and destination values are unchanged.

- [x] **Step 7: Run project verification**

Run:

```powershell
node --test tests/*.test.mjs
git diff --check

$files = git ls-files '*.js' '*.mjs'
foreach ($file in $files) { node --check $file }

$json = git ls-files '*.json'
foreach ($file in $json) { Get-Content -Raw -Encoding UTF8 $file | ConvertFrom-Json | Out-Null }
```

Expected: 0 failed tests, 0 syntax failures, 0 JSON failures, and no whitespace errors.

- [x] **Step 8: Review, commit, and push only this feature**

Run:

```powershell
git diff --stat
git diff -- scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs docs/function-passport.md
git add -- scripts/ui/storage-app.js templates/storage-app.hbs styles/main.css tests/storage-app.test.mjs docs/function-passport.md docs/superpowers/plans/2026-08-27-storage-bulk-claim-ui.md
git commit -m "fix(storage): replace broken bulk claim controls"
git push -u origin lich_branch
```

Expected: one focused implementation commit on `lich_branch`; no unrelated files staged.
