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

### Row actions

Right-click a row in the **Call stack** or **Call tree** for:

| Action                | Result                                                          |
| --------------------- | --------------------------------------------------------------- |
| **Show in Call Tree** | Jumps to that frame in the full [Call Tree](./calltree.mdx) tab |
| **Copy Name**         | The frame's name                                                |
| **Copy Details**      | Name, type, duration and governor metrics                       |
| **Copy Call Stack**   | The whole parent chain, one frame per line                      |

Press `Escape` to clear the selection on the tab you're on; the inspector returns to its whole-log view.

Clicking a row highlights the matching frame or row in the tab you're on, and never switches tab: the Timeline selects the frame and centers it when it's off screen, the Call Tree scrolls to it in **Time Order**, and the Database tab selects the statement. Rows in the Call tree's **Aggregated** and **Bottom-Up** views merge several occurrences, so there is no single frame to highlight. Arrow keys move between rows, and `CMD / CTRL + c` copies the table.
