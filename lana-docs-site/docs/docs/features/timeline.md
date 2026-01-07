---
id: timeline
title: Timeline
description: Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, and interact with detailed tooltips for efficient Salesforce Apex log analysis and debugging.
keywords:
  [
    salesforce apex log analysis,
    flame chart visualization,
    apex debug log analyzer,
    code execution profiling,
    salesforce debugging,
    apex performance analysis,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png
hide_title: true
---

## 🔥 Timeline / Flame Chart

Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, and interact with detailed tooltips for efficient Salesforce apex log analysis and debugging.

![Timeline view screenshot showing a color-coded flame chart of Salesforce event types such as DB, Method, and SOQL, visualizing code execution duration and performance](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png)

The new experimental timeline is up to **7X faster** than the legacy timeline, with improved performance especially for large logs. It includes text labels on events, faster zoom/pan operations, and a more natural time axis scaling.

:::tip Legacy Timeline
To revert to the legacy timeline, navigate to **Settings → Apex Log Analyzer → Timeline → Legacy** and enable it.
:::

## Navigation

### Zoom + Pan

- **Scroll up and down** with the mouse to zoom in and out to an accuracy of 0.001ms. Time markers are shown with a ms time value and white line (e.g., 9600.001 ms).
- When zooming, the mouse pointer position is kept on screen.
- **Scroll left and right** on the mouse to move the timeline left or right when zoomed.
- **Click and drag** to move the timeline around both in the x and y direction when zoomed.

### Go to Call Tree

Clicking an event in the Timeline will navigate to and select that event in the Call Tree.

### Search + Highlight

The timeline supports search functionality that greys out non-matching events, making it easier to find specific matches visually.

## Tooltip

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline-tooltip.png"
alt="Tooltip showing detailed event information including event name, description, timestamps, duration, and row counts"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}
loading="lazy"/>

Hovering over an element displays detailed information about that event. Clicking on an item navigates to that row in the Call Tree.

The tooltip provides the following information:

- **Event Name** - e.g., `METHOD_ENTRY`, `EXECUTION_STARTED`, `SOQL_EXECUTION_BEGIN`
- **Event Description** - Additional information about the event such as method name or SOQL query executed
- **Timestamp** - The start and end timestamp for the given event which can be cross-referenced in the log file
- **Duration** - Made up of **Total Time** (time spent in that event and its children) and **Self Time** (time directly spent in that event)
- **Rows** - Shows **Total Rows** (rows from that event and its children) and **Self Rows** (rows directly from that event)

## Themes

The timeline supports multiple color themes for better visual clarity and personalization. The extension includes 19 built-in themes with improved contrast and readability.

### Built-in Themes

The following themes are available out of the box:

- **50 Shades of Green** (default)
- 50 Shades of Green Bright
- Botanical Twilight
- Catppuccin
- Chrome
- Dracula
- Dusty Aurora
- Firefox
- Flame
- Forest Floor
- Garish
- Material
- Modern
- Monokai Pro
- Nord
- Nord Forest
- Okabe-Ito
- Salesforce
- Solarized

### Switching Themes

There are two ways to change the active timeline theme:

#### Command Palette

1. Open the Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Type **"Log: Timeline Theme"**
3. Select a theme from the list
4. Preview themes by navigating through the options with arrow keys
5. Press `Enter` to confirm, or `Esc` to revert to the previous theme

#### Settings

Navigate to **Settings → Apex Log Analyzer → Timeline → Active Theme** and select your preferred theme from the dropdown.

### Custom Themes

You can create custom color themes to match your preferences or specific use cases.

#### Creating Custom Themes

1. Navigate to **Settings → Apex Log Analyzer → Timeline → Custom Themes**
2. Define your custom theme(s) using the following structure:

```json
"lana.timeline.customThemes": {
  "My Theme": {
    "codeUnit": "#0176D3",
    "workflow": "#CE4A6B",
    "method": "#54698D",
    "flow": "#9050E9",
    "dml": "#D68128",
    "soql": "#04844B",
    "system": "#706E6B"
  },
  "High Contrast": {
    "codeUnit": "#722ED1",
    "workflow": "#52C41A",
    "method": "#1890FF",
    "flow": "#00BCD4",
    "dml": "#FF9100",
    "soql": "#EB2F96",
    "system": "#90A4AE"
  }
}
```

#### Theme Color Properties

Each theme requires the following color properties (in hex format):

- **codeUnit** - Code Unit events
- **workflow** - Workflow and automation events
- **method** - Method entry/exit events
- **flow** - Flow execution events
- **dml** - DML operations (insert, update, delete, etc.)
- **soql** - SOQL queries
- **system** - System method calls

Custom themes will appear in the theme selector alongside built-in themes and can be switched using the Command Palette or settings.

:::note
Custom theme names cannot override built-in theme names. If you use the same name as a built-in theme, the built-in theme will take precedence.
:::
