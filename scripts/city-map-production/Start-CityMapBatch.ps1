param(
  [Parameter(Mandatory)][ValidateRange(1,26)][int]$Batch,
  [string]$ManifestPath = 'D:\FoundryVTT\Data\modules\rebreya-main\tmp\city-map-full-production\manifest.json',
  [string]$AssetRoot = '',
  [int]$ExpectedBeforeCount = -1
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
$expectedBatchSize = if ($Batch -eq 26 -and [int]$manifest.BatchCount -eq 26) { 6 } elseif ([int]$manifest.TargetCount -eq 256) { 10 } else { $targets.Count }
if ($targets.Count -ne $expectedBatchSize) { throw "Batch $Batch size mismatch: $($targets.Count)" }
if ($ExpectedBeforeCount -lt 0) { $ExpectedBeforeCount = 44 + (($Batch - 1) * 10) }

$existing = @(Get-ChildItem -LiteralPath $AssetRoot -Recurse -File -Filter '*.webp')
if ($existing.Count -ne $ExpectedBeforeCount) { throw "Expected $ExpectedBeforeCount existing finals, found $($existing.Count)" }
if ($Batch -gt 1 -and [int]$manifest.BatchCount -eq 26) {
  $previousTag = '{0:D2}' -f ($Batch - 1)
  $previousReceipt = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$previousTag\publish-receipt.json"
  if (-not (Test-Path -LiteralPath $previousReceipt -PathType Leaf)) { throw "Previous batch receipt missing: $previousReceipt" }
}

$collisions = @($targets | Where-Object { Test-Path -LiteralPath $_.targetPath })
if ($collisions.Count -ne 0) { throw "Target already exists: $($collisions[0].targetPath)" }
$tag = '{0:D2}' -f $Batch
$batchRoot = Join-Path (Split-Path -Parent $ManifestPath) "batches\batch-$tag"
$baselinePath = Join-Path $batchRoot 'baseline.json'
if (Test-Path -LiteralPath $baselinePath -PathType Leaf) { throw "Batch baseline already exists: $baselinePath" }
foreach ($folder in 'cards','prompts','source','staged-webp') {
  New-Item -ItemType Directory -Force -Path (Join-Path $batchRoot $folder) | Out-Null
}

$hashes = @($existing | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{path=$_.FullName;hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash}
})
$baseline = [pscustomobject]@{
  Batch=$Batch; CapturedAt=(Get-Date).ToString('o'); ExistingCount=$existing.Count
  ExpectedAfterCount=($existing.Count + $targets.Count); Hashes=$hashes
}
Write-CityMapJson -Value $baseline -Path $baselinePath
$baseline
