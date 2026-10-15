# Starts the harness lab's web page: http://127.0.0.1:8000
# Ctrl+C (or stop.bat from another window) stops it.
#
#   .\scripts\start.ps1                       mock: real replies from `claude -p`, no API key
#   .\scripts\start.ps1 -Provider deepseek    DeepSeek (needs DEEPSEEK_API_KEY)
#   .\scripts\start.ps1 -Provider anthropic   the Anthropic API (needs ANTHROPIC_API_KEY)
#   .\scripts\start.ps1 -Provider ollama      a model in Ollama, on its usual address (also lmstudio, custom;
#                                             change the address in Settings → Model). Not running: starts with the mock
#   .\scripts\start.ps1 -Real                 same as -Provider anthropic
#   .\scripts\start.ps1 -NoBrowser            don't open the browser
#   .\scripts\start.ps1 -NoBuild              don't rebuild the page, even if ui\ changed
#   .\scripts\start.ps1 -NoCheck              don't check claude -p first (the mock only)
#   .\scripts\start.ps1 -Fresh                a throwaway copy: no saved Memory, settings or conversations, and
#                                             nothing it does reaches data\, config\ or workspace\ (for workshops)
param(
    [ValidateSet("mock", "anthropic", "deepseek", "ollama", "lmstudio", "custom")][string]$Provider = "mock",
    [switch]$Real,
    [switch]$NoBrowser,
    [switch]$NoBuild,
    [switch]$NoCheck,
    [switch]$Fresh
)
if ($Real) { $Provider = "anthropic" }

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot   # the Harness folder (this script lives in scripts\)
Set-Location $Root   # so `-m harness...` finds the code
$python = Join-Path $Root ".venv\Scripts\python.exe"
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

# The mock replies through claude -p on your Claude Code sign-in. Check that once, so an expired sign-in shows
# here, in plain words, instead of as an error on your first message (a few seconds and a little of your plan)
if ($Provider -eq "mock" -and -not $NoCheck) {
    Write-Host "Checking claude -p (one small call; -NoCheck skips this)..."
    $said = & $python -m harness.core.mock_server --check | Out-String  # (it prints its result, also on failure)
    if ($LASTEXITCODE -ne 0) {
        Write-Host $said.Trim() -ForegroundColor Red
        Write-Host "The mock can't reply yet. If that's about signing in: run claude once in a terminal and sign in," -ForegroundColor Yellow
        Write-Host "then start the lab again. (Or start.bat -Provider anthropic / deepseek with an API key.)" -ForegroundColor Yellow
        exit 1
    }
}

# Keys saved with setx only reach windows opened afterwards; read them directly so this one works too
foreach ($name in "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "LOCAL_API_KEY") {
    if (-not [Environment]::GetEnvironmentVariable($name)) {
        $saved = [Environment]::GetEnvironmentVariable($name, "User")
        if ($saved) { [Environment]::SetEnvironmentVariable($name, $saved) }
    }
}

# -Fresh: the same page from a throwaway copy (harness\web\sandbox.py). It starts with no saved data and copies
# workspace\ and config\ as they are now, so restore the sample files first if an experiment changed them
if ($Fresh) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        # (a copy downloaded as a ZIP isn't a git folder: then there's nothing to compare with, and no warning)
        $changed = try { git status --porcelain -- workspace 2>$null } catch { $null }
        if ($LASTEXITCODE -eq 0 -and $changed) {
            Write-Host "Some sample files in workspace\ have changed, and the fresh copy will start with them:" -ForegroundColor Yellow
            Write-Host ($changed | Out-String).TrimEnd()
            Write-Host "To start from the sample files instead: press Ctrl+C, run  git checkout -- workspace , delete any new files listed (??), then start again." -ForegroundColor Yellow
        }
    }
    $module = "-m", "harness.web.sandbox", "--empty", "--port", "8000"
} else {
    $module = "-m", "harness.web.server"
}
$web = Start-Process $python -ArgumentList ($module + "--provider", $Provider) -NoNewWindow -PassThru

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
    if ($Fresh) {
        Write-Host "  A throwaway copy: nothing you do here reaches data\, config\ or workspace\."
        Write-Host "  Progress kept by the browser (ticks, explanations seen, quiz) stays: Settings -> Display -> Start over as a new learner."
    }
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
