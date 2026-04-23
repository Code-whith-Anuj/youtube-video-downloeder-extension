# yt-downloader-extension - Setup Script
# Automates dependency checks and downloads for Windows

$ProjectRoot = Get-Location
$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$YtDlpLocalPath = Join-Path $ProjectRoot "yt-dlp.exe"

Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "✅ Dependencies checked." -ForegroundColor Green

# ── Register Custom Protocol for Auto-Start ──
Write-Host "`nRegistering 'yt-down://' protocol for auto-start..."
$ProtocolName = "yt-down"
$BatPath = Join-Path $ProjectRoot "start_server.bat"
$RegPath = "HKCU:\Software\Classes\$ProtocolName"

try {
    if (-not (Test-Path $RegPath)) {
        New-Item -Path $RegPath -Force | Out-Null
    }
    Set-ItemProperty -Path $RegPath -Name "(Default)" -Value "URL:YT Downloader Protocol"
    Set-ItemProperty -Path $RegPath -Name "URL Protocol" -Value ""
    
    $CommandPath = "$RegPath\shell\open\command"
    if (-not (Test-Path $CommandPath)) {
        New-Item -Path $CommandPath -Force | Out-Null
    }
    Set-ItemProperty -Path $CommandPath -Name "(Default)" -Value "cmd /c `"$BatPath`""
    Write-Host "✅ Protocol 'yt-down://' registered successfully!" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Could not register protocol (Permission denied or Registry locked)." -ForegroundColor Yellow
}

Write-Host "`n--------------------------------------------------" -ForegroundColor Cyan

# 1. Check Node.js
Write-Host "[1/3] Checking Node.js..." -NoNewline
try {
    $nodeVer = node -v
    Write-Host " OK ($nodeVer)" -ForegroundColor Green
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host "Error: Node.js is not installed. Please install it from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 2. Check yt-dlp
Write-Host "[2/3] Checking yt-dlp..." -NoNewline
$ytdlpExists = Get-Command yt-dlp -ErrorAction SilentlyContinue
if ($ytdlpExists) {
    Write-Host " OK (Found in PATH)" -ForegroundColor Green
} elseif (Test-Path $YtDlpLocalPath) {
    Write-Host " OK (Found locally)" -ForegroundColor Green
} else {
    Write-Host " MISSING" -ForegroundColor Yellow
    Write-Host "Attempting to download yt-dlp.exe..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $YtDlpUrl -OutFile $YtDlpLocalPath -ErrorAction Stop
        Write-Host "✅ Successfully downloaded yt-dlp.exe" -ForegroundColor Green
    } catch {
        Write-Host "❌ Failed to download yt-dlp.exe automatically." -ForegroundColor Red
        Write-Host "Please download it manually from: $YtDlpUrl" -ForegroundColor Yellow
        Write-Host "and place it in: $ProjectRoot" -ForegroundColor Yellow
    }
}

# 3. Check FFmpeg
Write-Host "[3/3] Checking ffmpeg..." -NoNewline
$ffmpegExists = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffmpegLocal = Test-Path (Join-Path $ProjectRoot "ffmpeg.exe")

if ($ffmpegExists) {
    Write-Host " OK (Found in PATH)" -ForegroundColor Green
} elseif ($ffmpegLocal) {
    Write-Host " OK (Found locally)" -ForegroundColor Green
} else {
    Write-Host " WARNING" -ForegroundColor Yellow
    Write-Host "Note: ffmpeg is recommended for merging high-quality video and audio." -ForegroundColor Gray
    Write-Host "You can download it from https://ffmpeg.org/download.html" -ForegroundColor Gray
}

Write-Host "--------------------------------------------------" -ForegroundColor Cyan
Write-Host "Setup Complete! You can now start the server." -ForegroundColor Green
Write-Host "--------------------------------------------------`n"
