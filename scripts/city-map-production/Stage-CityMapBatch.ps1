param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

$manifest = Read-CityMapJson -Path $ManifestPath
$targets = @($manifest.Cities | Where-Object { [int]$_.batch -eq $Batch } | Sort-Object slot)
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
  if (Test-Path -LiteralPath $staged -PathType Leaf) { throw "Staged output already exists: $staged" }
  & magick $source -filter Lanczos -resize "$($size)x$($size)!" -strip -define webp:method=6 -quality 92 $staged
  if ($LASTEXITCODE -ne 0) { throw "Conversion failed: $($city.name)" }
  $meta = & magick identify -format '%m|%w|%h' $staged
  if ($meta -ne "WEBP|$size|$size") { throw "Invalid staged file: $($city.name) => $meta" }
  $stagedPaths += $staged
}

$review = Join-Path $batchRoot 'review.jpg'
if (Test-Path -LiteralPath $review -PathType Leaf) { throw "Review contact sheet already exists: $review" }
$tile = if ($targets.Count -eq 6) { '3x2' } else { '5x2' }
& magick montage @stagedPaths -thumbnail '900x900' -tile $tile -geometry '900x900+20+20' -background '#202020' -quality 90 $review
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $review -PathType Leaf)) { throw "Contact sheet failed for batch $Batch" }
[pscustomobject]@{Batch=$Batch;Staged=$stagedPaths.Count;Review=$review}
