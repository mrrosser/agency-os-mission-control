param(
  [string]$VmName = "ai-hell-mary-gateway",
  [string]$GcpZone = "us-central1-a",
  [int]$LocalPort = 18789,
  [int]$GatewayPort = 18789
)

Write-Host "Starting SSH tunnel via gcloud: localhost:$LocalPort -> $VmName:127.0.0.1:$GatewayPort"
& gcloud compute ssh $VmName --zone $GcpZone -- -N -L "$LocalPort`:127.0.0.1:$GatewayPort" -o ExitOnForwardFailure=yes -o ServerAliveInterval=60

