---
id: governor-limits-heap
title: Governor limits + heap
description: Track Salesforce Apex governor limits across a whole transaction - SOQL queries, query rows, DML statements, DML rows, CPU time, callouts and heap size - and understand heap as net, gross and peak so you can tell a real leak from allocate-then-free churn.
keywords:
  [
    apex governor limits,
    too many soql queries 101,
    apex heap size limit,
    salesforce cpu time limit,
    apex dml limit,
    apex heap analysis,
    salesforce debug log analysis,
    apex log analyzer,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/1_20/timeline.png
hide_title: true
---

## 📊 Governor limits + heap

Salesforce enforces governor limits per transaction, and the log tells you the final tally. The problem with a final tally is that it says _how much_ you used, never _where_. Apex Log Analyzer tracks limits **throughout** the log, so you can find the code that consumed them.

Every limit reported by the log is tracked: SOQL queries and query rows, SOSL queries, DML statements and DML rows, CPU time, heap size, callouts, email invocations, future calls and queueable jobs.

### Where to find them

| Question                                   | Where to look                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| How close did I get, overall?              | The [Database](./database.md) tab's `used / limit` overview                                            |
| _When_ in the transaction did usage climb? | The [Timeline](./timeline.mdx#governor-limits-strip) governor limits strip                             |
| Which call path is responsible?            | The [Call Tree](./calltree.mdx#column-views) **Governor Limits** column view (average + tightest peak) |
| What did this one statement cost?          | The [inspector](./inspector.md)'s **Details** section                                                  |

### Found vs counted

The Database tab reconciles the statements found in the log against the governor-counted total. When those disagree, the difference is usually work that doesn't consume the limit — custom metadata SOQL, for example, is free unless it selects a long text area field or runs inside a Flow. Seeing both numbers means you can trust the gap instead of wondering which one is wrong.

:::note
Some logs contain no `CUMULATIVE_LIMIT_USAGE` block at all. Where the log never reports a total, no limit is shown rather than a guessed one.
:::

### Flow and Process Builder usage

A Flow or Process Builder element runs its own SOQL and DML, but the log never reports it as a statement — there is no `SOQL_EXECUTE_BEGIN` or `DML_BEGIN` line to find. Instead the element reports how much it used, and that usage is counted against the element and rolls up through its callers like any other.

The figure the element reports also covers anything its own subtree logged, such as Apex it called, so only the part no logged statement accounts for is added. Where the element is the only thing that ran, that is all of it.

:::note
This needs `WORKFLOW` at `FINER` or above. At `FINE` the log reports no Flow usage at all, so Flow elements show none.
:::

### Heap: net, gross and peak

Heap is the awkward one. Memory is freed as well as allocated, so a single number hides what actually happened — a loop that allocates and frees the same buffer a thousand times looks identical to one that leaks. Every method and call path therefore carries three heap metrics, each with a total and a self variant:

1. **Net** – bytes retained (allocated minus freed); the lasting footprint. Can be negative where a path frees more than it allocates.
1. **Gross** – bytes allocated, ignoring frees; allocation churn and GC pressure. An allocate-then-free loop has near-zero net but large gross.
1. **Peak** – highest live heap reached while the path ran. This is the number comparable to the heap governor limit, so it also drives the Governor Avg/Peak columns.

Read them together: **high gross with low net** is churn — usually a loop allocating inside its body, which costs CPU but won't breach the limit. **High net** is memory you are still holding. **Peak near the limit** is what actually throws.

They appear in the Call Tree and Analysis **Memory** column view, in the inspector's **Details** section for whatever you have selected, and on the Timeline strip, which plots heap as it is allocated so you can see exactly where it spikes.

### Governor cost columns

Because a path can consume several limits at once, the Call Tree and Analysis tables offer two summary columns:

- **Gov Avg %** – average utilisation across every governor with a limit, for that path.
- **Gov Peak %** – the single tightest governor on that path. Hidden by default; the tooltip names which limit is the peak.

Sorting by **Gov Peak** is the fastest way to find the call path that is closest to breaching something, regardless of _which_ limit it is.
