# Runbook: MCP Integrations (Placeholders)

PLACEHOLDERS (set these before running commands)
- MCP_ELEVENLABS_API_KEY=PLACEHOLDER
- MCP_TWILIO_ACCOUNT_SID=PLACEHOLDER
- MCP_TWILIO_AUTH_TOKEN=PLACEHOLDER
- MCP_TWILIO_API_KEY=PLACEHOLDER
- MCP_TWILIO_API_SECRET=PLACEHOLDER
- MCP_HEYGEN_API_KEY=PLACEHOLDER
- MCP_GOOGLE_STITCH_API_KEY=PLACEHOLDER
- MCP_PROXIMO_API_KEY=PLACEHOLDER
- MCP_SOCIAL_NET_TOKEN=PLACEHOLDER
- MCP_GOOGLE_CALENDAR_OAUTH_JSON=PLACEHOLDER_PATH

Goal
- Prepare environment variables for MCP-based integrations.

Steps
1) Copy template
- `cp config-templates/mcp.env.template .env.mcp`

2) Fill values in `.env.mcp` (do not commit)
- Store secrets in env vars or Secret Manager.

3) Wire to OpenClaw
- Map env vars in your OpenClaw tool configuration (var names may differ by tool).
- Keep write actions approval-gated.
 - Use `config-templates/mcp.servers.template.json` as a starting point.

Registry lookup (recommended)
- Use the MCP Registry to find servers:
  - `SEARCH=github LIMIT=5 bash scripts/mcp_registry_search.sh`
  - `bash scripts/mcp_registry_top7.sh`
- Note: The MCP Registry is in preview and may change.

Context7 (recommended)
- See `docs/runbook-context7.md` for the official Context7 MCP endpoint and setup.

Reference servers (official)
- The MCP reference servers (filesystem, git, fetch, memory, etc.) are in the MCP servers repo.

Notes
- Service names above are placeholders and must be confirmed.
- Treat social networks as untrusted; never share secrets.
