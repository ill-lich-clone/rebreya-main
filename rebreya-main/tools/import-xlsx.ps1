param(
  [string]$WorkbookPath = "D:\груз\Шпаргалка мастера общий (1).xlsx",
  [string]$OutputDir = "",
  [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$InvariantCulture = [System.Globalization.CultureInfo]::InvariantCulture

function Write-Info {
  param([string]$Message)
  if (-not $Quiet) {
    Write-Host $Message
  }
}

function Resolve-OutputDir {
  param([string]$ConfiguredPath)

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    return [System.IO.Path]::GetFullPath($ConfiguredPath)
  }

  $moduleRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
  return (Join-Path $moduleRoot "data")
}

function Read-ZipXml {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$EntryPath
  )

  $entry = $Zip.GetEntry($EntryPath)
  if (-not $entry) {
    throw "Workbook entry not found: $EntryPath"
  }

  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    [xml]$xml = $reader.ReadToEnd()
    return $xml
  }
  finally {
    $reader.Dispose()
  }
}

function Load-SharedStrings {
  param([System.IO.Compression.ZipArchive]$Zip)

  $xml = Read-ZipXml -Zip $Zip -EntryPath "xl/sharedStrings.xml"
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

  $values = New-Object System.Collections.Generic.List[string]
  foreach ($item in $xml.SelectNodes("//x:sst/x:si", $ns)) {
    $value = (($item.SelectNodes(".//x:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
    $values.Add($value)
  }

  return ,$values.ToArray()
}

function Load-WorksheetPaths {
  param([System.IO.Compression.ZipArchive]$Zip)

  $workbookXml = Read-ZipXml -Zip $Zip -EntryPath "xl/workbook.xml"
  $relationsXml = Read-ZipXml -Zip $Zip -EntryPath "xl/_rels/workbook.xml.rels"

  $relationById = @{}
  foreach ($relation in $relationsXml.Relationships.Relationship) {
    $relationById[$relation.Id] = $relation.Target
  }

  $ns = [System.Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

  $paths = @{}
  foreach ($sheet in $workbookXml.SelectNodes("//x:sheets/x:sheet", $ns)) {
    $relationId = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    $target = $relationById[$relationId]
    if ($target) {
      $paths[$sheet.name] = "xl/$target"
    }
  }

  return $paths
}

function Read-CellValue {
  param(
    $Cell,
    [string[]]$SharedStrings
  )

  $type = $Cell.GetAttribute("t")
  if ($type -eq "inlineStr") {
    $parts = @()
    foreach ($node in $Cell.SelectNodes(".//*[local-name()='t']")) {
      $parts += $node.InnerText
    }
    return ($parts -join "")
  }

  $valueNode = $Cell.SelectSingleNode("./*[local-name()='v']")
  if (-not $valueNode) {
    return ""
  }

  $value = [string]$valueNode.InnerText
  if ([string]::IsNullOrWhiteSpace($value)) {
    return ""
  }

  if ($type -eq "s") {
    $index = [int]$value
    if ($index -ge 0 -and $index -lt $SharedStrings.Length) {
      return $SharedStrings[$index]
    }
  }

  return $value
}

function Read-WorksheetRows {
  param(
    [System.IO.Compression.ZipArchive]$Zip,
    [string]$EntryPath,
    [string[]]$SharedStrings
  )

  $xml = Read-ZipXml -Zip $Zip -EntryPath $EntryPath
  $ns = [System.Xml.XmlNamespaceManager]::new($xml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")

  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($row in $xml.SelectNodes("//x:sheetData/x:row", $ns)) {
    $map = [ordered]@{ __row = [int]$row.r }
    foreach ($cell in $row.SelectNodes("./x:c", $ns)) {
      $reference = [string]$cell.r
      $column = ($reference -replace "\d", "")
      $map[$column] = Read-CellValue -Cell $cell -SharedStrings $SharedStrings
    }
    $rows.Add([pscustomobject]$map)
  }

  return ,$rows.ToArray()
}

function Find-Row {
  param(
    [object[]]$Rows,
    [int]$RowNumber
  )

  return ($Rows | Where-Object { $_.__row -eq $RowNumber } | Select-Object -First 1)
}

function Get-Value {
  param(
    $Row,
    [string]$Column
  )

  $property = $Row.PSObject.Properties[$Column]
  if ($property) {
    return $property.Value
  }

  return ""
}

function Normalize-DisplayText {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return (($Value -replace "\s+", " ").Trim())
}

function Get-MatchKey {
  param([string]$Value)

  $text = Normalize-DisplayText -Value $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return ""
  }

  $text = $text.ToLowerInvariant()
  foreach ($char in @("'", "’", "‘", "ʼ", "ʹ", "′", '"', "“", "”", "«", "»")) {
    $text = $text.Replace($char, "")
  }

  return (($text -replace "\s+", " ").Trim())
}

function Get-LooseMatchKey {
  param([string]$Value)

  $text = Get-MatchKey -Value $Value
  if ([string]::IsNullOrWhiteSpace($text)) {
    return ""
  }

  $text = $text.Replace("ё", "е")
  return ($text -replace "[^\p{L}\p{Nd}]", "")
}

function Add-IndexEntry {
  param(
    [hashtable]$Index,
    [string]$Key,
    $Item
  )

  if ([string]::IsNullOrWhiteSpace($Key)) {
    return
  }

  if (-not $Index.ContainsKey($Key)) {
    $Index[$Key] = New-Object System.Collections.Generic.List[object]
  }

  $Index[$Key].Add($Item)
}

function Get-IndexEntries {
  param(
    [hashtable]$Index,
    [string]$Key
  )

  if ([string]::IsNullOrWhiteSpace($Key) -or -not $Index.ContainsKey($Key)) {
    return @()
  }

  return @($Index[$Key].ToArray())
}

function Get-LevenshteinDistance {
  param(
    [string]$Left,
    [string]$Right
  )

  $source = if ($null -eq $Left) { "" } else { [string]$Left }
  $target = if ($null -eq $Right) { "" } else { [string]$Right }

  if ($source -ceq $target) {
    return 0
  }

  if ($source.Length -eq 0) {
    return $target.Length
  }

  if ($target.Length -eq 0) {
    return $source.Length
  }

  $matrix = New-Object 'int[,]' ($source.Length + 1), ($target.Length + 1)

  for ($i = 0; $i -le $source.Length; $i += 1) {
    $matrix[$i, 0] = $i
  }

  for ($j = 0; $j -le $target.Length; $j += 1) {
    $matrix[0, $j] = $j
  }

  for ($i = 1; $i -le $source.Length; $i += 1) {
    for ($j = 1; $j -le $target.Length; $j += 1) {
      $cost = if ($source[$i - 1] -ceq $target[$j - 1]) { 0 } else { 1 }
      $prevRow = $i - 1
      $prevColumn = $j - 1
      $deletion = $matrix[$prevRow, $j] + 1
      $insertion = $matrix[$i, $prevColumn] + 1
      $substitution = $matrix[$prevRow, $prevColumn] + $cost
      $matrix[$i, $j] = [Math]::Min($deletion, [Math]::Min($insertion, $substitution))
    }
  }

  return $matrix[$source.Length, $target.Length]
}

function Get-FuzzyMatchThreshold {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return 0
  }

  if ($Value.Length -ge 11) {
    return 2
  }

  if ($Value.Length -ge 5) {
    return 1
  }

  return 0
}

function Resolve-WorkbookPath {
  param([string]$ConfiguredPath)

  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) {
    return [System.IO.Path]::GetFullPath($ConfiguredPath)
  }

  $candidate = Get-ChildItem -Path 'D:\груз' -Filter '*Шпаргалка мастера общий.xlsx' |
    Sort-Object -Property LastWriteTime -Descending |
    Select-Object -First 1

  if (-not $candidate) {
    throw 'Не удалось найти workbook в D:\груз.'
  }

  return $candidate.FullName
}

function Convert-ToNumber {
  param(
    $Value,
    [double]$Default = 0
  )

  if ($null -eq $Value) {
    return $Default
  }

  if ($Value -is [double] -or $Value -is [int] -or $Value -is [decimal]) {
    return [double]$Value
  }

  $text = Normalize-DisplayText -Value ([string]$Value)
  if ([string]::IsNullOrWhiteSpace($text)) {
    return $Default
  }

  $isPercent = $text.EndsWith('%')
  $text = $text.Replace('%', ').Replace(' ', ').Replace(',', '.')
  $number = 0.0
  if ([double]::TryParse($text, [System.Globalization.NumberStyles]::Float, $InvariantCulture, [ref]$number)) {
    if ($isPercent) {
      return ($number / 100.0)
    }
    return $number
  }

  return $Default
}

function Convert-ColumnIndexToName {
  param([int]$ColumnIndex)

  $value = $ColumnIndex
  $columnName = '
  while ($value -gt 0) {
    $value -= 1
    $columnName = [char]([int](65 + ($value % 26))) + $columnName
    $value = [Math]::Floor($value / 26)
  }

  return $columnName
}

function Convert-ToSlugBase {
  param([string]$Value)

  $map = @{
    'а'='a'; 'б'='b'; 'в'='v'; 'г'='g'; 'д'='d'; 'е'='e'; 'ё'='yo'; 'ж'='zh'; 'з'='z'; 'и'='i'; 'й'='y';
    'к'='k'; 'л'='l'; 'м'='m'; 'н'='n'; 'о'='o'; 'п'='p'; 'р'='r'; 'с'='s'; 'т'='t'; 'у'='u'; 'ф'='f';
    'х'='kh'; 'ц'='ts'; 'ч'='ch'; 'ш'='sh'; 'щ'='shch'; 'ъ'='; 'ы'='y'; 'ь'='; 'э'='e'; 'ю'='yu'; 'я'='ya'
  }

  $text = (Normalize-DisplayText -Value $Value).ToLowerInvariant()
  $builder = New-Object System.Text.StringBuilder
  foreach ($char in $text.ToCharArray()) {
    $stringChar = [string]$char
    if ($map.ContainsKey($stringChar)) {
      [void]$builder.Append($map[$stringChar])
    }
    elseif ($stringChar -match '[a-z0-9]') {
      [void]$builder.Append($stringChar)
    }
    else {
      [void]$builder.Append('-')
    }
  }

  $slug = ($builder.ToString().Trim('-') -replace '-{2,}', '-')
  if ([string]::IsNullOrWhiteSpace($slug)) {
    $slug = 'entry'
  }

  return $slug
}

function New-UniqueSlug {
  param(
    [string]$Value,
    [hashtable]$UsedIds
  )

  $base = Convert-ToSlugBase -Value $Value
  $candidate = $base
  $index = 2
  while ($UsedIds.ContainsKey($candidate)) {
    $candidate = "$base-$index"
    $index += 1
  }

  $UsedIds[$candidate] = $true
  return $candidate
}

function New-RecordIndexes {
  param([object[]]$Items)

  $records = @($Items | ForEach-Object {
    [pscustomobject]@{
      item = $_
      name = $_.name
      looseKey = Get-LooseMatchKey -Value $_.name
    }
  })

  $strictIndex = @{}
  $looseIndex = @{}
  foreach ($record in $records) {
    Add-IndexEntry -Index $strictIndex -Key (Get-MatchKey -Value $record.name) -Item $record
    Add-IndexEntry -Index $looseIndex -Key $record.looseKey -Item $record
  }

  return [pscustomobject]@{
    records = $records
    strictIndex = $strictIndex
    looseIndex = $looseIndex
  }
}

function Resolve-Match {
  param(
    [string]$Name,
    $RecordData,
    [switch]$AllowFuzzy
  )

  $strictMatches = @(Get-IndexEntries -Index $RecordData.strictIndex -Key (Get-MatchKey -Value $Name))
  if ($strictMatches.Count -eq 1) {
    return [pscustomobject]@{ matched = $true; item = $strictMatches[0].item; method = 'strict'; reason = ' }
  }
  if ($strictMatches.Count -gt 1) {
    return [pscustomobject]@{ matched = $false; item = $null; method = '; reason = 'ambiguous-target' }
  }

  $looseKey = Get-LooseMatchKey -Value $Name
  $looseMatches = @(Get-IndexEntries -Index $RecordData.looseIndex -Key $looseKey)
  if ($looseMatches.Count -eq 1) {
    return [pscustomobject]@{ matched = $true; item = $looseMatches[0].item; method = 'loose'; reason = ' }
  }
  if ($looseMatches.Count -gt 1) {
    return [pscustomobject]@{ matched = $false; item = $null; method = '; reason = 'ambiguous-target' }
  }

  if (-not $AllowFuzzy) {
    return [pscustomobject]@{ matched = $false; item = $null; method = '; reason = 'missing-target' }
  }

  $maxDistance = Get-FuzzyMatchThreshold -Value $looseKey
  if ($maxDistance -le 0) {
    return [pscustomobject]@{ matched = $false; item = $null; method = '; reason = 'missing-target' }
  }

  $best = $null
  foreach ($record in $RecordData.records) {
    if ([string]::IsNullOrWhiteSpace($record.looseKey)) { continue }
    $lengthDelta = [Math]::Abs($record.looseKey.Length - $looseKey.Length)
    if ($lengthDelta -gt $maxDistance) { continue }
    $distance = Get-LevenshteinDistance -Left $looseKey -Right $record.looseKey
    if ($distance -gt $maxDistance) { continue }
    if (($null -eq $best) -or $distance -lt $best.distance -or ($distance -eq $best.distance -and $lengthDelta -lt $best.lengthDelta)) {
      $best = [pscustomobject]@{ item = $record.item; distance = $distance; lengthDelta = $lengthDelta }
    }
  }

  if ($best) {
    return [pscustomobject]@{ matched = $true; item = $best.item; method = 'fuzzy'; reason = ' }
  }

  return [pscustomobject]@{ matched = $false; item = $null; method = '; reason = 'missing-target' }
}

function Write-JsonFile {
  param(
    [string]$Path,
    $Data
  )

  [System.IO.File]::WriteAllText($Path, ($Data | ConvertTo-Json -Depth 100), [System.Text.UTF8Encoding]::new($false))
}
$transportModeOverrides = @(
  [pscustomobject]@{ name = 'Пешком'; movementCost = 0.10; maxSteps = 1; markupPercent = 0.10 },
  [pscustomobject]@{ name = 'Земля'; movementCost = 0.20; maxSteps = 5; markupPercent = 1.00 },
  [pscustomobject]@{ name = 'Море'; movementCost = 0.06; maxSteps = 10; markupPercent = 0.60 },
  [pscustomobject]@{ name = 'Воздух'; movementCost = 0.10; maxSteps = 4; markupPercent = 0.40 },
  [pscustomobject]@{ name = 'Река'; movementCost = 0.08; maxSteps = 6; markupPercent = 0.48 },
  [pscustomobject]@{ name = 'Песок'; movementCost = 0.25; maxSteps = 3; markupPercent = 0.75 },
  [pscustomobject]@{ name = 'ЖД'; movementCost = 0.125; maxSteps = 7; markupPercent = 0.875 }
)

$categoryByGroupId = @{
  'metally' = 'metals'
  'dragmetally' = 'precious-metals'
  'stroyka' = 'construction'
  'organika' = 'organic'
  'eda' = 'organic'
}

$resolvedWorkbookPath = Resolve-WorkbookPath -ConfiguredPath $WorkbookPath
$resolvedOutputDir = Resolve-OutputDir -ConfiguredPath $OutputDir
if (-not (Test-Path -LiteralPath $resolvedOutputDir)) {
  New-Item -ItemType Directory -Path $resolvedOutputDir | Out-Null
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedWorkbookPath)
try {
  $sharedStrings = Load-SharedStrings -Zip $zip
  $worksheetPaths = Load-WorksheetPaths -Zip $zip
  $cityRows = Read-WorksheetRows -Zip $zip -EntryPath $worksheetPaths['Города и локации'] -SharedStrings $sharedStrings
  $demandRows = Read-WorksheetRows -Zip $zip -EntryPath $worksheetPaths['Спрос городов'] -SharedStrings $sharedStrings
  $productionRows = Read-WorksheetRows -Zip $zip -EntryPath $worksheetPaths['Производство регионов'] -SharedStrings $sharedStrings
  $descriptionRows = Read-WorksheetRows -Zip $zip -EntryPath $worksheetPaths['Описание регионов'] -SharedStrings $sharedStrings
}
finally {
  $zip.Dispose()
}

$cityHeader = Find-Row -Rows $cityRows -RowNumber 1
$goodsInOrder = @()
for ($columnIndex = 29; $columnIndex -le 73; $columnIndex += 1) {
  $headerValue = Normalize-DisplayText -Value (Get-Value -Row $cityHeader -Column (Convert-ColumnIndexToName -ColumnIndex $columnIndex))
  if (-not [string]::IsNullOrWhiteSpace($headerValue)) {
    $goodsInOrder += $headerValue
  }
}

$groupByGood = @{}
$goodGroups = @()
$usedGroupIds = @{}
foreach ($row in ($productionRows | Where-Object { $_.__row -ge 98 -and $_.__row -le 105 })) {
  $groupName = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'P')
  if ([string]::IsNullOrWhiteSpace($groupName)) { continue }
  $groupId = New-UniqueSlug -Value $groupName -UsedIds $usedGroupIds
  $groupGoods = @()
  foreach ($column in 'Q','R','S','T','U','V','W','X','Y') {
    $goodName = Normalize-DisplayText -Value (Get-Value -Row $row -Column $column)
    if ([string]::IsNullOrWhiteSpace($goodName)) { continue }
    $groupGoods += $goodName
    $groupByGood[$goodName] = [pscustomobject]@{ id = $groupId; name = $groupName }
  }
  $goodGroups += [pscustomobject]@{ id = $groupId; name = $groupName; goods = $groupGoods }
}

$baseStatsByGood = @{}
foreach ($row in ($productionRows | Where-Object { $_.__row -ge 98 -and $_.__row -le 142 })) {
  $goodName = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'K')
  if ([string]::IsNullOrWhiteSpace($goodName)) { continue }
  $baseStatsByGood[$goodName] = [pscustomobject]@{
    production = Convert-ToNumber -Value (Get-Value -Row $row -Column 'L')
    consumption = Convert-ToNumber -Value (Get-Value -Row $row -Column 'M')
  }
}

$goods = @()
$goodIdByName = @{}
$usedGoodIds = @{}
foreach ($goodName in $goodsInOrder) {
  $group = $groupByGood[$goodName]
  $stats = $baseStatsByGood[$goodName]
  $goodId = New-UniqueSlug -Value $goodName -UsedIds $usedGoodIds
  $goodIdByName[$goodName] = $goodId
  $groupId = if ($group) { $group.id } else { 'prochee' }
  $groupName = if ($group) { $group.name } else { 'Прочее' }
  $goods += [pscustomobject][ordered]@{
    id = $goodId
    name = $goodName
    category = $(if ($categoryByGroupId.ContainsKey($groupId)) { $categoryByGroupId[$groupId] } else { 'other' })
    groupId = $groupId
    groupName = $groupName
    baseProductionPer1000 = if ($stats) { $stats.production } else { 0 }
    baseConsumptionPer1000 = if ($stats) { $stats.consumption } else { 0 }
  }
}

$regionsByComposite = @{}
$regionOrder = New-Object System.Collections.Generic.List[string]
foreach ($row in ($productionRows | Where-Object { $_.__row -ge 3 -and $_.__row -lt 88 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $state = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'B')
  $composite = Get-MatchKey -Value "$name|$state"
  $regionOrder.Add($composite)
  $coefficients = [ordered]@{}
  for ($index = 0; $index -lt $goodsInOrder.Count; $index += 1) {
    $coefficients[$goodIdByName[$goodsInOrder[$index]]] = Convert-ToNumber -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (3 + $index)))
  }
  $regionsByComposite[$composite] = [ordered]@{ name = $name; state = $state; traits = @(); productionCoefficients = $coefficients; productionModifiers = [ordered]@{} }
}

foreach ($row in ($descriptionRows | Where-Object { $_.__row -ge 2 -and $_.__row -lt 85 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $state = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'B')
  $composite = Get-MatchKey -Value "$name|$state"
  if (-not $regionsByComposite.ContainsKey($composite)) {
    $regionOrder.Add($composite)
    $regionsByComposite[$composite] = [ordered]@{ name = $name; state = $state; traits = @(); productionCoefficients = [ordered]@{}; productionModifiers = [ordered]@{} }
  }
  $regionsByComposite[$composite].traits = @(
    (Normalize-DisplayText -Value (Get-Value -Row $row -Column 'C')),
    (Normalize-DisplayText -Value (Get-Value -Row $row -Column 'D')),
    (Normalize-DisplayText -Value (Get-Value -Row $row -Column 'E'))
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  for ($index = 0; $index -lt $goodsInOrder.Count; $index += 1) {
    $value = Convert-ToNumber -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (6 + $index)))
    if ([Math]::Abs($value) -lt 0.0000001) { continue }
    $regionsByComposite[$composite].productionModifiers[$goodIdByName[$goodsInOrder[$index]]] = $value
  }
}

foreach ($row in ($cityRows | Where-Object { $_.__row -ge 2 })) {
  $regionName = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'G')
  $state = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'F')
  if ([string]::IsNullOrWhiteSpace($regionName)) { continue }
  $composite = Get-MatchKey -Value "$regionName|$state"
  if ($regionsByComposite.ContainsKey($composite)) { continue }
  $regionOrder.Add($composite)
  $regionsByComposite[$composite] = [ordered]@{ name = $regionName; state = $state; traits = @(); productionCoefficients = [ordered]@{}; productionModifiers = [ordered]@{} }
}

foreach ($row in ($demandRows | Where-Object { $_.__row -ge 2 })) {
  $regionName = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'F')
  $state = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'E')
  if ([string]::IsNullOrWhiteSpace($regionName)) { continue }
  $composite = Get-MatchKey -Value "$regionName|$state"
  if ($regionsByComposite.ContainsKey($composite)) { continue }
  $regionOrder.Add($composite)
  $regionsByComposite[$composite] = [ordered]@{ name = $regionName; state = $state; traits = @(); productionCoefficients = [ordered]@{}; productionModifiers = [ordered]@{} }
}

$regions = @()
$regionIdByComposite = @{}
$usedRegionIds = @{}
foreach ($composite in $regionOrder) {
  $region = $regionsByComposite[$composite]
  $regionId = New-UniqueSlug -Value "$($region.state) $($region.name)" -UsedIds $usedRegionIds
  $regionIdByComposite[$composite] = $regionId
  $regions += [pscustomobject][ordered]@{
    id = $regionId
    name = $region.name
    state = $region.state
    traits = $region.traits
    productionCoefficients = $region.productionCoefficients
    productionModifiers = $region.productionModifiers
  }
}

$cities = @()
$usedCityIds = @{}
foreach ($row in ($cityRows | Where-Object { $_.__row -ge 2 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $state = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'F')
  $regionName = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'G')
  $production = [ordered]@{}
  for ($index = 0; $index -lt $goodsInOrder.Count; $index += 1) {
    $production[$goodIdByName[$goodsInOrder[$index]]] = Convert-ToNumber -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (29 + $index)))
  }
  $connections = @()
  foreach ($i in 0..8) {
    $targetName = Normalize-DisplayText -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (11 + ($i * 2))))
    if ([string]::IsNullOrWhiteSpace($targetName)) { continue }
    $connections += [pscustomobject][ordered]@{
      targetName = $targetName
      targetCityId = $null
      connectionType = Normalize-DisplayText -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (12 + ($i * 2))))
      broken = $false
    }
  }
  $cities += [pscustomobject][ordered]@{
    id = New-UniqueSlug -Value $name -UsedIds $usedCityIds
    name = $name
    description = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'B')
    type = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'C')
    cityType = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'D')
    rank = Convert-ToNumber -Value (Get-Value -Row $row -Column 'E')
    state = $state
    regionId = $regionIdByComposite[(Get-MatchKey -Value "$regionName|$state")]
    regionName = $regionName
    locationType = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'H')
    religion = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'I')
    population = [int](Convert-ToNumber -Value (Get-Value -Row $row -Column 'J'))
    consumptionModifier = $null
    connections = $connections
    production = $production
    demand = [ordered]@{}
  }
}

$cityRecordData = New-RecordIndexes -Items $cities
$missingDemandCityIds = @{}
foreach ($city in $cities) { $missingDemandCityIds[$city.id] = $true }
$unmatchedDemandRows = @()
foreach ($row in ($demandRows | Where-Object { $_.__row -ge 2 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $match = Resolve-Match -Name $name -RecordData $cityRecordData -AllowFuzzy
  if (-not $match.matched) {
    $unmatchedDemandRows += [pscustomobject]@{ row = $row.__row; name = $name; reason = $match.reason }
    continue
  }
  $city = $match.item
  $demand = [ordered]@{}
  for ($index = 0; $index -lt $goodsInOrder.Count; $index += 1) {
    $demand[$goodIdByName[$goodsInOrder[$index]]] = Convert-ToNumber -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (9 + $index)))
  }
  $city.demand = $demand
  $missingDemandCityIds.Remove($city.id) | Out-Null
}
foreach ($city in $cities) {
  if ($city.demand.Count) { continue }
  foreach ($goodName in $goodsInOrder) {
    $city.demand[$goodIdByName[$goodName]] = 0
  }
}

$brokenConnections = @()
foreach ($city in $cities) {
  $resolvedConnections = @()
  foreach ($connection in $city.connections) {
    $match = Resolve-Match -Name $connection.targetName -RecordData $cityRecordData -AllowFuzzy
    if (-not $match.matched) {
      $brokenConnections += [pscustomobject]@{ cityId = $city.id; cityName = $city.name; targetName = $connection.targetName; connectionType = $connection.connectionType; reason = $match.reason }
      $resolvedConnections += [pscustomobject][ordered]@{ targetName = $connection.targetName; targetCityId = $null; connectionType = $connection.connectionType; broken = $true; brokenReason = $match.reason }
      continue
    }
    $resolvedConnections += [pscustomobject][ordered]@{ targetName = $connection.targetName; targetCityId = $match.item.id; connectionType = $connection.connectionType; broken = $false; resolvedBy = $match.method }
  }
  $city.connections = $resolvedConnections
}

$workbookTransportModes = @()
foreach ($row in ($productionRows | Where-Object { $_.__row -ge 89 -and $_.__row -le 95 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $workbookTransportModes += [pscustomobject][ordered]@{
    id = Convert-ToSlugBase -Value $name
    name = $name
    movementCost = Convert-ToNumber -Value (Get-Value -Row $row -Column 'B')
    maxSteps = [int](Convert-ToNumber -Value (Get-Value -Row $row -Column 'C'))
    markupPercent = Convert-ToNumber -Value (Get-Value -Row $row -Column 'D')
  }
}

$transportModes = @()
foreach ($override in $transportModeOverrides) {
  $workbookMode = $workbookTransportModes | Where-Object { (Get-MatchKey -Value $_.name) -eq (Get-MatchKey -Value $override.name) } | Select-Object -First 1
  $transportModes += [pscustomobject][ordered]@{
    id = Convert-ToSlugBase -Value $override.name
    name = $override.name
    movementCost = $override.movementCost
    maxSteps = $override.maxSteps
    markupPercent = $override.markupPercent
    workbookMovementCost = if ($workbookMode) { $workbookMode.movementCost } else { $null }
    workbookMaxSteps = if ($workbookMode) { $workbookMode.maxSteps } else { $null }
    workbookMarkupPercent = if ($workbookMode) { $workbookMode.markupPercent } else { $null }
    source = 'manual-override'
  }
}

$cityTypeDemandModifiers = @()
$categoryIds = @('metally','dragmetally','stroyka','organika','tekstil-i-otdelka','pismo-i-byurokratiya','khimiya-i-toplivo','eda')
foreach ($row in ($productionRows | Where-Object { $_.__row -ge 98 -and $_.__row -le 105 })) {
  $name = Normalize-DisplayText -Value (Get-Value -Row $row -Column 'A')
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $categoryModifiers = [ordered]@{}
  foreach ($index in 0..7) {
    $categoryModifiers[$categoryIds[$index]] = Convert-ToNumber -Value (Get-Value -Row $row -Column (Convert-ColumnIndexToName -ColumnIndex (2 + $index)))
  }
  $cityTypeDemandModifiers += [pscustomobject][ordered]@{ id = Convert-ToSlugBase -Value $name; name = $name; categoryModifiers = $categoryModifiers }
}

$source = [pscustomobject][ordered]@{
  workbookPath = $resolvedWorkbookPath
  workbookName = [System.IO.Path]::GetFileName($resolvedWorkbookPath)
  importedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
  sheets = @('Города и локации','Спрос городов','Производство регионов','Описание регионов')
}

$reference = [pscustomobject][ordered]@{
  source = $source
  stats = [pscustomobject][ordered]@{
    goods = $goods.Count
    cities = $cities.Count
    regions = $regions.Count
    states = (@(($cities | ForEach-Object { $_.state }) + ($regions | ForEach-Object { $_.state }) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)).Count
  }
  transportModes = $transportModes
  workbookTransportModes = $workbookTransportModes
  cityTypeDemandModifiers = $cityTypeDemandModifiers
  goodGroups = $goodGroups
  warnings = [pscustomobject][ordered]@{
    missingDemandCities = @($cities | Where-Object { $missingDemandCityIds.ContainsKey($_.id) } | ForEach-Object { [pscustomobject]@{ cityId = $_.id; cityName = $_.name; state = $_.state; region = $_.regionName } })
    unmatchedDemandRows = $unmatchedDemandRows
    brokenConnections = $brokenConnections
  }
}

Write-JsonFile -Path (Join-Path $resolvedOutputDir 'goods.json') -Data $goods
Write-JsonFile -Path (Join-Path $resolvedOutputDir 'regions.json') -Data $regions
Write-JsonFile -Path (Join-Path $resolvedOutputDir 'cities.json') -Data $cities
Write-JsonFile -Path (Join-Path $resolvedOutputDir 'reference.json') -Data $reference

Write-Info 'Импорт завершён.'
Write-Info "Товаров: $($goods.Count)"
Write-Info "Регионов: $($regions.Count)"
Write-Info "Городов и локаций: $($cities.Count)"
Write-Info "Битых связей: $($brokenConnections.Count)"
Write-Info "Городов без demand: $($reference.warnings.missingDemandCities.Count)"



