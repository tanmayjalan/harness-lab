# Stops the harness lab's servers (web page, sandbox page, mock server, MCP demo server), and nothing else.
#
#   .\stop.ps1         stop them
#   .\stop.ps1 -List   only show what would be stopped
#
# A process counts as part of the lab only if BOTH are true:
#   1. it was started with this folder's own Python (.venv\Scripts\python.exe), and
#   2. it's running one of the lab's server programs.
# So other Python programs, other servers and anything using the same ports are never touched.
param([switch]$List)

$ErrorActionPreference = "Stop"
$venvPython = (Join-Path $PSScriptRoot ".venv\Scripts\python.exe").ToLower()
$programs = @(
    "harness.web.server", "harness.web.sandbox", "harness.core.mock_server", "demo_mcp_server.py",
    "web_ui.py", "mock_server.py"   # the same servers under their names before the folders were tidied
)

function Get-LabProcesses {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object {
        $cmd = "$($_.CommandLine)".ToLower()
        $cmd.Contains($venvPython) -and ($programs | Where-Object { $cmd.Contains($_.ToLower()) })
    }
}

$found = @(Get-LabProcesses)
if (-not $found) {
    Write-Host "No harness lab servers are running."
    exit 0
}

# Stop only the top of each group: stopping a process with /T also stops what it started
# (the .venv launcher's real Python, MCP servers, claude -p calls)
$ids = $found.ProcessId
$top = @($found | Where-Object { $ids -notcontains $_.ParentProcessId })

Write-Host "Harness lab servers found:"
foreach ($p in $found) {
    $what = ($programs | Where-Object { "$($p.CommandLine)".ToLower().Contains($_.ToLower()) } | Select-Object -First 1)
    $role = if ($ids -contains $p.ParentProcessId) { "  (started by $($p.ParentProcessId))" } else { "" }
    Write-Host ("  PID {0,6}  {1:HH:mm:ss}  {2}{3}" -f $p.ProcessId, $p.CreationDate, $what, $role)
}

if ($List) {
    Write-Host "(-List: nothing was stopped)"
    exit 0
}

foreach ($p in $top) {
    taskkill /PID $p.ProcessId /T /F 2>$null | Out-Null
}
Start-Sleep -Milliseconds 800

$left = @(Get-LabProcesses)
if ($left) {
    Write-Host "Some couldn't be stopped: $($left.ProcessId -join ', ')" -ForegroundColor Red
    exit 1
}
Write-Host "Stopped $($found.Count) process(es)." -ForegroundColor Green
