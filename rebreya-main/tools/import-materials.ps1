param(
  [string]$WorkbookPath = "",
  [string]$GoodsPath = "",
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
function Resolve-GoodsPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\goods.json")
}
function Resolve-OutputPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\materials.json")
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
  $text = $text.Replace(' ', '').Replace(',', '.')
  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, $InvariantCulture, [ref]$number)) { return $number }
  return $(if ($AllowNull) { $null } else { 0 })
}
function New-UniqueId([string]$Preferred, [hashtable]$UsedIds, [string]$FallbackPrefix = "material") {
  $candidate = if ([string]::IsNullOrWhiteSpace($Preferred)) { $FallbackPrefix } else { $Preferred }
  $index = 2
  while ($UsedIds.ContainsKey($candidate)) {
    $candidate = "$FallbackPrefix-$index"
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
function Write-JsonFile([string]$Path, $Data) {
  [System.IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth 50), [System.Text.UTF8Encoding]::new($false))
}

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) { throw "WorkbookPath is required." }
$resolvedGoodsPath = Resolve-GoodsPath $GoodsPath
$resolvedOutputPath = Resolve-OutputPath $OutputPath
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutputPath)
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory | Out-Null }

$goods = Get-Content -Raw -Encoding UTF8 $resolvedGoodsPath | ConvertFrom-Json
$zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
try {
  $sharedStrings = Load-SharedStrings $zip
  $worksheetPath = Get-FirstWorksheetPath $zip
  $rows = Read-WorksheetRows $zip $worksheetPath $sharedStrings
}
finally { $zip.Dispose() }

$materials = @()
$usedIds = @{}
$linkedGoodIds = @{}
$rowCounter = 1
foreach ($row in ($rows | Where-Object { $_.__row -ge 2 })) {
  $name = Normalize-DisplayText (Get-Value $row 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $good = Resolve-GoodMatch $name $goods
  if ($good) { $linkedGoodIds[$good.id] = $true }
  $preferredId = if ($good) { $good.id } else { "material-$rowCounter" }
  $materials += [pscustomobject][ordered]@{
    id = New-UniqueId $preferredId $usedIds
    name = $name
    type = Normalize-DisplayText (Get-Value $row 'B')
    subtype = Normalize-DisplayText (Get-Value $row 'C')
    priceGold = Convert-ToNumber (Get-Value $row 'D') -AllowNull
    weight = Convert-ToNumber (Get-Value $row 'E') -AllowNull
    rank = Convert-ToNumber (Get-Value $row 'F') -AllowNull
    description = Normalize-DisplayText (Get-Value $row 'G')
    linkedGoodId = if ($good) { $good.id } else { $null }
    linkedGoodName = if ($good) { $good.name } else { $null }
    source = 'materials-workbook'
    isSynthetic = $false
  }
  $rowCounter += 1
}
foreach ($good in $goods) {
  if ($linkedGoodIds.ContainsKey($good.id)) { continue }
  $materials += [pscustomobject][ordered]@{
    id = New-UniqueId $good.id $usedIds 'material'
    name = $good.name
    type = 'Ресурс'
    subtype = ''
    priceGold = $null
    weight = $null
    rank = $null
    description = "Материал создан автоматически, потому что для товара «$($good.name)» нет отдельной строки в таблице материалов."
    linkedGoodId = $good.id
    linkedGoodName = $good.name
    source = 'synthetic-from-goods'
    isSynthetic = $true
  }
}
Write-JsonFile $resolvedOutputPath $materials
Write-Info 'Materials import complete.'
Write-Info "Materials: $($materials.Count)"
Write-Info "Path: $resolvedOutputPath"