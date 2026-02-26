param()

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-Alias -Name gcloud -Value gcloud.cmd -Scope Script

function Read-Env {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$DefaultValue = ""
  )
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
  return $value.Trim()
}

$projectId = Read-Env -Name "GCP_PROJECT_ID"
$location = Read-Env -Name "GCP_SCHEDULER_LOCATION" -DefaultValue "us-central1"
$serviceUrl = Read-Env -Name "SOCIAL_DISPATCH_SERVICE_URL"
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  $serviceUrl = Read-Env -Name "SOCIAL_DRAFT_BASE_URL"
}
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  $serviceUrl = Read-Env -Name "REVENUE_DAY30_BASE_URL"
}
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  $serviceUrl = Read-Env -Name "REVENUE_DAY2_BASE_URL"
}
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  $serviceUrl = Read-Env -Name "REVENUE_DAY1_BASE_URL"
}

$workerToken = Read-Env -Name "SOCIAL_DRAFT_WORKER_TOKEN"
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  $workerToken = Read-Env -Name "REVENUE_DAY30_WORKER_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  $workerToken = Read-Env -Name "REVENUE_DAY2_WORKER_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  $workerToken = Read-Env -Name "REVENUE_DAY1_WORKER_TOKEN"
}

$uid = Read-Env -Name "SOCIAL_DISPATCH_UID"
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "SOCIAL_DRAFT_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "REVENUE_AUTOMATION_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "REVENUE_DAY30_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "REVENUE_DAY2_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "REVENUE_DAY1_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "VOICE_ACTIONS_DEFAULT_UID"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "SQUARE_WEBHOOK_DEFAULT_UID"
}

$timeZone = Read-Env -Name "SOCIAL_DISPATCH_TIME_ZONE" -DefaultValue "America/Chicago"
$drainCron = Read-Env -Name "SOCIAL_DISPATCH_DRAIN_CRON" -DefaultValue "*/15 * * * *"
$retryCron = Read-Env -Name "SOCIAL_DISPATCH_RETRY_CRON" -DefaultValue "0 3 * * *"
$maxTasks = Read-Env -Name "SOCIAL_DISPATCH_MAX_TASKS" -DefaultValue "10"
$retryMaxTasks = Read-Env -Name "SOCIAL_DISPATCH_RETRY_MAX_TASKS" -DefaultValue "10"
$retryEnabled = (Read-Env -Name "SOCIAL_DISPATCH_RETRY_ENABLED" -DefaultValue "false").ToLower()

if ([string]::IsNullOrWhiteSpace($projectId)) {
  throw "Missing GCP_PROJECT_ID"
}
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  throw "Missing SOCIAL_DISPATCH_SERVICE_URL (or SOCIAL_DRAFT_BASE_URL/REVENUE_DAY30_BASE_URL fallback)"
}
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  throw "Missing SOCIAL_DRAFT_WORKER_TOKEN (or revenue worker token fallback)"
}
if ([string]::IsNullOrWhiteSpace($uid)) {
  throw "Missing SOCIAL_DISPATCH_UID (or SOCIAL_DRAFT_UID/revenue uid fallback)"
}

$serviceUrl = $serviceUrl.TrimEnd("/")
$uri = "$serviceUrl/api/social/drafts/dispatch/worker-task"

function Upsert-Job {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Cron,
    [Parameter(Mandatory = $true)][string]$BodyJson
  )

  $bodyFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $bodyFile -Value $BodyJson -Encoding UTF8
    $exists = $true
    gcloud scheduler jobs describe $Name --location $location --project $projectId 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $exists = $false }

    if ($exists) {
      gcloud scheduler jobs update http $Name `
        --location $location `
        --project $projectId `
        --schedule $Cron `
        --time-zone $timeZone `
        --uri $uri `
        --http-method POST `
        --update-headers "Content-Type=application/json,Authorization=Bearer $workerToken" `
        --message-body-from-file $bodyFile | Out-Null
    } else {
      gcloud scheduler jobs create http $Name `
        --location $location `
        --project $projectId `
        --schedule $Cron `
        --time-zone $timeZone `
        --uri $uri `
        --http-method POST `
        --headers "Content-Type=application/json,Authorization=Bearer $workerToken" `
        --message-body-from-file $bodyFile | Out-Null
    }
  } finally {
    Remove-Item -Path $bodyFile -ErrorAction SilentlyContinue
  }
}

$drainPayload = @{
  uid = $uid
  maxTasks = [int]$maxTasks
  retryFailed = $false
  dryRun = $false
} | ConvertTo-Json -Compress

$retryPayload = @{
  uid = $uid
  maxTasks = [int]$retryMaxTasks
  retryFailed = $true
  dryRun = $false
} | ConvertTo-Json -Compress

Upsert-Job -Name "social-dispatch-drain" -Cron $drainCron -BodyJson $drainPayload

if ($retryEnabled -in @("true", "1", "yes")) {
  Upsert-Job -Name "social-dispatch-retry-failed" -Cron $retryCron -BodyJson $retryPayload
  try {
    gcloud scheduler jobs resume social-dispatch-retry-failed --location $location --project $projectId 2>$null | Out-Null
  } catch {
    if ($_.Exception.Message -notmatch "already enabled|is already in state ENABLED") { throw }
  }
} else {
  gcloud scheduler jobs describe social-dispatch-retry-failed --location $location --project $projectId 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    try {
      gcloud scheduler jobs pause social-dispatch-retry-failed --location $location --project $projectId 2>$null | Out-Null
    } catch {
      if ($_.Exception.Message -notmatch "already paused|has been paused") { throw }
    }
  }
}

Write-Host "Configured social dispatch scheduler jobs in $timeZone."
