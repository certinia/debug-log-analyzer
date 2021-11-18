# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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

### Changed

- Convert from scala to typescript ([#22][#22] [#34][#34])
- Load log shows loading feedback whilst waiting for logs to be retrieved ([#18][#18])
- Open an empty log view whilst waiting for selected log to be downloaded, parsed and rendered ([#18][#18])
- Log will be loaded from disk if previously downloaded ([#18][#18])
- Renamed the `Log: Show Log Analysis` command to `Log: Show Apex Log Analysis` [#48][#48]
  - For consistency with the `Log: Load Apex Log For Analysis` command
- Block text on call tree displayed on new lines rather than one line separated by a | character ([#50][#50])
- Call tree to show text for all log lines and not just time taken ([#42][#42])
- Faster log loading due to a change in how the JavaScript is loaded on the page ([#11][#11])
- Faster log parsing and timeline rendering ([#63][#63])
- Scroll on the calltree to allow scrolling content to top of screen instead of only the bottom ([#73][#73])

### Fixed

- Hide details, hide system calls and hide formulas on the call tree to work again [#45][#45]

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
[#73]: https://github.com/financialforcedev/debug-log-analyzer/issues/73
