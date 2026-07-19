[CmdletBinding()]
param(
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
)

$ErrorActionPreference = 'Stop'
$SkillRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

function Remove-TokiManagedThemeDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$SavedThemeRoot
  )

  if (-not (Test-Path -LiteralPath $Path)) { return }
  if (-not (Test-DreamSkinPathWithin -Path $Path -Root $SavedThemeRoot)) {
    throw "Refusing to remove a Toki theme path outside the saved-theme root: $Path"
  }
  Assert-DreamSkinNoReparseComponents -Path $Path
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
}

function Install-TokiSavedPreset {
  param(
    [Parameter(Mandatory = $true)][string]$ImagePath,
    [Parameter(Mandatory = $true)][object]$Theme,
    [Parameter(Mandatory = $true)][object]$Paths
  )

  $presetId = 'preset-toki-bunny-04'
  $presetDirectory = Join-Path $Paths.Saved $presetId
  $token = [guid]::NewGuid().ToString('N')
  $stagingDirectory = Join-Path $Paths.Saved ".${presetId}-staging-$token"
  $backupDirectory = Join-Path $Paths.Saved ".${presetId}-backup-$token"
  foreach ($path in @($presetDirectory, $stagingDirectory, $backupDirectory)) {
    if (-not (Test-DreamSkinPathWithin -Path $path -Root $Paths.Saved)) {
      throw "Toki preset path escaped the saved-theme root: $path"
    }
    Assert-DreamSkinNoReparseComponents -Path $path
  }

  Ensure-DreamSkinManagedDirectory -Path $stagingDirectory -Root $Paths.Root
  $hasBackup = $false
  try {
    $presetImage = Join-Path $stagingDirectory 'background.png'
    Copy-Item -LiteralPath $ImagePath -Destination $presetImage -Force -ErrorAction Stop
    Assert-DreamSkinNoReparseComponents -Path $presetImage
    Assert-DreamSkinImageFile -Path $presetImage

    $presetTheme = $Theme | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $presetTheme.image = 'background.png'
    Write-DreamSkinTheme -ThemeDirectory $stagingDirectory -Theme $presetTheme
    $validatedPreset = Read-DreamSkinTheme -ThemeDirectory $stagingDirectory
    if ("$($validatedPreset.Theme.id)" -cne $presetId -or
      "$($validatedPreset.Theme.variant)" -cne 'toki') {
      throw 'The staged Toki preset metadata failed validation.'
    }

    if (Test-Path -LiteralPath $presetDirectory) {
      if (-not (Test-Path -LiteralPath $presetDirectory -PathType Container)) {
        throw "The Toki preset destination is not a directory: $presetDirectory"
      }
      Assert-DreamSkinNoReparseComponents -Path $presetDirectory
      Move-Item -LiteralPath $presetDirectory -Destination $backupDirectory -ErrorAction Stop
      $hasBackup = $true
    }
    try {
      Move-Item -LiteralPath $stagingDirectory -Destination $presetDirectory -ErrorAction Stop
    } catch {
      if ($hasBackup -and -not (Test-Path -LiteralPath $presetDirectory)) {
        try {
          Move-Item -LiteralPath $backupDirectory -Destination $presetDirectory -ErrorAction Stop
          $hasBackup = $false
        } catch {
          throw "Toki preset update failed and its previous version could not be restored. Backup preserved at ${backupDirectory}: $($_.Exception.Message)"
        }
      }
      throw
    }

    if ($hasBackup) {
      try {
        Remove-TokiManagedThemeDirectory -Path $backupDirectory -SavedThemeRoot $Paths.Saved
        $hasBackup = $false
      } catch {
        Write-Warning "Installed the Toki preset but could not remove its previous backup: $($_.Exception.Message)"
      }
    }
  } finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
      try {
        Remove-TokiManagedThemeDirectory -Path $stagingDirectory -SavedThemeRoot $Paths.Saved
      } catch {
        Write-Warning "Could not remove the staged Toki preset: $($_.Exception.Message)"
      }
    }
  }
}

$operationLock = Enter-DreamSkinOperationLock
try {
  $null = Get-DreamSkinNodeRuntime
  $paths = Initialize-DreamSkinThemeStore -SkillRoot $SkillRoot -StateRoot $StateRoot
  $assetRoot = Join-Path $SkillRoot 'assets'
  $themePath = Join-Path $assetRoot 'toki-theme.json'
  try {
    $theme = (Read-DreamSkinUtf8File -Path $themePath) | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "Toki theme metadata is invalid JSON: $themePath"
  }
  if ($null -eq $theme -or $theme -is [string] -or $theme -is [array] -or
    "$($theme.id)" -cne 'preset-toki-bunny-04' -or "$($theme.variant)" -cne 'toki' -or
    -not $theme.image) {
    throw 'Toki theme metadata does not match the bundled preset contract.'
  }

  $imagePath = [System.IO.Path]::GetFullPath((Join-Path $assetRoot "$($theme.image)"))
  if (-not (Test-DreamSkinPathWithin -Path $imagePath -Root $assetRoot)) {
    throw 'Toki theme image escaped the runtime asset directory.'
  }
  Assert-DreamSkinNoReparseComponents -Path $imagePath
  Assert-DreamSkinImageFile -Path $imagePath

  Install-TokiSavedPreset -ImagePath $imagePath -Theme $theme -Paths $paths
  $activeTheme = $theme | ConvertTo-Json -Depth 8 | ConvertFrom-Json
  $active = Set-DreamSkinActiveTheme -ImagePath $imagePath -Theme $activeTheme -StateRoot $StateRoot
  if ("$($active.Theme.id)" -cne 'preset-toki-bunny-04' -or "$($active.Theme.variant)" -cne 'toki') {
    throw 'The active Toki theme failed post-install validation.'
  }
  Set-DreamSkinPaused -Paused $false -StateRoot $StateRoot | Out-Null
  Write-Host "Toki theme installed and activated at $($active.Directory)."
} finally {
  Exit-DreamSkinOperationLock -Mutex $operationLock
}
