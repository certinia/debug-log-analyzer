---
id: analysis
title: Analysis
description: Analyze Salesforce debug logs with detailed metrics on method calls, including Self Time, Total Time, Count, Name, and Type. Easily sort, filter, and group log events by namespace or type, and export or copy results for efficient troubleshooting and performance optimization.
keywords:
  [
    salesforce debug log analysis,
    apex performance metrics,
    salesforce troubleshooting,
    apex log analyzer,
    salesforce performance optimization,
    filter salesforce logs,
    salesforce developer tools,
  ]
image: https://github.com/certinia/debug-log-analyzer/blob/main/lana/assets/v1.18/lana-analysis.png
hide_title: true
---

## 🧠 Analysis

Analyze Salesforce debug logs with detailed metrics on method calls, including Self Time, Total Time, Count, Name, and Type. Easily sort, filter, and group log events by namespace or type, and export or copy results for efficient troubleshooting and performance optimization.

![Analysis view screenshot showing method call metrics such as Self Time, Total Time, Count, Name, and Type](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-analysis.png)

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
