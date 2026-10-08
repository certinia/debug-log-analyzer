---
id: mcp
title: Apex Log MCP Server
description: The @certinia/apex-log-mcp MCP server lets GitHub Copilot Chat, Claude Code, Cursor and other AI assistants analyze Salesforce Apex debug logs.
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

Ask your AI assistant what's slow in a Salesforce Apex debug log. [`@certinia/apex-log-mcp`](https://www.npmjs.com/package/@certinia/apex-log-mcp) is an MCP server for GitHub Copilot Chat, Claude Code, Cursor or any MCP client. It uses the same log parser as this extension ([source on GitHub](https://github.com/certinia/debug-log-analyzer-mcp)).

Requires [Node.js](https://nodejs.org/) 22 or later. Runs on your machine, with no API keys.

Your assistant can:

- Summarize a log: duration, governor limits, fatal errors, and whether the log is complete.
- Rank methods, SOQL, DML and flows by self time.
- Flag governor limits near their ceiling.
- Run anonymous Apex in an org, then analyze the log. Needs an org authenticated with the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli). Asks before it runs in production.

**Try asking:**

- "Summarize this debug log."
- "What are the 5 slowest methods?"
- "Are we close to any governor limits?"

### VS Code (GitHub Copilot Chat)

Run **MCP: Add Server** from the Command Palette, or add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "apex-log-mcp": {
      "command": "npx",
      "args": ["-y", "@certinia/apex-log-mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add apex-log-mcp -- npx -y @certinia/apex-log-mcp
```

### Other MCP clients

Use the same command, `npx -y @certinia/apex-log-mcp`. The [`@certinia/apex-log-mcp` README](https://github.com/certinia/debug-log-analyzer-mcp#readme) covers each tool and the server flags, such as analysis-only mode.
