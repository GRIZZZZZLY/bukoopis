@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  BookForge nuclear fix + dev launcher
REM  Use when start.bat fails — kills node, clears caches, rebuilds
REM  native better-sqlite3, reinstalls deps, then launches dev.
REM ─────────────────────────────────────────────────────────────────────
setlocal
title BookForge fix-and-start
cd /d "%~dp0"

echo.
echo ============================================
echo  BookForge: fix-and-start
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

echo [1/6] Killing stale node.exe processes...
taskkill /f /im node.exe >nul 2>&1

echo [2/6] Removing Vite caches...
if exist "apps\web\node_modules\.vite" rmdir /s /q "apps\web\node_modules\.vite"
if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite"

echo [3/6] Reinstalling dependencies (no frozen lockfile)...
call pnpm install --no-frozen-lockfile
if errorlevel 1 (
  echo [ERROR] pnpm install failed.
  pause
  exit /b 1
)

echo [4/6] Rebuilding native better-sqlite3...
call pnpm rebuild better-sqlite3
REM ignore failure — pnpm rebuild may be a no-op on fresh installs

echo [5/6] Applying DB migrations...
call pnpm --filter @book-forge/server migrate
if errorlevel 1 (
  echo [WARN] Migrations failed. Continuing.
)

echo [6/6] Spawning server + web in separate windows...
start "BookForge SERVER (3001)" cmd /k "cd /d %CD% && pnpm --filter @book-forge/server dev"
start "BookForge WEB (5173)"    cmd /k "cd /d %CD% && pnpm --filter @book-forge/web dev"

echo.
echo ============================================
echo  Server: http://localhost:3001
echo  Web:    http://localhost:5173
echo  Open UI in 3-5 seconds.
echo ============================================
echo.
timeout /t 5 /nobreak >nul
endlocal
