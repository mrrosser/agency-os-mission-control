#!/usr/bin/env bash
set -euo pipefail

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing file: $path" >&2
    exit 1
  fi
}

require_file "docker/docker-compose.yml"
require_file "docker/Dockerfile"
require_file "docker/.env.template"
require_file "config-templates/openclaw.json.template"
require_file "config-templates/exec-approvals.gateway.json"
require_file "config-templates/exec-approvals.node.json"
require_file "scripts/pick_billing_account.sh"
require_file "scripts/wire_googlechat_sa.sh"
require_file "scripts/tunnel_ssh_gcloud.sh"
require_file "scripts/tunnel_ssh_gcloud.ps1"
require_file "scripts/attest_gateway_gcloud.sh"
require_file "scripts/attest_gateway_local.sh"
require_file "scripts/install_attest_cron.sh"
require_file "scripts/install_attest_task.ps1"
require_file "scripts/start_node_wsl_watchdog.sh"
require_file "scripts/mcp_registry_search.sh"
require_file "scripts/mcp_registry_top7.sh"
require_file "docs/runbook-twilio.md"
require_file "docs/runbook-elevenlabs.md"
require_file "docs/runbook-calendar.md"
require_file "docs/runbook-github-automation.md"
require_file "docs/runbook-playwright.md"
require_file "docs/runbook-web-browsing.md"
require_file "docs/runbook-mcp-integrations.md"
require_file "docs/runbook-skills.md"
require_file "docs/runbook-social-networks.md"
require_file "docs/runbook-context7.md"
require_file "docs/runbook-firestore.md"
require_file "docs/runbook-google-workspace.md"
require_file "docs/runbook-write-mode.md"
require_file "config-templates/mcp.env.template"
require_file "config-templates/mcp.servers.template.json"
require_file "config-templates/openclaw.json.write.template"
require_file "scripts/enable_write_mode.sh"
require_file "scripts/disable_write_mode.sh"
require_file "scripts/create_write_template.sh"
require_file "scripts/enable_core_integrations.sh"
require_file "config-templates/calendar-accounts.template.json"
require_file "config-templates/gmail-accounts.template.json"

if ! grep -q "127.0.0.1" docker/docker-compose.yml; then
  echo "Expected loopback binding in docker-compose.yml" >&2
  exit 1
fi

echo "OK"
