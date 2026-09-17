@echo off
title Umbra Domus - Stage 1 deploy
setlocal
cd /d "%~dp0"

echo ============================================================
echo   UMBRA DOMUS - STAGE 1 DEPLOY
echo ============================================================
echo.
echo   This puts the intake Worker live on your Cloudflare account
echo   and switches the website's request form over to it.
echo.
echo   YOU HAVE TO DO ONE THING: when a browser tab opens and asks
echo   for permission, click Allow, then come back to this window.
echo.
echo   If this window ever asks you a yes/no question, the answer
echo   is  y  followed by Enter.
echo.
echo   Nothing here deletes anything. It is safe to run again if it
echo   stops partway - it picks up where it left off.
echo.
echo ============================================================
echo.

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-stage-1.ps1"
set "RC=%ERRORLEVEL%"

echo.
echo ============================================================
if "%RC%"=="0" (
  echo   FINISHED. The full write-up is in worker\DEPLOY-RESULT.md
) else (
  echo   IT STOPPED. The reason is in worker\DEPLOY-RESULT.md
  echo   Nothing is broken. Read that file, or send it to Claude.
)
echo ============================================================
echo.
echo Press any key to close this window.
pause >nul
endlocal
