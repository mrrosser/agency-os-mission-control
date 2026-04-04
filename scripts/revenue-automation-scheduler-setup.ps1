$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-EnvOrDefault {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = ""
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }
    return $value.Trim()
}

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud.cmd @Args 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    if ($exitCode -ne 0) {
        $message = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
        throw "gcloud command failed: gcloud $($Args -join ' ')`n$message"
    }
}

function Try-DescribeSchedulerJob {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud.cmd scheduler jobs describe $JobName --location $Location --project $ProjectId 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
    }
}

function Upsert-SchedulerJob {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$Cron,
        [Parameter(Mandatory = $true)][string]$TimeZone,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$WorkerToken,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location,
        [Parameter(Mandatory = $true)][string]$BodyJson
    )

    $describeResult = Try-DescribeSchedulerJob -JobName $JobName -ProjectId $ProjectId -Location $Location
    $exists = $describeResult.ExitCode -eq 0
    if (-not $exists -and $describeResult.Output -notmatch "(?i)not\s+found|NOT_FOUND") {
        throw "Unable to determine scheduler job state for '$JobName'.`n$($describeResult.Output)"
    }

    $bodyFile = [System.IO.Path]::GetTempFileName()
    try {
        Set-Content -Path $bodyFile -Value $BodyJson -NoNewline -Encoding Ascii
        if ($exists) {
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "update", "http", $JobName,
                "--location", $Location,
                "--project", $ProjectId,
                "--schedule", $Cron,
                "--time-zone", $TimeZone,
                "--uri", $Uri,
                "--http-method", "POST",
                "--update-headers", "Content-Type=application/json,Authorization=Bearer $WorkerToken",
                "--message-body-from-file", $bodyFile
            )
        } else {
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "create", "http", $JobName,
                "--location", $Location,
                "--project", $ProjectId,
                "--schedule", $Cron,
                "--time-zone", $TimeZone,
                "--uri", $Uri,
                "--http-method", "POST",
                "--headers", "Content-Type=application/json,Authorization=Bearer $WorkerToken",
                "--message-body-from-file", $bodyFile
            )
        }
    } finally {
        Remove-Item -Path $bodyFile -ErrorAction SilentlyContinue -Force
    }
}

function Remove-SchedulerJobIfExists {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )

    $describe = Try-DescribeSchedulerJob -JobName $JobName -ProjectId $ProjectId -Location $Location
    if ($describe.ExitCode -eq 0) {
        Invoke-Gcloud -Args @(
            "scheduler", "jobs", "delete", $JobName,
            "--location", $Location,
            "--project", $ProjectId,
            "--quiet"
        )
    }
}

$projectId = Get-EnvOrDefault -Name "GCP_PROJECT_ID"
$location = Get-EnvOrDefault -Name "GCP_SCHEDULER_LOCATION" -Default "us-central1"
$serviceUrl = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SERVICE_URL"
if (-not $serviceUrl) { $serviceUrl = Get-EnvOrDefault -Name "REVENUE_DAY30_SERVICE_URL" }
if (-not $serviceUrl) { $serviceUrl = Get-EnvOrDefault -Name "REVENUE_DAY2_SERVICE_URL" }
if (-not $serviceUrl) { $serviceUrl = Get-EnvOrDefault -Name "REVENUE_DAY1_SERVICE_URL" }
$serviceUrl = $serviceUrl.TrimEnd("/")

$workerToken = Get-EnvOrDefault -Name "REVENUE_DAY30_WORKER_TOKEN"
if (-not $workerToken) { $workerToken = Get-EnvOrDefault -Name "REVENUE_DAY2_WORKER_TOKEN" }
if (-not $workerToken) { $workerToken = Get-EnvOrDefault -Name "REVENUE_DAY1_WORKER_TOKEN" }

$uid = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_UID"
if (-not $uid) { $uid = Get-EnvOrDefault -Name "REVENUE_DAY30_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "REVENUE_DAY2_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "REVENUE_DAY1_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "VOICE_ACTIONS_DEFAULT_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "SQUARE_WEBHOOK_DEFAULT_UID" }

$timeZone = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_TIME_ZONE" -Default "America/Chicago"
$dailyCronByBusiness = @{
    "rts" = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_RTS_CRON" -Default "5 5 * * *"
    "rng" = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_RNG_CRON" -Default "20 5 * * *"
    "aicf" = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_AICF_CRON" -Default "35 5 * * *"
}
$weeklyBrainCron = Get-EnvOrDefault -Name "REVENUE_WEEKLY_BRAIN_CRON" -Default "10 6 * * 1"

if (-not $projectId) { throw "Missing GCP_PROJECT_ID" }
if (-not $serviceUrl) { throw "Missing REVENUE_AUTOMATION_SERVICE_URL (or revenue service URL fallback)" }
if (-not $workerToken) { throw "Missing REVENUE_DAY30_WORKER_TOKEN (or fallback revenue worker token)" }
if (-not $uid) { throw "Missing REVENUE_AUTOMATION_UID (or fallback revenue uid)" }

$dailyUri = "$serviceUrl/api/revenue/automation/daily/worker-task"
$weeklyUri = "$serviceUrl/api/revenue/day30/worker-task"

foreach ($businessKey in @("rts", "rng", "aicf")) {
    $body = @{
        uid = $uid
        businessKey = $businessKey
        dryRun = $false
        dueOnly = $true
        runStages = @("day30")
        timeZone = $timeZone
        processDueResponses = $true
        requireApprovalGates = $true
        runCloserQueue = $true
        runRevenueMemory = $true
        runWeeklyKpi = $false
        runServiceLab = $false
    } | ConvertTo-Json -Compress

    Upsert-SchedulerJob -JobName "revenue-automation-$businessKey" -Cron $dailyCronByBusiness[$businessKey] -TimeZone $timeZone -Uri $dailyUri -WorkerToken $workerToken -ProjectId $projectId -Location $location -BodyJson $body
}

$weeklyBody = @{
    uid = $uid
    templateIds = @("rts-south-day1", "rng-south-day1", "aicf-south-day1")
    dryRun = $false
    forceRun = $false
    timeZone = $timeZone
    processDueResponses = $true
    requireApprovalGates = $true
    runCloserQueue = $true
    runRevenueMemory = $true
    runWeeklyKpi = $true
    runServiceLab = $true
} | ConvertTo-Json -Compress

Upsert-SchedulerJob -JobName "revenue-weekly-brain" -Cron $weeklyBrainCron -TimeZone $timeZone -Uri $weeklyUri -WorkerToken $workerToken -ProjectId $projectId -Location $location -BodyJson $weeklyBody

$legacyJobs = @(
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
    "revenue-day30-weekly-brain"
)

foreach ($jobName in $legacyJobs) {
    Remove-SchedulerJobIfExists -JobName $jobName -ProjectId $projectId -Location $location
}

Write-Output "Configured consolidated revenue automation scheduler jobs and removed legacy revenue job variants."
