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

The tree can be expanded/collapsed with the +/- buttons on each method or with the "Expand All" / "Collapse All" buttons in the toolbar. To show other information (e.g. SOQL statements or variable assignments) in the tree, un-tick the hide details checkbox. There are also filter checkboxes to "Hide system calls" and "Hide formulas". The prefix '(S)' is used to indicate callers of methods which perform SOQL and '(D)' is used to indicate callers of methods that perform DML.

### The "Analysis" Tab

This tab has aggregated times showing: _Count_, _Total Duration_ and _Net duration_ for each tree node. The toolbar controls sorting. The sort is multi-field and can be:

- Total Duration (followed by count and then name)
- Net duration (followed by count and then name)
- Count (followed by duration and then name)
- Name (followed by count and then duration)

The sort order can also toggle between ascending and descending.

### The "Database" Tab

This tab aggregates DML and SOQL statements by text, providing _Count_ and _Row_ totals for each. This helps identify the cause of _SOQL 101_ exceptions - it is usually easy to see where a query is not bulkified.

It may also show where we used our row limit if we run-out of DML.

Be aware that totals may exceed the normal limits due to:

- Unit tests - we get the extra setup limits outside _startTest_ / _stopTest_.
- Multiple packages - some limits are per package.
