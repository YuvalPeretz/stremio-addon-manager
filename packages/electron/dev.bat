@echo off
REM Development startup script for Electron app (Windows)

echo Starting Stremio Addon Manager in development mode...
echo.

REM CRITICAL: Build renderer first so preload script works
echo Building renderer for preload script compatibility...
call npm run build:renderer
if %errorlevel% neq 0 (
    echo [ERROR] Failed to build renderer. Preload script will not work.
    exit /b 1
)
echo [OK] Renderer built successfully
echo.

REM Kill any existing processes on port 3000
echo Checking for existing processes on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1

REM Start Vite dev server in background (for hot reloading - optional)
echo Starting Vite dev server for hot reloading...
start /B cmd /c "npm run dev:renderer > vite.log 2>&1"

REM Wait for Vite to start
echo Waiting for Vite to start...
timeout /t 3 /nobreak >nul

REM Set environment for development
set NODE_ENV=development

REM Start Electron (will load from built file, not dev server)
echo Starting Electron...
echo NOTE: Electron will load from built file. Rebuild renderer after code changes.
npm start

