[CmdletBinding()]
param(
  [int]$Port = 9335,
  [string]$StateRoot = (Join-Path $env:LOCALAPPDATA 'CodexDreamSkin')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')
. (Join-Path $PSScriptRoot 'theme-windows.ps1')

function Set-TokiManagedShortcut {
  param(
    [Parameter(Mandatory = $true)][object]$Shell,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][string]$IconPath
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
    $shortcut.IconLocation = "$IconPath,0"
    $shortcut.Save()
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force -ErrorAction Stop
  } finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Export-TokiCodexIcon {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($Executable)
  if ($null -eq $icon) { throw 'The official Codex icon could not be extracted.' }
  $temporaryPath = Join-Path ([System.IO.Path]::GetDirectoryName($Destination)) `
    ('.codex-icon-' + [guid]::NewGuid().ToString('N') + '.ico')
  try {
    $stream = [System.IO.File]::Open($temporaryPath, [System.IO.FileMode]::CreateNew)
    try { $icon.Save($stream) } finally { $stream.Dispose() }
    Move-Item -LiteralPath $temporaryPath -Destination $Destination -Force -ErrorAction Stop
  } finally {
    $icon.Dispose()
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

Assert-DreamSkinPort -Port $Port
$engine = Get-DreamSkinRuntimeEnginePaths -StateRoot $StateRoot
Assert-DreamSkinRuntimeTree -Path $engine.Root
$codex = Get-DreamSkinCodexInstall
$iconPath = Join-Path $StateRoot 'codex.ico'
Export-TokiCodexIcon -Executable $codex.Executable -Destination $iconPath

$shell = New-Object -ComObject WScript.Shell
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$taskbarPins = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
$portArgument = if ($PSBoundParameters.ContainsKey('Port')) { " -Port $Port" } else { '' }
$mainFile = '"Toki Codex\uff08\u98de\u9e1f\u9a6c\u65f6\uff09.lnk"' | ConvertFrom-Json
$trayFile = '"Toki Codex - \u4e3b\u9898\u63a7\u5236.lnk"' | ConvertFrom-Json
$restoreFile = '"Toki Codex - \u6062\u590d\u5b98\u65b9\u5916\u89c2.lnk"' | ConvertFrom-Json
$legacyFile = '"Toki Codex \u65e7\u7248\uff08app.asar \u56de\u9000\uff09.lnk"' | ConvertFrom-Json
$launchArguments = "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Start)`"$portArgument -PromptRestart"
$launchDescription = 'Launch the newest registered Microsoft Store Codex with the external Toki theme engine'

foreach ($folder in @($desktop, $startMenu)) {
  Remove-Item -LiteralPath (Join-Path $folder $legacyFile) -Force -ErrorAction SilentlyContinue
  Set-TokiManagedShortcut -Shell $shell -Path (Join-Path $folder $mainFile) `
    -TargetPath $powershell -Arguments $launchArguments -WorkingDirectory $engine.Root `
    -Description $launchDescription -IconPath $iconPath
}

# Only the primary launch shortcut belongs on the desktop.
Remove-Item -LiteralPath (Join-Path $desktop $trayFile) -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $desktop $restoreFile) -Force -ErrorAction SilentlyContinue

Set-TokiManagedShortcut -Shell $shell -Path (Join-Path $startMenu $trayFile) `
  -TargetPath $powershell `
  -Arguments "-NoProfile -STA -WindowStyle Minimized -ExecutionPolicy RemoteSigned -File `"$($engine.Tray)`"$portArgument" `
  -WorkingDirectory $engine.Root -Description 'Open the Toki Codex theme control tray' -IconPath $iconPath
Set-TokiManagedShortcut -Shell $shell -Path (Join-Path $startMenu $restoreFile) `
  -TargetPath $powershell `
  -Arguments "-NoProfile -ExecutionPolicy RemoteSigned -File `"$($engine.Restore)`"$portArgument -PromptRestart" `
  -WorkingDirectory $engine.Root -Description 'Remove the external Toki skin' -IconPath $iconPath

$chatGptShortcut = Join-Path $startMenu 'ChatGPT.lnk'
if (Test-Path -LiteralPath $chatGptShortcut -PathType Leaf) {
  Set-TokiManagedShortcut -Shell $shell -Path $chatGptShortcut -TargetPath $powershell `
    -Arguments $launchArguments -WorkingDirectory $engine.Root -Description $launchDescription -IconPath $iconPath
}

if (Test-Path -LiteralPath $taskbarPins -PathType Container) {
  foreach ($candidate in @(Get-ChildItem -LiteralPath $taskbarPins -Filter '*.lnk' -File -ErrorAction SilentlyContinue)) {
    try {
      $shortcut = $shell.CreateShortcut($candidate.FullName)
      $managed = "$($shortcut.Arguments)".IndexOf($engine.Start, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
      $retired = "$($shortcut.TargetPath)$($shortcut.Arguments)" -match '(?i)[\\/]TokiCodex[\\/]'
      if ($managed -or $retired) {
        Set-TokiManagedShortcut -Shell $shell -Path $candidate.FullName -TargetPath $powershell `
          -Arguments $launchArguments -WorkingDirectory $engine.Root -Description $launchDescription -IconPath $iconPath
      }
    } catch {
      Write-Warning "Could not repair pinned shortcut $($candidate.FullName): $($_.Exception.Message)"
    }
  }
}

$iconRefresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $iconRefresh -PathType Leaf) { & $iconRefresh -show | Out-Null }

Write-Host "Toki shortcuts now launch Codex $($codex.Version); the stable icon is $iconPath"
