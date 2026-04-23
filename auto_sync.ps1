$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $PSScriptRoot
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$lastChange = Get-Date
$debounceTime = 5 # seconds

Write-Host "Auto-Sync started! Watching for changes in: $PSScriptRoot"
Write-Host "Press Ctrl+C to stop."

$action = {
    $path = $Event.SourceEventArgs.FullPath
    if ($path -notmatch "\\.git\\" -and $path -notmatch "node_modules") {
        $global:lastChange = Get-Date
        $global:syncNeeded = $true
    }
}

Register-ObjectEvent $watcher "Changed" -Action $action
Register-ObjectEvent $watcher "Created" -Action $action
Register-ObjectEvent $watcher "Deleted" -Action $action
Register-ObjectEvent $watcher "Renamed" -Action $action

$global:syncNeeded = $false

while($true) {
    if ($global:syncNeeded -and (New-TimeSpan -Start $global:lastChange -End (Get-Date)).TotalSeconds -gt $debounceTime) {
        $global:syncNeeded = $false
        Write-Host "Changes detected. Syncing to GitHub..."
        git add .
        git commit -m "Auto-sync: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git push origin main
        Write-Host "Sync complete! Waiting for next change..."
    }
    Start-Sleep -Seconds 1
}
