param(
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = '',
  [string]$WorkRoot = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production'
)

. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

if ([string]::IsNullOrWhiteSpace($AssetRoot)) {
  $AssetRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('RDpcRm91bmRyeVZUVFxEYXRhXGFzc2V0c1zQmtCw0YDRgtGLXNCa0LDRgNGC0Ysg0LPQvtGA0L7QtNC+0LJc0J/QuNC70L7RgiDQv9C+INGA0LDQvdCz0LDQvA=='))
}

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

$rankPrefix = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0KDQsNC90LMg'))
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
    targetPath=(Join-Path (Join-Path $AssetRoot ($rankPrefix + $rank)) ($safe + '.webp'))
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
