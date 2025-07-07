---
id: timeline
title: Timeline
description: Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, and interact with detailed tooltips for efficient Salesforce Apex log analysis and debugging.
keywords:
  [
    salesforce,
    apex,
    vscode,
    logs,
    salesforce log analyzer,
    apex performance,
    salesforce apex log analysis,
    apex timeline visualization,
    salesforce debug log analyzer,
    apex performance bottlenecks,
    salesforce flame chart,
    apex code execution visualization,
    salesforce event duration analysis,
    apex debugging tools,
    visual studio code salesforce extension,
    salesforce log troubleshooting,
    apex call tree navigation,
    salesforce development productivity,
    apex log performance analysis,
    salesforce log event tooltips,
    apex code profiling,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline.png
---

## 🔥 Timeline / Flame chart

Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, and interact with detailed tooltips for efficient Salesforce apex log analysis and debugging.

![Timeline view screenshot showing a color-coded flame chart of Salesforce event types such as DB, Method, and SOQL, visualizing code execution duration and performance](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline.png)

### Zoom + pan

- Scroll up and down with the mouse to zoom in and out to an accuracy of 0.001ms, time markers are shown with a ms time value and white line e.g 9600.001 ms.
- When zooming the mouse pointer position is kept on screen.
- Scroll left and right on the mouse to move the time line left are right, when zoomed
- Click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed

### Go to Call Tree

Clicking an event in the Timeline will go to and select that event in the Call Tree.

### Tooltip

![Tooltip showing detailed event information including event name, description, timestamps, duration, and row counts](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-tooltip.webp)

Hovering over an element provides information on the item. If you click on an item it will take you to that row in the Call Tree.

The tooltip provides the following information.\
**Event Name** - e.g `METHOD_ENTRY`, `EXECUTION_STARTED`, `SOQL_EXECUTION_BEGIN` etc\
**Event Description** - Additional information about the event such as method name or SOQL query executed.\
**Timestamp** - The start and end timestamp for the given event which can be cross referenced in the log file.\
**Duration** - Made up of **Total Time** (time spent in that event and its children) and **Self Time** (time directly spent in that event).\
**Rows** - Shows **Total Rows** (rows from that event and its children) and **Self Rows** (rows directly from that event).
