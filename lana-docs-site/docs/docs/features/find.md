---
id: find
title: Find
description: Explore the key features of Apex Debug Log Analyzer for Salesforce, including Timeline/Flame Chart, Call Tree, Analysis, Database, and Find functionality.
keywords:
  [
    salesforce,
    apex,
    vscode,
    logs,
    features,
    debug log analyzer,
    salesforce development,
    apex log analysis,
    visual studio code extension,
    salesforce debugging,
    apex logs,
    salesforce tools,
    salesforce extension,
    salesforce log analyzer,
    apex performance,
    salesforce productivity,
    salesforce troubleshooting,
    salesforce log analysis,
    apex code analysis,
    salesforce best practices,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline.png
---

## 🔍 Find

- CMD/CTRL + f to open find
- Any matching text is highlighted, the current match has a lighter hightlight.
- Previous match, next match and case sensitive search all supported.

### Timeline

- If the next matching event is off screen that event will be centered on the timeline.
- The find will match on Event Type or text in the event
- The tooltip is shown for the current matching event, making it easy to view the event details such as Total or Self time.

![Timeline screenshot showing highlighted search results and tooltip with event details](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline-find.png)

### Call Tree

- If the next matching text is within a parent that parent will be expanded.
- The row with the current matching text will also be highlighted

![Call Tree view screenshot showing expanded parent nodes and highlighted search result](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-calltree-find.png)

### Analysis + Database

- If the next matching text is within a group that group will be expanded.
- The row with the current matching text will also be highlighted

![Analysis view screenshot showing expanded groups and highlighted search results](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-analysis-find.png)
