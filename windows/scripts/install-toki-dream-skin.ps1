[CmdletBinding()]
param(
  [int]$Port = 9335,
  [switch]$NoShortcuts
)

$ErrorActionPreference = 'Stop'
$PortExplicit = $PSBoundParameters.ContainsKey('Port')
$SkillRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

function Set-TokiDreamSkinShortcut {
  param(
    [Parameter(Mandatory = $true)][object]$Shell,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Description,
    [string]$IconLocation
  )

  $folder = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Path))
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $temporaryPath = Join-Path $folder ('.toki-shortcut-' + [guid]::NewGuid().ToString('N') + '.lnk')
  try {
    $shortcut = $Shell.CreateShortcut($temporaryPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = $Arguments
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.Description = $Description
    if ($IconLocation) { $shortcut.IconLocation = "$IconLocation,0" }
    $shortcut.Save()
    if (-not (Test-Path -LiteralPath $temporaryPath -PathType Leaf)) {
      throw "Toki shortcut could not be created: $Path"
    }
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force -ErrorAction Stop
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

Assert-DreamSkinPort -Port $Port
$baseInstaller = Join-Path $PSScriptRoot 'install-dream-skin.ps1'
$installParameters = @{ NoShortcuts = $true; SkipBaseTheme = $true }
if ($PortExplicit) { $installParameters.Port = $Port }
& $baseInstaller @installParameters

$StateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$engine = Get-DreamSkinRuntimeEnginePaths -StateRoot $StateRoot
$tokiThemeInstaller = Join-Path $engine.Scripts 'install-toki-theme.ps1'
if (-not (Test-Path -LiteralPath $tokiThemeInstaller -PathType Leaf)) {
  throw "The managed Toki theme installer is missing: $tokiThemeInstaller"
}
& $tokiThemeInstaller -StateRoot $StateRoot

$tokiPetInstaller = Join-Path $engine.Scripts 'install-toki-pet.ps1'
if (-not (Test-Path -LiteralPath $tokiPetInstaller -PathType Leaf)) {
  throw "The managed Toki pet installer is missing: $tokiPetInstaller"
}
$null = & $tokiPetInstaller

if (-not $NoShortcuts) {
  $operationLock = Enter-DreamSkinOperationLock
  try {
    $engine = Get-DreamSkinRuntimeEnginePaths -StateRoot $StateRoot
    foreach ($requiredPath in @($engine.Root, $engine.Start, $engine.Restore, $engine.Tray)) {
      if (-not (Test-DreamSkinPathWithin -Path $requiredPath -Root $StateRoot) -and
        -not (Test-DreamSkinPathEqual -Left $requiredPath -Right $StateRoot)) {
        throw "Managed Toki engine path escaped its state root: $requiredPath"
      }
    }
    Assert-DreamSkinRuntimeTree -Path $engine.Root

    $shell = New-Object -ComObject WScript.Shell
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $taskbarPins = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
    $portArgument = if ($PortExplicit) { " -Port $Port" } else { '' }
    $shortcutFolders = @($desktop, $startMenu)
    # Keep this script ASCII-safe for Windows PowerShell 5.1, which treats a
    # BOM-less UTF-8 .ps1 as the active ANSI code page. JSON escapes preserve
    # the intended Chinese shortcut names without depending on source encoding.
    $mainShortcutFile = '"Toki Codex\uff08\u98de\u9e1f\u9a6c\u65f6\uff09.lnk"' | ConvertFrom-Json
    $trayShortcutFile = '"Toki Codex - \u4e3b\u9898\u63a7\u5236.lnk"' | ConvertFrom-Json
    $restoreShortcutFile = '"Toki Codex - \u6062\u590d\u5b98\u65b9\u5916\u89c2.lnk"' | ConvertFrom-Json
    $legacyShortcutFile = '"Toki Codex \u65e7\u7248\uff08app.asar \u56de\u9000\uff09.lnk"' | ConvertFrom-Json
    $legacyPortableRoot = Join-Path $env:LOCALAPPDATA 'Programs\TokiCodex'
    $launchArguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Start)`"$portArgument -PromptRestart"
    $launchDescription = 'Launch the newest registered Microsoft Store Codex with the external Toki theme engine'

    # Preserve the native Codex icon in a stable managed path. Store updates
    # retire their WindowsApps directories, but this copied icon remains valid.
    $iconPath = Join-Path $StateRoot 'codex.ico'
    $temporaryIconPath = Join-Path $StateRoot ('.codex-icon-' + [guid]::NewGuid().ToString('N') + '.ico')
    try {
      Add-Type -AssemblyName System.Drawing
      $currentCodex = Get-DreamSkinCodexInstall
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($currentCodex.Executable)
      if ($null -ne $icon) {
        try {
          $stream = [System.IO.File]::Open($temporaryIconPath, [System.IO.FileMode]::CreateNew)
          try { $icon.Save($stream) } finally { $stream.Dispose() }
          Move-Item -LiteralPath $temporaryIconPath -Destination $iconPath -Force
        } finally {
          $icon.Dispose()
        }
      }
    } catch {
      Write-Warning "Could not refresh the managed Codex shortcut icon: $($_.Exception.Message)"
    } finally {
      Remove-Item -LiteralPath $temporaryIconPath -Force -ErrorAction SilentlyContinue
    }
    $shortcutIcon = if (Test-Path -LiteralPath $iconPath -PathType Leaf) { $iconPath } else { $null }

    foreach ($folder in $shortcutFolders) {
      # Migrate shortcuts from the retired app.asar package. The managed start
      # script resolves the registered Store package on every launch, so an
      # automatic Codex update does not make these shortcuts stale.
      foreach ($candidate in @(Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
        $existing = $shell.CreateShortcut($candidate.FullName)
        $legacyTarget = -not [string]::IsNullOrWhiteSpace($existing.TargetPath) -and
          (Test-DreamSkinPathWithin -Path $existing.TargetPath -Root $legacyPortableRoot)
        $legacyArguments = -not [string]::IsNullOrWhiteSpace($existing.Arguments) -and
          $existing.Arguments.IndexOf($legacyPortableRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
        if (-not $legacyTarget -and -not $legacyArguments) { continue }
        if ([string]::Equals($candidate.Name, $legacyShortcutFile, [System.StringComparison]::OrdinalIgnoreCase)) {
          Remove-Item -LiteralPath $candidate.FullName -Force
          continue
        }
        Set-TokiDreamSkinShortcut -Shell $shell `
          -Path $candidate.FullName `
          -TargetPath $powershell `
          -Arguments $launchArguments `
          -WorkingDirectory $engine.Root `
          -Description $launchDescription `
          -IconLocation $shortcutIcon
      }
      Remove-Item -LiteralPath (Join-Path $folder $legacyShortcutFile) -Force -ErrorAction SilentlyContinue

      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $mainShortcutFile) `
        -TargetPath $powershell `
        -Arguments $launchArguments `
        -WorkingDirectory $engine.Root `
        -Description $launchDescription `
        -IconLocation $shortcutIcon

      if (-not (Test-DreamSkinPathEqual -Left $folder -Right $startMenu)) {
        # Keep the desktop clean: launch Toki from the single main shortcut.
        # Theme controls and restore remain available from the Start menu.
        Remove-Item -LiteralPath (Join-Path $folder $trayShortcutFile) -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath (Join-Path $folder $restoreShortcutFile) -Force -ErrorAction SilentlyContinue
        continue
      }

      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $trayShortcutFile) `
        -TargetPath $powershell `
        -Arguments "-NoProfile -STA -WindowStyle Minimized -ExecutionPolicy RemoteSigned -File `"$($engine.Tray)`"$portArgument" `
        -WorkingDirectory $engine.Root `
        -Description 'Open the Toki Codex theme control tray' `
        -IconLocation $shortcutIcon

      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $restoreShortcutFile) `
        -TargetPath $powershell `
        -Arguments "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Restore)`"$portArgument -PromptRestart" `
        -WorkingDirectory $engine.Root `
        -Description 'Remove the external Toki skin without rewriting the shared Codex config' `
        -IconLocation $shortcutIcon
    }

    # Repair an already pinned shortcut too. Windows does not always store a
    # taskbar pin as a .lnk, so this is intentionally best-effort.
    if (Test-Path -LiteralPath $taskbarPins -PathType Container) {
      foreach ($candidate in @(Get-ChildItem -LiteralPath $taskbarPins -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
        try {
          $existing = $shell.CreateShortcut($candidate.FullName)
          $legacyTarget = -not [string]::IsNullOrWhiteSpace($existing.TargetPath) -and
            (Test-DreamSkinPathWithin -Path $existing.TargetPath -Root $legacyPortableRoot)
          $legacyArguments = -not [string]::IsNullOrWhiteSpace($existing.Arguments) -and
            $existing.Arguments.IndexOf($legacyPortableRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
          if ($legacyTarget -or $legacyArguments) {
            Set-TokiDreamSkinShortcut -Shell $shell `
              -Path $candidate.FullName `
              -TargetPath $powershell `
              -Arguments $launchArguments `
              -WorkingDirectory $engine.Root `
              -Description $launchDescription `
              -IconLocation $shortcutIcon
          }
        } catch {
          Write-Warning "Could not inspect or repair pinned shortcut $($candidate.FullName): $($_.Exception.Message)"
        }
      }
    }
  } finally {
    Exit-DreamSkinOperationLock -Mutex $operationLock
  }
}

# Deliberately do not launch the tray or Codex here. Installation must not close
# or disturb an already-running portable Toki build; the managed shortcut starts
# only the registered Microsoft Store Codex package when the user chooses it.
if ($NoShortcuts) {
  Write-Host "Toki Dream Skin and Toki Bunny pet installed at $($engine.Root) without creating shortcuts."
} else {
  Write-Host 'Toki Dream Skin and Toki Bunny pet installed. Use the Toki Codex desktop shortcut to launch the official Store Codex with the external engine.'
  Write-Host 'Open Codex Settings > Pets, choose Refresh, then select Toki Bunny once on this computer.'
}
