param(
  [string]$ProjectId = "leadflow-review",
  [string]$Location = "us-central1",
  [string]$TimeZone = "America/Chicago"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version Latest

function Get-Job {
  param([Parameter(Mandatory = $true)][string]$Name)

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $json = & cmd.exe /c "gcloud.cmd scheduler jobs describe $Name --location $Location --project $ProjectId --format=json 2>nul"
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
    return $null
  }
  return $json | ConvertFrom-Json
}

function Get-BodyText {
  param([Parameter(Mandatory = $true)]$Job)

  if (-not $Job.httpTarget) {
    return "{}"
  }

  $body = [string]$Job.httpTarget.body
  if ([string]::IsNullOrWhiteSpace($body)) {
    return "{}"
  }

  $trimmed = $body.Trim()
  if ($trimmed.StartsWith("{") -or $trimmed.StartsWith("[")) {
    return $trimmed
  }

  try {
    return [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($trimmed))
  } catch {
    return $trimmed
  }
}

function Get-BodyObject {
  param([Parameter(Mandatory = $true)]$Job)

  $raw = Get-BodyText -Job $Job
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @{}
  }

  $object = $raw | ConvertFrom-Json
  $hash = @{}
  foreach ($property in $object.PSObject.Properties) {
    $hash[$property.Name] = $property.Value
  }
  return $hash
}

function Add-AuthArgs {
  param(
    [Parameter(Mandatory = $true)][System.Collections.Generic.List[string]]$Args,
    [Parameter(Mandatory = $true)]$Template,
    [Parameter(Mandatory = $true)][bool]$Exists
  )

  $authHeader = $null
  if ($Template.httpTarget.headers) {
    $authProperty = $Template.httpTarget.headers.PSObject.Properties["Authorization"]
    if ($authProperty) {
      $authHeader = [string]$authProperty.Value
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($authHeader)) {
    if ($Exists) {
      $Args.Add("--update-headers")
    } else {
      $Args.Add("--headers")
    }
    $Args.Add("Content-Type=application/json,Authorization=$authHeader")
    return
  }

  if ($Template.httpTarget.oidcToken) {
    $Args.Add("--oidc-service-account-email")
    $Args.Add([string]$Template.httpTarget.oidcToken.serviceAccountEmail)
    $audience = [string]$Template.httpTarget.oidcToken.audience
    if (-not [string]::IsNullOrWhiteSpace($audience)) {
      $Args.Add("--oidc-token-audience")
      $Args.Add($audience)
    }
    return
  }

  if ($Template.httpTarget.oauthToken) {
    $Args.Add("--oauth-service-account-email")
    $Args.Add([string]$Template.httpTarget.oauthToken.serviceAccountEmail)
    $scope = [string]$Template.httpTarget.oauthToken.scope
    if (-not [string]::IsNullOrWhiteSpace($scope)) {
      $Args.Add("--oauth-token-scope")
      $Args.Add($scope)
    }
  }
}

function Upsert-Job {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Schedule,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)]$Template,
    [Parameter(Mandatory = $true)][string]$BodyText
  )

  $exists = $null -ne (Get-Job -Name $Name)
  $verb = if ($exists) { "update" } else { "create" }

  $bodyFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $bodyFile -Value $BodyText -Encoding Ascii -NoNewline
    $args = [System.Collections.Generic.List[string]]::new()
    foreach ($item in @(
        "scheduler", "jobs", $verb, "http", $Name,
        "--location", $Location,
        "--project", $ProjectId,
        "--schedule", $Schedule,
        "--time-zone", $TimeZone,
        "--uri", $Uri,
        "--http-method", "POST",
        "--message-body-from-file", $bodyFile
      )) {
      $args.Add($item)
    }

    Add-AuthArgs -Args $args -Template $Template -Exists $exists
    & gcloud.cmd @args | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to upsert scheduler job '$Name'."
    }
  } finally {
    Remove-Item -Path $bodyFile -Force -ErrorAction SilentlyContinue
  }
}

function Remove-JobIfExists {
  param([Parameter(Mandatory = $true)][string]$Name)

  if (Get-Job -Name $Name) {
    & gcloud.cmd scheduler jobs delete $Name --location $Location --project $ProjectId --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to delete scheduler job '$Name'."
    }
  }
}

$revenueSource = Get-Job -Name "revenue-day30-rts-daily"
if (-not $revenueSource) {
  throw "Missing source job revenue-day30-rts-daily."
}

$revenueBaseUrl = ([string]$revenueSource.httpTarget.uri) -replace "/api/.*$", ""
$revenueUid = [string](Get-BodyObject -Job $revenueSource).uid
if ([string]::IsNullOrWhiteSpace($revenueUid)) {
  throw "Unable to resolve revenue uid from source job."
}

$dailySchedules = @{
  rts = "5 5 * * *"
  rng = "20 5 * * *"
  aicf = "35 5 * * *"
}

foreach ($pair in $dailySchedules.GetEnumerator()) {
  $dailyBody = @{
    uid = $revenueUid
    businessKey = $pair.Key
    dryRun = $false
    dueOnly = $true
    runStages = @("day30")
    timeZone = $TimeZone
    processDueResponses = $true
    requireApprovalGates = $true
    runCloserQueue = $true
    runRevenueMemory = $true
    runWeeklyKpi = $false
    runServiceLab = $false
  } | ConvertTo-Json -Depth 6 -Compress

  Upsert-Job -Name "revenue-automation-$($pair.Key)" -Schedule $pair.Value -Uri "$revenueBaseUrl/api/revenue/automation/daily/worker-task" -Template $revenueSource -BodyText $dailyBody
}

$weeklyBody = @{
  uid = $revenueUid
  templateIds = @("rts-south-day1", "rng-south-day1", "aicf-south-day1")
  dryRun = $false
  forceRun = $false
  timeZone = $TimeZone
  processDueResponses = $true
  requireApprovalGates = $true
  runCloserQueue = $true
  runRevenueMemory = $true
  runWeeklyKpi = $true
  runServiceLab = $true
} | ConvertTo-Json -Depth 6 -Compress

Upsert-Job -Name "revenue-weekly-brain" -Schedule "10 6 * * 1" -Uri "$revenueBaseUrl/api/revenue/day30/worker-task" -Template $revenueSource -BodyText $weeklyBody

$socialWeeklySource = Get-Job -Name "social-drafts-rng-weekly"
if (-not $socialWeeklySource) {
  $socialWeeklySource = Get-Job -Name "social-drafts-rts-weekly"
}
if (-not $socialWeeklySource) {
  throw "Missing social weekly source job."
}

$socialBaseUrl = ([string]$socialWeeklySource.httpTarget.uri) -replace "/api/.*$", ""
$socialUid = [string](Get-BodyObject -Job $socialWeeklySource).uid
if ([string]::IsNullOrWhiteSpace($socialUid)) {
  throw "Unable to resolve social weekly uid from source job."
}

$socialWeeklyBody = @{
  uid = $socialUid
  businessKey = "all"
  requestApproval = $true
  source = "openclaw_social_orchestrator"
} | ConvertTo-Json -Depth 4 -Compress

Upsert-Job -Name "social-drafts-weekly-all" -Schedule "20 6 * * 1" -Uri "$socialBaseUrl/api/social/drafts/weekly/worker-task" -Template $socialWeeklySource -BodyText $socialWeeklyBody

$dispatchDrain = Get-Job -Name "social-dispatch-drain"
if ($dispatchDrain) {
  Upsert-Job -Name "social-dispatch-drain" -Schedule "*/15 * * * *" -Uri ([string]$dispatchDrain.httpTarget.uri) -Template $dispatchDrain -BodyText (Get-BodyText -Job $dispatchDrain)
}

$dispatchRetry = Get-Job -Name "social-dispatch-retry-failed"
if ($dispatchRetry) {
  Upsert-Job -Name "social-dispatch-retry-failed" -Schedule "0 * * * *" -Uri ([string]$dispatchRetry.httpTarget.uri) -Template $dispatchRetry -BodyText (Get-BodyText -Job $dispatchRetry)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & cmd.exe /c "gcloud.cmd scheduler jobs resume social-dispatch-retry-failed --location $Location --project $ProjectId 2>nul" | Out-Null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

$oauthJob = Get-Job -Name "google-oauth-health-monitor"
if ($oauthJob) {
  Upsert-Job -Name "google-oauth-health-monitor" -Schedule "0 */4 * * *" -Uri ([string]$oauthJob.httpTarget.uri) -Template $oauthJob -BodyText (Get-BodyText -Job $oauthJob)
}

foreach ($jobName in @(
    "revenue-day1-rts-start",
    "revenue-day1-rng-start",
    "revenue-day1-aicf-start",
    "revenue-day1-rts-followup-seed",
    "revenue-day1-rng-followup-seed",
    "revenue-day1-aicf-followup-seed",
    "revenue-day1-rts-followup-seed-d5",
    "revenue-day1-rng-followup-seed-d5",
    "revenue-day1-aicf-followup-seed-d5",
    "revenue-day1-rts-followup-seed-d10",
    "revenue-day1-rng-followup-seed-d10",
    "revenue-day1-aicf-followup-seed-d10",
    "revenue-day1-rts-followup-seed-d14",
    "revenue-day1-rng-followup-seed-d14",
    "revenue-day1-aicf-followup-seed-d14",
    "revenue-day2-rts-loop",
    "revenue-day2-rng-loop",
    "revenue-day2-aicf-loop",
    "revenue-day30-rts-daily",
    "revenue-day30-rng-daily",
    "revenue-day30-aicf-daily",
    "revenue-day30-weekly-brain",
    "social-drafts-rng-weekly",
    "social-drafts-rts-weekly",
    "social-drafts-aicf-weekly"
  )) {
  Remove-JobIfExists -Name $jobName
}

$jobCount = (& gcloud.cmd scheduler jobs list --location $Location --project $ProjectId --format="value(name)" | Measure-Object).Count
Write-Output "Scheduler consolidation applied. Active jobs: $jobCount"
