---
id: inspector
title: Inspector
description: Inspect any selected Salesforce Apex log frame or statement in a dockable side bar - vitals, governor metrics, call stack, a scoped call tree and SOQL optimization tips, available from the Timeline, Call Tree, Analysis and Database tabs.
keywords:
  [
    apex log detail panel,
    salesforce debug log inspector,
    apex call stack viewer,
    scoped call tree,
    soql optimization tips,
    apex log analyzer,
    salesforce developer tools,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/1_20/database.png
hide_title: true
---

## 🧭 Inspector

Select anything — a Timeline frame, a Call Tree or Analysis row, a SOQL/DML/SOSL statement — and the inspector shows it in depth without you leaving the tab you're working in.

It docks to the **right**, **left** or **bottom**, resizes by dragging its edge, and is toggled from the button in the header. It opens automatically on your first selection, then stays however you left it, including the next time you open a log. See [Settings](../settings.mdx#inspector).

### Sections

- **Details** – The selection's type and timing, plus every governor metric it consumed as `used / limit` (SOQL, DML, SOSL, rows, heap net/gross/peak, throws). Zero-valued metrics are omitted, so what's left is what the statement actually did. SOQL and SOSL text is syntax highlighted with a copy button. For a SOQL statement it also reports **selectivity**, the **query plan** (leading operation, SObject type, indexed fields) and **cardinality**.
- **Call stack** – The parent frames that led to the selection, outermost first, with total and self time as a percentage of the enclosing frame. Sortable.
- **Call tree** – The selection scoped within its own execution, switchable between **Time Order**, **Aggregated** and **Bottom-Up** (as in the Chrome DevTools performance panel). Totals are relative to the selection, so a DML that fires triggers shows the triggered work beneath it. This scoping is what makes it different from the [Call Tree](./calltree.mdx) tab, which always shows the whole log. Zero-duration rows — heap allocations, statements, variable assignments — are left out; read those on the [Call Tree](./calltree.mdx) tab.
- **SOQL issues** – SOQL only: optimization tips describing the query's performance and how to improve it.

Collapse any section by clicking its header, or drag the divider between two to resize them. It's one panel, so your layout follows you from tab to tab, and is restored next time.

### Nothing selected

With no selection the inspector shows the whole log. Every tab starts with a **Log overview** — the six governor metrics closest to their limit, each as `used / limit`, the same whole-transaction totals the timeline's metric strip shows. When the log has no `CUMULATIVE_LIMIT_USAGE` events the figures are estimated from the logged events instead, and a note says so. The **Timeline** tab adds:

- **Time by category** – the log's self time as one stacked bar, in the flame chart's own colours, with a legend. Self time, so the bar always totals the log.
- **Governor usage over time** – small area charts of the metrics nearest their limits, drawn from the same data as the timeline's metric strip: `CUMULATIVE_LIMIT_USAGE` snapshots plus the log's own SOQL, DML and heap events. Without snapshots the figures are estimated. Hover a chart to read the value at any point in the log.
- **Call tree** – every root event in the log, in the same three views as the scoped tree.

The **Analysis** tab adds:

- **Findings** – what is slow or wrong in the log, and what to do about it. One pass over the log reports truncation (which makes every figure below it an undercount), governor breaches, exceptions, query-plan verdicts, SOQL optimization tips, statements repeated from one line — the usual sign of a query or DML in a loop — debug-statement cost, and the methods with the most self time. Query-plan verdicts need a `FINEST` log; without one the pane says the verdicts are unknown rather than reading clean. Each finding shows the code the log named with its figures; click it to reveal the row behind it in the Analysis grid.

The **Call Tree** tab adds:

- **Hot path** – the chain of calls the log spent most of its time in, entry point first. At each step, calls with the same signature count as one, so a method called 200 times shows once with a `200×` count. The path follows the biggest of these and stops where the time spreads out or a call's own work outweighs its children; every frame shows its time and share of the log. A truncated log heads the path with a warning, because timings below a cut-off call under-report.
- **Hot spots** – the five signatures with the most self time across the whole log, each with its share of the log, plus its call count and average self time per call where it ran more than once. The average names the churn a self-time ranking hides: a cheap method called thousands of times.

Rows in both sections carry a swatch in the flame chart's colour for their category, and a meter with two tones — solid for the time the call spent itself, faded for the time it spent in its children. A change of timeline theme repaints them.

Every row in both sections is a link: click it to reveal that call in the tree (Time Order view).

Select a row and the sections re-scope to it; deselect and the whole-log view returns.

### Row actions

Right-click a row in the **Call stack** or **Call tree** for:

| Action                | Result                                                          |
| --------------------- | --------------------------------------------------------------- |
| **Show in Call Tree** | Jumps to that frame in the full [Call Tree](./calltree.mdx) tab |
| **Copy Name**         | The frame's name                                                |
| **Copy Details**      | Name, type, duration and governor metrics                       |
| **Copy Call Stack**   | The whole parent chain, one frame per line                      |

Press `Escape` to clear the selection on the tab you're on; the inspector returns to its whole-log view.

Clicking a row highlights the matching frame or row in the tab you're on, and never switches tab: the Timeline selects the frame and centers it when it's off screen, the Call Tree scrolls to it in **Time Order**, and the Database tab selects the statement. Rows in the Call tree's **Aggregated** and **Bottom-Up** views merge several occurrences, so there is no single frame to select; clicking one marks every occurrence instead, and nothing moves. Arrow keys move between rows, and `CMD / CTRL + c` copies the table.

Hovering works both ways and moves nothing — no selection, no scroll, no pan:

- Hover an inspector row to pick out what it names in the tab you're on: the Timeline dims around the frame, and the Call Tree and Database tables mark the row. A row that merges several occurrences marks all of them.
- Hover a frame, row or statement in the tab you're on to mark the inspector rows that name it, where they are already on screen. Analysis rows are method totals rather than single calls, so they mark nothing.

What you clicked stays picked out as the pointer moves away, so you can read the Timeline or a table with it still marked. `Escape` clears it.
