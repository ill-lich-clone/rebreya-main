# Travel Header Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a slow, seamless 30-second Victorian-steampunk WebM background that loads and plays only on the party inventory's `Путешествие` tab.

**Architecture:** Re-render the approved layered landscape over one 30-second period, encode it as a module-local VP9 WebM, and export its first frame as a WebP poster. Handlebars conditionally inserts a decorative `<video>` from the existing `tabs.isTravel` context flag, while application-scoped CSS places it behind the shared header controls and preserves the current workshop pseudo-element as the non-travel fallback.

**Tech Stack:** Foundry VTT ApplicationV2, Handlebars, CSS, Node.js test runner, Python 3.14 with Pillow 12.2, FFmpeg 8.1 VP9, ImageMagick 7.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Run `git status`, confirm the current branch, and run `git fetch origin` before implementation and again before the final push.
- Preserve unrelated work and stage only explicit task paths.
- Never use force push without separate permission.
- Video format is VP9 WebM, exactly 1920×1080, 15 fps, 450 frames, 30 seconds, and no audio.
- Motion is 4.17 times slower than the approved 7.2-second GIF: far, middle, and near layers move at approximately 64, 128, and 192 pixels per second.
- The WebM is rendered only on the `Путешествие` tab; every other tab keeps `rebreya-party-inventory-workshop.webp`.
- The video is decorative, muted, looping, inline, non-interactive, and has no controls.
- `assets/ui/rebreya-travel-window-poster.webp` is the loading and playback-failure fallback.
- Do not change travel services, group state, sockets, data schemas, or `scripts/ui/inventory-app.js`.
- Target WebM size is at most 20 MiB unless a larger file is required to avoid unacceptable visible compression.
- Final verification includes the inventory-specific tests, style tests, the full Node test suite, media metadata inspection, and complete media decoding.

## File Map

- Create `assets/ui/rebreya-travel-window.webm`: final 30-second VP9 animation.
- Create `assets/ui/rebreya-travel-window-poster.webp`: first-frame poster matching the video crop.
- Modify `templates/inventory-app.hbs`: travel-only decorative video markup.
- Modify `styles/main.css`: scoped video positioning, mask, and stacking.
- Modify `tests/inventory-app-context.test.mjs`: template and style regression coverage.
- Use but do not commit `tmp/travel-header-frames/`: 450 intermediate PNG frames.
- Use but do not commit `tmp/travel-header-contact-sheet.jpg`: visual QA sheet.
- Read source art from `C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/steampunk_landscape_source.png`.
- Reuse the tested compositor from `C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/render_steampunk_gif.py`.

---

### Task 1: Render, Encode, and Validate the 30-Second Media

**Files:**
- Create: `assets/ui/rebreya-travel-window.webm`
- Create: `assets/ui/rebreya-travel-window-poster.webp`
- Create temporarily: `tmp/travel-header-frames/frame_000.png` through `frame_449.png`
- Create temporarily: `tmp/travel-header-contact-sheet.jpg`

**Interfaces:**
- Consumes: `render_steampunk_gif.render_all(source_path: Path, frame_dir: Path, frame_count: int) -> list[Path]`.
- Produces: a browser-decodable VP9 WebM at the exact module path used later by the Handlebars `<source>`, plus a 1920×1080 WebP poster.

- [ ] **Step 1: Recheck the shared repository before generating assets**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
git rev-list --left-right --count HEAD...origin/main
```

Expected:

```text
Current branch is lich_branch.
No unrecognized working-tree changes are present.
origin/lich_branch has no commits missing from the local branch.
origin/main has no commits missing from the local branch.
```

If a new unrelated working-tree change or remote commit appears, stop and report
it before continuing.

- [ ] **Step 2: Confirm the approved source and compositor exist**

Run:

```powershell
$source = 'C:\Users\ill_lich\Documents\Codex\2026-07-30\new-chat\work\steampunk_landscape_source.png'
$renderer = 'C:\Users\ill_lich\Documents\Codex\2026-07-30\new-chat\work\render_steampunk_gif.py'
Get-Item -LiteralPath $source,$renderer | Select-Object FullName,Length
magick identify $source
```

Expected:

```text
Both files exist.
The source is the approved 1672×941 RGB/RGBA landscape.
```

- [ ] **Step 3: Render one continuous 30-second period**

Run from the module root:

```powershell
$renderRoot = 'C:\Users\ill_lich\Documents\Codex\2026-07-30\new-chat\work'
$env:PYTHONPATH = $renderRoot
python -c "from pathlib import Path; from render_steampunk_gif import render_all; paths=render_all(Path(r'C:\Users\ill_lich\Documents\Codex\2026-07-30\new-chat\work\steampunk_landscape_source.png'), Path(r'D:\FoundryVTT\Data\modules\rebreya-main\tmp\travel-header-frames'), 450); assert len(paths)==450; print(f'rendered={len(paths)}')"
```

Expected:

```text
rendered=450
```

The existing compositor defines `progress = frame_index / frame_count`.
Increasing `frame_count` from 108 to 450 makes one identical spatial period last
30 seconds at 15 fps, reducing every layer's speed by 450/108 = 4.17 while
preserving the seamless integer 1×/2×/3× parallax.

- [ ] **Step 4: Inspect the uncompressed motion samples**

Run:

```powershell
magick montage `
  'tmp/travel-header-frames/frame_000.png' `
  'tmp/travel-header-frames/frame_090.png' `
  'tmp/travel-header-frames/frame_180.png' `
  'tmp/travel-header-frames/frame_270.png' `
  'tmp/travel-header-frames/frame_360.png' `
  'tmp/travel-header-frames/frame_449.png' `
  -thumbnail '640x360!' `
  -tile 3x2 `
  -geometry '+8+8' `
  -background '#241914' `
  -quality 90 `
  'tmp/travel-header-contact-sheet.jpg'
```

Open `tmp/travel-header-contact-sheet.jpg` and confirm:

```text
The brass vehicle window remains fixed.
The factory, telegraph poles, airship, and horizon remain readable.
The foreground advances faster than the midground and far background.
No generated object warps between samples because all frames come from one source.
```

- [ ] **Step 5: Encode the VP9 WebM**

Run:

```powershell
ffmpeg -y `
  -framerate 15 `
  -i 'tmp/travel-header-frames/frame_%03d.png' `
  -an `
  -c:v libvpx-vp9 `
  -pix_fmt yuv420p `
  -b:v 0 `
  -crf 32 `
  -deadline good `
  -cpu-used 2 `
  -row-mt 1 `
  -tile-columns 2 `
  -frame-parallel 1 `
  -g 450 `
  'assets/ui/rebreya-travel-window.webm'
```

If the result exceeds 20 MiB, repeat only this encoding step with `-crf 34`.
Keep `-crf 32` if visual inspection shows unacceptable block edges, smeared
telegraph wires, or damaged brass highlights at `-crf 34`, and report the larger
measured size.

- [ ] **Step 6: Export the matching WebP poster**

Run:

```powershell
magick `
  'tmp/travel-header-frames/frame_000.png' `
  -strip `
  -define webp:method=6 `
  -quality 86 `
  'assets/ui/rebreya-travel-window-poster.webp'
```

- [ ] **Step 7: Validate media metadata and complete decoding**

Run:

```powershell
ffprobe -v error `
  -count_frames `
  -select_streams v:0 `
  -show_entries stream=codec_name,width,height,avg_frame_rate,nb_read_frames `
  -show_entries format=duration,size `
  -of default=noprint_wrappers=1 `
  'assets/ui/rebreya-travel-window.webm'

ffprobe -v error `
  -select_streams a `
  -show_entries stream=codec_name `
  -of default=noprint_wrappers=1 `
  'assets/ui/rebreya-travel-window.webm'

ffmpeg -v error `
  -i 'assets/ui/rebreya-travel-window.webm' `
  -f null NUL

magick identify 'assets/ui/rebreya-travel-window-poster.webp'
```

Expected:

```text
codec_name=vp9
width=1920
height=1080
avg_frame_rate=15/1
nb_read_frames=450
duration=30.000000
No audio stream output
Complete FFmpeg decode exits 0
Poster is WEBP 1920×1080
```

- [ ] **Step 8: Verify encoded loop continuity and poster fidelity**

Run:

```powershell
ffmpeg -y -i 'assets/ui/rebreya-travel-window.webm' -vf "select='eq(n,0)+eq(n,1)+eq(n,449)'" -vsync 0 'tmp/travel-header-decoded-%02d.png'

python -c "from PIL import Image,ImageChops,ImageStat; from pathlib import Path; f=[Image.open(p).convert('RGB') for p in sorted(Path('tmp').glob('travel-header-decoded-*.png'))]; poster=Image.open('assets/ui/rebreya-travel-window-poster.webp').convert('RGB'); mean=lambda a,b: sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3; normal=mean(f[0],f[1]); seam=mean(f[2],f[0]); poster_delta=mean(f[0],poster); print(f'normal={normal:.3f} seam={seam:.3f} poster={poster_delta:.3f}'); assert seam <= normal*1.35; assert poster_delta <= 5.0"
```

Expected:

```text
The final-to-first mean difference is no more than 1.35 times an ordinary frame step.
The first decoded frame and poster differ by no more than 5 mean RGB levels.
```

- [ ] **Step 9: Commit only the validated media**

Run:

```powershell
git status --short
git add -- `
  'assets/ui/rebreya-travel-window.webm' `
  'assets/ui/rebreya-travel-window-poster.webp'
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add slow travel header media"
```

Expected:

```text
Only the two assets are included in this commit.
tmp/travel-header-* remains untracked or ignored and is not staged.
```

---

### Task 2: Add Failing Travel-Only Header Regression Tests

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: the established `tabs.isTravel` template flag and
  `.rebreya-inventory-app` CSS scope.
- Produces: regression assertions that define the exact video markup, fallback
  paths, stacking, mask, and preservation of the static workshop background.

- [ ] **Step 1: Add the template and CSS test**

Append this test near the existing shared-header artwork tests in
`tests/inventory-app-context.test.mjs`:

```javascript
test("InventoryApp renders a masked travel video only inside the travel header branch", async () => {
  const template = await readFile(
    new URL("../templates/inventory-app.hbs", import.meta.url),
    "utf8"
  );
  const css = await readFile(
    new URL("../styles/main.css", import.meta.url),
    "utf8"
  );

  const headerIndex = template.indexOf('class="rm-inventory-book__header"');
  const identityIndex = template.indexOf('class="rm-inventory-book__identity"');
  const travelGuardIndex = template.indexOf("{{#if tabs.isTravel}}", headerIndex);
  const travelGuardEnd = template.indexOf("{{/if}}", travelGuardIndex);
  const travelVideoBlock = template.slice(travelGuardIndex, travelGuardEnd);

  assert.ok(headerIndex >= 0, "expected the shared inventory header");
  assert.ok(
    travelGuardIndex > headerIndex && travelGuardIndex < identityIndex,
    "expected the travel-only video before shared header content"
  );
  assert.equal((template.match(/<video\b/gu) ?? []).length, 1);
  assert.match(travelVideoBlock, /class="rm-inventory-book__travel-video"/u);
  assert.match(travelVideoBlock, /\bautoplay\b/u);
  assert.match(travelVideoBlock, /\bmuted\b/u);
  assert.match(travelVideoBlock, /\bloop\b/u);
  assert.match(travelVideoBlock, /\bplaysinline\b/u);
  assert.match(travelVideoBlock, /preload="metadata"/u);
  assert.match(travelVideoBlock, /aria-hidden="true"/u);
  assert.match(
    travelVideoBlock,
    /poster="\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-window-poster\.webp"/u
  );
  assert.match(
    travelVideoBlock,
    /src="\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-window\.webm"/u
  );
  assert.match(travelVideoBlock, /type="video\/webm"/u);
  assert.doesNotMatch(travelVideoBlock, /\bcontrols\b/u);

  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__travel-video\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;[^}]*object-position:\s*center top;[^}]*pointer-events:\s*none;/su
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__travel-video\s*\{[^}]*-webkit-mask-image:\s*linear-gradient\(180deg,[^}]*transparent 100%\);[^}]*mask-image:\s*linear-gradient\(180deg,[^}]*transparent 100%\);/su
  );
  assert.match(
    css,
    /--rm-party-inventory-header-image:\s*url\("\.\.\/assets\/ui\/rebreya-party-inventory-workshop\.webp"\);/u
  );
  assert.match(
    css,
    /\.rebreya-inventory-app \.rm-inventory-book__header::before\s*\{[^}]*var\(--rm-party-inventory-header-image\)/su
  );
});
```

- [ ] **Step 2: Run the focused test and confirm it fails for the missing video**

Run:

```powershell
node --test --test-name-pattern="masked travel video" tests/inventory-app-context.test.mjs
```

Expected:

```text
FAIL because the header currently contains no rm-inventory-book__travel-video.
```

Do not modify the production template or CSS until this failure has been
observed.

---

### Task 3: Implement the Travel-Only Header Video

**Files:**
- Modify: `templates/inventory-app.hbs:8`
- Modify: `styles/main.css:4307-4340`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `tabs.isTravel`, the two media paths produced by Task 1, and the
  existing header stacking context.
- Produces: one decorative `<video>` in the travel render only, with the
  existing header identity and controls still above it.

- [ ] **Step 1: Add the guarded video as the first header child**

Immediately after:

```handlebars
<header class="rm-inventory-book__header">
```

insert:

```handlebars
{{#if tabs.isTravel}}
  <video
    class="rm-inventory-book__travel-video"
    autoplay
    muted
    loop
    playsinline
    preload="metadata"
    poster="/modules/rebreya-main/assets/ui/rebreya-travel-window-poster.webp"
    aria-hidden="true"
  >
    <source
      src="/modules/rebreya-main/assets/ui/rebreya-travel-window.webm"
      type="video/webm"
    >
  </video>
{{/if}}
```

Do not move, rename, or remove any existing `data-action`, Handlebars
expressions, identity markup, wallet controls, or summary controls.

- [ ] **Step 2: Add the scoped video style beside the header pseudo-element**

After `.rebreya-inventory-app .rm-inventory-book__header::before`, add:

```css
.rebreya-inventory-app .rm-inventory-book__travel-video {
  position: absolute;
  z-index: 0;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 58%, rgb(0 0 0 / 0.72) 75%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 0%, #000 58%, rgb(0 0 0 / 0.72) 75%, transparent 100%);
  pointer-events: none;
}
```

Keep the existing shared-content stacking rule at `z-index: 1`. Do not alter
the workshop background variable or `header::before`.

- [ ] **Step 3: Run the focused regression test**

Run:

```powershell
node --test --test-name-pattern="masked travel video" tests/inventory-app-context.test.mjs
```

Expected:

```text
PASS
```

- [ ] **Step 4: Run the complete inventory test file**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs
```

Expected:

```text
All inventory-app-context tests pass with 0 failures.
```

- [ ] **Step 5: Review and commit only the UI integration**

Run:

```powershell
git diff --check
git diff -- `
  'templates/inventory-app.hbs' `
  'styles/main.css' `
  'tests/inventory-app-context.test.mjs'
git add -- `
  'templates/inventory-app.hbs' `
  'styles/main.css' `
  'tests/inventory-app-context.test.mjs'
git diff --cached --check
git diff --cached --stat
git commit -m "feat: animate the travel inventory header"
```

Expected:

```text
The commit contains only the HBS, CSS, and inventory regression test.
```

---

### Task 4: Validate Foundry Behavior, Run the Full Suite, and Push

**Files:**
- Inspect: `assets/ui/rebreya-travel-window.webm`
- Inspect: `assets/ui/rebreya-travel-window-poster.webp`
- Inspect: `templates/inventory-app.hbs`
- Inspect: `styles/main.css`
- Inspect: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: the committed media and UI integration.
- Produces: fresh verification evidence, a clean branch, and a normal
  non-force push to `origin/lich_branch`.

- [ ] **Step 1: Run the required automated checks**

Run:

```powershell
git diff --check
node --test tests/style-theme.test.mjs
node --test tests/inventory-app-context.test.mjs
node --test tests\*.test.mjs
```

Expected:

```text
Every command exits 0.
The full suite reports 0 failed tests.
```

- [ ] **Step 2: Repeat final media verification against the committed files**

Run:

```powershell
ffprobe -v error `
  -count_frames `
  -select_streams v:0 `
  -show_entries stream=codec_name,width,height,avg_frame_rate,nb_read_frames `
  -show_entries format=duration,size `
  -of default=noprint_wrappers=1 `
  'assets/ui/rebreya-travel-window.webm'

ffmpeg -v error `
  -i 'assets/ui/rebreya-travel-window.webm' `
  -f null NUL

magick identify 'assets/ui/rebreya-travel-window-poster.webp'
```

Expected:

```text
VP9, 1920×1080, 15 fps, 450 frames, 30 seconds, no decode errors.
Poster is WebP 1920×1080.
```

- [ ] **Step 3: Perform Foundry UI validation if the local Foundry client is available**

Open the party inventory and verify:

```text
Путешествие: video autoplays silently, loops, has no controls, and remains behind readable header content.
Инвентарь, Группа, Крафт, Календарь, Транспорт, Простой: current workshop background remains unchanged.
Repeated tab switching: video appears only on travel and is removed after leaving it.
Resized window: video continues covering the complete header without stretching.
GM and player view: no permission errors and no console errors.
```

If Foundry is unavailable, report this manual check as not run rather than
claiming it passed.

- [ ] **Step 4: Recheck the shared branch immediately before push**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
git rev-list --left-right --count HEAD...origin/main
git log --oneline --decorate -5
```

Expected:

```text
Current branch is lich_branch.
Working tree is clean.
origin/lich_branch has no new commits missing locally.
origin/main has no new commits missing locally.
Recent commits include the design, implementation plan, media, and UI integration.
```

If another person has pushed to `origin/lich_branch`, stop and report instead of
rebasing, merging, or force-pushing without direction.

- [ ] **Step 5: Push normally and verify remote synchronization**

Run:

```powershell
git push origin lich_branch
git status --short --branch
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected:

```text
Push succeeds without --force.
Working tree is clean.
HEAD and origin/lich_branch report 0 0.
```
