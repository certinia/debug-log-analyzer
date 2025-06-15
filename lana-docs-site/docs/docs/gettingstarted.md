---
sidebar_position: 1
id: gettingstarted
title: Getting Started
descrition: A step-by-step guide to installing, configuring, and using the Apex Log Analyzer extension for Visual Studio Code to analyze Salesforce Apex debug logs efficiently.
keywords: [salesforce, apex, vscode, logs, getting started, debug log analyzer, install]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-timeline.png
---

## Installation

![install](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/install-lana.webp)

Search for `Apex Log Analyzer` from the extensions side bar in VS Code and click `Install` or
install from the VS Code market place by clicking install on [Visual Studio Code Market Place: Apex Log Analyzer](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

### Pre-Release

Click `Switch to Pre-Release Version` on the banner to get bleeding edge changes and help us to resolve bugs before the stable release.

## View Analysis

### Command Pallette

Open command pallette (CMD/CTRL + Shift + P), paste `ext install financialforce.lana`, and press enter.

```sh
ext install financialforce.lana
```

Start the analysis either from a log you have already downloaded or by downloading a log from an org to view.
On larger logs the analysis window make take a few seconds to appear.

### From an Open Log File

With the `.log` file open in VSCode.

1. Open command pallette (CMD/CTRL + Shift + P) -> 'Log: Show Apex Log Analysis'\
   or
1. Click the 'Log: Show Apex Log Analysis' code lens at the top of the file\
   ![show analysis lens](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-showanalysis-lens.webp)\
   or
1. Right click -> 'Log: Show Apex Log Analysis'
   or
1. Click editor 'Log: Show Apex Log Analysis' icon button at top of editor
   or
1. Right click editor tab -> 'Log: Show Apex Log Analysis'

### Download a log

1. Open command pallette (CMD/CTRL + Shift + P) -> 'Log: Retrieve Apex Log And Show Analysis

## ⚙️ Recommended Debug Log Levels

- Set `APEX_CODE` level to `FINE` or higher — lower levels may omit important execution details.
- Be aware that higher debug levels introduce logging overhead, which can inflate recorded execution times.
- Avoid truncated logs — they can result in incomplete or misleading analysis.
- Recommended settings for a good balance of detail and performance: `APEX_CODE,FINE; APEX_PROFILING,FINE; CALLOUT,INFO; DB,FINEST; NBA,INFO; SYSTEM,DEBUG; VALIDATION,INFO; VISUALFORCE,FINE; WAVE,INFO; WORKFLOW,FINE`
