param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$AssetRoot = '',
  [int]$ExpectedAfterCount = -1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'CityMap.Common.ps1')

if ([string]::IsNullOrWhiteSpace($AssetRoot)) {
  $AssetRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('RDpcRm91bmRyeVZUVFxEYXRhXGFzc2V0c1zQmtCw0YDRgtGLXNCa0LDRgNGC0Ysg0LPQvtGA0L7QtNC+0LJc0J/QuNC70L7RgiDQv9C+INGA0LDQvdCz0LDQvA=='))
}
if (-not (Test-Path -LiteralPath $AssetRoot -PathType Container)) { throw "Asset root is missing: $AssetRoot" }

$manifest = Read-CityMapJson -Path $ManifestPath
$targets = @($manifest.Cities | Where-Object { [int]$_.batch -eq $Batch } | Sort-Object slot)
if ($targets.Count -eq 0) { throw "No targets for batch $Batch" }
$tag = '{0:D2}' -f $Batch
$batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
$baseline = Read-CityMapJson -Path (Join-Path $batchRoot 'baseline.json')
$approval = Read-CityMapJson -Path (Join-Path $batchRoot 'approval.json')
if ($approval.Approved -ne $true -or [int]$approval.Batch -ne $Batch -or [string]::IsNullOrWhiteSpace([string]$approval.ApprovedAt) -or [string]::IsNullOrWhiteSpace([string]$approval.UserMessage)) {
  throw "Invalid approval receipt for batch $Batch"
}
if (-not (Test-Path -LiteralPath (Join-Path $batchRoot 'review.jpg') -PathType Leaf)) { throw 'Review contact sheet is missing' }

foreach ($old in @($baseline.Hashes)) {
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
  [IO.File]::Copy($staged, $city.targetPath, $false)
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $staged).Hash
  $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $city.targetPath).Hash
  if ($sourceHash -ne $targetHash) { throw "Published hash mismatch: $($city.name)" }
  $installed += [pscustomobject]@{name=$city.name;path=$city.targetPath;hash=$targetHash}
}

if ($ExpectedAfterCount -lt 0) { $ExpectedAfterCount = [int]$baseline.ExpectedAfterCount }
$allFinals = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($allFinals.Count -ne $ExpectedAfterCount) { throw "Expected $ExpectedAfterCount finals, found $($allFinals.Count)" }
foreach ($old in @($baseline.Hashes)) {
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $old.path).Hash -ne $old.hash) { throw "Old file changed after publication: $($old.path)" }
}
$receipt = [pscustomobject]@{
  Batch=$Batch; PublishedAt=(Get-Date).ToString('o'); Approval=$approval
  BeforeCount=[int]$baseline.ExistingCount; AfterCount=$allFinals.Count; Installed=$installed
}
Write-CityMapJson -Value $receipt -Path (Join-Path $batchRoot 'publish-receipt.json')
$receipt
