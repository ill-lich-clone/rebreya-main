param(
  [Parameter(Mandatory)][string]$ManifestPath,
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [Parameter(Mandatory)][string]$CityName,
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

function ConvertFrom-CityMapUtf8Base64([string]$Value) {
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Value))
}

if ([string]::IsNullOrWhiteSpace($AssetRoot)) {
  $AssetRoot = ConvertFrom-CityMapUtf8Base64 'RDpcRm91bmRyeVZUVFxEYXRhXGFzc2V0c1zQmtCw0YDRgtGLXNCa0LDRgNGC0Ysg0LPQvtGA0L7QtNC+0LJc0J/QuNC70L7RgiDQv9C+INGA0LDQvdCz0LDQvA=='
}

$script:CityMapModeTokens = [pscustomobject]@{
  MechanusState = ConvertFrom-CityMapUtf8Base64 '0JrQvtGA0L7Qu9C10LLRgdGC0LLQviDQnNC10L3QtdCz'
  PortCityType = ConvertFrom-CityMapUtf8Base64 '0J/QvtGA0YLQvtCy0YvQuQ=='
  CoastLocationType = ConvertFrom-CityMapUtf8Base64 '0JHQtdGA0LXQsw=='
  IndustrialCityType = ConvertFrom-CityMapUtf8Base64 '0JjQvdC00YPRgdGC0YDQuNCw0LvRjNC90YvQuQ=='
  MechanusPattern = ConvertFrom-CityMapUtf8Base64 '0LzQtdGF0LDQvXzRiNC10YHRgtC10YB80L/QsNGA0L7QsnzQvNC10LTQvXzQvNCw0YjQuNC9'
  UnderdarkPattern = ConvertFrom-CityMapUtf8Base64 '0L/QvtC00LfQtdC8fNC/0LXRidC10YB80YLQtdC90Yx80YLRjNC8'
  UndergroundLocationPattern = ConvertFrom-CityMapUtf8Base64 '0L/QvtC00LfQtdC8fNC/0LXRidC10YB80LPQu9GD0LHQuNC9fNCw0L3QtNC10YDQtNCw0YDQug=='
  CoastPattern = ConvertFrom-CityMapUtf8Base64 '0LHQtdGA0LXQs3zQv9C+0LHQtdGA0LXQtnzQvtGB0YLRgNC+0LI='
  WaterPattern = ConvertFrom-CityMapUtf8Base64 '0YDQtdC60LB80L7Qt9C10YB80LHQvtC70L7Rgg=='
  ForestPattern = ConvertFrom-CityMapUtf8Base64 '0LvQtdGB'
  MountainPattern = ConvertFrom-CityMapUtf8Base64 '0LPQvtGAfNGF0YDQtdCxfNGB0LrQsNC7fNC/0LvQsNGC0L4='
  DesertPattern = ConvertFrom-CityMapUtf8Base64 '0L/Rg9GB0YLRi9C9fNC00Y7QvXzQv9C10YHQug=='
  MechanusMapPath = ConvertFrom-CityMapUtf8Base64 '0JzQtdGF0LDQvdGD0YFc0KTQoNCQ0JPQniDQmtCQ0KDQotCQLndlYnA='
  MechanusCorePath = ConvertFrom-CityMapUtf8Base64 '0JzQtdGF0LDQvdGD0YFc0K/QtNGA0L4ud2VicA=='
}

function Get-CityMapOriginalMode([object]$City) {
  $haystack = (([string]$City.description) + ' ' + ([string]$City.cityType) + ' ' + ([string]$City.locationType)).ToLowerInvariant()
  $location = ([string]$City.locationType).ToLowerInvariant()

  if ([string]$City.state -ceq $script:CityMapModeTokens.MechanusState -or $haystack -match $script:CityMapModeTokens.MechanusPattern) {
    return 'mechanus'
  }
  if ([string]$City.cityType -ceq $script:CityMapModeTokens.PortCityType -or [string]$City.locationType -ceq $script:CityMapModeTokens.CoastLocationType) {
    return 'harbor'
  }
  if ($haystack -match $script:CityMapModeTokens.UnderdarkPattern -or $location -match $script:CityMapModeTokens.UndergroundLocationPattern) {
    return 'underdark'
  }
  if ([string]$City.cityType -ceq $script:CityMapModeTokens.IndustrialCityType) {
    return 'industrial'
  }
  return 'temperate'
}

function Get-CityMapLocationGuidance([object]$City) {
  $location = ([string]$City.locationType).ToLowerInvariant()
  $plane = [string]$City.plane
  $guidance = switch -Regex ($location) {
    $script:CityMapModeTokens.CoastPattern { 'Integrate shoreline, docks, quays, moorings and inland access roads as a coherent top-down waterfront.'; break }
    $script:CityMapModeTokens.WaterPattern { 'Make watercourses, crossings, embankments and drainage part of the city plan; preserve readable top-down banks and bridges.'; break }
    $script:CityMapModeTokens.ForestPattern { 'Show a managed forest edge, old roads and cleared urban ground without turning the city into a camp or a repeating tree pattern.'; break }
    $script:CityMapModeTokens.MountainPattern { 'Use top-down terraces, retaining walls, switchback roads and roof footprints that follow terrain without any side-on cliffs.'; break }
    $script:CityMapModeTokens.DesertPattern { 'Use top-down desert roads, courtyards, cisterns, shade structures and cultivated water-dependent edges.'; break }
    $script:CityMapModeTokens.UndergroundLocationPattern { 'Use a connected underground top-down city plan with chambers, bridges, tunnels and luminous zones, never a side-view cave.'; break }
    default { 'Make the stated location type legible through the surrounding terrain, access routes and district edge conditions.' }
  }
  return "$guidance Plane context: $plane."
}

$manifest = Read-CityMapJson -Path $ManifestPath
$targetMatches = @($manifest.Cities | Where-Object {
  [int]$_.batch -eq $Batch -and [string]$_.name -ceq $CityName
})
if ($targetMatches.Count -ne 1) {
  throw "Expected one manifest target for Batch $Batch / $CityName, found $($targetMatches.Count)"
}
$target = $targetMatches[0]

$raw = Read-CityMapJson -Path $CitiesPath
$canonical = if ($raw -is [Array]) { @($raw) } elseif ($null -ne $raw.cities) { @($raw.cities) } else { throw 'Unknown cities.json shape' }
$canonicalByName = @{}
foreach ($city in $canonical) {
  $canonicalByName[[string]$city.name.ToLowerInvariant()] = $city
}

$readyCandidates = @()
foreach ($file in @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')) {
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
$secondary = if ($readyCandidates.Count -gt 1 -and [int]$readyCandidates[1].score -gt 0) { $readyCandidates[1] } else { $null }

$mode = Get-CityMapOriginalMode -City $target
$originalRoot = Split-Path -Parent $AssetRoot
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
    [pscustomobject]@{path=(Join-Path $originalRoot $script:CityMapModeTokens.MechanusMapPath); role='radial machine-city districts and canals'},
    [pscustomobject]@{path=(Join-Path $originalRoot $script:CityMapModeTokens.MechanusCorePath); role='concentric machine-capital infrastructure'}
  )
}
$originals = @($originalModes[$mode])
foreach ($reference in $originals) {
  if (-not (Test-Path -LiteralPath $reference.path -PathType Leaf)) {
    throw "Missing original reference: $($reference.path)"
  }
}

$rankContracts = @{
  1='tiny locality: a compact landmark-scale settlement with a clearly readable edge'
  2='small village or town: several streets or blocks and one local landmark'
  3='complete small city: connected street network, several districts and a visible city edge'
  4='developed city: dense blocks, market, craft and residential districts, one or more landmarks'
  5='large regional center: many blocks, developed infrastructure and outer suburbs'
  6='large city, port or fortress: several major functional zones and strong transport hierarchy'
  7='dense metropolis: large continuous urban footprint and complex district network'
  8='immense capital: multi-level district hierarchy and monumental civic or trade center'
  9='legendary capital or unique city: exceptional landmark and extensive complex urban fabric'
  10='world-scale capital: a vast continuous city with landmark-scale infrastructure and an unmistakable hierarchy of districts'
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

$mustInclude = @(
  "Canonical feature: $($target.description)",
  "Rank-$($target.rank) scale: $rankContract",
  "Geography: $(Get-CityMapLocationGuidance -City $target)",
  "Cultural continuity: $($target.state), $($target.regionName), $($target.cityType)"
)
$mustAvoid = @(
  'facades, side walls, horizons and perspective',
  'letters, numbers, runes, labels and pseudotext',
  'copied street networks, repeated tree stamps and generic biome filters',
  'a camp, scattered huts or disconnected platforms in place of a permanent city'
)

$zeroBlock = @'
ZERO-PASS CARTOGRAPHIC GATE - APPLY BEFORE DRAWING ANY CONTENT.
Lock the entire image to an exact 90-degree nadir orthographic map projection. This is a flat cartographic city plan, never a bird's-eye illustration, isometric scene, landscape painting, or cinematic aerial shot. Every building must be represented only by roof shape, footprint, courtyard, wall plan, road and ground surface. If any design choice would expose a facade, door, window, vertical side wall, horizon, vanishing point, or directional perspective, redesign it as a top-down roof or footprint. Circular towers, plazas, domes, reservoirs and arenas must remain true circles, never perspective ellipses. Apply this rule consistently to the center, edges, terrain, cliffs, bridges and tallest landmarks.
'@
$outputBlock = @'
OUTPUT CONTRACT.
One polished square Foundry VTT regional city map, richly detailed hand-drawn fantasy atlas style, crisp dark contours, readable roofs, roads, districts and terrain, natural colors, subtle watercolor and paper texture. Show the complete city footprint and enough meaningful surrounding geography. No text, city name, letters, numbers, runes, pseudotext, captions, legend, frame, grid, compass, coat of arms, logo, signature, watermark, visible facade, side wall, horizon, isometric angle, perspective ellipse, copied street layout, repeated tree stamp, or cropped essential district.
'@
$referenceText = ($referenceRecords | ForEach-Object {
  "- $($_.kind): $($_.role). Never copy its exact street network, text, watermark, frame or camera defect."
}) -join [Environment]::NewLine
$productionContext = $target.production | ConvertTo-Json -Compress -Depth 6
$demandContext = $target.demand | ConvertTo-Json -Compress -Depth 6
$locationGuidance = Get-CityMapLocationGuidance -City $target
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
Geographic behavior: $locationGuidance
Cultural continuity: Preserve the material culture, civic organization, roof language and district logic appropriate to $($target.state) and $($target.regionName), while keeping $($target.cityType) functions legible.
Production context: $productionContext
Demand context: $demandContext

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
$cardPath = Join-Path $batchRoot ('cards\' + $target.id + '.json')
$promptPath = Join-Path $batchRoot ('prompts\' + $target.id + '.txt')
$card = [pscustomobject]@{
  id=$target.id
  name=$target.name
  description=$target.description
  rank=$target.rank
  width=$target.width
  height=$target.height
  population=$target.population
  state=$target.state
  regionName=$target.regionName
  locationType=$target.locationType
  cityType=$target.cityType
  plane=$target.plane
  religion=$target.religion
  production=$target.production
  demand=$target.demand
  targetPath=$target.targetPath
  primaryReadyReference=$primary
  secondaryReadyReference=$secondary
  originalReferenceMode=$mode
  originalReferencePaths=@($originals | ForEach-Object path)
  referenceRoles=@($referenceRecords | ForEach-Object role)
  referenceRecords=$referenceRecords
  mustInclude=$mustInclude
  mustAvoid=$mustAvoid
  attempts=@()
  accepted=$false
}
Write-CityMapJson -Value $card -Path $cardPath
$prompt | Set-Content -Encoding UTF8 -LiteralPath $promptPath

[pscustomobject]@{ Card=$cardPath; Prompt=$promptPath; Primary=$primary.name; OriginalMode=$mode }
