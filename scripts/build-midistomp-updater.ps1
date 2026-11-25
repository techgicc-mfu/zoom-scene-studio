<#
.SYNOPSIS
  Builds dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe combining upstream MIDISTOMP V2.0
  with Zoom Scene Studio's 3 firmware patches (rig-wrap-12, no-scene-autosave, scene-engine).
.PARAMETER UpdaterPath
  Optional path to Zoom's official "ZOOM MS-70CDR v2.10 Updater.exe".
  If omitted, searches the repo folder, Downloads, and Desktop automatically.
#>
param(
    [string]$UpdaterPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Resolve-ZoomUpdater([string]$ExplicitPath) {
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
        return (Resolve-Path $ExplicitPath).Path
    }
    $SearchDirs = @(
        $RepoRoot,
        (Join-Path $RepoRoot "dist"),
        (Join-Path $env:USERPROFILE "Downloads"),
        (Join-Path $env:USERPROFILE "Desktop")
    )
    foreach ($Dir in $SearchDirs) {
        if (-not (Test-Path $Dir)) { continue }
        $Hit = Get-ChildItem -Path $Dir -Filter "*70CDR*2.10*.exe" -File -Recurse -Depth 2 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Hit) { return $Hit.FullName }
    }
    return $null
}

$ZoomExe = Resolve-ZoomUpdater $UpdaterPath
if (-not $ZoomExe) {
    Write-Host "`n[!] Could not find 'ZOOM MS-70CDR v2.10 Updater.exe'." -ForegroundColor Yellow
    Write-Host "    1. Download ZOOM MS-70CDR v2.10 Updater from:"
    Write-Host "       https://zoomcorp.com/en/us/multi-effects/multistomp-pedals/ms-70cdr/ms-70cdr-support/"
    Write-Host "    2. Extract the .exe into your Downloads folder (or drag it onto Build-Scene-Updater.bat)."
    exit 1
}

Write-Host "=== [1/4] Preparing Python environment ===" -ForegroundColor Cyan
$VenvPy = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
    python -m venv (Join-Path $RepoRoot ".venv")
}
$ZoommsExe = Join-Path $RepoRoot ".venv\Scripts\zoomms.exe"

Write-Host "=== [2/4] Syncing upstream MIDISTOMP V2.0 tools ===" -ForegroundColor Cyan
$CacheRoot = Join-Path $RepoRoot ".cache"
$MidistompDir = Join-Path $CacheRoot "zoom-ms-midistomp"
New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
if (-not (Test-Path (Join-Path $MidistompDir ".git"))) {
    git clone --depth 1 https://github.com/matujuice/zoom-ms-midistomp.git $MidistompDir
} else {
    git -C $MidistompDir pull --ff-only
}
if (-not (Test-Path $ZoommsExe)) {
    & $VenvPy -m pip install --quiet -e $MidistompDir
}

Write-Host "=== [3/4] Generating SCENE.ZDL and Scene Studio patches ===" -ForegroundColor Cyan
& (Join-Path $RepoRoot "scripts\build-firmware.ps1")

Write-Host "`n=== [4/4] Building MIDISTOMP V2.0 + Scene Studio Updater ===" -ForegroundColor Cyan
$MidistompPatchNames = @(
    "version-2.0", "boot-logo", "midi-cc", "midi-clock", "midi-settings",
    "tempo-hold", "scroll", "looper", "mixer-m2", "diag", "dsp-limit",
    "fx-category", "pc-force-reload", "sysex-fx-slots", "identity-tag"
)

$PatchArgs = @()
foreach ($Name in $MidistompPatchNames) {
    $YamlPath = Join-Path $MidistompDir "patches\$Name.yaml"
    if (-not (Test-Path $YamlPath)) {
        throw "Missing MIDISTOMP patch file: $YamlPath"
    }
    $PatchArgs += @("--patch", $YamlPath)
}

foreach ($ScenePatch in @("rig-wrap-12.yaml", "no-scene-autosave.yaml", "scene-engine.yaml")) {
    $PatchArgs += @("--patch", (Join-Path $RepoRoot "dist\patches\$ScenePatch"))
}

$OutExe = Join-Path $RepoRoot "dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe"
& $ZoommsExe build $ZoomExe `
    --build-id ms70cdr-2.10 `
    --out $OutExe `
    --stamp "version=V2.0.4.1" `
    --stamp "label=SCENE-STUDIO" `
    @PatchArgs

if ($LASTEXITCODE -ne 0) {
    throw "zoomms build failed with exit code $LASTEXITCODE"
}

Write-Host "`n=== READY TO FLASH ===" -ForegroundColor Green
Write-Host "  Updater .exe : $OutExe"
Write-Host "  Effect .ZDL  : $RepoRoot\dist\SCENE.ZDL"
Write-Host "`nFlash steps (one-time):"
Write-Host "  1. Unplug/power off your MS-50G."
Write-Host "  2. Hold UP + DOWN around the footswitch while plugging in Mini-USB."
Write-Host "  3. Run dist\MIDISTOMP-V2.0-Scene-Studio-Updater.exe (More info -> Run anyway)."
Write-Host "  4. Reboot pedal -> MENU -> SETTINGS -> INPUT -> MONO."
Write-Host "  5. In normal USB mode, inject dist\SCENE.ZDL via Zoom Effect Manager."
