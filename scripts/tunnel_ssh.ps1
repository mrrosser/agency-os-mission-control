param(
  [string]$VmHost = "PLACEHOLDER_VM_HOST_OR_IP",
  [string]$SshUser = "PLACEHOLDER_SSH_USER",
  [int]$LocalPort = 18789,
  [int]$GatewayPort = 18789
)

Write-Host "Starting SSH tunnel: localhost:$LocalPort -> $VmHost:127.0.0.1:$GatewayPort"
& ssh -N -L "$LocalPort`:127.0.0.1:$GatewayPort" "$SshUser@$VmHost" -o ExitOnForwardFailure=yes -o ServerAliveInterval=60
