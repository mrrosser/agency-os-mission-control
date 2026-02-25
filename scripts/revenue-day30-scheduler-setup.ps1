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

$projectId = Get-EnvOrDefault -Name "GCP_PROJECT_ID"
$location = Get-EnvOrDefault -Name "GCP_SCHEDULER_LOCATION" -Default "us-central1"

$serviceUrl = Get-EnvOrDefault -Name "REVENUE_DAY30_SERVICE_URL"
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
$day30Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_DAY30_CRON" -Default "15 9 * * *"
$day30WeeklyCron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_DAY30_WEEKLY_CRON" -Default "20 6 * * 1"
$responseMaxTasks = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_DAY30_RESPONSE_MAX_TASKS" -Default "10"
$requireApprovalGates = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_DAY30_REQUIRE_APPROVAL_GATES" -Default "true"

if (-not $projectId) { throw "Missing GCP_PROJECT_ID" }
if (-not $serviceUrl) { throw "Missing REVENUE_DAY30_SERVICE_URL (or REVENUE_DAY2_SERVICE_URL/REVENUE_DAY1_SERVICE_URL fallback)" }
if (-not $workerToken) { throw "Missing REVENUE_DAY30_WORKER_TOKEN (or REVENUE_DAY2_WORKER_TOKEN/REVENUE_DAY1_WORKER_TOKEN fallback)" }
if (-not $uid) { throw "Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY30_UID/REVENUE_DAY2_UID/REVENUE_DAY1_UID fallback)" }

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
        [Parameter(Mandatory = $true)][string]$JobName
    )

    $args = @(
        "scheduler", "jobs", "describe", $JobName,
        "--location", $location,
        "--project", $projectId
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & gcloud.cmd @args 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    $message = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output   = $message
    }
}

function Upsert-SchedulerJob {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$Cron,
        [Parameter(Mandatory = $true)][string]$Body
    )

    $uri = "$serviceUrl/api/revenue/day30/worker-task"
    $headers = "Content-Type=application/json,Authorization=Bearer $workerToken"
    $describeResult = Try-DescribeSchedulerJob -JobName $JobName
    $exists = $describeResult.ExitCode -eq 0
    if (-not $exists -and $describeResult.Output -notmatch "(?i)not\s+found|NOT_FOUND") {
        throw "Unable to determine scheduler job state for '$JobName'.`n$($describeResult.Output)"
    }

    $bodyFile = [System.IO.Path]::GetTempFileName()
    try {
        Set-Content -Path $bodyFile -Value $Body -NoNewline -Encoding Ascii

        if ($exists) {
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "update", "http", $JobName,
                "--location", $location,
                "--project", $projectId,
                "--schedule", $Cron,
                "--time-zone", $timeZone,
                "--uri", $uri,
                "--http-method", "POST",
                "--update-headers", $headers,
                "--message-body-from-file", $bodyFile
            )
        } else {
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "create", "http", $JobName,
                "--location", $location,
                "--project", $projectId,
                "--schedule", $Cron,
                "--time-zone", $timeZone,
                "--uri", $uri,
                "--http-method", "POST",
                "--headers", $headers,
                "--message-body-from-file", $bodyFile
            )
        }
    } finally {
        Remove-Item -Path $bodyFile -ErrorAction SilentlyContinue -Force
    }
}

$templates = @{
    "rts"  = "rts-south-day1"
    "rng"  = "rng-south-day1"
    "aicf" = "aicf-south-day1"
}

$requireApprovalGatesBool = $true
if ($requireApprovalGates -match "^(?i:false|0|no)$") {
    $requireApprovalGatesBool = $false
}

foreach ($business in @("rts", "rng", "aicf")) {
    $templateId = $templates[$business]
    $payload = (@{
            uid                    = $uid
            templateIds            = @($templateId)
            dryRun                 = $false
            forceRun               = $false
            timeZone               = $timeZone
            autoQueueFollowups     = $true
            processDueResponses    = $true
            responseLoopMaxTasks   = [int]$responseMaxTasks
            requireApprovalGates   = $requireApprovalGatesBool
            runWeeklyKpi           = $false
            runServiceLab          = $false
            runCloserQueue         = $true
            runRevenueMemory       = $true
            followupDelayHours     = 48
            followupMaxLeads       = 25
            followupSequence       = 1
            serviceCandidateLimit  = 5
            closerQueueLookbackHours = 72
            closerQueueLimit       = 40
            memoryLookbackDays     = 30
        } | ConvertTo-Json -Compress)

    Upsert-SchedulerJob -JobName "revenue-day30-$business-daily" -Cron $day30Cron -Body $payload
}

$weeklyPayload = (@{
        uid                    = $uid
        templateIds            = @("rts-south-day1", "rng-south-day1", "aicf-south-day1")
        dryRun                 = $false
        forceRun               = $false
        timeZone               = $timeZone
        autoQueueFollowups     = $true
        processDueResponses    = $true
        responseLoopMaxTasks   = [int]$responseMaxTasks
        requireApprovalGates   = $requireApprovalGatesBool
        runWeeklyKpi           = $true
        runServiceLab          = $true
        runCloserQueue         = $true
        runRevenueMemory       = $true
        followupDelayHours     = 48
        followupMaxLeads       = 25
        followupSequence       = 1
        serviceCandidateLimit  = 5
        closerQueueLookbackHours = 72
        closerQueueLimit       = 40
        memoryLookbackDays     = 30
    } | ConvertTo-Json -Compress)

Upsert-SchedulerJob -JobName "revenue-day30-weekly-brain" -Cron $day30WeeklyCron -Body $weeklyPayload

Write-Output "Configured Day30 scheduler jobs (daily per business + weekly brain loop) in $timeZone."
