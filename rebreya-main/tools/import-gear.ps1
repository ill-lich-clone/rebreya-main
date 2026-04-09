param(
  [string]$WorkbookPath = "",
  [string]$MaterialsPath = "",
  [string]$OutputPath = "",
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

function Write-Info([string]$Message) {
  if (-not $Quiet) { Write-Host $Message }
}

function Resolve-ModuleRoot { return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")) }
function Resolve-MaterialsPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\materials.json")
}
function Resolve-OutputPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\gear.json")
}
function Normalize-DisplayText([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return (($Value -replace "\s+", " ").Trim())
}
function Get-MatchKey([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  return $text.ToLowerInvariant()
}
function Get-LooseMatchKey([string]$Value) {
  $text = Get-MatchKey $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  return ($text -replace "[^\p{L}\p{Nd}]", "")
}
function Convert-ToPlainNumber([string]$Value, [switch]$AllowNull) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $(if ($AllowNull) { $null } else { 0 }) }
  $text = Normalize-DisplayText $Value
  if ($text -match '^(\d+)\s+(\d+)/(\d+)$') { return [double]$Matches[1] + ([double]$Matches[2] / [double]$Matches[3]) }
  if ($text -match '^(\d+)/(\d+)$') { return [double]$Matches[1] / [double]$Matches[2] }
  $numericText = (($text -replace '[^0-9,.\-]', '') -replace ',', '.')
  if ([string]::IsNullOrWhiteSpace($numericText)) { return $(if ($AllowNull) { $null } else { 0 }) }
  $number = 0.0
  if ([double]::TryParse($numericText, [System.Globalization.NumberStyles]::Float, $InvariantCulture, [ref]$number)) { return $number }
  return $(if ($AllowNull) { $null } else { 0 })
}
function Normalize-PriceCode([string]$Value) {
  $text = ((Normalize-DisplayText $Value).ToLowerInvariant() -replace '[^[:word:]]', '')
  switch ($text) {
    'мм' { return 'cp' }
    'см' { return 'sp' }
    'эм' { return 'ep' }
    'зм' { return 'gp' }
    'пм' { return 'pp' }
    'пл' { return 'pp' }
    default { return 'gp' }
  }
}
function Parse-Price([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return [pscustomobject]@{ RawText = ""; Value = 0; Denomination = "gp"; GoldEquivalent = 0 }
  }
  if ($text -match '^\s*([0-9]+(?:[.,][0-9]+)?)\s*([^\s]+)?') {
    $amount = Convert-ToPlainNumber $Matches[1]
    $denomination = Normalize-PriceCode $Matches[2]
    $gold = switch ($denomination) {
      'cp' { $amount * 0.01 }
      'sp' { $amount * 0.1 }
      'ep' { $amount * 0.5 }
      'pp' { $amount * 10 }
      default { $amount }
    }
    return [pscustomobject]@{ RawText = $text; Value = $amount; Denomination = $denomination; GoldEquivalent = $gold }
  }
  return [pscustomobject]@{ RawText = $text; Value = 0; Denomination = 'gp'; GoldEquivalent = 0 }
}
function New-UniqueId([string]$Preferred, [hashtable]$UsedIds, [string]$FallbackPrefix = "gear") {
  $candidate = if ([string]::IsNullOrWhiteSpace($Preferred)) { $FallbackPrefix } else { $Preferred }
  $index = 2
  while ($UsedIds.ContainsKey($candidate)) {
    $candidate = "$FallbackPrefix-$index"
    $index += 1
  }
  $UsedIds[$candidate] = $true
  return $candidate
}
function Convert-ToSlug([string]$Value) {
  $text = (Normalize-DisplayText $Value).ToLowerInvariant()
  $pairs = @{
    'а'='a';'б'='b';'в'='v';'г'='g';'д'='d';'е'='e';'ё'='yo';'ж'='zh';'з'='z';'и'='i';'й'='y';
    'к'='k';'л'='l';'м'='m';'н'='n';'о'='o';'п'='p';'р'='r';'с'='s';'т'='t';'у'='u';'ф'='f';
    'х'='kh';'ц'='ts';'ч'='ch';'ш'='sh';'щ'='shch';'ы'='y';'э'='e';'ю'='yu';'я'='ya'
  }
  $parts = foreach ($char in $text.ToCharArray()) {
    if ($char -match '[a-z0-9]') { $char; continue }
    if ($pairs.ContainsKey([string]$char)) { $pairs[[string]$char]; continue }
    '-'
  }
  return ((($parts -join '') -replace '-+', '-') -replace '^-|-$', '')
}
function Read-ZipXml([System.IO.Compression.ZipArchive]$Zip, [string]$EntryPath) {
  $entry = $Zip.GetEntry($EntryPath)
  if (-not $entry) { throw "Workbook entry not found: $EntryPath" }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Load-SharedStrings([System.IO.Compression.ZipArchive]$Zip) {
  $entry = $Zip.GetEntry("xl/sharedStrings.xml")
  if (-not $entry) { return @() }
  $xml = Read-ZipXml $Zip "xl/sharedStrings.xml"
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $values = New-Object System.Collections.Generic.List[string]
  foreach ($item in $xml.SelectNodes("//x:sst/x:si", $ns)) {
    $value = (($item.SelectNodes(".//x:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
    $values.Add($value)
  }
  return ,$values.ToArray()
}
function Get-FirstWorksheetPath([System.IO.Compression.ZipArchive]$Zip) {
  $workbookXml = Read-ZipXml $Zip "xl/workbook.xml"
  $relationsXml = Read-ZipXml $Zip "xl/_rels/workbook.xml.rels"
  $relationById = @{}
  foreach ($relation in $relationsXml.Relationships.Relationship) { $relationById[$relation.Id] = $relation.Target }
  $ns = [System.Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $sheet = $workbookXml.SelectSingleNode("//x:sheets/x:sheet[1]", $ns)
  if (-not $sheet) { throw "Workbook does not contain worksheets." }
  $relationId = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
  $target = $relationById[$relationId]
  if (-not $target) { throw "Unable to resolve worksheet relation '$relationId'." }
  return "xl/$target"
}
function Read-CellValue($Cell, [string[]]$SharedStrings) {
  $type = $Cell.GetAttribute("t")
  if ($type -eq "inlineStr") {
    $parts = @()
    foreach ($node in $Cell.SelectNodes(".//*[local-name()='t']")) { $parts += $node.InnerText }
    return ($parts -join "")
  }
  $valueNode = $Cell.SelectSingleNode("./*[local-name()='v']")
  if (-not $valueNode) { return "" }
  $value = [string]$valueNode.InnerText
  if ([string]::IsNullOrWhiteSpace($value)) { return "" }
  if ($type -eq "s") {
    $index = [int]$value
    if ($index -ge 0 -and $index -lt $SharedStrings.Length) { return $SharedStrings[$index] }
  }
  return $value
}
function Read-WorksheetRows([System.IO.Compression.ZipArchive]$Zip, [string]$EntryPath, [string[]]$SharedStrings) {
  $xml = Read-ZipXml $Zip $EntryPath
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($row in $xml.SelectNodes("//x:sheetData/x:row", $ns)) {
    $map = [ordered]@{ __row = [int]$row.r }
    foreach ($cell in $row.SelectNodes("./x:c", $ns)) {
      $reference = [string]$cell.r
      $column = ($reference -replace "\d", "")
      $map[$column] = Read-CellValue $cell $SharedStrings
    }
    $rows.Add([pscustomobject]$map)
  }
  return ,$rows.ToArray()
}
function Get-Value($Row, [string]$Column) {
  $property = $Row.PSObject.Properties[$Column]
  if ($property) { return $property.Value }
  return ""
}
function Resolve-MaterialMatch([string]$Name, [object[]]$Materials) {
  $strictKey = Get-MatchKey $Name
  $looseKey = Get-LooseMatchKey $Name
  $strictMatches = @($Materials | Where-Object { (Get-MatchKey $_.name) -eq $strictKey })
  if ($strictMatches.Count -eq 1) { return $strictMatches[0] }
  $looseMatches = @($Materials | Where-Object { (Get-LooseMatchKey $_.name) -eq $looseKey })
  if ($looseMatches.Count -eq 1) { return $looseMatches[0] }
  return $null
}
function Write-JsonFile([string]$Path, $Data) {
  [System.IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth 50), [System.Text.UTF8Encoding]::new($false))
}

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) { throw "WorkbookPath is required." }
$resolvedMaterialsPath = Resolve-MaterialsPath $MaterialsPath
$resolvedOutputPath = Resolve-OutputPath $OutputPath
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutputPath)
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory | Out-Null }

$materials = @()
if (Test-Path -LiteralPath $resolvedMaterialsPath) {
  $materials = Get-Content -Raw -Encoding UTF8 $resolvedMaterialsPath | ConvertFrom-Json
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
try {
  $sharedStrings = Load-SharedStrings $zip
  $worksheetPath = Get-FirstWorksheetPath $zip
  $rows = Read-WorksheetRows $zip $worksheetPath $sharedStrings
}
finally { $zip.Dispose() }

$gear = @()
$usedIds = @{}
$rowCounter = 1
foreach ($row in ($rows | Where-Object { $_.__row -ge 2 })) {
  $name = Normalize-DisplayText (Get-Value $row 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }

  $price = Parse-Price (Get-Value $row 'C')
  $materialName = Normalize-DisplayText (Get-Value $row 'I')
  $material = if ($materialName) { Resolve-MaterialMatch $materialName $materials } else { $null }
  $preferredId = Convert-ToSlug $name
  if ([string]::IsNullOrWhiteSpace($preferredId)) { $preferredId = "gear-$rowCounter" }

  $gear += [pscustomobject][ordered]@{
    id = New-UniqueId $preferredId $usedIds "gear"
    name = $name
    equipmentType = Normalize-DisplayText (Get-Value $row 'B')
    priceText = $price.RawText
    priceValue = $price.Value
    priceDenomination = $price.Denomination
    priceGoldEquivalent = $price.GoldEquivalent
    rank = Convert-ToPlainNumber (Get-Value $row 'D') -AllowNull
    weight = Convert-ToPlainNumber (Get-Value $row 'E') -AllowNull
    volume = Normalize-DisplayText (Get-Value $row 'F')
    capacity = Normalize-DisplayText (Get-Value $row 'G')
    description = Normalize-DisplayText (Get-Value $row 'H')
    predominantMaterialId = if ($material) { $material.id } else { $null }
    predominantMaterialName = if ($material) { $material.name } else { $materialName }
    linkedTool = Normalize-DisplayText (Get-Value $row 'J')
    value = Normalize-DisplayText (Get-Value $row 'K')
    itemSlot = Normalize-DisplayText (Get-Value $row 'L')
    heroDollSlots = Normalize-DisplayText (Get-Value $row 'M')
    source = 'gear-workbook'
  }
  $rowCounter += 1
}

Write-JsonFile $resolvedOutputPath $gear
Write-Info 'Gear import complete.'
Write-Info "Gear items: $($gear.Count)"
Write-Info "Path: $resolvedOutputPath"

