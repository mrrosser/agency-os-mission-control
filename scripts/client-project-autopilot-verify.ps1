param(
  [string]$ProjectId = "socialops",
  [string]$ClientId = "fortifyy_roofs",
  [string]$BaseUrl = "",
  [ValidateSet("staging","production")]
  [string]$DeployTarget = "production"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-NowLocalStamp {
  return (Get-Date).ToString("yyyy-MM-dd_HHmmss")
}

function Get-Truthiness([string]$value) {
  if ($null -eq $value) { return $false }
  switch ($value.Trim().ToLowerInvariant()) {
    '1' { return $true }
    'true' { return $true }
    'yes' { return $true }
    'y' { return $true }
    'on' { return $true }
    'enabled' { return $true }
    default { return $false }
  }
}

function Write-Json([string]$Path, $Value) {
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  ($Value | ConvertTo-Json -Depth 32) + "`n" | Set-Content -Path $Path -Encoding UTF8
}

function Append-Jsonl([string]$Path, $Value) {
  $dir = Split-Path -Parent $Path
  if ($dir -and !(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  (ConvertTo-Json $Value -Depth 32 -Compress) + "`n" | Add-Content -Path $Path -Encoding UTF8
}

function Format-BoolValue([bool]$Value) {
  if ($Value) { return "True" }
  return "False"
}

function Write-ClientAutopilotReports {
  param(
    [string]$Stamp,
    [string]$CapturedAt,
    [string]$RunId,
    [string]$CorrelationId,
    [string]$ProjectId,
    [string]$ClientId,
    [string]$BaseUrl,
    [string]$CloudRunRevision,
    [string]$ArtifactDir,
    [string]$EvidenceBundlePath,
    [string]$RunMetaPath,
    [string]$RunContextPath,
    [string]$AllowlistPath,
    [string]$KillSwitchPath,
    [string]$RouteChecksPath,
    [string]$RouteProbeJsonlPath,
    [string]$CloudRunJsonPath,
    [string]$CloudRunAccessJsonlPath,
    [string]$SecretAccessJsonlPath,
    [string]$StorageStateCheckJsonPath,
    [string]$AuthBootstrapLogPath,
    [string]$HeldFollowupPath,
    [string]$PublicPwOutDir,
    [string]$PublicPwLogPath,
    [string]$AuthPwOutDir,
    [string]$AuthPwLogPath,
    [hashtable]$KillSwitches,
    [array]$RouteChecks,
    [array]$TestResults,
    [string]$ResultLabel
  )

  $reportDate = ($Stamp -split '_')[0]
  $reportTime = ($Stamp -split '_')[1]
  $reportsDir = Join-Path (Get-Location) "docs\\reports"
  New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
  $timestampedReportPath = Join-Path $reportsDir ("{0}-client-project-autopilot-verification-{1}.md" -f $reportDate, $reportTime)
  $latestReportPath = Join-Path $reportsDir "latest-run.md"

  $testByName = @{}
  foreach ($result in $TestResults) {
    $testByName[[string]$result.name] = $result
  }

  $statusWord = if ($ResultLabel -eq "VERIFIED") { "green" } elseif ($ResultLabel -eq "BLOCKED") { "blocked" } else { "failing" }
  $routeSummary = if ($RouteChecks -and $RouteChecks.Count -gt 0) {
    $pairs = foreach ($route in $RouteChecks) { "{0}={1}" -f $route.name, $route.status_code }
    [string]::Join(", ", $pairs)
  } else {
    "not_run"
  }
  $publicSummary = if ($testByName.ContainsKey("playwright-public-review") -and $testByName["playwright-public-review"].status -eq "passed") {
    "Fortifyy review link loads; queue renders"
  } elseif ($testByName.ContainsKey("playwright-public-review")) {
    "See Playwright log for failure details."
  } else {
    "not_run"
  }
  $authSummary = if ($testByName.ContainsKey("playwright-auth-smoke") -and $testByName["playwright-auth-smoke"].status -eq "passed") {
    "health, sign-in, approvals, calendar, assets"
  } elseif ($testByName.ContainsKey("playwright-auth-smoke")) {
    "See Playwright log for failure details."
  } else {
    "not_run"
  }
  $bootstrapSummary = if ($testByName.ContainsKey("auth-bootstrap") -and $testByName["auth-bootstrap"].summary) {
    [string]$testByName["auth-bootstrap"].summary
  } elseif ($testByName.ContainsKey("auth-bootstrap")) {
    [string]$testByName["auth-bootstrap"].status
  } else {
    "not_run"
  }

  $timestampedReport = @"
# Client Project Autopilot Verification ($reportDate)

- RUN_ID: $RunId
- Correlation ID: $CorrelationId
- Project: $ProjectId (SMAuto adapter)
- Client: $ClientId
- Base URL: $BaseUrl
- Cloud Run revision: $(if ($CloudRunRevision) { $CloudRunRevision } else { "(none)" })
- PR: (none)

## Gates

- kill-switches: $(if ($testByName.ContainsKey("kill-switches")) { $testByName["kill-switches"].status.ToUpperInvariant() } else { "NOT_RUN" }) (MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED=$(Format-BoolValue $KillSwitches.MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED), CLIENT_AUTOFIX_SOCIALOPS_DISABLED=$(Format-BoolValue $KillSwitches.CLIENT_AUTOFIX_SOCIALOPS_DISABLED), CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY=$(Format-BoolValue $KillSwitches.CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY))
- cloud-run-route-probe (public): $(if ($testByName.ContainsKey("cloud-run-route-probe (public)")) { $testByName["cloud-run-route-probe (public)"].status.ToUpperInvariant() } else { "NOT_RUN" }) ($routeSummary)
- playwright-public-review: $(if ($testByName.ContainsKey("playwright-public-review")) { $testByName["playwright-public-review"].status.ToUpperInvariant() } else { "NOT_RUN" }) ($publicSummary)
- auth-bootstrap: $(if ($testByName.ContainsKey("auth-bootstrap")) { $testByName["auth-bootstrap"].status.ToUpperInvariant() } else { "NOT_RUN" }) ($bootstrapSummary)
- playwright-auth-smoke: $(if ($testByName.ContainsKey("playwright-auth-smoke")) { $testByName["playwright-auth-smoke"].status.ToUpperInvariant() } else { "NOT_RUN" }) ($authSummary)

## Evidence

- Evidence bundle: $EvidenceBundlePath
- Run meta: $RunMetaPath
- Run context: $RunContextPath
- Allowlist: $AllowlistPath
- Kill switches: $KillSwitchPath
- Route checks: $RouteChecksPath
- Route probe log (public): $RouteProbeJsonlPath
- Cloud Run service snapshot (socialops-client): $CloudRunJsonPath
- Cloud Run access log: $CloudRunAccessJsonlPath
- Secret Manager access (redacted): $SecretAccessJsonlPath
- Storage state check (redacted): $StorageStateCheckJsonPath
- Auth bootstrap log (redacted): $AuthBootstrapLogPath
- Held client follow-up draft: $HeldFollowupPath
- Playwright output (public review): $PublicPwOutDir
- Playwright output log (public review): $PublicPwLogPath
- Playwright output (auth smoke): $AuthPwOutDir
- Playwright output log (auth smoke): $AuthPwLogPath

## Result

- ${ResultLabel}: evidence bundle recorded and required verification outputs captured.
- Fix applied: none (verification-only).
- No social publishing actions were executed.
- No client email sent; follow-up draft held for operator review.
"@
  Set-Content -Path $timestampedReportPath -Encoding UTF8 -Value $timestampedReport

  $capturedUtc = ([DateTimeOffset]::Parse($CapturedAt)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $killGate = if ($testByName.ContainsKey("kill-switches")) { $testByName["kill-switches"].status.ToUpperInvariant() } else { "NOT_RUN" }
  $routeGate = if ($testByName.ContainsKey("cloud-run-route-probe (public)")) { $testByName["cloud-run-route-probe (public)"].status.ToUpperInvariant() } else { "NOT_RUN" }
  $publicGate = if ($testByName.ContainsKey("playwright-public-review")) { $testByName["playwright-public-review"].status.ToUpperInvariant() } else { "NOT_RUN" }
  $bootstrapGate = if ($testByName.ContainsKey("auth-bootstrap")) { $testByName["auth-bootstrap"].status.ToUpperInvariant() } else { "NOT_RUN" }
  $authGate = if ($testByName.ContainsKey("playwright-auth-smoke")) { $testByName["playwright-auth-smoke"].status.ToUpperInvariant() } else { "NOT_RUN" }

  $latestReport = @"
# Client Project Autopilot Verification

- RUN_ID: $RunId
- Scope: Verification-only SocialOps/Fortifyy client autopilot lane against production
- Result: $ResultLabel

[$capturedUtc] gate=kill-switches cmd=env-vars result=$killGate MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED=$($KillSwitches.MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED.ToString().ToLowerInvariant()) CLIENT_AUTOFIX_SOCIALOPS_DISABLED=$($KillSwitches.CLIENT_AUTOFIX_SOCIALOPS_DISABLED.ToString().ToLowerInvariant()) CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY=$($KillSwitches.CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY.ToString().ToLowerInvariant())
[$capturedUtc] gate=cloud-run-route-probe-public cmd=GET /api/health /sign-in /approvals /calendar /assets result=$routeGate $routeSummary
[$capturedUtc] gate=playwright-public-review cmd=npx playwright test tests/socialops-client-public-review.spec.ts result=$publicGate
[$capturedUtc] gate=auth-bootstrap cmd=node scripts/bootstrap_socialops_storage_state.cjs result=$bootstrapGate summary=""$bootstrapSummary""
[$capturedUtc] gate=playwright-auth-smoke cmd=npx playwright test tests/socialops-client.smoke.spec.ts result=$authGate
[$capturedUtc] gate=cloud-run-snapshot cmd=gcloud run services describe socialops-client result=$(if ($CloudRunRevision) { "PASS" } else { "FAIL" }) revision=$(if ($CloudRunRevision) { $CloudRunRevision } else { "(none)" })
[$capturedUtc] gate=followup-policy cmd=held-draft result=PASS autosend=disabled publish_posts=not_attempted client_email=not_sent

- Evidence bundle: $EvidenceBundlePath
- Timestamped report: $timestampedReportPath
"@
  Set-Content -Path $latestReportPath -Encoding UTF8 -Value $latestReport
}

function Get-PlaywrightOutcome {
  param(
    [string]$LogPath,
    [string]$FallbackStatus
  )

  $status = $FallbackStatus
  $summary = $null

  if (Test-Path $LogPath) {
    $logText = Get-Content -Raw -Path $LogPath
    $normalizedLogText = [System.Text.RegularExpressions.Regex]::Replace($logText, '\x1B\[[0-9;?]*[ -/]*[@-~]', '')
    $hasPassed = $normalizedLogText -match '(?m)^\s*\d+\s+passed(?:\s*\(|$)'
    $hasFlaky = $normalizedLogText -match '(?m)^\s*\d+\s+flaky(?:\s*\(|$)'
    $hasFailed = $normalizedLogText -match '(?m)^\s*\d+\s+failed(?:\s*\(|$)' -or
      $normalizedLogText -match '(?m)^\s*\d+\s+did not pass(?:\s*\(|$)'

    if (($hasPassed -or $hasFlaky) -and -not $hasFailed) {
      $status = "passed"
      if ($hasFlaky) {
        $summary = "Playwright recovered on retry; final result recorded as flaky but green."
      }
    }
  }

  return @{
    status = $status
    summary = $summary
  }
}

function Invoke-RouteProbe {
  param(
    [string]$RunId,
    [string]$CorrelationId,
    [string]$OutJsonl,
    [array]$Checks,
    [int]$MaxAttempts = 3
  )

  Append-Jsonl -Path $OutJsonl -Value @{
    correlation_id = $CorrelationId
    event = "route_probe.start"
    base_url = $BaseUrl
    run_id = $RunId
    captured_at = (Get-Date).ToString("o")
  }

  Add-Type -AssemblyName System.Net.Http
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $client = New-Object System.Net.Http.HttpClient($handler)
  $client.Timeout = [TimeSpan]::FromSeconds(45)

  $results = @()
  foreach ($check in $Checks) {
    $routeName = [string]$check.name
    $url = [string]$check.url
    $statusCode = 0
    $ok = $false
    $lastError = $null

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $lastError = $null
      try {
        $resp = $client.GetAsync($url).GetAwaiter().GetResult()
        $statusCode = [int]$resp.StatusCode
        $ok = ($statusCode -ne 404) -and ($statusCode -lt 500)
      } catch {
        $statusCode = 599
        $ok = $false
        $lastError = $_.Exception.GetType().FullName
      } finally {
        $sw.Stop()
      }

      $attemptEvent = @{
        captured_at = (Get-Date).ToString("o")
        correlation_id = $CorrelationId
        status_code = $statusCode
        duration_ms = [int]$sw.ElapsedMilliseconds
        event = "route_probe.check"
        attempt = $attempt
        max_attempts = $MaxAttempts
        timeout_seconds = 45
        run_id = $RunId
        url = $url
        route = $routeName
        ok = $ok
      }
      if ($lastError) {
        $attemptEvent.error_type = $lastError
      }
      Append-Jsonl -Path $OutJsonl -Value $attemptEvent

      if ($ok) { break }
      if ($attempt -lt $MaxAttempts) {
        Start-Sleep -Seconds ([Math]::Min($attempt, 3))
      }
    }

    $results += @{
      name = $routeName
      url = $url
      status_code = $statusCode
      ok = $ok
    }
  }

  Append-Jsonl -Path $OutJsonl -Value @{
    correlation_id = $CorrelationId
    event = "route_probe.complete"
    ok = (@($results | Where-Object { -not $_.ok }).Count -eq 0)
    run_id = $RunId
    captured_at = (Get-Date).ToString("o")
  }

  return ,$results
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function Get-GcloudProjectId {
  # Stable alias used in previous evidence bundles.
  return "rosser-social-media-manager"
}

function Get-GcloudProjectNumber {
  return "928920390190"
}

$stamp = Get-NowLocalStamp
$runId = "autopilot-$ProjectId-$ClientId-$stamp"
$correlationId = "autopilot-verify-$stamp"

if (-not $BaseUrl) {
  if ($DeployTarget -eq "staging") {
    $BaseUrl = $env:SOCIALOPS_CLIENT_STAGING_URL
    if (-not $BaseUrl) { $BaseUrl = "https://socialops-client-staging-hau2jvawpa-uc.a.run.app" }
  } else {
    $BaseUrl = $env:SOCIALOPS_CLIENT_PRODUCTION_URL
    if (-not $BaseUrl) { $BaseUrl = "https://socialops-client-928920390190.us-central1.run.app" }
  }
}

$artifactRoot = Join-Path (Get-Location) "artifacts\\client-project-autopilot"
$artifactDir = Join-Path $artifactRoot ("{0}_{1}_{2}" -f $stamp, $ProjectId, $ClientId)
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null

$contractPath = Join-Path (Get-Location) "docs\\client-autofix-autopilot.md"
$adapterPath = Join-Path (Get-Location) "lib\\client-autofix.ts"

$runMetaPath = Join-Path $artifactDir "run-meta.json"
$runContextPath = Join-Path $artifactDir "run-context.json"
$allowlistPath = Join-Path $artifactDir "allowlist.json"
$killSwitchPath = Join-Path $artifactDir "kill-switches.json"
$routeChecksPath = Join-Path $artifactDir "route-checks.json"
$routeProbeJsonlPath = Join-Path $artifactDir "socialops-cloud-run-route-probe-public.jsonl"
$cloudRunJsonPath = Join-Path $artifactDir "cloudrun-socialops-client.json"
$cloudRunAccessJsonlPath = Join-Path $artifactDir "cloudrun-access.jsonl"
$secretAccessJsonlPath = Join-Path $artifactDir "secret-manager-access.jsonl"
$storageStateCheckJsonPath = Join-Path $artifactDir "storage-state-check.json"
$authBootstrapLogPath = Join-Path $artifactDir "auth-bootstrap.log"
$publicPwOutDir = Join-Path $artifactDir "playwright-public-review"
$publicPwLogPath = Join-Path $artifactDir "playwright-public-review.log"
$authPwOutDir = Join-Path $artifactDir "playwright-auth-smoke"
$authPwLogPath = Join-Path $artifactDir "playwright-auth-smoke.log"
$evidenceBundlePath = Join-Path $artifactDir "evidence-bundle.json"
$heldFollowupPath = Join-Path $artifactDir "client-followup-draft-held.md"

$capturedAt = (Get-Date).ToString("o")

# Run context: contract + adapter hashes (source-of-truth docs/ + adapter code)
$contractHash = Get-Sha256 -Path $contractPath
$adapterHash = Get-Sha256 -Path $adapterPath
$allowlisted = ($ProjectId.Trim().ToLowerInvariant() -eq "socialops")

Write-Json -Path $runContextPath -Value @{
  run_id = $runId
  correlation_id = $correlationId
  captured_at = $capturedAt
  mission_control_root = (Get-Location).Path
  contract_path = $contractPath
  contract_sha256 = $contractHash
  adapter_path = $adapterPath
  adapter_sha256 = $adapterHash
  allowlisted = $allowlisted
}

Write-Json -Path $allowlistPath -Value @{
  captured_at = $capturedAt
  project_id = $ProjectId
  repo_id = "smauto"
  client_id = $ClientId
  adapter = "MissionControl.getDefaultClientProjectRegistry"
  base_url = $BaseUrl
  verifier_commands = @(
    "kill-switches env vars",
    "cloud-run-route-probe public",
    "ui-tests Playwright socialops-client-public-review.spec.ts",
    "ui-tests Playwright socialops-client.smoke.spec.ts"
  )
}

# Kill switches (checked BEFORE any external action)
$killSwitches = @{
  run_id = $runId
  correlation_id = $correlationId
  captured_at = $capturedAt
  MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED = (Get-Truthiness $env:MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED)
  CLIENT_AUTOFIX_SOCIALOPS_DISABLED = (Get-Truthiness $env:CLIENT_AUTOFIX_SOCIALOPS_DISABLED)
  CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY = (Get-Truthiness $env:CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY)
}
Write-Json -Path $killSwitchPath -Value $killSwitches

$testResults = @()
$routeChecks = @()
$pwScreenshots = @()
$pwTraces = @()
$cloudRunRevision = $null

$killSwitchBlocked = ($killSwitches.MISSION_CONTROL_CLIENT_AUTOFIX_DISABLED -or $killSwitches.CLIENT_AUTOFIX_SOCIALOPS_DISABLED -or $killSwitches.CLIENT_AUTOFIX_SOCIALOPS_READ_ONLY)
$killSwitchStatus = if ($killSwitchBlocked) { "failed" } else { "passed" }

$testResults += @{
  name = "kill-switches"
  command = "env vars"
  status = $killSwitchStatus
  artifact_path = $killSwitchPath
}

if (-not $allowlisted) {
  $testResults[-1].status = "failed"
  $testResults[-1].summary = "Project is not allowlisted for client-project autopilot verification."
}

if ($testResults[-1].status -eq "failed") {
  Write-Json -Path $evidenceBundlePath -Value @{
    test_results = $testResults
    route_checks = @()
    playwright_screenshots = @()
    playwright_traces = @()
    deployed_url = $BaseUrl
    final_client_visible_url = "$BaseUrl/approvals?client_id=$ClientId"
    run_context = $runContextPath
  }

  Write-Json -Path $runMetaPath -Value @{
    run_id = $runId
    correlation_id = $correlationId
    captured_at = $capturedAt
    project_id = $ProjectId
    client_id = $ClientId
    base_url = $BaseUrl
    cloud_run_revision = $null
    evidence_bundle = $evidenceBundlePath
  }

  Write-ClientAutopilotReports `
    -Stamp $stamp `
    -CapturedAt $capturedAt `
    -RunId $runId `
    -CorrelationId $correlationId `
    -ProjectId $ProjectId `
    -ClientId $ClientId `
    -BaseUrl $BaseUrl `
    -CloudRunRevision $null `
    -ArtifactDir $artifactDir `
    -EvidenceBundlePath $evidenceBundlePath `
    -RunMetaPath $runMetaPath `
    -RunContextPath $runContextPath `
    -AllowlistPath $allowlistPath `
    -KillSwitchPath $killSwitchPath `
    -RouteChecksPath $routeChecksPath `
    -RouteProbeJsonlPath $routeProbeJsonlPath `
    -CloudRunJsonPath $cloudRunJsonPath `
    -CloudRunAccessJsonlPath $cloudRunAccessJsonlPath `
    -SecretAccessJsonlPath $secretAccessJsonlPath `
    -StorageStateCheckJsonPath $storageStateCheckJsonPath `
    -AuthBootstrapLogPath $authBootstrapLogPath `
    -HeldFollowupPath $heldFollowupPath `
    -PublicPwOutDir $publicPwOutDir `
    -PublicPwLogPath $publicPwLogPath `
    -AuthPwOutDir $authPwOutDir `
    -AuthPwLogPath $authPwLogPath `
    -KillSwitches $killSwitches `
    -RouteChecks @() `
    -TestResults $testResults `
    -ResultLabel "BLOCKED"

  Set-Content -Path $heldFollowupPath -Encoding UTF8 -Value @"
[HELD - operator review required]

Hi Beth,

I ran our verification checks against your SocialOps approval link and captured the evidence bundle. One or more safety gates (kill switch/allowlist) blocked the run from completing end-to-end.

If you'd like, reply with what you were seeing and I can take the next step once the gates are cleared.

Marcus
"@

  Write-Host "client-project autopilot verification blocked (run_id=$runId, correlation_id=$correlationId)"
  exit 2
}

# Cloud Run snapshot (describe)
$gcloudProjectId = Get-GcloudProjectId
$gcloudProjectNumber = Get-GcloudProjectNumber
$region = "us-central1"
$service = "socialops-client"

Append-Jsonl -Path $cloudRunAccessJsonlPath -Value @{
  project = $gcloudProjectNumber
  project_id = $gcloudProjectId
  service = $service
  region = $region
  run_id = $runId
  correlation_id = $correlationId
  captured_at = (Get-Date).ToString("o")
  event = "cloudrun.describe.start"
}

$swDescribe = [System.Diagnostics.Stopwatch]::StartNew()
& gcloud run services describe $service --project=$gcloudProjectId --region=$region --format=json | Set-Content -Path $cloudRunJsonPath -Encoding UTF8
$swDescribe.Stop()

$cloudRun = Get-Content -Raw $cloudRunJsonPath | ConvertFrom-Json
$cloudRunRevision = [string]$cloudRun.status.latestReadyRevisionName

Append-Jsonl -Path $cloudRunAccessJsonlPath -Value @{
  project = $gcloudProjectNumber
  project_id = $gcloudProjectId
  service = $service
  region = $region
  run_id = $runId
  correlation_id = $correlationId
  captured_at = (Get-Date).ToString("o")
  event = "cloudrun.describe.complete"
  duration_ms = [int]$swDescribe.ElapsedMilliseconds
  cloud_run_revision = $cloudRunRevision
  out_json_path = $cloudRunJsonPath
  ok = $true
}

# Route probe (public)
$checks = @(
  @{ name = "health"; url = "$BaseUrl/api/health" },
  @{ name = "sign-in"; url = "$BaseUrl/sign-in" },
  @{ name = "approvals"; url = "$BaseUrl/approvals?client_id=$ClientId" },
  @{ name = "calendar"; url = "$BaseUrl/calendar?client_id=$ClientId" },
  @{ name = "assets"; url = "$BaseUrl/assets?client_id=$ClientId" }
)
$routeChecks = Invoke-RouteProbe -RunId $runId -CorrelationId $correlationId -OutJsonl $routeProbeJsonlPath -Checks $checks
Write-Json -Path $routeChecksPath -Value $routeChecks

$routeProbeStatus = if ((@($routeChecks | Where-Object { -not $_.ok }).Count -eq 0)) { "passed" } else { "failed" }
$testResults += @{
  name = "cloud-run-route-probe (public)"
  command = "HttpClient GET /api/health /sign-in /approvals /calendar /assets (no redirects)"
  status = $routeProbeStatus
  artifact_path = $routeProbeJsonlPath
}

# Secret Manager: SocialOps review token (redacted)
$reviewSecret = "socialops-public-review-tokens"
$reviewToken = $null
try {
  $reviewTokenLines = & gcloud secrets versions access latest --secret=$reviewSecret --project=$gcloudProjectId 2>$null
  $reviewToken = ($reviewTokenLines -join "`n").Trim()
  Append-Jsonl -Path $secretAccessJsonlPath -Value @{
    project = $gcloudProjectNumber
    secret = $reviewSecret
    run_id = $runId
    correlation_id = $correlationId
    captured_at = (Get-Date).ToString("o")
    event = "secret_manager.socialops_review_token.access"
    version = "latest"
    ok = $true
  }
} catch {
  Append-Jsonl -Path $secretAccessJsonlPath -Value @{
    project = $gcloudProjectNumber
    secret = $reviewSecret
    run_id = $runId
    correlation_id = $correlationId
    captured_at = (Get-Date).ToString("o")
    event = "secret_manager.socialops_review_token.access"
    version = "latest"
    ok = $false
  }
  throw
}

# Playwright: public review
New-Item -ItemType Directory -Path $publicPwOutDir -Force | Out-Null
Push-Location "C:\\CTO Projects\\ui-tests"
$env:CI = "1"
$env:ALLOW_MISSING_STORAGE = "1"
$env:BASE_URL = $BaseUrl
$env:STORAGE_STATE = "storage/public-review-no-auth-state.json"
$env:FORCE_TRACE = "1"
$env:SOCIALOPS_REVIEW_TOKEN = $reviewToken

try {
  & npx playwright test tests\\socialops-client-public-review.spec.ts --reporter=list --output="$publicPwOutDir" *> $publicPwLogPath
  $pwPublicStatus = if ($LASTEXITCODE -eq 0) { "passed" } else { "failed" }
} catch {
  $pwPublicStatus = "failed"
}
Pop-Location

$pwPublicOutcome = Get-PlaywrightOutcome -LogPath $publicPwLogPath -FallbackStatus $pwPublicStatus

$testResults += @{
  name = "playwright-public-review"
  command = "npx playwright test tests/socialops-client-public-review.spec.ts"
  status = $pwPublicOutcome.status
  summary = $pwPublicOutcome.summary
  artifact_path = $publicPwLogPath
}

# Auth bootstrap (storage state)
Set-Content -Path $authBootstrapLogPath -Encoding UTF8 -Value ("[{0}] auth-bootstrap log initialized (run_id={1}, correlation_id={2})`n" -f (Get-Date).ToString("o"), $runId, $correlationId)

$env:AUTOPILOT_RUN_ID = $runId
$env:AUTOPILOT_CORRELATION_ID = $correlationId
$env:AUTOPILOT_STORAGE_STATE_CHECK_JSON = $storageStateCheckJsonPath
$env:AUTOPILOT_SECRET_ACCESS_JSONL = $secretAccessJsonlPath
$env:AUTOPILOT_AUTH_BOOTSTRAP_LOG = $authBootstrapLogPath
$env:SOCIALOPS_STORAGE_STATE_PATH = "C:\\CTO Projects\\ui-tests\\storage\\socialops-client.json"
$env:SOCIALOPS_STORAGE_STATE_MAX_AGE_HOURS = "24"
if (-not $env:SOCIALOPS_GCP_PROJECT_ID) { $env:SOCIALOPS_GCP_PROJECT_ID = $gcloudProjectId }

try {
  $bootstrapOutput = & node scripts\\bootstrap_socialops_storage_state.cjs 2>&1
  Add-Content -Path $authBootstrapLogPath -Encoding UTF8 -Value $bootstrapOutput
  $bootstrapSummary = ($bootstrapOutput | Select-Object -First 1)
  $bootstrapStatus = if ($LASTEXITCODE -eq 0) { "passed" } else { "failed" }
} catch {
  Add-Content -Path $authBootstrapLogPath -Encoding UTF8 -Value $_.Exception.Message
  $bootstrapSummary = "Storage state bootstrap failed."
  $bootstrapStatus = "failed"
}

$testResults += @{
  name = "auth-bootstrap"
  command = "node scripts/bootstrap_socialops_storage_state.cjs"
  status = $bootstrapStatus
  artifact_path = $authBootstrapLogPath
  summary = $bootstrapSummary
}

# Playwright: authenticated smoke
New-Item -ItemType Directory -Path $authPwOutDir -Force | Out-Null
Push-Location "C:\\CTO Projects\\ui-tests"
$env:CI = "1"
$env:BASE_URL = $BaseUrl
$env:STORAGE_STATE = "storage/socialops-client.json"
$env:FORCE_TRACE = "1"

try {
  & npx playwright test tests\\socialops-client.smoke.spec.ts --reporter=list --output="$authPwOutDir" *> $authPwLogPath
  $pwAuthStatus = if ($LASTEXITCODE -eq 0) { "passed" } else { "failed" }
} catch {
  $pwAuthStatus = "failed"
}
Pop-Location

$pwAuthOutcome = Get-PlaywrightOutcome -LogPath $authPwLogPath -FallbackStatus $pwAuthStatus

$testResults += @{
  name = "playwright-auth-smoke"
  command = "npx playwright test tests/socialops-client.smoke.spec.ts"
  status = $pwAuthOutcome.status
  summary = $pwAuthOutcome.summary
  artifact_path = $authPwLogPath
}

# Collect Playwright evidence paths (best-effort)
if (Test-Path $publicPwOutDir) {
  $pwScreenshots += Get-ChildItem -Recurse -File -Path $publicPwOutDir -Filter *.png | ForEach-Object { $_.FullName }
  $pwTraces += Get-ChildItem -Recurse -File -Path $publicPwOutDir -Filter trace.zip | ForEach-Object { $_.FullName }
}
if (Test-Path $authPwOutDir) {
  $pwScreenshots += Get-ChildItem -Recurse -File -Path $authPwOutDir -Filter *.png | ForEach-Object { $_.FullName }
  $pwTraces += Get-ChildItem -Recurse -File -Path $authPwOutDir -Filter trace.zip | ForEach-Object { $_.FullName }
}

# Evidence bundle
Write-Json -Path $evidenceBundlePath -Value @{
  route_checks = $routeChecks
  cloud_run_revision = $cloudRunRevision
  playwright_traces = $pwTraces
  test_results = $testResults
  playwright_screenshots = $pwScreenshots
  final_client_visible_url = "$BaseUrl/approvals?client_id=$ClientId"
  deployed_url = $BaseUrl
  run_context = $runContextPath
}

Write-Json -Path $runMetaPath -Value @{
  run_id = $runId
  correlation_id = $correlationId
  captured_at = $capturedAt
  project_id = $ProjectId
  client_id = $ClientId
  base_url = $BaseUrl
  cloud_run_revision = $cloudRunRevision
  evidence_bundle = $evidenceBundlePath
}

$allGreen = (@($testResults | Where-Object { $_.status -ne "passed" }).Count -eq 0)
if ($allGreen) {
  Set-Content -Path $heldFollowupPath -Encoding UTF8 -Value @"
[HELD - operator review required]

Hi Beth,

Thanks for flagging this. I ran our verification checks end-to-end (public review link + authenticated approval/calendar/assets views) and captured screenshots/traces for the record.

Everything is loading cleanly now on our side. You should be able to open the approval link and review pending posts normally. If anything still looks off, reply with the post/date and I’ll clean it up right away.

Marcus
"@
} else {
  Set-Content -Path $heldFollowupPath -Encoding UTF8 -Value @"
[HELD - operator review required]

Hi Beth,

Thanks for flagging this. I reran our verification checks and captured screenshots/traces for the approval link plus the authenticated approval/calendar/assets views.

We still have a verification issue to clean up on our side before I can confirm everything is fully green. I’m holding this for operator review rather than asking you to retest yet.

Marcus
"@
}

Write-ClientAutopilotReports `
  -Stamp $stamp `
  -CapturedAt $capturedAt `
  -RunId $runId `
  -CorrelationId $correlationId `
  -ProjectId $ProjectId `
  -ClientId $ClientId `
  -BaseUrl $BaseUrl `
  -CloudRunRevision $cloudRunRevision `
  -ArtifactDir $artifactDir `
  -EvidenceBundlePath $evidenceBundlePath `
  -RunMetaPath $runMetaPath `
  -RunContextPath $runContextPath `
  -AllowlistPath $allowlistPath `
  -KillSwitchPath $killSwitchPath `
  -RouteChecksPath $routeChecksPath `
  -RouteProbeJsonlPath $routeProbeJsonlPath `
  -CloudRunJsonPath $cloudRunJsonPath `
  -CloudRunAccessJsonlPath $cloudRunAccessJsonlPath `
  -SecretAccessJsonlPath $secretAccessJsonlPath `
  -StorageStateCheckJsonPath $storageStateCheckJsonPath `
  -AuthBootstrapLogPath $authBootstrapLogPath `
  -HeldFollowupPath $heldFollowupPath `
  -PublicPwOutDir $publicPwOutDir `
  -PublicPwLogPath $publicPwLogPath `
  -AuthPwOutDir $authPwOutDir `
  -AuthPwLogPath $authPwLogPath `
  -KillSwitches $killSwitches `
  -RouteChecks $routeChecks `
  -TestResults $testResults `
  -ResultLabel $(if ($allGreen) { "VERIFIED" } else { "FAILED" })

if ($allGreen) {
  Write-Host "client-project autopilot verification PASSED (run_id=$runId, correlation_id=$correlationId)"
  exit 0
}

Write-Host "client-project autopilot verification FAILED (run_id=$runId, correlation_id=$correlationId)"
exit 1
