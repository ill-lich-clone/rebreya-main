Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$buildScript = Join-Path $repoRoot 'scripts\city-map-production\Build-CityMapManifest.ps1'
$citiesPath = Join-Path $repoRoot 'data\cities.json'
$assetRoot = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('RDpcRm91bmRyeVZUVFxEYXRhXGFzc2V0c1zQmtCw0YDRgtGLXNCa0LDRgNGC0Ysg0LPQvtGA0L7QtNC+0LJc0J/QuNC70L7RgiDQv9C+INGA0LDQvdCz0LDQvA=='))
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
