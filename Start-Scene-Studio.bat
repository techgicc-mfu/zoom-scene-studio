@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   Zoom MS-50G Scene Studio - Desktop Configurator
echo ========================================================

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m firmware.scene_zdl.build_zdl
    ".venv\Scripts\python.exe" -m firmware.midistomp_patch.generate_patches
)

if not exist "app\node_modules" (
    echo Installing Scene Studio UI dependencies...
    call npm --prefix app install
)

echo Starting Scene Studio local server on http://127.0.0.1:5173 ...
start "SceneStudioServer" /min cmd /c "npm --prefix app run dev -- --host 127.0.0.1 --port 5173"

timeout /t 2 /nobreak >nul

where msedge >nul 2>nul
if %errorlevel%==0 (
    start "" msedge --app=http://127.0.0.1:5173
    goto :eof
)

where chrome >nul 2>nul
if %errorlevel%==0 (
    start "" chrome --app=http://127.0.0.1:5173
    goto :eof
)

start "" http://127.0.0.1:5173
