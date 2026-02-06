---
id: raw-log
title: Raw Log Navigation
description: Navigate between the Log Analysis and raw .log files. Jump to specific lines, use code folding for events, and see hover details with timing information.
keywords:
  [
    salesforce raw log,
    apex debug log navigation,
    log file folding,
    debug log hover,
    show in log analysis,
    show in raw log,
  ]
hide_title: true
---

## Raw Log Navigation

Navigate between the Log Analysis views and raw `.log` files for detailed inspection.

### Show in Raw Log

Right-click any frame in the Timeline or Call Tree and select **Show in Log File** to open the raw log file and jump to the corresponding line.

| Action          | How                                    |
| --------------- | -------------------------------------- |
| Show in Raw Log | Right-click frame → "Show in Log File" |

### Show in Log Analysis

From a raw `.log` file, hover over any log line to see event metrics. Click **Show in Log Analysis** to navigate back to the Timeline or Call Tree with the corresponding frame selected.

### Code Folding

Raw log files support code folding for matching start/end events:

- `METHOD_ENTRY` / `METHOD_EXIT`
- `CODE_UNIT_STARTED` / `CODE_UNIT_FINISHED`
- `DML_BEGIN` / `DML_END`
- `SOQL_EXECUTE_BEGIN` / `SOQL_EXECUTE_END`
- And more...

| Action        | Shortcut                                    |
| ------------- | ------------------------------------------- |
| Fold region   | `Ctrl+Shift+[` (Win) / `Cmd+Option+[` (Mac) |
| Unfold region | `Ctrl+Shift+]` (Win) / `Cmd+Option+]` (Mac) |
| Fold all      | `Ctrl+K Ctrl+0`                             |
| Unfold all    | `Ctrl+K Ctrl+J`                             |

### Hover Details

Hover over any line in a raw log file to see:

- Event timing and duration
- SOQL/DML counts
- Governor limit metrics

The first line of the log shows the total execution time.
