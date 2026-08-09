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

  $fixtureRoot = Join-Path $testRoot 'publish-fixture'
  $fixtureAsset = Join-Path $fixtureRoot 'assets'
  $fixtureBatch = Join-Path $fixtureRoot 'batches\batch-01'
  $fixtureRank = Join-Path $fixtureAsset ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0KDQsNC90LMg')) + '2')
  New-Item -ItemType Directory -Force -Path $fixtureRank | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $fixtureBatch 'source') | Out-Null

  $protected = Join-Path $fixtureRank 'Protected.webp'
  & magick -size 3500x3500 xc:'#556644' $protected
  if ($LASTEXITCODE -ne 0) { throw 'Could not create protected fixture WebP' }
  $protectedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $protected).Hash
  $targetPath = Join-Path $fixtureRank 'Test City.webp'
  $fixtureManifest = [pscustomobject]@{
    SchemaVersion=1; CanonicalCount=2; InitialReadyCount=1; TargetCount=1; BatchCount=1
    Cities=@([pscustomobject]@{
      id='test-city'; name='Test City'; safeFileName='Test City'; description='test'
      rank=2; width=3500; height=3500; population=600; state='test'; regionName='test'
      locationType='meadow'; cityType='agricultural'; batch=1; slot=1; targetPath=$targetPath
    })
  }
  $fixtureManifestPath = Join-Path $fixtureRoot 'manifest.json'
  $fixtureManifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $fixtureManifestPath
  $fixtureManifest.Cities | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $fixtureBatch 'manifest.json')
  $fixtureCitiesPath = Join-Path $fixtureRoot 'cities.json'
  @(
    [pscustomobject]@{name='Protected'; rank=2},
    [pscustomobject]@{name='Test City'; rank=2}
  ) | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath $fixtureCitiesPath

  $startScript = Join-Path $repoRoot 'scripts\city-map-production\Start-CityMapBatch.ps1'
  $stageScript = Join-Path $repoRoot 'scripts\city-map-production\Stage-CityMapBatch.ps1'
  $publishScript = Join-Path $repoRoot 'scripts\city-map-production\Publish-CityMapBatch.ps1'
  $auditScript = Join-Path $repoRoot 'scripts\city-map-production\Test-CityMapFinalSet.ps1'
  $baselineResult = & $startScript -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedBeforeCount 1
  Assert-True ($baselineResult.BatchSize -eq 1) 'Start result does not expose the batch size'

  $missingSourceStopped = $false
  try {
    & $stageScript -Batch 1 -ManifestPath $fixtureManifestPath
  } catch {
    $missingSourceStopped = $true
  }
  Assert-True $missingSourceStopped 'Staging accepted a batch with a missing source'

  $sourcePath = Join-Path $fixtureBatch 'source\test-city.png'
  & magick -size 256x256 xc:'#778855' $sourcePath
  if ($LASTEXITCODE -ne 0) { throw 'Could not create fixture PNG' }
  & $stageScript -Batch 1 -ManifestPath $fixtureManifestPath
  $stagedPath = Join-Path $fixtureBatch 'staged-webp\Test City.webp'
  Assert-True (Test-Path -LiteralPath $stagedPath -PathType Leaf) 'Staging did not create the WebP'
  Assert-True ((& magick identify -format '%m|%w|%h' $stagedPath) -eq 'WEBP|3500|3500') 'Staged WebP dimensions are wrong'
  Assert-True (Test-Path -LiteralPath (Join-Path $fixtureBatch 'review.jpg') -PathType Leaf) 'Contact sheet is missing'

  [pscustomobject]@{Batch=1;Approved=$true;ApprovedAt=(Get-Date).ToString('o');UserMessage='fixture approval'} |
    ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $fixtureBatch 'approval.json')
  & $publishScript -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedAfterCount 2
  Assert-True (Test-Path -LiteralPath $targetPath -PathType Leaf) 'Published fixture target is missing'
  Assert-True ((Get-FileHash -Algorithm SHA256 -LiteralPath $protected).Hash -eq $protectedHash) 'Protected fixture changed'
  $audit = & $auditScript -ExpectedCount 2 -RequireManifestPrefix 1 -ManifestPath $fixtureManifestPath -CitiesPath $fixtureCitiesPath -AssetRoot $fixtureAsset
  Assert-True ($audit.Status -eq 'PASS') 'Final set audit did not pass for a valid fixture'

  $receiptPath = Join-Path $fixtureBatch 'publish-receipt.json'
  $receipt = Get-Content -Raw -Encoding UTF8 -LiteralPath $receiptPath | ConvertFrom-Json
  $originalInstalled = @($receipt.Installed)
  $receipt.Installed = @()
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $receiptPath
  $missingReceiptStopped = $false
  try {
    & $auditScript -ExpectedCount 2 -RequireManifestPrefix 1 -ManifestPath $fixtureManifestPath -CitiesPath $fixtureCitiesPath -AssetRoot $fixtureAsset | Out-Null
  } catch {
    $missingReceiptStopped = $true
  }
  Assert-True $missingReceiptStopped 'Final audit accepted a receipt missing a batch target'

  $receipt.Installed = @($originalInstalled + $originalInstalled[0])
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $receiptPath
  $duplicateReceiptStopped = $false
  try {
    & $auditScript -ExpectedCount 2 -RequireManifestPrefix 1 -ManifestPath $fixtureManifestPath -CitiesPath $fixtureCitiesPath -AssetRoot $fixtureAsset | Out-Null
  } catch {
    $duplicateReceiptStopped = $true
  }
  Assert-True $duplicateReceiptStopped 'Final audit accepted a receipt with duplicate targets'

  $receipt.Installed = @($originalInstalled + [pscustomobject]@{name='Extra';path=$protected;hash=$protectedHash})
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath $receiptPath
  $extraReceiptStopped = $false
  try {
    & $auditScript -ExpectedCount 2 -RequireManifestPrefix 1 -ManifestPath $fixtureManifestPath -CitiesPath $fixtureCitiesPath -AssetRoot $fixtureAsset | Out-Null
  } catch {
    $extraReceiptStopped = $true
  }
  Assert-True $extraReceiptStopped 'Final audit accepted a receipt with an extra target'

  $collisionStopped = $false
  try {
    & $publishScript -Batch 1 -ManifestPath $fixtureManifestPath -AssetRoot $fixtureAsset -ExpectedAfterCount 2
  } catch {
    $collisionStopped = $true
  }
  Assert-True $collisionStopped 'Second publication did not stop on an existing target'
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
