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

  $catalogPath = Join-Path $testRoot 'reference-catalog.json'
  $readyCatalog = [pscustomobject]@{
    readyMaps = @(Get-ChildItem -LiteralPath $assetRoot -Recurse -File -Filter '*.webp' | ForEach-Object {
      [pscustomobject]@{ name=$_.BaseName; path=$_.FullName }
    })
  }
  $readyCatalog | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $catalogPath
  $cardScript = Join-Path $repoRoot 'scripts\city-map-production\New-CityMapCard.ps1'
  $vurulName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0JLRg9GA0YPQuw=='))
  & $cardScript -ManifestPath $manifestPath -Batch 1 -CityName $vurulName -CitiesPath $citiesPath -AssetRoot $assetRoot
  $cardPath = Join-Path $testRoot 'batches\batch-01\cards\vurul.json'
  $promptPath = Join-Path $testRoot 'batches\batch-01\prompts\vurul.txt'
  Assert-True (Test-Path -LiteralPath $cardPath -PathType Leaf) 'Vurul card was not created'
  Assert-True (Test-Path -LiteralPath $promptPath -PathType Leaf) 'Vurul prompt was not created'
  $card = Get-Content -Raw -Encoding UTF8 -LiteralPath $cardPath | ConvertFrom-Json
  $prompt = Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath
  Assert-True ($card.rank -eq 4 -and $card.width -eq 4500 -and $card.height -eq 4500) 'Vurul rank size is wrong'
  Assert-True ($card.primaryReadyReference.rank -eq 4) 'Primary ready anchor must have rank 4'
  $zeroHeading = 'ZERO-PASS CARTOGRAPHIC GATE ' + [char]0x2014 + ' APPLY BEFORE DRAWING ANY CONTENT.'
  Assert-True ($prompt.StartsWith($zeroHeading)) 'Prompt does not start with the exact zero-pass gate'
  Assert-True ($prompt.Contains([string]$card.description)) 'Prompt does not contain the canonical description'
  Assert-True ($prompt.Contains('Never render the metadata city name')) 'Prompt does not prohibit rendering the name'
  Assert-True ($prompt.TrimEnd().EndsWith('cropped essential district.')) 'Prompt does not end with the output contract'
  Assert-True (@($card.referenceRecords).Count -le 4) 'Reference record limit exceeded'
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
