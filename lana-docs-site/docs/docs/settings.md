---
id: settings
title: Settings
description: How to configure and customize, Apex Log Analyzer VS Code extension for Salesforce developer.
keywords:
  [
    salesforce,
    apex,
    log,
    debug,
    apex log analyzer settings,
    vscode settings,
    customize apex debug log analyzer,
    salesforce log analysis,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline.png
---

## Timeline color settings

The default colors shown on the timeline can be changed in the VSCode settings.\
Either in the UI `preferences -> extensions -> Apex Log Analyzer`

![Screenshot of Apex Log Analyzer VS Code extension color settings, showing customizable timeline colors for Salesforce debug log analysis](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/settings-color-lana.webp)

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
