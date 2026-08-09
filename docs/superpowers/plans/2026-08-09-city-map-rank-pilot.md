# Ranked City Map Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify 44 clean top-down WebP city maps grouped into rank folders, demonstrating the visual scale from rank 1 through rank 10.

**Architecture:** Every city is generated independently through the built-in image generation tool from canonical `data/cities.json` metadata and a shared atlas-style prompt contract. Accepted sources are normalized to PNG in `tmp/city-map-pilot/source`, resized once with Lanczos, encoded as WebP, and written to the external Foundry asset tree. Each rank is an independently reviewable batch; a final audit validates names, counts, dimensions, format, and reference preservation.

**Tech Stack:** Built-in `image_gen`; local reference images; PowerShell; ImageMagick 7.1.2; Pillow 12.2 with WebP support for metadata verification.

## Global Constraints

- Canonical city data comes only from `data/cities.json`.
- Generate exactly 44 maps from the approved pilot list.
- Use strict orthographic top-down fantasy cartography with crisp building outlines and light watercolor/paper texture.
- Render no words, letters, numbers, labels, title, legend, grid, border, marker, crest, logo, signature, or watermark.
- Save final images as WebP quality 92 under `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N`.
- Preserve display names in filenames, including Cyrillic, spaces, hyphens, and apostrophes.
- Do not overwrite or modify the six reference images in the parent folder.
- Final square dimensions are fixed by rank: 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, and 8000 pixels for ranks 1–10 respectively.
- If a generation fails visual review, change one defect at a time while explicitly preserving all accepted properties.

## Zero-Context Operator Brief

This section is intentionally self-contained. A model with no memory of the conversation must be able to execute the pilot from this document alone.

The job is to create overview maps for fictional cities used in Foundry VTT. These are city-level atlas maps, not battle maps. Generate every city as a new image; never transform one city into another and never treat a reference as the edit target. The existing images provide style, density, line treatment, and composition guidance only. The canonical lore for a city is the matching object in `D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json`.

The generator is the built-in `image_gen` tool. For every new city, pass the exact local files defined by the rank's reference set through `referenced_image_paths`. Do not use `num_last_images_to_include` for the initial generation. If one generated image needs one targeted edit before it is saved locally, use `num_last_images_to_include: 1` so the edit refers only to the immediately preceding image.

Execute cities sequentially within a rank. After accepting one image, normalize it to a stable id-based PNG in `tmp/city-map-pilot/source`; this prevents a later tool call from making the accepted source ambiguous. Do not start the next rank until every final WebP in the current rank opens successfully and has the exact required dimensions.

### Named Inputs Used by the Master Prompt

The tokens below are an interface, not unfinished requirements. Replace every token with the exact value defined here before calling the image tool:

- `[[CITY_NAME]]`: exact `name` value from the selected city object. It is metadata only and must not be drawn.
- `[[CITY_DESCRIPTION]]`: exact `description` value from the city object.
- `[[CITY_RANK]]`: integer `rank`.
- `[[CITY_POPULATION]]`: integer `population`.
- `[[CITY_STATE]]`: exact `state`.
- `[[CITY_REGION]]`: exact `regionName`.
- `[[CITY_TERRAIN]]`: exact `locationType`.
- `[[CITY_TYPE]]`: exact `cityType`.
- `[[CITY_RELIGION]]`: exact `religion`; use only as a subtle secondary architectural influence.
- `[[RANK_VISUAL_TARGET]]`: exact matching sentence from the rank scale in Task 2 Step 4.
- `[[CITY_COMPOSITION_HOOK]]`: exact city-specific bullet from the matching rank task.
- `[[REFERENCE_ROLES]]`: one line per supplied image, in path order, identifying it as `style and composition reference; not an edit target`.

### Complete Master Generation Prompt

Copy this whole prompt for every initial city generation and replace all named inputs. Do not shorten it for supposedly simple cities.

```text
Use case: stylized-concept
Asset type: square city-overview map for Foundry VTT, intended for navigation and world presentation rather than tactical combat

Input images:
[[REFERENCE_ROLES]]
All input images are style and composition references only. Generate a completely new city map. Do not copy a reference city's layout, title, labels, watermark, or unique landmark.

Primary request:
Create one polished, highly detailed fantasy city map for the fictional city whose metadata name is [[CITY_NAME]]. The name is metadata only: never draw, write, engrave, spell, abbreviate, or imply the city name anywhere inside the image.

Canonical city data:
- Description: [[CITY_DESCRIPTION]]
- Rank: [[CITY_RANK]]
- Population: [[CITY_POPULATION]]
- State: [[CITY_STATE]]
- Region: [[CITY_REGION]]
- Terrain: [[CITY_TERRAIN]]
- City function: [[CITY_TYPE]]
- Religion: [[CITY_RELIGION]]

Required interpretation:
Treat the description as the highest-priority source of truth. Use terrain to shape the settlement itself, not merely the background. Use state and region to influence architecture, roofs, street geometry, materials, and palette consistently. Use city function to determine infrastructure. Use religion only as a restrained secondary influence and never add written scripture, holy text, runes, sigils, or labels. Rank and population determine visible breadth and density.

Rank visual target:
[[RANK_VISUAL_TARGET]]

City-specific composition hook:
[[CITY_COMPOSITION_HOOK]]

Scene and geography:
Show the complete settlement plus enough surrounding land or water to explain why it developed here. Integrate incoming roads, fields, forests, cliffs, docks, canals, mines, caravan camps, or defensive approaches only when supported by the canonical data. The terrain must affect district boundaries, street paths, building materials, expansion patterns, and city edges.

Architecture and urban layout:
Use coherent districts with a believable hierarchy of main roads, secondary streets, plazas, residential blocks, civic or sacred compounds, workshops, storage, and infrastructure appropriate to the city function. Give the city one primary visual identity and at most three secondary systems. Preserve open space appropriate to the rank. Do not inflate a low-rank settlement with monumental districts. Do not make a high-rank city sparse or village-like. Add walls and towers only if the description, military function, or defensive geography supports them.

Style and medium:
Detailed hand-drawn fantasy cartography. Crisp dark ink-like outlines around buildings and terrain features. Natural restrained colors, subtle watercolor washes, lightly textured paper feel, readable roofs and streets, rich small-scale environmental detail. Match the references' clarity and atlas-map finish while creating an original layout.

Composition and camera:
Strict orthographic 90-degree top-down view. No horizon. No vanishing point. No visible building facades. No isometric angle. Square composition. Center the complete city footprint while preserving meaningful surrounding geography. Do not crop the primary landmark, harbor, walls, outer districts, roads, or environmental feature that explains the city.

Visual storytelling:
The city-specific hook must be understandable from layout and landmarks alone. Use architecture, scale, infrastructure, terrain, and color relationships rather than written signs or symbols. The image should remain legible when zoomed out and reward closer inspection when zoomed in.

Hard constraints:
No text. No words. No letters. No numbers. No title. No district names. No labels. No legend. No compass rose containing letters. No decorative border. No frame. No grid. No hexes. No map pins. No icons floating above the map. No heraldic crest. No logo. No signature. No watermark. No pseudo-writing. No readable runes. No street signs. No banners containing glyphs. No accidental UI. No photorealistic satellite imagery. No perspective view. No isometric view. No oblique camera. No duplicated city copied from a reference.

Final self-check before rendering:
1. The camera is exactly top-down and orthographic.
2. The whole city and its defining geographic context fit inside the square.
3. Density clearly matches rank [[CITY_RANK]].
4. The city-specific hook is immediately visible without labels.
5. State, terrain, city function, and description agree with one another.
6. There is absolutely no text-like content, grid, border, marker, logo, signature, or watermark.
```

### Exact Rank Visual Targets

Use one and only one of these sentences for `[[RANK_VISUAL_TARGET]]`:

- Rank 1: `A sparse outpost-scale settlement with abundant visible wilderness, only a few loose building clusters, one modest focal structure, and no metropolitan infrastructure.`
- Rank 2: `A compact village or tiny town with a small center, several functional clusters, limited infrastructure, and generous surrounding terrain.`
- Rank 3: `A recognizable small town with multiple neighborhoods or work clusters, several connecting streets, one clear landmark, and developed surroundings.`
- Rank 4: `A developed town with distinct districts, a strong road hierarchy, several civic or economic landmarks, and meaningful outer activity.`
- Rank 5: `A large regional city with multiple dense districts, major infrastructure, several landmarks, and a clear relationship to the surrounding region.`
- Rank 6: `A very large city with extensive infrastructure, broad district variety, major transport or defensive systems, and dense continuous development.`
- Rank 7: `A dense metropolis with many districts, monumental infrastructure, multiple centers of activity, and a city footprint that dominates the landscape.`
- Rank 8: `A huge multi-district capital or megacity with immense infrastructure, several monumental centers, dense urban depth, and complex transport systems.`
- Rank 9: `A legendary monumental or magical center whose exceptional rank is unmistakable through unique scale, impossible infrastructure, sacred geometry, defense, or magic rather than density alone.`
- Rank 10: `A continent-scale imperial metropolis with innumerable districts, vast port and transport systems, monumental civic cores, and an unmistakable leap beyond every lower rank.`

### Terrain Translation Rules

Apply the matching rule unless the description explicitly overrides it:

- `Берег`: water determines the city's edge; include believable shore geometry, docks, quays, ship access, flood defenses, islands, estuary, or canal links as supported by the description.
- `Лес`: trees penetrate the urban footprint; use clearings, canopy corridors, root-aware streets, timber infrastructure, and integrated woodland boundaries.
- `Пустыня`: use wind-shaped streets, shaded dense blocks, stone or pale plaster materials, caravan approaches, dunes, dry channels, wells, or oases as supported by the description.
- `Луга`: show roads, fields, gardens, pasture, orchards, and outward expansion; do not fill every edge with dense forest.
- `Холмы`: use terraces, switchback streets, retaining walls, ridges, elevated civic sites, and visible contour logic from above.
- `Горы`: use cliffs, shelves, passes, bridges, mine portals, defensible approaches, and compact construction adapted to steep rock.
- `Болото` or `Болота`: use islands, causeways, canals, drainage, raised foundations, dams, and boardwalk street systems.

### Fully Filled Example: Унед

This example demonstrates correct assembly for a low-rank city. It is not an additional style requirement for other cities.

```text
Use case: stylized-concept
Asset type: square city-overview map for Foundry VTT, intended for navigation and world presentation rather than tactical combat
Input images: Image 1 and Image 2 are style and composition references only; neither is an edit target. Generate a completely new layout and copy no title, label, watermark, or unique landmark.
Primary request: Create one polished, highly detailed fantasy city map for the fictional city whose metadata name is Унед. Never render the name inside the image.
Canonical city data: Description: Самый южный город Илдуина, насчитывающий буквально несколько тысяч жителей — по большей части авантюристов и искателей приключений, отважившихся исследовать пустоши. Rank: 1. Population: 120. State: Королевство Илдуин. Region: Королевство Илдуин. Terrain: Луга. City function: Аграрный. Religion: Асили.
Rank visual target: A sparse outpost-scale settlement with abundant visible wilderness, only a few loose building clusters, one modest focal structure, and no metropolitan infrastructure.
City-specific composition hook: Sparse southern meadow outpost of adventurers at the edge of dangerous wasteland, rough inn, supply yards, trailheads, no grand fortifications.
Scene and geography: Show the complete settlement in open meadow with fields and roads on the settled side and harsher wasteland trailheads beyond it. The border between safe cultivated land and risky expedition country must explain the town's existence.
Architecture and layout: A few loose clusters, modest inn and supply yard as the focal area, practical sheds, small homes, pack-animal space, expedition trails. No city walls, palace, cathedral, monumental harbor, dense blocks, or metropolitan infrastructure.
Style: Detailed hand-drawn fantasy cartography, crisp dark outlines, natural restrained colors, subtle watercolor and paper texture, original layout.
Camera and composition: Exact 90-degree orthographic top-down square view, complete outpost and meaningful surroundings visible, no horizon, no facades, no perspective.
Hard constraints: No text, words, letters, numbers, title, labels, legend, border, frame, grid, markers, crest, logo, signature, watermark, pseudo-writing, readable runes, signs, glyph banners, isometric view, oblique camera, or copied reference layout.
```

### Fully Filled Example: Цугенгрим

This example demonstrates correct assembly for the only rank 10 city.

```text
Use case: stylized-concept
Asset type: square city-overview map for Foundry VTT, intended for navigation and world presentation rather than tactical combat
Input images: Image 1, Image 2, and Image 3 are style and composition references only; none is an edit target. Generate a completely new layout and copy no title, label, watermark, or unique landmark.
Primary request: Create one polished, extremely detailed fantasy city map for the fictional city whose metadata name is Цугенгрим. Never render the name inside the image.
Canonical city data: Description: Столица всей империи и крупнейший оплот человеческой цивилизации, раскинувшийся на десятки миль вокруг южных берегов залива Ирэйвен. Культурный и технологический центр империи давно переступил черту, когда был рядовым городом, — даже статус столицы уже размыт. Это почти самостоятельный субъект в составе империи. Сотни тысяч людей, живущих в бесчисленных районах, неустанно наполняют его жизнью: днём на широких бульварах среди высокой застройки проходят ярмарки и представления, а ночью фестивали и игры в торговых домах удерживают публику. Rank: 10. Population: 1200000. State: Умелилуанская империя. Region: Имперский регион. Terrain: Берег. City function: Столичный. Religion: Вита.
Rank visual target: A continent-scale imperial metropolis with innumerable districts, vast port and transport systems, monumental civic cores, and an unmistakable leap beyond every lower rank.
City-specific composition hook: Continent-scale imperial capital wrapping for many miles around the southern shores of Iraven Bay, innumerable distinct districts, immense port systems, broad boulevards, dense high-rise core, cultural and technological quarters, fairgrounds and merchant houses.
Scene and geography: The bay is the organizing geographic form. Show the full southern shoreline city arc, deep harbors, islands or breakwaters where plausible, radial inland roads, and an urban footprint that overwhelms the surrounding countryside without cropping essential districts.
Architecture and layout: Innumerable coherent districts, multiple monumental civic cores, huge port and warehouse systems, broad boulevards, dense tall-roof central quarters, fairgrounds, merchant-house precincts, cultural campuses, technological infrastructure, and layered transport routes. Preserve distinct district shapes so the map remains readable.
Style: Extremely detailed hand-drawn fantasy atlas cartography, crisp dark outlines, restrained natural palette, subtle watercolor and paper texture, original layout.
Camera and composition: Exact 90-degree orthographic top-down square view, complete bay-centered metropolis visible, no horizon, no facades, no perspective.
Hard constraints: No text, words, letters, numbers, title, labels, legend, border, frame, grid, markers, crest, logo, signature, watermark, pseudo-writing, readable runes, signs, glyph banners, isometric view, oblique camera, or copied reference layout.
```

### Single-City Execution Protocol

Follow these steps without improvising the order:

1. Load `data/cities.json` and select exactly one object by the id listed in the rank task.
2. Confirm its `name` and `rank` match the task before generating.
3. Select only the reference files assigned to that rank range.
4. Fill every named input in the complete master prompt with exact canonical data and the exact city hook.
5. Search the filled prompt for any remaining `[[` or `]]`. If either remains, do not call the image tool.
6. Call built-in `image_gen` once with the filled prompt and `referenced_image_paths` set to the assigned local references.
7. Inspect the result at high detail against the six-item self-check in the prompt.
8. If one defect exists, apply exactly one correction from the correction library below and preserve all other properties. If several major defects exist, discard the result and make a fresh initial generation rather than stacking edits.
9. Normalize the accepted result to `tmp/city-map-pilot/source/<city-id>.png`.
10. Resize and encode it to the rank's exact final path.
11. Verify format, dimensions, byte size, filename, and visible cleanliness before starting the next city.

### Targeted Correction Prompt Library

Use only the correction matching the single defect. Include the accepted properties literally so they remain invariant.

- Camera defect: `Change only the camera and projection: redraw the same accepted city as an exact 90-degree orthographic top-down map with no horizon, no facades, no isometric angle, and no perspective. Preserve the accepted city identity, geography, district layout, density, landmark, palette, and absence of text.`
- Text or glyph defect: `Remove only every visible word, letter, number, label, pseudo-writing mark, readable rune, sign, logo, signature, and watermark. Replace affected surfaces with coherent roof, road, stone, vegetation, or water texture. Preserve the accepted top-down camera, city layout, density, geography, landmarks, palette, and square framing.`
- Wrong rank density: `Change only the settlement breadth and density so it clearly matches rank [[CITY_RANK]]: [[RANK_VISUAL_TARGET]] Preserve the accepted strict top-down camera, terrain, cultural architecture, defining landmark, palette, clean unlabelled presentation, and complete square composition.`
- Missing hook: `Change only the visual storytelling so this defining feature becomes unmistakable without labels: [[CITY_COMPOSITION_HOOK]] Preserve the accepted rank density, top-down camera, geography, architecture, palette, city boundaries, and absence of text.`
- Cropped geography: `Change only the framing: zoom out enough to include the complete city, primary landmark, outer districts, incoming roads, and defining geographic feature inside the square with a modest margin. Preserve the accepted layout relationships, rank density, top-down projection, style, and absence of text.`
- Style drift: `Change only the rendering style to detailed hand-drawn fantasy atlas cartography with crisp dark ink-like outlines, natural restrained colors, subtle watercolor washes, and light paper texture. Preserve the accepted city layout, camera, rank density, geography, landmark, square framing, and absence of text.`

### Exact Local Post-Processing Recipe

After a source is accepted, use the actual absolute source path returned by the image tool and the task's fixed id, size, and destination. The following PowerShell variables have precise meanings:

```powershell
function Convert-CityMapSource {
  param(
    [Parameter(Mandatory)][string]$GeneratedSource,
    [Parameter(Mandatory)][string]$CityId,
    [Parameter(Mandatory)][int]$TargetPixels,
    [Parameter(Mandatory)][string]$FinalPath
  )

  if (-not (Test-Path -LiteralPath $GeneratedSource -PathType Leaf)) {
    throw "Generated source does not exist: $GeneratedSource"
  }
  $stagePath = Join-Path 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-pilot\source' ($CityId + '.png')
  $magick = (Get-Command magick -ErrorAction Stop).Source
  & $magick $GeneratedSource -strip $stagePath
  if ($LASTEXITCODE -ne 0) { throw "Source normalization failed for $CityId" }
  & $magick $stagePath -filter Lanczos -resize ($TargetPixels.ToString() + 'x' + $TargetPixels.ToString() + '!') -strip -define webp:method=6 -quality 92 $FinalPath
  if ($LASTEXITCODE -ne 0) { throw "WebP conversion failed for $CityId" }

  $info = & $magick identify -format '%m|%w|%h|%b' $FinalPath
  $expected = 'WEBP|' + $TargetPixels + '|' + $TargetPixels + '|'
  if (-not $info.StartsWith($expected)) { throw "Invalid final image metadata for $CityId: $info" }
  if ((Get-Item -LiteralPath $FinalPath).Length -le 0) { throw "Empty final image for $CityId" }
}
```

After a generation completes, copy the absolute local path returned by that completed tool result into a PowerShell variable named `$imageGenResultPath`; do not infer or search for a different file. Then call the function with concrete task values. Example for Унед:

```powershell
Convert-CityMapSource `
  -GeneratedSource $imageGenResultPath `
  -CityId 'uned' `
  -TargetPixels 3000 `
  -FinalPath 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 1\Унед.webp'
```

Never use an unresolved environment variable, wildcard, guessed generation path, or a source from a different city.

The function verifies every produced file immediately; reopen the final WebP visually after the function succeeds.

---

## File Structure

- Create temporary staging directory: `tmp/city-map-pilot/source/` — normalized accepted PNG sources keyed by city id.
- Create temporary contract: `tmp/city-map-pilot/prompt-contract.md` — shared prompt, negative constraints, and rank scale.
- Create external directories: `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 1` through `Ранг 10`.
- Create 44 final `.webp` files listed in Tasks 3–12.
- Do not modify runtime source code, `data/cities.json`, or existing reference images.

### Task 1: Preflight and Output Tree

**Files:**
- Create: `tmp/city-map-pilot/source/`
- Create: `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 1` through `Ранг 10`

**Interfaces:**
- Consumes: approved design spec and six existing reference files.
- Produces: empty staging and output directories; reference hashes recorded before generation.

- [ ] **Step 1: Confirm the canonical count and pilot availability**

Run a PowerShell check that loads `data/cities.json`, asserts 300 total entries, and asserts that all 44 ids named in the design exist exactly once. Stop if either assertion fails.

- [ ] **Step 2: Record reference integrity hashes**

Run `Get-FileHash -Algorithm SHA256` on the six files currently in `D:\FoundryVTT\Data\assets\Карты\Карты городов` and retain the name/hash pairs for Task 13.

- [ ] **Step 3: Check for conflicting pilot outputs**

Run `Get-ChildItem -LiteralPath 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам' -Recurse -File -ErrorAction SilentlyContinue`. If any of the 44 approved names already exists, do not overwrite it until it has been visually inspected and explicitly accepted as part of this pilot.

- [ ] **Step 4: Create directories**

Create `tmp/city-map-pilot/source` and all ten `Ранг N` directories with `New-Item -ItemType Directory -Force` using literal, fully resolved paths.

- [ ] **Step 5: Verify the tree**

Assert that all eleven directories exist and that every rank directory is initially empty or contains only explicitly accepted existing outputs.

### Task 2: Prompt Contract and Reference Routing

**Files:**
- Create: `tmp/city-map-pilot/prompt-contract.md`

**Interfaces:**
- Consumes: `data/cities.json` fields `name`, `description`, `rank`, `population`, `state`, `regionName`, `locationType`, `cityType`, and `religion`.
- Produces: one reusable prompt contract; three exact reference sets keyed by rank range.

- [ ] **Step 1: Read image-generation prompting guidance**

Read the complete imagegen `references/prompting.md` and `references/sample-prompts.md` before shaping prompts.

- [ ] **Step 2: Fix reference routing**

Use these exact reference sets:

- Ranks 1–4: `58hurzapu2fd1.jpeg`, `161271756_4449662918429446_3593097342466276384_n.jpg`.
- Ranks 5–7: the two preceding files plus `yh1f4le2wuch1.jpeg`.
- Ranks 8–10: `yh1f4le2wuch1.jpeg`, `Пиргур.jpeg`, `161271756_4449662918429446_3593097342466276384_n.jpg`.

Do not use `2wri156t36dh1.jpeg` or `83a0csdhmnfh1.jpeg` as generation references because they contain visible titles, labels, or watermark-like branding.

- [ ] **Step 3: Write the shared prompt contract**

Copy the complete sections `Named Inputs Used by the Master Prompt`, `Complete Master Generation Prompt`, `Exact Rank Visual Targets`, `Terrain Translation Rules`, `Single-City Execution Protocol`, and `Targeted Correction Prompt Library` from this plan into `tmp/city-map-pilot/prompt-contract.md`. The contract must use taxonomy `stylized-concept`, identify the asset as a Foundry VTT city overview map, label every input as a style/composition reference rather than an edit target, and retain this invariant block verbatim:

```text
Strict orthographic 90-degree top-down view. Square composition. Show the complete settlement plus enough surrounding terrain to explain its geography. Detailed hand-drawn fantasy cartography, crisp dark building outlines, readable roads and districts, natural color palette, subtle watercolor and paper texture. The city name is metadata only and must never appear inside the image. No text, no letters, no numbers, no labels, no title, no legend, no border, no frame, no grid, no map markers, no crest, no logo, no signature, no watermark, no isometric projection, no oblique camera, no cropped essential districts.
```

- [ ] **Step 4: Add rank density guidance**

Record these visual targets in the contract: rank 1 sparse outpost with abundant wilderness; rank 2 compact village; rank 3 small town with several functional clusters; rank 4 developed town with distinct districts; rank 5 regional city with multiple landmarks; rank 6 large city with major infrastructure; rank 7 dense metropolis; rank 8 huge multi-district capital; rank 9 monumental or magical legendary center; rank 10 continent-scale bay metropolis with innumerable districts.

- [ ] **Step 5: Review the contract**

Search the contract for any instruction that asks the model to draw the city name, a legend, a decorative border, a grid, or a perspective view. Remove contradictions before generating Task 3.

### Task 3: Rank 1 Batch — 3000×3000

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 1`: `Унед.webp`, `Пульвели.webp`, `Мура.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 1 reference set; exact city rows from `data/cities.json`.
- Produces: three visually accepted 3000×3000 WebP maps.

- [ ] **Step 1: Generate each city separately**

Use one built-in `image_gen` call per city. Add these exact composition hooks to the canonical metadata:

- Унед (`id: uned`): sparse southern meadow outpost of adventurers at the edge of dangerous wasteland, rough inn, supply yards, trailheads, no grand fortifications.
- Пульвели (`id: pulveli`): tiny scholarly meadow settlement centered on an unusually important library and compact magical academy gardens, still visibly rank 1 rather than a metropolis.
- Мура (`id: mura`): half-lost tabaxi meadow settlement, organic paths, feline-scale courtyards, weathered abandoned edges reclaimed by grass.

- [ ] **Step 2: Inspect every source**

Open each result at high detail. Reject any result with text-like glyphs, perspective tilt, rank inflation, clipped settlement, or missing city hook. Iterate with one corrective instruction only.

- [ ] **Step 3: Normalize and encode**

Normalize accepted outputs to `tmp/city-map-pilot/source/<id>.png`, then use ImageMagick Lanczos resizing with forced square dimensions and WebP quality 92 to write the three final files.

- [ ] **Step 4: Verify the batch**

Use Pillow or `magick identify` to assert three files, WebP format, exact 3000×3000 dimensions, and nonzero byte sizes. Reopen each final WebP to confirm scaling introduced no visible corruption.

### Task 4: Rank 2 Batch — 3500×3500

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 2`: `Пиракарей.webp`, `Заброшенный замок.webp`, `Дайтоши.webp`, `Трибоус.webp`, `Фронселье.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 2 reference set; canonical metadata.
- Produces: five accepted 3500×3500 WebP maps.

- [ ] **Step 1: Generate one image per city with these hooks**

- Пиракарей (`id: pirakarey`): modest coastal port split into visibly different racial quarters around one shared harbor, cramped living conditions, no labels.
- Заброшенный замок (`id: zabroshennyy-zamok`): small desert refugee settlement clustered tightly against the ruins of an old castle used as an emergency shelter.
- Дайтоши (`id: daytoshi`): compact forest port with surprisingly busy piers and ship moorings, settlement itself still small.
- Трибоус (`id: tribous`): meadow brewing town with hop fields, malt barns, breweries, orchards, and a modest central market.
- Фронселье (`id: fronsele`): island settlement beside striking rose-colored lagoons, salt pans and dye workshops arranged around unusual water.

- [ ] **Step 2: Inspect, correct one defect at a time, and accept**

Require strict top-down view, rank 2 density, full settlement, readable hook, and zero marks or text.

- [ ] **Step 3: Normalize, resize, and encode**

Write accepted sources to staging by id and create the five named WebPs at 3500×3500, quality 92.

- [ ] **Step 4: Verify five outputs**

Assert count, filenames, format, exact dimensions, nonzero sizes, and successful visual reopen.

### Task 5: Rank 3 Batch — 4000×4000

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 3`: `Порт непокорённых.webp`, `Дюны свистящего ветра.webp`, `Древки.webp`, `Фриаден.webp`, `Собрание народов.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 3 reference set; canonical metadata.
- Produces: five accepted 4000×4000 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Порт непокорённых (`id: port-nepokoryonnykh`): northern frozen-sea trading port with iron and steel steamships, dwarf engineering, icebound docks.
- Дюны свистящего ветра (`id: dyuny-svistyashchego-vetra`): defensive desert town shaped by immense wind-sculpted dunes and protected routes through monster-haunted sands.
- Древки (`id: drevki`): forest craft town at a river source, protected by enormous living treants integrated into streets and woodland edge.
- Фриаден (`id: friaden`): conservative ducal meadow town surrounded by extensive vineyards thriving in an unexpectedly dry climate.
- Собрание народов (`id: sobranie-narodov`): hilly mining town radiating around one monumental peace memorial, quarry roads and mine approaches secondary.

- [ ] **Step 2: Inspect and target corrections**

Reject rank inflation, missing snow/dunes/treants/vineyards/memorial, any writing, and any non-orthographic angle.

- [ ] **Step 3: Normalize and create 4000×4000 WebPs**

Use staged id-based PNGs, Lanczos, forced square size, and quality 92.

- [ ] **Step 4: Verify five final files and reopen visually**

Assert exact names, dimensions, format, byte size, and artifact-free scaling.

### Task 6: Rank 4 Batch — 4500×4500

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 4`: `Грикрон.webp`, `Туалор.webp`, `Элигула.webp`, `Аль-Хадж.webp`, `Мис'Даркай.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 4 reference set; canonical metadata.
- Produces: five accepted 4500×4500 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Грикрон (`id: grikron`): sprawling meadow caravan bazaar ruled by guild compounds, dense inns, supply markets, mercenary fighting arenas.
- Туалор (`id: tualor`): old hill fortress city anchoring a front line, layered defenses and extensive organized mercenary camps outside the walls.
- Элигула (`id: eligula`): decaying theocratic coastal port, damaged harbor, hidden contraband coves, signs of sea-monster decline without showing text.
- Аль-Хадж (`id: al-khadzh`): desert pilgrimage city on Lake Majoro, ceremonial approach routes, sacred courtyards, artisan quarters, restrained grandeur.
- Мис'Даркай (`id: mis-darkay`): ancient forest fortress surviving through old magic, traces of a formerly dry landscape now encroached by wetlands and roots.

- [ ] **Step 2: Inspect and correct**

Require rank 4 district structure, exact environmental hook, no labels or glyph-like decorations, complete city bounds.

- [ ] **Step 3: Normalize and create 4500×4500 WebPs**

Stage by id; resize once with Lanczos; encode quality 92.

- [ ] **Step 4: Verify five files and visual integrity**

Assert metadata and inspect final WebPs.

### Task 7: Rank 5 Batch — 5000×5000

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 5`: `Клеонар.webp`, `Сад вечного пара.webp`, `Сордигон.webp`, `Тафия.webp`, `Шир.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 5 reference set; canonical metadata.
- Produces: five accepted 5000×5000 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Клеонар (`id: kleonar`): inhabited meadow city built directly over carved ancient ruins, old foundations visible beneath newer districts, uneasy archaeology sites.
- Сад вечного пара (`id: sad-vechnogo-para`): coastal hot-spring city dominated by a gigantic botanical garden of steam, elevated bridges, water gardens, tropical collections.
- Сордигон (`id: sordigon`): white-towered desert-and-sea capital centered on the monumental Castle of the White Falcon, golden dunes and blue coast.
- Тафия (`id: tafiya`): mountain stronghold of blood hunters with terraced vineyards, defensible ridges, austere old compounds.
- Шир (`id: shir`): hilly forest city living in harmony with giant trees, buildings on and inside trunks, elevated paths and organic terraces.

- [ ] **Step 2: Inspect for rank, hook, and clean map invariants**

Correct one failed property at a time and preserve all accepted geography and composition.

- [ ] **Step 3: Normalize and create 5000×5000 WebPs**

Stage accepted sources and encode at quality 92 after one Lanczos resize.

- [ ] **Step 4: Verify and reopen all five finals**

Check names, dimensions, format, sizes, and visible scaling quality.

### Task 8: Rank 6 Batch — 5500×5500

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 6`: `Странта.webp`, `Хейко.webp`, `Арк.webp`, `Аль-Масафат.webp`, `Йорсвик.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 5–7 reference set; canonical metadata.
- Produces: five accepted 5500×5500 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Странта (`id: stranta`): beautiful large city near eastern royal marshes, misty waterfront squares, bard festival spaces, instrument workshops.
- Хейко (`id: kheyko`): capital woven through a powerful ocean-to-inland canal system, interlocking waterways, bridges, docks, and island districts.
- Арк (`id: ark`): vast controlled hill gateway-city whose fortifications emphasize customs, inspection, and border passage more than siege warfare.
- Аль-Масафат (`id: al-masafat`): bustling desert-edge caravan metropolis, enormous temporary camps, markets, warehouses, routes bending around moving dunes.
- Йорсвик (`id: yorsvik`): large industrial forest road city with wagon works, shield workshops, timber yards, military supply roads.

- [ ] **Step 2: Inspect and make isolated corrections**

Require rank 6 infrastructure and density without accidental rank 8 scale, strict top-down view, and no marks.

- [ ] **Step 3: Normalize and create 5500×5500 WebPs**

Stage by id and encode quality 92 using Lanczos.

- [ ] **Step 4: Verify five files and visual reopen**

Check exact metadata and final visual integrity.

### Task 9: Rank 7 Batch — 6000×6000

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 7`: `Пиргур.webp`, `Вельгард.webp`, `Дартарус.webp`, `Кувист.webp`, `Зертон.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 5–7 reference set; canonical metadata.
- Produces: five accepted 6000×6000 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Пиргур (`id: pirgur`): giant-and-human metropolis on a central plain, oversized avenues and plazas, colossal forges, exotic markets, ancient arena-colosseum.
- Вельгард (`id: velgard`): powerful bay capital built around long-distance trade, deep harbor, shipyards, radial roads, merchant districts.
- Дартарус (`id: dartarus`): new civilized orc desert capital where monumental civic planning coexists with clan compounds, arenas, bone and iron traditions.
- Кувист (`id: kuvist`): huge forest military-industrial city sending roads to camps, logging complexes, hidden hunting courts, defensible woodland corridors.
- Зертон (`id: zerton`): old hill capital with layered republican civic districts, weathered government quarter, public squares that suggest political tension without text.

- [ ] **Step 2: Inspect and correct single defects**

Require metropolis density, unique hook, complete bounds, strict top-down view, and no text-like elements.

- [ ] **Step 3: Normalize and create 6000×6000 WebPs**

Stage by id, resize once, encode quality 92.

- [ ] **Step 4: Verify and reopen five finals**

Confirm exact size, format, count, names, and scaling quality.

### Task 10: Rank 8 Batch — 6500×6500

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 8`: `Сиптиэр.webp`, `Феир-Альмасай.webp`, `Теодосия.webp`, `Штальт.webp`, `Физлтаун.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 8–10 reference set; canonical metadata.
- Produces: five accepted 6500×6500 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Сиптиэр (`id: siptier`): immense hill metropolis and bastion of wizard dynasties, multiple academy districts, magical civic infrastructure, dense ordinary neighborhoods.
- Феир-Альмасай (`id: feir-almasay`): desert steam-tech capital with ancient columns, monumental mirrors and engraved architecture, fortified ceremonial districts.
- Теодосия (`id: teodosiya`): gigantic old maritime capital dominated by heavy-ship slipways, enormous dry docks, naval warehouses, dense coastal quarters.
- Штальт (`id: shtalt`): smoky technological meadow megacity with high-rise center, surface locomotive lines, automobile streets, airship facilities.
- Физлтаун (`id: fizltaun`): rough mountain industrial-scientific capital grown from a mining settlement, immense mine entrances, smoke, rail and utilitarian districts.

- [ ] **Step 2: Inspect for huge scale without losing district readability**

Reject sparse compositions, generic medieval layouts, cropped industrial systems, text, and tilted views.

- [ ] **Step 3: Normalize and create 6500×6500 WebPs**

Stage accepted sources; resize once; encode quality 92.

- [ ] **Step 4: Verify five files and reopen visually**

Assert dimensions, WebP format, names, byte sizes, and artifact-free scaling.

### Task 11: Rank 9 Batch — 7000×7000

**Files:**
- Create in `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 9`: `Тольт.webp`, `Форт Рока.webp`, `Неал.webp`, `Центральный собор.webp`, `Зарджилан.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 8–10 reference set; canonical metadata.
- Produces: five accepted 7000×7000 WebP maps.

- [ ] **Step 1: Generate with exact hooks**

- Тольт (`id: tolt`): legendary secluded transmutation academy among snowy ancient peaks, alchemical courts and impossible matter-transforming structures; monumental rank comes from magic, not population sprawl.
- Форт Рока (`id: fort-roka`): enormous ancient mountaintop fortress above desert cliffs, massive block walls, surviving watchtowers, distant sea and river at the foot.
- Неал (`id: neal`): small island city made rank 9 by vast protective magic against violent bay weather, concentric wards expressed visually without glyphs or writing.
- Центральный собор (`id: tsentralnyy-sobor`): entire isolated meadow city built from spectacular crystal as a symbolic divine receiving temple, radial sacred geometry without letters or symbols.
- Зарджилан (`id: zardzhilan`): mysterious desert enchantment-school city dominated by one immense shadowed tower, controlled concentric compounds and subtly uncanny courtyards.

- [ ] **Step 2: Inspect legendary identity and rank logic**

Ensure each map feels rank 9 through monumentality or magic even when population is 30,000. Reject generic dense capitals, written runes, labels, grids, or perspective views.

- [ ] **Step 3: Normalize and create 7000×7000 WebPs**

Stage by id; use one Lanczos resize; encode quality 92.

- [ ] **Step 4: Verify five files and final visual integrity**

Assert metadata and inspect high-detail finals.

### Task 12: Rank 10 Batch — 8000×8000

**Files:**
- Create: `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 10\Цугенгрим.webp`

**Interfaces:**
- Consumes: Task 2 contract; rank 8–10 reference set; canonical metadata.
- Produces: one accepted 8000×8000 WebP map.

- [ ] **Step 1: Generate Цугенгрим**

Create Цугенгрим (`id: tsugengrim`) as a continent-scale imperial capital wrapping for many miles around the southern shores of Iraven Bay: innumerable distinct districts, immense port systems, broad boulevards, dense high-rise core, cultural and technological quarters, fairgrounds and merchant houses. Keep the complete metropolis legible from strict top-down view and render no city name or labels.

- [ ] **Step 2: Inspect at high detail and correct one defect at a time**

Require an unmistakable jump beyond rank 9 in breadth and infrastructure while retaining a coherent bay-centered composition.

- [ ] **Step 3: Normalize and create the 8000×8000 WebP**

Stage as `tsugengrim.png`, resize once with Lanczos, and encode `Цугенгрим.webp` at quality 92.

- [ ] **Step 4: Verify final metadata and reopen**

Assert WebP format, exact 8000×8000 dimensions, nonzero size, and no visible corruption or text.

### Task 13: Global Audit and Handoff

**Files:**
- Verify: all 44 files under `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 1` through `D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг 10`
- Verify unchanged: six parent-folder reference images

**Interfaces:**
- Consumes: outputs from Tasks 3–12 and reference hashes from Task 1.
- Produces: evidence-backed completion report with exact file count, dimensions by rank, and output root.

- [ ] **Step 1: Validate rank counts**

Assert exact per-folder counts `3,5,5,5,5,5,5,5,5,1` for ranks 1–10, totaling 44.

- [ ] **Step 2: Validate filenames against the approved set**

Compare basenames to the 44 approved display names. Fail on a missing, extra, duplicate, or mis-ranked file.

- [ ] **Step 3: Validate image metadata**

Open every file with Pillow, assert `format == 'WEBP'`, assert width and height equal the rank target, and assert file size is greater than zero.

- [ ] **Step 4: Perform a visual contact-sheet review**

Create temporary rank contact sheets outside the final output tree, inspect rank progression, and reopen any suspicious map individually. Confirm no image contains visible text, frame, grid, watermark, oblique camera, or accidental duplicate composition.

- [ ] **Step 5: Recheck reference integrity**

Recompute SHA-256 hashes for the six original parent-folder reference images and require exact equality with Task 1.

- [ ] **Step 6: Report completion**

Report the output root, exact count 44, per-rank dimensions, any regenerated maps, the shared final prompt contract, and that built-in image generation plus local ImageMagick WebP conversion were used.
