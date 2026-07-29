# Party Inventory Workshop Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the party inventory skyline with a purpose-built working steampunk workshop, add a persistent editable group crest, neutralize cargo and energy styling, and lower the external tab rail.

**Architecture:** Keep inventory data and actions in the existing `InventoryApp`, but isolate crest path resolution and Foundry file-picker integration in a small UI helper. The Handlebars template receives a prepared `partyIdentity` object and remains presentation-only; scoped CSS owns the balance, neutral meter treatment, artwork, and lower tab offset.

**Tech Stack:** Foundry VTT 13 ApplicationV2, JavaScript ES modules, Handlebars, scoped CSS, Node's built-in test runner, built-in image generation, ImageMagick WebP conversion.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Run `git fetch origin` and verify the branch, worktree, and `origin/main` ancestry before implementation and before final push.
- Stop if unrelated uncommitted changes appear or `origin/main` is no longer an ancestor of the working branch.
- Do not force-push.
- Store the finished workshop asset at `assets/ui/rebreya-party-inventory-workshop.webp`.
- Do not modify or overwrite `assets/ui/rebreya-character-header.webp`.
- The artwork must depict a dirty, actively used steampunk workshop/warehouse with a comparatively light exposure and color grade.
- Artwork requirements: workbench, shelves, crates, tools, loose loot, weapon racks, at least one firearm, several fuel canisters, no people, no text, no logos, and no watermark.
- Strong artwork detail belongs in the center and lower third; the left identity and right controls need quieter backing areas.
- The crest path is stored on the active group Actor under `flags.rebreya-main.partyInventoryCrest`.
- Only the existing `canManage` audience may edit the crest.
- Cargo and energy must not use green, yellow, or red header card/meter styling.
- The external tabs remain outside the page and must begin at the bottom boundary of the supply row.
- Preserve all inventory calculations, permissions, actions, tooltip data, drag/drop, scrolling, and other tab contents.

---

### Task 1: Generate and integrate the workshop artwork

**Files:**
- Create: `assets/ui/rebreya-party-inventory-workshop.webp`
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `styles/main.css`

**Interfaces:**
- Consumes: the approved art direction from `docs/superpowers/specs/2026-07-29-party-inventory-workshop-header-design.md`.
- Produces: `--rm-party-inventory-header-image: url("../assets/ui/rebreya-party-inventory-workshop.webp")`, consumed by the inventory header pseudo-element.

- [ ] **Step 1: Write the failing asset and CSS contract test**

Add a test beside the current header artwork contract:

```js
test("InventoryApp uses its own workshop artwork without changing the character header", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  const workshopAsset = await stat(new URL(
    "../assets/ui/rebreya-party-inventory-workshop.webp",
    import.meta.url
  ));

  assert.ok(workshopAsset.size > 0);
  assert.match(
    css,
    /--rm-party-inventory-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-party-inventory-workshop\.webp"\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header::before\s*\{[^}]*var\(--rm-party-inventory-header-image\)/u
  );
  assert.match(
    css,
    /--rm-character-sheet-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-character-header\.webp"\);/u
  );
});
```

Extend the test import to include `stat` from `node:fs/promises`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="own workshop artwork" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the workshop asset and CSS custom property do not exist.

- [ ] **Step 3: Generate the image with the built-in image tool**

Use this production prompt:

```text
Use case: stylized-concept
Asset type: ultra-wide Foundry VTT party inventory header artwork
Primary request: a dirty, actively used steampunk workshop that doubles as an adventuring party warehouse
Scene/backdrop: worn brick and timber workshop interior with aged metal framing, a workbench, shelves, crates, hand tools, loose loot, weapon racks, one clearly recognizable firearm, and several fuel canisters
Style/medium: highly detailed grounded fantasy-steampunk concept art, believable materials, no glossy sci-fi
Composition/framing: cinematic wide banner; strongest recognizable objects in the center and lower third; quieter low-detail zones on the left and right for UI overlays; no important subject cropped at the lower edge
Lighting/mood: readable daylight from workshop windows mixed with warm practical lamps; dirty and lived-in, but with lifted shadow detail and a light neutral color grade
Color palette: muted brass, warm timber, dusty stone, desaturated steel, restrained fuel-can red; no heavy orange filter
Materials/textures: soot, oil stains, dust, scratches, worn leather, tarnished brass, chipped wood
Constraints: no people, no characters, no text, no signs, no logo, no UI, no watermark
Avoid: crushed blacks, dark industrial skyline, cyberpunk neon, pristine showroom, excessive clutter behind the left and right UI zones
```

Generate one asset. Inspect it at original detail. If composition or exposure misses the approved direction, make one targeted regeneration rather than broadening the prompt.

- [ ] **Step 4: Crop and convert the selected image**

Use ImageMagick to inspect dimensions:

Copy the absolute `output_hint` path returned by the immediately preceding
imagegen call into the task-scoped PowerShell variable
`$generatedImagePath`, then run:

```powershell
magick identify $generatedImagePath
```

Crop a wide region that preserves the central/lower workshop detail and quiet side zones, then convert to WebP:

```powershell
magick $generatedImagePath -gravity center -crop 1536x560+0+0 +repage -resize 1920x700^ -gravity center -extent 1920x700 -quality 88 "assets/ui/rebreya-party-inventory-workshop.webp"
```

Adjust only the crop offset if visual inspection shows a stronger valid framing. Do not alter hue or add a dark overlay after generation.

- [ ] **Step 5: Wire the dedicated CSS variable**

Near the existing character-sheet asset variable, add:

```css
:root {
  --rm-party-inventory-header-image:
    url("../assets/ui/rebreya-party-inventory-workshop.webp");
}
```

Change only the party inventory header image source:

```css
.rebreya-inventory-app .rm-inventory-book__header::before {
  background-image: var(--rm-party-inventory-header-image);
}
```

Keep the character-sheet variable and its consumers unchanged.

- [ ] **Step 6: Run the focused test and inspect the asset**

Run:

```powershell
node --test --test-name-pattern="own workshop artwork" tests/inventory-app-context.test.mjs
magick identify "assets/ui/rebreya-party-inventory-workshop.webp"
```

Expected: test PASS; asset reports WebP format and non-zero wide dimensions.

- [ ] **Step 7: Commit the asset integration**

```powershell
git add -- assets/ui/rebreya-party-inventory-workshop.webp styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: add party inventory workshop artwork"
```

---

### Task 2: Add persistent editable group crest behavior

**Files:**
- Create: `scripts/ui/party-inventory-crest.js`
- Create: `tests/party-inventory-crest.test.mjs`
- Modify: `scripts/ui/inventory-app.js`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Produces: `PARTY_INVENTORY_CREST_FLAG`, `resolvePartyInventoryCrest(actor)`, and `openPartyInventoryCrestPicker(options)` from `scripts/ui/party-inventory-crest.js`.
- Consumes in `InventoryApp`: `resolvePartyInventoryCrest(groupActor)` while preparing context and `openPartyInventoryCrestPicker({ actor, current, onSelected, onError })` from the crest action listener.
- Produces template context:

```js
partyIdentity: {
  name: string,
  crestUrl: string,
  canEditCrest: boolean
}
```

- [ ] **Step 1: Write failing helper tests**

Create `tests/party-inventory-crest.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  PARTY_INVENTORY_CREST_FLAG,
  resolvePartyInventoryCrest,
  openPartyInventoryCrestPicker
} from "../scripts/ui/party-inventory-crest.js";

test("resolvePartyInventoryCrest prefers the dedicated flag then Actor image", () => {
  const actor = {
    img: "actor.webp",
    getFlag(scope, key) {
      assert.equal(scope, "rebreya-main");
      assert.equal(key, PARTY_INVENTORY_CREST_FLAG);
      return "crest.webp";
    }
  };

  assert.equal(resolvePartyInventoryCrest(actor), "crest.webp");
  actor.getFlag = () => "";
  assert.equal(resolvePartyInventoryCrest(actor), "actor.webp");
  assert.equal(resolvePartyInventoryCrest(null), "icons/svg/mystery-man.svg");
});

test("openPartyInventoryCrestPicker uses the modern picker and persists selection", async () => {
  const calls = [];
  class Picker {
    constructor(options) {
      this.options = options;
      calls.push(["construct", options.type, options.current]);
    }

    render(force) {
      calls.push(["render", force]);
      return this;
    }
  }

  const actor = {
    async setFlag(scope, key, value) {
      calls.push(["setFlag", scope, key, value]);
    }
  };

  const picker = openPartyInventoryCrestPicker({
    actor,
    current: "old.webp",
    pickerClass: Picker
  });
  await picker.options.callback("new.webp");

  assert.deepEqual(calls, [
    ["construct", "image", "old.webp"],
    ["render", { force: true }],
    ["setFlag", "rebreya-main", PARTY_INVENTORY_CREST_FLAG, "new.webp"]
  ]);
});

test("openPartyInventoryCrestPicker leaves the crest unchanged on cancellation", () => {
  let persisted = false;
  class Picker {
    constructor(options) {
      this.options = options;
    }
    render() {
      return this;
    }
  }

  openPartyInventoryCrestPicker({
    actor: { setFlag: async () => { persisted = true; } },
    current: "old.webp",
    pickerClass: Picker
  });

  assert.equal(persisted, false);
});

test("openPartyInventoryCrestPicker reports persistence failure without replacing the crest", async () => {
  const failure = new Error("write failed");
  const reported = [];
  class Picker {
    constructor(options) {
      this.options = options;
    }
    render() {
      return this;
    }
  }

  const picker = openPartyInventoryCrestPicker({
    actor: {
      async setFlag() {
        throw failure;
      }
    },
    current: "old.webp",
    pickerClass: Picker,
    onError: (error) => reported.push(error)
  });
  await picker.options.callback("new.webp");

  assert.deepEqual(reported, [failure]);
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```powershell
node --test tests/party-inventory-crest.test.mjs
```

Expected: FAIL because `scripts/ui/party-inventory-crest.js` does not exist.

- [ ] **Step 3: Implement the focused crest helper**

Create `scripts/ui/party-inventory-crest.js`:

```js
import { MODULE_ID } from "../constants.js";

export const PARTY_INVENTORY_CREST_FLAG = "partyInventoryCrest";
export const DEFAULT_PARTY_INVENTORY_CREST = "icons/svg/mystery-man.svg";

function cleanPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePartyInventoryCrest(actor) {
  const stored = cleanPath(actor?.getFlag?.(MODULE_ID, PARTY_INVENTORY_CREST_FLAG))
    || cleanPath(actor?.flags?.[MODULE_ID]?.[PARTY_INVENTORY_CREST_FLAG]);
  return stored || cleanPath(actor?.img) || DEFAULT_PARTY_INVENTORY_CREST;
}

export function openPartyInventoryCrestPicker({
  actor,
  current,
  pickerClass = globalThis.foundry?.applications?.apps?.FilePicker?.implementation
    ?? globalThis.FilePicker,
  onSelected = null,
  onError = null
} = {}) {
  if (!actor || typeof actor.setFlag !== "function") {
    throw new Error("Active group Actor is unavailable.");
  }
  if (typeof pickerClass !== "function") {
    throw new Error("Foundry image picker is unavailable.");
  }

  const picker = new pickerClass({
    type: "image",
    current: cleanPath(current),
    callback: async (path) => {
      const selected = cleanPath(path);
      if (!selected) return;
      try {
        await actor.setFlag(MODULE_ID, PARTY_INVENTORY_CREST_FLAG, selected);
        await onSelected?.(selected);
      }
      catch (error) {
        onError?.(error);
      }
    }
  });
  void picker.render({ force: true });
  return picker;
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run:

```powershell
node --test tests/party-inventory-crest.test.mjs
```

Expected: 4 tests PASS.

- [ ] **Step 5: Write failing InventoryApp context and binding tests**

Extend `tests/inventory-app-context.test.mjs` with:

```js
test("InventoryApp exposes the active group crest and edit permission", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const groupActor = {
    id: "group-a",
    name: "Workshop Crew",
    img: "group.webp",
    flags: { "rebreya-main": { partyInventoryCrest: "crest.webp" } },
    getFlag: () => "crest.webp",
    system: { members: [] }
  };
  const { InventoryApp } = await import(
    `../scripts/ui/inventory-app.js?crest-context=${Date.now()}`
  );
  const app = new InventoryApp(createModuleApi({
    getGroupContext: () => ({ groupActor, groupId: "group-a", memberActorIds: [] }),
    partySnapshot: { canManage: true }
  }));

  try {
    const context = await app._prepareContext();
    assert.deepEqual(context.partyIdentity, {
      name: "Workshop Crew",
      crestUrl: "crest.webp",
      canEditCrest: true
    });
  }
  finally {
    restoreFoundry();
  }
});
```

Add an `_onRender` interaction test that supplies a fake
`[data-action='edit-party-crest']` button, stubs the modern picker
implementation, triggers its click listener, invokes the picker callback, and
asserts:

```js
assert.deepEqual(flagWrites, [
  ["rebreya-main", "partyInventoryCrest", "new-crest.webp"]
]);
assert.equal(renderCalls, 1);
```

Also create a non-manager context and assert `partyIdentity.canEditCrest` is
`false`.

- [ ] **Step 6: Run the InventoryApp crest tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="crest" tests/inventory-app-context.test.mjs
```

Expected: FAIL because `partyIdentity`, the stored group Actor reference, and
the action binding do not exist.

- [ ] **Step 7: Integrate the crest helper into InventoryApp**

At the top of `scripts/ui/inventory-app.js`, import:

```js
import {
  openPartyInventoryCrestPicker,
  resolvePartyInventoryCrest
} from "./party-inventory-crest.js";
```

In the constructor, add:

```js
this.groupActor = null;
```

At the start of `_prepareContext`, clear it:

```js
this.groupActor = null;
```

When the group context resolves, store `groupActor` and include its crest:

```js
this.groupActor = groupActor;
group = {
  id: groupContext.groupId ?? groupActor.id ?? "",
  name: groupActor.name ?? "Группа",
  crestUrl: resolvePartyInventoryCrest(groupActor),
  memberCount: /* existing calculation */
};
```

After `canManage` is known, return:

```js
partyIdentity: {
  name: group?.name ?? inventorySnapshot.actor?.name ?? "Партийный инвентарь",
  crestUrl: group?.crestUrl
    ?? resolvePartyInventoryCrest(inventorySnapshot.actor),
  canEditCrest: Boolean(canManage && this.groupActor)
},
```

Bind the action in `_onRender` before the existing sheet/food/water actions:

```js
element.querySelector("[data-action='edit-party-crest']")
  ?.addEventListener("click", () => {
    try {
      openPartyInventoryCrestPicker({
        actor: this.groupActor,
        current: resolvePartyInventoryCrest(this.groupActor),
        onSelected: async () => {
          await this.render({ force: true });
        },
        onError: (error) => {
          console.error(`${MODULE_ID} | Failed to update party inventory crest.`, error);
          ui.notifications?.error("Не удалось сохранить герб группы.");
        }
      });
    }
    catch (error) {
      console.error(`${MODULE_ID} | Failed to open party inventory crest picker.`, error);
      ui.notifications?.error("Не удалось открыть выбор герба группы.");
    }
  }, listenerOptions);
```

- [ ] **Step 8: Run crest unit and context tests**

Run:

```powershell
node --test tests/party-inventory-crest.test.mjs
node --test --test-name-pattern="crest" tests/inventory-app-context.test.mjs
```

Expected: all crest tests PASS.

- [ ] **Step 9: Commit crest behavior**

```powershell
git add -- scripts/ui/party-inventory-crest.js scripts/ui/inventory-app.js tests/party-inventory-crest.test.mjs tests/inventory-app-context.test.mjs
git commit -m "feat: add editable party inventory crest"
```

---

### Task 3: Rebalance the header, neutralize status colors, and lower tabs

**Files:**
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `partyIdentity.name`, `partyIdentity.crestUrl`, and
  `partyIdentity.canEditCrest` from Task 2.
- Preserves: every existing `data-action` except the added
  `edit-party-crest`; resource values and cargo tooltip fields remain
  unchanged.

- [ ] **Step 1: Write failing template and CSS contract tests**

Extend the current compact-header contract:

```js
assert.match(template, /class="rm-inventory-book__identity"/u);
assert.match(template, /partyIdentity\.crestUrl/u);
assert.match(template, /partyIdentity\.name/u);
assert.match(
  template,
  /\{\{#if partyIdentity\.canEditCrest\}\}[\s\S]*data-action="edit-party-crest"[\s\S]*\{\{else\}\}/u
);
assert.doesNotMatch(
  template,
  /class="rm-inventory-book__cargo \{\{party\.dashboard\.weight\.className\}\}"/u
);
assert.doesNotMatch(
  template,
  /class="rm-inventory-book__supply \{\{party\.dashboard\.energy\.className\}\}"/u
);
assert.doesNotMatch(
  template,
  /rm-inventory-book__cargo-fill \{\{party\.dashboard\.weight\.meterClass\}\}/u
);
```

Extend the CSS contract:

```js
assert.match(css, /\.rm-inventory-book__identity\s*\{[^}]*display:\s*flex;/u);
assert.match(css, /\.rm-inventory-book__crest-button\s*\{/u);
assert.match(css, /\.rm-inventory-book__crest-image\s*\{/u);
assert.match(
  css,
  /\.rebreya-inventory-app \.rm-inventory-book__cargo-fill\s*\{[^}]*background:\s*var\(--rm-inventory-meter-neutral\);/u
);
assert.doesNotMatch(css, /\.rm-inventory-book__cargo-fill\.is-warning/u);
assert.doesNotMatch(css, /\.rm-inventory-book__cargo-fill\.is-danger/u);
assert.match(
  css,
  /\.rebreya-inventory-app \.rm-inventory-book__tabs\s*\{[^}]*top:\s*16[0-9]px;/u
);
```

- [ ] **Step 2: Run the layout contract tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="compact header summary|external book tabs" tests/inventory-app-context.test.mjs
```

Expected: FAIL on missing identity/crest markup, colored state classes, neutral
meter token, and lower tab offset.

- [ ] **Step 3: Replace the title-only heading with the identity component**

In `templates/inventory-app.hbs`, replace the current heading block with:

```hbs
<div class="rm-inventory-book__identity">
  {{#if partyIdentity.canEditCrest}}
    <button
      type="button"
      class="rm-inventory-book__crest-button"
      data-action="edit-party-crest"
      title="Изменить герб группы"
      aria-label="Изменить герб группы"
    >
      <img
        class="rm-inventory-book__crest-image"
        src="{{partyIdentity.crestUrl}}"
        alt=""
      >
      <span class="rm-inventory-book__crest-edit" aria-hidden="true">
        <i class="fa-solid fa-pen"></i>
      </span>
    </button>
  {{else}}
    <span class="rm-inventory-book__crest">
      <img
        class="rm-inventory-book__crest-image"
        src="{{partyIdentity.crestUrl}}"
        alt=""
      >
    </span>
  {{/if}}

  <div class="rm-inventory-book__heading">
    <h2 class="rm-inventory-book__title">{{partyIdentity.name}}</h2>
  </div>
</div>
```

Remove only the cargo and energy state class interpolations:

```hbs
<article class="rm-inventory-book__cargo">
<div class="rm-inventory-book__cargo-fill" style="width: {{party.dashboard.weight.meterPercent}}%;"></div>
<article class="rm-inventory-book__supply">
  <span>Энергия</span>
```

Keep food and water behavior and all values unchanged.

- [ ] **Step 4: Implement the balanced identity and neutral status CSS**

Add scoped tokens:

```css
.rebreya-inventory-app {
  --rm-inventory-meter-neutral: #c3beb2;
}
```

Build the left identity:

```css
.rebreya-inventory-app .rm-inventory-book__identity {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  max-width: 48%;
}

.rebreya-inventory-app .rm-inventory-book__crest,
.rebreya-inventory-app .rm-inventory-book__crest-button {
  position: relative;
  display: grid;
  flex: 0 0 104px;
  width: 104px;
  height: 104px;
  place-items: center;
  padding: 0;
  border: 2px solid rgb(var(--rm-color-gold-rgb) / 0.72);
  border-radius: 50%;
  background: rgb(var(--rm-color-surface-rgb) / 0.82);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.38);
  overflow: visible;
}

.rebreya-inventory-app .rm-inventory-book__crest-image {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  object-fit: cover;
}
```

Add the pencil badge, hover, and keyboard focus treatment without tinting the
entire artwork.

Neutralize the meter:

```css
.rebreya-inventory-app .rm-inventory-book__cargo-fill {
  background: var(--rm-inventory-meter-neutral);
}
```

Delete the header-scoped `.cargo-fill.is-warning` and `.cargo-fill.is-danger`
rules. Ensure cargo and energy inherit the same neutral base background/border
as the other summary cards.

- [ ] **Step 5: Lower the external tabs**

Change the scoped rail offset:

```css
.rebreya-inventory-app .rm-inventory-book__tabs {
  top: 168px;
}
```

Keep `position: absolute`, `right: -104px`, the active extension, and overflow
rules unchanged. The live Foundry pass may adjust this by a few pixels only to
align exactly with the computed bottom of the supply row.

- [ ] **Step 6: Run the focused layout tests and inventory regression set**

Run:

```powershell
node --test --test-name-pattern="compact header summary|external book tabs" tests/inventory-app-context.test.mjs
node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/group-inventory-migration.test.mjs tests/party-inventory-crest.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the visual rebalance**

```powershell
git add -- templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: rebalance party inventory header"
```

---

### Task 4: Live Foundry QA, review, and publication

**Files:**
- Modify only if QA exposes a reproducible issue:
  `styles/main.css`, `templates/inventory-app.hbs`,
  `scripts/ui/inventory-app.js`, `scripts/ui/party-inventory-crest.js`, and
  their matching tests.

**Interfaces:**
- Consumes: the complete workshop asset, crest flow, and header layout from
  Tasks 1-3.
- Produces: a verified `lich_branch` synchronized to `origin/lich_branch`.

- [ ] **Step 1: Run one read-only Terra review**

Ask a `gpt-5.6-terra` reviewer to inspect the complete diff for:

- Foundry V13 file-picker compatibility;
- permission or Actor persistence mistakes;
- crest cancellation/error behavior;
- Handlebars context mismatches;
- external-tab clipping or layout regressions;
- accidental status-color retention.

The reviewer does not edit files. Validate every reported issue locally before
changing code.

- [ ] **Step 2: Test in Foundry with the CODEX profile**

Open `http://localhost:30000/`, select `CODEX`, enter password `666`, and open
the Rebreya inventory.

Verify:

1. the new workshop asset is bright enough to read while remaining dirty;
2. firearm and fuel canisters are visible without becoming the focal point;
3. no extra dark overlay is applied;
4. crest plus title visually balances the complete right control stack;
5. cargo and energy are neutral;
6. the first tab top aligns with the supply-row bottom;
7. tabs remain outside the window and do not change its width;
8. the cargo tooltip still appears on hover and keyboard focus;
9. the crest picker opens only for a manager and persists a chosen image;
10. cancelling the picker changes nothing;
11. inventory actions, tab switching, and page scrolling still work.

Inspect page geometry and computed styles, take screenshots, and check browser
error logs. Existing unrelated Foundry deprecation warnings are not failures;
new error-level messages from this feature are.

- [ ] **Step 3: Fix only verified QA defects with a failing test first**

For each reproducible issue, add the smallest failing regression test to
`tests/inventory-app-context.test.mjs` or
`tests/party-inventory-crest.test.mjs`, run it RED, implement the fix, and run
it GREEN.

- [ ] **Step 4: Run fresh final verification**

Run:

```powershell
node --test
git diff --check
git status --short --branch
```

Expected: all tests PASS, `git diff --check` exits 0, and only intentional
feature files are modified.

- [ ] **Step 5: Commit any QA fixes**

If QA required code changes:

```powershell
git add -- scripts/ui/inventory-app.js scripts/ui/party-inventory-crest.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs tests/party-inventory-crest.test.mjs assets/ui/rebreya-party-inventory-workshop.webp
git commit -m "fix: polish party inventory workshop header"
```

Do not create an empty commit.

- [ ] **Step 6: Re-fetch and verify the integration boundary**

Run:

```powershell
git fetch origin
git branch --show-current
git merge-base --is-ancestor origin/main HEAD
git status --short
```

Expected: branch is `lich_branch`, `origin/main` is an ancestor, and the
worktree is clean. Stop on divergence or unrelated changes.

- [ ] **Step 7: Push without force**

Run:

```powershell
git push origin lich_branch
```

Then verify:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/lich_branch
```

Expected: clean synchronized branch and identical local/remote commit hashes.
