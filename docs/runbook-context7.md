# Runbook: Context7 MCP Server

PLACEHOLDERS (set these before running commands)
- CONTEXT7_API_KEY=PLACEHOLDER
- CONTEXT7_MCP_URL=https://mcp.context7.com/mcp

Goal
- Add Context7 MCP for up-to-date library and API documentation.

Recommended (Remote HTTP)
- Add to your MCP server config (example):
  {
    "mcpServers": {
      "context7": {
        "url": "https://mcp.context7.com/mcp",
        "headers": {
          "CONTEXT7_API_KEY": "YOUR_API_KEY",
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  }

Notes
- Use HTTP (remote) or stdio (local) per your MCP client's configuration.
- You can auto-invoke Context7 via your MCP client rules (Cursor/Claude/etc.).
