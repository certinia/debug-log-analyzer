# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- Convert from scala to typescript ([#22](https://github.com/financialforcedev/debug-log-analyzer/issues/22) [#34](https://github.com/financialforcedev/debug-log-analyzer/issues/34))
- Load log shows loading feedback whilst waiting for logs to be retrieved ([#18](https://github.com/financialforcedev/debug-log-analyzer/issues/18))
- Open an empty log view whilst waiting for selected log to be downloaded, parsed and rendered ([#18](https://github.com/financialforcedev/debug-log-analyzer/issues/18))
- Log will be loaded from disk if previously downloaded ([#18](https://github.com/financialforcedev/debug-log-analyzer/issues/18))

### Fixed

- Call tree to show text for all log lines and not just time taken ([#42](https://github.com/financialforcedev/debug-log-analyzer/issues/42))

### Fixed

- Hide details, hide system calls and hide formulas on the call tree to work again [#45](https://github.com/financialforcedev/debug-log-analyzer/issues/45)

### Changed

- Renamed the `Log: Show Log Analysis` command to `Log: Show Apex Log Analysis` [#48](https://github.com/financialforcedev/debug-log-analyzer/issues/48)
    - For consistency with the `Log: Load Apex Log For Analysis` command

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
