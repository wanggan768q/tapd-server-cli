@echo off
REM ===================================================================
REM  tapd-server-cli release launcher (Windows, double-click)
REM
REM  Double-click to run release flow:
REM    - cd to project root (parent of this script)
REM    - delegate to publish.ps1 (real release logic)
REM    - pause on exit so window stays open for inspection
REM
REM  PowerShell required (built-in since Windows 7).
REM  Fallback if PS is locked down: open terminal, run
REM    node scripts\publish.mjs
REM ===================================================================

REM Force UTF-8 code page so Chinese in publish.mjs output renders correctly
chcp 65001 >nul

REM cd to project root (parent of this .bat file)
cd /d "%~dp0\.."

REM Run publish.ps1, bypassing ExecutionPolicy
REM -NoProfile = skip user PS profile (faster, deterministic)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish.ps1"

REM Keep window open for both success and failure
echo.
echo ===============================================
echo  Press any key to close this window
echo ===============================================
pause >nul
