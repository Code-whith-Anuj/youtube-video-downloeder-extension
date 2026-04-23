@echo off
setlocal enabledelayedexpansion

echo ======================================================
echo    YouTube Downloader Suite - Automatic Setup
echo ======================================================
echo.

:: Check for Winget
winget --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 'winget' not found. Please install Windows Package Manager
    echo or install Node.js, yt-dlp, and FFmpeg manually.
    pause
    exit /b
)

echo [1/4] Installing Node.js (LTS)...
winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 echo [INFO] Node.js might already be installed or had an issue.

echo [2/4] Installing yt-dlp...
winget install yt-dlp.yt-dlp --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 echo [INFO] yt-dlp might already be installed or had an issue.

echo [3/4] Installing FFmpeg...
winget install Gyan.FFmpeg --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 echo [INFO] FFmpeg might already be installed or had an issue.

echo [4/4] Installing project dependencies...
cd /d "%~dp0yt-downloader-extension"
call npm install

echo.
echo ======================================================
echo    SETUP COMPLETE!
echo ======================================================
echo  1. Restart your PC (or terminal) to apply PATH changes.
echo  2. Run 'start_server.bat' in the extension folder.
echo  3. Load the extension in Chrome (Developer Mode).
echo ======================================================
pause
