param(
  [string]$ReportPath = $(if ($env:RT_REPORT_PATH) { $env:RT_REPORT_PATH } else { "docs/reports/latest-run.md" })
)

$ErrorActionPreference = "Stop"

function New-RunId {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $rand = Get-Random -Minimum 1000 -Maximum 9999
  return "$stamp-$rand"
}

$runId = if ($env:RUN_ID) { $env:RUN_ID } else { New-RunId }
$env:RUN_ID = $runId

$artifactsDir =
  if ($env:RT_ARTIFACTS_DIR) { $env:RT_ARTIFACTS_DIR }
  else { ".tmp/artifacts/rt-loop-$runId" }
$env:ARTIFACTS_DIR = $artifactsDir

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
New-Item -ItemType Directory -Force -Path $artifactsDir | Out-Null

# "latest" report should reflect only the current run.
@"
# RT Loop Report

- RUN_ID: $runId
- Artifacts: $artifactsDir

"@ | Set-Content -Path $ReportPath -Encoding utf8

function Log([string]$Message) {
  $ts = (Get-Date).ToString("o")
  $line = "[$ts] RUN_ID=$runId $Message"
  Write-Output $line
  Add-Content -Path $ReportPath -Value $line -Encoding utf8
}

function Run-Gate([string]$Name, [string]$Cmd) {
  Log "gate=$Name cmd=$Cmd"

  & cmd.exe /c $Cmd
  $ec = $LASTEXITCODE

  if ($ec -ne 0) {
    Log "gate=$Name result=FAIL exit=$ec"
    exit $ec
  }

  Log "gate=$Name result=PASS"
}

function Clean-NextBuildArtifacts {
  if (Test-Path ".next") {
    Log "gate=build cleanup=.next"
    & cmd.exe /c "rmdir /s /q .next"
  }
}

function Run-BuildGate([string]$Cmd, [int]$MaxAttempts = 2) {
  $attempt = 1
  while ($true) {
    Log "gate=build attempt=$attempt cmd=$Cmd"
    & cmd.exe /c $Cmd
    $ec = $LASTEXITCODE

    if ($ec -eq 0) {
      Log "gate=build result=PASS attempts=$attempt"
      return
    }

    if ($attempt -ge $MaxAttempts) {
      Log "gate=build result=FAIL exit=$ec attempts=$attempt"
      exit $ec
    }

    Log "gate=build result=RETRY exit=$ec attempt=$attempt reason=clean_retry"
    Clean-NextBuildArtifacts
    Start-Sleep -Seconds 1
    $attempt += 1
  }
}

try {
  Log "start artifacts_dir=$artifactsDir"
  if (Get-Command node -ErrorAction SilentlyContinue) { Log "tool=node version=""$(node --version)""" }
  if (Get-Command npm -ErrorAction SilentlyContinue) { Log "tool=npm version=""$(npm --version)""" }

  $formatCmd = if ($env:RT_FORMAT_CMD) { $env:RT_FORMAT_CMD } else { "npm run lint" }
  $unitCmd = if ($env:RT_UNIT_CMD) { $env:RT_UNIT_CMD } else { "npm run test:unit" }
  $smokeCmd = if ($env:RT_SMOKE_CMD) { $env:RT_SMOKE_CMD } else { "npm run test:smoke" }
  $buildCmd = if ($env:RT_BUILD_CMD) { $env:RT_BUILD_CMD } else { "npm run build" }
  $securityCmd = if ($env:RT_SECURITY_CMD) { $env:RT_SECURITY_CMD } else { "npm audit --audit-level=high" }

  Run-Gate -Name "format_lint" -Cmd $formatCmd
  Run-Gate -Name "unit" -Cmd $unitCmd
  Run-Gate -Name "smoke" -Cmd $smokeCmd
  Run-BuildGate -Cmd $buildCmd
  Run-Gate -Name "security" -Cmd $securityCmd

  if ($env:RT_SECRETS_CMD) {
    Run-Gate -Name "secrets" -Cmd $env:RT_SECRETS_CMD
  } elseif (Get-Command gitleaks -ErrorAction SilentlyContinue) {
    # Scan the git repo to avoid false positives from generated files.
    Run-Gate -Name "secrets" -Cmd "gitleaks detect --source . --redact --report-format sarif --report-path ""$artifactsDir/gitleaks.sarif"""
  } else {
    Log "gate=secrets result=SKIP reason=gitleaks_not_installed"
  }

  Log "end status=PASS artifacts_dir=$artifactsDir"
  exit 0
} catch {
  Log "end status=FAIL error=""$($_.Exception.Message)"" artifacts_dir=$artifactsDir"
  throw
}
