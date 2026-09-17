@echo off
title Umbra Domus - Stage 1 deploy
cd /d "%~dp0"

echo ============================================================
echo   UMBRA DOMUS - STAGE 1 DEPLOY
echo ============================================================
echo.
echo   Step one is the Cloudflare sign-in. A browser tab opens.
echo   Click Allow in it, then come back here. Nothing else.
echo.
echo ============================================================
echo.

if not exist "%~dp0node_modules\wrangler\bin\wrangler.js" (
  echo   Fetching what the Worker needs, about a minute...
  call npm install --no-fund --no-audit
)

echo.
echo --- signing in to Cloudflare -------------------------------
node "%~dp0node_modules\wrangler\bin\wrangler.js" login
echo.
echo --- checking the sign-in -----------------------------------
node "%~dp0node_modules\wrangler\bin\wrangler.js" whoami
echo.
echo ============================================================
echo   Now the deploy. This runs by itself.
echo ============================================================
echo.

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-stage-1.ps1"
set "RC=%ERRORLEVEL%"

echo.
echo ============================================================
if "%RC%"=="0" (
  echo   FINISHED. The write-up is in worker\DEPLOY-RESULT.md
) else (
  echo   IT STOPPED. The reason is in worker\DEPLOY-RESULT.md
)
echo ============================================================
echo.
pause >nul
