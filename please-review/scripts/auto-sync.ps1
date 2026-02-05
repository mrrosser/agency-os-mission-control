param(
  [int]$IntervalSeconds = 300,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

if ($env:AUTO_SYNC -ne "1") {
  Write-Host "Set AUTO_SYNC=1 to enable auto sync."
  exit 1
}

function Invoke-Tests {
  if ($SkipTests -or $env:AUTO_SYNC_SKIP_TESTS -eq "1") {
    return $true
  }

  Write-Host "Running tests..."
  npm test
  return $LASTEXITCODE -eq 0
}

while ($true) {
  $branch = git rev-parse --abbrev-ref HEAD
  if ($branch -ne "main") {
    Write-Host "Auto sync paused (current branch: $branch)."
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  $status = git status --porcelain
  if (-not $status) {
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  if (-not (Invoke-Tests)) {
    Write-Host "Tests failed; skipping push."
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  git add -A | Out-Null
  $msg = $env:AUTO_SYNC_MESSAGE
  if (-not $msg) {
    $msg = "chore: autosync $(Get-Date -Format s)"
  }

  git commit -m "$msg" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  git push
  Start-Sleep -Seconds $IntervalSeconds
}
