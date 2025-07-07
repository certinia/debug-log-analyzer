---
id: analysis
title: Analysis
description: Show analysis of method calls by showing Self Time, Total Time, Count (number of times a method was called), name and type. Each column can be sorted ascending or descending by clicking the column header..
keywords:
  [
    method call analysis,
    self time,
    total time,
    method count,
    apex log analysis,
    salesforce debug logs,
    salesforce log analyzer,
    apex performance,
    salesforce development tools,
    visual studio code extension,
    debug log analyzer,
    salesforce productivity,
    log event filtering,
    group by namespace,
    group by type,
    export to csv,
    copy to clipboard,
    salesforce troubleshooting,
    apex code analysis,
    salesforce best practices,
  ]
image: https://github.com/certinia/debug-log-analyzer/blob/main/lana/dist/v1.18/lana-analysis.png
---

## 🧠 Analysis

Show analysis of method calls by showing Self Time, Total Time, Count (number of times a method was called), name and type. Each column can be sorted ascending or descending by clicking the column header.

![Analysis view screenshot showing method call metrics such as Self Time, Total Time, Count, Name, and Type](https://github.com/certinia/debug-log-analyzer/blob/main/lana/dist/v1.18/lana-analysis.png)

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
