---
id: calltree
title: Calltree
description: The Call Tree helps efficently visualize and navigate the call stack in Apex logs. Learn to expand and collapse method calls, sort and filter by execution metrics, and quickly jump to code locations in Visual Studio Code. Enhance your Salesforce debugging and performance analysis with detailed insights into DML, SOQL, and execution times.
keywords:
  [
    salesforce apex debugging,
    apex call stack visualization,
    debug log analyzer,
    salesforce performance analysis,
    apex code profiling,
    dml soql insights,
    visual studio code extension,
    salesforce developer tools,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-timeline.png
---

## 🌳 Call Tree

The Call Tree helps efficently visualize and navigate the call stack in Salesfroce Apex debug logs. Learn to expand and collapse method calls, sort and filter by execution metrics, and quickly jump to code locations in Visual Studio Code. Enhance your Salesforce debugging and performance analysis with detailed insights into DML, SOQL, and execution times.

![Call Tree Screenshot displaying an expandable and collapsible call stack with event types, method signatures, timing metrics, and aggregated DML, SOQL, Throws, and Row counts.](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.18/lana-calltree.png)

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
