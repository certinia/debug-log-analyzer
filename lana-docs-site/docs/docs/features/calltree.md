---
id: calltree
title: Calltree
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
