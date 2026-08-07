[CmdletBinding()]
param(
    [ValidateSet("Canary", "Finalize", "Verify")]
    [string]$CutoverPhase = "Canary",
    [switch]$RunOidcCanary
)

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

function Resolve-GcloudCommand {
    foreach ($candidate in @("gcloud.cmd", "gcloud.ps1", "gcloud")) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    throw "gcloud CLI is required but was not found on PATH."
}

$script:GcloudCommand = Resolve-GcloudCommand

function Invoke-Gcloud {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args
    )

    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $script:GcloudCommand @Args 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }

    $message = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
    if ($exitCode -ne 0) {
        throw "gcloud command failed: gcloud $($Args -join ' ')`n$message"
    }
    return $message
}

function Try-Gcloud {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args
    )

    $errorFile = [System.IO.Path]::GetTempFileName()
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $output = & $script:GcloudCommand @Args 2> $errorFile
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        $errorText = Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue
        return [PSCustomObject]@{
            ExitCode = $exitCode
            Output = ($output | ForEach-Object { "$_" }) -join [Environment]::NewLine
            Error = "$errorText".Trim()
        }
    } finally {
        Remove-Item -LiteralPath $errorFile -ErrorAction SilentlyContinue -Force
    }
}

function Invoke-GcloudJsonOutput {
    param([Parameter(Mandatory = $true)][string[]]$Args)
    $result = Try-Gcloud -Args $Args
    if ($result.ExitCode -ne 0) {
        throw "gcloud JSON command failed: gcloud $($Args -join ' ')`n$($result.Error)"
    }
    return $result.Output
}

function Get-GcloudIdentityToken {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$Audience,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )
    $errorFile = [System.IO.Path]::GetTempFileName()
    try {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $stdout = & $script:GcloudCommand auth print-identity-token `
                --impersonate-service-account $ServiceAccountEmail `
                --audiences $Audience `
                --include-email `
                --project $ProjectId `
                --quiet 2> $errorFile
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousPreference
        }
        if ($exitCode -ne 0) {
            $errorText = Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue
            throw "Unable to mint the OIDC canary token. $errorText"
        }
        $jwtLines = @($stdout | ForEach-Object { "$_".Trim() } | Where-Object {
            $_ -match "^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"
        })
        if ($jwtLines.Count -ne 1) {
            throw "OIDC canary did not return exactly one identity token."
        }
        return $jwtLines[0]
    } finally {
        Remove-Item -LiteralPath $errorFile -ErrorAction SilentlyContinue -Force
    }
}

function Test-NotFoundResult {
    param([Parameter(Mandatory = $true)]$Result)
    return $Result.ExitCode -ne 0 -and "$($Result.Output)`n$($Result.Error)" -match "(?i)NOT_FOUND|not\s+found"
}

function ConvertFrom-GcloudJson {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][string]$ResourceLabel
    )
    try {
        return $Json | ConvertFrom-Json -Depth 50
    } catch {
        throw "Unable to parse gcloud JSON for $ResourceLabel."
    }
}

function Assert-ServiceOrigin {
    param([Parameter(Mandatory = $true)][string]$Value)
    $parsed = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$parsed)) {
        throw "REVENUE_AUTOMATION_SERVICE_URL must be an absolute URL."
    }
    if (
        $parsed.Scheme -ne "https" -or
        $parsed.Host -notmatch "(?i)\.run\.app$" -or
        -not [string]::IsNullOrWhiteSpace($parsed.UserInfo) -or
        -not [string]::IsNullOrWhiteSpace($parsed.Query) -or
        -not [string]::IsNullOrWhiteSpace($parsed.Fragment) -or
        ($parsed.AbsolutePath -ne "/" -and $parsed.AbsolutePath -ne "")
    ) {
        throw "REVENUE_AUTOMATION_SERVICE_URL must be an exact HTTPS *.run.app Cloud Run service origin."
    }
}

function Get-SchedulerJob {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )
    $result = Try-Gcloud -Args @(
        "scheduler", "jobs", "describe", $JobName,
        "--location", $Location,
        "--project", $ProjectId,
        "--format=json"
    )
    if ($result.ExitCode -eq 0) {
        return ConvertFrom-GcloudJson -Json $result.Output -ResourceLabel "scheduler job '$JobName'"
    }
    if (Test-NotFoundResult -Result $result) { return $null }
    throw "Unable to determine scheduler job state for '$JobName'.`n$($result.Error)"
}

function Ensure-DedicatedServiceAccount {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][bool]$AllowCreate
    )
    $result = Try-Gcloud -Args @(
        "iam", "service-accounts", "describe", $ServiceAccountEmail,
        "--project", $ProjectId,
        "--format=json(email,disabled)"
    )
    if ($result.ExitCode -eq 0) {
        $account = ConvertFrom-GcloudJson -Json $result.Output -ResourceLabel "revenue scheduler service account"
        if ($account.disabled -eq $true) {
            throw "The dedicated revenue scheduler service account is disabled."
        }
        return
    }
    if (-not (Test-NotFoundResult -Result $result)) {
        throw "Unable to inspect the dedicated revenue scheduler service account.`n$($result.Error)"
    }
    if (-not $AllowCreate) {
        throw "The dedicated revenue scheduler service account does not exist. Run the Canary phase first."
    }

    Invoke-Gcloud -Args @(
        "iam", "service-accounts", "create", "revenue-automation-scheduler",
        "--project", $ProjectId,
        "--display-name", "Revenue automation scheduler"
    ) | Out-Null
}

function Ensure-CloudRunInvoker {
    param(
        [Parameter(Mandatory = $true)][string]$CloudRunService,
        [Parameter(Mandatory = $true)][string]$CloudRunRegion,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$ServiceAccountEmail
    )
    Invoke-Gcloud -Args @(
        "run", "services", "add-iam-policy-binding", $CloudRunService,
        "--region", $CloudRunRegion,
        "--project", $ProjectId,
        "--member", "serviceAccount:$ServiceAccountEmail",
        "--role", "roles/run.invoker",
        "--quiet"
    ) | Out-Null
}

function Get-CloudRunEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$CloudRunService,
        [Parameter(Mandatory = $true)][string]$CloudRunRegion,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )
    $json = Invoke-GcloudJsonOutput -Args @(
        "run", "services", "describe", $CloudRunService,
        "--region", $CloudRunRegion,
        "--project", $ProjectId,
        "--format=json(status.url,spec.template.spec.timeoutSeconds,spec.template.spec.containers[0].env)"
    )
    return ConvertFrom-GcloudJson -Json $json -ResourceLabel "Cloud Run environment"
}

function Get-EnvironmentValue {
    param(
        [Parameter(Mandatory = $true)]$ServiceDescription,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $containers = @($ServiceDescription.spec.template.spec.containers)
    if ($containers.Count -eq 0) { return "" }
    foreach ($entry in @($containers[0].env)) {
        if ($entry.name -eq $Name -and $null -ne $entry.value) { return "$($entry.value)".Trim() }
    }
    return ""
}

function Assert-CloudRunAuthConfiguration {
    param(
        [Parameter(Mandatory = $true)]$ServiceDescription,
        [Parameter(Mandatory = $true)][string]$ExpectedServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$ExpectedAudience,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    $runtimeServiceAccount = Get-EnvironmentValue -ServiceDescription $ServiceDescription -Name "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL"
    $runtimeAudience = Get-EnvironmentValue -ServiceDescription $ServiceDescription -Name "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE"
    $runtimeUid = Get-EnvironmentValue -ServiceDescription $ServiceDescription -Name "REVENUE_AUTOMATION_UID"
    $legacyAllowed = (Get-EnvironmentValue -ServiceDescription $ServiceDescription -Name "REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN").ToLowerInvariant() -eq "true"

    if ("$($ServiceDescription.status.url)".TrimEnd("/") -ne $ExpectedAudience.TrimEnd("/")) {
        throw "Cloud Run status URL does not match the revenue worker OIDC audience."
    }
    if ([int]$ServiceDescription.spec.template.spec.timeoutSeconds -lt 900) {
        throw "Cloud Run must use a request timeout of at least 900 seconds for revenue workers."
    }

    if ($runtimeServiceAccount -ne $ExpectedServiceAccountEmail) {
        throw "Cloud Run does not have the exact revenue scheduler service account configured."
    }
    if ($runtimeAudience -ne $ExpectedAudience) {
        throw "Cloud Run does not have the exact revenue worker OIDC audience configured."
    }
    if ([string]::IsNullOrWhiteSpace($runtimeUid)) {
        throw "Cloud Run does not have REVENUE_AUTOMATION_UID configured."
    }
    if ($Phase -eq "Canary" -and -not $legacyAllowed) {
        throw "Canary requires REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN=true in the deployed revision."
    }
    if ($Phase -ne "Canary" -and $legacyAllowed) {
        throw "Finalize/Verify requires REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN to be false or removed."
    }
}

function Set-SchedulerJobOidc {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$Cron,
        [Parameter(Mandatory = $true)][string]$TimeZone,
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$OidcAudience,
        [Parameter(Mandatory = $true)][string]$ServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location,
        [Parameter(Mandatory = $true)][string]$BodyJson
    )

    $existing = Get-SchedulerJob -JobName $JobName -ProjectId $ProjectId -Location $Location
    $bodyFile = [System.IO.Path]::GetTempFileName()
    try {
        Set-Content -LiteralPath $bodyFile -Value $BodyJson -NoNewline -Encoding Ascii
        $commonArgs = @(
            "--location", $Location,
            "--project", $ProjectId,
            "--schedule", $Cron,
            "--time-zone", $TimeZone,
            "--uri", $Uri,
            "--http-method", "POST",
            "--oidc-service-account-email", $ServiceAccountEmail,
            "--oidc-token-audience", $OidcAudience,
            "--message-body-from-file", $bodyFile,
            "--attempt-deadline", "900s",
            "--max-retry-attempts", "3",
            "--min-backoff", "60s",
            "--max-backoff", "300s",
            "--max-doublings", "2"
        )
        if ($null -eq $existing) {
            Invoke-Gcloud -Args (@(
                "scheduler", "jobs", "create", "http", $JobName,
                "--headers", "Content-Type=application/json",
                "--max-retry-duration", "0s"
            ) + $commonArgs) | Out-Null
        } else {
            # Header mutation flags are mutually exclusive in gcloud. Clear the
            # legacy Authorization header first, then restore Content-Type.
            Invoke-Gcloud -Args (@(
                "scheduler", "jobs", "update", "http", $JobName,
                "--clear-headers",
                "--clear-max-retry-duration"
            ) + $commonArgs) | Out-Null
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "update", "http", $JobName,
                "--location", $Location,
                "--project", $ProjectId,
                "--oidc-service-account-email", $ServiceAccountEmail,
                "--oidc-token-audience", $OidcAudience,
                "--update-headers", "Content-Type=application/json"
            ) | Out-Null
        }
        if ($null -ne $existing -and "$($existing.state)" -eq "PAUSED") {
            Invoke-Gcloud -Args @(
                "scheduler", "jobs", "resume", $JobName,
                "--location", $Location,
                "--project", $ProjectId,
                "--quiet"
            ) | Out-Null
        }
    } finally {
        Remove-Item -LiteralPath $bodyFile -ErrorAction SilentlyContinue -Force
    }
}

function Assert-SchedulerJobOidc {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$ExpectedUri,
        [Parameter(Mandatory = $true)][string]$ExpectedAudience,
        [Parameter(Mandatory = $true)][string]$ExpectedServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$ExpectedCron,
        [Parameter(Mandatory = $true)][string]$ExpectedTimeZone,
        [Parameter(Mandatory = $true)][string]$ExpectedBodyJson,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )
    $job = Get-SchedulerJob -JobName $JobName -ProjectId $ProjectId -Location $Location
    if ($null -eq $job) { throw "Required scheduler job '$JobName' is missing." }
    if ($job.httpTarget.uri -ne $ExpectedUri) { throw "Scheduler job '$JobName' has an unexpected URI." }
    if ($job.httpTarget.httpMethod -ne "POST") { throw "Scheduler job '$JobName' must use POST." }
    if ($job.httpTarget.oidcToken.audience -ne $ExpectedAudience) { throw "Scheduler job '$JobName' has an unexpected OIDC audience." }
    if ($job.httpTarget.oidcToken.serviceAccountEmail -ne $ExpectedServiceAccountEmail) { throw "Scheduler job '$JobName' has an unexpected OIDC principal." }
    if ($job.schedule -ne $ExpectedCron -or $job.timeZone -ne $ExpectedTimeZone) { throw "Scheduler job '$JobName' has an unexpected cadence." }
    if ($job.state -ne "ENABLED") { throw "Scheduler job '$JobName' must be enabled." }
    if ($job.attemptDeadline -ne "900s") { throw "Scheduler job '$JobName' must use a 900-second attempt deadline." }
    if ([int]$job.retryConfig.retryCount -ne 3 -or $job.retryConfig.minBackoffDuration -ne "60s" -or $job.retryConfig.maxBackoffDuration -ne "300s" -or [int]$job.retryConfig.maxDoublings -ne 2) {
        throw "Scheduler job '$JobName' has an unexpected retry policy."
    }

    try {
        $actualBodyJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("$($job.httpTarget.body)"))
        $actualBody = $actualBodyJson | ConvertFrom-Json
        $expectedBody = $ExpectedBodyJson | ConvertFrom-Json
    } catch {
        throw "Scheduler job '$JobName' has an invalid JSON body."
    }
    if ($null -ne $actualBody.PSObject.Properties["uid"]) {
        throw "Scheduler job '$JobName' must not contain a caller-supplied uid."
    }
    $actualCanonicalBody = $actualBody | ConvertTo-Json -Compress -Depth 20
    $expectedCanonicalBody = $expectedBody | ConvertTo-Json -Compress -Depth 20
    if ($actualCanonicalBody -ne $expectedCanonicalBody) {
        throw "Scheduler job '$JobName' has an unexpected request body."
    }

    if ($null -eq $job.httpTarget.headers -or "$($job.httpTarget.headers.'Content-Type')" -ne "application/json") {
        throw "Scheduler job '$JobName' must send Content-Type=application/json."
    }

    if ($null -ne $job.httpTarget.headers) {
        foreach ($header in @($job.httpTarget.headers.PSObject.Properties)) {
            if ($header.Name -match "(?i)^authorization$|^x-revenue-(automation|day1|day2|day30|pos|weekly-kpi)-token$") {
                throw "Scheduler job '$JobName' retains a forbidden static authentication header."
            }
        }
    }
}

function Remove-SchedulerJobIfExists {
    param(
        [Parameter(Mandatory = $true)][string]$JobName,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )
    $job = Get-SchedulerJob -JobName $JobName -ProjectId $ProjectId -Location $Location
    if ($null -ne $job) {
        Invoke-Gcloud -Args @(
            "scheduler", "jobs", "delete", $JobName,
            "--location", $Location,
            "--project", $ProjectId,
            "--quiet"
        ) | Out-Null
    }
}

function Assert-NoRevenueStaticAuthenticationHeaders {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location
    )
    $json = Invoke-GcloudJsonOutput -Args @(
        "scheduler", "jobs", "list",
        "--location", $Location,
        "--project", $ProjectId,
        "--format=json(name,httpTarget.headers)"
    )
    $jobs = @(ConvertFrom-GcloudJson -Json $json -ResourceLabel "revenue scheduler inventory")
    $violations = @()
    foreach ($job in $jobs) {
        $jobName = "$($job.name)".Split("/")[-1]
        if ($jobName -notlike "revenue-*") { continue }
        if ($null -ne $job.httpTarget.headers) {
            foreach ($header in @($job.httpTarget.headers.PSObject.Properties)) {
                if ($header.Name -match "(?i)^authorization$|^x-revenue-(automation|day1|day2|day30|pos|weekly-kpi)-token$") {
                    $violations += $jobName
                }
            }
        }
    }
    if ($violations.Count -gt 0) {
        throw "Revenue Scheduler jobs retain forbidden static authentication headers: $((@($violations | Sort-Object -Unique)) -join ', ')"
    }
}

function Export-SchedulerRollbackBundle {
    param(
        [Parameter(Mandatory = $true)][string[]]$ManagedJobNames,
        [Parameter(Mandatory = $true)][string[]]$LegacyJobNames,
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$Location,
        [Parameter(Mandatory = $true)][string]$Phase
    )
    $root = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_ROLLBACK_DIR" -Default (Join-Path (Get-Location) "artifacts/revenue-scheduler-rollback")
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
    $directory = Join-Path $root "$stamp-$($Phase.ToLowerInvariant())"
    New-Item -ItemType Directory -Path $directory -Force | Out-Null

    $inventoryJson = Invoke-GcloudJsonOutput -Args @(
        "scheduler", "jobs", "list",
        "--location", $Location,
        "--project", $ProjectId,
        "--format=json(name,state,schedule,timeZone,attemptDeadline,retryConfig,httpTarget.uri,httpTarget.httpMethod,httpTarget.headers,httpTarget.oidcToken)"
    )
    $wantedNames = @($ManagedJobNames + $LegacyJobNames | Sort-Object -Unique)
    $sanitizedJobs = @()
    foreach ($job in @(ConvertFrom-GcloudJson -Json $inventoryJson -ResourceLabel "scheduler rollback inventory")) {
        $jobName = "$($job.name)".Split("/")[-1]
        if ($jobName -notin $wantedNames) { continue }
        $headerNames = @()
        if ($null -ne $job.httpTarget.headers) {
            $headerNames = @($job.httpTarget.headers.PSObject.Properties.Name | Sort-Object)
        }
        $sanitizedJobs += [PSCustomObject]@{
            name = $jobName
            state = $job.state
            schedule = $job.schedule
            timeZone = $job.timeZone
            attemptDeadline = $job.attemptDeadline
            retryConfig = $job.retryConfig
            uri = $job.httpTarget.uri
            httpMethod = $job.httpTarget.httpMethod
            oidcServiceAccountEmail = $job.httpTarget.oidcToken.serviceAccountEmail
            oidcAudience = $job.httpTarget.oidcToken.audience
            headerNames = $headerNames
            hadStaticAuthenticationHeader = @($headerNames | Where-Object {
                $_ -match "(?i)^authorization$|^x-revenue-(automation|day1|day2|day30|pos|weekly-kpi)-token$"
            }).Count -gt 0
        }
    }
    $manifest = [PSCustomObject]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        phase = $Phase
        projectId = $ProjectId
        location = $Location
        containsSecretValues = $false
        rollbackPolicy = "Pause managed OIDC jobs; never restore static bearer headers."
        jobs = $sanitizedJobs
    }
    $manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $directory "scheduler-sanitized-manifest.json") -Encoding UTF8

    $quotedNames = @($ManagedJobNames | Sort-Object -Unique | ForEach-Object { "    `"$($_.Replace('`"',''))`"" }) -join ",`n"
    $pauseScript = @"
[CmdletBinding()]
param(
    [string]`$ProjectId = "$ProjectId",
    [string]`$Location = "$Location"
)
`$ErrorActionPreference = "Stop"
`$jobs = @(
$quotedNames
)
foreach (`$job in `$jobs) {
    gcloud scheduler jobs pause `$job --project `$ProjectId --location `$Location --quiet
    if (`$LASTEXITCODE -ne 0) { throw "Unable to pause `$job" }
}
Write-Output "Managed revenue jobs paused. Static bearer authentication was not restored."
"@
    Set-Content -LiteralPath (Join-Path $directory "pause-managed-jobs.ps1") -Value $pauseScript -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $directory "README.txt") -Value "This sanitized bundle contains no token values. Run pause-managed-jobs.ps1 to stop the new OIDC cadence while a corrected OIDC revision is deployed. Do not restore legacy bearer headers." -Encoding UTF8
    Write-Output "Sanitized scheduler rollback bundle written to $directory"
}

function Invoke-OidcCanary {
    param(
        [Parameter(Mandatory = $true)][string]$ServiceAccountEmail,
        [Parameter(Mandatory = $true)][string]$Audience,
        [Parameter(Mandatory = $true)][string]$OutcomeUri,
        [Parameter(Mandatory = $true)][string]$ProjectId
    )
    $identityToken = ""
    try {
        $identityToken = Get-GcloudIdentityToken -ServiceAccountEmail $ServiceAccountEmail -Audience $Audience -ProjectId $ProjectId
        if ([string]::IsNullOrWhiteSpace($identityToken)) { throw "OIDC canary token was empty." }
        $headers = @{
            Authorization = "Bearer $identityToken"
            "Content-Type" = "application/json"
            "x-correlation-id" = "revenue-oidc-canary-$([Guid]::NewGuid().ToString('N'))"
        }
        $response = Invoke-RestMethod -Method Post -Uri $OutcomeUri -Headers $headers -Body "{}" -TimeoutSec 900
        if ($response.ok -ne $true -or @($response.outcomes).Count -ne 2) {
            throw "OIDC canary did not return both canonical outcomes."
        }
    } catch {
        throw "OIDC canary failed. Verify service-account impersonation, Cloud Run invoker IAM, deployed OIDC env, and both active workspace memberships."
    } finally {
        $identityToken = $null
    }
}

$projectId = Get-EnvOrDefault -Name "GCP_PROJECT_ID"
$location = Get-EnvOrDefault -Name "GCP_SCHEDULER_LOCATION" -Default "us-central1"
$cloudRunRegion = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_CLOUD_RUN_REGION" -Default $location
$cloudRunService = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_CLOUD_RUN_SERVICE"
$serviceUrl = (Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SERVICE_URL").TrimEnd("/")
$timeZone = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_TIME_ZONE" -Default "America/Chicago"

if (-not $projectId) { throw "Missing GCP_PROJECT_ID" }
if (-not $cloudRunService) { throw "Missing REVENUE_AUTOMATION_CLOUD_RUN_SERVICE" }
if (-not $serviceUrl) { throw "Missing REVENUE_AUTOMATION_SERVICE_URL" }
Assert-ServiceOrigin -Value $serviceUrl

$expectedServiceAccountEmail = "revenue-automation-scheduler@$projectId.iam.gserviceaccount.com"
$configuredServiceAccountEmail = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL" -Default $expectedServiceAccountEmail
if ($configuredServiceAccountEmail -ne $expectedServiceAccountEmail) {
    throw "REVENUE_AUTOMATION_SCHEDULER_SERVICE_ACCOUNT_EMAIL must name the dedicated canonical account for this project."
}
$oidcAudience = Get-EnvOrDefault -Name "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE" -Default $serviceUrl
if ($oidcAudience -ne $serviceUrl) {
    throw "REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE must exactly match REVENUE_AUTOMATION_SERVICE_URL."
}

$allowMutation = $CutoverPhase -ne "Verify"
$runtime = Get-CloudRunEnvironment -CloudRunService $cloudRunService -CloudRunRegion $cloudRunRegion -ProjectId $projectId
Assert-CloudRunAuthConfiguration -ServiceDescription $runtime -ExpectedServiceAccountEmail $configuredServiceAccountEmail -ExpectedAudience $oidcAudience -Phase $CutoverPhase
Ensure-DedicatedServiceAccount -ServiceAccountEmail $configuredServiceAccountEmail -ProjectId $projectId -AllowCreate $allowMutation
if ($allowMutation) {
    Ensure-CloudRunInvoker -CloudRunService $cloudRunService -CloudRunRegion $cloudRunRegion -ProjectId $projectId -ServiceAccountEmail $configuredServiceAccountEmail
}

$dailyUri = "$serviceUrl/api/revenue/automation/daily/worker-task"
$weeklyUri = "$serviceUrl/api/revenue/day30/worker-task"
$outcomeUri = "$serviceUrl/api/revenue/daily-outcomes/worker-task"
$posUri = "$serviceUrl/api/revenue/pos/worker-task"
$jobs = @(
    [PSCustomObject]@{ Name = "revenue-automation-rts"; Cron = (Get-EnvOrDefault -Name "REVENUE_AUTOMATION_RTS_CRON" -Default "5 5 * * *"); Uri = $dailyUri; Body = (@{ businessKey = "rts"; dryRun = $false; dueOnly = $true; runStages = @("day30"); timeZone = $timeZone; processDueResponses = $true; requireApprovalGates = $true; runCloserQueue = $true; runRevenueMemory = $true; runWeeklyKpi = $false; runServiceLab = $false } | ConvertTo-Json -Compress) },
    [PSCustomObject]@{ Name = "revenue-automation-rng"; Cron = (Get-EnvOrDefault -Name "REVENUE_AUTOMATION_RNG_CRON" -Default "20 5 * * *"); Uri = $dailyUri; Body = (@{ businessKey = "rng"; dryRun = $false; dueOnly = $true; runStages = @("day30"); timeZone = $timeZone; processDueResponses = $true; requireApprovalGates = $true; runCloserQueue = $true; runRevenueMemory = $true; runWeeklyKpi = $false; runServiceLab = $false } | ConvertTo-Json -Compress) },
    [PSCustomObject]@{ Name = "revenue-automation-aicf"; Cron = (Get-EnvOrDefault -Name "REVENUE_AUTOMATION_AICF_CRON" -Default "35 5 * * *"); Uri = $dailyUri; Body = (@{ businessKey = "aicf"; dryRun = $false; dueOnly = $true; runStages = @("day30"); timeZone = $timeZone; processDueResponses = $true; requireApprovalGates = $true; runCloserQueue = $true; runRevenueMemory = $true; runWeeklyKpi = $false; runServiceLab = $false } | ConvertTo-Json -Compress) },
    [PSCustomObject]@{ Name = "revenue-weekly-brain"; Cron = (Get-EnvOrDefault -Name "REVENUE_WEEKLY_BRAIN_CRON" -Default "10 6 * * 1"); Uri = $weeklyUri; Body = (@{ templateIds = @("rts-south-day1", "rng-south-day1", "aicf-south-day1"); dryRun = $false; forceRun = $false; timeZone = $timeZone; processDueResponses = $true; requireApprovalGates = $true; runCloserQueue = $true; runRevenueMemory = $true; runWeeklyKpi = $true; runServiceLab = $true } | ConvertTo-Json -Compress) },
    [PSCustomObject]@{ Name = "revenue-daily-outcome-morning"; Cron = (Get-EnvOrDefault -Name "REVENUE_OUTCOME_MORNING_CRON" -Default "50 5 * * *"); Uri = $outcomeUri; Body = "{}" },
    [PSCustomObject]@{ Name = "revenue-daily-outcome-midday"; Cron = (Get-EnvOrDefault -Name "REVENUE_OUTCOME_MIDDAY_CRON" -Default "0 12 * * *"); Uri = $outcomeUri; Body = "{}" },
    [PSCustomObject]@{ Name = "revenue-daily-outcome-final"; Cron = (Get-EnvOrDefault -Name "REVENUE_OUTCOME_FINAL_CRON" -Default "5 20 * * *"); Uri = $outcomeUri; Body = "{}" },
    [PSCustomObject]@{ Name = "revenue-pos-worker-loop"; Cron = (Get-EnvOrDefault -Name "REVENUE_POS_CRON" -Default "*/5 * * * *"); Uri = $posUri; Body = (@{ limit = 25 } | ConvertTo-Json -Compress) }
)
$legacyJobNames = @(
    "revenue-day1-rts-start", "revenue-day1-rng-start", "revenue-day1-aicf-start",
    "revenue-day1-rts-followup-seed", "revenue-day1-rng-followup-seed", "revenue-day1-aicf-followup-seed",
    "revenue-day1-rts-followup-seed-d5", "revenue-day1-rng-followup-seed-d5", "revenue-day1-aicf-followup-seed-d5",
    "revenue-day1-rts-followup-seed-d10", "revenue-day1-rng-followup-seed-d10", "revenue-day1-aicf-followup-seed-d10",
    "revenue-day1-rts-followup-seed-d14", "revenue-day1-rng-followup-seed-d14", "revenue-day1-aicf-followup-seed-d14",
    "revenue-day2-rts-loop", "revenue-day2-rng-loop", "revenue-day2-aicf-loop",
    "revenue-day30-rts-daily", "revenue-day30-rng-daily", "revenue-day30-aicf-daily", "revenue-day30-weekly-brain"
)

if ($allowMutation) {
    Export-SchedulerRollbackBundle -ManagedJobNames @($jobs.Name) -LegacyJobNames $legacyJobNames -ProjectId $projectId -Location $location -Phase $CutoverPhase
}

# Prove the deployed OIDC path before mutating any live Scheduler job in phase 1.
if ($CutoverPhase -eq "Canary" -or $RunOidcCanary) {
    Invoke-OidcCanary -ServiceAccountEmail $configuredServiceAccountEmail -Audience $oidcAudience -OutcomeUri $outcomeUri -ProjectId $projectId
}

if ($allowMutation) {
    foreach ($job in $jobs) {
        Set-SchedulerJobOidc -JobName $job.Name -Cron $job.Cron -TimeZone $timeZone -Uri $job.Uri -OidcAudience $oidcAudience -ServiceAccountEmail $configuredServiceAccountEmail -ProjectId $projectId -Location $location -BodyJson $job.Body
    }
}
foreach ($job in $jobs) {
    Assert-SchedulerJobOidc -JobName $job.Name -ExpectedUri $job.Uri -ExpectedAudience $oidcAudience -ExpectedServiceAccountEmail $configuredServiceAccountEmail -ExpectedCron $job.Cron -ExpectedTimeZone $timeZone -ExpectedBodyJson $job.Body -ProjectId $projectId -Location $location
}

if ($CutoverPhase -eq "Finalize") {
    foreach ($jobName in $legacyJobNames) {
        Remove-SchedulerJobIfExists -JobName $jobName -ProjectId $projectId -Location $location
    }
}

if ($CutoverPhase -ne "Canary") {
    Assert-NoRevenueStaticAuthenticationHeaders -ProjectId $projectId -Location $location
}

Write-Output "Revenue scheduler $CutoverPhase checks completed: exact OIDC principal/audience verified; no token values were read or printed."
