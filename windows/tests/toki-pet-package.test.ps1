[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $Root 'scripts\install-toki-pet.ps1'
$package = Join-Path $Root 'pets\toki-bunny\package'
$qaRoot = Join-Path $Root 'pets\toki-bunny\qa'
$expectedSheetHash = '88265FDBB592ED78EE624DBF6D879592B4DFA89F8A5DD2E77D91B5504AD65A7F'
$expectedManifestHash = 'AE2FC7E22551F4128E660499A37B11F3C1CDBD97FCBC8EA8BF2B1D2D31E1E014'
$expectedContactSheetHash = '622645D4C17D77E9C0DDC3E6BEACED59E36244576F26AF75B504B7A4E88BCC04'
$expectedLookDirectionsHash = '2FC126C6C62DAD2E05CAB9F9E0EBB3B89BF2E147AAB43C9028619F23CB186D73'

$manifest = & $installer -PackagePath $package -ValidateOnly
if ($manifest.id -cne 'toki-bunny' -or $manifest.spriteVersionNumber -ne 2 -or
  $manifest.atlas.width -ne 1536 -or $manifest.atlas.height -ne 2288 -or
  -not $manifest.atlas.alpha) {
  throw 'Bundled Toki pet failed its v2 package contract.'
}

$packageEntries = @(Get-ChildItem -Force -LiteralPath $package)
if ($packageEntries.Count -ne 2 -or
  @(Get-ChildItem -File -Force -LiteralPath $package).Count -ne 2 -or
  -not (Test-Path -LiteralPath (Join-Path $package 'pet.json') -PathType Leaf) -or
  -not (Test-Path -LiteralPath (Join-Path $package 'spritesheet.webp') -PathType Leaf)) {
  throw 'Bundled Toki runtime package must contain exactly pet.json and spritesheet.webp.'
}
if ((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $package 'pet.json')).Hash -cne
    $expectedManifestHash -or
  (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $package 'spritesheet.webp')).Hash -cne
    $expectedSheetHash) {
  throw 'Bundled Toki pet hashes no longer match the approved QA artifacts.'
}

$qaSummary = Get-Content -Raw -LiteralPath (Join-Path $qaRoot 'validation-summary.json') |
  ConvertFrom-Json -ErrorAction Stop
if (-not $qaSummary.checks -or $qaSummary.checks.atlasValidation -cne
    'pass_without_errors_or_warnings' -or
  "$($qaSummary.atlas.sha256)".ToUpperInvariant() -cne $expectedSheetHash -or
  "$($qaSummary.manifest.sha256)".ToUpperInvariant() -cne $expectedManifestHash -or
  (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $qaRoot 'contact-sheet.png')).Hash -cne
    $expectedContactSheetHash -or
  (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $qaRoot 'look-directions.png')).Hash -cne
    $expectedLookDirectionsHash -or
  "$($qaSummary.qaArtifacts.contactSheet.sha256)".ToUpperInvariant() -cne $expectedContactSheetHash -or
  "$($qaSummary.qaArtifacts.lookDirections.sha256)".ToUpperInvariant() -cne
    $expectedLookDirectionsHash) {
  throw 'Bundled Toki QA evidence is missing or no longer matches its pinned artifacts.'
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "toki-pet-tests-$PID-$([guid]::NewGuid().ToString('N'))"
$codexHome = Join-Path $temporaryRoot 'codex-home'
$petsRoot = Join-Path $codexHome 'pets'
$configPath = Join-Path $codexHome 'config.toml'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false, $true)
New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
[System.IO.File]::WriteAllText($configPath, "selected-avatar-id = `"keep-existing`"`n", $utf8NoBom)
$configHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $configPath).Hash

try {
  $first = & $installer -PackagePath $package -PetsRoot $petsRoot
  if ($first.Replaced -or $first.Id -cne 'toki-bunny') {
    throw 'First Toki pet install did not publish a new package.'
  }
  $second = & $installer -PackagePath $package -PetsRoot $petsRoot
  if (-not $second.Replaced -or $second.Id -cne 'toki-bunny') {
    throw 'Repeat Toki pet install did not use the safe replacement path.'
  }

  $installedPath = Join-Path $petsRoot 'toki-bunny'
  $installedEntries = @(Get-ChildItem -Force -LiteralPath $installedPath)
  if ($installedEntries.Count -ne 2 -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installedPath 'pet.json')).Hash -cne
      $expectedManifestHash -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $installedPath 'spritesheet.webp')).Hash -cne
      $expectedSheetHash) {
    throw 'Installed Toki pet is incomplete or differs from the approved package.'
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $configPath).Hash -cne $configHash) {
    throw 'Toki pet installer changed Codex config or selected a pet automatically.'
  }
  $leftovers = @(Get-ChildItem -Force -LiteralPath $petsRoot | Where-Object {
    $_.Name -like '.dream-skin-pet-*'
  })
  if ($leftovers.Count -ne 0) {
    throw 'Repeat Toki pet install left staging or backup directories behind.'
  }

  Write-Host 'PASS: bundled Toki v2 pet validation and safe repeat install.'
} finally {
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
