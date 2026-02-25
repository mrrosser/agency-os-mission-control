param(
  [string]$TargetRoot = "C:\CTO Projects\AI_HELL_MARY",
  [switch]$DryRun
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$syncScript = Join-Path $scriptDir "sync-ai-hell-mary.mjs"

if (-not (Test-Path $syncScript)) {
  throw "Sync script not found: $syncScript"
}

Push-Location $repoRoot
try {
  $args = @("$syncScript", "--target-root", "$TargetRoot")
  if ($DryRun.IsPresent) {
    $args += "--dry-run"
  }
  node @args
} finally {
  Pop-Location
}
