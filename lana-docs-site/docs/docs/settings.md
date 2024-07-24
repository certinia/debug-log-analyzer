---
sidebar_position: 4
---

# Settings

## Timeline color settings

The default colors shown on the timeline can be changed in the VSCode settings.\
Either in the UI `preferences -> extensions -> Apex Log Analyzer`

![color settings](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/settings-color-lana.webp)

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
