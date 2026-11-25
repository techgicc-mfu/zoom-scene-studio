@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo   Zoom MS-50G Scene Studio - Custom Firmware Updater Builder
echo ============================================================
echo.
if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-midistomp-updater.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-midistomp-updater.ps1" -UpdaterPath "%~1"
)
echo.
pause
