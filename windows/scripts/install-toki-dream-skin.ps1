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
    [Parameter(Mandatory = $true)][string]$Description
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
    $portArgument = if ($PortExplicit) { " -Port $Port" } else { '' }
    $shortcutFolders = @($desktop, $startMenu)
    # Keep this script ASCII-safe for Windows PowerShell 5.1, which treats a
    # BOM-less UTF-8 .ps1 as the active ANSI code page. JSON escapes preserve
    # the intended Chinese shortcut names without depending on source encoding.
    $mainShortcutFile = '"Toki Codex\uff08\u98de\u9e1f\u9a6c\u65f6\uff09.lnk"' | ConvertFrom-Json
    $trayShortcutFile = '"Toki Codex - \u4e3b\u9898\u63a7\u5236.lnk"' | ConvertFrom-Json
    $restoreShortcutFile = '"Toki Codex - \u6062\u590d\u5b98\u65b9\u5916\u89c2.lnk"' | ConvertFrom-Json

    foreach ($folder in $shortcutFolders) {
      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $mainShortcutFile) `
        -TargetPath $powershell `
        -Arguments "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Start)`"$portArgument -PromptRestart" `
        -WorkingDirectory $engine.Root `
        -Description 'Launch the official Microsoft Store Codex with the external Toki theme engine'

      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $trayShortcutFile) `
        -TargetPath $powershell `
        -Arguments "-NoProfile -STA -WindowStyle Minimized -ExecutionPolicy RemoteSigned -File `"$($engine.Tray)`"$portArgument" `
        -WorkingDirectory $engine.Root `
        -Description 'Open the Toki Codex theme control tray'

      Set-TokiDreamSkinShortcut -Shell $shell `
        -Path (Join-Path $folder $restoreShortcutFile) `
        -TargetPath $powershell `
        -Arguments "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Restore)`"$portArgument -PromptRestart" `
        -WorkingDirectory $engine.Root `
        -Description 'Remove the external Toki skin without rewriting the shared Codex config'
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
