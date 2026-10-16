# One-shot: create the GitHub repository and push this plugin.
#
# Usage (in a NEW PowerShell window, so PATH includes git and gh):
#   powershell -ExecutionPolicy Bypass -File .\publish.ps1
#
# The script verifies gh is authenticated; if not, it starts `gh auth login`
# so you can authorize in the browser, then creates the repo and pushes.
#
# Output is intentionally ASCII-only: Windows PowerShell 5.1 decodes
# non-BOM files as ANSI, which corrupts non-ASCII text in scripts.

$ErrorActionPreference = 'Stop'

$RepoDir  = 'C:\Users\ini\Downloads\dsh\dsh-tech-daily-report'
$RepoName = 'dsh-tech-daily-report'
$Owner    = 'ysyXH-0827'

function Step($n, $text) {
    Write-Host ''
    Write-Host "=== $n $text ===" -ForegroundColor Cyan
}

Step '1/5' 'Checking tools'
foreach ($tool in @('git', 'gh')) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Host "ERROR: '$tool' not found on PATH." -ForegroundColor Red
        Write-Host 'Open a NEW PowerShell window and retry.' -ForegroundColor Red
        exit 1
    }
    Write-Host "  $tool -> $($cmd.Source)"
}

Step '2/5' 'Checking GitHub login'
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host '  Not logged in. Starting authorization.' -ForegroundColor Yellow
    Write-Host '  Choose: GitHub.com -> HTTPS -> Yes (authenticate git) -> Login with a web browser' -ForegroundColor Yellow
    gh auth login
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: authorization did not complete.' -ForegroundColor Red
        exit 1
    }
}
gh auth setup-git
Write-Host '  Logged in; git credential helper now points at gh.' -ForegroundColor Green

Step '3/5' 'Pre-push safety check'
Push-Location $RepoDir
try {
    # Refuse to push if a Tavily key was ever committed.
    $leak = git grep -nE 'tvly-[A-Za-z0-9_-]{15,}' HEAD 2>$null
    if ($leak) {
        Write-Host 'ERROR: a Tavily API key appears in HEAD. Push aborted.' -ForegroundColor Red
        Write-Host $leak
        exit 1
    }
    Write-Host '  No API key found; safe to push.' -ForegroundColor Green

    Step '4/5' 'Creating repository (skipped if it exists)'
    gh repo view "$Owner/$RepoName" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        gh repo create $RepoName --public --source=. --remote=origin --push
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'ERROR: repo create or push failed.' -ForegroundColor Red
            exit 1
        }
    }
    else {
        Write-Host '  Repository already exists; pushing instead.' -ForegroundColor Yellow
        git remote get-url origin 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            git remote add origin "https://github.com/$Owner/$RepoName.git"
        }
        git push -u origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'ERROR: push failed.' -ForegroundColor Red
            exit 1
        }
    }

    Step '5/5' 'Done'
    Write-Host "  Repository: https://github.com/$Owner/$RepoName" -ForegroundColor Green
    Write-Host '  GitHub Actions will run the verify workflow automatically.' -ForegroundColor Green
    Write-Host ''
    git log --oneline -1
}
finally {
    Pop-Location
}
