[CmdletBinding()]
param(
  [string]$PackagePath,
  [string]$PetsRoot,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'pet-package-windows.ps1')

if (-not $PackagePath) {
  $PackagePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'pets\toki-bunny\package'
}
$PackagePath = [System.IO.Path]::GetFullPath($PackagePath)
$manifest = Invoke-DreamSkinPetPackageValidation -PackagePath $PackagePath

if ($ValidateOnly) {
  Write-Host "Validated Codex pet '$($manifest.displayName)' ($($manifest.atlas.width)x$($manifest.atlas.height), v$($manifest.spriteVersionNumber))."
  return $manifest
}

# Always use the transactional replacement path. It is safe for both the first
# install and repeat deployment of the same bundled package.
$result = Install-DreamSkinPetPackage -PackagePath $PackagePath -PetsRoot $PetsRoot -Replace
$verb = if ($result.Replaced) { 'Installed or updated' } else { 'Installed' }
Write-Host "$verb Codex pet '$($result.DisplayName)' at $($result.Path)"
Write-Host 'Codex configuration was not changed. Open Settings > Pets, choose Refresh, then select Toki Bunny.'
return $result
