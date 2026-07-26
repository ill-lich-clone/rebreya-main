param(
  [string]$WorkbookPath = "",
  [string]$MaterialsPath = "",
  [string]$OutputPath = "",
  [string]$UpgradesOutputPath = "",
  [string]$EnrichmentSourcePath = "",
  [string[]]$DeferredUpgradeNames = @("Медная проволка"),
  [switch]$AugmentExisting,
  [switch]$AllowUnmatchedProfiles,
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
function Resolve-UpgradesOutputPath([string]$ConfiguredPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredPath)) { return [System.IO.Path]::GetFullPath($ConfiguredPath) }
  return (Join-Path (Resolve-ModuleRoot) "data\upgrades.json")
}
function Normalize-DisplayText([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  return (($Value -replace "\s+", " ").Trim())
}
function Get-MatchKey([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  return ($text.ToLowerInvariant() -replace 'ё', 'е')
}
function Get-LooseMatchKey([string]$Value) {
  $text = Get-MatchKey $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  return ($text -replace "[^\p{L}\p{Nd}]", "")
}
function Get-GearMatchKey([string]$EquipmentType, [string]$Name) {
  return "$(Get-MatchKey $EquipmentType)|$(Get-MatchKey $Name)"
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
function Resolve-WorksheetTargetPath([string]$Target) {
  if ([string]::IsNullOrWhiteSpace($Target)) { return "" }
  $cleanTarget = $Target -replace '\\', '/'
  if ($cleanTarget.StartsWith("/")) { return $cleanTarget.TrimStart("/") }
  if ($cleanTarget.StartsWith("xl/")) { return $cleanTarget }
  return "xl/$cleanTarget"
}
function Get-WorksheetPathByName([System.IO.Compression.ZipArchive]$Zip, [string]$WorksheetName) {
  $workbookXml = Read-ZipXml $Zip "xl/workbook.xml"
  $relationsXml = Read-ZipXml $Zip "xl/_rels/workbook.xml.rels"
  $relationById = @{}
  foreach ($relation in $relationsXml.Relationships.Relationship) { $relationById[$relation.Id] = $relation.Target }
  $ns = [System.Xml.XmlNamespaceManager]::new($workbookXml.NameTable)
  $ns.AddNamespace("x", "http://schemas.openxmlformats.org/spreadsheetml/2006/main")
  foreach ($sheet in $workbookXml.SelectNodes("//x:sheets/x:sheet", $ns)) {
    if ((Get-MatchKey $sheet.name) -ne (Get-MatchKey $WorksheetName)) { continue }
    $relationId = $sheet.GetAttribute("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")
    $target = $relationById[$relationId]
    if (-not $target) { throw "Unable to resolve worksheet relation '$relationId'." }
    return Resolve-WorksheetTargetPath $target
  }
  return ""
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
function Find-WorksheetHeader([object[]]$Rows) {
  foreach ($row in ($Rows | Where-Object { $_.__row -le 20 })) {
    $columns = @{}
    foreach ($property in $row.PSObject.Properties) {
      if ($property.Name -eq '__row') { continue }
      $key = Get-MatchKey ([string]$property.Value)
      if ($key -and -not $columns.ContainsKey($key)) {
        $columns[$key] = $property.Name
      }
    }
    $hasPriceColumn = @($columns.Keys | Where-Object { $_.StartsWith((Get-MatchKey 'Цена')) }).Count -gt 0
    if ($columns.ContainsKey((Get-MatchKey 'Название')) -and $hasPriceColumn) {
      return [pscustomobject]@{
        RowNumber = [int]$row.__row
        Columns = $columns
      }
    }
  }
  return $null
}
function Get-HeaderColumn($Header, [string[]]$Aliases) {
  if (-not $Header) { return "" }
  foreach ($alias in $Aliases) {
    $key = Get-MatchKey $alias
    if ($Header.Columns.ContainsKey($key)) { return [string]$Header.Columns[$key] }
  }
  return ""
}
function Get-HeaderValue($Row, $Header, [string[]]$Aliases) {
  $column = Get-HeaderColumn $Header $Aliases
  if (-not $column) { return "" }
  return Get-Value $Row $column
}
function Read-NamedWorksheetWithHeader(
  [System.IO.Compression.ZipArchive]$Zip,
  [string[]]$SharedStrings,
  [string[]]$WorksheetNames
) {
  foreach ($worksheetName in $WorksheetNames) {
    $path = Get-WorksheetPathByName $Zip $worksheetName
    if (-not $path) { continue }
    $rows = Read-WorksheetRows $Zip $path $SharedStrings
    $header = Find-WorksheetHeader $rows
    if (-not $header) { continue }
    return [pscustomobject]@{
      Name = $worksheetName
      Rows = $rows
      Header = $header
    }
  }
  return $null
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
  [System.IO.File]::WriteAllText(
    $Path,
    (ConvertTo-Json -InputObject @($Data) -Depth 50),
    [System.Text.UTF8Encoding]::new($false)
  )
}
function Normalize-DamageFormula([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq '—' -or $text -eq '-') { return "" }
  $formula = (($text -replace '[кК]', 'd') -replace '\s+', '')
  if ($formula -notmatch '\d') { return "" }
  return $formula
}
function Convert-DamageTypeLabelToDnd5e([string]$Value) {
  $key = Get-MatchKey $Value
  switch ($key) {
    'дробящий' { return 'bludgeoning' }
    'колющий' { return 'piercing' }
    'рубящий' { return 'slashing' }
    'огонь' { return 'fire' }
    'огнем' { return 'fire' }
    'огненный' { return 'fire' }
    'холод' { return 'cold' }
    'кислота' { return 'acid' }
    'электричество' { return 'lightning' }
    'электричеством' { return 'lightning' }
    'яд' { return 'poison' }
    'чистая сила' { return 'force' }
    default { return "" }
  }
}
function Parse-RangeValue([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq '—' -or $text -eq '-') { return $null }
  if ($text -match '^\s*(\d+)\s*/\s*(\d+)\s*$') {
    return [pscustomobject][ordered]@{
      value = [int]$Matches[1]
      long = [int]$Matches[2]
      reach = 0
      units = 'ft'
    }
  }
  if ($text -match '^\s*(\d+)\s*$') {
    return [pscustomobject][ordered]@{
      value = [int]$Matches[1]
      long = 0
      reach = 0
      units = 'ft'
    }
  }
  return $null
}
function Add-UniqueString([System.Collections.Generic.List[string]]$List, [string]$Value) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return }
  if (-not $List.Contains($text)) { $List.Add($text) }
}
function Add-WeaponProperty([System.Collections.Generic.List[string]]$Properties, [string]$PropertyKey) {
  Add-UniqueString $Properties $PropertyKey
}
function Set-OrderedValue([System.Collections.IDictionary]$Values, [string]$Key, $Value) {
  if ([string]::IsNullOrWhiteSpace($Key) -or $null -eq $Value) { return }
  if ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value)) { return }
  $Values[$Key] = $Value
}
function Get-ParenthesizedFormula([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ($text -match '\(([^)]+)\)') { return Normalize-DamageFormula $Matches[1] }
  return ""
}
function Get-ParenthesizedInteger([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ($text -match '\((\d+)\)') { return [int]$Matches[1] }
  if ($text -match '(\d+)') { return [int]$Matches[1] }
  return $null
}
function Get-TrailingInteger([string]$Value) {
  $text = Normalize-DisplayText $Value
  if ($text -match '(\d+)\s*$') { return [int]$Matches[1] }
  return $null
}
function Add-FirearmAdditionalProperty([string]$Value, [System.Collections.Generic.List[string]]$Properties, [System.Collections.Generic.List[string]]$Labels, [hashtable]$PropertyValues) {
  $text = Normalize-DisplayText $Value
  if ([string]::IsNullOrWhiteSpace($text) -or $text -eq '—' -or $text -eq '-') { return }
  Add-UniqueString $Labels $text
  $key = Get-MatchKey $text

  if ($key -match 'легк') { Add-WeaponProperty $Properties 'lgt' }
  if ($key -match 'тяжел|тяжёл') { Add-WeaponProperty $Properties 'hvy' }
  if ($key -match 'особ') { Add-WeaponProperty $Properties 'spc' }
  if ($key -match 'затвор') { Add-WeaponProperty $Properties 'lchFirearmBoltAction' }
  if ($key -match 'лежач') { Add-WeaponProperty $Properties 'lchFirearmProneFire' }
  if ($key -match 'верхов') { Add-WeaponProperty $Properties 'lchMounted' }
  if ($key -match 'пулем') { Add-WeaponProperty $Properties 'lchFirearmMachineGun' }
  if ($key -match 'ржав') { Add-WeaponProperty $Properties 'lchFirearmRust' }
  if ($key -match 'неточ') { Add-WeaponProperty $Properties 'lchFirearmInaccurate' }
  if ($key -match 'перегрев') {
    Add-WeaponProperty $Properties 'lchFirearmOverheat'
    Set-OrderedValue $PropertyValues 'overheat' (Get-ParenthesizedInteger $text)
  }
  if ($key -match '^мку') {
    Add-WeaponProperty $Properties 'lchMku'
    Set-OrderedValue $PropertyValues 'mku' (Get-TrailingInteger $text)
  }
  if ($key -match '^му') {
    Add-WeaponProperty $Properties 'lchMu'
    Set-OrderedValue $PropertyValues 'mu' (Get-TrailingInteger $text)
  }
  if ($key -match '^рку') {
    Add-WeaponProperty $Properties 'lchRku'
    Set-OrderedValue $PropertyValues 'rku' (Get-TrailingInteger $text)
  }
}
function New-FirearmWeaponData($Row, [string]$FirearmClass) {
  $rawDamage = Normalize-DisplayText (Get-Value $Row 'C')
  if ([string]::IsNullOrWhiteSpace($rawDamage)) { return $null }
  $damageFormula = Normalize-DamageFormula (Get-Value $Row 'C')

  $properties = [System.Collections.Generic.List[string]]::new()
  $labels = [System.Collections.Generic.List[string]]::new()
  $values = [ordered]@{}
  Add-WeaponProperty $properties 'amm'
  Add-WeaponProperty $properties 'lchFirearmWaterVulnerability'

  $hands = Normalize-DisplayText (Get-Value $Row 'J')
  if ($hands) {
    Add-UniqueString $labels $hands
    $handKey = Get-MatchKey $hands
    if ($handKey -match 'двуруч') { Add-WeaponProperty $properties 'two' }
  }

  $rangeText = Normalize-DisplayText (Get-Value $Row 'I')
  $range = Parse-RangeValue $rangeText
  if ($rangeText) { Add-UniqueString $labels "Дальность $rangeText" }

  $misfire = Convert-ToPlainNumber (Get-Value $Row 'K') -AllowNull
  if ($null -ne $misfire -and $misfire -gt 0) {
    Add-WeaponProperty $properties 'lchFirearmMisfire'
    Set-OrderedValue $values 'misfire' ([int]$misfire)
    Add-UniqueString $labels "Осечка $([int]$misfire)"
  }

  $ammunition = Normalize-DisplayText (Get-Value $Row 'L')
  if ($ammunition -and $ammunition -ne '—' -and $ammunition -ne '-') {
    Add-WeaponProperty $properties 'lchFirearmAmmunition'
    Set-OrderedValue $values 'ammunition' $ammunition
    Add-UniqueString $labels "Боеприпасы: $ammunition"
  }

  $ammoProperty = Normalize-DisplayText (Get-Value $Row 'M')
  if ($ammoProperty -and $ammoProperty -ne '—' -and $ammoProperty -ne '-') {
    Add-WeaponProperty $properties 'lchFirearmAmmoProperty'
    Set-OrderedValue $values 'ammoProperty' $ammoProperty
    Add-UniqueString $labels $ammoProperty
    $ammoKey = Get-MatchKey $ammoProperty
    if ($ammoKey -match 'разброс') {
      Add-WeaponProperty $properties 'lchFirearmScatter'
      Set-OrderedValue $values 'scatterDamage' (Get-ParenthesizedFormula $ammoProperty)
    }
    if ($ammoKey -match 'взрыв') { Add-WeaponProperty $properties 'lchFirearmExplosive' }
    if ($ammoKey -match 'особ') { Add-WeaponProperty $properties 'spc' }
  }

  $fireMode = Normalize-DisplayText (Get-Value $Row 'N')
  if ($fireMode -and $fireMode -ne '—' -and $fireMode -ne '-') {
    Add-WeaponProperty $properties 'lchFirearmFireMode'
    Set-OrderedValue $values 'fireMode' $fireMode
    Add-UniqueString $labels $fireMode
    $fireModeKey = Get-MatchKey $fireMode
    if ($fireModeKey -match 'автомат') {
      Add-WeaponProperty $properties 'lchFirearmAutomatic'
      Set-OrderedValue $values 'automaticDamage' (Get-ParenthesizedFormula $fireMode)
    }
    if ($fireModeKey -match 'полуавтомат') {
      Add-WeaponProperty $properties 'lchFirearmSemiAutomatic'
      Set-OrderedValue $values 'semiAutomaticDamage' (Get-ParenthesizedFormula $fireMode)
    }
  }

  $reload = Normalize-DisplayText (Get-Value $Row 'O')
  if ($reload -and $reload -ne '—' -and $reload -ne '-') {
    Add-WeaponProperty $properties 'lchFirearmReload'
    Set-OrderedValue $values 'reload' $reload
    Add-UniqueString $labels $reload
  }

  $minStrength = Convert-ToPlainNumber (Get-Value $Row 'P') -AllowNull
  if ($null -ne $minStrength -and $minStrength -gt 0) {
    Add-WeaponProperty $properties 'lchStrReq'
    Set-OrderedValue $values 'minStrength' ([int]$minStrength)
    Add-UniqueString $labels "Мин. сила $([int]$minStrength)"
  }

  $construction = Normalize-DisplayText (Get-Value $Row 'Q')
  if ($construction -and $construction -ne '—' -and $construction -ne '-') {
    Add-WeaponProperty $properties 'lchFirearmConstruction'
    Set-OrderedValue $values 'construction' $construction
    Add-UniqueString $labels $construction
    if ((Get-MatchKey $construction) -match 'громозд') { Add-WeaponProperty $properties 'lchFirearmBulky' }
  }

  $surprise = Normalize-DamageFormula (Get-Value $Row 'R')
  if ($surprise) {
    Add-WeaponProperty $properties 'lchFirearmSurprise'
    Set-OrderedValue $values 'surpriseDamage' $surprise
    Add-UniqueString $labels "Внезапность $surprise"
  }

  $additional = Normalize-DisplayText (Get-Value $Row 'S')
  if ($additional) {
    foreach ($part in ($additional -split '[,;]')) {
      Add-FirearmAdditionalProperty $part $properties $labels $values
    }
  }

  return [pscustomobject][ordered]@{
    damageFormula = $damageFormula
    damageTypeLabel = Normalize-DisplayText (Get-Value $Row 'D')
    damageType = Convert-DamageTypeLabelToDnd5e (Get-Value $Row 'D')
    propertiesText = ($labels.ToArray() -join '; ')
    properties = $properties.ToArray()
    range = $range
    attackTraitsText = ($labels.ToArray() -join '; ')
    attackTraits = [pscustomobject]@{}
    lichWeaponPropertyValues = [pscustomobject]$values
    firearmAttackType = 'firearm'
    firearmClass = $FirearmClass
  }
}
function Merge-FirearmWeaponData([object[]]$Gear, [object[]]$FirearmRows) {
  if (-not $FirearmRows -or $FirearmRows.Count -eq 0) { return 0 }

  $firearmsByKey = @{}
  $currentClass = ""
  foreach ($row in ($FirearmRows | Where-Object { $_.__row -ge 3 })) {
    $name = Normalize-DisplayText (Get-Value $row 'A')
    if ([string]::IsNullOrWhiteSpace($name)) { continue }

    $rawDamage = Normalize-DisplayText (Get-Value $row 'C')
    if ([string]::IsNullOrWhiteSpace($rawDamage)) {
      $sectionKey = Get-MatchKey $name
      if ($sectionKey -match 'примитив') { $currentClass = 'primitive' }
      elseif ($sectionKey -match 'стандарт|продвинут') { $currentClass = 'advanced' }
      continue
    }

    $weapon = New-FirearmWeaponData $row $currentClass
    if (-not $weapon) { continue }
    $key = Get-LooseMatchKey $name
    if ($key) { $firearmsByKey[$key] = $weapon }
  }

  $matched = 0
  foreach ($item in $Gear) {
    if ((Get-MatchKey $item.equipmentType) -ne (Get-MatchKey 'Огнестрельное оружие')) { continue }
    $key = Get-LooseMatchKey $item.name
    if (-not $firearmsByKey.ContainsKey($key)) { continue }
    $weapon = $firearmsByKey[$key]
    $item | Add-Member -NotePropertyName weapon -NotePropertyValue $weapon -Force
    if ($weapon.firearmClass) {
      $item | Add-Member -NotePropertyName firearmClass -NotePropertyValue $weapon.firearmClass -Force
    }
    $matched += 1
  }

  return $matched
}
function Resolve-UpgradeProduct(
  $UpgradeRow,
  $UpgradeHeader,
  [object[]]$Gear,
  [hashtable]$CanonicalNameBySourceRow,
  [bool]$AllowUnmatched
) {
  $sourceRow = [int]$UpgradeRow.__row
  $profileName = Normalize-DisplayText (Get-HeaderValue $UpgradeRow $UpgradeHeader @('Название'))
  $explicitCanonicalName = if ($CanonicalNameBySourceRow.ContainsKey($sourceRow)) {
    Normalize-DisplayText ([string]$CanonicalNameBySourceRow[$sourceRow])
  } else {
    ""
  }

  if ($explicitCanonicalName) {
    $explicitMatches = @($Gear | Where-Object {
      (Get-MatchKey $_.name) -eq (Get-MatchKey $explicitCanonicalName)
    })
    if ($explicitMatches.Count -eq 1) { return $explicitMatches[0] }
    throw "Upgrade row $sourceRow ('$profileName') maps to '$explicitCanonicalName', but found $($explicitMatches.Count) base products."
  }

  $exactMatches = @($Gear | Where-Object {
    (Get-MatchKey $_.equipmentType) -eq (Get-MatchKey 'Усовершенствование') -and
    (Get-MatchKey $_.name) -eq (Get-MatchKey $profileName)
  })
  if ($exactMatches.Count -eq 1) { return $exactMatches[0] }
  if ($exactMatches.Count -gt 1) {
    throw "Upgrade row $sourceRow ('$profileName') matches multiple base products by name."
  }

  $sourceMaterialName = Normalize-DisplayText (Get-HeaderValue $UpgradeRow $UpgradeHeader @('Источник'))
  $profilePrice = (Parse-Price (Get-HeaderValue $UpgradeRow $UpgradeHeader @('Цена (зм)', 'Цена'))).GoldEquivalent
  $materialMatches = @($Gear | Where-Object {
    (Get-MatchKey $_.equipmentType) -eq (Get-MatchKey 'Усовершенствование') -and
    (Get-MatchKey $_.predominantMaterialName) -eq (Get-MatchKey $sourceMaterialName) -and
    [math]::Abs(([double]$_.priceGoldEquivalent) - ([double]$profilePrice)) -lt 0.000001
  })
  if ($materialMatches.Count -eq 1) { return $materialMatches[0] }
  if ($materialMatches.Count -gt 1) {
    throw "Upgrade row $sourceRow ('$profileName') matches multiple base products by material and price."
  }

  if ($AllowUnmatched) {
    Write-Info "Skipped unmatched upgrade row $sourceRow ('$profileName'): exact=$($exactMatches.Count), material=$($materialMatches.Count), gear=$($Gear.Count)."
    return $null
  }
  throw "Upgrade row $sourceRow ('$profileName') does not match a base product."
}
function Build-UpgradeCatalog(
  [object[]]$UpgradeRows,
  $UpgradeHeader,
  [object[]]$Gear,
  [object[]]$ReferenceRows,
  [string[]]$DeferredNames,
  [bool]$AllowUnmatched
) {
  if (-not $UpgradeHeader) { return @() }

  $canonicalNameBySourceRow = @{}
  foreach ($row in $ReferenceRows) {
    $sourceId = Normalize-DisplayText (Get-Value $row 'S')
    $canonicalName = Normalize-DisplayText (Get-Value $row 'T')
    if ($sourceId -match '^Усовершенствования V0\.21!A(\d+)$' -and $canonicalName) {
      $canonicalNameBySourceRow[[int]$Matches[1]] = $canonicalName
    }
  }

  $upgrades = @()
  foreach ($row in ($UpgradeRows | Where-Object { $_.__row -gt $UpgradeHeader.RowNumber })) {
    $name = Normalize-DisplayText (Get-HeaderValue $row $UpgradeHeader @('Название'))
    if (-not $name) { continue }
    $profileType = Normalize-DisplayText (Get-HeaderValue $row $UpgradeHeader @('Тип'))
    if ((Get-MatchKey $profileType) -eq (Get-MatchKey 'Проклятье')) { continue }
    if (@($DeferredNames | Where-Object { (Get-MatchKey $_) -eq (Get-MatchKey $name) }).Count -gt 0) {
      Write-Info "Deferred upgrade row $([int]$row.__row) ('$name')."
      continue
    }
    $product = Resolve-UpgradeProduct `
      -UpgradeRow $row `
      -UpgradeHeader $UpgradeHeader `
      -Gear $Gear `
      -CanonicalNameBySourceRow $canonicalNameBySourceRow `
      -AllowUnmatched $AllowUnmatched
    if (-not $product) { continue }
    $price = Parse-Price (Get-HeaderValue $row $UpgradeHeader @('Цена (зм)', 'Цена'))
    $sourceMaterialName = Normalize-DisplayText (Get-HeaderValue $row $UpgradeHeader @('Источник'))
    if ($sourceMaterialName -eq '—' -or $sourceMaterialName -eq '-') { $sourceMaterialName = "" }

    $upgrades += [pscustomobject][ordered]@{
      name = $name
      productId = $product.id
      canonicalName = $product.name
      upgrade = [pscustomobject][ordered]@{
        rank = Convert-ToPlainNumber (Get-HeaderValue $row $UpgradeHeader @('Ранг')) -AllowNull
        appliesTo = Normalize-DisplayText (Get-HeaderValue $row $UpgradeHeader @('Применимо к'))
        effect = Normalize-DisplayText (Get-HeaderValue $row $UpgradeHeader @('Эффект'))
        priceGold = $price.GoldEquivalent
        sourceMaterialName = $sourceMaterialName
        sourceMaterialId = $product.predominantMaterialId
        type = $profileType
        sourceSheet = 'Усовершенствования V0.21'
        sourceSheetRow = [int]$row.__row
      }
    }
  }
  return $upgrades
}

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) { throw "WorkbookPath is required." }
$resolvedMaterialsPath = Resolve-MaterialsPath $MaterialsPath
$resolvedOutputPath = Resolve-OutputPath $OutputPath
$resolvedUpgradesOutputPath = Resolve-UpgradesOutputPath $UpgradesOutputPath
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutputPath)
if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory | Out-Null }
$upgradesOutputDirectory = [System.IO.Path]::GetDirectoryName($resolvedUpgradesOutputPath)
if (-not (Test-Path -LiteralPath $upgradesOutputDirectory)) {
  New-Item -ItemType Directory -Path $upgradesOutputDirectory | Out-Null
}

$materials = @()
if (Test-Path -LiteralPath $resolvedMaterialsPath) {
  $materials = Get-Content -Raw -Encoding UTF8 $resolvedMaterialsPath | ConvertFrom-Json
}
$resolvedEnrichmentSourcePath = if (-not [string]::IsNullOrWhiteSpace($EnrichmentSourcePath)) {
  [System.IO.Path]::GetFullPath($EnrichmentSourcePath)
} elseif (Test-Path -LiteralPath $resolvedOutputPath) {
  $resolvedOutputPath
} else {
  ""
}
$enrichmentByKey = @{}
if ($resolvedEnrichmentSourcePath -and (Test-Path -LiteralPath $resolvedEnrichmentSourcePath)) {
  $enrichmentRows = @(Get-Content -Raw -Encoding UTF8 $resolvedEnrichmentSourcePath | ConvertFrom-Json)
  while ($enrichmentRows.Count -eq 1 -and $enrichmentRows[0] -is [System.Array]) {
    $enrichmentRows = @($enrichmentRows[0])
  }
  foreach ($entry in $enrichmentRows) {
    $key = Get-GearMatchKey ([string]$entry.equipmentType) ([string]$entry.name)
    if (-not $key -or $key -eq '|') { continue }
    if ($enrichmentByKey.ContainsKey($key)) {
      throw "Enrichment source contains duplicate gear key '$key'."
    }
    $enrichmentByKey[$key] = $entry
  }
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($WorkbookPath)
try {
  $sharedStrings = Load-SharedStrings $zip
  $gearWorksheet = Read-NamedWorksheetWithHeader $zip $sharedStrings @(
    "Общий компендиум снаряжения V0.1",
    "Немагическое снаряжение V0.1"
  )
  if (-not $gearWorksheet) {
    throw "Unable to find a supported gear worksheet with 'Название' and 'Цена' headers."
  }
  $rows = $gearWorksheet.Rows
  $gearHeader = $gearWorksheet.Header
  $upgradeWorksheet = Read-NamedWorksheetWithHeader $zip $sharedStrings @("Усовершенствования V0.21")
  $upgradeRows = if ($upgradeWorksheet) { $upgradeWorksheet.Rows } else { @() }
  $upgradeHeader = if ($upgradeWorksheet) { $upgradeWorksheet.Header } else { $null }
  $referenceWorksheetPath = Get-WorksheetPathByName $zip "_СПРАВОЧНИК_СНАРЯЖЕНИЯ"
  $referenceRows = if ($referenceWorksheetPath) {
    Read-WorksheetRows $zip $referenceWorksheetPath $sharedStrings
  } else {
    @()
  }
  $firearmWorksheetPath = Get-WorksheetPathByName $zip "Огнестрел V0.36"
  $firearmRows = if ($firearmWorksheetPath) { Read-WorksheetRows $zip $firearmWorksheetPath $sharedStrings } else { @() }
}
finally { $zip.Dispose() }

$gear = @()
$usedIds = @{}
$rowCounter = 1
$enrichmentMatchCount = 0
foreach ($row in ($rows | Where-Object { $_.__row -gt $gearHeader.RowNumber })) {
  $name = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Название'))
  if ([string]::IsNullOrWhiteSpace($name)) { continue }

  $equipmentType = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Тип снаряжения'))
  $enrichmentKey = Get-GearMatchKey $equipmentType $name
  $enrichment = if ($enrichmentByKey.ContainsKey($enrichmentKey)) {
    $enrichmentByKey[$enrichmentKey]
  } else {
    $null
  }
  $price = Parse-Price (Get-HeaderValue $row $gearHeader @('Цена'))
  $materialName = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @(
    'Преобладающий материал (источник)',
    'Преобладающий материал'
  ))
  $material = if ($materialName) { Resolve-MaterialMatch $materialName $materials } else { $null }
  $preferredId = if ($enrichment -and $enrichment.id) {
    Normalize-DisplayText ([string]$enrichment.id)
  } else {
    Convert-ToSlug $name
  }
  if ([string]::IsNullOrWhiteSpace($preferredId)) { $preferredId = "gear-$rowCounter" }

  $item = [pscustomobject][ordered]@{
    id = New-UniqueId $preferredId $usedIds "gear"
    name = $name
    equipmentType = $equipmentType
    shopSubtype = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Подтип (магазин)'))
    priceText = $price.RawText
    priceValue = $price.Value
    priceDenomination = $price.Denomination
    priceGoldEquivalent = $price.GoldEquivalent
    rank = Convert-ToPlainNumber (Get-HeaderValue $row $gearHeader @('Ранг')) -AllowNull
    weight = Convert-ToPlainNumber (Get-HeaderValue $row $gearHeader @('Вес')) -AllowNull
    volume = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Объем', 'Объём'))
    capacity = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Вместимость'))
    description = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Описание'))
    predominantMaterialId = if ($material) { $material.id } else { $null }
    predominantMaterialName = if ($material) { $material.name } else { $materialName }
    linkedTool = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Связанный инструмент'))
    value = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Value'))
    itemSlot = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Слот'))
    heroDollSlots = Normalize-DisplayText (Get-HeaderValue $row $gearHeader @('Слоты куклы'))
    source = 'gear-workbook'
  }
  if ($enrichment) {
    $enrichmentMatchCount += 1
    foreach ($field in @(
      'containerCapacity',
      'containerContents',
      'foundryType',
      'foundrySubtype',
      'foundrySubtypeExtra',
      'foundryBaseItem',
      'foundryFolder',
      'itemSlot',
      'heroDollSlots',
      'firearmClass',
      'weapon',
      'armor'
    )) {
      $property = $enrichment.PSObject.Properties[$field]
      if (-not $property -or $null -eq $property.Value) { continue }
      $item | Add-Member -NotePropertyName $field -NotePropertyValue $property.Value -Force
    }
  }
  $gear += $item
  $rowCounter += 1
}

if ($gear.Count -eq 0 -and $AugmentExisting -and (Test-Path -LiteralPath $resolvedOutputPath)) {
  Write-Info "No gear rows found in the primary worksheet; augmenting existing gear data."
  $existingGear = @(Get-Content -Raw -Encoding UTF8 $resolvedOutputPath | ConvertFrom-Json)
  while ($existingGear.Count -eq 1 -and $existingGear[0] -is [System.Array]) {
    $existingGear = @($existingGear[0])
  }
  $gear = $existingGear
}

$firearmMatchCount = Merge-FirearmWeaponData $gear $firearmRows
$upgrades = @(
  Build-UpgradeCatalog `
    -UpgradeRows $upgradeRows `
    -UpgradeHeader $upgradeHeader `
    -Gear $gear `
    -ReferenceRows $referenceRows `
    -DeferredNames $DeferredUpgradeNames `
    -AllowUnmatched ([bool]$AllowUnmatchedProfiles)
)

Write-JsonFile $resolvedOutputPath $gear
Write-JsonFile $resolvedUpgradesOutputPath $upgrades
Write-Info 'Gear import complete.'
Write-Info "Gear items: $($gear.Count)"
Write-Info "Gear worksheet: $($gearWorksheet.Name)"
Write-Info "Existing gear enrichments matched: $enrichmentMatchCount"
Write-Info "Firearm weapon rows matched: $firearmMatchCount"
Write-Info "Upgrade profiles: $(@($upgrades).Count)"
Write-Info "Path: $resolvedOutputPath"
Write-Info "Upgrades path: $resolvedUpgradesOutputPath"
