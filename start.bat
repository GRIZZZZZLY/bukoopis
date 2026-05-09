@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  BookForge dev launcher — double-click to start
REM  Spawns server and web in TWO separate windows so each survives
REM  independently and you can close one without killing the other.
REM ─────────────────────────────────────────────────────────────────────
setlocal
title BookForge launcher
cd /d "%~dp0"

echo.
echo ============================================
echo  BookForge dev launcher
echo  root: %CD%
echo ============================================
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] pnpm not found in PATH.
  echo Install pnpm:  npm install -g pnpm
  pause
  exit /b 1
)

REM Clean stale Vite optimize cache (cheap; avoids dep-XXX.js missing error
REM after a re-install).
if exist "apps\web\node_modules\.vite" (
  echo Cleaning apps\web\node_modules\.vite ...
  rmdir /s /q "apps\web\node_modules\.vite"
)

echo.
echo Applying DB migrations...
call pnpm --filter @book-forge/server migrate
if errorlevel 1 (
  echo [WARN] Migrations failed. If dev fails too, run fix-and-start.bat.
)

echo.
echo Spawning server window (port 3001)...
start "BookForge SERVER (3001)" cmd /k "cd /d %CD% && pnpm --filter @book-forge/server dev"

echo Spawning web window (port 5173)...
start "BookForge WEB (5173)" cmd /k "cd /d %CD% && pnpm --filter @book-forge/web dev"

echo.
echo ============================================
echo  Both processes are starting in separate windows.
echo  Server: http://localhost:3001  (API)
echo  Web:    http://localhost:5173  (UI)
echo.
echo  Wait ~3-5 seconds, then open the UI:
echo    http://localhost:5173
echo.
echo  To stop: close each window (or Ctrl+C inside).
echo ============================================
echo.
echo This launcher window will close in 5 seconds.
timeout /t 5 /nobreak >nul
endlocal
