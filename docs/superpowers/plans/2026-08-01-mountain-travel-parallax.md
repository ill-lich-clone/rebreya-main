# Mountain Travel Parallax Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three selectable Travel-tab WebMs with one slow, seamless, five-layer mountain parallax made from five independently generated images.

**Architecture:** The Travel template renders one decorative container with five ordered layers. Each layer owns one independently authored horizontally tileable WebP; CSS repeats an oversized layer canvas and translates it by exactly one rendered texture width with a duration derived from the approved Godot-style scroll scale. Inventory application state no longer knows about landscape selection or local persistence.

**Tech Stack:** Foundry VTT ApplicationV2, Handlebars, scoped CSS animations, Node.js test runner, built-in image generation, Python/Pillow asset preparation, WebP.

## Global Constraints

- Work only on `lich_branch`; fetch `origin` before edits and never force-push.
- Preserve the current `styles/main.css` and current header geometry as the source of truth; do not restore an older window frame or selector treatment.
- Generate `sky`, `far-mountains`, `middle-ridges`, `valley`, and `foreground` in five separate image-generation calls; never cut a completed panorama into depth layers.
- There is no landscape selector: remove buttons `1`, `2`, and `3`, their state, persistence, listeners, and styles.
- Final assets are exactly `1920x450`; only the sky is opaque and the other four assets contain transparency.
- The scene is polished, slightly cartoon-like Victorian steampunk with no electrical poles, telegraph poles, utility poles, overhead wires, modern vehicles, text, logos, or watermarks.
- The shared motion is right-to-left with scroll scales `0.00`, `0.10`, `0.24`, `0.52`, and `1.00`; the foreground repeat lasts `60s`.
- Every moving layer advances by exactly one rendered `1280px` texture width per loop, matching a `1920x450` source scaled to the current `300px` header height.
- `prefers-reduced-motion: reduce` freezes the scene.
- Keep the workshop header unchanged outside the Travel tab.

---

### Task 1: Replace video selection state with a five-layer parallax shell

**Files:**
- Modify: `tests/inventory-app-context.test.mjs:800-910`
- Modify: `tests/inventory-app-context.test.mjs:1590-1815`
- Modify: `templates/inventory-app.hbs:7-43`
- Modify: `scripts/ui/inventory-app.js:13-19`
- Modify: `scripts/ui/inventory-app.js:2960-2972`
- Modify: `scripts/ui/inventory-app.js:3818-3826`
- Modify: `scripts/ui/inventory-app.js:5480-5502`
- Delete: `scripts/ui/travel-landscape-selector.js`
- Delete: `tests/travel-landscape-selector.test.mjs`

**Interfaces:**
- Consumes: existing `tabs.isTravel` context flag.
- Produces: `.rm-inventory-book__travel-parallax` containing exactly five `.rm-inventory-book__travel-layer` elements with `data-parallax-layer` values `sky`, `far-mountains`, `middle-ridges`, `valley`, and `foreground`.
- Removes: `travelLandscape`, `travelLandscapeId`, `select-travel-landscape`, and all local-storage selection helpers.

- [ ] **Step 1: Replace the old template contract test with a failing five-layer contract**

Rename the existing Travel-header test to
`InventoryApp renders one five-layer travel parallax without media selection`,
rename its extracted block variable to `travelBlock`, and replace the video and
selector assertions with:

```js
assert.equal((travelBlock.match(/<video\b/gu) ?? []).length, 0);
assert.equal((travelBlock.match(/<source\b/gu) ?? []).length, 0);
assert.match(
  travelBlock,
  /class="rm-inventory-book__travel-parallax"[\s\S]*aria-hidden="true"/u
);
assert.equal(
  (travelBlock.match(/class="rm-inventory-book__travel-layer /gu) ?? []).length,
  5
);
assert.deepEqual(
  [...travelBlock.matchAll(/data-parallax-layer="([^"]+)"/gu)].map((match) => match[1]),
  ["sky", "far-mountains", "middle-ridges", "valley", "foreground"]
);
assert.doesNotMatch(travelBlock, /travelLandscape|select-travel-landscape|aria-pressed/u);
```

In the Travel context test, replace the `context.travelLandscape` assertions with:

```js
assert.equal("travelLandscape" in context, false);
```

Delete the two selector-click tests because the interaction no longer exists.
Delete `InventoryApp keeps travel controls inside substantial window rails`
because both the selector and its obsolete frame-clearance contract are removed.

- [ ] **Step 2: Run the focused tests and verify the new contract fails**

Run:

```powershell
node --test --test-name-pattern="travel parallax|allows travel tab" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the template still renders a `<video>` and selector, and the context still exposes `travelLandscape`.

- [ ] **Step 3: Render the minimal five-layer Travel markup**

Replace the Travel-only `<video>` and selector in `templates/inventory-app.hbs` with:

```handlebars
{{#if tabs.isTravel}}
  <div
    class="rm-inventory-book__travel-parallax"
    aria-hidden="true"
  >
    <span class="rm-inventory-book__travel-layer rm-inventory-book__travel-layer--sky" data-parallax-layer="sky"></span>
    <span class="rm-inventory-book__travel-layer rm-inventory-book__travel-layer--far-mountains" data-parallax-layer="far-mountains"></span>
    <span class="rm-inventory-book__travel-layer rm-inventory-book__travel-layer--middle-ridges" data-parallax-layer="middle-ridges"></span>
    <span class="rm-inventory-book__travel-layer rm-inventory-book__travel-layer--valley" data-parallax-layer="valley"></span>
    <span class="rm-inventory-book__travel-layer rm-inventory-book__travel-layer--foreground" data-parallax-layer="foreground"></span>
  </div>
{{/if}}
```

- [ ] **Step 4: Remove obsolete application state and listeners**

In `scripts/ui/inventory-app.js`:

- remove the import from `./travel-landscape-selector.js`;
- remove `this.travelLandscapeId = loadTravelLandscapeId();`;
- remove `travelLandscape: prepareTravelLandscapeContext(this.travelLandscapeId),`;
- remove the complete `[data-action='select-travel-landscape']` listener block.

Delete `scripts/ui/travel-landscape-selector.js` and `tests/travel-landscape-selector.test.mjs` after `rg` confirms no remaining runtime consumers.

- [ ] **Step 5: Run the focused context tests**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs
rg -n "travelLandscape|select-travel-landscape|travel-landscape-selector" scripts templates tests
```

Expected: `inventory-app-context.test.mjs` passes and `rg` returns no matches.

- [ ] **Step 6: Commit the state and markup change**

```powershell
git add -- scripts/ui/inventory-app.js scripts/ui/travel-landscape-selector.js templates/inventory-app.hbs tests/inventory-app-context.test.mjs tests/travel-landscape-selector.test.mjs
git diff --cached --check
git commit -m "feat: replace travel landscape selector with parallax shell"
```

---

### Task 2: Generate and validate five independent mountain layers

**Files:**
- Create: `tools/prepare_travel_parallax_layer.py`
- Create: `tests/travel-parallax-assets.test.mjs`
- Create: `assets/ui/travel-parallax/mountain-sky.webp`
- Create: `assets/ui/travel-parallax/mountain-far-mountains.webp`
- Create: `assets/ui/travel-parallax/mountain-middle-ridges.webp`
- Create: `assets/ui/travel-parallax/mountain-valley.webp`
- Create: `assets/ui/travel-parallax/mountain-foreground.webp`
- Temporary, untracked: `tmp/imagegen/mountain-parallax/`

**Interfaces:**
- Consumes: one independently generated source image per layer; four chroma-key sources pass through the installed `remove_chroma_key.py` helper.
- Produces: five distinct `1920x450` WebPs, each horizontally seamless in isolation.
- `tools/prepare_travel_parallax_layer.py` CLI: `--source PATH --out PATH --opaque`; omit `--opaque` for RGBA layers.

- [ ] **Step 1: Add a failing asset contract test**

Create `tests/travel-parallax-assets.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const NAMES = [
  "mountain-sky.webp",
  "mountain-far-mountains.webp",
  "mountain-middle-ridges.webp",
  "mountain-valley.webp",
  "mountain-foreground.webp"
];

test("travel parallax ships five distinct nonempty WebP layers", async () => {
  const layers = await Promise.all(NAMES.map(async (name) => {
    const url = new URL(`../assets/ui/travel-parallax/${name}`, import.meta.url);
    const [metadata, bytes] = await Promise.all([stat(url), readFile(url)]);
    assert.ok(metadata.size > 32_768, `${name} must contain production artwork`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    return createHash("sha256").update(bytes).digest("hex");
  }));
  assert.equal(new Set(layers).size, NAMES.length);
});
```

- [ ] **Step 2: Run the asset test and verify it fails**

Run:

```powershell
node --test tests/travel-parallax-assets.test.mjs
```

Expected: FAIL with `ENOENT` for `assets/ui/travel-parallax/mountain-sky.webp`.

- [ ] **Step 3: Create the single-layer preparation tool**

Create `tools/prepare_travel_parallax_layer.py` with these responsibilities:

```python
CANVAS = (1920, 450)
SEAM_BLEND = 192

def cover_resize(source: Image.Image) -> Image.Image:
    mode = "RGBA" if source.mode == "RGBA" else "RGB"
    image = source.convert(mode)
    scale = max(CANVAS[0] / image.width, CANVAS[1] / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - CANVAS[0]) // 2
    top = (resized.height - CANVAS[1]) // 2
    return resized.crop((left, top, left + CANVAS[0], top + CANVAS[1]))

def make_horizontal_tile(source: Image.Image) -> Image.Image:
    base = cover_resize(source)
    shifted = ImageChops.offset(base, CANVAS[0] // 2, 0)
    left_edge = shifted.crop((0, 0, SEAM_BLEND, CANVAS[1]))
    right_edge = shifted.crop((CANVAS[0] - SEAM_BLEND, 0, CANVAS[0], CANVAS[1]))
    ramp = Image.linear_gradient("L").resize((SEAM_BLEND, CANVAS[1]))
    seam = Image.composite(left_edge, right_edge, ramp)
    shifted.paste(seam, (0, 0))
    shifted.paste(seam, (CANVAS[0] - SEAM_BLEND, 0))
    return shifted
```

The CLI opens one source, processes only that source, converts to RGB when
`--opaque` is set, otherwise requires an alpha channel with transparent pixels,
and saves WebP using `quality=90`, `method=6`, and `exact=True`. It aborts if the
final size differs from `1920x450`.

- [ ] **Step 4: Generate the sky in its own image-generation call**

Use the built-in image generator with this complete prompt:

```text
Use case: stylized-concept
Asset type: independent horizontally repeating parallax sky layer for a Foundry VTT travel header
Primary request: create only the sky layer of a Victorian-steampunk alpine landscape, authored independently rather than derived from a completed panorama
Scene/backdrop: pale blue and warm cream dawn sky with broad painterly clouds and subtle distant atmospheric haze; no land and no horizon objects
Style/medium: polished slightly cartoon-like hand-painted adventure illustration, crisp readable shapes, graphite-and-brass campaign palette
Composition/framing: ultra-wide; the left and right edges must continue seamlessly when tiled horizontally; visual detail distributed across the full width
Lighting/mood: warm calm travel morning
Constraints: sky and clouds only; no mountains, trees, buildings, vehicles, poles, wires, text, logo, watermark, border, window frame, or motion blur
```

Save the returned image as
`tmp/imagegen/mountain-parallax/sky-source.png`, then run:

```powershell
python tools/prepare_travel_parallax_layer.py --source tmp/imagegen/mountain-parallax/sky-source.png --out assets/ui/travel-parallax/mountain-sky.webp --opaque
```

- [ ] **Step 5: Generate the far mountains in a second independent call**

```text
Use case: stylized-concept
Asset type: independent transparent far-mountain parallax layer for a Foundry VTT travel header
Primary request: create one distant snow-capped alpine mountain range, authored independently rather than extracted from any composite panorama
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; one continuous distant range occupies the lower 48 percent and touches the bottom edge
Style/medium: polished slightly cartoon-like hand-painted Victorian adventure illustration with cool blue-gray atmospheric perspective and restrained warm highlights
Composition/framing: ultra-wide side view; continuous silhouette; left and right terrain edges match for horizontal tiling; generous empty chroma-key space above
Lighting/mood: warm morning light through cool mountain haze
Constraints: no foreground, no separate sky, no buildings, no vehicles, no poles, no wires; the chroma-key background has no gradient, texture, shadow, reflection, or lighting variation; do not use #ff00ff in the mountains; no text, logo, watermark, border, window frame, or motion blur
```

Save as `tmp/imagegen/mountain-parallax/far-mountains-key.png`, remove the key,
and prepare the layer:

```powershell
python C:/Users/ill_lich/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input tmp/imagegen/mountain-parallax/far-mountains-key.png --out tmp/imagegen/mountain-parallax/far-mountains-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python tools/prepare_travel_parallax_layer.py --source tmp/imagegen/mountain-parallax/far-mountains-alpha.png --out assets/ui/travel-parallax/mountain-far-mountains.webp
```

- [ ] **Step 6: Generate the middle ridges in a third independent call**

```text
Use case: stylized-concept
Asset type: independent transparent middle-ridge parallax layer for a Foundry VTT travel header
Primary request: create wooded alpine ridges with sparse Victorian stone viaduct arches and one small brass observatory, authored independently rather than extracted from any composite panorama
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; layered ridges occupy the lower 62 percent and touch the bottom edge
Style/medium: polished slightly cartoon-like hand-painted Victorian-steampunk adventure illustration, muted pine green, slate, aged brass, consistent warm morning light
Composition/framing: ultra-wide side view; continuous terrain; left and right terrain edges match for horizontal tiling; clear depth below the empty chroma-key upper area
Constraints: no electrical poles, telegraph poles, utility poles, wires, modern structures, modern vehicles, separate sky, text, logo, watermark, border, window frame, or motion blur; flat uniform chroma key with no shadow or gradient; no #ff00ff in the subject
```

Save as `tmp/imagegen/mountain-parallax/middle-ridges-key.png`, then run:

```powershell
python C:/Users/ill_lich/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input tmp/imagegen/mountain-parallax/middle-ridges-key.png --out tmp/imagegen/mountain-parallax/middle-ridges-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python tools/prepare_travel_parallax_layer.py --source tmp/imagegen/mountain-parallax/middle-ridges-alpha.png --out assets/ui/travel-parallax/mountain-middle-ridges.webp
```

- [ ] **Step 7: Generate the valley in a fourth independent call**

```text
Use case: stylized-concept
Asset type: independent transparent mountain-valley parallax layer for a Foundry VTT travel header
Primary request: create a nearer forested valley with meadow, a winding river, dark rocks, and two restrained plumes of period steam, authored independently rather than extracted from any composite panorama
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; valley terrain occupies the lower 76 percent and touches the bottom edge
Style/medium: polished slightly cartoon-like hand-painted Victorian-steampunk adventure illustration, pine green, weathered stone, soft cream steam, warm morning highlights
Composition/framing: ultra-wide moving-vehicle side view; continuous low terrain; left and right terrain edges match for horizontal tiling
Constraints: no electrical poles, telegraph poles, utility poles, wires, modern objects, separate sky, text, logo, watermark, border, window frame, or baked motion blur; flat uniform chroma key with no shadow or gradient; no #ff00ff in the subject
```

Save as `tmp/imagegen/mountain-parallax/valley-key.png`, then run:

```powershell
python C:/Users/ill_lich/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input tmp/imagegen/mountain-parallax/valley-key.png --out tmp/imagegen/mountain-parallax/valley-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python tools/prepare_travel_parallax_layer.py --source tmp/imagegen/mountain-parallax/valley-alpha.png --out assets/ui/travel-parallax/mountain-valley.webp
```

- [ ] **Step 8: Generate the foreground in a fifth independent call**

```text
Use case: stylized-concept
Asset type: independent transparent near-foreground parallax layer for a Foundry VTT travel header
Primary request: create close roadside alpine grasses, low shrubs, scattered dark rocks, and a low dry-stone wall, authored independently rather than extracted from any composite panorama
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background; foreground occupies only the lower 36 percent and touches the bottom edge
Style/medium: polished slightly cartoon-like hand-painted Victorian adventure illustration, crisp close shapes, dark graphite shadows, restrained ochre and pine-green accents
Composition/framing: ultra-wide side view from a moving vehicle; continuous low silhouette; left and right edges match for horizontal tiling
Constraints: no poles of any kind, no wires, no signs, no rails, no vehicles, no buildings, no separate sky, no text, logo, watermark, border, window frame, or baked motion blur; flat uniform chroma key with no shadow or gradient; no #ff00ff in the subject
```

Save as `tmp/imagegen/mountain-parallax/foreground-key.png`, then run:

```powershell
python C:/Users/ill_lich/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input tmp/imagegen/mountain-parallax/foreground-key.png --out tmp/imagegen/mountain-parallax/foreground-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
python tools/prepare_travel_parallax_layer.py --source tmp/imagegen/mountain-parallax/foreground-alpha.png --out assets/ui/travel-parallax/mountain-foreground.webp
```

- [ ] **Step 9: Inspect and validate every final layer**

Open all five final WebPs individually, then create a temporary three-tile
preview for each layer with Pillow. Check subject assignment, style consistency,
alpha edges, forbidden objects, and both tile seams. If a layer is unsuitable,
regenerate only that layer with one targeted prompt correction.

Run:

```powershell
node --test tests/travel-parallax-assets.test.mjs
@'
from pathlib import Path
from PIL import Image

root = Path("assets/ui/travel-parallax")
expected = {
    "mountain-sky.webp": False,
    "mountain-far-mountains.webp": True,
    "mountain-middle-ridges.webp": True,
    "mountain-valley.webp": True,
    "mountain-foreground.webp": True,
}
for name, needs_alpha in expected.items():
    image = Image.open(root / name)
    assert image.size == (1920, 450), (name, image.size)
    has_alpha = "A" in image.getbands() and image.getchannel("A").getextrema()[0] < 255
    assert has_alpha is needs_alpha, (name, image.getbands(), has_alpha)
print("validated 5 independent 1920x450 WebP layers")
'@ | python -
```

Expected: the Node test passes and Python prints
`validated 5 independent 1920x450 WebP layers`.

- [ ] **Step 10: Commit the independent layer pipeline and assets**

```powershell
git add -- tools/prepare_travel_parallax_layer.py tests/travel-parallax-assets.test.mjs assets/ui/travel-parallax
git diff --cached --check
git commit -m "assets: add independent mountain parallax layers"
```

---

### Task 3: Implement Godot-style repeat and scroll scales in current CSS

**Files:**
- Modify: `tests/inventory-app-context.test.mjs:840-920`
- Modify: `styles/main.css:4335-4410`

**Interfaces:**
- Consumes: the five fixed layer classes and five module-local WebPs from Tasks 1 and 2.
- Produces: application-scoped layer composition, exact repeat width, per-layer durations, and reduced-motion behavior.

- [ ] **Step 1: Write failing CSS motion assertions**

Add assertions to the Travel-header style test:

```js
assert.match(css, /\.rebreya-inventory-app \.rm-inventory-book__travel-parallax\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;[^}]*pointer-events:\s*none;/su);
assert.match(css, /--rm-travel-repeat-width:\s*1280px;/u);
assert.match(css, /@keyframes rm-travel-parallax-scroll[\s\S]*translate3d\(-1280px,\s*0,\s*0\)/u);
assert.match(css, /travel-layer--sky::before[\s\S]*mountain-sky\.webp/u);
assert.match(css, /travel-layer--far-mountains::before[\s\S]*mountain-far-mountains\.webp[\s\S]*600s/u);
assert.match(css, /travel-layer--middle-ridges::before[\s\S]*mountain-middle-ridges\.webp[\s\S]*250s/u);
assert.match(css, /travel-layer--valley::before[\s\S]*mountain-valley\.webp[\s\S]*115\.38s/u);
assert.match(css, /travel-layer--foreground::before[\s\S]*mountain-foreground\.webp[\s\S]*60s/u);
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;/u);
assert.doesNotMatch(css, /rm-inventory-book__travel-video|rm-inventory-book__travel-selector|rm-inventory-book__travel-choice/u);
```

- [ ] **Step 2: Run the focused style test and verify it fails**

Run:

```powershell
node --test --test-name-pattern="travel parallax" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the parallax selectors and keyframes are not present.

- [ ] **Step 3: Replace only the obsolete Travel media selectors**

Remove the current `.rm-inventory-book__travel-video`,
`.rm-inventory-book__travel-selector`, and `.rm-inventory-book__travel-choice`
rules. Do not replace or restore unrelated header, identity, frame, or resource
styles.

Add the following scoped structure:

```css
.rebreya-inventory-app .rm-inventory-book__header--travel {
  --rm-travel-repeat-width: 1280px;
}

.rebreya-inventory-app .rm-inventory-book__travel-parallax,
.rebreya-inventory-app .rm-inventory-book__travel-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.rebreya-inventory-app .rm-inventory-book__travel-parallax {
  z-index: 0;
}

.rebreya-inventory-app .rm-inventory-book__travel-layer::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: calc(100% + var(--rm-travel-repeat-width));
  background-repeat: repeat-x;
  background-position: left top;
  background-size: var(--rm-travel-repeat-width) 300px;
  will-change: transform;
  animation: rm-travel-parallax-scroll var(--rm-travel-layer-duration) linear infinite;
}

@keyframes rm-travel-parallax-scroll {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-1280px, 0, 0); }
}
```

Add one explicit `::before` selector per layer with these values:

```css
/* scroll_scale.x = 0.00 */
.rebreya-inventory-app .rm-inventory-book__travel-layer--sky::before {
  background-image: url("../assets/ui/travel-parallax/mountain-sky.webp");
  animation: none;
}

/* scroll_scale.x = 0.10 */
.rebreya-inventory-app .rm-inventory-book__travel-layer--far-mountains::before {
  --rm-travel-layer-duration: 600s;
  background-image: url("../assets/ui/travel-parallax/mountain-far-mountains.webp");
}

/* scroll_scale.x = 0.24 */
.rebreya-inventory-app .rm-inventory-book__travel-layer--middle-ridges::before {
  --rm-travel-layer-duration: 250s;
  background-image: url("../assets/ui/travel-parallax/mountain-middle-ridges.webp");
}

/* scroll_scale.x = 0.52 */
.rebreya-inventory-app .rm-inventory-book__travel-layer--valley::before {
  --rm-travel-layer-duration: 115.38s;
  background-image: url("../assets/ui/travel-parallax/mountain-valley.webp");
}

/* scroll_scale.x = 1.00 */
.rebreya-inventory-app .rm-inventory-book__travel-layer--foreground::before {
  --rm-travel-layer-duration: 60s;
  background-image: url("../assets/ui/travel-parallax/mountain-foreground.webp");
}
```

Layer source order supplies z-order. Keep the existing identity, controls, and
actions at `z-index: 2`.

- [ ] **Step 4: Freeze motion for reduced-motion clients**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  .rebreya-inventory-app .rm-inventory-book__travel-layer::before {
    animation: none;
  }
}
```

- [ ] **Step 5: Run focused layout and theme tests**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs tests/style-theme.test.mjs tests/travel-parallax-assets.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 6: Commit the runtime parallax CSS**

```powershell
git add -- styles/main.css tests/inventory-app-context.test.mjs
git diff --cached --check
git commit -m "feat: animate mountain travel parallax layers"
```

---

### Task 4: Remove obsolete video pipeline and verify the complete feature

**Files:**
- Delete: `tools/render_travel_landscapes.py`
- Delete: `assets/ui/rebreya-travel-industrial.webm`
- Delete: `assets/ui/rebreya-travel-industrial-poster.webp`
- Delete: `assets/ui/rebreya-travel-wilderness.webm`
- Delete: `assets/ui/rebreya-travel-wilderness-poster.webp`
- Delete: `assets/ui/rebreya-travel-city.webm`
- Delete: `assets/ui/rebreya-travel-city-poster.webp`
- Verify: all changed files from Tasks 1-3

**Interfaces:**
- Consumes: completed five-layer template, assets, and CSS.
- Produces: a clean module with no live selector/video implementation and a fully verified `lich_branch`.

- [ ] **Step 1: Add negative assertions for obsolete runtime artifacts**

Extend `tests/travel-parallax-assets.test.mjs`:

```js
const OBSOLETE = [
  "rebreya-travel-industrial.webm",
  "rebreya-travel-industrial-poster.webp",
  "rebreya-travel-wilderness.webm",
  "rebreya-travel-wilderness-poster.webp",
  "rebreya-travel-city.webm",
  "rebreya-travel-city-poster.webp"
];

test("travel parallax leaves no obsolete video media", async () => {
  for (const name of OBSOLETE) {
    await assert.rejects(
      stat(new URL(`../assets/ui/${name}`, import.meta.url)),
      { code: "ENOENT" }
    );
  }
});
```

- [ ] **Step 2: Run the negative test and verify it fails**

Run:

```powershell
node --test --test-name-pattern="obsolete video media" tests/travel-parallax-assets.test.mjs
```

Expected: FAIL because the six old media files still exist.

- [ ] **Step 3: Delete only obsolete generated media and renderer**

Use `apply_patch` to delete `tools/render_travel_landscapes.py`. Delete the six
explicit media paths listed above after resolving each path under
`D:\FoundryVTT\Data\modules\rebreya-main\assets\ui`; do not use a wildcard.

- [ ] **Step 4: Verify no live references remain**

Run:

```powershell
rg -n "rebreya-travel-(industrial|wilderness|city)|travelLandscape|select-travel-landscape|travel-landscape-selector|rm-inventory-book__travel-video|rm-inventory-book__travel-selector|rm-inventory-book__travel-choice" scripts styles templates tools
node --test tests/travel-parallax-assets.test.mjs
```

Expected: `rg` returns no matches and the asset tests pass.

- [ ] **Step 5: Inspect the composite in Foundry or a browser harness**

Reload the local Foundry client after the CSS and asset changes. Open Party
Inventory, switch to Travel, and verify at the default inventory size and a
narrower resized window:

- one composed mountain scene fills the header;
- no `1`, `2`, or `3` controls remain;
- all five layers move right-to-left at visibly different, slow speeds;
- no blank gaps or seam flashes cross the header;
- title, crest, currency, cargo, food, water, and energy remain readable;
- non-Travel tabs still show the current workshop header;
- the browser console contains no new errors.

- [ ] **Step 6: Run full verification**

Run:

```powershell
git diff --check
$testFiles = git ls-files 'tests/*.test.mjs'
node --test $testFiles
git status --short --branch
git diff --stat origin/lich_branch...HEAD
```

Expected: `git diff --check` exits `0`, every tracked Node test passes with zero
failures, and only the planned files differ.

- [ ] **Step 7: Commit the obsolete-media cleanup**

```powershell
git add -- tools/render_travel_landscapes.py tests/travel-parallax-assets.test.mjs assets/ui/rebreya-travel-industrial.webm assets/ui/rebreya-travel-industrial-poster.webp assets/ui/rebreya-travel-wilderness.webm assets/ui/rebreya-travel-wilderness-poster.webp assets/ui/rebreya-travel-city.webm assets/ui/rebreya-travel-city-poster.webp
git diff --cached --check
git commit -m "chore: remove obsolete travel landscape videos"
```

- [ ] **Step 8: Push without rewriting history**

```powershell
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
git push origin lich_branch
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected before push: remote-ahead count is `0`. Expected after push: `0 0`.
