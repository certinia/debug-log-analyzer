# 🚀 Apex Log Analyzer – Visualize Salesforce Debug Logs in VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Download](https://img.shields.io/visual-studio-marketplace/d/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

**Analyze Salesforce Apex Debug logs with blazing speed.**  
Apex Log Analyzer is a blazing-fast VS Code extension for Salesforce developers. Instantly visualize and debug Apex logs with interactive flame charts, dynamic call trees, and detailed SOQL/DML breakdowns. Identify performance bottlenecks, gain deep insight into complex transactions and optimize slow Apex methods faster than ever.

![Apex Log Analyzer Preview](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-preview.gif)

[Installation](#%EF%B8%8F-installation 'Install Apex Log Analyzer in VS Code') |
[Debug Log Levels](#%EF%B8%8F-recommended-debug-log-levels 'Go to Recommended Debug Log Levels') |
[Features](#-timeline 'Go to Features') |
[Customization](#-customization 'Go to Customization') |
[Documentation](#-documentation 'Go to Documentation') |
[Contributors](#%EF%B8%8F-contributors 'Go to Contributors') |
[License](#-license 'Go to License')

## 🚀 Key Features

- **🔥 [Timeline](#-timeline)** – Visualize every method, SOQL query, and DML operation in your Apex logs with an interactive flame chart and minimap navigation.
- **🌲 [Interactive Call Tree](#-call-tree)** – Dive into execution stacks with timing, row counts, and DML/ SOQL metrics.
- **📊 [Apex](#-apex-analysis) + [Database](#%EF%B8%8F-database-analysis) Analysis** – Identify slow-performing SOQL, high-impact DML, and time-heavy Apex methods.
- **📄 [Raw Log Navigation](#-raw-log-navigation)** – Jump between analysis views and raw log files with code folding, hover details, and bidirectional navigation.
- **🧠 Smart Filtering + Sorting** – Focus on what matters: filter by namespace, event type, or duration.
- **🔍 Deep Search** – Find events across the flame chart, call tree, and database tables.
- **📤 Export + Share** – Copy or Export Salesforce debug log insights for analysis or collaboration.

> ✨ Works with any `.log` Salesforce debug log file.

## 🛠️ Installation

### 📦 Install Apex Log Analyzer in VS Code

You can install Apex Log Analyzer directly from Visual Studio Code, the command line, or the Visual Studio Code Marketplace.

#### ✅ Option 1: Install via VS Code

1. Open the **Extensions** sidebar (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Search for `Apex Log Analyzer`.
3. Click **Install**.

#### 🌐 Option 2: Install from Marketplace

[➡️ Install Apex Log Analyzer on Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

#### 🧪 Option 3: Install via Command Line

```bash
code install financialforce.lana
```

#### ✨ Try the Pre-Release Version

💡 Access experimental features and shape future updates by switching to the Pre-Release Version from the extension banner in VS Code.

## ⚡ How It Works

### Start Analysis

You can analyze logs in two ways:

#### 1. Analyze an Open Log File

- Open a `.log` file in VS Code.
- Run `Log: Show Apex Log Analysis` via:
  - Command Palette (`Ctrl/Cmd + Shift + P`)
  - Top-of-file code lens
  - Right-click menu
  - Editor toolbar button

#### 2. Download a Log from Your Org

Use `Log: Retrieve Apex Log And Show Analysis` from the Command Palette.

## ⚙️ Recommended Debug Log Levels

- Set `APEX_CODE` level to `FINE` or higher — lower levels may omit important execution details.
- Be aware that higher debug levels introduce logging overhead, which can inflate recorded execution times.
- Avoid truncated logs — they can result in incomplete or misleading analysis.
- Recommended settings for a good balance of detail and performance: `APEX_CODE,FINE; APEX_PROFILING,FINE; CALLOUT,INFO; DB,FINEST; NBA,INFO; SYSTEM,DEBUG; VALIDATION,INFO; VISUALFORCE,FINE; WAVE,INFO; WORKFLOW,FINE`

## 🔥 Timeline

The Timeline view shows a live visualization of your Salesforce Apex log execution — including methods, SOQL queries, DML operations, workflows, flows, and more.

- **⚡ Fast** – Blazing-fast zoom, pan, and rendering even on massive logs (500k+ lines).
- **🗺️ Minimap** – Bird's-eye view with skyline density overview, viewport lens, and instant teleport.
- **📊 Governor Limits Strip** – At-a-glance limit usage with traffic light coloring. Expand for detailed step chart.
- **📏 Measure & Zoom** – `Shift+Drag` to measure durations, `Alt/Option+Drag` to area-zoom, precision keyboard controls.
- **🕐 Wall-Clock Time** – Toggle between elapsed and real-time (HH:MM:SS.mmm) on the time axis via the toolbar clock button.

Also: Frame Selection & Navigation, Dynamic Frame Labels, Adaptive Frame Detail, Tooltips, Context Menu, Search & Highlight, 19 Curated Themes.

![Flame Chart](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png)

> 🧠 Great for spotting long-running operations, inefficient queries, and bottlenecks.

## 🌲 Call Tree

Explore nested method calls with performance metrics:

- **Metrics**: Self Time, Total Time, SOQL/DML/Thrown Counts, SOQL/DML/Rows
- **Filter by Namespace, Type or Duration**
- **Toggle Debug-Only + Detail Events**
- **Keyboard Navigation**
- **Click to go to Code** – Jump to the source method in your project

![Call Tree](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-calltree.png)

## 🧠 Apex Analysis

See which methods are the slowest, most frequent. or expensive.

- **Group by Type or Namespace**
- **Sort by Duration, Count, Name, Type or Namespace**
- **Filter to specific event types**
- **Copy or Export to CSV**

![Analysis](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-analysis.png)

## 🗄️ Database Analysis

Highlight slow Salesforce SOQL queries, non-selective filters, and DML issues.

- **SOQL + DML Duration, Selectivity, Aggregates, Row Count**
- **Group by Namespace or Query**
- **View the Call Stack**
- **SOQL Optimization Tips**
- **Sort by SOQL or DML, Duration, Selectivity, Aggregates, Row Count**
- **Copy or Export to CSV**

![Database](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-database.png)

## 🔍 Global Search

Search across all visualizations:

- Timeline
- Call Tree
- Analysis
- Database

Quickly step through matches, auto-expand parents, and automatically show timeline tooltips.

## 📄 Raw Log Navigation

Seamlessly navigate between the visual analysis and your raw `.log` files:

- **Show in Raw Log** – Right-click any frame in Timeline or Call Tree → "Show in Log File" to jump to the exact line.
- **Show in Log Analysis** – Hover a raw log line to see metrics and click "Show in Log Analysis" to jump back.
- **Code Folding** – Collapse/expand matching start/end events (METHOD_ENTRY/EXIT, DML_BEGIN/END, etc.) using the gutter icons or `Ctrl+Shift+[`/`]`.
- **Line Decorations** – Duration appears as ghost text at the end of the cursor line (e.g., `1.23s (self: 45ms)`).
- **Hover Details** – Hover near the ghost text to see SOQL/DML counts, row counts, and exception info.
- **Total Duration** – First line displays total log execution time.

## 🎨 Customization

Adjust event colors in `settings.json`:

```json
"lana.timeline.customThemes": {
  "Glacial Warmth": {
    "apex": "#6882A6",
    "codeUnit": "#7A9B6E",
    "system": "#9E8E7C",
    "automation": "#D98650",
    "dml": "#C85A5A",
    "soql": "#57A89A",
    "callout": "#C9A64D",
    "validation": "#8B7BAC"
  },
  "Orchid Slate": {
    "apex": "#647C96",
    "codeUnit": "#8872A8",
    "system": "#8A7E7E",
    "automation": "#C08545",
    "dml": "#C94C6E",
    "soql": "#5A9E85",
    "callout": "#B5A044",
    "validation": "#4EA6A6"
  }
}
```

Or go to: `Preferences > Extensions > Apex Log Analyzer`.

## 📚 Documentation

- [User Guide & Docs](https://certinia.github.io/debug-log-analyzer/)
- [Contribute](https://github.com/certinia/debug-log-analyzer/blob/main/CONTRIBUTING.md)
- [Develop](https://github.com/certinia/debug-log-analyzer/blob/main/DEVELOPING.md)

## ❤️ Contributors

Thanks to our amazing contributors!

<p align="center">
  <a href="https://github.com/certinia/debug-log-analyzer/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=certinia/debug-log-analyzer&max=25" />
  </a>
</p>

## 📄 License

<p align="center">
Copyright &copy; Certinia Inc. All rights reserved.
</p>
<p align="center">
  <a href="https://opensource.org/licenses/BSD-3-Clause">
    <img src="https://img.shields.io/badge/License-BSD_3--Clause-blue.svg?style=flat-square"/>
  </a>
</p>

## 🙏 Acknowledgments

This project uses [Tabulator Tables](http://tabulator.info/), an open-source table library, under the MIT license. Tabulator is a powerful and flexible table library that helped with the interactive table features in the Apex Log Analyzer extension.

Additionally, the timeline color themes in Apex Log Analyzer draw inspiration from several open-source color palettes, editor themes, and UIs — including Salesforce UI, Chrome DevTools, and Firefox DevTools. We are grateful to the creators and maintainers of Catppuccin, Dracula, Nord, Solarized, Monokai Pro, Okabe–Ito, Material Design, and the broader theme communities whose work influenced the presets included in our timeline themes.
