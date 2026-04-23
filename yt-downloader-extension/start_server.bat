@echo off
title YT Downloader Server
setlocal

:: Ensure we are in the script's directory
cd /d "%~dp0"

echo --------------------------------------------------
echo Running Setup Check...
echo --------------------------------------------------
powershell -ExecutionPolicy Bypass -File setup.ps1

if %errorlevel% neq 0 (
    echo ERROR: Setup failed.
    pause
    exit /b
)

echo Starting Local Server...
echo --------------------------------------------------
node server.js
pause
