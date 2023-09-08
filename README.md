# Apex Log Analyzer for Salesforce

[![Version](https://img.shields.io/visual-studio-marketplace/v/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Download](https://img.shields.io/visual-studio-marketplace/d/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

Apex Log Analyzer makes performance analysis of Salesforce debug logs much easier and quicker. Visualize code execution via a Flame chart and Call Tree, identify and resolve performance and SOQL/DML problems via Method and Database Analysis.

![preview](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-preview.gif)

## WARNING

> In general set the `APEX_CODE` debug flag to be `FINE` or higher, with a lower level the log will likely not contain enough detail for meaningful analysis.
>
> The quality of data shown depends entirely on the data contained in the log files.\
> Special care should be taken when looking at log files that have been truncated as you are only seeing a part of the execution and that may lead you to misunderstand what is really happening.
>
> A log level of `FINE` seems to give a good balance between log detail and execution time.\
> Higher log levels result in higher reported execution time than would be seen with logging off.\
> This is due to the over head associated with logging method entry and exit.

[Installation](#installation 'Go to Installation') |
[Usage](#usage 'Go to Usage') |
[Features](#features 'Go to Features') |
[Settings](#settings 'Go to Settings') |
[Explore the Docs](https://certinia.github.io/debug-log-analyzer/) |
[Contributing](#contributing 'Go to Contributing') |
[Contributors](#contributors 'Go to Contributors') |
[License](#license 'Go to License')

## Installation

![install](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/install-lana.webp)

- Search for `Apex Log Analyzer` in extensions.
- Click install + then reload VSCode.

### Pre-Release

Click `Switch to Pre-Release Version` on the banner to get bleeding edge changes and help us to resolve bugs before the stable release.

### Command Pallette

- Open command pallette (CMD/CTRL + Shift + P), paste `ext install financialforce.lana`, and press enter.
- Click reload in the extensions tab.

```sh
ext install financialforce.lana
```

### VSCode Marketplace

- Install from the VSCode market place by clicking install on [Visual Studio Code Market Place: Apex Log Analyzer](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

## Usage

Start the analysis either from a log you have already downloaded or by downloading a log from an org to view.
On larger logs the analysis window make take a few seconds to appear.

### From an Open Log File

With the `.log` file open in VSCode.

1. Open command pallette (CMD/CTRL + Shift + P) -> 'Log: Show Apex Log Analysis'\
   or
1. Click the 'Log: Show Apex Log Analysis' code lens at the top of the file\
   ![show analysis lens](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-showanalysis-lens.webp)\
   or
1. Right click -> 'Log: Show Apex Log Analysis'

### Download a log

1. Open command pallette (CMD/CTRL + Shift + P) -> 'Log: Retrieve Apex Log And Show Analysis

## Features

- [**Timeline / Flame chart**](#timeline--flame-chart) - Gain a deep understanding of code execution over time via a timeline flame chart and tooltips to show additional information about events.
- [**Call Tree**](#call-tree) - View the execution path in a tree view with aggregated DML Count, SOQL Count, Throws Count, Row Count, Self Time and Total Time. Apply filters to filter the events.
- [**Analysis**](#analysis) - Quickly identify which methods took the most time in aggregate.
- [**Database**](#database) - Identify which SOQL + DML executed the most, returned the most rows and took the most time.

### Timeline / Flame chart

The Timeline shows a visualization of code execution during a request’s execution. Each color represents a different Salesforce event type e.g DB, Method, SOQL etc. The length of a bar relates to realtime taken, a longer bar means that method took longer.

![timeline](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-timeline.webp)

#### Zoom + pan

- Scroll up and down with the mouse to zoom in and out to an accuracy of 0.001ms, time markers are shown with a ms time value and white line e.g 9600.001 ms.
- When zooming the mouse pointer position is kept on screen.
- Scroll left and right on the mouse to move the time line left are right, when zoomed
- Click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed

#### Go to Call Tree

Clicking an event in the Timeline will go to and select that event in the Call Tree.

#### Tooltip

![tooltip](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-tooltip.webp)

Hovering over an element provides information on the item. If you click on an item it will take you to that row in the Call Tree.

The tooltip provides the following information.\
**Event Name** - e.g `METHOD_ENTRY`, `EXECUTION_STARTED`, `SOQL_EXECUTION_BEGIN` etc\
**Event Description** - Additional information about the event such as method name or SOQL query executed.\
**Timestamp** - The start and end timestamp for the given event which can be cross referenced in the log file.\
**Duration** - Made up of **Total Time** (time spent in that event and its children) and **Self Time** (time directly spent in that event).\
**Rows** - Shows **Total Rows** (rows from that event and its children) and **Self Rows** (rows directly from that event).

### Call Tree

Shows the call stack which can be expanded and collapsed. Clicking on a link will take you to that line in the class if it can be found in the current open project.

![Call Tree](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-calltree.webp)

Each row shows event type, details such as method signature, self and total time as well as aggregated DML, SOQL, Throws and Row counts.

#### Go to Code

Clicking the link in the event column will open the corresponding file and line, if that file exists in the current workspace.

#### Sort

Each column can be sorted by clicking the column header, this will sort the rows within the tree structure e.g sorting by self time will sort the children within a parent with the largest self time to the top but only within that parent.

#### Filtering

Details (events with 0 time) are hidden by default but can be shown/ hidden.
Min and Max filtering can be done on the _Total Time_ and _Self Time_ columns.

#### Keyboard Navigation

The Call Tree can be navigated with the keyboard. The up and down keys will move between rows, the left and right keys will expand and collapse a parent within the tree.

### Analysis

Show analysis of method calls by showing Self Time, Total Time, Count (number of times a method was called), name and type. Each column can be sorted ascending or descending by clicking the column header.

![analysis](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-analysis.webp)

#### Sort

By default the Analysis table is sorted with the events that took the longest by Self Time at the top.
Each column can be sorted by clicking the column header, this will sort the rows ascending or descending.

#### Group

The rows can be grouped by Type which will show the rows aggregated by their event type e.g `METHOD_ENTRY`, `DML_ENTRY`

#### Export to CSV + copy to clipboard

Click the header menu,`⋮`, and use `Export to CSV` to save the table content to a file.
Focus the Analysis table and use `CMD / CTRL + c` to copy the table content to clipboard. This can then be pasted into a spreadsheet or other file.

### Database

Shows the SOQL and DML that occurred the number of rows returned, the time taken and for SOQL the selectivity and number of aggregations.

![database](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/lana-database.webp)

The _Selectivity_ column will have a green tick if the query is selective, a red cross if it is not and will be blank if the selectivity could not be determine. Sorting on this column will sort the rows by relative query cost, this number can be seen by hovering the cell on the selectivity column.

#### Sort

The rows can be sorted ascending or descending by DML/SOQL, Row Count and Time Taken and by Selectivity and Aggregations on the SOQL table.
By default the rows within each group are sorted descending with the rows that have the highest row count at the top.
Row within each group can be sorted by clicking the column header, this will sort the rows ascending or descending.

If the grouping is removed the sorting applies the same but across all rows instead of within each group.

#### Group

By default rows are grouped by the SOQL/ DML text, grouping can be removed and the rows shows as a flat list using the _Group by_ item in the header menu. The groups are default sorted with the groups with the most items at the top.

#### DML / SOQL Call Stack

Clicking a row will show the SOQL/DML call stack, clicking on a link will take you to where that SOQL/DML occurred in the call tree.

#### SOQL Analysis

For SOQL rows, to the right of the Call Stack is SOQL Analysis which shows information about SOQL performance for the given query and how to improve it.

#### Export to CSV + copy to clipboard

Click the header menu,`⋮`, and use `Export to CSV` to save the table content to a file.
Focus the Analysis table and use `CMD / CTRL + c` to copy the table content to clipboard. This can then be pasted into a spreadsheet or other file.

## Settings

### Timeline color settings

The default colors shown on the timeline can be changed in the VSCode settings.\
Either in the UI `preferences -> extensions -> Apex Log Analyzer`

![color settings](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/v1.10/settings-color-lana.webp)

or

settings.json

```json
"lana.timeline.colors": {
  "Code Unit": "#88AE58",
  "Workflow": "#51A16E",
  "Method": "#2B8F81",
  "Flow": "#337986",
  "DML": "#285663",
  "SOQL": "#5D4963",
  "System Method": "#5C3444"
}
```

## Contributing

Help us to make things better by [Contributing](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/CONTRIBUTING.md)\
Find out how to [Build](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/BUILDING.md) the extension

## Contributors

Thanks to the everyone who has contributed &#10084; &#128591;

<p align="center">
  <a href="https://github.com/certinia/debug-log-analyzer/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=certinia/debug-log-analyzer&max=25" />
  </a>
</p>

## License

<p align="center">
Copyright &copy; Certinia Inc. All rights reserved.
</p>
<p align="center">
  <a href="https://opensource.org/licenses/BSD-3-Clause">
    <img src="https://img.shields.io/badge/License-BSD_3--Clause-blue.svg?style=flat-square"/>
  </a>
</p>
