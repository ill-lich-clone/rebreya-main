param(
  [string]$WorkbookPath = "",
  [string]$CsvPath = "",
  [string]$SourcePath = "",
  [string]$GoodsPath = "",
  [string]$OutputPath = "",
  [string]$ExistingMaterialsPath = "",
  [string]$ExpectedCsvSha256 = "AF2E69169C70CB4165A671502C87AC96CD9D549B6E3E19BEDDF401FEEC5DEE82",
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture
$SpreadsheetId = "1G-UCW00vsjON05fr0CgyK03YaF82oYJemlqNKdv1JBk"
$SheetName = "Энциклопедия материалов"
$ExpectedSourceMaterialCount = 247

function Write-Info([string]$Message) {
  if (-not $Quiet) { Write-Host $Message }
}

function Resolve-ModuleRoot { return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")) }
function Resolve-GoodsPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\goods.json")
}
function Resolve-OutputPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\materials.json")
}
function Resolve-SourceFilePath([string]$ConfiguredSourcePath, [string]$ConfiguredCsvPath, [string]$ConfiguredWorkbookPath) {
  $configuredPaths = @(@($ConfiguredSourcePath, $ConfiguredCsvPath, $ConfiguredWorkbookPath) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($configuredPaths.Count -eq 0) { throw "SourcePath, CsvPath, or WorkbookPath is required." }
  if ($configuredPaths.Count -gt 1) { throw "Specify only one of SourcePath, CsvPath, or WorkbookPath." }
  return [System.IO.Path]::GetFullPath($configuredPaths[0])
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
function Convert-ToNumber($Value, [switch]$AllowNull) {
  if ($null -eq $Value) { return $(if ($AllowNull) { $null } else { 0 }) }
  $text = Normalize-DisplayText ([string]$Value)
  if ([string]::IsNullOrWhiteSpace($text)) { return $(if ($AllowNull) { $null } else { 0 }) }
  $text = $text -replace "\s+(?:зм|фнт)$", ""
  $text = $text.Replace(' ', '').Replace(',', '.')
  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, $InvariantCulture, [ref]$number)) { return $number }
  return $(if ($AllowNull) { $null } else { 0 })
}
function New-UniqueId([string]$Preferred, [hashtable]$UsedIds, [string]$FallbackPrefix = "material") {
  $baseId = if ([string]::IsNullOrWhiteSpace($Preferred)) { $FallbackPrefix } else { $Preferred }
  $candidate = $baseId
  $index = 2
  while ($UsedIds.ContainsKey($candidate)) {
    $candidate = "$baseId-$index"
    $index += 1
  }
  $UsedIds[$candidate] = $true
  return $candidate
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
function Read-CsvRows([string]$Path) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($Path, [System.Text.Encoding]::UTF8, $true)
  $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
  $parser.SetDelimiters(',')
  $parser.HasFieldsEnclosedInQuotes = $true
  $parser.TrimWhiteSpace = $false
  $columns = @('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M')
  $rows = New-Object System.Collections.Generic.List[object]
  $rowNumber = 0
  try {
    while (-not $parser.EndOfData) {
      $fields = $parser.ReadFields()
      $rowNumber += 1
      if ($fields.Count -ne $columns.Count) {
        throw "CSV row $rowNumber has $($fields.Count) columns; expected $($columns.Count)."
      }
      $map = [ordered]@{ __row = $rowNumber }
      for ($index = 0; $index -lt $columns.Count; $index += 1) {
        $map[$columns[$index]] = [string]$fields[$index]
      }
      $rows.Add([pscustomobject]$map)
    }
  }
  finally { $parser.Dispose() }
  return ,$rows.ToArray()
}
function Get-Value($Row, [string]$Column) {
  $property = $Row.PSObject.Properties[$Column]
  if ($property) { return $property.Value }
  return ""
}
function Resolve-GoodMatch([string]$Name, [object[]]$Goods) {
  $strictKey = Get-MatchKey $Name
  $looseKey = Get-LooseMatchKey $Name
  $strictMatches = @($Goods | Where-Object { (Get-MatchKey $_.name) -eq $strictKey })
  if ($strictMatches.Count -eq 1) { return $strictMatches[0] }
  $looseMatches = @($Goods | Where-Object { (Get-LooseMatchKey $_.name) -eq $looseKey })
  if ($looseMatches.Count -eq 1) { return $looseMatches[0] }
  return $null
}
function Read-ExistingMaterials([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return @() }
  $existing = Get-Content -Raw -Encoding UTF8 $Path | ConvertFrom-Json
  if ($null -eq $existing) { return @() }
  return @($existing)
}
function Build-ExistingMaterialIndexes([object[]]$ExistingMaterials) {
  $byName = @{}
  $byGoodId = @{}
  foreach ($material in $ExistingMaterials) {
    $nameKey = Get-MatchKey ([string]$material.name)
    if (-not [string]::IsNullOrWhiteSpace($nameKey) -and -not $byName.ContainsKey($nameKey)) {
      $byName[$nameKey] = $material
    }
    $goodId = [string]$material.linkedGoodId
    if (-not [string]::IsNullOrWhiteSpace($goodId) -and -not $byGoodId.ContainsKey($goodId)) {
      $byGoodId[$goodId] = $material
    }
  }
  return [pscustomobject]@{ byName = $byName; byGoodId = $byGoodId }
}
function Resolve-ExistingMaterial([string]$Name, $Good, $Indexes) {
  $nameKey = Get-MatchKey $Name
  if (-not [string]::IsNullOrWhiteSpace($nameKey) -and $Indexes.byName.ContainsKey($nameKey)) {
    return $Indexes.byName[$nameKey]
  }
  if ($Good -and $Indexes.byGoodId.ContainsKey([string]$Good.id)) {
    return $Indexes.byGoodId[[string]$Good.id]
  }
  return $null
}
function Write-JsonFile([string]$Path, $Data) {
  [System.IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth 50), [System.Text.UTF8Encoding]::new($false))
}

$resolvedSourcePath = Resolve-SourceFilePath $SourcePath $CsvPath $WorkbookPath
$resolvedGoodsPath = Resolve-GoodsPath $GoodsPath
$resolvedOutputPath = Resolve-OutputPath $OutputPath
$resolvedExistingMaterialsPath = if ([string]::IsNullOrWhiteSpace($ExistingMaterialsPath)) {
  Join-Path (Resolve-ModuleRoot) "data\materials.json"
}
else {
  [System.IO.Path]::GetFullPath($ExistingMaterialsPath)
}
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutputPath)
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory | Out-Null }

$goods = Get-Content -Raw -Encoding UTF8 $resolvedGoodsPath | ConvertFrom-Json
$existingMaterials = Read-ExistingMaterials $resolvedExistingMaterialsPath
$existingIndexes = Build-ExistingMaterialIndexes $existingMaterials
$sourceExtension = [System.IO.Path]::GetExtension($resolvedSourcePath).ToLowerInvariant()
if ($sourceExtension -eq '.csv') {
  if (-not [string]::IsNullOrWhiteSpace($ExpectedCsvSha256)) {
    $actualCsvSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedSourcePath).Hash
    if ($actualCsvSha256 -ne $ExpectedCsvSha256.ToUpperInvariant()) {
      throw "CSV SHA256 mismatch. Expected $ExpectedCsvSha256, got $actualCsvSha256."
    }
  }
  $rows = Read-CsvRows $resolvedSourcePath
}
elseif ($sourceExtension -eq '.xlsx') {
  $zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedSourcePath)
  try {
    $sharedStrings = Load-SharedStrings $zip
    $worksheetPath = Get-FirstWorksheetPath $zip
    $rows = Read-WorksheetRows $zip $worksheetPath $sharedStrings
  }
  finally { $zip.Dispose() }
}
else {
  throw "Unsupported materials source '$resolvedSourcePath'. Expected .csv or .xlsx."
}

$sourceRows = @($rows | Where-Object { $_.__row -ge 2 })
$linkedGoodIds = @{}
$reservedHistoricalIds = @{}
foreach ($row in $sourceRows) {
  $name = Normalize-DisplayText (Get-Value $row 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $good = Resolve-GoodMatch $name $goods
  if ($good) { $linkedGoodIds[$good.id] = $true }
  $existingMaterial = Resolve-ExistingMaterial $name $good $existingIndexes
  $existingId = if ($existingMaterial) { [string]$existingMaterial.id } else { "" }
  if (-not [string]::IsNullOrWhiteSpace($existingId)) {
    $reservedHistoricalIds[$existingId] = $true
  }
}
foreach ($good in $goods) {
  if ($linkedGoodIds.ContainsKey($good.id)) { continue }
  $existingMaterial = Resolve-ExistingMaterial ([string]$good.name) $good $existingIndexes
  $existingId = if ($existingMaterial) { [string]$existingMaterial.id } else { "" }
  if (-not [string]::IsNullOrWhiteSpace($existingId)) {
    $reservedHistoricalIds[$existingId] = $true
  }
}

$materials = @()
$usedIds = @{}
foreach ($reservedId in $reservedHistoricalIds.Keys) { $usedIds[$reservedId] = $true }
$sourceMaterialCount = 0
foreach ($row in $sourceRows) {
  $name = Normalize-DisplayText (Get-Value $row 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $good = Resolve-GoodMatch $name $goods
  if ($good) { $linkedGoodIds[$good.id] = $true }
  $existingMaterial = Resolve-ExistingMaterial $name $good $existingIndexes
  $preferredId = if ($existingMaterial -and -not [string]::IsNullOrWhiteSpace([string]$existingMaterial.id)) {
    [string]$existingMaterial.id
  }
  elseif ($good) {
    [string]$good.id
  }
  else {
    "material-$($row.__row)"
  }
  $id = if ($existingMaterial -and $reservedHistoricalIds.ContainsKey([string]$existingMaterial.id)) {
    $existingId = [string]$existingMaterial.id
    $null = $reservedHistoricalIds.Remove($existingId)
    $existingId
  }
  else {
    New-UniqueId $preferredId $usedIds "material-$($row.__row)"
  }
  $materials += [pscustomobject][ordered]@{
    id = $id
    name = $name
    type = Normalize-DisplayText (Get-Value $row 'B')
    subtype = Normalize-DisplayText (Get-Value $row 'C')
    priceGold = Convert-ToNumber (Get-Value $row 'D') -AllowNull
    weight = Convert-ToNumber (Get-Value $row 'E') -AllowNull
    rank = Convert-ToNumber (Get-Value $row 'F') -AllowNull
    description = [string](Get-Value $row 'G')
    linkedGoodId = if ($good) { $good.id } else { $null }
    linkedGoodName = if ($good) { $good.name } else { $null }
    applications = [pscustomobject][ordered]@{
      upgrade = [string](Get-Value $row 'H')
      implant = [string](Get-Value $row 'I')
      crafting = [string](Get-Value $row 'J')
      alchemy = [string](Get-Value $row 'K')
      knowledge = [string](Get-Value $row 'L')
    }
    alchemyAspects = [string](Get-Value $row 'M')
    source = [pscustomobject][ordered]@{
      spreadsheetId = $SpreadsheetId
      sheetName = $SheetName
      row = [int]$row.__row
    }
    isSynthetic = $false
  }
  $sourceMaterialCount += 1
}
if ($sourceMaterialCount -ne $ExpectedSourceMaterialCount) {
  throw "Expected $ExpectedSourceMaterialCount source materials, found $sourceMaterialCount."
}
foreach ($good in $goods) {
  if ($linkedGoodIds.ContainsKey($good.id)) { continue }
  $existingMaterial = Resolve-ExistingMaterial ([string]$good.name) $good $existingIndexes
  $preferredId = if ($existingMaterial -and -not [string]::IsNullOrWhiteSpace([string]$existingMaterial.id)) {
    [string]$existingMaterial.id
  }
  else {
    [string]$good.id
  }
  $id = if ($existingMaterial -and $reservedHistoricalIds.ContainsKey([string]$existingMaterial.id)) {
    $existingId = [string]$existingMaterial.id
    $null = $reservedHistoricalIds.Remove($existingId)
    $existingId
  }
  else {
    New-UniqueId $preferredId $usedIds 'material'
  }
  $materials += [pscustomobject][ordered]@{
    id = $id
    name = $good.name
    type = 'Ресурс'
    subtype = ''
    priceGold = $null
    weight = $null
    rank = $null
    description = "Материал создан автоматически, потому что для товара «$($good.name)» нет отдельной строки в таблице материалов."
    linkedGoodId = $good.id
    linkedGoodName = $good.name
    applications = [pscustomobject][ordered]@{
      upgrade = ''
      implant = ''
      crafting = ''
      alchemy = ''
      knowledge = ''
    }
    alchemyAspects = ''
    source = 'synthetic-from-goods'
    isSynthetic = $true
  }
}
Write-JsonFile $resolvedOutputPath $materials
Write-Info 'Materials import complete.'
Write-Info "Materials: $($materials.Count)"
Write-Info "Source materials: $sourceMaterialCount"
Write-Info "Synthetic materials: $($materials.Count - $sourceMaterialCount)"
Write-Info "Path: $resolvedOutputPath"
