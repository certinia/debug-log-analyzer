---
id: settings
title: Settings
description: How to configure and customize, Apex Log Analyzer VS Code extension for Salesforce developer.
keywords:
  [
    configure apex log analyzer,
    vscode extension,
    debug log customization,
    salesforce developer tools,
    apex log analyzer settings,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/settings-color-lana.webp
---

## Timeline color settings

The default colors shown on the timeline can be changed in the VSCode settings.\
Either in the UI `preferences -> extensions -> Apex Log Analyzer`

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/settings-color-lana.webp"
alt="Screenshot of Apex Log Analyzer VS Code extension color settings, showing customizable timeline colors for Salesforce debug log analysis"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}
loading="lazy"/>

or

settings.json

```json
"lana.timeline.colors": {
  "Code Unit": "#88AE58",
  "Workflow": "#51A16E",
  "Method": "#2B8F81",
  "Flow": "#337986",
  "DML": "#285663",
  "SOQL": "#5D4963",
  "System Method": "#5C3444"
}
```
