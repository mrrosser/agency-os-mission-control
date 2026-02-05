param(
  [string]$VmName = "ai-hell-mary-gateway",
  [string]$GcpZone = "us-central1-a",
  [string]$LogPath = "$env:USERPROFILE\openclaw-attest.log"
)

$cmd = "docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw health"
$cmd2 = "docker compose -f docker/docker-compose.yml --env-file docker/.env exec -T openclaw-gateway openclaw status"

$ts = Get-Date -Format o
"[$ts] running health" | Out-File -FilePath $LogPath -Append
& gcloud compute ssh $VmName --zone $GcpZone --command $cmd | Out-File -FilePath $LogPath -Append
"[$ts] running status" | Out-File -FilePath $LogPath -Append
& gcloud compute ssh $VmName --zone $GcpZone --command $cmd2 | Out-File -FilePath $LogPath -Append

