# Gets the harness lab ready, and checks that it is: run it once before start.bat, or any time
# something doesn't work. It can be run again safely; it only changes what's missing.
#
#   .\scripts\setup.ps1           set up and check everything, and offer to save your API keys
#   .\scripts\setup.ps1 -Check    only report: change nothing, ask nothing
#   .\scripts\setup.ps1 -Quick    skip the checks that call a service (claude -p and the key tests)
#
# What it looks at:
#   1. Python 3.10+, the lab's own Python environment (.venv) and its packages
#   2. Claude Code (`claude`): installed, and one small `claude -p` call, made exactly as the mock makes them
#   3. API keys (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY): only for -Provider anthropic / deepseek; the mock needs none.
#      A key you type isn't shown, and is saved for your Windows user (where `setx` saves it), never in a file.
#   4. Ollama and LM Studio (optional: free models on your computer), Node.js (only needed to change the page)
#      and the port the lab uses (8000)
param(
    [switch]$Check,
    [switch]$Quick
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot   # the Harness folder (this script lives in scripts\)
Set-Location $Root
$python = Join-Path $Root ".venv\Scripts\python.exe"
$env:PYTHONIOENCODING = "utf-8"
# Ask questions only if someone can answer them (not with -Check, nor when run by another program)
$canAsk = -not $Check -and -not [Console]::IsInputRedirected

$results = New-Object System.Collections.Generic.List[object]
function Add-Result($name, $state, $note) {
    $results.Add([pscustomobject]@{ Check = $name; State = $state; Note = $note })
    $color = @{ ok = "Green"; missing = "Yellow"; warning = "Yellow"; failed = "Red"; skipped = "DarkGray" }[$state]
    Write-Host ("  {0,-8} {1}: {2}" -f $state, $name, $note) -ForegroundColor $color
}

# A program's output and error messages, as one line of text; $LASTEXITCODE says how it ended.
# (Windows PowerShell treats a program's error messages as script errors, which "Stop" above would
# turn into a crash; here they're just text to show.)
function Invoke-Program($program, [string[]]$arguments) {
    $ErrorActionPreference = "Continue"
    $lines = & $program @arguments 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ }
    return ($lines -join " ")
}

function Test-Port($port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect("127.0.0.1", $port); return $true } catch { return $false } finally { $client.Close() }
}

# A Python 3.10+ to make .venv with. Each candidate is asked its version, so the Microsoft Store
# placeholder python.exe (which only says "Python was not found") is passed over.
function Find-Python {
    foreach ($cmd in @(Get-Command python, python3, py -All -ErrorAction SilentlyContinue)) {
        try {
            $version = & $cmd.Source -c "import sys; print('%d.%d.%d' % sys.version_info[:3])" 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -and [version]$version -ge [version]"3.10") {
                return @{ Path = $cmd.Source; Version = $version }
            }
        } catch { }
    }
    return $null
}

# ---------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "1. Python" -ForegroundColor Cyan
$pythonOk = $false
if (Test-Path $python) {
    $version = & $python -c "import sys; print('%d.%d.%d' % sys.version_info[:3])"
    Add-Result "Python" "ok" ".venv is there (Python $version)"
    $pythonOk = $true
} else {
    $found = Find-Python
    if (-not $found) {
        Add-Result "Python" "missing" "No Python 3.10 or newer found. Install it from python.org (tick 'Add python.exe to PATH'), then run setup.bat again."
    } elseif ($Check) {
        Add-Result "Python" "missing" ".venv isn't made yet (Python $($found.Version) found). Run setup.bat to make it."
    } else {
        Write-Host "  Making .venv with Python $($found.Version)..."
        & $found.Path -m venv .venv
        if ($LASTEXITCODE -eq 0 -and (Test-Path $python)) {
            Add-Result "Python" "ok" ".venv made (Python $($found.Version))"
            $pythonOk = $true
        } else {
            Add-Result "Python" "failed" "Couldn't make .venv with $($found.Path)"
        }
    }
}

if ($pythonOk) {
    # anthropic is needed; tzdata for get_current_time; mcp only for tools from MCP servers
    $packages = { & $python -c "import importlib.util as u; print(' '.join(n for n in ('anthropic', 'tzdata', 'mcp') if not u.find_spec(n)))" }
    $missing = "$(& $packages)".Trim()
    if ($missing -and -not $Check) {
        Write-Host "  Installing the packages in requirements.txt (missing: $missing)..."
        & $python -m pip install -q -r requirements.txt | Out-Host
        $missing = "$(& $packages)".Trim()
    }
    if (-not $missing) {
        Add-Result "Packages" "ok" "anthropic, tzdata and mcp are installed"
    } elseif ($Check) {
        Add-Result "Packages" "missing" "Not installed: $missing. Run setup.bat to install them."
    } else {
        Add-Result "Packages" "failed" "Still not installed: $missing. Try: .venv\Scripts\python -m pip install -r requirements.txt"
    }
}

# ---------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "2. Claude Code (for the mock: real replies from claude -p, no API key)" -ForegroundColor Cyan
$claude = Get-Command claude -ErrorAction SilentlyContinue
$claudeOk = $false
if (-not $claude) {
    Add-Result "claude" "missing" "Claude Code isn't installed (or isn't on PATH). Install it, then run claude once in a terminal to sign in."
} else {
    $claudeVersion = Invoke-Program $claude.Source @("--version")
    if ($LASTEXITCODE -eq 0) { Add-Result "claude" "ok" "$claudeVersion ($($claude.Source))" }
    else { Add-Result "claude" "failed" "$($claude.Source) --version said: $claudeVersion" }
    if ($Quick) {
        Add-Result "claude -p" "skipped" "Not tried (-Quick)"
    } elseif (-not $pythonOk) {
        Add-Result "claude -p" "skipped" "Not tried: the check runs on .venv's Python, which isn't ready"
    } else {
        # The same call the mock makes (same options, an empty folder, without the API key or address
        # variables, so it uses your Claude Code sign-in): a few seconds and a little of your plan's use.
        Write-Host "  Trying one small claude -p call (can take up to a minute the first time)..."
        $said = (Invoke-Program $python @("-m", "harness.core.mock_server", "--check")) -replace '^claude -p ', ''
        if ($LASTEXITCODE -eq 0) {
            Add-Result "claude -p" "ok" $said
            $claudeOk = $true
        } else {
            Add-Result "claude -p" "failed" "$said  (If it's about signing in: run claude once in a terminal and sign in.)"
        }
    }
}

# ---------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "3. API keys (only for -Provider anthropic or deepseek; the mock needs none)" -ForegroundColor Cyan

function Get-KeyState($name) {
    $here = [Environment]::GetEnvironmentVariable($name, "Process")
    $saved = [Environment]::GetEnvironmentVariable($name, "User")
    $key = if ($here) { $here } else { $saved }
    $where = if ($saved -and $here -and $here -ne $saved) { "set in this window (a different one is saved for your user)" }
             elseif ($saved) { "saved for your user" }
             elseif ($here) { "set in this window only (it goes when the window closes)" }
             else { $null }
    return @{ Key = $key; Where = $where }
}

function Show-Key($key) {
    # Never the key itself: its length and last 4 characters are enough to tell keys apart
    if ($key.Length -le 8) { return "$($key.Length) characters" }
    return "ends ...$($key.Substring($key.Length - 4))"
}

# A free call that needs the key (it lists the models). Only "rejected" (401) means the key is wrong.
function Test-Key($provider, $key) {
    if ($provider -eq "anthropic") {
        $url = "https://api.anthropic.com/v1/models"
        $headers = @{ "x-api-key" = $key; "anthropic-version" = "2023-06-01" }
    } else {
        $url = "https://api.deepseek.com/models"
        $headers = @{ "Authorization" = "Bearer $key" }
    }
    try {
        Invoke-WebRequest $url -Headers $headers -UseBasicParsing -TimeoutSec 20 | Out-Null
        return @{ State = "ok"; Note = "accepted" }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 401) { return @{ State = "failed"; Note = "rejected (wrong or cancelled key)" } }
        if ($status) { return @{ State = "warning"; Note = "couldn't check it (the service answered $status)" } }
        return @{ State = "warning"; Note = "couldn't check it ($($_.Exception.Message))" }
    }
}

$keys = @(
    @{ Name = "ANTHROPIC_API_KEY"; Provider = "anthropic"; Label = "Anthropic API"; Where = "platform.claude.com" },
    @{ Name = "DEEPSEEK_API_KEY";  Provider = "deepseek";  Label = "DeepSeek";      Where = "platform.deepseek.com" }
)
$haveKey = @{}
foreach ($k in $keys) {
    $state = Get-KeyState $k.Name
    if ($canAsk) {
        if ($state.Key) { Write-Host "  $($k.Name): $($state.Where), $(Show-Key $state.Key)" }
        else { Write-Host "  $($k.Name): not set" }
        $prompt = if ($state.Key) { "  Paste a new $($k.Label) key to replace it, or press Enter to keep it" }
                  else { "  Paste your $($k.Label) key (from $($k.Where)), or press Enter to skip" }
        $secure = Read-Host -Prompt $prompt -AsSecureString
        $typed = ([System.Net.NetworkCredential]::new("", $secure).Password).Trim().Trim('"').Trim("'")
        if ($typed) {
            # Saved for your user, where start.bat and the harness read it, and set in this window too
            [Environment]::SetEnvironmentVariable($k.Name, $typed, "User")
            [Environment]::SetEnvironmentVariable($k.Name, $typed, "Process")
            Write-Host "  Saved $($k.Name) for your Windows user ($(Show-Key $typed))." -ForegroundColor Green
            $state = Get-KeyState $k.Name
        }
    }

    if (-not $state.Key) {
        Add-Result $k.Name "skipped" "Not set (only needed for -Provider $($k.Provider))"
        continue
    }
    $haveKey[$k.Provider] = $true
    if ($Quick) {
        Add-Result $k.Name "ok" "$($state.Where), $(Show-Key $state.Key) (not tested: -Quick)"
    } else {
        $test = Test-Key $k.Provider $state.Key
        Add-Result $k.Name $test.State "$($state.Where), $(Show-Key $state.Key): $($test.Note)"
        if ($test.State -eq "failed") { $haveKey[$k.Provider] = $false }
    }
}

# ---------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "4. Other things" -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Add-Result "Node.js" "ok" "Node.js $("$(& $node.Source --version)".Trim()) (only needed to change the page)"
} else {
    Add-Result "Node.js" "skipped" "Not found. Only needed to change the page: the built page is in git."
}
# Models on your own computer: free, and nothing leaves it. Only their usual addresses are checked here
$localReady = @{}
foreach ($s in @(@{ Name = "ollama"; Label = "Ollama"; Url = "http://127.0.0.1:11434"; Get = "ollama.com, then ollama pull qwen3:4b" },
                 @{ Name = "lmstudio"; Label = "LM Studio"; Url = "http://127.0.0.1:1234"; Get = "lmstudio.ai, then start its server (Developer tab)" })) {
    try {
        $list = Invoke-RestMethod "$($s.Url)/v1/models" -TimeoutSec 3
        $n = @($list.data).Count
        if ($n -gt 0) {
            Add-Result $s.Label "ok" "running at $($s.Url), $n model(s)"
            $localReady[$s.Name] = $true
        } else {
            Add-Result $s.Label "warning" "running at $($s.Url), but it has no models yet"
        }
    } catch {
        Add-Result $s.Label "skipped" "not running at $($s.Url) (optional: free models on your computer; get it from $($s.Get))"
    }
}
foreach ($p in @(@{ Port = 8000; What = "the web page" })) {  # (the mock runs inside it, on any free port)
    if (Test-Port $p.Port) {
        Add-Result "Port $($p.Port)" "warning" "in use ($($p.What)). Is the lab already running? stop.bat stops it."
    } else {
        Add-Result "Port $($p.Port)" "ok" "free ($($p.What))"
    }
}

# ---------------------------------------------------------------------------------------------------
Write-Host ""
Write-Host "Summary" -ForegroundColor Cyan
$results | Format-Table Check, State -AutoSize | Out-Host

if (-not $pythonOk) {
    Write-Host "Python isn't ready yet: fix the first step above, then run setup.bat again." -ForegroundColor Yellow
    exit 1
}
$ways = @()
if ($claudeOk) { $ways += "  start.bat                        the mock: replies from claude -p, on your Claude Code plan" }
elseif ($claude -and $Quick) { $ways += "  start.bat                        the mock (claude -p not tried: -Quick)" }
if ($haveKey["anthropic"]) { $ways += "  start.bat -Provider anthropic    the Anthropic API (paid per use)" }
if ($haveKey["deepseek"]) { $ways += "  start.bat -Provider deepseek     DeepSeek (paid per use)" }
if ($localReady["ollama"]) { $ways += "  start.bat -Provider ollama       a model in Ollama (free, on your computer)" }
if ($localReady["lmstudio"]) { $ways += "  start.bat -Provider lmstudio     a model in LM Studio (free, on your computer)" }
if ($ways) {
    Write-Host "Ready. Start the lab with:" -ForegroundColor Green
    $ways | ForEach-Object { Write-Host $_ }
    if ($Quick -and -not $claudeOk) {
        Write-Host "(-Quick didn't try claude -p, so the mock isn't proven yet: start.bat checks it, or run setup.bat without -Quick.)" -ForegroundColor Yellow
    }
} else {
    Write-Host "No provider is ready yet: get claude -p working (step 2), add an API key (step 3), or run Ollama or LM Studio." -ForegroundColor Yellow
    exit 1
}
if ($canAsk) {
    Write-Host ""
    Write-Host "Keys saved now reach windows opened from now on; start.bat reads them either way."
}
