# Inventory and Transport Header Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add slow Ken Burns-style CSS motion to the Inventory header and a new classic steam-train header with matching motion to the Transport tab.

**Architecture:** The shared inventory header receives explicit Inventory and Transport modifier classes. Each modifier drives pseudo-element artwork and compositor-friendly `transform`/`opacity` keyframes; Travel retains its separate five-layer parallax. One generated `1920 x 700` WebP supplies the Transport scene, while the existing workshop WebP remains the Inventory source.

**Tech Stack:** Foundry VTT Handlebars templates, CSS animations, Node.js `node:test`, Python Pillow for deterministic WebP preparation, built-in ImageGen, Git.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Fetch `origin` and verify `origin/lich_branch` has no commits ahead before every push.
- Preserve and never stage the user's concurrent Lootgen/storage working-tree changes.
- Keep the header at exactly 300 px and preserve current identity, wallet, controls, masks, colors, and stacking order.
- Inventory animation duration is 42 seconds; Transport animation duration is 48 seconds.
- Continuous motion is limited to `transform` and `opacity`; do not animate filters, masks, layout properties, or `background-position`.
- Disable every new animation under `@media (prefers-reduced-motion: reduce)`.
- Travel keeps the existing five-layer parallax; Party, Craft, Calendar, and Downtime keep the static workshop.
- The Transport asset is exactly `1920 x 700`, contains no people, text, watermark, electrical infrastructure, or modern equipment, and is stored as `assets/ui/rebreya-transport-steam-depot.webp`.
- Use `apply_patch` for text edits, meaningful commits, and a normal non-force push.

---

## File Structure

- Modify `templates/inventory-app.hbs`: emit Inventory and Transport header modifiers without changing Travel markup.
- Modify `styles/main.css`: declare the Transport asset and both tab-specific camera/overlay animations.
- Create `assets/ui/rebreya-transport-steam-depot.webp`: final project-bound locomotive artwork.
- Create `tools/prepare_transport_header.py`: reproducibly crop and encode one selected ImageGen source to `1920 x 700` WebP.
- Create `tests/inventory-header-motion.test.mjs`: validate the Transport asset and CSS animation contract.
- Modify `tests/inventory-app-context.test.mjs`: validate the shared header modifier routing while preserving Travel assertions.

---

### Task 1: Route Shared Header Artwork by Active Tab

**Files:**
- Modify: `templates/inventory-app.hbs:6`
- Modify: `tests/inventory-app-context.test.mjs:795-849`

**Interfaces:**
- Consumes: `tabs.isInventory`, `tabs.isTravel`, and `tabs.isTransport` from `InventoryApp._prepareContext()`.
- Produces: exactly one applicable modifier class on `.rm-inventory-book__header`, while Travel still renders `.rm-inventory-book__travel-parallax`.

- [ ] **Step 1: Change the header contract assertion so it fails against the current template**

Replace the existing opening-tag assertion in the five-layer Travel test and rename the test to include header routing:

```js
test("InventoryApp routes header artwork by tab and keeps one five-layer travel parallax", async () => {
  // Keep the current setup and all existing Travel assertions.
  assert.match(
    headerOpeningTag,
    /class="rm-inventory-book__header\{\{#if tabs\.isInventory\}\} rm-inventory-book__header--inventory\{\{\/if\}\}\{\{#if tabs\.isTravel\}\} rm-inventory-book__header--travel\{\{\/if\}\}\{\{#if tabs\.isTransport\}\} rm-inventory-book__header--transport\{\{\/if\}\}"/u
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="routes header artwork" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the header currently emits only `rm-inventory-book__header--travel`.

- [ ] **Step 3: Emit all three explicit modifiers in the shared header**

Change the template opening tag to:

```handlebars
<header class="rm-inventory-book__header{{#if tabs.isInventory}} rm-inventory-book__header--inventory{{/if}}{{#if tabs.isTravel}} rm-inventory-book__header--travel{{/if}}{{#if tabs.isTransport}} rm-inventory-book__header--transport{{/if}}">
```

Do not move or duplicate the existing `{{#if tabs.isTravel}}` parallax block.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="routes header artwork" tests/inventory-app-context.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit only the routing change**

```powershell
git add -- templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git commit -m "feat: route inventory header artwork by tab"
```

---

### Task 2: Generate and Validate the Classic Steam-Train Artwork

**Files:**
- Create: `assets/ui/rebreya-transport-steam-depot.webp`
- Create: `tools/prepare_transport_header.py`
- Create: `tests/inventory-header-motion.test.mjs`

**Interfaces:**
- Consumes: one selected opaque ImageGen source copied to `tmp/imagegen/inventory-transport-header/transport-source.png`.
- Produces: `python tools/prepare_transport_header.py --input tmp/imagegen/inventory-transport-header/transport-source.png --output assets/ui/rebreya-transport-steam-depot.webp` and a `1920 x 700` RGB WebP at the CSS-consumed path.

- [ ] **Step 1: Add the failing asset test**

Create `tests/inventory-header-motion.test.mjs` with:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

function readWebpDimensions(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.toString("ascii", 8, 12), "WEBP");

  for (let offset = 12; offset + 8 <= bytes.length;) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    if (chunkType === "VP8 ") {
      assert.equal(bytes[payloadOffset + 3], 0x9d);
      assert.equal(bytes[payloadOffset + 4], 0x01);
      assert.equal(bytes[payloadOffset + 5], 0x2a);
      return {
        width: bytes.readUInt16LE(payloadOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(payloadOffset + 8) & 0x3fff
      };
    }

    if (chunkType === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(payloadOffset + 4, 3),
        height: 1 + bytes.readUIntLE(payloadOffset + 7, 3)
      };
    }

    offset = payloadOffset + chunkSize + (chunkSize % 2);
  }

  throw new Error("Unsupported WebP file without VP8 or VP8X dimensions");
}

test("Transport header ships one production 1920x700 WebP", async () => {
  const assetUrl = new URL("../assets/ui/rebreya-transport-steam-depot.webp", import.meta.url);
  const [metadata, bytes] = await Promise.all([stat(assetUrl), readFile(assetUrl)]);

  assert.ok(metadata.size > 100_000, "transport header must contain production artwork");
  assert.deepEqual(readWebpDimensions(bytes), { width: 1920, height: 700 });
});
```

- [ ] **Step 2: Run the asset test and verify RED**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs
```

Expected: FAIL with `ENOENT` for `rebreya-transport-steam-depot.webp`.

- [ ] **Step 3: Generate one source image with the built-in ImageGen tool**

Use this final prompt in built-in mode:

```text
Use case: stylized-concept
Asset type: wide Foundry VTT party inventory header background
Primary request: a classic nineteenth-century steam locomotive standing inside a grand Victorian railway depot, viewed from a dramatic three-quarter angle
Scene/backdrop: dark brick-and-iron train shed, arched roof trusses, rails and restrained warm gas lamps
Subject: recognizable black aged-steel locomotive with a long boiler, large driving wheels, rivets, brass pipes and fittings, and a cab
Style/medium: cinematic slightly stylized concept art matching a dark Victorian steampunk workshop, detailed but not photorealistic
Composition/framing: very wide banner; quieter darker left third for title overlay; locomotive centered across the middle and lower-right; upper-right avoids critical details under UI controls; the train must remain recognizable after a shallow 1920x700 crop
Lighting/mood: warm amber lamps against cool graphite steel, restrained atmospheric steam, adventurous but grounded
Color palette: charcoal, dark iron, weathered brick, aged brass, muted amber
Constraints: no people, no text, no watermark, no electrical poles, no electrical wires, no modern equipment, no modern signs; no important subject touching the outer edges
```

Inspect the result. If the train is not immediately readable, the left third is busy, or forbidden content appears, issue one targeted ImageGen correction and inspect again. Copy the selected built-in output to `tmp/imagegen/inventory-transport-header/transport-source.png`.

- [ ] **Step 4: Add the deterministic preparation script**

Create `tools/prepare_transport_header.py`:

```python
from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageOps


def main() -> None:
    parser = ArgumentParser(description="Prepare the Transport header artwork.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    with Image.open(args.input) as source:
        rgb = source.convert("RGB")
        prepared = ImageOps.fit(
            rgb,
            (1920, 700),
            method=Image.Resampling.LANCZOS,
            centering=(0.52, 0.5)
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    prepared.save(args.output, format="WEBP", quality=90, method=6)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Prepare and visually inspect the project asset**

Run:

```powershell
python tools/prepare_transport_header.py --input tmp/imagegen/inventory-transport-header/transport-source.png --output assets/ui/rebreya-transport-steam-depot.webp
```

Inspect the final WebP at original detail. Confirm the train, quiet left third, unobstructed upper-right, crop, and forbidden-content constraints.

- [ ] **Step 6: Run the asset test and verify GREEN**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs
```

Expected: PASS with exact dimensions `{ width: 1920, height: 700 }`.

- [ ] **Step 7: Commit the selected art, preparation tool, and asset test**

```powershell
git add -- assets/ui/rebreya-transport-steam-depot.webp tools/prepare_transport_header.py tests/inventory-header-motion.test.mjs
git commit -m "assets: add classic steam depot transport header"
```

---

### Task 3: Implement Inventory and Transport Lazy CSS Motion

**Files:**
- Modify: `styles/main.css:1-45,4307-4450`
- Modify: `tests/inventory-header-motion.test.mjs`

**Interfaces:**
- Consumes: `rm-inventory-book__header--inventory`, `rm-inventory-book__header--transport`, the existing workshop WebP, and the new transport WebP.
- Produces: `rm-inventory-header-camera`, `rm-transport-header-camera`, `rm-inventory-header-light`, and `rm-transport-header-steam` keyframes plus reduced-motion overrides.

- [ ] **Step 1: Add failing CSS contract tests**

Append this test to `tests/inventory-header-motion.test.mjs`:

```js
test("Inventory and Transport headers use slow compositor-friendly CSS motion", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");

  assert.match(
    css,
    /--rm-transport-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-transport-steam-depot\.webp"\);/u
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--inventory::before\s*\{[^}]*animation:\s*rm-inventory-header-camera 42s ease-in-out infinite alternate;/su
  );
  assert.match(
    css,
    /\.rm-inventory-book__header--transport::before\s*\{[^}]*background-image:\s*var\(--rm-transport-header-image\);[^}]*animation:\s*rm-transport-header-camera 48s ease-in-out infinite alternate;/su
  );
  assert.match(css, /@keyframes rm-inventory-header-light/u);
  assert.match(css, /@keyframes rm-transport-header-steam/u);

  for (const animationName of [
    "rm-inventory-header-camera",
    "rm-transport-header-camera",
    "rm-inventory-header-light",
    "rm-transport-header-steam"
  ]) {
    const keyframes = css.match(new RegExp(`@keyframes ${animationName}\\s*\\{([\\s\\S]*?)\\n\\}`, "u"));
    assert.ok(keyframes, `expected ${animationName} keyframes`);
    assert.doesNotMatch(keyframes[1], /filter:|background-position:|(?:width|height|inset|top|right|bottom|left):/u);
  }

  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.rm-inventory-book__header--inventory::before,[\s\S]*?\.rm-inventory-book__header--transport::after\s*\{[^}]*animation:\s*none;[^}]*will-change:\s*auto;/u
  );
});
```

- [ ] **Step 2: Run the CSS test and verify RED**

Run:

```powershell
node --test --test-name-pattern="slow compositor-friendly" tests/inventory-header-motion.test.mjs
```

Expected: FAIL because the Transport variable and camera keyframes do not exist.

- [ ] **Step 3: Declare the Transport asset and tab-specific pseudo-elements**

Add the root variable next to `--rm-party-inventory-header-image`:

```css
--rm-transport-header-image: url("../assets/ui/rebreya-transport-steam-depot.webp");
```

Add these rules after the base header `::before` rule and before the Travel rules:

```css
.rebreya-inventory-app .rm-inventory-book__header--inventory::before,
.rebreya-inventory-app .rm-inventory-book__header--transport::before {
  inset: -10px;
  will-change: transform;
}

.rebreya-inventory-app .rm-inventory-book__header--inventory::before {
  transform-origin: 58% 48%;
  animation: rm-inventory-header-camera 42s ease-in-out infinite alternate;
}

.rebreya-inventory-app .rm-inventory-book__header--transport::before {
  background-image: var(--rm-transport-header-image);
  transform-origin: 56% 52%;
  animation: rm-transport-header-camera 48s ease-in-out infinite alternate;
}

.rebreya-inventory-app .rm-inventory-book__header--inventory::after,
.rebreya-inventory-app .rm-inventory-book__header--transport::after {
  content: "";
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

.rebreya-inventory-app .rm-inventory-book__header--inventory::after {
  background: radial-gradient(circle at 55% 48%, rgb(224 178 94 / 0.2), transparent 28%);
  animation: rm-inventory-header-light 16s ease-in-out infinite alternate;
}

.rebreya-inventory-app .rm-inventory-book__header--transport::after {
  background:
    radial-gradient(ellipse at 38% 72%, rgb(226 231 230 / 0.15), transparent 24%),
    radial-gradient(ellipse at 61% 50%, rgb(226 231 230 / 0.1), transparent 21%),
    radial-gradient(circle at 72% 30%, rgb(224 178 94 / 0.12), transparent 22%);
  animation: rm-transport-header-steam 18s ease-in-out infinite alternate;
}
```

- [ ] **Step 4: Add the four exact keyframe sequences**

```css
@keyframes rm-inventory-header-camera {
  from { transform: translate3d(-1%, 0, 0) scale(1.04); }
  to { transform: translate3d(1.2%, -1.2%, 0) scale(1.09); }
}

@keyframes rm-transport-header-camera {
  from { transform: translate3d(-1.8%, 0, 0) scale(1.03); }
  to { transform: translate3d(1.2%, -0.8%, 0) scale(1.085); }
}

@keyframes rm-inventory-header-light {
  from { opacity: 0.24; transform: translate3d(-0.4%, 0, 0) scale(1); }
  to { opacity: 0.38; transform: translate3d(0.6%, -0.4%, 0) scale(1.035); }
}

@keyframes rm-transport-header-steam {
  from { opacity: 0.1; transform: translate3d(-1%, 1.5%, 0) scale(1.01); }
  to { opacity: 0.22; transform: translate3d(1%, -2.5%, 0) scale(1.05); }
}
```

- [ ] **Step 5: Extend the reduced-motion media query**

Inside the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
.rebreya-inventory-app .rm-inventory-book__header--inventory::before,
.rebreya-inventory-app .rm-inventory-book__header--inventory::after,
.rebreya-inventory-app .rm-inventory-book__header--transport::before,
.rebreya-inventory-app .rm-inventory-book__header--transport::after {
  animation: none;
  transform: none;
  will-change: auto;
}
```

- [ ] **Step 6: Run focused header tests and verify GREEN**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the CSS motion**

```powershell
git add -- styles/main.css tests/inventory-header-motion.test.mjs
git commit -m "feat: animate inventory and transport headers"
```

---

### Task 4: Rendered QA and Regression Verification

**Files:**
- Modify only if QA finds a scoped defect: `styles/main.css`, `templates/inventory-app.hbs`, or `tests/inventory-header-motion.test.mjs`
- Save temporary QA screenshots outside the repository.

**Interfaces:**
- Consumes: production template structure, CSS, workshop art, and steam-depot art.
- Produces: visual evidence that both states fill the 300 px header and that their transforms progress at different rates without blocking controls.

- [ ] **Step 1: Define the browser validation flow**

Use this exact flow statement:

```text
The flow under test is: render the shared Inventory header -> switch the harness state to Transport -> both artworks fill the 300px header, animate slowly, preserve readable overlays, and keep the action button clickable without console errors.
```

- [ ] **Step 2: Use the Browser plugin with a temporary external harness**

Serve a temporary HTML harness outside the repository that loads `styles/main.css`, reproduces the shared header DOM, and toggles only the `--inventory`/`--transport` modifier. Use the in-app Browser first. Do not commit the harness, screenshots, or logs.

- [ ] **Step 3: Validate Inventory over time**

At a desktop viewport, record the header/pseudo-element computed styles twice at least 800 ms apart. Verify:

- header and artwork visible height are 300 px;
- animation name is `rm-inventory-header-camera`;
- duration is `42s` and direction is `alternate`;
- transform matrices differ between samples;
- the overlay action button resolves uniquely, accepts a click, and receives focus;
- console warnings/errors are empty or unrelated and explicitly explained.

- [ ] **Step 4: Validate Transport over time and capture evidence**

Toggle the harness to Transport and verify the same checks with `rm-transport-header-camera` and `48s`. Confirm the classic locomotive is immediately recognizable, no important details are hidden by the overlays, and no forbidden modern/electrical objects appear. Save one Inventory and one Transport screenshot under the OS temporary directory.

- [ ] **Step 5: Run focused tests, the full tracked suite, and diff checks**

Run:

```powershell
node --test tests/inventory-header-motion.test.mjs tests/inventory-app-context.test.mjs tests/style-theme.test.mjs
$testFiles = git ls-files 'tests/*.test.mjs'
node --test $testFiles
git diff --check
```

Expected: focused tests PASS, the tracked suite reports zero failures in the user's working checkout, and `git diff --check` exits 0 for the feature files. If unrelated concurrent files change during the run, exclude them from staging and report them separately.

- [ ] **Step 6: Commit a QA correction only if one was required**

If QA required a correction, add only the affected feature files and commit:

```powershell
git add -- styles/main.css templates/inventory-app.hbs tests/inventory-header-motion.test.mjs
git commit -m "fix: polish animated inventory headers"
```

If QA required no correction, do not create an empty commit.

---

### Task 5: Final Review and Publish `lich_branch`

**Files:**
- Review: every feature commit and `origin/lich_branch..HEAD`
- Do not modify or stage concurrent Lootgen/storage files.

**Interfaces:**
- Consumes: all green feature commits and QA evidence.
- Produces: a normally pushed `origin/lich_branch` exactly synchronized with local `HEAD`.

- [ ] **Step 1: Invoke completion verification skills**

Read and follow `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. The user's standing instruction already selects a normal push to `origin/lich_branch`; do not merge to `main` and do not create a force push.

- [ ] **Step 2: Inspect feature history and exact diff**

```powershell
git status --short --branch
git log --oneline origin/lich_branch..HEAD
git diff --stat origin/lich_branch..HEAD
git diff --check origin/lich_branch..HEAD
```

Verify that user-owned concurrent changes remain unstaged and are not included in feature commits.

- [ ] **Step 3: Fetch and verify the remote has not advanced**

```powershell
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected before push: local-ahead count is positive and remote-ahead count is `0`. Stop and report if remote-ahead is nonzero.

- [ ] **Step 4: Push without force and verify synchronization**

```powershell
git push origin lich_branch
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected after push: `0 0`.

- [ ] **Step 5: Report the saved asset, prompt, tests, and QA evidence**

Report:

- `assets/ui/rebreya-transport-steam-depot.webp` as the final project asset;
- the exact built-in ImageGen prompt from Task 2;
- Inventory/Transport durations and reduced-motion behavior;
- focused and full test totals;
- Browser environment, console result, interaction proof, and remaining risk;
- final commit and `origin/lich_branch` synchronization;
- explicit confirmation that user-owned Lootgen/storage working-tree changes were preserved.
