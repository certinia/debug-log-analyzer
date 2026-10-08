---
id: slow-transaction
title: Find out why a transaction is slow
description: A step-by-step guide to finding what made a Salesforce Apex transaction slow with Apex Log Analyzer - the Timeline, Call Tree, Analysis and Database tabs, governor limits and heap.
keywords:
  [
    slow apex transaction,
    apex performance,
    salesforce cpu time,
    find slow soql,
    apex debug log analysis,
    apex log analyzer guide,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/1_22/timeline.png
hide_title: true
---

## 🐢 Find out why a transaction is slow

This guide goes from "this transaction is slow" to the methods, queries and limits that made it slow. Each step uses a different tab, and links to that tab's page for the details.

Before you start, capture the log with `APEX_CODE` at `FINE` or higher. See [Recommended Debug Log Levels](../gettingstarted.mdx#️-recommended-debug-log-levels). Higher debug levels add logging overhead, so all the times are a little longer than in production. Compare times with each other, not with production.

### 1. See where the time went

Open the log and start on the **Timeline**.

- Look for the widest frames. A wide frame took a long time, and a tall stack above it shows the calls it made.
- Use the [minimap](../features/timeline.mdx#minimap) to find the busy part of a long log, then zoom in to it.
- The color of a frame shows its category, for example Apex, DML or SOQL. The legend in the toolbar shows the self time of each category for the whole log.
- Hover a frame to see its total and self time.

### 2. Find the methods that used the time

Right-click a slow frame and select **Show in Call Tree** (or select it and press `J`), or open the [Call Tree](../features/calltree.mdx) tab.

- **Total time** includes the calls a method made. **Self time** is the time in the method itself. A method with a high self time is slow itself. A method with a high total time and a low self time calls something slow.
- Switch to the **Bottom-Up** view to rank methods by their self time, and expand a method to see which callers called it. See [View Modes](../features/calltree.mdx#view-modes).
- Use the **Aggregated** view to combine the repeated calls of the same method path into one row.

For the whole log in one table, open the [Analysis](../features/analysis.md) tab. It sorts every method by self time. Group by **Caller Namespace** to see which package caused the time.

### 3. Find the slow queries and DML

Open the [Database](../features/database.md) tab.

- Sort the SOQL section by time or by row count.
- A red cross in the **Selectivity** column marks a query that is not selective. Use the **Query Plan** column view to see the cost and the leading operation.
- A query that runs many times shows as a large group. Look for a query inside a loop.
- Right-click a statement and select **Show in Call Tree** to see the code that ran it.

### 4. Check the governor limits

A transaction can be slow because it is close to a limit, for example CPU time.

- The [Timeline governor limits strip](../features/timeline.mdx#governor-limits-strip) shows when the usage went up.
- In the Call Tree, the **Governor Limits** column view shows which call path used each limit. See [Governor limits + heap](../features/governor-limits-heap.md#where-to-find-them).

### 5. Check the heap

Heap size is a governor limit too. If the transaction goes past it, the transaction stops.

- In the Call Tree, the **Memory** column view shows heap as **Net**, **Gross** and **Peak** for each call path.
- A high **Gross** with a low **Net** is allocate-then-free churn, not a leak. See [Heap: net, gross and peak](../features/governor-limits-heap.md#heap-net-gross-and-peak).

### 6. Inspect the details

Select any frame, row or statement to open the [Inspector](../features/inspector.md). It shows the timing and governor usage of the selection, the call stack that led to it and a call tree of what ran inside it. For a SOQL query, it also shows optimization tips.

### Next steps

- Click a method name in the Call Tree to [go to its code](../features/calltree.mdx#go-to-code).
- Right-click a frame and select **Show in Log File** to see the [raw log](../features/raw-log.mdx) lines.
- Ask your AI assistant about the log with the [Apex Log MCP Server](../features/mcp.md).
