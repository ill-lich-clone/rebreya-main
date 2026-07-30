# Travel Landscape Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the distorted single travel video with three purpose-built 30-second panoramic landscapes, a graphite-and-brass CSS window frame, and locally persisted `1`/`2`/`3` selector controls.

**Architecture:** A focused `travel-landscape-selector.js` module owns immutable media descriptors, normalization, context preparation, and guarded world/user-scoped browser storage. `InventoryApp` consumes that model, renders only the active video, and rerenders with scroll preservation when a selector button is clicked. Three new `1920x450` media pairs are generated from independent AI illustrations by a reusable streaming Python renderer so no temporary frame directory or baked window trim is required.

**Tech Stack:** Foundry VTT 13 ApplicationV2, JavaScript ES modules, Handlebars, CSS, Node test runner, Python 3 + Pillow, FFmpeg/FFprobe, VP9 WebM, WebP, built-in image generation.

## Global Constraints

- Work only on `lich_branch`; fetch `origin` before edits and before push.
- Preserve unrelated user changes and stage only paths owned by the current task.
- Do not merge, rebase, force-push, or write to `main`/`master`.
- The three scenes are industrial valley, wilderness, and city outskirts.
- No scene may contain electrical poles, telegraph poles, utility poles, overhead wires, power lines, modern vehicles, modern road furniture, text, logos, or watermarks.
- Every video is VP9 `yuv420p`, `1920x450`, 15 fps, exactly 450 frames / 30 seconds, silent, and loop-safe.
- No raster asset contains a decorative window frame.
- The CSS frame uses existing graphite-and-brass inventory theme variables.
- Only the selected video is rendered or decoded.
- The local choice is scoped by both Foundry world id and user id.
- Non-Travel tabs keep the current workshop background unchanged.
- Generated source illustrations and temporary review artifacts remain outside committed source; final WebMs and WebP posters live in `assets/ui/`.

---

### Task 1: Add a Streaming Panoramic Travel Renderer

**Files:**
- Create: `tools/render_travel_landscapes.py`
- Create: `tests/test_travel_landscape_renderer.py`

**Interfaces:**
- Consumes: one generated raster source path plus output WebM and WebP paths.
- Produces: `make_seamless_tile(source, width, height) -> Image`, `render_frame(tile, frame_index, frame_count=450) -> Image`, and `encode_landscape(source_path, video_path, poster_path) -> None`.

- [ ] **Step 1: Write the failing renderer tests**

Create `tests/test_travel_landscape_renderer.py` with literal output
requirements:

```python
from pathlib import Path
import sys
import unittest

from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from render_travel_landscapes import (  # noqa: E402
    CANVAS,
    FRAME_COUNT,
    make_seamless_tile,
    render_frame,
)


class TravelLandscapeRendererTests(unittest.TestCase):
    def setUp(self):
        self.source = Image.new("RGB", (960, 540))
        pixels = self.source.load()
        for y in range(self.source.height):
            for x in range(self.source.width):
                pixels[x, y] = (
                    x % 256,
                    y % 256,
                    (x + y) % 256,
                )

    def test_renderer_targets_the_inventory_header_aspect_ratio(self):
        self.assertEqual(CANVAS, (1920, 450))
        self.assertEqual(FRAME_COUNT, 450)
        tile = make_seamless_tile(self.source, *CANVAS)
        frame = render_frame(tile, 0)
        self.assertEqual(frame.size, CANVAS)
        self.assertEqual(frame.mode, "RGB")

    def test_tile_edges_match_for_a_loop_safe_horizontal_wrap(self):
        tile = make_seamless_tile(self.source, *CANVAS)
        edge_delta = ImageChops.difference(
            tile.crop((0, 0, 1, tile.height)),
            tile.crop((tile.width - 1, 0, tile.width, tile.height)),
        )
        self.assertLessEqual(sum(ImageStat.Stat(edge_delta).mean), 1.0)

    def test_renderer_does_not_draw_a_baked_window_frame(self):
        tile = make_seamless_tile(self.source, *CANVAS)
        frame = render_frame(tile, 0)
        self.assertNotEqual(
            frame.getpixel((0, 0)),
            frame.getpixel((CANVAS[0] // 2, 0)),
        )


if __name__ == "__main__":
    unittest.main()
```

The third test protects against restoring the previous uniform leather/brass
edge overlay: the generated test image has varying source pixels across the top
row, and the renderer must preserve that variation.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m unittest tests/test_travel_landscape_renderer.py -v
```

Expected: import failure because `tools/render_travel_landscapes.py` does not
exist.

- [ ] **Step 3: Implement the pure renderer and streaming encoder**

Create `tools/render_travel_landscapes.py` with these public constants and
functions:

```python
from __future__ import annotations

import argparse
import math
from pathlib import Path
import subprocess

from PIL import Image, ImageChops, ImageDraw, ImageFilter


CANVAS = (1920, 450)
FRAME_COUNT = 450
FPS = 15
MIDGROUND_TOP = 205
FOREGROUND_TOP = 345
SEAM_BLEND = 260
RESAMPLING = Image.Resampling


def _cover_resize(source: Image.Image, width: int, height: int) -> Image.Image:
    image = source.convert("RGB")
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (math.ceil(image.width * scale), math.ceil(image.height * scale)),
        RESAMPLING.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def make_seamless_tile(
    source: Image.Image,
    width: int,
    height: int,
    blend_px: int = SEAM_BLEND,
) -> Image.Image:
    base = _cover_resize(source, width, height)
    half = width // 2
    overlap = min(max(2, blend_px), half - 1)
    left_segment = base.crop((half, 0, width, height))
    right_segment = base.crop((0, 0, half, height))
    merged = Image.new("RGB", (width - overlap, height))
    merged.paste(left_segment, (0, 0))
    ramp = Image.new("L", (overlap, 1))
    ramp.putdata([
        round(255 * index / max(1, overlap - 1))
        for index in range(overlap)
    ])
    ramp = ramp.resize((overlap, height))
    overlap_x = left_segment.width - overlap
    blended = Image.composite(
        right_segment.crop((0, 0, overlap, height)),
        left_segment.crop((overlap_x, 0, left_segment.width, height)),
        ramp,
    )
    merged.paste(blended, (overlap_x, 0))
    merged.paste(
        right_segment.crop((overlap, 0, right_segment.width, height)),
        (left_segment.width, 0),
    )
    tile = merged.resize((width, height), RESAMPLING.LANCZOS)
    tile.paste(tile.crop((0, 0, 1, height)), (width - 1, 0))
    return tile


def _scroll(tile: Image.Image, offset: int) -> Image.Image:
    return ImageChops.offset(tile, -(offset % tile.width), 0)


def _feather_mask(size: tuple[int, int], top: int, feather: int) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    opaque_top = min(height, top + feather)
    draw.rectangle((0, opaque_top, width, height), fill=255)
    for y in range(top, opaque_top):
        alpha = round(255 * (y - top) / max(1, feather - 1))
        draw.line((0, y, width, y), fill=alpha)
    return mask


def _horizontal_smear(image: Image.Image, distance: int = 4) -> Image.Image:
    left = ImageChops.offset(image, -distance, 0)
    right = ImageChops.offset(image, distance, 0)
    return Image.blend(Image.blend(left, image, 0.5), right, 1 / 3)


def render_frame(
    tile: Image.Image,
    frame_index: int,
    frame_count: int = FRAME_COUNT,
) -> Image.Image:
    if tile.size != CANVAS:
        tile = tile.resize(CANVAS, RESAMPLING.LANCZOS)
    progress = frame_index / frame_count
    width, _height = CANVAS
    far = _scroll(tile, round(progress * width))
    middle = _scroll(tile, round(progress * width * 1.5))
    near = _horizontal_smear(_scroll(tile, round(progress * width * 2)))
    landscape = far.copy()
    landscape.paste(
        middle,
        (0, 0),
        _feather_mask(CANVAS, MIDGROUND_TOP, 70),
    )
    landscape.paste(
        near,
        (0, 0),
        _feather_mask(CANVAS, FOREGROUND_TOP, 65),
    )
    vibration = round(math.sin(2 * math.pi * progress * 5))
    if vibration:
        landscape = ImageChops.offset(landscape, 0, vibration)
    return landscape.convert("RGB")


def encode_landscape(
    source_path: Path,
    video_path: Path,
    poster_path: Path,
) -> None:
    source = Image.open(source_path)
    tile = make_seamless_tile(source, *CANVAS)
    video_path.parent.mkdir(parents=True, exist_ok=True)
    poster_path.parent.mkdir(parents=True, exist_ok=True)
    poster = render_frame(tile, 0)
    poster.save(poster_path, "WEBP", quality=88, method=6)
    command = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s:v", f"{CANVAS[0]}x{CANVAS[1]}",
        "-r", str(FPS), "-i", "-",
        "-an", "-c:v", "libvpx-vp9",
        "-b:v", "0", "-crf", "34",
        "-deadline", "good", "-cpu-used", "2",
        "-row-mt", "1", "-pix_fmt", "yuv420p",
        str(video_path),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        assert process.stdin is not None
        for index in range(FRAME_COUNT):
            process.stdin.write(render_frame(tile, index).tobytes())
        process.stdin.close()
        return_code = process.wait()
    except BaseException:
        process.kill()
        process.wait()
        raise
    if return_code != 0:
        raise RuntimeError(f"ffmpeg exited with status {return_code}")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render one panoramic Rebreya travel landscape.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--poster", type=Path, required=True)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    encode_landscape(args.source, args.video, args.poster)
```

- [ ] **Step 4: Run the renderer tests and verify GREEN**

Run:

```powershell
python -m unittest tests/test_travel_landscape_renderer.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the renderer**

Run:

```powershell
git add -- tools/render_travel_landscapes.py tests/test_travel_landscape_renderer.py
git diff --cached --check
git commit -m "feat: add panoramic travel renderer"
```

Expected: the commit contains only the renderer and its Python tests.

---

### Task 2: Generate Three Clean Landscape Sources and Final Media

**Files:**
- Create: `assets/ui/rebreya-travel-industrial.webm`
- Create: `assets/ui/rebreya-travel-industrial-poster.webp`
- Create: `assets/ui/rebreya-travel-wilderness.webm`
- Create: `assets/ui/rebreya-travel-wilderness-poster.webp`
- Create: `assets/ui/rebreya-travel-city.webm`
- Create: `assets/ui/rebreya-travel-city-poster.webp`
- Use without committing: `C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/`

**Interfaces:**
- Consumes: `tools/render_travel_landscapes.py` and three built-in image
  generation results.
- Produces: six final media paths consumed by Task 3 descriptors and Task 5
  template rendering.

- [ ] **Step 1: Generate the industrial valley illustration**

Use the built-in image generation tool with no reference image:

```text
Use case: stylized-concept
Asset type: ultra-wide Foundry VTT travel header source
Primary request: a clean panoramic Victorian steampunk industrial valley seen sideways from a moving carriage or early motorcar
Scene/backdrop: rolling cultivated fields, brick steam factories, copper pipes, water towers without utility functions, distant mountains, a few elegant airships
Style/medium: polished hand-painted storybook illustration, slightly cartoon-like, detailed but readable at banner size
Composition/framing: landscape source with all important scenery concentrated in the central horizontal third; strong layered depth with distant sky and mountains, midground factories, low foreground grasses and stone walls; no frame or window trim
Lighting/mood: warm late-afternoon light, adventurous and inviting
Color palette: muted teal sky, warm ochre fields, graphite shadows, restrained brass and copper
Constraints: period Victorian steam technology only; no people close to camera; no text; no logo; no watermark
Avoid: electrical poles, telegraph poles, utility poles, overhead wires, power lines, modern streetlights, modern vehicles, modern road signs, baked border, window frame
```

Inspect the result at original resolution. Reject and regenerate if any pole,
wire, modern object, text, watermark, or baked frame is present.

- [ ] **Step 2: Generate the wilderness illustration**

Use the built-in image generation tool with no reference image:

```text
Use case: stylized-concept
Asset type: ultra-wide Foundry VTT travel header source
Primary request: a clean panoramic wild Victorian fantasy landscape seen sideways from a moving carriage or early motorcar
Scene/backdrop: layered mountains, pine and deciduous forest, a winding river, misty ravines, one distant stone viaduct and a tiny steam-powered lodge
Style/medium: polished hand-painted storybook illustration, slightly cartoon-like, detailed but readable at banner size
Composition/framing: landscape source with all important scenery concentrated in the central horizontal third; strong layered depth with distant peaks, midground forest and river, low foreground grasses and rocks; no frame or window trim
Lighting/mood: cool fresh morning with warm sun breaking through clouds, exploratory and serene
Color palette: desaturated blue-green, moss, slate, warm amber highlights, graphite shadows
Constraints: sparse period Victorian steam details only; no text; no logo; no watermark
Avoid: electrical poles, telegraph poles, utility poles, overhead wires, power lines, modern streetlights, modern vehicles, modern road signs, baked border, window frame
```

Inspect at original resolution and reject any forbidden element.

- [ ] **Step 3: Generate the city-outskirts illustration**

Use the built-in image generation tool with no reference image:

```text
Use case: stylized-concept
Asset type: ultra-wide Foundry VTT travel header source
Primary request: clean panoramic outskirts of a Victorian steampunk city seen sideways from a moving carriage or early motorcar
Scene/backdrop: stone and brick townhouses, arched bridges, distant domes and clockwork towers, horse carriages, a low steam railway with one compact locomotive, copper rooflines and drifting steam
Style/medium: polished hand-painted storybook illustration, slightly cartoon-like, detailed but readable at banner size
Composition/framing: landscape source with all important scenery concentrated in the central horizontal third; layered depth with distant skyline, midground streets and rail, low foreground masonry and shrubs; no frame or window trim
Lighting/mood: soft overcast golden-hour light, bustling but not crowded
Color palette: graphite, slate blue, weathered brick, muted brass, warm window light
Constraints: period Victorian steam technology only; railway signals must be mechanical ground signals without tall poles; no text; no logo; no watermark
Avoid: electrical poles, telegraph poles, utility poles, overhead wires, power lines, modern streetlights, modern vehicles, traffic signs, baked border, window frame
```

Inspect at original resolution and reject any forbidden element.

- [ ] **Step 4: Save approved sources outside committed source**

Copy the three selected built-in outputs into:

```text
C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/industrial.png
C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/wilderness.png
C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/city.png
```

Use `view_image` on all three saved paths before animation.

- [ ] **Step 5: Render the three WebM/poster pairs**

Run:

```powershell
python tools/render_travel_landscapes.py `
  --source 'C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/industrial.png' `
  --video 'assets/ui/rebreya-travel-industrial.webm' `
  --poster 'assets/ui/rebreya-travel-industrial-poster.webp'

python tools/render_travel_landscapes.py `
  --source 'C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/wilderness.png' `
  --video 'assets/ui/rebreya-travel-wilderness.webm' `
  --poster 'assets/ui/rebreya-travel-wilderness-poster.webp'

python tools/render_travel_landscapes.py `
  --source 'C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-sources/city.png' `
  --video 'assets/ui/rebreya-travel-city.webm' `
  --poster 'assets/ui/rebreya-travel-city-poster.webp'
```

- [ ] **Step 6: Validate all six media files**

Run the complete literal media set:

```powershell
$travelVideos = @(
  'assets/ui/rebreya-travel-industrial.webm',
  'assets/ui/rebreya-travel-wilderness.webm',
  'assets/ui/rebreya-travel-city.webm'
)
foreach ($video in $travelVideos) {
  ffprobe -v error `
    -count_frames `
    -select_streams v:0 `
    -show_entries stream=codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames `
    -show_entries format=duration,size `
    -of default=noprint_wrappers=1 `
    $video
  ffprobe -v error `
    -select_streams a `
    -show_entries stream=index `
    -of csv=p=0 `
    $video
  ffmpeg -v error -i $video -f null NUL
}
```

Expected for every video: VP9, `1920x450`, `yuv420p`, `15/1`, 450 frames,
30.000 seconds, blank audio query, and no decode output.

Run:

```powershell
magick identify `
  assets/ui/rebreya-travel-industrial-poster.webp `
  assets/ui/rebreya-travel-wilderness-poster.webp `
  assets/ui/rebreya-travel-city-poster.webp
```

Expected: every poster is WebP `1920x450`.

- [ ] **Step 7: Inspect animation contact sheets and loop boundaries**

Run:

```powershell
$reviewRoot = 'C:/Users/ill_lich/Documents/Codex/2026-07-30/new-chat/work/travel-landscape-review'
New-Item -ItemType Directory -Force -Path $reviewRoot | Out-Null
$scenes = @('industrial', 'wilderness', 'city')
$times = @('0', '7.5', '15', '22.5', '29.933333')
foreach ($scene in $scenes) {
  $video = "assets/ui/rebreya-travel-$scene.webm"
  $frames = @()
  for ($index = 0; $index -lt $times.Count; $index += 1) {
    $frame = "$reviewRoot/$scene-$index.png"
    ffmpeg -y -v error -ss $times[$index] -i $video -frames:v 1 $frame
    $frames += $frame
  }
  magick $frames +append "$reviewRoot/$scene-contact-sheet.png"
  ffmpeg -y -v error -ss 0 -i $video -frames:v 1 "$reviewRoot/$scene-first.png"
  ffmpeg -y -v error -ss 0.066667 -i $video -frames:v 1 "$reviewRoot/$scene-adjacent.png"
  ffmpeg -y -v error -ss 29.933333 -i $video -frames:v 1 "$reviewRoot/$scene-last.png"
  magick compare -metric RMSE `
    "$reviewRoot/$scene-first.png" `
    "$reviewRoot/$scene-adjacent.png" `
    null:
  magick compare -metric RMSE `
    "$reviewRoot/$scene-last.png" `
    "$reviewRoot/$scene-first.png" `
    null:
}
```

Use `view_image` on the three literal `*-contact-sheet.png` paths. Confirm no
forbidden visual elements and no baked frame. The second RMSE value for each
scene must be no more than 1.25 times its first adjacent-frame RMSE; otherwise
adjust the tile blend before committing media.

- [ ] **Step 8: Commit only the new media**

Run:

```powershell
git add -- `
  assets/ui/rebreya-travel-industrial.webm `
  assets/ui/rebreya-travel-industrial-poster.webp `
  assets/ui/rebreya-travel-wilderness.webm `
  assets/ui/rebreya-travel-wilderness-poster.webp `
  assets/ui/rebreya-travel-city.webm `
  assets/ui/rebreya-travel-city-poster.webp
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add selectable travel landscapes"
```

Expected: six media files only.

---

### Task 3: Add the Landscape Model and Local Persistence

**Files:**
- Create: `scripts/ui/travel-landscape-selector.js`
- Create: `tests/travel-landscape-selector.test.mjs`

**Interfaces:**
- Produces:
  - `TRAVEL_LANDSCAPES: readonly TravelLandscape[]`
  - `normalizeTravelLandscapeId(value) -> "industrial" | "wilderness" | "city"`
  - `createTravelLandscapeStorageKey({ worldId, userId }) -> string`
  - `loadTravelLandscapeId(options?) -> string`
  - `saveTravelLandscapeId(value, options?) -> string`
  - `prepareTravelLandscapeContext(value) -> { active, options }`

- [ ] **Step 1: Write failing selector-model tests**

Create `tests/travel-landscape-selector.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  TRAVEL_LANDSCAPES,
  createTravelLandscapeStorageKey,
  loadTravelLandscapeId,
  normalizeTravelLandscapeId,
  prepareTravelLandscapeContext,
  saveTravelLandscapeId
} from "../scripts/ui/travel-landscape-selector.js";

test("travel landscapes expose three distinct panoramic media pairs", () => {
  assert.deepEqual(
    TRAVEL_LANDSCAPES.map(({ id, number }) => ({ id, number })),
    [
      { id: "industrial", number: 1 },
      { id: "wilderness", number: 2 },
      { id: "city", number: 3 }
    ]
  );
  for (const landscape of TRAVEL_LANDSCAPES) {
    assert.match(landscape.videoUrl, /^\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-.+\.webm$/u);
    assert.match(landscape.posterUrl, /^\/modules\/rebreya-main\/assets\/ui\/rebreya-travel-.+-poster\.webp$/u);
  }
});

test("travel landscape ids fall back to industrial", () => {
  assert.equal(normalizeTravelLandscapeId("wilderness"), "wilderness");
  assert.equal(normalizeTravelLandscapeId(" city "), "city");
  assert.equal(normalizeTravelLandscapeId("unknown"), "industrial");
  assert.equal(normalizeTravelLandscapeId(null), "industrial");
});

test("travel landscape storage is scoped by world and user", () => {
  assert.equal(
    createTravelLandscapeStorageKey({ worldId: "reb-world", userId: "player-7" }),
    "rebreya-main.travelLandscape:reb-world:player-7"
  );
});

test("travel landscape storage reads, writes, and fails closed", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
  const options = { storage, worldId: "world-a", userId: "user-b" };
  assert.equal(loadTravelLandscapeId(options), "industrial");
  assert.equal(saveTravelLandscapeId("city", options), "city");
  assert.equal(loadTravelLandscapeId(options), "city");
  assert.equal(saveTravelLandscapeId("invalid", options), "industrial");
  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    }
  };
  assert.equal(loadTravelLandscapeId({ ...options, storage: throwingStorage }), "industrial");
  assert.equal(saveTravelLandscapeId("wilderness", { ...options, storage: throwingStorage }), "wilderness");
});

test("travel landscape context selects exactly one active option", () => {
  const context = prepareTravelLandscapeContext("wilderness");
  assert.equal(context.active.id, "wilderness");
  assert.deepEqual(
    context.options.map(({ id, selected, ariaPressed }) => ({ id, selected, ariaPressed })),
    [
      { id: "industrial", selected: false, ariaPressed: "false" },
      { id: "wilderness", selected: true, ariaPressed: "true" },
      { id: "city", selected: false, ariaPressed: "false" }
    ]
  );
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/travel-landscape-selector.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the selector model**

Create `scripts/ui/travel-landscape-selector.js` with the six exports named in
the interface. Use frozen literal descriptors:

```js
export const TRAVEL_LANDSCAPES = Object.freeze([
  Object.freeze({
    id: "industrial",
    number: 1,
    label: "Промышленная долина",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-industrial.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-industrial-poster.webp"
  }),
  Object.freeze({
    id: "wilderness",
    number: 2,
    label: "Дикая природа",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-wilderness.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-wilderness-poster.webp"
  }),
  Object.freeze({
    id: "city",
    number: 3,
    label: "Окраины города",
    videoUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-city.webm",
    posterUrl: "/modules/rebreya-main/assets/ui/rebreya-travel-city-poster.webp"
  })
]);
```

Use `"industrial"` as the default. Trim input before matching. Build storage
keys with trimmed `worldId` and `userId`, falling back to `"unknown-world"` and
`"anonymous"`. Resolve default environment values at call time from
`globalThis.game` and access `globalThis.localStorage` inside `try` blocks so a
throwing browser getter cannot break the inventory.

`prepareTravelLandscapeContext` returns cloned descriptor objects, adds
`selected` and string-valued `ariaPressed`, and exposes the matching descriptor
as `active`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
node --test tests/travel-landscape-selector.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit the selector model**

Run:

```powershell
git add -- scripts/ui/travel-landscape-selector.js tests/travel-landscape-selector.test.mjs
git diff --cached --check
git commit -m "feat: add local travel landscape selection"
```

---

### Task 4: Integrate Landscape State and Selection Into InventoryApp

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: Task 3 `loadTravelLandscapeId`, `normalizeTravelLandscapeId`,
  `prepareTravelLandscapeContext`, and `saveTravelLandscapeId`.
- Produces: `context.travelLandscape` and
  `[data-action="select-travel-landscape"]` click behavior.

- [ ] **Step 1: Write the failing context test**

Extend
`"InventoryApp allows travel tab and maps travel snapshot into context"` with
world/user-scoped storage. Install these values before importing InventoryApp
and constructing the app:

```js
const previousGame = globalThis.game;
const previousLocalStorage = globalThis.localStorage;
const stored = new Map([
  ["rebreya-main.travelLandscape:world-1:user-1", "city"]
]);
globalThis.game = {
  world: { id: "world-1" },
  user: { id: "user-1" }
};
globalThis.localStorage = {
  getItem(key) {
    return stored.get(key) ?? null;
  },
  setItem(key, value) {
    stored.set(key, value);
  }
};
```

After `_prepareContext`, add:

```js
assert.equal(context.travelLandscape.active.id, "city");
assert.equal(context.travelLandscape.options.length, 3);
assert.equal(
  context.travelLandscape.options.filter((option) => option.selected).length,
  1
);
```

Restore both globals in that test's `finally` block:

```js
globalThis.game = previousGame;
globalThis.localStorage = previousLocalStorage;
restoreFoundry();
```

- [ ] **Step 2: Write the failing click-handler test**

Add this complete test beside the other `_onRender` interaction tests:

```js
test("InventoryApp stores a local travel landscape choice and rerenders once", async () => {
  const restoreFoundry = installFoundryApplicationStub();
  const dom = installMinimalDom();
  const previousGame = globalThis.game;
  const previousLocalStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.game = {
    world: { id: "world-1" },
    user: { id: "user-1" }
  };
  globalThis.localStorage = {
    getItem(key) {
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      stored.set(key, value);
    }
  };

  try {
    const { InventoryApp } = await import(
      `../scripts/ui/inventory-app.js?travel-landscape-click=${Date.now()}`
    );
    const choice = createFakeElement({
      dataset: { landscapeId: "wilderness" }
    });
    const root = createFakeElement({ closest: () => root });
    root.querySelector = () => null;
    root.querySelectorAll = (selector) => (
      selector === "[data-action='select-travel-landscape']"
        ? [choice]
        : []
    );
    const app = new InventoryApp(createModuleApi({
      getGroupContext: () => null
    }));
    const renderCalls = [];
    app.element = root;
    app.render = async (options) => {
      renderCalls.push(options);
    };

    await app._onRender({}, {});
    await dispatchClick(choice);
    await dispatchClick(choice);

    assert.deepEqual(renderCalls, [{ force: true, preserveScroll: true }]);
    assert.equal(
      stored.get("rebreya-main.travelLandscape:world-1:user-1"),
      "wilderness"
    );
  }
  finally {
    globalThis.game = previousGame;
    globalThis.localStorage = previousLocalStorage;
    dom.restore();
    restoreFoundry();
  }
});
```

- [ ] **Step 3: Verify both tests are RED**

Run:

```powershell
node --test --test-name-pattern="travel landscape" tests/inventory-app-context.test.mjs
```

Expected: failures because InventoryApp has no landscape state, context, or
button binding.

- [ ] **Step 4: Implement InventoryApp integration**

Import the Task 3 helpers near the other `./` UI imports:

```js
import {
  loadTravelLandscapeId,
  normalizeTravelLandscapeId,
  prepareTravelLandscapeContext,
  saveTravelLandscapeId
} from "./travel-landscape-selector.js";
```

Initialize in the constructor:

```js
this.travelLandscapeId = loadTravelLandscapeId();
```

Add to the `_prepareContext` return object beside `travel`:

```js
travelLandscape: prepareTravelLandscapeContext(this.travelLandscapeId),
```

Bind the buttons in `_onRender` immediately after tab buttons:

```js
element.querySelectorAll("[data-action='select-travel-landscape']").forEach((button) => {
  button.addEventListener("click", (event) => {
    const nextLandscapeId = normalizeTravelLandscapeId(
      event.currentTarget.dataset.landscapeId
    );
    if (nextLandscapeId === this.travelLandscapeId) {
      return;
    }
    this.travelLandscapeId = saveTravelLandscapeId(nextLandscapeId);
    this.render({ force: true, preserveScroll: true });
  }, listenerOptions);
});
```

- [ ] **Step 5: Verify GREEN and the complete inventory test file**

Run:

```powershell
node --test --test-name-pattern="travel landscape" tests/inventory-app-context.test.mjs
node --test tests/inventory-app-context.test.mjs
```

Expected: focused tests and all InventoryApp tests pass.

- [ ] **Step 6: Commit InventoryApp integration**

Run:

```powershell
git add -- scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs
git diff --cached --check
git commit -m "feat: connect travel landscape selection"
```

---

### Task 5: Render the Active Video, CSS Window, and Round Controls

**Files:**
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `travelLandscape.active` and `travelLandscape.options` from Task 4.
- Produces: one active video, three accessible selector buttons, and a
  theme-native CSS overlay frame.

- [ ] **Step 1: Replace the current static template assertions with RED expectations**

Update the existing travel-header test to require:

```text
poster="{{travelLandscape.active.posterUrl}}"
src="{{travelLandscape.active.videoUrl}}"
role="group"
aria-label="Выбор пейзажа путешествия"
data-action="select-travel-landscape"
data-landscape-id="{{id}}"
aria-pressed="{{ariaPressed}}"
{{number}}
```

Assert the video block contains one `<video>` and one `<source>`, while the
selector uses `{{#each travelLandscape.options}}`. Assert the old literal
`rebreya-travel-window.webm` and poster paths are absent from the template.

Update CSS expectations to require:

```text
.rm-inventory-book__header--travel::after
object-fit: cover
.rm-inventory-book__travel-selector
.rm-inventory-book__travel-choice
border-radius: 50%
.rm-inventory-book__travel-choice.is-active
```

Assert `object-fit: fill` is absent.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test --test-name-pattern="travel video frame" tests/inventory-app-context.test.mjs
```

Expected: failures on static media paths, missing selector, missing CSS frame,
and `object-fit: fill`.

- [ ] **Step 3: Update the Handlebars travel block**

Keep the existing `tabs.isTravel` guard. Replace literal poster/source paths
with:

```hbs
poster="{{travelLandscape.active.posterUrl}}"
```

and:

```hbs
src="{{travelLandscape.active.videoUrl}}"
```

After `</video>`, add:

```hbs
<div
  class="rm-inventory-book__travel-selector"
  role="group"
  aria-label="Выбор пейзажа путешествия"
>
  {{#each travelLandscape.options}}
    <button
      type="button"
      class="rm-inventory-book__travel-choice{{#if selected}} is-active{{/if}}"
      data-action="select-travel-landscape"
      data-landscape-id="{{id}}"
      aria-label="Пейзаж {{number}}: {{label}}"
      aria-pressed="{{ariaPressed}}"
      title="{{label}}"
    >
      {{number}}
    </button>
  {{/each}}
</div>
```

- [ ] **Step 4: Replace the stretched-video CSS with purpose-built panoramic CSS**

Set the video back to:

```css
object-fit: cover;
object-position: center;
```

Keep both masks at `none`. Add a travel-only `::after` frame with:

```css
.rebreya-inventory-app .rm-inventory-book__header--travel::after {
  content: "";
  position: absolute;
  z-index: 1;
  inset: 8px;
  border: 2px solid rgb(var(--rm-color-gold-rgb) / 0.72);
  border-radius: 10px;
  background:
    linear-gradient(90deg, var(--rm-color-surface) 0 16px, transparent 16px calc(100% - 16px), var(--rm-color-surface) calc(100% - 16px)),
    linear-gradient(180deg, var(--rm-color-surface) 0 12px, transparent 12px calc(100% - 12px), var(--rm-color-surface) calc(100% - 12px));
  box-shadow:
    inset 0 0 0 2px rgb(var(--rm-color-ink-rgb) / 0.9),
    inset 0 0 24px rgb(var(--rm-color-ink-rgb) / 0.66),
    0 0 0 1px rgb(var(--rm-color-gold-rgb) / 0.2);
  pointer-events: none;
}
```

Move shared header content to `z-index: 2`. Add selector rules:

```css
.rebreya-inventory-app .rm-inventory-book__travel-selector {
  position: absolute;
  z-index: 3;
  right: 22px;
  bottom: 20px;
  display: flex;
  gap: 7px;
  padding: 6px;
  border: 1px solid var(--rm-border-strong);
  border-radius: 999px;
  background: rgb(var(--rm-color-ink-rgb) / 0.82);
  box-shadow: 0 5px 16px rgb(0 0 0 / 0.42);
}

.rebreya-inventory-app .rm-inventory-book__travel-choice {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--rm-border-strong);
  border-radius: 50%;
  background: var(--rm-surface-2);
  color: var(--rm-text-secondary);
  font-weight: 700;
  cursor: pointer;
}

.rebreya-inventory-app .rm-inventory-book__travel-choice:hover,
.rebreya-inventory-app .rm-inventory-book__travel-choice:focus-visible {
  border-color: var(--rm-accent-strong);
  color: var(--rm-text-primary);
}

.rebreya-inventory-app .rm-inventory-book__travel-choice:focus-visible {
  outline: 2px solid var(--rm-accent-strong);
  outline-offset: 2px;
}

.rebreya-inventory-app .rm-inventory-book__travel-choice.is-active {
  border-color: var(--rm-accent-strong);
  background: linear-gradient(180deg, var(--rm-accent-strong), var(--rm-accent));
  color: var(--rm-color-ink);
  box-shadow: 0 0 12px rgb(var(--rm-color-gold-rgb) / 0.42);
}
```

- [ ] **Step 5: Verify focused, InventoryApp, and style tests**

Run:

```powershell
node --test --test-name-pattern="travel video frame" tests/inventory-app-context.test.mjs
node --test tests/inventory-app-context.test.mjs
node --test tests/style-theme.test.mjs
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the template and CSS integration**

Run:

```powershell
git add -- templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git diff --cached --check
git commit -m "feat: add themed travel landscape controls"
```

---

### Task 6: Remove Obsolete Media, Validate Foundry, and Push

**Files:**
- Delete: `assets/ui/rebreya-travel-window.webm`
- Delete: `assets/ui/rebreya-travel-window-poster.webp`
- Inspect: every file changed by Tasks 1–5

**Interfaces:**
- Consumes: the complete selector implementation and six replacement assets.
- Produces: a verified, normally pushed `origin/lich_branch`.

- [ ] **Step 1: Prove no consumer references the old media**

Run:

```powershell
rg -n "rebreya-travel-window" scripts templates styles tests module.json
```

Expected: no matches.

- [ ] **Step 2: Remove the obsolete committed media**

Run:

```powershell
git rm -- `
  assets/ui/rebreya-travel-window.webm `
  assets/ui/rebreya-travel-window-poster.webp
git diff --cached --check
git commit -m "chore: remove obsolete travel media"
```

- [ ] **Step 3: Run fresh automated verification**

Run:

```powershell
git diff --check
python -m unittest tests/test_travel_landscape_renderer.py -v
node --test tests/travel-landscape-selector.test.mjs
node --test tests/inventory-app-context.test.mjs
node --test tests/style-theme.test.mjs
$trackedTests = @(git ls-files 'tests/*.test.mjs')
node --test $trackedTests
```

Expected: Python tests, focused Node tests, and the complete tracked Node suite
all pass with zero failures.

- [ ] **Step 4: Repeat final media validation**

Run the exact FFprobe, audio-stream, FFmpeg full-decode, and ImageMagick checks
from Task 2 against all committed media. Expected: all three videos satisfy the
global media constraints and every poster is `1920x450`.

- [ ] **Step 5: Perform visual Foundry QA when the authenticated client is available**

Flow:

```text
Open party inventory -> select Travel -> click 1, 2, 3 -> close and reopen the inventory -> switch to another tab -> resize the window.
```

Verify:

- each button loads the matching scene and only one `<video>` exists;
- button `aria-pressed` and gold active styling update;
- the selected scene survives close/reopen for the same user;
- another user keeps their own choice;
- CSS trim is sharp, proportional, and matches graphite/brass controls;
- scenery is not stretched and contains no poles or wires;
- video remains behind readable header content;
- other tabs still show the workshop background;
- no relevant console errors or failed media requests.

If authentication blocks browser QA, report the limitation and do not claim the
live Foundry check passed.

- [ ] **Step 6: Request read-only code and media review**

Give the reviewer the base SHA before Task 1 and the current HEAD. Ask for
Critical/Important/Minor findings on:

- storage isolation and failure handling;
- render/listener behavior;
- one-video-only performance;
- Handlebars accessibility;
- CSS stacking and resizing;
- media dimensions, loop, and forbidden visual elements.

Fix Critical and Important findings before proceeding.

- [ ] **Step 7: Recheck the shared branch immediately before push**

Run:

```powershell
git status --short --branch
git branch --show-current
git fetch origin --prune
git rev-list --left-right --count HEAD...origin/lich_branch
git rev-list --left-right --count HEAD...origin/main
git log --oneline --decorate -12
```

Stop if `origin/lich_branch` has commits missing locally. Preserve unrelated
user work and never force-push.

- [ ] **Step 8: Push normally and verify synchronization**

Run:

```powershell
git push origin lich_branch
git status --short --branch
git rev-list --left-right --count HEAD...origin/lich_branch
```

Expected: normal push succeeds and the final comparison is `0 0`.
