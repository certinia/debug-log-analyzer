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
"lana.timeline.customThemes": {
  "Glacial Warmth": {
    "apex": "#6882A6",
    "codeUnit": "#7A9B6E",
    "system": "#9E8E7C",
    "automation": "#D98650",
    "dml": "#C85A5A",
    "soql": "#57A89A",
    "callout": "#C9A64D",
    "validation": "#8B7BAC"
  },
  "Orchid Slate": {
    "apex": "#647C96",
    "codeUnit": "#8872A8",
    "system": "#8A7E7E",
    "automation": "#C08545",
    "dml": "#C94C6E",
    "soql": "#5A9E85",
    "callout": "#B5A044",
    "validation": "#4EA6A6"
  }
}
```
