# Starts the harness lab's web page: http://127.0.0.1:8000
# Ctrl+C (or stop.bat from another window) stops it.
#
#   .\start.ps1                       mock: real replies from `claude -p`, no API key
#   .\start.ps1 -Provider deepseek    DeepSeek (needs DEEPSEEK_API_KEY)
#   .\start.ps1 -Provider anthropic   the Anthropic API (needs ANTHROPIC_API_KEY)
#   .\start.ps1 -Real                 same as -Provider anthropic
#   .\start.ps1 -NoBrowser            don't open the browser
#   .\start.ps1 -NoBuild              don't rebuild the page, even if ui\ changed
param(
    [ValidateSet("mock", "anthropic", "deepseek")][string]$Provider = "mock",
    [switch]$Real,
    [switch]$NoBrowser,
    [switch]$NoBuild
)
if ($Real) { $Provider = "anthropic" }

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot   # so `-m harness...` finds the code
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUNBUFFERED = "1"

function Test-Port($port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect("127.0.0.1", $port); return $true } catch { return $false } finally { $client.Close() }
}

# First run: create the private Python environment and install what's needed
if (-not (Test-Path $python)) {
    Write-Host "Setting up .venv (first run only)..."
    python -m venv .venv
    & $python -m pip install -q -r requirements.txt
}

# The page is built from ui\ into harness\web\static (that build is kept in the repo, so Node.js
# is only needed if you change the page). Rebuild when a ui\ file is newer than the build.
$built = "harness\web\static\index.html"
if (-not $NoBuild -and (Test-Path "ui\package.json")) {
    $builtAt = if (Test-Path $built) { (Get-Item $built).LastWriteTime } else { [datetime]::MinValue }
    $newer = Get-ChildItem ui -Recurse -File |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.LastWriteTime -gt $builtAt } |
        Select-Object -First 1
    if ($newer) {
        if (Get-Command npm -ErrorAction SilentlyContinue) {
            Write-Host "Building the page (ui\ changed)..."
            Push-Location ui
            try {
                if (-not (Test-Path node_modules)) { npm install --no-fund --no-audit | Out-Host }
                npm run build | Out-Host
                if ($LASTEXITCODE -ne 0) { Write-Host "The page didn't build; starting with the last build." -ForegroundColor Yellow }
            } finally { Pop-Location }
        } elseif (-not (Test-Path $built)) {
            Write-Host "The page isn't built and npm wasn't found. Install Node.js, or run with the built page from git." -ForegroundColor Yellow
        }
    }
}

if (Test-Port 8000) {
    Write-Host "Port 8000 is already in use. Is the lab already running? (stop.bat stops it.)" -ForegroundColor Red
    exit 1
}

# Keys saved with setx only reach windows opened afterwards; read them directly so this one works too
foreach ($name in "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY") {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
        $saved = [Environment]::GetEnvironmentVariable($name, "User")
        if ($saved) { [Environment]::SetEnvironmentVariable($name, $saved) }
    }
}

$web = Start-Process $python -ArgumentList "-m", "harness.web.server", "--provider", $Provider -NoNewWindow -PassThru

try {
    # Wait up to 20 seconds for the web page to answer (it also starts the MCP servers)
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Port 8000)) {
        if ($web.HasExited -or (Get-Date) -gt $deadline) { throw "the web server did not start" }
        Start-Sleep -Milliseconds 300
    }

    Write-Host ""
    Write-Host "Harness lab is running. Ctrl+C here (or stop.bat) stops it." -ForegroundColor Green
    Write-Host "  Web page:  http://127.0.0.1:8000   (using: $Provider)"
    Write-Host "  Terminal version, in another window:  .venv\Scripts\python -m harness.cli --provider mock"
    Write-Host ""
    if (-not $NoBrowser) { Start-Process "http://127.0.0.1:8000" }

    while (-not $web.HasExited) { Start-Sleep -Milliseconds 500 }
    Write-Host "The web server stopped." -ForegroundColor Yellow
}
finally {
    # Stop the server and everything it started (MCP servers, claude -p calls)
    if (-not $web.HasExited) { taskkill /PID $web.Id /T /F | Out-Null }
    Write-Host "Stopped."
}
