# City Map Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully regenerate and replace eight rejected city maps while preserving filenames, rank-based dimensions, WebP encoding, and the established hand-drawn fantasy-atlas style.

**Architecture:** Generate every city independently from its canonical metadata and the approved visual brief; do not use the rejected image as a composition source. Keep generated PNG sources and backups in a dedicated staging tree, accept each source only after visual camera/theme review, then resize once with ImageMagick Lanczos and encode WebP quality 92 into the external Foundry asset tree. Finish with metadata, visual, and non-target preservation audits.

**Tech Stack:** Built-in `image_gen`; local `view_image`; PowerShell; ImageMagick 7.1.2; Pillow 12.2 with WebP support.

## Global Constraints

- Scope is exactly eight maps: Унед, Пульвели, Мура, Заброшенный замок, Фронселье, Мис'Даркай, Йорсвик, Центральный собор.
- Do not modify Фриаден or any other city map.
- Use exact 90-degree orthographic top-down projection. No horizon, vanishing point, isometric angle, visible facade, or visible side wall.
- Show the complete city footprint and meaningful surrounding geography in a square composition.
- Use detailed hand-drawn fantasy cartography with crisp dark outlines, readable roads and districts, natural colors, and subtle watercolor/paper texture.
- Render no text, letters, numbers, labels, titles, legends, frames, grids, map markers, crests, logos, signatures, or watermarks.
- Preserve rank dimensions: rank 1 is 3000×3000, rank 2 is 3500×3500, rank 4 is 4500×4500, rank 6 is 5500×5500, and rank 9 is 7000×7000.
- Final format is WebP quality 92, written under `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N`.
- Do not overwrite a final file until its replacement source has passed visual review.
- Create recoverable backups before replacing any final file.
- Built-in image generation is the approved mode; do not switch to CLI/API fallback.

---

## File Structure

- Create: `tmp/city-map-regeneration/source/<id>.png` — accepted generated source for each replacement.
- Create: `tmp/city-map-regeneration/backup/Ранг N/<city>.webp` — recoverable copy of each old final.
- Create: `tmp/city-map-regeneration/review-eight.jpg` — final contact sheet used only for review.
- Modify externally: `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N\<city>.webp` — exactly eight final assets.
- Do not modify: `tmp/city-map-pilot/source/friaden.png` or `...\Ранг 3\Фриаден.webp`.

## Shared Generation Contract

Every generation prompt below must include this camera contract verbatim:

```text
NON-NEGOTIABLE CAMERA REQUIREMENT: exact 90-degree orthographic top-down plan view, optical axis perfectly perpendicular to the ground. The image must read as a flat architectural site plan. Show roofs and footprints only. No horizon, no vanishing point, no perspective convergence, no isometric projection, no oblique aerial view, no visible front/back/side facades, and no leaning structures. Circular towers and plazas must remain true circles, not ellipses. If any building facade is visible, the result is invalid.
```

Every prompt must end with this output contract:

```text
Square composition showing the entire settlement and meaningful surroundings. Detailed hand-drawn fantasy atlas cartography, crisp dark outlines, readable roads and districts, natural colors, subtle watercolor and paper texture. No text, letters, numbers, labels, title, legend, border, frame, grid, symbols, crest, logo, signature, or watermark. Do not crop the main settlement or its defining landmark.
```

### Task 1: Establish Baseline and Recoverable Backups

**Files:**
- Create: `tmp/city-map-regeneration/backup/Ранг 1/Унед.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 1/Пульвели.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 1/Мура.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 2/Заброшенный замок.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 2/Фронселье.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 4/Мис'Даркай.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 6/Йорсвик.webp`
- Create: `tmp/city-map-regeneration/backup/Ранг 9/Центральный собор.webp`

**Interfaces:**
- Consumes: Existing external WebP assets.
- Produces: Eight backup files and baseline SHA-256 hashes for all 44 final maps.

- [ ] **Step 1: Resolve exact source and backup roots**

```powershell
$assetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам'
$stageRoot = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-regeneration'
$backupRoot = Join-Path $stageRoot 'backup'
$sourceRoot = Join-Path $stageRoot 'source'
New-Item -ItemType Directory -Force -Path $backupRoot,$sourceRoot | Out-Null
```

- [ ] **Step 2: Verify all eight targets exist before copying**

```powershell
$targets = @(
  @{ Rank='Ранг 1'; Name='Унед.webp' },
  @{ Rank='Ранг 1'; Name='Пульвели.webp' },
  @{ Rank='Ранг 1'; Name='Мура.webp' },
  @{ Rank='Ранг 2'; Name='Заброшенный замок.webp' },
  @{ Rank='Ранг 2'; Name='Фронселье.webp' },
  @{ Rank='Ранг 4'; Name="Мис'Даркай.webp" },
  @{ Rank='Ранг 6'; Name='Йорсвик.webp' },
  @{ Rank='Ранг 9'; Name='Центральный собор.webp' }
)
$missing = $targets | Where-Object { -not (Test-Path -LiteralPath (Join-Path (Join-Path $assetRoot $_.Rank) $_.Name)) }
if ($missing.Count -ne 0) { throw "Missing replacement target: $($missing | ConvertTo-Json -Compress)" }
```

- [ ] **Step 3: Copy each current target into the backup tree**

```powershell
foreach ($target in $targets) {
  $rankBackup = Join-Path $backupRoot $target.Rank
  New-Item -ItemType Directory -Force -Path $rankBackup | Out-Null
  $from = Join-Path (Join-Path $assetRoot $target.Rank) $target.Name
  $to = Join-Path $rankBackup $target.Name
  Copy-Item -LiteralPath $from -Destination $to -Force
}
```

- [ ] **Step 4: Verify backup hashes match their sources**

```powershell
foreach ($target in $targets) {
  $from = Join-Path (Join-Path $assetRoot $target.Rank) $target.Name
  $to = Join-Path (Join-Path $backupRoot $target.Rank) $target.Name
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $from).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $to).Hash) {
    throw "Backup hash mismatch: $($target.Name)"
  }
}
```

- [ ] **Step 5: Capture all 44 current final hashes in the execution transcript**

```powershell
Get-ChildItem -LiteralPath $assetRoot -Recurse -File -Filter '*.webp' |
  Sort-Object FullName |
  ForEach-Object { "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash,$_.FullName }
```

Expected: exactly 44 hash lines. Preserve this output for the final non-target comparison.

### Task 2: Regenerate Rank 1 Maps

**Files:**
- Create: `tmp/city-map-regeneration/source/uned.png`
- Create: `tmp/city-map-regeneration/source/pulveli.png`
- Create: `tmp/city-map-regeneration/source/mura.png`
- Modify externally: rank 1 `Унед.webp`, `Пульвели.webp`, `Мура.webp`

**Interfaces:**
- Consumes: Shared Generation Contract and built-in `image_gen` output paths.
- Produces: Three visually accepted PNG sources and three 3000×3000 WebPs.

- [ ] **Step 1: Generate Унед from scratch**

Use one built-in `image_gen` call with no referenced image and this complete subject block between the shared camera and output contracts:

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create the small southern frontier town of Uned, rank 1, population about 120, on open green meadow at the hard edge of a dangerous dry wasteland. The settlement belongs to adventurers and expedition seekers: a rough central inn, supply sheds, modest stables, wagon yards, camp preparation spaces, trailheads leading south, and only a few sparse residential clusters. Keep it humble and lightly built, with no palace, monumental temple, or grand fortification. The contrast between safe meadow and hostile wasteland must explain the town's identity.
```

- [ ] **Step 2: Inspect Унед before accepting it**

Open the generated source with `view_image`. Accept only if the camera is exactly vertical, no facade or wall side is visible, the settlement remains rank 1, and both meadow and wasteland are visible. Copy the accepted generated image to `tmp/city-map-regeneration/source/uned.png`.

- [ ] **Step 3: Generate Пульвели from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create Pulveli, a tiny rank 1 rural scholarly settlement on temperate meadow, population about 120. A compact but unusually important library and small magical academy form the center, surrounded by modest study gardens, herb plots, two small courtyards, a few teachers' houses, simple student lodging, farms, and open grass. The library and academy should be prominent relative to the village but must not turn it into a metropolis. Use restrained magical details visible from above, with no glowing runes or written symbols.
```

- [ ] **Step 4: Inspect Пульвели before accepting it**

Open with `view_image`. Require exact vertical projection, a visibly tiny village, a readable library/academy core, and no text-like markings. Copy the accepted result to `tmp/city-map-regeneration/source/pulveli.png`.

- [ ] **Step 5: Generate Мура from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create Mura, a lost ancestral tabaxi settlement, rank 1, population about 120, hidden in meadow and tall grass. Use organic winding paths, rounded feline-scale courtyards, lightweight timber and woven-roof structures, climbing platforms whose footprints remain readable from directly above, small communal circles, and weathered abandoned edges reclaimed by grass and vines. The settlement should feel culturally non-human without using written glyphs, giant cat statues, paw-print symbols, or novelty architecture. Keep it sparse, old, and half-forgotten.
```

- [ ] **Step 6: Inspect Мура before accepting it**

Open with `view_image`. Require only roofs/footprints, no side walls, no oversized landmark, organic tabaxi layout, and a clearly lost/reclaimed edge. Copy the accepted result to `tmp/city-map-regeneration/source/mura.png`.

- [ ] **Step 7: Convert and replace the three rank 1 finals**

For each accepted PNG, run ImageMagick with exact output names:

```powershell
$magick = (Get-Command magick -ErrorAction Stop).Source
& $magick "$sourceRoot\uned.png" -filter Lanczos -resize '3000x3000!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 1\Унед.webp"
& $magick "$sourceRoot\pulveli.png" -filter Lanczos -resize '3000x3000!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 1\Пульвели.webp"
& $magick "$sourceRoot\mura.png" -filter Lanczos -resize '3000x3000!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 1\Мура.webp"
if ($LASTEXITCODE -ne 0) { throw 'Rank 1 WebP conversion failed' }
```

- [ ] **Step 8: Verify rank 1 metadata and reopen all three WebPs**

```powershell
& $magick identify -format '%f %m %wx%h%n' "$assetRoot\Ранг 1\Унед.webp" "$assetRoot\Ранг 1\Пульвели.webp" "$assetRoot\Ранг 1\Мура.webp"
```

Expected: three `WEBP 3000x3000` results. Reopen each final with `view_image` and confirm resizing introduced no corruption.

### Task 3: Regenerate Rank 2 Maps

**Files:**
- Create: `tmp/city-map-regeneration/source/zabroshennyy-zamok.png`
- Create: `tmp/city-map-regeneration/source/fronsele.png`
- Modify externally: rank 2 `Заброшенный замок.webp`, `Фронселье.webp`

**Interfaces:**
- Consumes: Shared Generation Contract and built-in `image_gen` output paths.
- Produces: Two accepted PNG sources and two 3500×3500 WebPs.

- [ ] **Step 1: Generate Заброшенный замок from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create a small rank 2 desert refugee settlement, population about 600, clustered tightly against and partly inside the ruins of an old abandoned castle. The ruined fortress must read as a flat archaeological plan of broken curtain walls, open courtyards, collapsed rooms, rubble gaps, and circular tower foundations; never show a castle facade. Refugee homes, patched awnings, animal pens, wells, storage yards, and narrow sheltered lanes should crowd the safer sides of the ruins. Surround it with open arid desert, scattered rocks, and approach tracks. The ruined castle is an emergency shelter, not a restored palace.
```

- [ ] **Step 2: Inspect Заброшенный замок before accepting it**

Require exact 90° plan geometry across both ruins and houses. Reject any visible tower/window/door facade, stair-front elevation, or oblique cliff. Copy the accepted result to `tmp/city-map-regeneration/source/zabroshennyy-zamok.png`.

- [ ] **Step 3: Generate Фронселье from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create Fronsele, a compact rank 2 island settlement, population about 600, among distinctive rose-colored lagoons. Organize modest residential blocks, small docks, salt pans, evaporation pools, dye workshops, drying yards, and footbridges around unusual pink water and a few clear turquoise channels. The rose color belongs to specific lagoons and production pools; keep land, roofs, vegetation, and shadows naturally colored and avoid a uniform pink haze. The settlement must remain small and practical rather than ceremonial.
```

- [ ] **Step 4: Inspect Фронселье before accepting it**

Require a strict plan view, localized rose lagoons, readable salt/dye production, compact rank 2 density, and no visible facades. Copy the accepted result to `tmp/city-map-regeneration/source/fronsele.png`.

- [ ] **Step 5: Convert and replace the two rank 2 finals**

```powershell
& $magick "$sourceRoot\zabroshennyy-zamok.png" -filter Lanczos -resize '3500x3500!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 2\Заброшенный замок.webp"
& $magick "$sourceRoot\fronsele.png" -filter Lanczos -resize '3500x3500!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 2\Фронселье.webp"
if ($LASTEXITCODE -ne 0) { throw 'Rank 2 WebP conversion failed' }
```

- [ ] **Step 6: Verify rank 2 metadata and reopen both WebPs**

```powershell
& $magick identify -format '%f %m %wx%h%n' "$assetRoot\Ранг 2\Заброшенный замок.webp" "$assetRoot\Ранг 2\Фронселье.webp"
```

Expected: two `WEBP 3500x3500` results followed by clean visual review.

### Task 4: Regenerate Мис'Даркай and Йорсвик

**Files:**
- Create: `tmp/city-map-regeneration/source/mis-darkay.png`
- Create: `tmp/city-map-regeneration/source/yorsvik.png`
- Modify externally: rank 4 `Мис'Даркай.webp`
- Modify externally: rank 6 `Йорсвик.webp`

**Interfaces:**
- Consumes: Shared Generation Contract and built-in `image_gen` output paths.
- Produces: One dense 4500×4500 city and one large 5500×5500 industrial forest city.

- [ ] **Step 1: Generate Мис'Даркай from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create Mis'Darkay as a genuine inhabited rank 4 craft city of about 12,000 people in an ancient wet forest. A massive old fortress from the era before the wetlands forms the central stone core, sustained by residual magic. Around it build continuous dense urban fabric: several residential quarters, a market square, artisan streets, smithing and woodworking compounds, warehouses, civic courtyards, bridges, drainage channels, gates, and permanent outer neighborhoods. Wetland water, roots, moss, and old trees encroach at the edges and between some walls, but the result must unmistakably be a compact working city, not a camp, collection of platforms, or scattered ruins. Make streets and districts clearly legible from above.
```

- [ ] **Step 2: Inspect Мис'Даркай before accepting it**

Reject if tents, empty clearings, isolated huts, or disconnected platforms dominate. Require a dense continuous city, central ancient fortress, multiple permanent districts, wetland pressure, exact top-down camera, and no facade direction. Copy to `tmp/city-map-regeneration/source/mis-darkay.png`.

- [ ] **Step 3: Generate Йорсвик from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create Yorsvik as a large rank 6 industrial road city of about 80,000 people embedded in a broad natural forest region. The city must have many dense permanent urban quarters, major radial and cross-country roads, wagon factories, shield workshops, simple spear and military supply yards, sawmills, timber storage, repair depots, warehouses, worker neighborhoods, markets, and caravan staging grounds. Surround it with a believable varied forest: irregular canopy edges, mixed tree sizes and species, dense old stands, younger regrowth, clearings, selective logging patches, winding streams, and non-repeating clusters. Avoid evenly spaced trees, copied tree stamps, wallpaper texture, rectangular forest grid, or a small logging camp. The city must visually read as a major industrial center.
```

- [ ] **Step 4: Inspect Йорсвик before accepting it**

Require rank 6 density and footprint, multiple industrial districts, strong road hierarchy, and a forest with visibly irregular natural variation. Reject repeating canopy patterns or a settlement that reads as a village. Copy to `tmp/city-map-regeneration/source/yorsvik.png`.

- [ ] **Step 5: Convert and replace the two finals**

```powershell
& $magick "$sourceRoot\mis-darkay.png" -filter Lanczos -resize '4500x4500!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 4\Мис'Даркай.webp"
& $magick "$sourceRoot\yorsvik.png" -filter Lanczos -resize '5500x5500!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 6\Йорсвик.webp"
if ($LASTEXITCODE -ne 0) { throw 'Rank 4/6 WebP conversion failed' }
```

- [ ] **Step 6: Verify metadata and reopen both WebPs**

```powershell
& $magick identify -format '%f %m %wx%h%n' "$assetRoot\Ранг 4\Мис'Даркай.webp" "$assetRoot\Ранг 6\Йорсвик.webp"
```

Expected: `Мис'Даркай.webp WEBP 4500x4500` and `Йорсвик.webp WEBP 5500x5500`.

### Task 5: Regenerate Центральный собор as Persian Crystal City

**Files:**
- Create: `tmp/city-map-regeneration/source/tsentralnyy-sobor.png`
- Modify externally: rank 9 `Центральный собор.webp`

**Interfaces:**
- Consumes: Shared Generation Contract and built-in `image_gen` output path.
- Produces: One accepted Persian crystal temple-city source and a 7000×7000 WebP.

- [ ] **Step 1: Generate Центральный собор from scratch**

```text
Use case: stylized-concept.
Asset type: Foundry VTT regional city map.
Create the Central Cathedral as an immense isolated rank 9 crystal temple-city built to receive the divine being Vullon. The environment and architecture must be Persian-inspired, warm, and arid, never winter. Build a vast radial sacred city from pale warm sandstone, turquoise crystal, lapis-blue inlays, gold details, monumental geometric courtyards, Persian chahar bagh gardens divided into four parts, straight water channels, reflecting pools, arcaded roof plans, dense surrounding quarters, and a spectacular central crystalline sanctuary. Show dry ochre terrain and cultivated oasis gardens outside the walls. Use abstract architectural geometry only; no readable religious symbols or writing. Explicitly exclude snow, ice, frost, glaciers, frozen water, white winter ground, cold blue wilderness, pine forest, or polar mountains.
```

- [ ] **Step 2: Inspect the generated source before accepting it**

Require a warm Persian visual identity, clear chahar bagh gardens and channels, immense rank 9 density, turquoise/lapis/gold crystal architecture, and zero winter elements. Verify strict top-down geometry even on the central sanctuary. Copy to `tmp/city-map-regeneration/source/tsentralnyy-sobor.png`.

- [ ] **Step 3: Convert and replace the rank 9 final**

```powershell
& $magick "$sourceRoot\tsentralnyy-sobor.png" -filter Lanczos -resize '7000x7000!' -strip -define webp:method=6 -quality 92 "$assetRoot\Ранг 9\Центральный собор.webp"
if ($LASTEXITCODE -ne 0) { throw 'Central Cathedral WebP conversion failed' }
```

- [ ] **Step 4: Verify metadata and reopen the final WebP**

```powershell
& $magick identify -format '%f %m %wx%h%n' "$assetRoot\Ранг 9\Центральный собор.webp"
```

Expected: `Центральный собор.webp WEBP 7000x7000`, followed by visual confirmation of warm arid terrain and no snow/ice.

### Task 6: Final Preservation and Visual Audit

**Files:**
- Create: `tmp/city-map-regeneration/review-eight.jpg`
- Verify externally: all eight replacement WebPs and all 36 untouched WebPs.

**Interfaces:**
- Consumes: Eight final replacement WebPs and the Task 1 baseline hash transcript.
- Produces: A final contact sheet and evidence that only eight intended files changed.

- [ ] **Step 1: Assert the exact dimensions and formats of all eight replacements**

```powershell
$expected = @(
  @{ Path="$assetRoot\Ранг 1\Унед.webp"; Size='3000x3000' },
  @{ Path="$assetRoot\Ранг 1\Пульвели.webp"; Size='3000x3000' },
  @{ Path="$assetRoot\Ранг 1\Мура.webp"; Size='3000x3000' },
  @{ Path="$assetRoot\Ранг 2\Заброшенный замок.webp"; Size='3500x3500' },
  @{ Path="$assetRoot\Ранг 2\Фронселье.webp"; Size='3500x3500' },
  @{ Path="$assetRoot\Ранг 4\Мис'Даркай.webp"; Size='4500x4500' },
  @{ Path="$assetRoot\Ранг 6\Йорсвик.webp"; Size='5500x5500' },
  @{ Path="$assetRoot\Ранг 9\Центральный собор.webp"; Size='7000x7000' }
)
foreach ($item in $expected) {
  $actual = & $magick identify -format '%m %wx%h' $item.Path
  if ($actual -ne "WEBP $($item.Size)") { throw "Invalid final: $($item.Path) => $actual" }
}
```

- [ ] **Step 2: Confirm the output tree still contains exactly 44 WebPs**

```powershell
$allFinals = Get-ChildItem -LiteralPath $assetRoot -Recurse -File -Filter '*.webp'
if ($allFinals.Count -ne 44) { throw "Expected 44 final WebPs, found $($allFinals.Count)" }
```

- [ ] **Step 3: Compare all non-target hashes with the Task 1 baseline**

Recompute SHA-256 for all 44 finals using the Task 1 command. Exactly eight paths may have new hashes; all other 36 paths, including `Ранг 3\Фриаден.webp`, must match the baseline transcript byte-for-byte.

- [ ] **Step 4: Build a review contact sheet**

```powershell
$reviewPaths = $expected.Path
& $magick montage $reviewPaths -thumbnail '900x900>' -tile '4x2' -geometry '+20+20' -background '#202020' "$stageRoot\review-eight.jpg"
if ($LASTEXITCODE -ne 0) { throw 'Review contact sheet creation failed' }
```

- [ ] **Step 5: Review the contact sheet and each full final**

Open `tmp/city-map-regeneration/review-eight.jpg`, then reopen every full WebP. Confirm:

- all eight cameras are exact vertical plans;
- no map contains visible facades, text, labels, or watermarks;
- rank 1 and 2 settlements remain small;
- Мис'Даркай is a dense inhabited city rather than a camp;
- Йорсвик is a major industrial city and its forest does not repeat;
- Центральный собор is warm Persian crystal architecture with no winter elements;
- no essential landmark or city edge is cropped.

- [ ] **Step 6: Report recoverability and final paths**

Report the eight replaced paths, the backup root, staging source root, contact-sheet path, exact final dimensions, generation mode, conversion settings, and final acceptance verdict. Do not delete the backups in this task.
