---
id: mcp
title: AI Assistant (MCP Server)
description: Use the companion @certinia/apex-log-mcp Model Context Protocol server to expose Apex log analysis tools to AI assistants like GitHub Copilot Chat, Claude Code, and Cursor.
keywords:
  [
    salesforce apex mcp,
    apex log mcp server,
    model context protocol salesforce,
    claude code apex logs,
    copilot chat apex logs,
    ai assistant salesforce debug log,
  ]
hide_title: true
---

## 🤖 AI Assistant (MCP Server)

A companion Model Context Protocol server, [`@certinia/apex-log-mcp`](https://www.npmjs.com/package/@certinia/apex-log-mcp) ([source on GitHub](https://github.com/certinia/debug-log-analyzer-mcp)), exposes Apex log analysis tools to AI assistants. Use it with GitHub Copilot Chat, Claude Code, Cursor, or any MCP client.

**Available tools:** `get_apex_log_summary`, `analyze_apex_log_performance`, `find_performance_bottlenecks`, `execute_anonymous`.

### VS Code (GitHub Copilot Chat)

Run **MCP: Add Server** from the Command Palette and add an `npx` server with the command `npx -y @certinia/apex-log-mcp`, or add it to `.vscode/mcp.json`:

```json
{
  "servers": {
    "apex-log-analyzer": {
      "command": "npx",
      "args": ["-y", "@certinia/apex-log-mcp"]
    }
  }
}
```

### Claude Code

Add the server with the Claude CLI:

```bash
claude mcp add apex-log-analyzer -- npx -y @certinia/apex-log-mcp
```

### Other MCP clients

The same npm package works in Cursor, and other MCP hosts. See the [`@certinia/apex-log-mcp` README](https://github.com/certinia/debug-log-analyzer-mcp#readme) for client-specific configuration snippets.
