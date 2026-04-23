@echo off
title YT Downloader Server
setlocal

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
cd /d "%~dp0"
node server.js
pause
