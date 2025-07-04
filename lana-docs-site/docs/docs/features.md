---
id: features
title: ✨ Features
description: Explore the key features of Apex Debug Log Analyzer for Salesforce, including Timeline/Flame Chart, Call Tree, Analysis, Database, and Find functionality.
sidebar_position: 2
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

- 🔥 [**Timeline / Flame chart**](#-timeline--flame-chart) - Gain a deep understanding of code execution over time via a timeline flame chart and tooltips to show additional information about events.
- 🌳 [**Call Tree**](#-call-tree) - View the execution path in a tree view with aggregated DML Count, SOQL Count, Throws Count, Row Count, Self Time and Total Time. Apply filters to filter the events.
- 🧠 [**Analysis**](#-analysis) - Quickly identify which methods took the most time in aggregate.
- 💾 [**Database**](#-database) - Identify which SOQL + DML executed the most, returned the most rows and took the most time.
- 🔍 [**Find**](#-find) - Find, highlight and step through matching text and log events on the Timeline, Call Tree, Analysis

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

## 🌳 Call Tree

Shows the call stack which can be expanded and collapsed. Clicking on a link will take you to that line in the class if it can be found in the current open project.

![Call Tree](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-calltree.png)

Each row shows event type, details such as method signature, self and total time as well as aggregated DML, SOQL, Throws and Row counts.

### Go to Code

Clicking the link in the event column will open the corresponding file and line, if that file exists in the current workspace.

### Sort

Each column can be sorted by clicking the column header, this will sort the rows within the tree structure e.g sorting by self time will sort the children within a parent with the largest self time to the top but only within that parent.

### Filtering

1. Details (events with 0 time) are hidden by default but can be shown/ hidden.
1. Show only debug statements using the Debug Only filter.
1. Show Log events for specific namespaces using the namespace column filter
1. Min and Max filtering can be done on the _Total Time_ and _Self Time_ columns.

### Keyboard Navigation

The Call Tree can be navigated with the keyboard. The up and down keys will move between rows, the left and right keys will expand and collapse a parent within the tree.

## 🧠 Analysis

Show analysis of method calls by showing Self Time, Total Time, Count (number of times a method was called), name and type. Each column can be sorted ascending or descending by clicking the column header.

![analysis](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-analysis.png)

### Sort

By default the Analysis table is sorted with the events that took the longest by Self Time at the top.\
Each column can be sorted by clicking the column header, this will sort the rows ascending or descending.

### Filtering

1. Show Log events for specific namespaces using the namespace column filter

### Group

The rows can be grouped by Type or Namespace

1. Namespace: Shows the rows aggregated by their namespace e.g `default`, `MyNamespace`
1. Type: Shows the rows aggregated by namespace event type e.g `METHOD_ENTRY`, `DML_ENTRY`

### Export to CSV + copy to clipboard

Use `Export to CSV` above the table to save the table content to a file or `Copy to Clipboard`.
You can also focus the Analysis tables and use `CMD / CTRL + c` to copy the table content to clipboard. This can then be pasted into a spreadsheet or other file.

## 💾 Database

Shows the SOQL and DML that occurred the number of rows returned, the time taken and for SOQL the selectivity and number of aggregations.

![database](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-database.png)

The _Selectivity_ column will have a green tick if the query is selective, a red cross if it is not and will be blank if the selectivity could not be determine. Sorting on this column will sort the rows by relative query cost, this number can be seen by hovering the cell on the selectivity column.

### Sort

The rows can be sorted ascending or descending by DML/SOQL, Row Count and Time Taken and by Selectivity and Aggregations on the SOQL table.
By default the rows within each group are sorted descending with the rows that have the highest row count at the top.
Row within each group can be sorted by clicking the column header, this will sort the rows ascending or descending.

If the grouping is removed the sorting applies the same but across all rows instead of within each group.

### Filtering

1. In the SOQL view show Log events for specific namespaces using the namespace column filter

### Group

By default rows are grouped by the SOQL/ DML text, grouping can be removed and the rows shows as a flat list using the _Group by_ item in the header menu. The groups are default sorted with the groups with the most items at the top.

SOQL Statements can also be grouped by package namespace including the default namespace

### DML / SOQL Call Stack

Clicking a row will show the SOQL/DML call stack, clicking on a link will take you to where that SOQL/DML occurred in the call tree.

### SOQL Analysis

For SOQL rows, to the right of the Call Stack is SOQL Analysis which shows information about SOQL performance for the given query and how to improve it.

### Export to CSV + copy to clipboard

Use `Export to CSV` above the table to save the table content to a file or `Copy to Clipboard`.
You can also focus the DML/ SOQL tables and use `CMD / CTRL + c` to copy the table content to clipboard. This can then be pasted into a spreadsheet or other file.

## 🔍 Find

- CMD/CTRL + f to open find
- Any matching text is highlighted, the current match has a lighter hightlight.
- Previous match, next match and case sensitive search all supported.

### Timeline

- If the next matching event is off screen that event will be centered on the timeline.
- The find will match on Event Type or text in the event
- The tooltip is shown for the current matching event, making it easy to view the event details such as Total or Self time.

![Timeline find](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-timeline-find.png)

### Call Tree

- If the next matching text is within a parent that parent will be expanded.
- The row with the current matching text will also be highlighted

![Call Tree find](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-calltree-find.png)

### Analysis + Database

- If the next matching text is within a group that group will be expanded.
- The row with the current matching text will also be highlighted

![Analysis find](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-analysis-find.png)
