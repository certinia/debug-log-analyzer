# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Table actions: copy to clipboard and export to CSV

### Change

- Highlight and copy text to clipboard: Call Tree, Analysis and Database views. ([#504][#504])
  - Previously the highlighted text would be immediately cleared.
- Sharper timeline rending on HiDPI displays ([#588][#588]).

### Fixed

- Call Tree: Performance regression of Call Tree rendering ([#581][#581])
- Call Tree: Call Tree not correctly keeping position when rows where hidden / shown via Details and Debug Only ([#581][#581])
- Database: Call stack shows items horizontally instead of vertically ([#582][#582])

## [1.16.1] - 2024-12-03

### Fixed

- Fixed search being triggered by and hijacking the "Find in Files" keybinding (CMD / CTRL + SHIFT + f) ([#537][#537])
- Analysis: Total Time showing a higher value than it should ([#526][#526])
- Analysis, Call Tree and Database search results not being consistent ([#536][#536])

## [1.16.0] - 2024-07-23

### Added

- 🔍 Search the Log Analyzer: Timeline, Call Tree, Analysis and Database views all searchable ([#488][#488])
- 🛠️ Call Tree filter by event type: filter down to specific event types e.g `EXCEPTION_THROWN`. ([#382][#382])
- ⬆️ Go To Call Tree button from the issue list. ([#481][#481])
- 📊 More ways to open the log analysis. ([#506][#506])
  - From the button on the editor title menu.
  - From the tab context menu (right clicking the editor tab).
- 📖 Brand new [documentation site](https://certinia.github.io/debug-log-analyzer). ([#65][#65])

### Changed

- ⚡ Call Tree performance improvements: All operations should be 3X faster (including expanding, filtering and scrolling). ([#500][#500])
- 🧊 Call Tree keeps focus on the visible rows after filtering / expanding.([#481][#481])
- ⬆️ Go to the Call Tree from the Timeline errors. ([#481][#481])
- ⚡ Faster Extension startup time: roughly 12 times faster and starts up time is less than 10ms.

## [1.14.1] - 2024-03-01

### Fixed

- `Log: Retrieve Apex Log And Show Analysis` not working ([#490][#490])

## [1.14.0] - 2024-02-12

### Added

- View, Filter and Group by namespace on the Call Tree, Analysis + Database views ([#299][#299])
  - View and Filter by namespace on the Call Tree, Analysis and Database views
  - Group by namespace on the Analysis and Database views

### Changed

- Apex Log Parsing is up to 3X faster ([#475][#475])
- Go to file multiple workspace handling simplified ([#202][#202])
  - Go to file from Call Tree will only ask you to select a workspace if more than one matching file is found in multiple workspaces, instead of everytime.

## [1.12.1] - 2023-12-11

### Fixed

- Unable to Save file when exporting CSV from Analysis or Database ([#461][#461])

## [1.12.0] - 2023-12-05

### Added

- Debug Only Call Tree filtering ([#86][#86])
  - Filters the Call Tree to show only debug statements with the context of the Call Stack.
- Percent value (of the total log time) in the self and total columns. Visually represent the percentage via a percent bar as well as a value e.g 100 (50%) ([#311][#311])
  - This is show for both the Call Tree and Analysis
- Show Log Parsing issues via notification bell ([#209][#209])
  - Shows unsupported log event names + invalid log lines
- Open Apex Log Analyzer from a dirty vscode editor ([#213][#213])
  - Supports opening Apex Log Analyzer when a log is dragged and dropped into Salesforce Code Builder.
  - It allows for a log analysis to be shown when a file is deleted on local disk or a log is copy and pasted into an editor window without saving.

### Changed

- Show time taken for more events within the `Workflow:ApprovalProcessActions` Code Unit ([#336][#336])
  - Estimates the time taken for some events without an exit event within `Workflow:ApprovalProcessActions` Code Unit e.g `WF_APPROVAl` + `WF_EMAIL_SENT`
- Make dragging more obvious on the Timeline by showing different cursors ([#423][#423])
  - Show the pointer cursor by default when hovering the Timeline.
  - Show the grabbing cursor when the mouse is pressed down on the Timeline, to indicate drag is now possible.
  - Show the default cursor when hovering a Timeline event.
- Timeline event marker clarity improvements ([#115][#115])
  - Skipped-Lines and Max-Size-reached marker color from green to blue. Green normal mean things are ok, blue better represents information.
  - Added faint grey lines between the event markers to separates them. This helps when two error are next to each other.

## [1.10.4] - 2023-11-22

### Fixed

- Log Analysis not displaying if user path contained whitespace ([#447][#447])

## [1.10.3] - 2023-11-07

### Fixed

- Call Tree Show Details not showing and hiding correctly ([#433][#433])
- Infinite loading screen if file can not be found ([#435][#435])
- Many cases of UI jumping in the Database view when rows and groups are clicked ([#434][#434])

## [1.10.1] - 2023-10-26

### Fixed

- Call Tree not showing `USER_DEBUG` content ([#429][#429])

## [1.10.0] - 2023-10-19

### Added

- Redesigned Navigation Bar ([#249][#249])
  - Help moved to icon in top right
  - Tabs now look and feel like vscode tabs
  - Log title redesigned for a more modern feel
  - Log Duration + Log Size now displayed as badges
  - Log issues show in a separate dialog when the issues count tag is clicked on the navigation bar
- Database View tweaks ([#279][#279])
  - Show full SOQL/ DML text instead of truncating
  - Show the detail panel by default, including call stack and SOQL issues.
- Database, Call Tree and Analysis View ([#279][#279])
  - New sort icon (up and down arrow) when a column is in an unsorted state
- Analysis View ([#279][#279])
  - Show full event text instead of truncating
- Show skeleton loading UIs / UI Outlines when waiting for the log to be processed e.g when running `Log: Retrieve Apex Log And Show Analysis` and `Log: Show Apex Log Analysis` ([#252][#252])
  - This could be waiting for the log to download from the org or to be parsed and processed.
- What's new notification to open the change log on upgrades ([#210][#210])
- Show the Certinia logo next to the currently opened Log Analyzer tab and next to the file name on the file list in the quick open menu ([#250][#250])
- The Log Analyzer will be published as a pre-release extension weekly ([#300][#300])
  - Click `Switch to Pre-Release Version` on the banner to get bleeding edge changes and help us to resolve bugs before the stable release.

### Changed

- Hyperlink styling to align with VSCode ([#248][#248])

### Fixed

- `Export to CSV` not working when a log was opened in a new VSCode window and not associated to a workspace ([#363][#363])

## [1.8.0]

Skipped due to adopting odd numbering for pre releases and even number for releases.

## [1.7.1] - 2023-08-10

### Fixed

- `Log: Show Apex Log Analysis` code lense not showing until another command is used first ([#340][#340])
- Go to Call Tree from SOQL detail Call Stack on the Database View ([#346][#346])

## [1.7.0] - 2023-08-04

### Added

- Call tree: Redesigned view ([#297][#297])
  - All columns are sortable ascending or descending by clicking the header
  - Child rows will be sorted within their parent
  - The name column has 3 states call order, ascending or descending
  - Columns for DML Count, SOQL Count, Throws Count, Rows Count, Total Time and Self Time
  - Range filtering with min and max values for the Total Time and Self Time columns
  - Keyboard navigation to move between selected rows. Use the up and down arrows for up and down and left and right to collapse or expand the tree
  - Virtualised rows means much better performance
- Analysis: Redesigned view ([#294][#294])
  - All columns are sortable ascending or descending by clicking the header
  - Columns to show Event Type, Aggregated Total Time and Aggregated Self Time
  - Virtualised row rendered to greatly improve performance
  - Group by Event Type to show aggregated totals for each type e.g See the Total Time for all `METHOD_ENTRY` events
  - Keyboard navigation to move between selected rows. Use the up and down arrows for up and down
- Analysis: Export data ([#25][#25])
  - Copy data to clipboard directly from Analysis grid by focusing on the grid and using `ctrl + c` or `cmd + c`
  - Export to CSV file using the `Export to CSV` action in the grid header menu
- Database: Export data ([#25][#25])
  - Copy data to clipboard directly from either the DML or SOQL grid by focusing on the grid and using `ctrl + c` or `cmd + c`
  - Export to CSV file using the `Export to CSV` action in the grid header menu
- Database: keyboard navigation ([#294][#294])
  - Keyboard navigation to move between selected rows. Use the up and down arrows for up and down. Left and right arrows will hide / show the detail panel,

### Changed

- Increase the supported log size for the go to log hyperlink to larger than 50MB ([#254][#254])
- Renamed `Log: Load Apex Log For Analysis` to `Log: Retrieve Apex Log And Show Analysis` ([#288][#288])
- Improve performance of `Log: Retrieve Apex Log And Show Analysis` ([#255][#255])
- Update minimum supported vscode version to v1.74.0 ([#280][#280])
- Support for more undocumented log events such as `NBA_*`, `ORG_CACHE_*`, `SESSION_CACHE_*`, `FUNCTION_INVOCATION_*` and more ([#246][#246])

### Fixed

- `ENTERING_MANAGED_PKG` events would wrongly have other events rollup into them ([#320][#320])
  - Note: This now means some events will no longer be rolled up into `ENTERING_MANAGED_PKG`
  - e.g `SOQL_BEGIN` will be between two `ENTERING_MANAGED_PKG` events instead of nested inside one
- Database page scrolls up when a grouped row neat bottom of grid is clicked ([#312][#312])

## [1.6.0] - 2023-05-19

### Added

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
- Call Tree - Breadcrumbs shown at the top when clicking a row ([#142][#142])
- Call Tree - displaying variable value as well as variable names for `VARIABLE_ASSIGNMENT` events ([#235][#235])
- Call Tree - pretty formatting of JSON in `VARIABLE_ASSIGNMENT` events ([#235][#235])

### Changed

- Goto code from click to CMD/CTRL and click. Breadcrumbs are shown on click instead ([#142][#142])
- End time of events that start before `MAXIMUM DEBUG LOG SIZE REACHED` but have no matching end event, will now have their duration end before the `MAXIMUM DEBUG LOG SIZE REACHED` instead of extending to the very end of the log ([#264][#264])
  - This provides more accurate durations overall because we can not know what occurred during the `MAXIMUM DEBUG LOG SIZE REACHED` gap.

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

### Added

- Call Tree filtering to hide nodes where total duration is less than a given time ([#112][#112])
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
- Counts on Call Tree for Throw (T), DML (D) & SOQL (S) markers, which shows how many of each statement type are descendants of a node ([#135][#135])

### Fixed

- Some detail lines not being shown on Call Tree ([#130][#130])
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
- Incorrect Total Time on status bar and analysis tab ([#95][#95])
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
- Scroll on the Call Tree to allow scrolling content to top of screen instead of only the bottom ([#73][#73])
- `FLOW_START_INTERVIEWS` log lines on the Call Tree and timeline will show either the Process Builder or Flow name after the chunk number ([#68][#68])

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

<!-- Unreleased -->

[#504]: https://github.com/certinia/debug-log-analyzer/issues/504
[#581]: https://github.com/certinia/debug-log-analyzer/issues/581
[#582]: https://github.com/certinia/debug-log-analyzer/issues/582
[#588]: https://github.com/certinia/debug-log-analyzer/issues/588

<!-- 1.16.1 -->

[#537]: https://github.com/certinia/debug-log-analyzer/issues/537
[#526]: https://github.com/certinia/debug-log-analyzer/issues/526
[#536]: https://github.com/certinia/debug-log-analyzer/issues/536

<!-- v1.16.0 -->

[#488]: https://github.com/certinia/debug-log-analyzer/issues/488
[#382]: https://github.com/certinia/debug-log-analyzer/issues/382
[#506]: https://github.com/certinia/debug-log-analyzer/issues/506
[#500]: https://github.com/certinia/debug-log-analyzer/issues/500
[#65]: https://github.com/certinia/debug-log-analyzer/issues/65
[#481]: https://github.com/certinia/debug-log-analyzer/issues/481

<!-- v1.14.1 -->

[#490]: https://github.com/certinia/debug-log-analyzer/issues/490

<!-- v1.14.0 -->

[#475]: https://github.com/certinia/debug-log-analyzer/issues/475
[#299]: https://github.com/certinia/debug-log-analyzer/issues/299
[#202]: https://github.com/certinia/debug-log-analyzer/issues/202

<!-- v1.12.1 -->

[#461]: https://github.com/certinia/debug-log-analyzer/issues/461

<!-- v1.12.0 -->

[#311]: https://github.com/certinia/debug-log-analyzer/issues/311
[#336]: https://github.com/certinia/debug-log-analyzer/issues/336
[#213]: https://github.com/certinia/debug-log-analyzer/issues/213
[#86]: https://github.com/certinia/debug-log-analyzer/issues/86
[#115]: https://github.com/certinia/debug-log-analyzer/issues/115
[#423]: https://github.com/certinia/debug-log-analyzer/issues/423
[#209]: https://github.com/certinia/debug-log-analyzer/issues/209

<!-- v1.10.4 -->

[#447]: https://github.com/certinia/debug-log-analyzer/issues/447

<!-- v1.10.2 -->

[#434]: https://github.com/certinia/debug-log-analyzer/issues/434
[#435]: https://github.com/certinia/debug-log-analyzer/issues/435
[#433]: https://github.com/certinia/debug-log-analyzer/issues/433

<!-- v1.10.1 -->

[#429]: https://github.com/certinia/debug-log-analyzer/issues/429

<!-- v1.10.0 -->

[#279]: https://github.com/certinia/debug-log-analyzer/issues/279
[#210]: https://github.com/certinia/debug-log-analyzer/issues/210
[#250]: https://github.com/certinia/debug-log-analyzer/issues/250
[#252]: https://github.com/certinia/debug-log-analyzer/issues/252
[#363]: https://github.com/certinia/debug-log-analyzer/issues/363
[#248]: https://github.com/certinia/debug-log-analyzer/issues/248
[#249]: https://github.com/certinia/debug-log-analyzer/issues/249
[#300]: https://github.com/certinia/debug-log-analyzer/issues/300

<!-- v1.7.1 -->

[#340]: https://github.com/certinia/debug-log-analyzer/issues/340
[#346]: https://github.com/certinia/debug-log-analyzer/issues/346

<!-- v1.7.0 -->

[#280]: https://github.com/certinia/debug-log-analyzer/issues/280
[#288]: https://github.com/certinia/debug-log-analyzer/issues/288
[#254]: https://github.com/certinia/debug-log-analyzer/issues/254
[#297]: https://github.com/certinia/debug-log-analyzer/issues/297
[#294]: https://github.com/certinia/debug-log-analyzer/issues/294
[#246]: https://github.com/certinia/debug-log-analyzer/issues/246
[#25]: https://github.com/certinia/debug-log-analyzer/issues/25
[#320]: https://github.com/certinia/debug-log-analyzer/issues/320
[#312]: https://github.com/certinia/debug-log-analyzer/issues/312
[#255]: https://github.com/certinia/debug-log-analyzer/issues/255

<!-- Older versions -->

[#11]: https://github.com/certinia/debug-log-analyzer/issues/11
[#18]: https://github.com/certinia/debug-log-analyzer/issues/18
[#22]: https://github.com/certinia/debug-log-analyzer/issues/22
[#33]: https://github.com/certinia/debug-log-analyzer/issues/33
[#34]: https://github.com/certinia/debug-log-analyzer/issues/34
[#42]: https://github.com/certinia/debug-log-analyzer/issues/42
[#45]: https://github.com/certinia/debug-log-analyzer/issues/45
[#48]: https://github.com/certinia/debug-log-analyzer/issues/48
[#50]: https://github.com/certinia/debug-log-analyzer/issues/50
[#52]: https://github.com/certinia/debug-log-analyzer/issues/52
[#63]: https://github.com/certinia/debug-log-analyzer/issues/63
[#66]: https://github.com/certinia/debug-log-analyzer/issues/66
[#68]: https://github.com/certinia/debug-log-analyzer/issues/68
[#73]: https://github.com/certinia/debug-log-analyzer/issues/73
[#81]: https://github.com/certinia/debug-log-analyzer/issues/81
[#87]: https://github.com/certinia/debug-log-analyzer/issues/87
[#95]: https://github.com/certinia/debug-log-analyzer/issues/95
[#97]: https://github.com/certinia/debug-log-analyzer/issues/97
[#99]: https://github.com/certinia/debug-log-analyzer/issues/99
[#108]: https://github.com/certinia/debug-log-analyzer/issues/108
[#91]: https://github.com/certinia/debug-log-analyzer/issues/91
[#88]: https://github.com/certinia/debug-log-analyzer/issues/88
[#90]: https://github.com/certinia/debug-log-analyzer/issues/90
[#112]: https://github.com/certinia/debug-log-analyzer/issues/112
[#123]: https://github.com/certinia/debug-log-analyzer/issues/123
[#114]: https://github.com/certinia/debug-log-analyzer/issues/114
[#130]: https://github.com/certinia/debug-log-analyzer/issues/130
[#131]: https://github.com/certinia/debug-log-analyzer/issues/131
[#137]: https://github.com/certinia/debug-log-analyzer/issues/137
[#135]: https://github.com/certinia/debug-log-analyzer/issues/135
[#139]: https://github.com/certinia/debug-log-analyzer/issues/139
[#23]: https://github.com/certinia/debug-log-analyzer/issues/23
[#142]: https://github.com/certinia/debug-log-analyzer/issues/142
[#163]: https://github.com/certinia/debug-log-analyzer/issues/163
[#180]: https://github.com/certinia/debug-log-analyzer/issues/180
[#187]: https://github.com/certinia/debug-log-analyzer/issues/187
[#188]: https://github.com/certinia/debug-log-analyzer/issues/188
[#212]: https://github.com/certinia/debug-log-analyzer/issues/212
[#199]: https://github.com/certinia/debug-log-analyzer/issues/199
[#219]: https://github.com/certinia/debug-log-analyzer/issues/219
[#129]: https://github.com/certinia/debug-log-analyzer/issues/129
[#238]: https://github.com/certinia/debug-log-analyzer/issues/238
[#242]: https://github.com/certinia/debug-log-analyzer/issues/242
[#235]: https://github.com/certinia/debug-log-analyzer/issues/235
[#264]: https://github.com/certinia/debug-log-analyzer/issues/264
