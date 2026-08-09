# Full 300-City Map Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the remaining 256 canonical city maps to the existing 44-map ranked pilot, producing exactly 300 accepted WebPs without changing any ready map or original reference.

**Architecture:** Build a deterministic manifest from data/cities.json and the 44 existing WebPs, then process 26 immutable batches: 25 batches of 10 and one batch of 6. Each city is generated independently from a complete canonical prompt, accepted in a staging tree, converted to its rank size, reviewed as part of a batch contact sheet, and published only after explicit user approval and hash preservation checks.

**Tech Stack:** PowerShell 7 or Windows PowerShell 5.1, ImageMagick CLI, SHA-256 via Get-FileHash, built-in ImageGen, view_image, JSON manifests, WebP quality 92 with Lanczos resizing.

## Global Constraints

- Canonical data file: D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json.
- Final asset root: D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам.
- Original-reference roots: D:\FoundryVTT\Data\assets\Карты\Карты городов and its Механус subfolder, excluding Пилот по рангам.
- Work root: D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production.
- The 44 existing WebPs are accepted, immutable references. Never overwrite them.
- Produce exactly 256 new maps in 26 batches: batches 01–25 contain 10 cities; batch 26 contains 6.
- One ImageGen call produces one city only. Never request a collage, mood board or multiple variants in one image.
- Generate each city from scratch. Do not edit or use an old map as a target image.
- Strict exact 90-degree nadir orthographic projection is a hard gate across the entire image.
- Reject any visible facade, side wall, horizon, vanishing point, isometric angle or perspective ellipse.
- Final format is square WEBP, stripped metadata, ImageMagick Lanczos resize, webp method 6, quality 92.
- Rank sizes are exact: 1=3000, 2=3500, 3=4000, 4=4500, 5=5000, 6=5500, 7=6000, 8=6500, 9=7000, 10=8000.
- Do not draw names, letters, digits, runes, captions, labels, frames, legends, grids, compasses, logos, signatures or watermarks.
- Preserve the city’s canonical description, geography, state/region culture, rank and population.
- Existing and new cities must not reuse the same street network or distinctive composition.
- Do not publish a batch before the user explicitly approves its contact sheet.
- Keep every accepted PNG source, card, prompt, staged WebP, contact sheet, hash baseline and publish receipt.
- External assets are shared across worktrees. A Git worktree does not isolate D:\FoundryVTT\Data\assets.
- Do not delete backups, sources or review artifacts during this plan.
- If ImageGen is unavailable, a required source image is missing, a target already exists, or any count/hash check fails, stop and report the exact blocker.

## File Map

**Create in the repository:**

- scripts/city-map-production/CityMap.Common.ps1 — shared paths, rank sizes, filename rules and JSON helpers.
- scripts/city-map-production/Build-CityMapManifest.ps1 — discovers the initial 44 ready maps and creates the immutable 256-city/26-batch manifest.
- scripts/city-map-production/New-CityMapCard.ps1 — selects ready-map anchors and writes a canonical card plus a complete ImageGen prompt.
- scripts/city-map-production/Start-CityMapBatch.ps1 — validates one batch and captures hashes of every existing final.
- scripts/city-map-production/Stage-CityMapBatch.ps1 — converts accepted PNGs to staged WebPs and creates the contact sheet.
- scripts/city-map-production/Publish-CityMapBatch.ps1 — copies approved staged WebPs without overwrite and verifies old hashes.
- scripts/city-map-production/Test-CityMapFinalSet.ps1 — validates counts, names, ranks, dimensions and manifest progress.
- scripts/city-map-production/tests/Run-All.ps1 — dependency-free smoke tests for the production harness.

**Create during execution under tmp/city-map-full-production:**

- manifest.json — immutable production manifest with all 256 cities.
- reference-catalog.json — 44 ready references and 8 original references with roles and hashes.
- batches/batch-NN/manifest.json — exact batch subset.
- batches/batch-NN/cards — canonical city cards.
- batches/batch-NN/prompts — exact prompts sent to ImageGen.
- batches/batch-NN/source — accepted PNG sources.
- batches/batch-NN/staged-webp — converted but unpublished finals.
- batches/batch-NN/review.jpg — 5×2 contact sheet, or 3×2 for Batch 26.
- batches/batch-NN/baseline.json — hashes captured before publication.
- batches/batch-NN/publish-receipt.json — installed paths and hashes.

## Reference Roles

Ready-map anchors are selected only from the current 44 WebPs. The primary anchor must share the target rank. Scoring within that rank:

- same regionName: +40;
- same state: +30;
- same locationType: +20;
- same cityType: +10;
- alphabetical name as deterministic tie-breaker.

Use the highest-scoring city as the primary anchor and the next distinct positive-scoring city as the optional secondary anchor. The anchor defines camera, density, rank and finish, never the exact street layout.

Original-reference catalog:

| File | Transferable role | Never transfer |
|---|---|---|
| 161271756_4449662918429446_3593097342466276384_n.jpg | temperate fortified city, fields, outer roads | exact ring layout |
| 2wri156t36dh1.jpeg | dense harbor, bays, waterfront districts | watermark, caption |
| 58hurzapu2fd1.jpeg | river-divided town, bridges, farms | exact river shape |
| 83a0csdhmnfh1.jpeg | underground/night districts, luminous zones | labels, black frame |
| yh1f4le2wuch1.jpeg | sprawling industrial fantasy metropolis | oblique forms, exact composition |
| Механус\ФРАГО КАРТА.webp | radial mechanical city, canals, metal districts | exact radial geometry |
| Механус\Ядро.webp | immense machine capital, concentric infrastructure | exact central mechanism |
| Пиргур.jpeg | city-specific identity of Пиргур | labels, route line, crop defects |

Original maps are inspected visually and translated into textual reference notes. Because every new city is generated from scratch, omit referenced_image_paths and num_last_images_to_include in the ImageGen call.

## Mandatory Zero-Pass Prompt Block

Every prompt must begin with this exact block:

~~~text
ZERO-PASS CARTOGRAPHIC GATE — APPLY BEFORE DRAWING ANY CONTENT.
Lock the entire image to an exact 90-degree nadir orthographic map projection. This is a flat cartographic city plan, never a bird's-eye illustration, isometric scene, landscape painting, or cinematic aerial shot. Every building must be represented only by roof shape, footprint, courtyard, wall plan, road and ground surface. If any design choice would expose a facade, door, window, vertical side wall, horizon, vanishing point, or directional perspective, redesign it as a top-down roof or footprint. Circular towers, plazas, domes, reservoirs and arenas must remain true circles, never perspective ellipses. Apply this rule consistently to the center, edges, terrain, cliffs, bridges and tallest landmarks.
~~~

Every prompt must end with this exact block:

~~~text
OUTPUT CONTRACT.
One polished square Foundry VTT regional city map, richly detailed hand-drawn fantasy atlas style, crisp dark contours, readable roofs, roads, districts and terrain, natural colors, subtle watercolor and paper texture. Show the complete city footprint and enough meaningful surrounding geography. No text, city name, letters, numbers, runes, pseudotext, captions, legend, frame, grid, compass, coat of arms, logo, signature, watermark, visible facade, side wall, horizon, isometric angle, perspective ellipse, copied street layout, repeated tree stamp, or cropped essential district.
~~~

## Mandatory City Micro-Cycle

Execute these actions for one city before starting the next:

1. Run New-CityMapCard.ps1 with the exact batch number and city name.
2. Open the generated card JSON and confirm name, id, rank, population, state, regionName, locationType, cityType, description, final size and target path.
3. Open the primary ready anchor with view_image. Open the secondary ready anchor if present. Inspect the relevant original reference category from reference-catalog.json.
4. Read prompt.txt completely. Confirm it begins with the zero-pass block, contains the full canonical description, rank contract, cultural/geographic context and selected reference roles, and ends with the output contract.
5. Call built-in ImageGen with the exact contents of prompt.txt. Omit both referenced_image_paths and num_last_images_to_include because this is a new image.
6. Open the returned image with view_image before copying it.
7. Accept only if the whole image is strict top-down, the rank reads correctly, the canonical feature is visible, the environment is correct, no essential edge is cropped, and no text/pseudotext appears.
8. On rejection, create a retry prompt by preserving every accepted property and adding one precise correction block for the observed defect. Maximum two retries.
9. Copy only the accepted returned path to batches\batch-NN\source\{manifest.id}.png.
10. Record attempt count and acceptance note in cards\{manifest.id}.json. Never infer or search for a different generated path.

## Mandatory Batch Approval Receipt

After the user explicitly approves a batch contact sheet, preserve that decision before publication. Set the exact batch number and copy the user’s approving message verbatim:

~~~powershell
$batchNumber = 1
$batchTag = '{0:D2}' -f $batchNumber
$batchRoot = "D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\batches\batch-$batchTag"
$approval = [pscustomobject]@{
  Batch = $batchNumber
  Approved = $true
  ApprovedAt = (Get-Date).ToString('o')
  UserMessage = 'Да, партия 01 принята'
}
$approval | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $batchRoot 'approval.json')
~~~

For later batches change only Batch and UserMessage to the actual approved batch and the exact received message. Publish-CityMapBatch.ps1 must reject a missing receipt, Approved other than true, or a mismatched batch number.

## Ready Anchor Inventory

| Rank | Accepted anchors |
|---:|---|
| 1 | Мура; Пульвели; Унед |
| 2 | Дайтоши; Заброшенный замок; Пиракарей; Трибоус; Фронселье |
| 3 | Древки; Дюны свистящего ветра; Порт непокорённых; Собрание народов; Фриаден |
| 4 | Аль-Хадж; Грикрон; Мис'Даркай; Туалор; Элигула |
| 5 | Клеонар; Сад вечного пара; Сордигон; Тафия; Шир |
| 6 | Аль-Масафат; Арк; Йорсвик; Странта; Хейко |
| 7 | Вельгард; Дартарус; Зертон; Кувист; Пиргур |
| 8 | Сиптиэр; Теодосия; Феир-Альмасай; Физлтаун; Штальт |
| 9 | Зарджилан; Неал; Тольт; Форт Рока; Центральный собор |
| 10 | Цугенгрим |

---

### Task 1: Build the Deterministic Production Manifest

**Files:**
- Create: scripts/city-map-production/CityMap.Common.ps1
- Create: scripts/city-map-production/Build-CityMapManifest.ps1
- Create: scripts/city-map-production/tests/Run-All.ps1
- Read: data/cities.json
- Read externally: all current WebPs under the final asset root

**Interfaces:**
- Build-CityMapManifest.ps1 consumes CitiesPath, AssetRoot and WorkRoot.
- It produces manifest.json with SchemaVersion=1, InitialReadyCount=44, TargetCount=256, BatchCount=26 and a Cities array.
- Each city record contains id, name, safeFileName, description, rank, population, state, regionName, locationType, cityType, religion, plane, production, demand, width, height, batch, slot and targetPath.

- [ ] **Step 1: Write the failing manifest smoke test**

Create Run-All.ps1 with assertions that call Build-CityMapManifest.ps1 in a temporary directory and require 300 canonical cities, 44 ready names, 256 targets, 26 batches, batch sizes 10×25 and 6×1, no duplicate names, and no target collisions.

~~~powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$buildScript = Join-Path $repoRoot 'scripts\city-map-production\Build-CityMapManifest.ps1'
$citiesPath = Join-Path $repoRoot 'data\cities.json'
$assetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('city-map-manifest-test-' + [guid]::NewGuid().ToString('N'))

try {
  & $buildScript -CitiesPath $citiesPath -AssetRoot $assetRoot -WorkRoot $testRoot
  $manifestPath = Join-Path $testRoot 'manifest.json'
  Assert-True (Test-Path -LiteralPath $manifestPath -PathType Leaf) 'manifest.json was not created'
  $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
  Assert-True ($manifest.CanonicalCount -eq 300) 'CanonicalCount must be 300'
  Assert-True ($manifest.InitialReadyCount -eq 44) 'InitialReadyCount must be 44'
  Assert-True ($manifest.TargetCount -eq 256) 'TargetCount must be 256'
  Assert-True ($manifest.BatchCount -eq 26) 'BatchCount must be 26'
  Assert-True (@($manifest.Cities).Count -eq 256) 'Cities array must contain 256 records'
  Assert-True (@($manifest.Cities.name | Sort-Object -Unique).Count -eq 256) 'Target names must be unique'
  Assert-True (@($manifest.Cities.targetPath | Sort-Object -Unique).Count -eq 256) 'Target paths must be unique'
  foreach ($batch in 1..26) {
    $expected = if ($batch -eq 26) { 6 } else { 10 }
    Assert-True (@($manifest.Cities | Where-Object batch -eq $batch).Count -eq $expected) "Bad size for batch $batch"
  }
  'PASS manifest smoke test'
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove non-temp test path: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
~~~

- [ ] **Step 2: Run the test and verify failure**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\tests\Run-All.ps1
~~~

Expected: FAIL because CityMap.Common.ps1 and Build-CityMapManifest.ps1 do not exist.

- [ ] **Step 3: Implement the shared contract**

CityMap.Common.ps1 must define:

~~~powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:RankSizes = @{
  1=3000; 2=3500; 3=4000; 4=4500; 5=5000
  6=5500; 7=6000; 8=6500; 9=7000; 10=8000
}

function Get-CityMapRankSize([int]$Rank) {
  if (-not $script:RankSizes.ContainsKey($Rank)) { throw "Unsupported rank: $Rank" }
  return [int]$script:RankSizes[$Rank]
}

function Get-CityMapSafeFileName([string]$Name) {
  $safe = $Name -replace '[\x00-\x1F<>:"/\\|?*]', ''
  if ([string]::IsNullOrWhiteSpace($safe)) { throw "Empty safe filename for: $Name" }
  return $safe
}

function Read-CityMapJson([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing JSON: $Path" }
  return Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
}

function Write-CityMapJson([object]$Value, [string]$Path, [int]$Depth=12) {
  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $Value | ConvertTo-Json -Depth $Depth | Set-Content -Encoding UTF8 -LiteralPath $Path
}
~~~

- [ ] **Step 4: Implement deterministic manifest creation**

Build-CityMapManifest.ps1 must:

1. stop unless cities.json contains exactly 300 unique names;
2. enumerate current final WebPs and stop unless there are exactly 44;
3. stop if any ready basename is absent from cities.json;
4. exclude those 44 names;
5. sort targets by state, regionName, integer rank and name;
6. assign batch=floor(index/10)+1 and slot=(index mod 10)+1;
7. compute exact safe filename, rank dimensions and target path;
8. stop on any safe-name collision;
9. write the full manifest and 26 batch manifests.

Use Sort-Object with explicit expressions; do not depend on filesystem order.

Implement Build-CityMapManifest.ps1 with this complete control flow:

~~~powershell
param(
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам',
  [string]$WorkRoot = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production'
)

. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

$raw = Read-CityMapJson -Path $CitiesPath
$cities = if ($raw -is [Array]) { @($raw) } elseif ($null -ne $raw.cities) { @($raw.cities) } else { throw 'Unknown cities.json shape' }
if ($cities.Count -ne 300) { throw "Expected 300 canonical cities, found $($cities.Count)" }

$canonicalGroups = @($cities | Group-Object { $_.name.ToLowerInvariant() } | Where-Object Count -ne 1)
if ($canonicalGroups.Count -ne 0) { throw "Duplicate canonical city name: $($canonicalGroups[0].Name)" }

$readyFiles = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp' | Sort-Object FullName)
if ($readyFiles.Count -ne 44) { throw "Initial run requires exactly 44 ready WebPs, found $($readyFiles.Count)" }

$canonicalByName = @{}
foreach ($city in $cities) { $canonicalByName[$city.name.ToLowerInvariant()] = $city }
$readyNames = @{}
foreach ($file in $readyFiles) {
  $key = $file.BaseName.ToLowerInvariant()
  if (-not $canonicalByName.ContainsKey($key)) { throw "Ready file is not canonical: $($file.FullName)" }
  if ($readyNames.ContainsKey($key)) { throw "Duplicate ready city: $($file.BaseName)" }
  $readyNames[$key] = $file.FullName
}

$targets = @($cities |
  Where-Object { -not $readyNames.ContainsKey($_.name.ToLowerInvariant()) } |
  Sort-Object @{Expression='state';Ascending=$true},
              @{Expression='regionName';Ascending=$true},
              @{Expression={[int]$_.rank};Ascending=$true},
              @{Expression='name';Ascending=$true})
if ($targets.Count -ne 256) { throw "Expected 256 target cities, found $($targets.Count)" }

$records = @()
for ($index = 0; $index -lt $targets.Count; $index++) {
  $city = $targets[$index]
  $rank = [int]$city.rank
  $size = Get-CityMapRankSize -Rank $rank
  $safe = Get-CityMapSafeFileName -Name ([string]$city.name)
  $batch = [int][Math]::Floor($index / 10) + 1
  $slot = ($index % 10) + 1
  $records += [pscustomobject]@{
    id=[string]$city.id
    name=[string]$city.name
    safeFileName=$safe
    description=[string]$city.description
    rank=$rank
    population=$city.population
    state=[string]$city.state
    regionName=[string]$city.regionName
    locationType=[string]$city.locationType
    cityType=[string]$city.cityType
    religion=$city.religion
    plane=$city.plane
    production=$city.production
    demand=$city.demand
    width=$size
    height=$size
    batch=$batch
    slot=$slot
    targetPath=(Join-Path (Join-Path $AssetRoot "Ранг $rank") ($safe + '.webp'))
  }
}

$pathCollisions = @($records | Group-Object { $_.targetPath.ToLowerInvariant() } | Where-Object Count -ne 1)
if ($pathCollisions.Count -ne 0) { throw "Target path collision: $($pathCollisions[0].Name)" }
if (@($records | Where-Object { Test-Path -LiteralPath $_.targetPath }).Count -ne 0) {
  throw 'At least one target already exists; do not rebuild the initial manifest after production starts'
}

$manifest = [pscustomobject]@{
  SchemaVersion=1
  CreatedAt=(Get-Date).ToString('o')
  CanonicalCount=300
  InitialReadyCount=44
  TargetCount=256
  BatchCount=26
  Cities=$records
}
Write-CityMapJson -Value $manifest -Path (Join-Path $WorkRoot 'manifest.json')

foreach ($batch in 1..26) {
  $tag = '{0:D2}' -f $batch
  $batchRoot = Join-Path $WorkRoot "batches\batch-$tag"
  foreach ($folder in 'cards','prompts','source','staged-webp') {
    New-Item -ItemType Directory -Force -Path (Join-Path $batchRoot $folder) | Out-Null
  }
  $batchManifest = [pscustomobject]@{
    SchemaVersion=1
    Batch=$batch
    Cities=@($records | Where-Object batch -eq $batch | Sort-Object slot)
  }
  Write-CityMapJson -Value $batchManifest -Path (Join-Path $batchRoot 'manifest.json')
}

[pscustomobject]@{ Canonical=300; Ready=44; Targets=256; Batches=26 }
~~~

- [ ] **Step 5: Run tests**

Run Run-All.ps1. Expected: PASS with CityCount=300, ReadyCount=44, TargetCount=256 and BatchCount=26.

- [ ] **Step 6: Commit the harness foundation**

~~~powershell
git add scripts/city-map-production
git commit -m "feat: add city map production manifest"
~~~

### Task 2: Build Reference Catalog and Complete Prompt Cards

**Files:**
- Create: scripts/city-map-production/New-CityMapCard.ps1
- Modify: scripts/city-map-production/tests/Run-All.ps1
- Create during execution: tmp/city-map-full-production/reference-catalog.json
- Create during execution: per-city card JSON and prompt TXT files

**Interfaces:**
- New-CityMapCard.ps1 consumes ManifestPath, Batch and CityName.
- It produces cards/{manifest.id}.json and prompts/{manifest.id}.txt.
- The card records primaryReadyReference, optional secondaryReadyReference, originalReferenceMode, originalReferencePaths, referenceRoles, mustInclude, mustAvoid and attempt history.

- [ ] **Step 1: Extend the smoke test first**

Add a test that creates a card for Вурул and asserts:

- rank=4 and size=4500;
- primary anchor is one of the five ready rank-4 maps;
- prompt begins with ZERO-PASS CARTOGRAPHIC GATE;
- prompt contains Вурул’s full description but says never to draw the city name;
- prompt ends with OUTPUT CONTRACT;
- no more than four reference records exist.

Append this block inside Run-All.ps1 after the manifest assertions and before the finally block:

~~~powershell
$cardScript = Join-Path $repoRoot 'scripts\city-map-production\New-CityMapCard.ps1'
& $cardScript -ManifestPath $manifestPath -Batch 1 -CityName 'Вурул' -CitiesPath $citiesPath -AssetRoot $assetRoot
$cardPath = Join-Path $testRoot 'batches\batch-01\cards\vurul.json'
$promptPath = Join-Path $testRoot 'batches\batch-01\prompts\vurul.txt'
Assert-True (Test-Path -LiteralPath $cardPath -PathType Leaf) 'Вурул card was not created'
Assert-True (Test-Path -LiteralPath $promptPath -PathType Leaf) 'Вурул prompt was not created'
$card = Get-Content -Raw -Encoding UTF8 -LiteralPath $cardPath | ConvertFrom-Json
$prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath
Assert-True ($card.rank -eq 4 -and $card.width -eq 4500 -and $card.height -eq 4500) 'Вурул rank size is wrong'
Assert-True ($card.primaryReadyReference.rank -eq 4) 'Primary ready anchor must have rank 4'
Assert-True ($prompt.StartsWith('ZERO-PASS CARTOGRAPHIC GATE')) 'Prompt does not start with zero-pass gate'
Assert-True ($prompt.Contains([string]$card.description)) 'Prompt does not contain the canonical description'
Assert-True ($prompt.Contains('Never render the metadata city name')) 'Prompt does not prohibit rendering the name'
Assert-True ($prompt.TrimEnd().EndsWith('cropped essential district.')) 'Prompt does not end with the output contract'
Assert-True (@($card.referenceRecords).Count -le 4) 'Reference record limit exceeded'
~~~

- [ ] **Step 2: Run and verify failure**

Expected: FAIL because New-CityMapCard.ps1 does not exist.

- [ ] **Step 3: Implement ready-anchor scoring**

For every ready city of the same rank, calculate:

~~~powershell
$score = 0
if ($candidate.regionName -eq $target.regionName) { $score += 40 }
if ($candidate.state -eq $target.state) { $score += 30 }
if ($candidate.locationType -eq $target.locationType) { $score += 20 }
if ($candidate.cityType -eq $target.cityType) { $score += 10 }
~~~

Sort descending by score and ascending by name. Primary is the first result. Secondary is the next distinct result only when its score is greater than zero.

- [ ] **Step 4: Implement deterministic original-reference modes**

Use these textual modes:

- mechanus: state is Королевство Менег or description contains механ, шестер, паров, медн or машин;
- harbor: cityType is Портовый or locationType is Берег;
- underdark: description contains подзем, пещер, тень, тьм or locationType describes underground terrain;
- industrial: cityType is Индустриальный;
- temperate: fallback.

Map each mode to the exact roles in the Original-reference catalog. Record at most two original paths. The mode guides text only; it does not override cities.json.

- [ ] **Step 5: Assemble the complete English prompt**

The generated prompt must concatenate, in order:

1. the exact zero-pass block;
2. one sentence saying the metadata name is never rendered;
3. full canonical fields and description;
4. the rank’s visual scale contract from the approved spec;
5. geographic behavior for locationType and plane;
6. cultural continuity for state and regionName;
7. cityType plus production/demand districts where relevant;
8. ready-anchor roles and original-reference textual notes;
9. explicit instruction to create a unique layout;
10. city-specific must-avoid block;
11. the exact output contract.

Do not write unresolved variable markers into prompt.txt.

Implement New-CityMapCard.ps1 with the exact inputs and deterministic selection below:

~~~powershell
param(
  [Parameter(Mandatory)][string]$ManifestPath,
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [Parameter(Mandatory)][string]$CityName,
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам'
)

. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

$manifest = Read-CityMapJson -Path $ManifestPath
$target = @($manifest.Cities | Where-Object {
  [int]$_.batch -eq $Batch -and $_.name -ceq $CityName
})
if ($target.Count -ne 1) { throw "Expected one manifest target for Batch $Batch / $CityName, found $($target.Count)" }
$target = $target[0]

$raw = Read-CityMapJson -Path $CitiesPath
$canonical = if ($raw -is [Array]) { @($raw) } else { @($raw.cities) }
$canonicalByName = @{}
foreach ($city in $canonical) { $canonicalByName[$city.name.ToLowerInvariant()] = $city }

$readyCandidates = @()
$readyFiles = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
foreach ($file in $readyFiles) {
  $key = $file.BaseName.ToLowerInvariant()
  if (-not $canonicalByName.ContainsKey($key)) { continue }
  $candidate = $canonicalByName[$key]
  if ([int]$candidate.rank -ne [int]$target.rank) { continue }
  $score = 0
  if ([string]$candidate.regionName -ceq [string]$target.regionName) { $score += 40 }
  if ([string]$candidate.state -ceq [string]$target.state) { $score += 30 }
  if ([string]$candidate.locationType -ceq [string]$target.locationType) { $score += 20 }
  if ([string]$candidate.cityType -ceq [string]$target.cityType) { $score += 10 }
  $readyCandidates += [pscustomobject]@{
    name=[string]$candidate.name
    rank=[int]$candidate.rank
    score=$score
    path=$file.FullName
  }
}
$readyCandidates = @($readyCandidates | Sort-Object @{Expression='score';Descending=$true}, @{Expression='name';Ascending=$true})
if ($readyCandidates.Count -eq 0) { throw "No ready rank-$($target.rank) anchor exists" }
$primary = $readyCandidates[0]
$secondary = if ($readyCandidates.Count -gt 1 -and $readyCandidates[1].score -gt 0) { $readyCandidates[1] } else { $null }

$haystack = (([string]$target.description) + ' ' + ([string]$target.cityType) + ' ' + ([string]$target.locationType)).ToLowerInvariant()
$mode = 'temperate'
if ([string]$target.state -ceq 'Королевство Менег' -or $haystack -match 'механ|шестер|паров|медн|машин') {
  $mode = 'mechanus'
} elseif ($haystack -match 'подзем|пещер|тень|тьм') {
  $mode = 'underdark'
} elseif ([string]$target.cityType -ceq 'Портовый' -or [string]$target.locationType -ceq 'Берег') {
  $mode = 'harbor'
} elseif ([string]$target.cityType -ceq 'Индустриальный') {
  $mode = 'industrial'
}

$originalRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов'
$originalModes = @{
  temperate = @(
    [pscustomobject]@{path=(Join-Path $originalRoot '161271756_4449662918429446_3593097342466276384_n.jpg'); role='temperate city, fields and outer-road relationships'},
    [pscustomobject]@{path=(Join-Path $originalRoot '58hurzapu2fd1.jpeg'); role='river, bridges and agricultural edges'}
  )
  harbor = @(
    [pscustomobject]@{path=(Join-Path $originalRoot '2wri156t36dh1.jpeg'); role='dense harbor and bay districts'},
    [pscustomobject]@{path=(Join-Path $originalRoot '58hurzapu2fd1.jpeg'); role='riverfront bridges and farms'}
  )
  underdark = @(
    [pscustomobject]@{path=(Join-Path $originalRoot '83a0csdhmnfh1.jpeg'); role='separated underground districts and luminous zones'}
  )
  industrial = @(
    [pscustomobject]@{path=(Join-Path $originalRoot 'yh1f4le2wuch1.jpeg'); role='sprawling industrial fantasy districts'}
  )
  mechanus = @(
    [pscustomobject]@{path=(Join-Path $originalRoot 'Механус\ФРАГО КАРТА.webp'); role='radial machine-city districts and canals'},
    [pscustomobject]@{path=(Join-Path $originalRoot 'Механус\Ядро.webp'); role='concentric machine-capital infrastructure'}
  )
}
$originals = @($originalModes[$mode])
foreach ($reference in $originals) {
  if (-not (Test-Path -LiteralPath $reference.path -PathType Leaf)) { throw "Missing original reference: $($reference.path)" }
}

$rankContracts = @{
  2='small village or town: several streets or blocks and one local landmark'
  3='complete small city: connected street network, several districts and a visible city edge'
  4='developed city: dense blocks, market, craft and residential districts, one or more landmarks'
  5='large regional center: many blocks, developed infrastructure and outer suburbs'
  6='large city, port or fortress: several major functional zones and strong transport hierarchy'
  7='dense metropolis: large continuous urban footprint and complex district network'
  8='immense capital: multi-level district hierarchy and monumental civic or trade center'
  9='legendary capital or unique city: exceptional landmark and extensive complex urban fabric'
}
$rankContract = $rankContracts[[int]$target.rank]
if ([string]::IsNullOrWhiteSpace($rankContract)) { throw "No rank contract for target rank $($target.rank)" }

$referenceRecords = @(
  [pscustomobject]@{kind='ready-primary'; name=$primary.name; rank=$primary.rank; path=$primary.path; role='camera, scale, density and finish'}
)
if ($null -ne $secondary) {
  $referenceRecords += [pscustomobject]@{kind='ready-secondary'; name=$secondary.name; rank=$secondary.rank; path=$secondary.path; role='secondary cultural, biome or city-type guidance'}
}
$referenceRecords += @($originals | ForEach-Object {
  [pscustomobject]@{kind='original'; name=[IO.Path]::GetFileName($_.path); rank=$null; path=$_.path; role=$_.role}
})
if ($referenceRecords.Count -gt 4) { throw "More than four references selected for $CityName" }

$zeroBlock = @'
ZERO-PASS CARTOGRAPHIC GATE — APPLY BEFORE DRAWING ANY CONTENT.
Lock the entire image to an exact 90-degree nadir orthographic map projection. This is a flat cartographic city plan, never a bird's-eye illustration, isometric scene, landscape painting, or cinematic aerial shot. Every building must be represented only by roof shape, footprint, courtyard, wall plan, road and ground surface. If any design choice would expose a facade, door, window, vertical side wall, horizon, vanishing point, or directional perspective, redesign it as a top-down roof or footprint. Circular towers, plazas, domes, reservoirs and arenas must remain true circles, never perspective ellipses. Apply this rule consistently to the center, edges, terrain, cliffs, bridges and tallest landmarks.
'@
$outputBlock = @'
OUTPUT CONTRACT.
One polished square Foundry VTT regional city map, richly detailed hand-drawn fantasy atlas style, crisp dark contours, readable roofs, roads, districts and terrain, natural colors, subtle watercolor and paper texture. Show the complete city footprint and enough meaningful surrounding geography. No text, city name, letters, numbers, runes, pseudotext, captions, legend, frame, grid, compass, coat of arms, logo, signature, watermark, visible facade, side wall, horizon, isometric angle, perspective ellipse, copied street layout, repeated tree stamp, or cropped essential district.
'@
$referenceText = ($referenceRecords | ForEach-Object { "- $($_.kind): $($_.role). Never copy its exact street network, text, watermark, frame or camera defect." }) -join [Environment]::NewLine
$prompt = @"
$zeroBlock

PRIMARY REQUEST.
Create one city only. The metadata city name is "$($target.name)". Never render the metadata city name or any other writing inside the image.

CANONICAL CITY.
Rank: $($target.rank), final size $($target.width)x$($target.height), population: $($target.population).
State: $($target.state). Region: $($target.regionName). Plane: $($target.plane).
Location type: $($target.locationType). City type: $($target.cityType). Religion: $($target.religion).
Canonical description: $($target.description)
Rank scale contract: $rankContract.
Production context: $($target.production | ConvertTo-Json -Compress -Depth 6)
Demand context: $($target.demand | ConvertTo-Json -Compress -Depth 6)

REFERENCE INTERPRETATION.
$referenceText
Use the references only for their declared roles. Create a unique city footprint, district geometry, road network and surrounding terrain.

CITY-SPECIFIC NEGATIVE CHECK.
Do not reduce a permanent rank-$($target.rank) city to a camp, scattered huts or disconnected platforms. Do not use a generic biome filter. Do not repeat copied trees, roofs or blocks. Do not contradict the canonical description, state, region, location type or city type.

$outputBlock
"@

$tag = '{0:D2}' -f $Batch
$workRoot = Split-Path -Parent $ManifestPath
$batchRoot = Join-Path $workRoot "batches\batch-$tag"
$cardPath = Join-Path $batchRoot ("cards\" + $target.id + '.json')
$promptPath = Join-Path $batchRoot ("prompts\" + $target.id + '.txt')
$card = [pscustomobject]@{
  id=$target.id; name=$target.name; description=$target.description
  rank=$target.rank; width=$target.width; height=$target.height; population=$target.population
  state=$target.state; regionName=$target.regionName; locationType=$target.locationType; cityType=$target.cityType
  targetPath=$target.targetPath; primaryReadyReference=$primary; secondaryReadyReference=$secondary
  originalReferenceMode=$mode; referenceRecords=$referenceRecords
  attempts=@(); accepted=$false
}
Write-CityMapJson -Value $card -Path $cardPath
$prompt | Set-Content -Encoding UTF8 -LiteralPath $promptPath
[pscustomobject]@{ Card=$cardPath; Prompt=$promptPath; Primary=$primary.name; OriginalMode=$mode }
~~~

- [ ] **Step 6: Run tests and commit**

Expected: PASS. Then:

~~~powershell
git add scripts/city-map-production
git commit -m "feat: add city map prompt cards"
~~~

### Task 3: Add Safe Staging, Contact Sheets and Publication

**Files:**
- Create: scripts/city-map-production/Start-CityMapBatch.ps1
- Create: scripts/city-map-production/Stage-CityMapBatch.ps1
- Create: scripts/city-map-production/Publish-CityMapBatch.ps1
- Create: scripts/city-map-production/Test-CityMapFinalSet.ps1
- Modify: scripts/city-map-production/tests/Run-All.ps1

**Interfaces:**
- Start-CityMapBatch.ps1 -Batch N validates the batch and writes baseline.json.
- Stage-CityMapBatch.ps1 -Batch N converts accepted sources and writes review.jpg.
- Publish-CityMapBatch.ps1 -Batch N installs new WebPs only after every target is absent and every baseline hash still matches.
- Test-CityMapFinalSet.ps1 validates the current prefix of published batches.

- [ ] **Step 1: Add failing staging tests**

The test must create a temporary asset root, a one-city manifest, one synthetic square PNG and one pre-existing protected WebP. It must verify:

- staging creates a correctly sized WebP;
- publication refuses an existing target;
- publication never changes the protected WebP hash;
- contact sheet exists;
- missing sources stop staging.

Append this isolated fixture test to Run-All.ps1:

~~~powershell
$fixtureRoot = Join-Path $testRoot 'publish-fixture'
$fixtureAsset = Join-Path $fixtureRoot 'assets'
$fixtureBatch = Join-Path $fixtureRoot 'batches\batch-01'
New-Item -ItemType Directory -Force -Path (Join-Path $fixtureAsset 'Ранг 2') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $fixtureBatch 'source') | Out-Null

$protected = Join-Path $fixtureAsset 'Ранг 2\protected.webp'
& magick -size 64x64 xc:'#556644' $protected
if ($LASTEXITCODE -ne 0) { throw 'Could not create protected fixture WebP' }
$protectedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $protected).Hash

$targetPath = Join-Path $fixtureAsset 'Ранг 2\Test City.webp'
$fixtureManifest = [pscustomobject]@{
  SchemaVersion=1; CanonicalCount=1; InitialReadyCount=1; TargetCount=1; BatchCount=1
  Cities=@([pscustomobject]@{
    id='test-city'; name='Test City'; safeFileName='Test City'; description='test'
    rank=2; width=3500; height=3500; population=600; state='test'; regionName='test'
    locationType='Луга'; cityType='Аграрный'; batch=1; slot=1; targetPath=$targetPath
  })
}
$fixtureManifestPath = Join-Path $fixtureRoot 'manifest.json'
$fixtureManifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $fixtureManifestPath
$fixtureManifest.Cities | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $fixtureBatch 'manifest.json')
& magick -size 256x256 xc:'#778855' (Join-Path $fixtureBatch 'source\test-city.png')

& (Join-Path $repoRoot 'scripts\city-map-production\Start-CityMapBatch.ps1') -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedBeforeCount 1
& (Join-Path $repoRoot 'scripts\city-map-production\Stage-CityMapBatch.ps1') -Batch 1 -ManifestPath $fixtureManifestPath
[pscustomobject]@{Batch=1;Approved=$true;ApprovedAt=(Get-Date).ToString('o');UserMessage='fixture approval'} |
  ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $fixtureBatch 'approval.json')
& (Join-Path $repoRoot 'scripts\city-map-production\Publish-CityMapBatch.ps1') -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedAfterCount 2
Assert-True (Test-Path -LiteralPath $targetPath -PathType Leaf) 'Published fixture target is missing'
Assert-True ((Get-FileHash -Algorithm SHA256 -LiteralPath $protected).Hash -eq $protectedHash) 'Protected fixture changed'

$collisionStopped = $false
try {
  & (Join-Path $repoRoot 'scripts\city-map-production\Publish-CityMapBatch.ps1') -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedAfterCount 2
} catch {
  $collisionStopped = $true
}
Assert-True $collisionStopped 'Second publication did not stop on an existing target'
~~~

- [ ] **Step 2: Run and verify failure**

Expected: FAIL because the four scripts do not exist.

- [ ] **Step 3: Implement Start-CityMapBatch.ps1**

It must validate the batch number, require all target paths to be absent, require previous batches to be published, create batch folders, and write every current final path/hash to baseline.json. It prints existing count, batch size and expected post-publish count.

~~~powershell
param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$AssetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам',
  [int]$ExpectedBeforeCount = -1
)
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')
$manifest = Read-CityMapJson -Path $ManifestPath
$targets = @($manifest.Cities | Where-Object batch -eq $Batch | Sort-Object slot)
$expectedBatchSize = if ($Batch -eq 26 -and $manifest.BatchCount -eq 26) { 6 } elseif ($manifest.TargetCount -eq 256) { 10 } else { $targets.Count }
if ($targets.Count -ne $expectedBatchSize) { throw "Batch $Batch size mismatch: $($targets.Count)" }
if ($ExpectedBeforeCount -lt 0) { $ExpectedBeforeCount = 44 + (($Batch - 1) * 10) }
$existing = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($existing.Count -ne $ExpectedBeforeCount) { throw "Expected $ExpectedBeforeCount existing finals, found $($existing.Count)" }
if ($Batch -gt 1 -and $manifest.BatchCount -eq 26) {
  $previousTag = '{0:D2}' -f ($Batch - 1)
  $previousReceipt = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$previousTag\publish-receipt.json"
  if (-not (Test-Path -LiteralPath $previousReceipt -PathType Leaf)) { throw "Previous batch receipt missing: $previousReceipt" }
}
$collisions = @($targets | Where-Object { Test-Path -LiteralPath $_.targetPath })
if ($collisions.Count -ne 0) { throw "Target already exists: $($collisions[0].targetPath)" }
$tag = '{0:D2}' -f $Batch
$batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
$hashes = @($existing | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{path=$_.FullName;hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash}
})
$baseline = [pscustomobject]@{
  Batch=$Batch; CapturedAt=(Get-Date).ToString('o'); ExistingCount=$existing.Count
  ExpectedAfterCount=($existing.Count + $targets.Count); Hashes=$hashes
}
Write-CityMapJson -Value $baseline -Path (Join-Path $batchRoot 'baseline.json')
$baseline
~~~

- [ ] **Step 4: Implement Stage-CityMapBatch.ps1**

For each city:

~~~powershell
$size = Get-CityMapRankSize -Rank $city.rank
$source = Join-Path $batchRoot ("source\" + $city.id + ".png")
$staged = Join-Path $batchRoot ("staged-webp\" + $city.safeFileName + ".webp")
& magick $source -filter Lanczos -resize "$($size)x$($size)!" -strip -define webp:method=6 -quality 92 $staged
if ($LASTEXITCODE -ne 0) { throw "Conversion failed: $($city.name)" }
$meta = & magick identify -format '%m|%w|%h' $staged
if ($meta -ne "WEBP|$size|$size") { throw "Invalid staged file: $($city.name) => $meta" }
~~~

After all files pass, build review.jpg with 5×2 tiles; use 3×2 for Batch 26.

The complete Stage-CityMapBatch.ps1 loop and montage gate is:

~~~powershell
param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json'
)
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')
$manifest = Read-CityMapJson -Path $ManifestPath
$targets = @($manifest.Cities | Where-Object batch -eq $Batch | Sort-Object slot)
if ($targets.Count -eq 0) { throw "No targets for batch $Batch" }
$tag = '{0:D2}' -f $Batch
$batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
$stageRoot = Join-Path $batchRoot 'staged-webp'
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
$stagedPaths = @()
foreach ($city in $targets) {
  $size = Get-CityMapRankSize -Rank ([int]$city.rank)
  $source = Join-Path $batchRoot ("source\" + $city.id + '.png')
  $staged = Join-Path $stageRoot ($city.safeFileName + '.webp')
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing accepted source: $($city.name) => $source" }
  if (Test-Path -LiteralPath $staged) { throw "Staged output already exists: $staged" }
  & magick $source -filter Lanczos -resize "$($size)x$($size)!" -strip -define webp:method=6 -quality 92 $staged
  if ($LASTEXITCODE -ne 0) { throw "Conversion failed: $($city.name)" }
  $meta = & magick identify -format '%m|%w|%h' $staged
  if ($meta -ne "WEBP|$size|$size") { throw "Invalid staged file: $($city.name) => $meta" }
  $stagedPaths += $staged
}
$review = Join-Path $batchRoot 'review.jpg'
$tile = if ($targets.Count -eq 6) { '3x2' } else { '5x2' }
& magick montage @stagedPaths -thumbnail '900x900' -tile $tile -geometry '900x900+20+20' -background '#202020' -quality 90 $review
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $review -PathType Leaf)) { throw "Contact sheet failed for batch $Batch" }
[pscustomobject]@{Batch=$Batch;Staged=$stagedPaths.Count;Review=$review}
~~~

- [ ] **Step 5: Implement Publish-CityMapBatch.ps1**

Before copying any file:

- require the contact sheet and every staged WebP;
- require every target path to be absent;
- recompute all baseline hashes and stop on any mismatch;
- require a local approval receipt with batch number and approval timestamp.

Copy without -Force. Recompute hashes and write publish-receipt.json. A partial copy is a blocker; never overwrite or delete an old final to recover.

Implement the publication gate exactly:

~~~powershell
param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$AssetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам',
  [int]$ExpectedAfterCount = -1
)
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')
$manifest = Read-CityMapJson -Path $ManifestPath
$targets = @($manifest.Cities | Where-Object batch -eq $Batch | Sort-Object slot)
$tag = '{0:D2}' -f $Batch
$batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
$baseline = Read-CityMapJson -Path (Join-Path $batchRoot 'baseline.json')
$approval = Read-CityMapJson -Path (Join-Path $batchRoot 'approval.json')
if ($approval.Approved -ne $true -or [int]$approval.Batch -ne $Batch -or [string]::IsNullOrWhiteSpace([string]$approval.UserMessage)) {
  throw "Invalid approval receipt for batch $Batch"
}
if (-not (Test-Path -LiteralPath (Join-Path $batchRoot 'review.jpg') -PathType Leaf)) { throw 'Review contact sheet is missing' }
foreach ($old in $baseline.Hashes) {
  if (-not (Test-Path -LiteralPath $old.path -PathType Leaf)) { throw "Baseline file disappeared: $($old.path)" }
  $current = (Get-FileHash -Algorithm SHA256 -LiteralPath $old.path).Hash
  if ($current -ne $old.hash) { throw "Baseline hash changed: $($old.path)" }
}
foreach ($city in $targets) {
  if (Test-Path -LiteralPath $city.targetPath) { throw "Refusing to overwrite: $($city.targetPath)" }
  $staged = Join-Path $batchRoot ("staged-webp\" + $city.safeFileName + '.webp')
  if (-not (Test-Path -LiteralPath $staged -PathType Leaf)) { throw "Missing staged WebP: $staged" }
}
$installed = @()
foreach ($city in $targets) {
  $staged = Join-Path $batchRoot ("staged-webp\" + $city.safeFileName + '.webp')
  $parent = Split-Path -Parent $city.targetPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $staged -Destination $city.targetPath
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $staged).Hash
  $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $city.targetPath).Hash
  if ($sourceHash -ne $targetHash) { throw "Published hash mismatch: $($city.name)" }
  $installed += [pscustomobject]@{name=$city.name;path=$city.targetPath;hash=$targetHash}
}
if ($ExpectedAfterCount -lt 0) { $ExpectedAfterCount = [int]$baseline.ExpectedAfterCount }
$allFinals = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($allFinals.Count -ne $ExpectedAfterCount) { throw "Expected $ExpectedAfterCount finals, found $($allFinals.Count)" }
foreach ($old in $baseline.Hashes) {
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $old.path).Hash -ne $old.hash) { throw "Old file changed after publication: $($old.path)" }
}
$receipt = [pscustomobject]@{
  Batch=$Batch; PublishedAt=(Get-Date).ToString('o'); Approval=$approval
  BeforeCount=[int]$baseline.ExistingCount; AfterCount=$allFinals.Count; Installed=$installed
}
Write-CityMapJson -Value $receipt -Path (Join-Path $batchRoot 'publish-receipt.json')
$receipt
~~~

- [ ] **Step 6: Implement Test-CityMapFinalSet.ps1**

It must verify expected count, canonical filenames, exact rank folders and dimensions, no duplicates, every published target hash, and all protected baseline hashes.

Use this validation flow in Test-CityMapFinalSet.ps1:

~~~powershell
param(
  [Parameter(Mandatory)][int]$ExpectedCount,
  [ValidateRange(0,26)][int]$RequireManifestPrefix = 0,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = 'D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам'
)
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')
$manifest = Read-CityMapJson -Path $ManifestPath
$raw = Read-CityMapJson -Path $CitiesPath
$canonical = if ($raw -is [Array]) { @($raw) } else { @($raw.cities) }
$canonicalBySafeName = @{}
foreach ($city in $canonical) {
  $safeKey = (Get-CityMapSafeFileName -Name ([string]$city.name)).ToLowerInvariant()
  if ($canonicalBySafeName.ContainsKey($safeKey)) { throw "Canonical safe-name collision: $($city.name)" }
  $canonicalBySafeName[$safeKey] = $city
}
$files = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($files.Count -ne $ExpectedCount) { throw "Expected $ExpectedCount finals, found $($files.Count)" }
if (@($files.BaseName | Group-Object { $_.ToLowerInvariant() } | Where-Object Count -ne 1).Count -ne 0) { throw 'Duplicate final city name' }
foreach ($file in $files) {
  $key = $file.BaseName.ToLowerInvariant()
  if (-not $canonicalBySafeName.ContainsKey($key)) { throw "Non-canonical final: $($file.FullName)" }
  $city = $canonicalBySafeName[$key]
  $rank = [int]$city.rank
  if ($file.Directory.Name -cne "Ранг $rank") { throw "Wrong rank folder: $($file.FullName)" }
  $size = Get-CityMapRankSize -Rank $rank
  $meta = & magick identify -format '%m|%w|%h' $file.FullName
  if ($meta -ne "WEBP|$size|$size") { throw "Bad metadata: $($file.FullName) => $meta" }
}
for ($batch = 1; $batch -le $RequireManifestPrefix; $batch++) {
  $tag = '{0:D2}' -f $batch
  $receiptPath = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag\publish-receipt.json"
  $receipt = Read-CityMapJson -Path $receiptPath
  foreach ($installed in $receipt.Installed) {
    if (-not (Test-Path -LiteralPath $installed.path -PathType Leaf)) { throw "Receipt target missing: $($installed.path)" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $installed.path).Hash -ne $installed.hash) { throw "Receipt hash mismatch: $($installed.path)" }
  }
}
$publishedTargets = @($manifest.Cities | Where-Object { [int]$_.batch -le $RequireManifestPrefix })
foreach ($target in $publishedTargets) {
  if (-not (Test-Path -LiteralPath $target.targetPath -PathType Leaf)) { throw "Published manifest target missing: $($target.targetPath)" }
}
[pscustomobject]@{Status='PASS';FinalCount=$files.Count;PublishedBatches=$RequireManifestPrefix}
~~~

- [ ] **Step 7: Run tests and commit**

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\tests\Run-All.ps1
git add scripts/city-map-production
git commit -m "feat: add safe city map batch publishing"
~~~

### Task 4: Initialize the 26-Batch Production State

**Files:**
- Create: tmp/city-map-full-production/manifest.json
- Create: tmp/city-map-full-production/reference-catalog.json
- Create: tmp/city-map-full-production/batches/batch-01 through batch-26
- Verify: all 44 ready WebPs and all 8 originals

**Interfaces:**
- Consumes the committed harness.
- Produces the immutable production state consumed by Tasks 5–30.

- [ ] **Step 1: Run all harness tests**

Expected: PASS before touching external assets.

- [ ] **Step 2: Build the manifest exactly once**

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Build-CityMapManifest.ps1
~~~

Expected: 256 targets, 26 batches, sizes 10×25 and 6×1.

- [ ] **Step 3: Build and visually inspect both reference contact sheets**

Create one contact sheet for 44 ready maps grouped by rank and one for 8 originals. Record file paths, dimensions, hashes, role notes and known defects in reference-catalog.json.

- [ ] **Step 4: Compare generated batch manifests with the exact batch tasks below**

All names, ranks, batch numbers and counts must match Tasks 5–30. Stop on the first difference; do not silently regenerate a different ordering.

- [ ] **Step 5: Capture the master baseline**

Hash all 44 ready maps and all 8 originals. Store those hashes in tmp/city-map-full-production/master-baseline.json.

- [ ] **Step 6: Report readiness**

Report ImageMagick version, ImageGen availability, 300 canonical records, 44 ready maps, 8 originals, 256 targets and 26 batches. Do not begin Batch 01 until every value passes.


### Task 5: Produce and Publish Batch 01

**Files:**
- Read: tmp/city-map-full-production/batches/batch-01/manifest.json
- Create: tmp/city-map-full-production/batches/batch-01/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-01/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-01/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-01/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-01/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 54.

**State/region grouping:** Азадранская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Вурул | 4 | 4500×4500 |
| 2 | Варнелунд | 4 | 4500×4500 |
| 3 | Гримсалир | 4 | 4500×4500 |
| 4 | Торгенфьелл | 4 | 4500×4500 |
| 5 | Йорнстад | 6 | 5500×5500 |
| 6 | Линдскар | 6 | 5500×5500 |
| 7 | Фростерик | 6 | 5500×5500 |
| 8 | Хольмсвинн | 6 | 5500×5500 |
| 9 | Мирополь | 7 | 6000×6000 |
| 10 | Куддеборг | 8 | 6500×6500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 1
~~~

Expected: existing final count 44, batch size 10, no target path exists, and baseline.json is written under batch-01.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Вурул: run New-CityMapCard.ps1 with -Batch 1 -CityName "Вурул", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Варнелунд: run New-CityMapCard.ps1 with -Batch 1 -CityName "Варнелунд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гримсалир: run New-CityMapCard.ps1 with -Batch 1 -CityName "Гримсалир", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Торгенфьелл: run New-CityMapCard.ps1 with -Batch 1 -CityName "Торгенфьелл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Йорнстад: run New-CityMapCard.ps1 with -Batch 1 -CityName "Йорнстад", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Линдскар: run New-CityMapCard.ps1 with -Batch 1 -CityName "Линдскар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фростерик: run New-CityMapCard.ps1 with -Batch 1 -CityName "Фростерик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Хольмсвинн: run New-CityMapCard.ps1 with -Batch 1 -CityName "Хольмсвинн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Мирополь: run New-CityMapCard.ps1 with -Batch 1 -CityName "Мирополь", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Куддеборг: run New-CityMapCard.ps1 with -Batch 1 -CityName "Куддеборг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 1
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 01**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 1
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 54.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 54 -RequireManifestPrefix 1
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 6: Produce and Publish Batch 02

**Files:**
- Read: tmp/city-map-full-production/batches/batch-02/manifest.json
- Create: tmp/city-map-full-production/batches/batch-02/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-02/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-02/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-02/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-02/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 64.

**State/region grouping:** Азадранская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Стеннвальд | 8 | 6500×6500 |
| 2 | Йоттенмарк | 4 | 4500×4500 |
| 3 | Кальдвик | 4 | 4500×4500 |
| 4 | Валькерхольд | 7 | 6000×6000 |
| 5 | Хорнсворд | 5 | 5000×5000 |
| 6 | Гэфлей | 9 | 7000×7000 |
| 7 | Бьернхейм | 4 | 4500×4500 |
| 8 | Бальдревик | 4 | 4500×4500 |
| 9 | Харнессунд | 8 | 6500×6500 |
| 10 | Фелльстрем | 6 | 5500×5500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 2
~~~

Expected: existing final count 54, batch size 10, no target path exists, and baseline.json is written under batch-02.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Стеннвальд: run New-CityMapCard.ps1 with -Batch 2 -CityName "Стеннвальд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Йоттенмарк: run New-CityMapCard.ps1 with -Batch 2 -CityName "Йоттенмарк", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кальдвик: run New-CityMapCard.ps1 with -Batch 2 -CityName "Кальдвик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Валькерхольд: run New-CityMapCard.ps1 with -Batch 2 -CityName "Валькерхольд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Хорнсворд: run New-CityMapCard.ps1 with -Batch 2 -CityName "Хорнсворд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гэфлей: run New-CityMapCard.ps1 with -Batch 2 -CityName "Гэфлей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Бьернхейм: run New-CityMapCard.ps1 with -Batch 2 -CityName "Бьернхейм", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Бальдревик: run New-CityMapCard.ps1 with -Batch 2 -CityName "Бальдревик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Харнессунд: run New-CityMapCard.ps1 with -Batch 2 -CityName "Харнессунд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фелльстрем: run New-CityMapCard.ps1 with -Batch 2 -CityName "Фелльстрем", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 2
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 02**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 2
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 64.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 64 -RequireManifestPrefix 2
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 7: Produce and Publish Batch 03

**Files:**
- Read: tmp/city-map-full-production/batches/batch-03/manifest.json
- Create: tmp/city-map-full-production/batches/batch-03/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-03/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-03/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-03/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-03/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 74.

**State/region grouping:** Азадранская империя; Герцогство Нириан.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Йольмеран | 7 | 6000×6000 |
| 2 | Швейшет | 9 | 7000×7000 |
| 3 | Гурд | 4 | 4500×4500 |
| 4 | Круннесборг | 4 | 4500×4500 |
| 5 | Скарндан | 6 | 5500×5500 |
| 6 | Хагерсунд | 6 | 5500×5500 |
| 7 | Сарнесунд | 8 | 6500×6500 |
| 8 | Фреллхольм | 8 | 6500×6500 |
| 9 | Тапл | 6 | 5500×5500 |
| 10 | Храм Асахинэ | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 3
~~~

Expected: existing final count 64, batch size 10, no target path exists, and baseline.json is written under batch-03.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Йольмеран: run New-CityMapCard.ps1 with -Batch 3 -CityName "Йольмеран", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Швейшет: run New-CityMapCard.ps1 with -Batch 3 -CityName "Швейшет", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гурд: run New-CityMapCard.ps1 with -Batch 3 -CityName "Гурд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Круннесборг: run New-CityMapCard.ps1 with -Batch 3 -CityName "Круннесборг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Скарндан: run New-CityMapCard.ps1 with -Batch 3 -CityName "Скарндан", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Хагерсунд: run New-CityMapCard.ps1 with -Batch 3 -CityName "Хагерсунд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сарнесунд: run New-CityMapCard.ps1 with -Batch 3 -CityName "Сарнесунд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фреллхольм: run New-CityMapCard.ps1 with -Batch 3 -CityName "Фреллхольм", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тапл: run New-CityMapCard.ps1 with -Batch 3 -CityName "Тапл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Храм Асахинэ: run New-CityMapCard.ps1 with -Batch 3 -CityName "Храм Асахинэ", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 3
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 03**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 3
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 74.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 74 -RequireManifestPrefix 3
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 8: Produce and Publish Batch 04

**Files:**
- Read: tmp/city-map-full-production/batches/batch-04/manifest.json
- Create: tmp/city-map-full-production/batches/batch-04/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-04/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-04/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-04/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-04/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 84.

**State/region grouping:** Герцогство Нириан; Деварон; Имборский халифат.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Йовай | 5 | 5000×5000 |
| 2 | Мачи | 3 | 4000×4000 |
| 3 | Гальштадт | 3 | 4000×4000 |
| 4 | Луфорд | 4 | 4500×4500 |
| 5 | Портовый | 4 | 4500×4500 |
| 6 | Тегейт | 5 | 5000×5000 |
| 7 | Аль-Базар | 4 | 4500×4500 |
| 8 | Аль-Казар | 5 | 5000×5000 |
| 9 | Осколки древнего | 8 | 6500×6500 |
| 10 | Алу-Дали | 9 | 7000×7000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 4
~~~

Expected: existing final count 74, batch size 10, no target path exists, and baseline.json is written under batch-04.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Йовай: run New-CityMapCard.ps1 with -Batch 4 -CityName "Йовай", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Мачи: run New-CityMapCard.ps1 with -Batch 4 -CityName "Мачи", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гальштадт: run New-CityMapCard.ps1 with -Batch 4 -CityName "Гальштадт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Луфорд: run New-CityMapCard.ps1 with -Batch 4 -CityName "Луфорд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Портовый: run New-CityMapCard.ps1 with -Batch 4 -CityName "Портовый", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тегейт: run New-CityMapCard.ps1 with -Batch 4 -CityName "Тегейт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Аль-Базар: run New-CityMapCard.ps1 with -Batch 4 -CityName "Аль-Базар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Аль-Казар: run New-CityMapCard.ps1 with -Batch 4 -CityName "Аль-Казар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Осколки древнего: run New-CityMapCard.ps1 with -Batch 4 -CityName "Осколки древнего", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Алу-Дали: run New-CityMapCard.ps1 with -Batch 4 -CityName "Алу-Дали", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 4
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 04**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 4
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 84.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 84 -RequireManifestPrefix 4
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 9: Produce and Publish Batch 05

**Files:**
- Read: tmp/city-map-full-production/batches/batch-05/manifest.json
- Create: tmp/city-map-full-production/batches/batch-05/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-05/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-05/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-05/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-05/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 94.

**State/region grouping:** Княжество Понтвания; Королевство Илдуин.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Осазис золотой Лилии | 3 | 4000×4000 |
| 2 | Храм песчаного ветра | 3 | 4000×4000 |
| 3 | Сан | 4 | 4500×4500 |
| 4 | Лам-Джи | 5 | 5000×5000 |
| 5 | Южная женмужина | 5 | 5000×5000 |
| 6 | Забытые руины | 6 | 5500×5500 |
| 7 | Исток времён | 9 | 7000×7000 |
| 8 | Джио | 3 | 4000×4000 |
| 9 | Рапас | 3 | 4000×4000 |
| 10 | Стеурон | 3 | 4000×4000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 5
~~~

Expected: existing final count 84, batch size 10, no target path exists, and baseline.json is written under batch-05.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Осазис золотой Лилии: run New-CityMapCard.ps1 with -Batch 5 -CityName "Осазис золотой Лилии", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Храм песчаного ветра: run New-CityMapCard.ps1 with -Batch 5 -CityName "Храм песчаного ветра", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сан: run New-CityMapCard.ps1 with -Batch 5 -CityName "Сан", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лам-Джи: run New-CityMapCard.ps1 with -Batch 5 -CityName "Лам-Джи", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Южная женмужина: run New-CityMapCard.ps1 with -Batch 5 -CityName "Южная женмужина", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Забытые руины: run New-CityMapCard.ps1 with -Batch 5 -CityName "Забытые руины", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Исток времён: run New-CityMapCard.ps1 with -Batch 5 -CityName "Исток времён", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Джио: run New-CityMapCard.ps1 with -Batch 5 -CityName "Джио", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рапас: run New-CityMapCard.ps1 with -Batch 5 -CityName "Рапас", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Стеурон: run New-CityMapCard.ps1 with -Batch 5 -CityName "Стеурон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 5
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 05**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 5
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 94.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 94 -RequireManifestPrefix 5
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 10: Produce and Publish Batch 06

**Files:**
- Read: tmp/city-map-full-production/batches/batch-06/manifest.json
- Create: tmp/city-map-full-production/batches/batch-06/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-06/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-06/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-06/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-06/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 104.

**State/region grouping:** Королевство Илдуин; Королевство Менег.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Уфретон | 3 | 4000×4000 |
| 2 | Этра | 3 | 4000×4000 |
| 3 | Кераям | 4 | 4500×4500 |
| 4 | Нилиам | 4 | 4500×4500 |
| 5 | Техорд | 4 | 4500×4500 |
| 6 | Фендарис | 4 | 4500×4500 |
| 7 | Сахфис | 5 | 5000×5000 |
| 8 | Лойвиль | 7 | 6000×6000 |
| 9 | Краундор | 4 | 4500×4500 |
| 10 | Рогатый риф | 5 | 5000×5000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 6
~~~

Expected: existing final count 94, batch size 10, no target path exists, and baseline.json is written under batch-06.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Уфретон: run New-CityMapCard.ps1 with -Batch 6 -CityName "Уфретон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Этра: run New-CityMapCard.ps1 with -Batch 6 -CityName "Этра", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кераям: run New-CityMapCard.ps1 with -Batch 6 -CityName "Кераям", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Нилиам: run New-CityMapCard.ps1 with -Batch 6 -CityName "Нилиам", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Техорд: run New-CityMapCard.ps1 with -Batch 6 -CityName "Техорд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фендарис: run New-CityMapCard.ps1 with -Batch 6 -CityName "Фендарис", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сахфис: run New-CityMapCard.ps1 with -Batch 6 -CityName "Сахфис", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лойвиль: run New-CityMapCard.ps1 with -Batch 6 -CityName "Лойвиль", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Краундор: run New-CityMapCard.ps1 with -Batch 6 -CityName "Краундор", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рогатый риф: run New-CityMapCard.ps1 with -Batch 6 -CityName "Рогатый риф", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 6
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 06**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 6
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 104.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 104 -RequireManifestPrefix 6
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 11: Produce and Publish Batch 07

**Files:**
- Read: tmp/city-map-full-production/batches/batch-07/manifest.json
- Create: tmp/city-map-full-production/batches/batch-07/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-07/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-07/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-07/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-07/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 114.

**State/region grouping:** Королевство Менег.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Штормовой утёс | 5 | 5000×5000 |
| 2 | Дорнекар | 3 | 4000×4000 |
| 3 | Драскольн | 3 | 4000×4000 |
| 4 | Храм шестерёнок | 3 | 4000×4000 |
| 5 | Храмовые чертоги | 3 | 4000×4000 |
| 6 | Аскравир | 4 | 4500×4500 |
| 7 | Гелмурд | 4 | 4500×4500 |
| 8 | Даймвуд | 4 | 4500×4500 |
| 9 | Медный купол | 4 | 4500×4500 |
| 10 | Рандельм | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 7
~~~

Expected: existing final count 104, batch size 10, no target path exists, and baseline.json is written under batch-07.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Штормовой утёс: run New-CityMapCard.ps1 with -Batch 7 -CityName "Штормовой утёс", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дорнекар: run New-CityMapCard.ps1 with -Batch 7 -CityName "Дорнекар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Драскольн: run New-CityMapCard.ps1 with -Batch 7 -CityName "Драскольн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Храм шестерёнок: run New-CityMapCard.ps1 with -Batch 7 -CityName "Храм шестерёнок", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Храмовые чертоги: run New-CityMapCard.ps1 with -Batch 7 -CityName "Храмовые чертоги", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Аскравир: run New-CityMapCard.ps1 with -Batch 7 -CityName "Аскравир", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гелмурд: run New-CityMapCard.ps1 with -Batch 7 -CityName "Гелмурд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Даймвуд: run New-CityMapCard.ps1 with -Batch 7 -CityName "Даймвуд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Медный купол: run New-CityMapCard.ps1 with -Batch 7 -CityName "Медный купол", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рандельм: run New-CityMapCard.ps1 with -Batch 7 -CityName "Рандельм", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 7
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 07**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 7
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 114.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 114 -RequireManifestPrefix 7
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 12: Produce and Publish Batch 08

**Files:**
- Read: tmp/city-map-full-production/batches/batch-08/manifest.json
- Create: tmp/city-map-full-production/batches/batch-08/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-08/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-08/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-08/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-08/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 124.

**State/region grouping:** Куровийский союз.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Фарренхоф | 3 | 4000×4000 |
| 2 | Фрех | 3 | 4000×4000 |
| 3 | Виртшаль | 4 | 4500×4500 |
| 4 | Грантсхолм | 3 | 4000×4000 |
| 5 | Миррендейл | 3 | 4000×4000 |
| 6 | Бирчвуд | 5 | 5000×5000 |
| 7 | Тарнель | 3 | 4000×4000 |
| 8 | Хольмсберг | 3 | 4000×4000 |
| 9 | Гарронд | 4 | 4500×4500 |
| 10 | Марфорд | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 8
~~~

Expected: existing final count 114, batch size 10, no target path exists, and baseline.json is written under batch-08.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Фарренхоф: run New-CityMapCard.ps1 with -Batch 8 -CityName "Фарренхоф", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фрех: run New-CityMapCard.ps1 with -Batch 8 -CityName "Фрех", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Виртшаль: run New-CityMapCard.ps1 with -Batch 8 -CityName "Виртшаль", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Грантсхолм: run New-CityMapCard.ps1 with -Batch 8 -CityName "Грантсхолм", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Миррендейл: run New-CityMapCard.ps1 with -Batch 8 -CityName "Миррендейл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Бирчвуд: run New-CityMapCard.ps1 with -Batch 8 -CityName "Бирчвуд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тарнель: run New-CityMapCard.ps1 with -Batch 8 -CityName "Тарнель", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Хольмсберг: run New-CityMapCard.ps1 with -Batch 8 -CityName "Хольмсберг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гарронд: run New-CityMapCard.ps1 with -Batch 8 -CityName "Гарронд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Марфорд: run New-CityMapCard.ps1 with -Batch 8 -CityName "Марфорд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 8
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 08**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 8
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 124.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 124 -RequireManifestPrefix 8
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 13: Produce and Publish Batch 09

**Files:**
- Read: tmp/city-map-full-production/batches/batch-09/manifest.json
- Create: tmp/city-map-full-production/batches/batch-09/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-09/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-09/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-09/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-09/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 134.

**State/region grouping:** Куровийский союз.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Штальдорф | 4 | 4500×4500 |
| 2 | Вальденбрюг | 5 | 5000×5000 |
| 3 | Роттенфельд | 5 | 5000×5000 |
| 4 | Каларис | 3 | 4000×4000 |
| 5 | Озёрск | 3 | 4000×4000 |
| 6 | Тарстелл | 3 | 4000×4000 |
| 7 | Элдиран | 3 | 4000×4000 |
| 8 | Рудники далёких звёзд | 4 | 4500×4500 |
| 9 | Сантриан | 4 | 4500×4500 |
| 10 | Грац | 3 | 4000×4000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 9
~~~

Expected: existing final count 124, batch size 10, no target path exists, and baseline.json is written under batch-09.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Штальдорф: run New-CityMapCard.ps1 with -Batch 9 -CityName "Штальдорф", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Вальденбрюг: run New-CityMapCard.ps1 with -Batch 9 -CityName "Вальденбрюг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Роттенфельд: run New-CityMapCard.ps1 with -Batch 9 -CityName "Роттенфельд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Каларис: run New-CityMapCard.ps1 with -Batch 9 -CityName "Каларис", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Озёрск: run New-CityMapCard.ps1 with -Batch 9 -CityName "Озёрск", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тарстелл: run New-CityMapCard.ps1 with -Batch 9 -CityName "Тарстелл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Элдиран: run New-CityMapCard.ps1 with -Batch 9 -CityName "Элдиран", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рудники далёких звёзд: run New-CityMapCard.ps1 with -Batch 9 -CityName "Рудники далёких звёзд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сантриан: run New-CityMapCard.ps1 with -Batch 9 -CityName "Сантриан", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Грац: run New-CityMapCard.ps1 with -Batch 9 -CityName "Грац", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 9
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 09**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 9
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 134.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 134 -RequireManifestPrefix 9
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 14: Produce and Publish Batch 10

**Files:**
- Read: tmp/city-map-full-production/batches/batch-10/manifest.json
- Create: tmp/city-map-full-production/batches/batch-10/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-10/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-10/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-10/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-10/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 144.

**State/region grouping:** Куровийский союз.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Краненбург | 3 | 4000×4000 |
| 2 | Паровой город Дварфов | 5 | 5000×5000 |
| 3 | Волчий перевал | 4 | 4500×4500 |
| 4 | Крепость теневых стражей | 4 | 4500×4500 |
| 5 | Кристальные пещеры | 4 | 4500×4500 |
| 6 | Ледяной бастион | 5 | 5000×5000 |
| 7 | Маяк семи огней | 5 | 5000×5000 |
| 8 | Поля разрывной травы | 5 | 5000×5000 |
| 9 | Тресвен | 3 | 4000×4000 |
| 10 | Айзенбург | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 10
~~~

Expected: existing final count 134, batch size 10, no target path exists, and baseline.json is written under batch-10.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Краненбург: run New-CityMapCard.ps1 with -Batch 10 -CityName "Краненбург", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Паровой город Дварфов: run New-CityMapCard.ps1 with -Batch 10 -CityName "Паровой город Дварфов", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Волчий перевал: run New-CityMapCard.ps1 with -Batch 10 -CityName "Волчий перевал", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Крепость теневых стражей: run New-CityMapCard.ps1 with -Batch 10 -CityName "Крепость теневых стражей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кристальные пещеры: run New-CityMapCard.ps1 with -Batch 10 -CityName "Кристальные пещеры", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Ледяной бастион: run New-CityMapCard.ps1 with -Batch 10 -CityName "Ледяной бастион", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Маяк семи огней: run New-CityMapCard.ps1 with -Batch 10 -CityName "Маяк семи огней", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Поля разрывной травы: run New-CityMapCard.ps1 with -Batch 10 -CityName "Поля разрывной травы", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тресвен: run New-CityMapCard.ps1 with -Batch 10 -CityName "Тресвен", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Айзенбург: run New-CityMapCard.ps1 with -Batch 10 -CityName "Айзенбург", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 10
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 10**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 10
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 144.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 144 -RequireManifestPrefix 10
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 15: Produce and Publish Batch 11

**Files:**
- Read: tmp/city-map-full-production/batches/batch-11/manifest.json
- Create: tmp/city-map-full-production/batches/batch-11/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-11/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-11/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-11/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-11/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 154.

**State/region grouping:** Куровийский союз.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Каэрдонн | 4 | 4500×4500 |
| 2 | Риверстед | 4 | 4500×4500 |
| 3 | Браннхольд | 3 | 4000×4000 |
| 4 | Келдвэлл | 3 | 4000×4000 |
| 5 | Пиратская бухта | 3 | 4000×4000 |
| 6 | Фарнбридж | 3 | 4000×4000 |
| 7 | Проклятая гавань | 4 | 4500×4500 |
| 8 | Торговая бухта | 4 | 4500×4500 |
| 9 | Порт Далемир | 5 | 5000×5000 |
| 10 | Норвейн | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 11
~~~

Expected: existing final count 144, batch size 10, no target path exists, and baseline.json is written under batch-11.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Каэрдонн: run New-CityMapCard.ps1 with -Batch 11 -CityName "Каэрдонн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Риверстед: run New-CityMapCard.ps1 with -Batch 11 -CityName "Риверстед", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Браннхольд: run New-CityMapCard.ps1 with -Batch 11 -CityName "Браннхольд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Келдвэлл: run New-CityMapCard.ps1 with -Batch 11 -CityName "Келдвэлл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Пиратская бухта: run New-CityMapCard.ps1 with -Batch 11 -CityName "Пиратская бухта", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фарнбридж: run New-CityMapCard.ps1 with -Batch 11 -CityName "Фарнбридж", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Проклятая гавань: run New-CityMapCard.ps1 with -Batch 11 -CityName "Проклятая гавань", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Торговая бухта: run New-CityMapCard.ps1 with -Batch 11 -CityName "Торговая бухта", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Порт Далемир: run New-CityMapCard.ps1 with -Batch 11 -CityName "Порт Далемир", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Норвейн: run New-CityMapCard.ps1 with -Batch 11 -CityName "Норвейн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 11
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 11**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 11
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 154.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 154 -RequireManifestPrefix 11
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 16: Produce and Publish Batch 12

**Files:**
- Read: tmp/city-map-full-production/batches/batch-12/manifest.json
- Create: tmp/city-map-full-production/batches/batch-12/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-12/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-12/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-12/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-12/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 164.

**State/region grouping:** Куровийский союз; Майтен.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Бергвальд | 5 | 5000×5000 |
| 2 | Город мёртвых | 5 | 5000×5000 |
| 3 | Порт непокорённых ветров | 5 | 5000×5000 |
| 4 | Крепость железного солнца | 6 | 5500×5500 |
| 5 | Валхард | 2 | 3500×3500 |
| 6 | Орланис | 3 | 4000×4000 |
| 7 | Ридвелл | 3 | 4000×4000 |
| 8 | Смурфиролл | 3 | 4000×4000 |
| 9 | Эльдорин | 3 | 4000×4000 |
| 10 | Стейнвик | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 12
~~~

Expected: existing final count 154, batch size 10, no target path exists, and baseline.json is written under batch-12.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Бергвальд: run New-CityMapCard.ps1 with -Batch 12 -CityName "Бергвальд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Город мёртвых: run New-CityMapCard.ps1 with -Batch 12 -CityName "Город мёртвых", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Порт непокорённых ветров: run New-CityMapCard.ps1 with -Batch 12 -CityName "Порт непокорённых ветров", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Крепость железного солнца: run New-CityMapCard.ps1 with -Batch 12 -CityName "Крепость железного солнца", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Валхард: run New-CityMapCard.ps1 with -Batch 12 -CityName "Валхард", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Орланис: run New-CityMapCard.ps1 with -Batch 12 -CityName "Орланис", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Ридвелл: run New-CityMapCard.ps1 with -Batch 12 -CityName "Ридвелл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Смурфиролл: run New-CityMapCard.ps1 with -Batch 12 -CityName "Смурфиролл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Эльдорин: run New-CityMapCard.ps1 with -Batch 12 -CityName "Эльдорин", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Стейнвик: run New-CityMapCard.ps1 with -Batch 12 -CityName "Стейнвик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 12
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 12**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 12
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 164.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 164 -RequireManifestPrefix 12
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 17: Produce and Publish Batch 13

**Files:**
- Read: tmp/city-map-full-production/batches/batch-13/manifest.json
- Create: tmp/city-map-full-production/batches/batch-13/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-13/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-13/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-13/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-13/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 174.

**State/region grouping:** Майтен; Острова Гудада.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Гартенхейл | 5 | 5000×5000 |
| 2 | Дом переговоров | 5 | 5000×5000 |
| 3 | Велдоран | 9 | 7000×7000 |
| 4 | Валетт-Сюрмир | 3 | 4000×4000 |
| 5 | Карморант | 3 | 4000×4000 |
| 6 | Ременсьер | 3 | 4000×4000 |
| 7 | Фролансо | 4 | 4500×4500 |
| 8 | Девреньер | 3 | 4000×4000 |
| 9 | Омберанс | 4 | 4500×4500 |
| 10 | Сент-Равуар | 3 | 4000×4000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 13
~~~

Expected: existing final count 164, batch size 10, no target path exists, and baseline.json is written under batch-13.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Гартенхейл: run New-CityMapCard.ps1 with -Batch 13 -CityName "Гартенхейл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дом переговоров: run New-CityMapCard.ps1 with -Batch 13 -CityName "Дом переговоров", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Велдоран: run New-CityMapCard.ps1 with -Batch 13 -CityName "Велдоран", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Валетт-Сюрмир: run New-CityMapCard.ps1 with -Batch 13 -CityName "Валетт-Сюрмир", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Карморант: run New-CityMapCard.ps1 with -Batch 13 -CityName "Карморант", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Ременсьер: run New-CityMapCard.ps1 with -Batch 13 -CityName "Ременсьер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фролансо: run New-CityMapCard.ps1 with -Batch 13 -CityName "Фролансо", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Девреньер: run New-CityMapCard.ps1 with -Batch 13 -CityName "Девреньер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Омберанс: run New-CityMapCard.ps1 with -Batch 13 -CityName "Омберанс", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сент-Равуар: run New-CityMapCard.ps1 with -Batch 13 -CityName "Сент-Равуар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 13
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 13**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 13
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 174.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 174 -RequireManifestPrefix 13
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 18: Produce and Publish Batch 14

**Files:**
- Read: tmp/city-map-full-production/batches/batch-14/manifest.json
- Create: tmp/city-map-full-production/batches/batch-14/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-14/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-14/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-14/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-14/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 184.

**State/region grouping:** Острова Гудада.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Левонсио | 3 | 4000×4000 |
| 2 | Рошелье | 3 | 4000×4000 |
| 3 | Энвальер | 3 | 4000×4000 |
| 4 | Севрантур | 3 | 4000×4000 |
| 5 | Жирмонтель | 4 | 4500×4500 |
| 6 | Тьернавин | 3 | 4000×4000 |
| 7 | Моланшер | 4 | 4500×4500 |
| 8 | Дульмонте | 5 | 5000×5000 |
| 9 | Сент-Рамель | 6 | 5500×5500 |
| 10 | Бонтерран | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 14
~~~

Expected: existing final count 174, batch size 10, no target path exists, and baseline.json is written under batch-14.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Левонсио: run New-CityMapCard.ps1 with -Batch 14 -CityName "Левонсио", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рошелье: run New-CityMapCard.ps1 with -Batch 14 -CityName "Рошелье", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Энвальер: run New-CityMapCard.ps1 with -Batch 14 -CityName "Энвальер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Севрантур: run New-CityMapCard.ps1 with -Batch 14 -CityName "Севрантур", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Жирмонтель: run New-CityMapCard.ps1 with -Batch 14 -CityName "Жирмонтель", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тьернавин: run New-CityMapCard.ps1 with -Batch 14 -CityName "Тьернавин", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Моланшер: run New-CityMapCard.ps1 with -Batch 14 -CityName "Моланшер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дульмонте: run New-CityMapCard.ps1 with -Batch 14 -CityName "Дульмонте", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сент-Рамель: run New-CityMapCard.ps1 with -Batch 14 -CityName "Сент-Рамель", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Бонтерран: run New-CityMapCard.ps1 with -Batch 14 -CityName "Бонтерран", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 14
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 14**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 14
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 184.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 184 -RequireManifestPrefix 14
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 19: Produce and Publish Batch 15

**Files:**
- Read: tmp/city-map-full-production/batches/batch-15/manifest.json
- Create: tmp/city-map-full-production/batches/batch-15/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-15/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-15/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-15/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-15/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 194.

**State/region grouping:** Острова Гудада; Пустоши Голкранда.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Элваньер | 3 | 4000×4000 |
| 2 | Беллармо | 4 | 4500×4500 |
| 3 | Броннель | 3 | 4000×4000 |
| 4 | Монвильер | 4 | 4500×4500 |
| 5 | Дювалье | 3 | 4000×4000 |
| 6 | Лавиньер | 4 | 4500×4500 |
| 7 | Вальмирон | 4 | 4500×4500 |
| 8 | Калеврон | 4 | 4500×4500 |
| 9 | Гренсавьер | 5 | 5000×5000 |
| 10 | Тот | 2 | 3500×3500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 15
~~~

Expected: existing final count 184, batch size 10, no target path exists, and baseline.json is written under batch-15.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Элваньер: run New-CityMapCard.ps1 with -Batch 15 -CityName "Элваньер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Беллармо: run New-CityMapCard.ps1 with -Batch 15 -CityName "Беллармо", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Броннель: run New-CityMapCard.ps1 with -Batch 15 -CityName "Броннель", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Монвильер: run New-CityMapCard.ps1 with -Batch 15 -CityName "Монвильер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дювалье: run New-CityMapCard.ps1 with -Batch 15 -CityName "Дювалье", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лавиньер: run New-CityMapCard.ps1 with -Batch 15 -CityName "Лавиньер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Вальмирон: run New-CityMapCard.ps1 with -Batch 15 -CityName "Вальмирон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Калеврон: run New-CityMapCard.ps1 with -Batch 15 -CityName "Калеврон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гренсавьер: run New-CityMapCard.ps1 with -Batch 15 -CityName "Гренсавьер", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тот: run New-CityMapCard.ps1 with -Batch 15 -CityName "Тот", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 15
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 15**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 15
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 194.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 194 -RequireManifestPrefix 15
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 20: Produce and Publish Batch 16

**Files:**
- Read: tmp/city-map-full-production/batches/batch-16/manifest.json
- Create: tmp/city-map-full-production/batches/batch-16/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-16/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-16/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-16/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-16/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 204.

**State/region grouping:** Пустоши Голкранда; Республика Зомар.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Ущелье костей | 2 | 3500×3500 |
| 2 | Врагх | 3 | 4000×4000 |
| 3 | Каменная столица | 3 | 4000×4000 |
| 4 | Стоянка каменных великанов | 4 | 4500×4500 |
| 5 | Гаррикулд | 5 | 5000×5000 |
| 6 | Кхарг-Зул | 5 | 5000×5000 |
| 7 | Орон-Зайн | 9 | 7000×7000 |
| 8 | Моус | 4 | 4500×4500 |
| 9 | Телей | 6 | 5500×5500 |
| 10 | Баджанс | 6 | 5500×5500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 16
~~~

Expected: existing final count 194, batch size 10, no target path exists, and baseline.json is written under batch-16.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Ущелье костей: run New-CityMapCard.ps1 with -Batch 16 -CityName "Ущелье костей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Врагх: run New-CityMapCard.ps1 with -Batch 16 -CityName "Врагх", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Каменная столица: run New-CityMapCard.ps1 with -Batch 16 -CityName "Каменная столица", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Стоянка каменных великанов: run New-CityMapCard.ps1 with -Batch 16 -CityName "Стоянка каменных великанов", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Гаррикулд: run New-CityMapCard.ps1 with -Batch 16 -CityName "Гаррикулд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кхарг-Зул: run New-CityMapCard.ps1 with -Batch 16 -CityName "Кхарг-Зул", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Орон-Зайн: run New-CityMapCard.ps1 with -Batch 16 -CityName "Орон-Зайн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Моус: run New-CityMapCard.ps1 with -Batch 16 -CityName "Моус", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Телей: run New-CityMapCard.ps1 with -Batch 16 -CityName "Телей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Баджанс: run New-CityMapCard.ps1 with -Batch 16 -CityName "Баджанс", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 16
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 16**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 16
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 204.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 204 -RequireManifestPrefix 16
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 21: Produce and Publish Batch 17

**Files:**
- Read: tmp/city-map-full-production/batches/batch-17/manifest.json
- Create: tmp/city-map-full-production/batches/batch-17/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-17/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-17/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-17/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-17/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 214.

**State/region grouping:** Республика Зомар.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Клан Карий | 7 | 6000×6000 |
| 2 | Блеабес | 4 | 4500×4500 |
| 3 | Фэлэс | 4 | 4500×4500 |
| 4 | Селинг | 5 | 5000×5000 |
| 5 | Заксган | 6 | 5500×5500 |
| 6 | Одинокий | 4 | 4500×4500 |
| 7 | Урул | 4 | 4500×4500 |
| 8 | Лазурная вершина | 9 | 7000×7000 |
| 9 | Фэртон | 9 | 7000×7000 |
| 10 | Нивиас | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 17
~~~

Expected: existing final count 204, batch size 10, no target path exists, and baseline.json is written under batch-17.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Клан Карий: run New-CityMapCard.ps1 with -Batch 17 -CityName "Клан Карий", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Блеабес: run New-CityMapCard.ps1 with -Batch 17 -CityName "Блеабес", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фэлэс: run New-CityMapCard.ps1 with -Batch 17 -CityName "Фэлэс", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Селинг: run New-CityMapCard.ps1 with -Batch 17 -CityName "Селинг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Заксган: run New-CityMapCard.ps1 with -Batch 17 -CityName "Заксган", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Одинокий: run New-CityMapCard.ps1 with -Batch 17 -CityName "Одинокий", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Урул: run New-CityMapCard.ps1 with -Batch 17 -CityName "Урул", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лазурная вершина: run New-CityMapCard.ps1 with -Batch 17 -CityName "Лазурная вершина", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фэртон: run New-CityMapCard.ps1 with -Batch 17 -CityName "Фэртон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Нивиас: run New-CityMapCard.ps1 with -Batch 17 -CityName "Нивиас", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 17
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 17**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 17
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 214.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 214 -RequireManifestPrefix 17
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 22: Produce and Publish Batch 18

**Files:**
- Read: tmp/city-map-full-production/batches/batch-18/manifest.json
- Create: tmp/city-map-full-production/batches/batch-18/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-18/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-18/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-18/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-18/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 224.

**State/region grouping:** Республика Зомар; Теблин.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Шмыр | 4 | 4500×4500 |
| 2 | Столица красных | 5 | 5000×5000 |
| 3 | Арти | 5 | 5000×5000 |
| 4 | Зараш | 5 | 5000×5000 |
| 5 | Лаон | 5 | 5000×5000 |
| 6 | Форт рода Ринов | 6 | 5500×5500 |
| 7 | Рофт | 2 | 3500×3500 |
| 8 | Лагуна синих жемчужин | 3 | 4000×4000 |
| 9 | Пещеры бродячих теней | 4 | 4500×4500 |
| 10 | Рыбный рынок Асура | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 18
~~~

Expected: existing final count 214, batch size 10, no target path exists, and baseline.json is written under batch-18.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Шмыр: run New-CityMapCard.ps1 with -Batch 18 -CityName "Шмыр", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Столица красных: run New-CityMapCard.ps1 with -Batch 18 -CityName "Столица красных", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Арти: run New-CityMapCard.ps1 with -Batch 18 -CityName "Арти", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Зараш: run New-CityMapCard.ps1 with -Batch 18 -CityName "Зараш", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лаон: run New-CityMapCard.ps1 with -Batch 18 -CityName "Лаон", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Форт рода Ринов: run New-CityMapCard.ps1 with -Batch 18 -CityName "Форт рода Ринов", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рофт: run New-CityMapCard.ps1 with -Batch 18 -CityName "Рофт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Лагуна синих жемчужин: run New-CityMapCard.ps1 with -Batch 18 -CityName "Лагуна синих жемчужин", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Пещеры бродячих теней: run New-CityMapCard.ps1 with -Batch 18 -CityName "Пещеры бродячих теней", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рыбный рынок Асура: run New-CityMapCard.ps1 with -Batch 18 -CityName "Рыбный рынок Асура", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 18
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 18**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 18
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 224.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 224 -RequireManifestPrefix 18
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 23: Produce and Publish Batch 19

**Files:**
- Read: tmp/city-map-full-production/batches/batch-19/manifest.json
- Create: tmp/city-map-full-production/batches/batch-19/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-19/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-19/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-19/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-19/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 234.

**State/region grouping:** Умелилуанская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Тингерстад | 4 | 4500×4500 |
| 2 | Эльденрик | 4 | 4500×4500 |
| 3 | Карнсвик | 6 | 5500×5500 |
| 4 | Рейн | 6 | 5500×5500 |
| 5 | Порт Арканистов | 8 | 6500×6500 |
| 6 | Александровка | 6 | 5500×5500 |
| 7 | ДулДалай | 6 | 5500×5500 |
| 8 | Перийвидол | 4 | 4500×4500 |
| 9 | Бэлэс | 6 | 5500×5500 |
| 10 | Перийвайрам | 6 | 5500×5500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 19
~~~

Expected: existing final count 224, batch size 10, no target path exists, and baseline.json is written under batch-19.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Тингерстад: run New-CityMapCard.ps1 with -Batch 19 -CityName "Тингерстад", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Эльденрик: run New-CityMapCard.ps1 with -Batch 19 -CityName "Эльденрик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Карнсвик: run New-CityMapCard.ps1 with -Batch 19 -CityName "Карнсвик", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Рейн: run New-CityMapCard.ps1 with -Batch 19 -CityName "Рейн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Порт Арканистов: run New-CityMapCard.ps1 with -Batch 19 -CityName "Порт Арканистов", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Александровка: run New-CityMapCard.ps1 with -Batch 19 -CityName "Александровка", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] ДулДалай: run New-CityMapCard.ps1 with -Batch 19 -CityName "ДулДалай", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Перийвидол: run New-CityMapCard.ps1 with -Batch 19 -CityName "Перийвидол", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Бэлэс: run New-CityMapCard.ps1 with -Batch 19 -CityName "Бэлэс", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Перийвайрам: run New-CityMapCard.ps1 with -Batch 19 -CityName "Перийвайрам", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 19
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 19**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 19
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 234.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 234 -RequireManifestPrefix 19
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 24: Produce and Publish Batch 20

**Files:**
- Read: tmp/city-map-full-production/batches/batch-20/manifest.json
- Create: tmp/city-map-full-production/batches/batch-20/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-20/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-20/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-20/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-20/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 244.

**State/region grouping:** Умелилуанская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Перийинкат | 6 | 5500×5500 |
| 2 | Перийкаль | 6 | 5500×5500 |
| 3 | Дрогфор | 4 | 4500×4500 |
| 4 | Илкас | 4 | 4500×4500 |
| 5 | Сар | 4 | 4500×4500 |
| 6 | Джам | 6 | 5500×5500 |
| 7 | Кларес | 4 | 4500×4500 |
| 8 | Фласо | 6 | 5500×5500 |
| 9 | Крафрос | 8 | 6500×6500 |
| 10 | Сейт | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 20
~~~

Expected: existing final count 234, batch size 10, no target path exists, and baseline.json is written under batch-20.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Перийинкат: run New-CityMapCard.ps1 with -Batch 20 -CityName "Перийинкат", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Перийкаль: run New-CityMapCard.ps1 with -Batch 20 -CityName "Перийкаль", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дрогфор: run New-CityMapCard.ps1 with -Batch 20 -CityName "Дрогфор", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Илкас: run New-CityMapCard.ps1 with -Batch 20 -CityName "Илкас", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сар: run New-CityMapCard.ps1 with -Batch 20 -CityName "Сар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Джам: run New-CityMapCard.ps1 with -Batch 20 -CityName "Джам", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кларес: run New-CityMapCard.ps1 with -Batch 20 -CityName "Кларес", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Фласо: run New-CityMapCard.ps1 with -Batch 20 -CityName "Фласо", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Крафрос: run New-CityMapCard.ps1 with -Batch 20 -CityName "Крафрос", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сейт: run New-CityMapCard.ps1 with -Batch 20 -CityName "Сейт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 20
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 20**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 20
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 244.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 244 -RequireManifestPrefix 20
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 25: Produce and Publish Batch 21

**Files:**
- Read: tmp/city-map-full-production/batches/batch-21/manifest.json
- Create: tmp/city-map-full-production/batches/batch-21/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-21/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-21/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-21/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-21/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 254.

**State/region grouping:** Умелилуанская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Синхай | 4 | 4500×4500 |
| 2 | Турн | 5 | 5000×5000 |
| 3 | Зишард | 4 | 4500×4500 |
| 4 | Сакурайт | 4 | 4500×4500 |
| 5 | Ваул | 4 | 4500×4500 |
| 6 | Миу | 4 | 4500×4500 |
| 7 | Злимонд | 6 | 5500×5500 |
| 8 | Уикреахам | 6 | 5500×5500 |
| 9 | Скальдеруд | 6 | 5500×5500 |
| 10 | Урохул | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 21
~~~

Expected: existing final count 244, batch size 10, no target path exists, and baseline.json is written under batch-21.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Синхай: run New-CityMapCard.ps1 with -Batch 21 -CityName "Синхай", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Турн: run New-CityMapCard.ps1 with -Batch 21 -CityName "Турн", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Зишард: run New-CityMapCard.ps1 with -Batch 21 -CityName "Зишард", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сакурайт: run New-CityMapCard.ps1 with -Batch 21 -CityName "Сакурайт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Ваул: run New-CityMapCard.ps1 with -Batch 21 -CityName "Ваул", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Миу: run New-CityMapCard.ps1 with -Batch 21 -CityName "Миу", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Злимонд: run New-CityMapCard.ps1 with -Batch 21 -CityName "Злимонд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Уикреахам: run New-CityMapCard.ps1 with -Batch 21 -CityName "Уикреахам", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Скальдеруд: run New-CityMapCard.ps1 with -Batch 21 -CityName "Скальдеруд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Урохул: run New-CityMapCard.ps1 with -Batch 21 -CityName "Урохул", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 21
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 21**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 21
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 254.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 254 -RequireManifestPrefix 21
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 26: Produce and Publish Batch 22

**Files:**
- Read: tmp/city-map-full-production/batches/batch-22/manifest.json
- Create: tmp/city-map-full-production/batches/batch-22/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-22/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-22/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-22/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-22/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 264.

**State/region grouping:** Умелилуанская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Летающий Гритл | 5 | 5000×5000 |
| 2 | Северная столица | 6 | 5500×5500 |
| 3 | Эдей | 4 | 4500×4500 |
| 4 | Загос | 6 | 5500×5500 |
| 5 | Марий | 4 | 4500×4500 |
| 6 | Буфо | 6 | 5500×5500 |
| 7 | Тоур | 6 | 5500×5500 |
| 8 | Торжественный колизей | 8 | 6500×6500 |
| 9 | Дазэим | 4 | 4500×4500 |
| 10 | Речной | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 22
~~~

Expected: existing final count 254, batch size 10, no target path exists, and baseline.json is written under batch-22.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Летающий Гритл: run New-CityMapCard.ps1 with -Batch 22 -CityName "Летающий Гритл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Северная столица: run New-CityMapCard.ps1 with -Batch 22 -CityName "Северная столица", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Эдей: run New-CityMapCard.ps1 with -Batch 22 -CityName "Эдей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Загос: run New-CityMapCard.ps1 with -Batch 22 -CityName "Загос", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Марий: run New-CityMapCard.ps1 with -Batch 22 -CityName "Марий", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Буфо: run New-CityMapCard.ps1 with -Batch 22 -CityName "Буфо", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тоур: run New-CityMapCard.ps1 with -Batch 22 -CityName "Тоур", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Торжественный колизей: run New-CityMapCard.ps1 with -Batch 22 -CityName "Торжественный колизей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дазэим: run New-CityMapCard.ps1 with -Batch 22 -CityName "Дазэим", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Речной: run New-CityMapCard.ps1 with -Batch 22 -CityName "Речной", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 22
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 22**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 22
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 264.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 264 -RequireManifestPrefix 22
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 27: Produce and Publish Batch 23

**Files:**
- Read: tmp/city-map-full-production/batches/batch-23/manifest.json
- Create: tmp/city-map-full-production/batches/batch-23/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-23/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-23/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-23/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-23/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 274.

**State/region grouping:** Умелилуанская империя.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Рыбный | 4 | 4500×4500 |
| 2 | Люсия | 4 | 4500×4500 |
| 3 | Меззо | 4 | 4500×4500 |
| 4 | Шарт | 6 | 5500×5500 |
| 5 | Золотой город | 8 | 6500×6500 |
| 6 | Вандерхолл | 4 | 4500×4500 |
| 7 | Дартар | 6 | 5500×5500 |
| 8 | Монумент империй | 6 | 5500×5500 |
| 9 | Предигма | 6 | 5500×5500 |
| 10 | Ксай | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 23
~~~

Expected: existing final count 264, batch size 10, no target path exists, and baseline.json is written under batch-23.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Рыбный: run New-CityMapCard.ps1 with -Batch 23 -CityName "Рыбный", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Люсия: run New-CityMapCard.ps1 with -Batch 23 -CityName "Люсия", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Меззо: run New-CityMapCard.ps1 with -Batch 23 -CityName "Меззо", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Шарт: run New-CityMapCard.ps1 with -Batch 23 -CityName "Шарт", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Золотой город: run New-CityMapCard.ps1 with -Batch 23 -CityName "Золотой город", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Вандерхолл: run New-CityMapCard.ps1 with -Batch 23 -CityName "Вандерхолл", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Дартар: run New-CityMapCard.ps1 with -Batch 23 -CityName "Дартар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Монумент империй: run New-CityMapCard.ps1 with -Batch 23 -CityName "Монумент империй", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Предигма: run New-CityMapCard.ps1 with -Batch 23 -CityName "Предигма", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Ксай: run New-CityMapCard.ps1 with -Batch 23 -CityName "Ксай", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 23
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 23**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 23
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 274.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 274 -RequireManifestPrefix 23
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 28: Produce and Publish Batch 24

**Files:**
- Read: tmp/city-map-full-production/batches/batch-24/manifest.json
- Create: tmp/city-map-full-production/batches/batch-24/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-24/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-24/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-24/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-24/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 284.

**State/region grouping:** Умелилуанская империя; Хуратская теократия.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Йона | 6 | 5500×5500 |
| 2 | Трир | 6 | 5500×5500 |
| 3 | Шария | 6 | 5500×5500 |
| 4 | Миухэйм | 4 | 4500×4500 |
| 5 | Истоки алиатской реки | 6 | 5500×5500 |
| 6 | Эльфийская столица | 8 | 6500×6500 |
| 7 | Зихдэнд | 4 | 4500×4500 |
| 8 | Огненный город | 4 | 4500×4500 |
| 9 | Тандарал | 4 | 4500×4500 |
| 10 | Харланис | 4 | 4500×4500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 24
~~~

Expected: existing final count 274, batch size 10, no target path exists, and baseline.json is written under batch-24.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Йона: run New-CityMapCard.ps1 with -Batch 24 -CityName "Йона", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Трир: run New-CityMapCard.ps1 with -Batch 24 -CityName "Трир", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Шария: run New-CityMapCard.ps1 with -Batch 24 -CityName "Шария", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Миухэйм: run New-CityMapCard.ps1 with -Batch 24 -CityName "Миухэйм", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Истоки алиатской реки: run New-CityMapCard.ps1 with -Batch 24 -CityName "Истоки алиатской реки", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Эльфийская столица: run New-CityMapCard.ps1 with -Batch 24 -CityName "Эльфийская столица", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Зихдэнд: run New-CityMapCard.ps1 with -Batch 24 -CityName "Зихдэнд", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Огненный город: run New-CityMapCard.ps1 with -Batch 24 -CityName "Огненный город", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тандарал: run New-CityMapCard.ps1 with -Batch 24 -CityName "Тандарал", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Харланис: run New-CityMapCard.ps1 with -Batch 24 -CityName "Харланис", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 24
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 24**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 24
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 284.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 284 -RequireManifestPrefix 24
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 29: Produce and Publish Batch 25

**Files:**
- Read: tmp/city-map-full-production/batches/batch-25/manifest.json
- Create: tmp/city-map-full-production/batches/batch-25/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-25/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-25/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-25/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-25/review.jpg
- Add externally: 10 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 10 targets installed, old hashes preserved, and final tree count 294.

**State/region grouping:** Хуратская теократия; Юлтан-Гласт.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Красная река | 5 | 5000×5000 |
| 2 | Седлоуг | 5 | 5000×5000 |
| 3 | Сиеш | 5 | 5000×5000 |
| 4 | Девадей | 6 | 5500×5500 |
| 5 | Крепость теней | 9 | 7000×7000 |
| 6 | Андр | 2 | 3500×3500 |
| 7 | Странбу | 2 | 3500×3500 |
| 8 | Элмир’Лаан | 2 | 3500×3500 |
| 9 | Вайлис’Тар | 3 | 4000×4000 |
| 10 | Кар’Джулан | 3 | 4000×4000 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 25
~~~

Expected: existing final count 284, batch size 10, no target path exists, and baseline.json is written under batch-25.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Красная река: run New-CityMapCard.ps1 with -Batch 25 -CityName "Красная река", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Седлоуг: run New-CityMapCard.ps1 with -Batch 25 -CityName "Седлоуг", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сиеш: run New-CityMapCard.ps1 with -Batch 25 -CityName "Сиеш", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Девадей: run New-CityMapCard.ps1 with -Batch 25 -CityName "Девадей", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Крепость теней: run New-CityMapCard.ps1 with -Batch 25 -CityName "Крепость теней", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Андр: run New-CityMapCard.ps1 with -Batch 25 -CityName "Андр", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Странбу: run New-CityMapCard.ps1 with -Batch 25 -CityName "Странбу", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Элмир’Лаан: run New-CityMapCard.ps1 with -Batch 25 -CityName "Элмир’Лаан", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Вайлис’Тар: run New-CityMapCard.ps1 with -Batch 25 -CityName "Вайлис’Тар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Кар’Джулан: run New-CityMapCard.ps1 with -Batch 25 -CityName "Кар’Джулан", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 25
~~~

Expected: 10 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 25**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 25
~~~

Expected: 10 new files copied, zero existing files changed, final tree count 294.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 294 -RequireManifestPrefix 25
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 30: Produce and Publish Batch 26

**Files:**
- Read: tmp/city-map-full-production/batches/batch-26/manifest.json
- Create: tmp/city-map-full-production/batches/batch-26/cards/{manifest.id}.json
- Create: tmp/city-map-full-production/batches/batch-26/prompts/{manifest.id}.txt
- Create: tmp/city-map-full-production/batches/batch-26/source/{manifest.id}.png
- Create: tmp/city-map-full-production/batches/batch-26/staged-webp/{manifest.safeFileName}.webp
- Create: tmp/city-map-full-production/batches/batch-26/review.jpg
- Add externally: 6 new WebPs under D:\FoundryVTT\Data\assets\Карты\Карты городов\Пилот по рангам\Ранг N

**Interfaces:**
- Consumes: manifest.json, reference-catalog.json, New-CityMapCard.ps1, Start-CityMapBatch.ps1, Stage-CityMapBatch.ps1, Publish-CityMapBatch.ps1.
- Produces: a user-approved batch with all 6 targets installed, old hashes preserved, and final tree count 300.

**State/region grouping:** Юлтан-Гласт.

| Slot | City | Rank | Final size |
|---:|---|---:|---:|
| 1 | Лиара’Кен | 3 | 4000×4000 |
| 2 | Тир’Алмар | 3 | 4000×4000 |
| 3 | Саэлин'Вар | 3 | 4000×4000 |
| 4 | Сло | 3 | 4000×4000 |
| 5 | Нир-Каду | 7 | 6000×6000 |
| 6 | Вэск’Ранор | 2 | 3500×3500 |

- [ ] **Step 1: Start the batch and capture its immutable baseline**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Start-CityMapBatch.ps1 -Batch 26
~~~

Expected: existing final count 294, batch size 6, no target path exists, and baseline.json is written under batch-26.

- [ ] **Step 2: Complete the mandatory city micro-cycle in the listed order**

  - [ ] Лиара’Кен: run New-CityMapCard.ps1 with -Batch 26 -CityName "Лиара’Кен", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Тир’Алмар: run New-CityMapCard.ps1 with -Batch 26 -CityName "Тир’Алмар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Саэлин'Вар: run New-CityMapCard.ps1 with -Batch 26 -CityName "Саэлин'Вар", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Сло: run New-CityMapCard.ps1 with -Batch 26 -CityName "Сло", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Нир-Каду: run New-CityMapCard.ps1 with -Batch 26 -CityName "Нир-Каду", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.
  - [ ] Вэск’Ранор: run New-CityMapCard.ps1 with -Batch 26 -CityName "Вэск’Ранор", inspect the selected references, run built-in ImageGen from the exact prompt.txt, review with view_image, and save only the accepted result as source\{manifest.id}.png.

Do not advance past a rejected city. Maximum attempts per city: three total (initial generation plus two targeted retries).

- [ ] **Step 3: Convert accepted PNG sources into staged WebPs and build the contact sheet**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Stage-CityMapBatch.ps1 -Batch 26
~~~

Expected: 6 staged WebPs, exact rank dimensions, and review.jpg. The output asset tree is still unchanged.

- [ ] **Step 4: Review the entire batch**

Open review.jpg, then open every staged WebP individually. Reject any map with an oblique camera, visible facade, wrong rank scale, wrong biome/culture, text, copied layout, repetitive terrain, or cropped city edge.

- [ ] **Step 5: Obtain explicit user approval for Batch 26**

Show the contact sheet and report any retries. Do not publish on silence, partial approval, or an unrelated reply.

- [ ] **Step 6: Publish without overwriting existing files**

Run only after approval:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Publish-CityMapBatch.ps1 -Batch 26
~~~

Expected: 6 new files copied, zero existing files changed, final tree count 300.

- [ ] **Step 7: Verify and checkpoint**

Run:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 300 -RequireManifestPrefix 26
~~~

Expected: PASS. Preserve sources, prompts, cards, contact sheet, baseline and publish receipt. Then move to the next batch.


### Task 31: Complete the 300-Map Master Audit

**Files:**
- Verify externally: all 300 WebPs in the ranked output tree
- Verify: all 8 originals
- Create: tmp/city-map-full-production/final-audit.json
- Create: tmp/city-map-full-production/final-by-rank contact sheets
- Create: tmp/city-map-full-production/final-by-state contact sheets

**Interfaces:**
- Consumes all 26 publish receipts and the master baseline.
- Produces evidence that the full set is complete, unique, technically valid and recoverable.

- [ ] **Step 1: Run the final validator**

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\city-map-production\Test-CityMapFinalSet.ps1 -ExpectedCount 300 -RequireManifestPrefix 26
~~~

Expected: PASS.

- [ ] **Step 2: Assert exact rank distribution**

Expected counts:

~~~text
Rank 1: 3
Rank 2: 13
Rank 3: 61
Rank 4: 94
Rank 5: 41
Rank 6: 46
Rank 7: 11
Rank 8: 16
Rank 9: 14
Rank 10: 1
~~~

- [ ] **Step 3: Assert exact canonical name coverage**

Compare normalized safe filenames with all 300 names from cities.json. Expected: zero missing, zero extra, zero duplicates and zero unresolved filename collisions.

- [ ] **Step 4: Recheck protected references**

All initial 44 ready-map hashes and all 8 original-reference hashes must equal master-baseline.json.

- [ ] **Step 5: Build final review sheets**

Create rank-grouped sheets that make scale progression visible and state-grouped sheets that make cultural consistency visible. Review for copied layouts, repeated terrain stamps, perspective drift, text artifacts and cultural bleed between states.

- [ ] **Step 6: Sample every batch at full resolution**

Open at least one final WebP from every batch, plus every rank-8, rank-9 and rank-10 map. Any hard-gate defect reopens the owning batch; never patch the final WebP by painting over a defect.

- [ ] **Step 7: Write final-audit.json**

Record:

- total count and rank counts;
- all 300 paths, dimensions and SHA-256 hashes;
- all 26 publish receipts;
- protected-reference verification;
- contact-sheet paths;
- unresolved warnings, which must be an empty array for completion.

- [ ] **Step 8: Report completion and recoverability**

Report the final root, staging root, reference root, number of attempts/retries, count of generated maps, all audit results and the fact that original references plus initial 44 maps remained unchanged. Do not delete the staging tree.
