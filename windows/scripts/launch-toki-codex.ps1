[CmdletBinding()]
param(
  [int]$Port = 9335
)

$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:LOCALAPPDATA 'CodexDreamSkin'
$statePath = Join-Path $stateRoot 'state.json'
$startScript = Join-Path $PSScriptRoot 'start-dream-skin.ps1'
$errorLog = Join-Path $stateRoot 'launcher-error.log'

function Get-TokiLauncherState {
  if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) { return $null }
  try { return Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return $null }
}

function Test-TokiInjector {
  param([Parameter(Mandatory = $true)]$State)

  if (-not $State.injectorPid -or -not $State.injectorPath -or -not $State.nodePath) { return $false }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$State.injectorPid)" -ErrorAction SilentlyContinue
  if ($null -eq $process -or -not $process.CommandLine -or -not $process.ExecutablePath) { return $false }

  $nodeMatches = [System.IO.Path]::GetFullPath("$($process.ExecutablePath)") -ieq
    [System.IO.Path]::GetFullPath("$($State.nodePath)")
  $injectorMatches = $process.CommandLine -match [regex]::Escape("$($State.injectorPath)")
  $portMatches = $process.CommandLine -match "(?:^|\s)--port\s+$([regex]::Escape("$Port"))(?:\s|$)"
  return [bool]($nodeMatches -and $injectorMatches -and $portMatches)
}

function Test-TokiEndpoint {
  param([Parameter(Mandatory = $true)]$State)

  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    $targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2)
    $browserMatches = -not $State.browserId -or
      "$($version.webSocketDebuggerUrl)" -match [regex]::Escape("$($State.browserId)")
    $mainTarget = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like 'app://*' } | Select-Object -First 1
    return [bool]($browserMatches -and $null -ne $mainTarget)
  } catch {
    return $false
  }
}

function Show-TokiCodexWindow {
  $windowProcess = Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
  if ($null -eq $windowProcess) { return $false }

  try {
    $shell = New-Object -ComObject WScript.Shell
    return [bool]$shell.AppActivate($windowProcess.Id)
  } catch {
    return $false
  }
}

function Confirm-TokiRestart {
  Add-Type -AssemblyName PresentationFramework
  $choice = [System.Windows.MessageBox]::Show(
    'Codex is already open without the Toki skin. Restart it now to enable the skin?',
    'Toki Codex',
    [System.Windows.MessageBoxButton]::YesNo,
    [System.Windows.MessageBoxImage]::Question)
  return $choice -eq [System.Windows.MessageBoxResult]::Yes
}

try {
  $state = Get-TokiLauncherState
  if ($null -ne $state -and [int]$state.port -eq $Port -and
    (Test-TokiInjector -State $state) -and (Test-TokiEndpoint -State $state)) {
    [void](Show-TokiCodexWindow)
    exit 0
  }

  $codexIsOpen = $null -ne (Get-Process -Name 'ChatGPT' -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($codexIsOpen -and -not (Confirm-TokiRestart)) { exit 0 }

  & $startScript -Port $Port -RestartExisting
  if ($LASTEXITCODE -ne 0) { throw "Dream Skin startup returned exit code $LASTEXITCODE." }
  [void](Show-TokiCodexWindow)
} catch {
  New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
  $message = "$(Get-Date -Format o)`r`n$($_ | Out-String)"
  [System.IO.File]::WriteAllText($errorLog, $message, [System.Text.UTF8Encoding]::new($false))
  try {
    Add-Type -AssemblyName PresentationFramework
    [void][System.Windows.MessageBox]::Show(
      "Toki Codex could not start. Details were saved to:`n$errorLog",
      'Toki Codex',
      [System.Windows.MessageBoxButton]::OK,
      [System.Windows.MessageBoxImage]::Error)
  } catch {}
  exit 1
}
