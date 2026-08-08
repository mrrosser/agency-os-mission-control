import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/revenue-automation-scheduler-setup.ps1");
const script = readFileSync(scriptPath, "utf8");

interface CapturedGcloudCall {
  Args: string[];
}

function captureServingCloudRunRevision() {
  const powerShell = String.raw`
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$source = Get-Content -LiteralPath $env:SCHEDULER_SCRIPT_PATH -Raw
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -gt 0) { throw "Scheduler script did not parse." }
foreach ($functionName in @("ConvertFrom-GcloudJson", "Get-CloudRunEnvironment")) {
  $functionAst = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  if ($null -eq $functionAst) { throw "$functionName was not found." }
  Invoke-Expression $functionAst.Extent.Text
}

$script:RevisionArgs = @()
function Invoke-GcloudJsonOutput {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  if ($Args[1] -eq "services") { return $env:TEST_SERVICE_JSON }
  if ($Args[1] -eq "revisions") {
    $script:RevisionArgs = @($Args)
    return $env:TEST_REVISION_JSON
  }
  throw "Unexpected gcloud call."
}

$result = Get-CloudRunEnvironment -CloudRunService "service" -CloudRunRegion "us-central1" -ProjectId "project"
[PSCustomObject]@{
  url = $result.status.url
  servingRevisionName = $result.status.servingRevisionName
  servingRevisionReady = $result.status.servingRevisionReady
  timeoutSeconds = $result.spec.template.spec.timeoutSeconds
  revisionArgs = @($script:RevisionArgs)
} | ConvertTo-Json -Compress -Depth 20
`;
  const result = spawnSync(process.platform === "win32" ? "pwsh.exe" : "pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    powerShell,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SCHEDULER_SCRIPT_PATH: scriptPath,
      TEST_SERVICE_JSON: JSON.stringify({
        status: {
          url: "https://service.example.run.app",
          traffic: [
            { revisionName: "retired-template", tag: "old-tag" },
            { revisionName: "serving-release", percent: 100, tag: "release" },
          ],
        },
      }),
      TEST_REVISION_JSON: JSON.stringify({
        metadata: { name: "serving-release" },
        spec: { timeoutSeconds: 900, containers: [{ env: [] }] },
        status: { conditions: [{ type: "Ready", status: "True" }] },
      }),
    },
  });
  if (result.status !== 0) {
    throw new Error(`Cloud Run serving-revision capture failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim()) as {
    url: string;
    servingRevisionName: string;
    servingRevisionReady: boolean;
    timeoutSeconds: number;
    revisionArgs: string[];
  };
}

function captureSchedulerMutation(existingState: "ABSENT" | "ENABLED" | "PAUSED") {
  const powerShell = String.raw`
$ErrorActionPreference = "Stop"
$source = Get-Content -LiteralPath $env:SCHEDULER_SCRIPT_PATH -Raw
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
  $source,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -gt 0) { throw "Scheduler script did not parse." }
$functionAst = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq "Set-SchedulerJobOidc"
}, $true)
if ($null -eq $functionAst) { throw "Set-SchedulerJobOidc was not found." }
Invoke-Expression $functionAst.Extent.Text

$script:CapturedCalls = @()
function Get-SchedulerJob {
  param([string]$JobName, [string]$ProjectId, [string]$Location)
  if ($env:TEST_JOB_STATE -eq "ABSENT") { return $null }
  return [PSCustomObject]@{ state = $env:TEST_JOB_STATE }
}
function Invoke-Gcloud {
  param([Parameter(Mandatory = $true)][string[]]$Args)
  $script:CapturedCalls += [PSCustomObject]@{ Args = @($Args) }
  return ""
}

Set-SchedulerJobOidc -JobName "revenue-test" -Cron "5 5 * * *" -TimeZone "America/Chicago" -Uri "https://service.example.run.app/api/revenue/test" -OidcAudience "https://service.example.run.app" -ServiceAccountEmail "revenue-automation-scheduler@example.iam.gserviceaccount.com" -ProjectId "example-project" -Location "us-central1" -BodyJson "{}"

[PSCustomObject]@{ calls = @($script:CapturedCalls) } |
  ConvertTo-Json -Compress -Depth 20
`;
  const result = spawnSync(process.platform === "win32" ? "pwsh.exe" : "pwsh", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    powerShell,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      SCHEDULER_SCRIPT_PATH: scriptPath,
      TEST_JOB_STATE: existingState,
    },
  });
  if (result.status !== 0) {
    throw new Error(`PowerShell command capture failed: ${result.stderr || result.stdout}`);
  }
  return (JSON.parse(result.stdout.trim()) as { calls: CapturedGcloudCall[] }).calls;
}

function commandArgs(
  calls: CapturedGcloudCall[],
  command: string,
  operation: string
): string[][] {
  return calls
    .map((call) => call.Args)
    .filter((args) => args[0] === "scheduler" && args[2] === command && args[3] === operation);
}

describe("revenue automation scheduler OIDC contract", () => {
  it("uses one exact dedicated service account and Cloud Run audience", () => {
    expect(script).toContain(
      '$expectedServiceAccountEmail = "revenue-automation-scheduler@$projectId.iam.gserviceaccount.com"'
    );
    expect(script).toContain('"--oidc-service-account-email", $ServiceAccountEmail');
    expect(script).toContain('"--oidc-token-audience", $OidcAudience');
    expect(script).toContain(
      'REVENUE_AUTOMATION_WORKER_OIDC_AUDIENCE must exactly match REVENUE_AUTOMATION_SERVICE_URL'
    );
    expect(script).toContain('"--role", "roles/run.invoker"');
    expect(script).toContain("--include-email");
  });

  it("never reads or writes a static worker token into Scheduler", () => {
    expect(script).not.toMatch(/REVENUE_DAY(?:1|2|30)_WORKER_TOKEN/);
    expect(script).not.toMatch(/Authorization=Bearer/i);
    expect(script).not.toMatch(/\$WorkerToken/);
    expect(script).toContain('"--clear-headers"');
    expect(script).toContain("Assert-NoRevenueStaticAuthenticationHeaders");
    expect(script).toMatch(/\^authorization\$/i);
    expect(script).toMatch(/day30\|pos\|weekly-kpi/i);
  });

  it("configures idempotent morning, midday, and final outcome evaluations", () => {
    expect(script).toContain('Name = "revenue-daily-outcome-morning"');
    expect(script).toContain('Name = "revenue-daily-outcome-midday"');
    expect(script).toContain('Name = "revenue-daily-outcome-final"');
    expect(script).toContain('Default "50 5 * * *"');
    expect(script).toContain('Default "0 12 * * *"');
    expect(script).toContain('Default "5 20 * * *"');
    expect(script).toContain('/api/revenue/daily-outcomes/worker-task');
    expect(script).toContain('Name = "revenue-pos-worker-loop"');
    expect(script).toContain('/api/revenue/pos/worker-task');
  });

  it("verifies enabled state, canonical body, content type, retry policy, and deadline", () => {
    expect(script).toContain('$job.state -ne "ENABLED"');
    expect(script).toContain('$job.attemptDeadline -ne "900s"');
    expect(script).toContain('$job.retryConfig.retryCount');
    expect(script).toContain('Properties["uid"]');
    expect(script).toContain('ExpectedBodyJson');
    expect(script).toContain("Content-Type=application/json");
    expect(script).toContain('"scheduler", "jobs", "resume"');
    expect(script).toContain("timeoutSeconds -lt 900");
    expect(script).toContain("Cloud Run status URL does not match");
    expect(script).toContain('"run", "revisions", "describe", $servingRevisionName');
    expect(script).toContain('$percentProperty = $_.PSObject.Properties["percent"]');
    expect(script).toContain("[int]$percentProperty.Value -eq 100");
    expect(script).toContain("servingRevisionReady");
    expect(script).toContain("The 100-percent-serving Cloud Run revision is not Ready.");
  });

  it("remains compatible with Windows PowerShell 5.1 JSON parsing", () => {
    expect(script).toContain("return $Json | ConvertFrom-Json");
    expect(script).not.toContain("ConvertFrom-Json -Depth");
    expect(script).toContain('$disabledProperty = $account.PSObject.Properties["disabled"]');
  });

  it("validates the named 100-percent-serving revision instead of an unserved template", () => {
    const result = captureServingCloudRunRevision();

    expect(result).toMatchObject({
      url: "https://service.example.run.app",
      servingRevisionName: "serving-release",
      servingRevisionReady: true,
      timeoutSeconds: 900,
    });
    expect(result.revisionArgs).toContain("serving-release");
    expect(result.revisionArgs).not.toContain("retired-template");
  }, 15_000);

  it("uses create-compatible retry flags and does not resume a newly enabled job", () => {
    const calls = captureSchedulerMutation("ABSENT");
    const creates = commandArgs(calls, "create", "http");

    expect(creates).toHaveLength(1);
    expect(creates[0]).toContain("--max-retry-duration");
    expect(creates[0][creates[0].indexOf("--max-retry-duration") + 1]).toBe("0s");
    expect(creates[0]).not.toContain("--clear-max-retry-duration");
    expect(commandArgs(calls, "resume", "revenue-test")).toHaveLength(0);
  }, 15_000);

  it("clears retry duration on update without resuming an enabled job", () => {
    const calls = captureSchedulerMutation("ENABLED");
    const updates = commandArgs(calls, "update", "http");

    expect(updates).toHaveLength(2);
    expect(updates[0]).toContain("--clear-max-retry-duration");
    expect(updates[0]).not.toContain("--max-retry-duration");
    expect(commandArgs(calls, "resume", "revenue-test")).toHaveLength(0);
  }, 15_000);

  it("resumes an existing job only when its pre-update state was paused", () => {
    const calls = captureSchedulerMutation("PAUSED");

    expect(commandArgs(calls, "update", "http")).toHaveLength(2);
    expect(commandArgs(calls, "resume", "revenue-test")).toHaveLength(1);
  }, 15_000);

  it("exports a sanitized executable pause rollback before scheduler mutations", () => {
    expect(script).toContain("Export-SchedulerRollbackBundle");
    expect(script).toContain("scheduler-sanitized-manifest.json");
    expect(script).toContain("pause-managed-jobs.ps1");
    expect(script).toContain('containsSecretValues = $false');
    expect(script.indexOf("Export-SchedulerRollbackBundle -ManagedJobNames")).toBeLessThan(
      script.indexOf("Set-SchedulerJobOidc -JobName")
    );
  });

  it("requires an explicit two-phase canary before legacy job retirement", () => {
    expect(script).toContain('[ValidateSet("Canary", "Finalize", "Verify")]');
    expect(script).toContain(
      'Canary requires REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN=true in the deployed revision.'
    );
    expect(script).toContain(
      'Finalize/Verify requires REVENUE_AUTOMATION_ALLOW_LEGACY_TOKEN to be false or removed.'
    );
    expect(script).toContain('if ($CutoverPhase -eq "Finalize")');
    expect(script).toContain("Invoke-OidcCanary");
    expect(script.indexOf('if ($CutoverPhase -eq "Canary" -or $RunOidcCanary)')).toBeLessThan(
      script.indexOf("Set-SchedulerJobOidc -JobName")
    );
  });
});
