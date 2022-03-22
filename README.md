# Apex Log Analyzer for Salesforce

[![Version](https://vsmarketplacebadge.apphb.com/version-short/financialforce.lana.svg)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Download](https://vsmarketplacebadge.apphb.com/downloads-short/financialforce.lana.svg)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Installs](https://vsmarketplacebadge.apphb.com/installs-short/financialforce.lana.svg)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Ratings](https://vsmarketplacebadge.apphb.com/rating-short/financialforce.lana.svg)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

Apex Log Analyzer makes performance analysis of Salesforce debug logs much easier and quicker. It provides visualization of code execution via a Flamegraph and Calltree and helps identify performance and SOQL/DML problems via Method and Database Analysis.

![preview](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/lana-preview.gif)

## WARNING

> In general set the `APEX_CODE` debug flag to be `FINE` or higher, with a lower level the log will likely not contain enough detail for meaningful analysis.
>
> The quality of data shown depends entirely on the data contained in the log files.\
> Special care should be taken when looking at log files that have been truncated as you are only seeing a part of the execution and that may lead you to misunderstand what is really happening.
>
> A log level of `FINE` seems to give a good balance between log detail and execution time.\
> Higher log levels result in higher reported execution time than would be seen with logging off.\
> This is due to the over head associated with logging method entry and exit.

## Installation

![install](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/install-lana.png)

- Search for `Apex Log Analyzer` in extensions.
- Click install + then reload VSCode.

### Command Pallette

- Open command pallette (CMD/CTRL + Shift + P), paste `ext install financialforce.lana`, and press enter.
- Clcik reload in the extensions tab.

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
1. Right click -> 'Log: Show Apex Log Analysis'

### Download a log

1. Open command pallette (CMD/CTRL + Shift + P) -> 'Log: Load Apex Log for Analysis'

## Features

### Timeline / Flame graph

![timeline](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/timeline-lana.png)

The Timeline shows a visualization of code execution during a request’s execution. Each color represents a different Salesforce event type e.g DB, Method, SOQL etc. The length of a bar relates to realtime taken e.g a longer bar means that method took longer.

- Scroll up and down on the mouse to zoom in and out to an accuracy of 0.001ms, time markers are shown with a ms time value and white line e.g 9600.001 ms.
- When zooming the mouse pointer position is kept on screen.
- Scroll left and right on the mouse to move the time line left are right, when zoomed
- Click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed

![tooltip](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/tooltip-lana.png)

Hovering over an element provides information on the item. If you click on an item it will take you to the call
navigatable stack view.

The tooltip provides the following information.\
**Event Name** e.g `METHOD_ENTRY`, `EXECUTION_STARTED`, `SOQL_EXECUTION_BEGIN` etc\
**Event Description** Addtional information about the event such as method name or SOQL query executed.\
**Timestamp** is the start and end timestamp for the given event which can crossreferenced in the log file.\
**Duration** is made up of **Total Time** and **Self Time**.\
**Self Time** represents the time directly spent in that event.\
**Total Time** represents the time spent in that event or any of its children.

#### Color settings

The default colors shown on the timeline can be changed in the VSCode settings.\
Either in the UI `preferences -> extensions -> Apex Log Analyzer`

![color settings](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/settings-color-lana.png)

or

settings.json

```json
"lana.timeline.colors": {
  "Code Unit": "#6BAD68",
  "SOQL": "#4B9D6E",
  "Method": "#328C72",
  "Flow": "#237A72",
  "DML": "#22686D",
  "Workflow": "#285663",
  "System Method": "#2D4455"
}
```

### Calltree

![calltree](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/calltree-lana.png)

Shows the call stack which can be expanded and collapsed. Clicking on a link will take you to that line in the class if it can be found in the current open project.

Each row shows event type, details such as method signature, self and total time as well as line number.

### Analysis

![analysis](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/analysis-lana.png)

Show analysis on method calls. The table can be sorted ascending or descending by Self Time, Total Time, Count (number of times a method was called) and name.

### Database

![database](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/db-lana.png)

Shows the SOQL and DML that occured as well as the number of times each SOQL/DML occured and the number of rows returned.
Cliking on the links will take you to where that SOQL/DML occured in the call tree.

## Contributing

Help us to make things better by [Contributing](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/CONTRIBUTING.md)\
Find out how to [Build](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/BUILDING.md) the extension

---

<p align="center">
Copyright &copy; FinancialForce.com, inc. All rights reserved.  
</p>
<p align="center">
  <a href="https://opensource.org/licenses/BSD-3-Clause">
    <img src="https://img.shields.io/badge/License-BSD_3--Clause-blue.svg?style=flat-square"/>
  </a>
</p>
