<#
.SYNOPSIS
  Builds SCENE.ZDL and generates the MIDISTOMP V2.0 Scene Studio firmware patches for Zoom MS-50G.
#>
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$PythonExe = if (Test-Path "$RepoRoot\.venv\Scripts\python.exe") {
    "$RepoRoot\.venv\Scripts\python.exe"
} else {
    "python"
}

Write-Host "=== [1/3] Building dist\SCENE.ZDL (fxid 0x0195) ===" -ForegroundColor Cyan
$Cl6x = "C:\ti\ccs\tools\compiler\ti-cgt-c6000_8.5.0.LTS\bin\cl6x.exe"
if (Test-Path $Cl6x) {
    Write-Host "Found TI C6000 compiler at $Cl6x" -ForegroundColor Green
} else {
    Write-Host "TI cl6x not found at default path; using verified pre-assembled C6740 audio stub." -ForegroundColor Yellow
}
& $PythonExe -m firmware.scene_zdl.build_zdl

Write-Host "`n=== [2/3] Generating MIDISTOMP V2.0 Scene Engine Patches ===" -ForegroundColor Cyan
& $PythonExe -m firmware.midistomp_patch.generate_patches

Write-Host "`n=== [3/3] Firmware Artifacts Ready ===" -ForegroundColor Green
Write-Host "  - Effect Module : $RepoRoot\dist\SCENE.ZDL"
Write-Host "  - OS Patches    : $RepoRoot\dist\patches\rig-wrap-12.yaml, no-scene-autosave.yaml, scene-engine.yaml"
Write-Host "`nNext One-Time Hardware Step:"
Write-Host "  1. Build your MIDISTOMP V2.0 updater with zoomms including dist\patches\*.yaml (or run MIDISTOMP-builder)."
Write-Host "  2. Hold UP + DOWN on your MS-50G while plugging in USB to flash the OS once."
Write-Host "  3. Inject dist\SCENE.ZDL via Zoom Effect Manager, then launch Start-Scene-Studio.bat!"
