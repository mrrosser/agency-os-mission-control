param(
  [string]$Repo = "mrrosser/AI-Hell-Mary",
  [int]$IntervalSeconds = 30
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "GitHub CLI (gh) is not installed or not in PATH."
  exit 1
}

while ($true) {
  $runs = gh run list -R $Repo --limit 1 --json databaseId,displayTitle,status,conclusion,updatedAt | ConvertFrom-Json
  if (-not $runs) {
    Write-Host "No runs found for $Repo"
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  $run = $runs[0]
  Write-Host ("[{0}] {1} {2} - {3}" -f $run.databaseId, $run.status, ($run.conclusion ?? "pending"), $run.displayTitle)

  if ($run.conclusion) {
    exit 0
  }

  Start-Sleep -Seconds $IntervalSeconds
}
