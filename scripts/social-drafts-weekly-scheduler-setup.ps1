$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-Env {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$DefaultValue = ""
  )
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $DefaultValue }
  return $value.Trim()
}

Set-Alias -Name gcloud -Value gcloud.cmd -Scope Script

function Upsert-Job {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Cron,
    [Parameter(Mandatory = $true)][string]$BodyJson,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [Parameter(Mandatory = $true)][string]$Location,
    [Parameter(Mandatory = $true)][string]$TimeZone,
    [Parameter(Mandatory = $true)][string]$WorkerToken
  )

  $bodyFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $bodyFile -Value $BodyJson -Encoding UTF8
    $exists = $true
    gcloud scheduler jobs describe $Name --location $Location --project $ProjectId 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $exists = $false }

    if ($exists) {
      gcloud scheduler jobs update http $Name `
        --location $Location `
        --project $ProjectId `
        --schedule $Cron `
        --time-zone $TimeZone `
        --uri $Uri `
        --http-method POST `
        --update-headers "Content-Type=application/json,Authorization=Bearer $WorkerToken" `
        --message-body-from-file $bodyFile | Out-Null
    } else {
      gcloud scheduler jobs create http $Name `
        --location $Location `
        --project $ProjectId `
        --schedule $Cron `
        --time-zone $TimeZone `
        --uri $Uri `
        --http-method POST `
        --headers "Content-Type=application/json,Authorization=Bearer $WorkerToken" `
        --message-body-from-file $bodyFile | Out-Null
    }
  } finally {
    Remove-Item -Path $bodyFile -ErrorAction SilentlyContinue -Force
  }
}

function Remove-JobIfExists {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ProjectId,
    [Parameter(Mandatory = $true)][string]$Location
  )

  gcloud scheduler jobs describe $Name --location $Location --project $ProjectId 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    gcloud scheduler jobs delete $Name --location $Location --project $ProjectId --quiet | Out-Null
  }
}

$projectId = Read-Env -Name "GCP_PROJECT_ID"
$location = Read-Env -Name "GCP_SCHEDULER_LOCATION" -DefaultValue "us-central1"
$serviceUrl = Read-Env -Name "SOCIAL_DRAFT_BASE_URL"
if ([string]::IsNullOrWhiteSpace($serviceUrl)) {
  $serviceUrl = Read-Env -Name "SOCIAL_DISPATCH_SERVICE_URL"
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
$uid = Read-Env -Name "SOCIAL_DRAFT_UID"
if ([string]::IsNullOrWhiteSpace($uid)) {
  $uid = Read-Env -Name "REVENUE_AUTOMATION_UID"
}
$timeZone = Read-Env -Name "SOCIAL_DRAFT_WEEKLY_TIMEZONE" -DefaultValue "America/Chicago"
$weeklyCron = Read-Env -Name "SOCIAL_DRAFT_WEEKLY_ALL_CRON" -DefaultValue "20 6 * * 1"

if ([string]::IsNullOrWhiteSpace($projectId)) { throw "Missing GCP_PROJECT_ID" }
if ([string]::IsNullOrWhiteSpace($serviceUrl)) { throw "Missing SOCIAL_DRAFT_BASE_URL (or SOCIAL_DISPATCH_SERVICE_URL fallback)" }
if ([string]::IsNullOrWhiteSpace($workerToken)) { throw "Missing SOCIAL_DRAFT_WORKER_TOKEN (or revenue worker token fallback)" }
if ([string]::IsNullOrWhiteSpace($uid)) { throw "Missing SOCIAL_DRAFT_UID (or REVENUE_AUTOMATION_UID fallback)" }

$serviceUrl = $serviceUrl.TrimEnd("/")
$uri = "$serviceUrl/api/social/drafts/weekly/worker-task"
$body = @{
  uid = $uid
  businessKey = "all"
  requestApproval = $true
  source = "openclaw_social_orchestrator"
} | ConvertTo-Json -Compress

Upsert-Job -Name "social-drafts-weekly-all" -Cron $weeklyCron -BodyJson $body -Uri $uri -ProjectId $projectId -Location $location -TimeZone $timeZone -WorkerToken $workerToken

foreach ($legacyName in @("social-drafts-rng-weekly", "social-drafts-rts-weekly", "social-drafts-aicf-weekly")) {
  Remove-JobIfExists -Name $legacyName -ProjectId $projectId -Location $location
}

Write-Host "Configured consolidated weekly social drafts scheduler job."
