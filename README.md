# Apex Log Analyzer for Salesforce

An analyzer for Salesforce debug logs aimed at making performance analysis much easier and quicker. You may also find it generally useful for quickly understanding how your code is executing.

The main view provides a flame graph for visualising code execution:

![Another](https://raw.githubusercontent.com/financialforcedev/debug-log-analyzer/main/lana/dist/images/FlameGraph.gif)

Hovering over an element provides information on the item. If you click on an item it will take you to the call
navigatable stack view.

Other views are available to show a sorted list of the methods invoked and the SOQL operations performed.

## Quick Start

You can start the analysis either from a log you have already downloaded or by downloading a log from an org to view.
To download run 'Log: Load Apex Log for Analysis' from the command palette. To open an existing log file right click it
and select 'Log: Show Apex Log Analysis'. On larger logs the analysis window make take a few seconds to appear.

## WARNING

The quality of data shown to you depends entirely on the data contained in the log files. Special care should be
taken when looking at log files that have been truncated as you are only seeing a part of the execution and that
may lead you to misunderstand what is really happening.

In general you should always set the APEX_CODE debug flag to be FINE or higher for a log to be used for analysis.
With a lower setting the log will likely not contain enough detail for meaningful analysis.
