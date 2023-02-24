For best results we recommend setting Apex Code logging to FINE or better.

## Views

### The "Timeline" Tab

This tab shows the call tree as a timeline graph. Time runs left-to-right and nested calls run bottom-to-top. A color key at the bottom of the graph shows the meaning of the colors used for types of call. Information about nodes on the graph is shown as a tooltip when hovering the mouse over a node.

Clicking on a timeline node will take you to the entry in the "Call Tree".

#### Zoom on timeline

- scroll up and down on the mouse to zoom in and out
- zoom is based on position of mouse pointer, ensuring that position is kept on screen when zoomed in or out
- scroll left and right on the mouse to move the time line left are right, when zoomed
- click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed

### The "Call Tree" Tab

This tab shows the call tree for the log execution.

The tree can be expanded/collapsed with the +/- buttons on each method or with the "Expand All" / "Collapse All" buttons in the toolbar. To show other information (e.g. SOQL statements or variable assignments) in the tree, un-tick the hide details checkbox. There are also filter checkboxes to "Hide system calls", "Hide formulas" and "Hide under" a given duration. The prefix '(S)' is used to indicate callers of methods which perform SOQL and '(D)' is used to indicate callers of methods that perform DML.

### The "Analysis" Tab

This tab has aggregated times showing: _Count_, _Total Time and \_Self Time_ for each tree node. The toolbar controls sorting. The sort is multi-field and can be:

- Total Duration (followed by count and then name)
- Net duration (followed by count and then name)
- Count (followed by duration and then name)
- Name (followed by count and then duration)

The sort order can also toggle between ascending and descending.

### The "Database" Tab

This tab lists the DML and SOQL statements aggregated by SOQL/DML text. The tables have _Row Count_ and _Time Taken_ columns for each, with totals at the bottom. The SOQL table additionally has a _Selectivity_ and _Aggregations column_. All columns can be sorted ascending or descending.

This information helps identify the cause of _SOQL 101_ exceptions - it is usually easy to see where a query is not bulkified.
It may also show where we used our row limit if we run-out of DML.

Be aware that totals may exceed the normal limits due to:

- Unit tests - we get the extra setup limits outside _startTest_ / _stopTest_.
- Multiple packages - some limits are per package.

#### Selectivity

The _Selectivity_ column will have a green tick if the query is selective, a red cross if it is not and will be blank if the selectivity could not be determine. Sorting on this column will sort the rows by relative query cost, this number can be seen by hovering the cell on the selectivity column.

#### Detail

Clicking a row will show the SOQL/DML call stack, clicking on a link will take you to where that SOQL/DML occured in the call tree.
The tables can be sorted ascending or descending by DML/SOQL, Row Count and Time Taken.
The SOQL table can additionally be sorted by selectivity and aggregations.

##### Grouping

By default rows are grouped by the SOQL/ DML text, grouping can be removed and the rows shows as a flat list using the _Group by_ item in the header menu.
