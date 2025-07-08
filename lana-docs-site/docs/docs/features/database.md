---
id: database
title: Database
description: Database insights help Salesforce developers analyze SOQL and DML operations, assess query selectivity, performance, and aggregations, and optimize Apex code using advanced sorting, grouping, filtering, call stack tracing, and CSV export tools.
keywords:
  [
    salesforce database analysis,
    soql optimization,
    dml performance,
    apex query tuning,
    salesforce log analysis,
    database insights,
    salesforce developer tools,
    salesfroce query optimization,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assests/v1.18/lana-database.png
---

## 💾 Database

Database insights help Salesforce developers analyze SOQL and DML operations, assess query selectivity, performance, and aggregations, and optimize Apex code using advanced sorting, grouping, filtering, call stack tracing, and CSV export tools.

![Database view screenshot displaying SOQL and DML operations with row counts, execution times, selectivity indicators, and aggregation details for Salesforce log analysis.](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assests/v1.18/lana-database.png)

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
