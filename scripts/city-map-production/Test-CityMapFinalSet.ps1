param(
  [Parameter(Mandatory)][int]$ExpectedCount,
  [ValidateRange(0,26)][int]$RequireManifestPrefix = 0,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$CitiesPath = 'D:\FoundryVTT\Data\modules\rebreya-main\data\cities.json',
  [string]$AssetRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

if ([string]::IsNullOrWhiteSpace($AssetRoot)) {
  $AssetRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('RDpcRm91bmRyeVZUVFxEYXRhXGFzc2V0c1zQmtCw0YDRgtGLXNCa0LDRgNGC0Ysg0LPQvtGA0L7QtNC+0LJc0J/QuNC70L7RgiDQv9C+INGA0LDQvdCz0LDQvA=='))
}
if (-not (Test-Path -LiteralPath $AssetRoot -PathType Container)) { throw "Asset root is missing: $AssetRoot" }

$manifest = Read-CityMapJson -Path $ManifestPath
$raw = Read-CityMapJson -Path $CitiesPath
$canonical = if ($raw -is [Array]) { @($raw) } elseif ($null -ne $raw.cities) { @($raw.cities) } else { throw 'Unknown cities.json shape' }
$canonicalBySafeName = @{}
foreach ($city in $canonical) {
  $safeKey = (Get-CityMapSafeFileName -Name ([string]$city.name)).ToLowerInvariant()
  if ($canonicalBySafeName.ContainsKey($safeKey)) { throw "Canonical safe-name collision: $($city.name)" }
  $canonicalBySafeName[$safeKey] = $city
}

$rankPrefix = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0KDQsNC90LMg'))
$files = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($files.Count -ne $ExpectedCount) { throw "Expected $ExpectedCount finals, found $($files.Count)" }
if (@($files.BaseName | Group-Object { $_.ToLowerInvariant() } | Where-Object Count -ne 1).Count -ne 0) { throw 'Duplicate final city name' }
foreach ($file in $files) {
  $key = $file.BaseName.ToLowerInvariant()
  if (-not $canonicalBySafeName.ContainsKey($key)) { throw "Non-canonical final: $($file.FullName)" }
  $city = $canonicalBySafeName[$key]
  $rank = [int]$city.rank
  if ($file.Directory.Name -cne ($rankPrefix + $rank)) { throw "Wrong rank folder: $($file.FullName)" }
  $size = Get-CityMapRankSize -Rank $rank
  $meta = & magick identify -format '%m|%w|%h' $file.FullName
  if ($meta -ne "WEBP|$size|$size") { throw "Bad metadata: $($file.FullName) => $meta" }
}

for ($batch = 1; $batch -le $RequireManifestPrefix; $batch++) {
  $tag = '{0:D2}' -f $batch
  $batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
  $baseline = Read-CityMapJson -Path (Join-Path $batchRoot 'baseline.json')
  foreach ($old in @($baseline.Hashes)) {
    if (-not (Test-Path -LiteralPath $old.path -PathType Leaf)) { throw "Baseline file disappeared: $($old.path)" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $old.path).Hash -ne $old.hash) { throw "Baseline hash mismatch: $($old.path)" }
  }
  $receipt = Read-CityMapJson -Path (Join-Path $batchRoot 'publish-receipt.json')
  if ([int]$receipt.Batch -ne $batch) { throw "Wrong receipt batch: $($receipt.Batch)" }
  foreach ($installed in @($receipt.Installed)) {
    if (-not (Test-Path -LiteralPath $installed.path -PathType Leaf)) { throw "Receipt target missing: $($installed.path)" }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $installed.path).Hash -ne $installed.hash) { throw "Receipt hash mismatch: $($installed.path)" }
  }
}
$publishedTargets = @($manifest.Cities | Where-Object { [int]$_.batch -le $RequireManifestPrefix })
foreach ($target in $publishedTargets) {
  if (-not (Test-Path -LiteralPath $target.targetPath -PathType Leaf)) { throw "Published manifest target missing: $($target.targetPath)" }
}
[pscustomobject]@{Status='PASS';FinalCount=$files.Count;PublishedBatches=$RequireManifestPrefix}
