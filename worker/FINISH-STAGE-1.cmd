@echo off
title UMBRA - FINISH STAGE 1
cd /d "%~dp0"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0finish-stage-1.ps1"
echo.
echo ============================================================
echo   Done. Summary is in worker\FINISH-RESULT.txt
echo ============================================================
timeout /t 5 >nul
