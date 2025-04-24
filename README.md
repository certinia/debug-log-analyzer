# 🚀 Apex Log Analyzer – Visualize Salesforce Debug Logs in VS Code

[![Version](https://img.shields.io/visual-studio-marketplace/v/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Download](https://img.shields.io/visual-studio-marketplace/d/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)
[![Ratings](https://img.shields.io/visual-studio-marketplace/r/financialforce.lana)](https://marketplace.visualstudio.com/items?itemName=financialforce.lana)

**Analyze Salesforce Apex Debug logs with blazing speed.**  
Apex Log Analyzer is a powerful VS Code extension for Salesforce developers. Instantly visualize and debug Apex logs in VS Code with interactive flame charts, dynamic call trees, and database insights to fix slow SOQL, DML, and Apex methods. Identify performance issues, uncover bottlenecks, and debug complex transactions faster than ever.

![Apex Log Analyzer Preview](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-preview.gif)

[Installation](#-installation 'Install Apex Log Analyzer in VS Code') |
[Debug Log Levels](#-recommended-debug-log-levels 'Go to Recommended Debug Log Levels') |
[Features](#-flame-chart-timeline 'Go to Features') |
[Customization](#-customization 'Go to Customization') |
[Documentation](#-documentation 'Go to Documentation') |
[Contributors](#-contributors 'Go to Contributors') |
[License](#-license 'Go to License')

## 🚀 Key Features

- **🔥 [Flame Chart Timeline](#-flame-chart-timeline)** – Visualize every method, SOQL query, and DML operation in your Apex logs.
- **🌲 [Interactive Call Tree](#-call-tree)** – Dive into execution stacks with timing, row counts, and DML/ SOQL metrics.
- **📊 [Apex](#-apex-analysis) + [Database](#-database-analysis) Analysis** – Identify slow-performing SOQL, high-impact DML, and time-heavy Apex methods.
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

## 🔥 Flame Chart Timeline

The Flame Chart view shows a timeline of the Salesforce Apex log execution — including methods, SOQL queries, DML operations, workflows, flows, and more.

- **Zoom & Pan** – Navigate your logs down to 0.001 ms with precision zoom.
- **Tooltips** – Hover for duration, event name, SOQL/DML/Exception counts, SOQL/DML rows, and more.
- **Click to Navigate** – Click any event to instantly view it in the interactive Call Tree.
- **Stacked by Time** – See how execution time is distributed across nested method calls and system events.

![Flame Chart](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-timeline.png)

> 🧠 Great for spotting long-running operations, inefficient queries, and bottlenecks.

## 🌲 Call Tree

Explore nested method calls with performance metrics:

- **Metrics**: Self Time, Total Time, SOQL/DML/Thrown Counts, SOQL/DML/Rows
- **Filter by Namespace, Type or Duration**
- **Toggle Debug-Only + Detail Events**
- **Keyboard Navigation**
- **Click to go to Code** – Jump to the source method in your project

![Call Tree](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-calltree.png)

## 🧠 Apex Analysis

See which methods are the slowest, most frequent. or expensive.

- **Group by Type or Namespace**
- **Sort by Duration, Count, Name, Type or Namespace**
- **Filter to specific event types**
- **Copy or Export to CSV**

![Analysis](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-analysis.png)

## 🗃️ Database Analysis

Highlight slow Salesforce SOQL queries, non-selective filters, and DML issues.

- **SOQL + DML Duration, Selectivity, Aggregates, Row Count**
- **Group by Namespace or Query**
- **View the Call Stack**
- **SOQL Optimization Tips**
- **Sort by SOQL or DML, Duration, Selectivity, Aggregates, Row Count**
- **Copy or Export to CSV**

![Database](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/dist/images/lana-database.png)

## 🔍 Global Search

Search across all visualizations:

- Timeline
- Call Tree
- Analysis
- Database

Quickly step through matches, auto-expand parents, and automatically show timeline tooltips.

## 🎨 Customization

Adjust event colors in `settings.json`:

```json
"lana.timeline.colors": {
  "Method": "#2B8F81",
  "DML": "#285663",
  "SOQL": "#5D4963",
  ...
}
```

Or go to: `Preferences > Extensions > Apex Log Analyzer`.

## 📚 Documentation

- [User Guide & Docs](https://certinia.github.io/debug-log-analyzer/)
- [Contribute](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/CONTRIBUTING.md)
- [Develop](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/DEVELOPING.md)

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
