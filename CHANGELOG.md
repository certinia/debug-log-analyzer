# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] - 2023-03-15

## Added

- Redesigned Database tab ([#219][#219])
  - All columns are sortable ascending /descending by clicking the header
  - Added columns DML/ SOQL, Row Count, Total Time
  - Added specific columns for SOQL Selectivity + Aggregations
  - Added detail panel which is shown by clicking a row which shows the call stack for the specific DML / SOQL, clicking a link will go to the main call tree tab
  - The detail panel also shows a list of potential SOQL performance issues
  - Totals shown at the bottom of each column
  - SOQL/ DML is grouped by name by default, grouping can be removed to show the SOQL/ DML as a flat list
- `Log: Show Apex Log Analysis` code lens to the top of the currently open log file ([#199][#199])
  - This is a faster way to open the analysis
- Support for more file types when opening the analysis ([#199][#199])
  - The analysis can now be shown for any `.log` or `.txt` file that starts with the Apex debug log header
  - e.g `57.0 APEX_CODE,FINE;APEX_PROFILING,FINE;CALLOUT,NONE;DB,FINEST;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,FINE;WAVE,INFO;WORKFLOW,INFO`
- The row count to the timeline tooltip for events which have one e.g `SOQL_EXECUTE_BEGIN`, `DML_BEGIN`, `SOSL_EXECUTE_BEGIN` ([#129][#129])
- Calltree - Breadcrumbs shown at the top when clicking a row ([#142][#142])
- Calltree - displaying variable value as well as variable names for `VARIABLE_ASSIGNMENT` events ([#235][#235])
- Calltree - pretty formatting of JSON in `VARIABLE_ASSIGNMENT` events ([#235][#235])

### Changed

- Goto code from click to CMD/CTRL and click. Breadcrumbs are shown on click instead ([#142][#142])
- End time of events that start before `MAXIMUM DEBUG LOG SIZE REACHED` but have no matching end event, will now have their duration end before the `MAXIMUM DEBUG LOG SIZE REACHED` instead of extending to the very end of the log ([#264][#264])
  - This provides more accurate durations overall because we can not know what occured during the `MAXIMUM DEBUG LOG SIZE REACHED` gap.

### Fixed

- Timeline not showing events if the event occurs outside the `EXECUTION_STARTED` + `EXECUTION_FINISHED` events ([#180][#180])
- Timeline incorrectly showing some `VF_APEX_CALL_START` events when dealing with ApexPage messages ([#212][#212])
- Timeline tooltip not shown when zooming ([#242][#242])
- Font sizes not correctly scaling in some places ([#238][#238])

## [1.5.2] - 2022-11-08

### Fixed

- Spaces not supported in output directory path when running `Log: Load Apex Log For Analysis` command ([#187][#187])
- Fixes `ENTERING_MANAGED_PKG` events not being displayed on timeline ([#188][#188])

## [1.5.1] - 2022-10-04

### Fixed

- Fixes custom timeline event colors not being used from vscode preferences ([#163][#163])

## [1.5.0] - 2022-08-08

## Added

- Calltree filtering to hide nodes where total duration is less than a given time ([#112][#112])
- An `EXCEPTION_THROWN` marker (T) to supplement the`DML_BEGIN` (D) and `SOQL_EXECUTE_BEGIN` (S) markers on parent nodes ([#135][#135])
- Some missing line types: `DUPLICATE_DETECTION_BEGIN`, `DUPLICATE_DETECTION_END` and `DUPLICATE_DETECTION_RULE_INVOCATION` ([#139][#139])
- Salesforce Code Builder Support ([#23][#23])
  - Apex Log Analyzer to be published to the Open VSX Registry as well as the VSCode Marketplace

### Changed

- Rounded the log size on the `Log: Load Apex Log For Analysis` command results to 2DP ([#91][#91])
- Improved log parsing to tolerate false exits ([#88][#88])
  - Checks for false exits before un-winding the call stack, by checking down the stack to see if the EXIT matches something already on the stack.
- Greatly reduced CPU usage when Timeline is open but no changes are occurring ([#90][#90])
- Improved performance getting log file from an org when using the `Log: Load Apex Log For Analysis` command ([#123][#123])
- More easily differentiate between "Flows" and "Process Builders" in the timeline and call tree ([#114][#114])
- Counts on Calltree for Throw (T), DML (D) & SOQL (S) markers, which shows how many of each statement type are descendants of a node ([#135][#135])

### Fixed

- Some detail lines not being shown on calltree ([#130][#130])
- Tooltip not hiding when moving to a part of timeline where the tooltip should not be shown ([#131][#131])
- Timeline background shown as black in some browsers ([#137][#137])
- The TRUNCATED marker (for methods which were not complete at the end of the log) not being shown ([#135][#135])
- The hide checkboxes not always un-hiding ([#135][#135])
- Some NullPointers ([#135][#135])

## [1.4.2] - 2022-03-14

### Fixed

- Timeline content disappearing when switching tabs + resizing ([#99][#99])
- Timeline flickering/resizing when tooltip moved to bottom right ([#87][#87])
- Timeline not displaying `VF_APEX_CALL_START` log events ([#97][#97])
- Incorrect Totaltime on status bar and analysis tab ([#95][#95])
  - Now uses the timestamp of the last `EXECUTION_FINISHED` event to determine total time
  - If there are no `EXECUTION_FINISHED` events the last event with a timestamp is used
- Log parsing not handling both CRLF and LF line endings ([#108][#108])

## [1.4.1] - 2022-01-06

### Changed

- Reduced extension size

### Fixed

- Corrected README.md / CHANGELOG.md

## [1.4.0] - 2022-01-06

### Added

- Database tab shows the methods each SOQL or DML statement was made from ([#11][#11])
  - The method name can be clicked to navigate to it in the call tree
- Timeline shows a tooltip for log events ([#52][#52])
  - Shown when hovering the red (errors), blue (unexpected-end) and green (skipped-lines) sections on the timeline.
- Zoom on timeline ([#33][#33])
  - zoom to an accuracy of 0.001ms, time markers are shown with a ms time value and white line e.g 9600.001 ms
  - scroll up and down on the mouse to zoom in and out
  - zoom is based on position of mouse pointer, ensuring that position is kept on screen when zoomed in or out
  - scroll left and right on the mouse to move the time line left are right, when zoomed
  - click the mouse down and drag to move the timeline around both in the x and y direction, when zoomed
- Specify custom timeline event colors in vscode preferences ([#66][#66])
- Support for all [known log event types](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_debugging_system_log_console.htm) ([#81][#81])
  - Includes events for `Database`, `Workflow`, `NBA`, `Validation`, `Callout`, `Apex Code`, `Apex Profiling`, `Visualforce` and `System` categories.

### Changed

- Convert from scala to typescript ([#22][#22] [#34][#34])
- Load log shows loading feedback whilst waiting for logs to be retrieved ([#18][#18])
- Open an empty log view whilst waiting for selected log to be downloaded, parsed and rendered ([#18][#18])
- Log will be loaded from disk if previously downloaded ([#18][#18])
- Renamed the `Log: Show Log Analysis` command to `Log: Show Apex Log Analysis` ([#48][#48])
  - For consistency with the `Log: Load Apex Log For Analysis` command
- Block text on call tree displayed on new lines rather than one line separated by a | character ([#50][#50])
- Call tree shows text for all log lines and not just time taken ([#42][#42])
- Faster log loading due to a change in how the JavaScript is loaded on the page ([#11][#11])
- Faster log parsing and timeline rendering ([#63][#63])
- Scroll on the calltree to allow scrolling content to top of screen instead of only the bottom ([#73][#73])
- `FLOW_START_INTERVIEWS` log lines on the calltree and timeline will show either the Process Builder or Flow name after the chunk number ([#68][#68])

### Fixed

- Hide details, hide system calls and hide formulas on the call tree to work again ([#45][#45])

### Removed

- Timeline Shrink-to-fit checkbox was replaced with zoom feature ([#33][#33])

## [1.3.5] - December 2020

- Fix issue #7 Command 'lana.showLogFile' not found
- Fix issue #3 Cannot read property 'path' of undefined

## [1.3.4] - December 2020

- Fix issue #4 with Windows paths

## [1.3.3] - December 2020

- Synchronise versions

## [1.3.2] - December 2020

- Details for Visual Studio Code Marketplace listing
- Improvements to READMEs

## [1.3.1] - December 2020

- Small changes to command labels
- Improvements to READMEs

## [1.3] - September 2020

- When opening a source file, open at correct line.
- Misc Visual tweaks
- Add explorer menu item
- Provide more information when selecting log to download

[#11]: https://github.com/financialforcedev/debug-log-analyzer/issues/11
[#18]: https://github.com/financialforcedev/debug-log-analyzer/issues/18
[#22]: https://github.com/financialforcedev/debug-log-analyzer/issues/22
[#33]: https://github.com/financialforcedev/debug-log-analyzer/issues/33
[#34]: https://github.com/financialforcedev/debug-log-analyzer/issues/34
[#42]: https://github.com/financialforcedev/debug-log-analyzer/issues/42
[#45]: https://github.com/financialforcedev/debug-log-analyzer/issues/45
[#48]: https://github.com/financialforcedev/debug-log-analyzer/issues/48
[#50]: https://github.com/financialforcedev/debug-log-analyzer/issues/50
[#52]: https://github.com/financialforcedev/debug-log-analyzer/issues/52
[#63]: https://github.com/financialforcedev/debug-log-analyzer/issues/63
[#66]: https://github.com/financialforcedev/debug-log-analyzer/issues/66
[#68]: https://github.com/financialforcedev/debug-log-analyzer/issues/68
[#73]: https://github.com/financialforcedev/debug-log-analyzer/issues/73
[#81]: https://github.com/financialforcedev/debug-log-analyzer/issues/81
[#87]: https://github.com/financialforcedev/debug-log-analyzer/issues/87
[#95]: https://github.com/financialforcedev/debug-log-analyzer/issues/95
[#97]: https://github.com/financialforcedev/debug-log-analyzer/issues/97
[#99]: https://github.com/financialforcedev/debug-log-analyzer/issues/99
[#108]: https://github.com/financialforcedev/debug-log-analyzer/issues/108
[#91]: https://github.com/financialforcedev/debug-log-analyzer/issues/91
[#88]: https://github.com/financialforcedev/debug-log-analyzer/issues/88
[#90]: https://github.com/financialforcedev/debug-log-analyzer/issues/90
[#112]: https://github.com/financialforcedev/debug-log-analyzer/issues/112
[#123]: https://github.com/financialforcedev/debug-log-analyzer/issues/123
[#114]: https://github.com/financialforcedev/debug-log-analyzer/issues/114
[#130]: https://github.com/financialforcedev/debug-log-analyzer/issues/130
[#131]: https://github.com/financialforcedev/debug-log-analyzer/issues/131
[#137]: https://github.com/financialforcedev/debug-log-analyzer/issues/137
[#135]: https://github.com/financialforcedev/debug-log-analyzer/issues/135
[#139]: https://github.com/financialforcedev/debug-log-analyzer/issues/139
[#23]: https://github.com/financialforcedev/debug-log-analyzer/issues/23
[#142]: https://github.com/financialforcedev/debug-log-analyzer/issues/142
[#163]: https://github.com/financialforcedev/debug-log-analyzer/issues/163
[#180]: https://github.com/financialforcedev/debug-log-analyzer/issues/180
[#187]: https://github.com/financialforcedev/debug-log-analyzer/issues/187
[#188]: https://github.com/financialforcedev/debug-log-analyzer/issues/188
[#212]: https://github.com/financialforcedev/debug-log-analyzer/issues/212
[#199]: https://github.com/financialforcedev/debug-log-analyzer/issues/199
[#219]: https://github.com/financialforcedev/debug-log-analyzer/issues/219
[#129]: https://github.com/financialforcedev/debug-log-analyzer/issues/129
[#238]: https://github.com/financialforcedev/debug-log-analyzer/issues/238
[#242]: https://github.com/financialforcedev/debug-log-analyzer/issues/242
[#235]: https://github.com/financialforcedev/debug-log-analyzer/issues/235
[#264]: https://github.com/financialforcedev/debug-log-analyzer/issues/264
