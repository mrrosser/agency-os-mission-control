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
$serviceUrl = (Get-EnvOrDefault -Name "REVENUE_DAY1_SERVICE_URL").TrimEnd("/")
$workerToken = Get-EnvOrDefault -Name "REVENUE_DAY1_WORKER_TOKEN"

$uid = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_UID"
if (-not $uid) { $uid = Get-EnvOrDefault -Name "REVENUE_DAY1_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "VOICE_ACTIONS_DEFAULT_UID" }
if (-not $uid) { $uid = Get-EnvOrDefault -Name "SQUARE_WEBHOOK_DEFAULT_UID" }

$timeZone = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_TIME_ZONE" -Default "America/Chicago"
$startCron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_START_CRON" -Default "0 8 * * *"
$seedD2Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SEED_CRON_D2"
if (-not $seedD2Cron) {
    $seedD2Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SEED_CRON" -Default "0 10 * * *"
}
$seedD5Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SEED_CRON_D5" -Default "20 10 * * *"
$seedD10Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SEED_CRON_D10" -Default "40 10 * * *"
$seedD14Cron = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SEED_CRON_D14" -Default "0 11 * * *"

if (-not $projectId) { throw "Missing GCP_PROJECT_ID" }
if (-not $serviceUrl) { throw "Missing REVENUE_DAY1_SERVICE_URL" }
if (-not $workerToken) { throw "Missing REVENUE_DAY1_WORKER_TOKEN" }
if (-not $uid) { throw "Missing REVENUE_AUTOMATION_UID (or REVENUE_DAY1_UID/VOICE_ACTIONS_DEFAULT_UID/SQUARE_WEBHOOK_DEFAULT_UID)" }

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

    $uri = "$serviceUrl/api/revenue/day1/worker-task"
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

foreach ($business in @("rts", "rng", "aicf")) {
    $templateId = $templates[$business]

    $startPayload = (@{
            uid                = $uid
            templateId         = $templateId
            dryRun             = $false
            forceRun           = $false
            timeZone           = $timeZone
            autoQueueFollowups = $true
            followupDelayHours = 48
            followupMaxLeads   = 25
            followupSequence   = 1
        } | ConvertTo-Json -Compress)

    $seedPayload = (@{
            uid                = $uid
            templateId         = $templateId
            dryRun             = $false
            forceRun           = $false
            timeZone           = $timeZone
            autoQueueFollowups = $true
            followupDelayHours = 48
            followupMaxLeads   = 25
            followupSequence   = 1
        } | ConvertTo-Json -Compress)

    Upsert-SchedulerJob -JobName "revenue-day1-$business-start" -Cron $startCron -Body $startPayload

    $seedD5Payload = (@{
            uid                = $uid
            templateId         = $templateId
            dryRun             = $false
            forceRun           = $false
            timeZone           = $timeZone
            autoQueueFollowups = $true
            followupDelayHours = 120
            followupMaxLeads   = 25
            followupSequence   = 2
        } | ConvertTo-Json -Compress)

    $seedD10Payload = (@{
            uid                = $uid
            templateId         = $templateId
            dryRun             = $false
            forceRun           = $false
            timeZone           = $timeZone
            autoQueueFollowups = $true
            followupDelayHours = 240
            followupMaxLeads   = 25
            followupSequence   = 3
        } | ConvertTo-Json -Compress)

    $seedD14Payload = (@{
            uid                = $uid
            templateId         = $templateId
            dryRun             = $false
            forceRun           = $false
            timeZone           = $timeZone
            autoQueueFollowups = $true
            followupDelayHours = 336
            followupMaxLeads   = 25
            followupSequence   = 4
        } | ConvertTo-Json -Compress)

    Upsert-SchedulerJob -JobName "revenue-day1-$business-followup-seed" -Cron $seedD2Cron -Body $seedPayload
    Upsert-SchedulerJob -JobName "revenue-day1-$business-followup-seed-d5" -Cron $seedD5Cron -Body $seedD5Payload
    Upsert-SchedulerJob -JobName "revenue-day1-$business-followup-seed-d10" -Cron $seedD10Cron -Body $seedD10Payload
    Upsert-SchedulerJob -JobName "revenue-day1-$business-followup-seed-d14" -Cron $seedD14Cron -Body $seedD14Payload
}

Write-Output "Configured Day1 scheduler jobs (start + D+2/D+5/D+10/D+14 followup seeds) for rts/rng/aicf in $timeZone."
