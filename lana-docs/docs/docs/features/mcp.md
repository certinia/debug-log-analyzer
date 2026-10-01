---
id: mcp
title: AI Assistant (MCP Server)
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

| Tool                           | What it does                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `apexlog_get_summary`          | Duration, governor limits, fatal errors, and whether the log is complete. Start here.             |
| `apexlog_list_slow_operations` | Ranks methods, SOQL, DML and flows by self time.                                                  |
| `apexlog_list_limit_risks`     | The governor limits nearest their ceiling, worst first.                                           |
| `apexlog_execute_anonymous`    | Runs anonymous Apex in an org and saves the log for the other tools. Asks before production orgs. |

`apexlog_execute_anonymous` needs an org authenticated with the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli).

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

Use the same command, `npx -y @certinia/apex-log-mcp`. The [`@certinia/apex-log-mcp` README](https://github.com/certinia/debug-log-analyzer-mcp#readme) covers tool parameters and server flags, such as `--no-apex-execution` for analysis only.
