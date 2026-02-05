# Runbook: Magic UI MCP Server

Goal
- Add the official Magic UI MCP server so IDEs can pull component implementations for demos and prototypes.

Local Install (Recommended)
- Run: `npx @magicuidesign/cli@latest install <client>`
- Supported clients (per upstream): `cursor`, `windsurf`, `claude`, `cline`, `roo-cline`.
- Restart your IDE after the install so the MCP config is reloaded.

Manual Install (Client Config)
- Add this entry to your MCP server config:
```json
{
  "mcpServers": {
    "magicuidesign-mcp": {
      "command": "npx",
      "args": ["-y", "@magicuidesign/mcp@latest"]
    }
  }
}
```

Local Run
- No daemon is required. The MCP server is launched on demand by your IDE via `npx`.

Deploy
- Not applicable. This MCP server is intended to run locally in your IDE client.

Notes
- No API keys required.
