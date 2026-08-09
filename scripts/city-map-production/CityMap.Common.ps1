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
