param(
  [string]$TaskName = "OpenClawGatewayAttest",
  [string]$ScriptPath = "$PSScriptRoot\attest_gateway_gcloud.ps1",
  [string]$VmName = "ai-hell-mary-gateway",
  [string]$GcpZone = "us-central1-a",
  [string]$LogPath = "$env:USERPROFILE\openclaw-attest.log"
)

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`" -VmName $VmName -GcpZone $GcpZone -LogPath `"$LogPath`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Scheduled task '$TaskName' created to run every 5 minutes."

