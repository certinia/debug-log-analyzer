---
id: timeline
title: Timeline
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
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-timeline.png
---

## 🔥 Timeline / Flame chart

The Timeline shows a visualization of code execution during a request’s execution. Each color represents a different Salesforce event type e.g DB, Method, SOQL etc. The length of a bar relates to realtime taken, a longer bar means that method took longer.

![timeline](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-timeline.png)

### Zoom + pan

- Scroll up and down with the mouse to zoom in and out to an accuracy of 0.001ms, time markers are shown with a ms time value and white line e.g 9600.001 ms.
- When zooming the mouse pointer position is kept on screen.
- Scroll left and right on the mouse to move the time line left are right, when zoomed
- Click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed

### Go to Call Tree

Clicking an event in the Timeline will go to and select that event in the Call Tree.

### Tooltip

![tooltip](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-tooltip.webp)

Hovering over an element provides information on the item. If you click on an item it will take you to that row in the Call Tree.

The tooltip provides the following information.\
**Event Name** - e.g `METHOD_ENTRY`, `EXECUTION_STARTED`, `SOQL_EXECUTION_BEGIN` etc\
**Event Description** - Additional information about the event such as method name or SOQL query executed.\
**Timestamp** - The start and end timestamp for the given event which can be cross referenced in the log file.\
**Duration** - Made up of **Total Time** (time spent in that event and its children) and **Self Time** (time directly spent in that event).\
**Rows** - Shows **Total Rows** (rows from that event and its children) and **Self Rows** (rows directly from that event).
