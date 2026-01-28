---
id: timeline
title: Timeline
description: Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, measure time ranges, and navigate massive logs with the minimap overview for efficient Salesforce Apex log analysis and debugging.
keywords:
  [
    salesforce apex log analysis,
    flame chart visualization,
    apex debug log analyzer,
    code execution profiling,
    salesforce debugging,
    apex performance analysis,
    measure time range,
    area zoom selection,
    timeline minimap,
    log navigation,
  ]
image: https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png
hide_title: true
---

## 🔥 Timeline / Flame Chart

Use the Timeline to visualize code execution, event durations, and performance bottlenecks. Zoom, pan, navigate with the minimap overview, and interact with detailed tooltips for efficient Salesforce apex log analysis and debugging.

![Timeline view screenshot showing a color-coded flame chart of Salesforce event types such as DB, Method, and SOQL, visualizing code execution duration and performance](https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline.png)

The new experimental timeline is up to **7X faster** than the legacy timeline, with improved performance especially for large logs. It includes text labels on frames, faster zoom/pan operations, and a more natural time axis scaling.

:::tip Legacy Timeline
To revert to the legacy timeline, navigate to **Settings → Apex Log Analyzer → Timeline → Legacy** and enable it.
:::

## Minimap

The minimap gives you instant context of your entire log. Spot hotspots at a glance, jump anywhere with a click, and always know exactly where you are—all without scrolling.

### What the Minimap Shows

- **Skyline Chart**: A density-based visualization:
  - **Height** = maximum call stack depth at that point
  - **Color** = dominant event category (method, SOQL, DML, etc.)
  - **Opacity** = event density (brighter = more events)
- **Viewport Lens**: A window showing exactly what's visible in the main timeline (time range horizontal, depth range vertical)
- **Time Axis**: Time reference markers at the top
- **Markers**: Error, skip, and truncation markers from the main timeline
- **Cursor Mirroring**: Hover to see a guide line on the main timeline

### Mouse Interactions

| Action           | Mouse                 | Result                              |
| ---------------- | --------------------- | ----------------------------------- |
| Create Zoom      | Drag anywhere         | Draw a viewport area and zoom to it |
| Resize Viewport  | Drag lens edge        | Adjust zoom range                   |
| Move Viewport    | Drag top/`Shift+Drag` | Pan the viewport                    |
| Teleport Lens    | `Cmd/Ctrl+Click`      | Center the lens on click position   |
| Zoom In/Out      | Scroll (vertical)     | Zoom at cursor position             |
| Pan Horizontally | Scroll (horizontal)   | Move viewport left/right            |
| Pan Depth        | Drag (vertical)       | Scroll the main timeline up/down    |
| Reset            | Double-click          | Zoom out to fit entire timeline     |

:::tip Teleport Navigation
`Cmd/Ctrl+Click` is the fastest way to jump to any point in a massive log. The lens teleports to center on your click while preserving the current zoom level.
:::

### Keyboard Shortcuts

When your mouse is hovering over the minimap, these keyboard shortcuts are available:

| Key             | Action                                      |
| --------------- | ------------------------------------------- |
| `Arrow Left`    | Pan viewport left (10% of selection width)  |
| `Arrow Right`   | Pan viewport right (10% of selection width) |
| `Arrow Up`      | Pan depth up (show deeper frames)           |
| `Arrow Down`    | Pan depth down (show shallower frames)      |
| `W` / `+` / `=` | Zoom in (narrow the lens)                   |
| `S` / `-`       | Zoom out (widen the lens)                   |
| `Home`          | Jump to timeline start                      |
| `End`           | Jump to timeline end                        |
| `0` / `Escape`  | Reset zoom (fit entire timeline)            |

### Lens Label

When hovering over the viewport lens or dragging, a label appears showing:

- The **duration** of the selected time range (e.g., "1.23s")
- The **time range** start and end (e.g., "0.5s - 1.73s")

## Navigation

### Zoom + Pan

| Action           | Mouse                                          | Keyboard               |
| ---------------- | ---------------------------------------------- | ---------------------- |
| Zoom In/Out      | Scroll wheel (mouse-anchored)                  | `W` / `S` or `+` / `-` |
| Pan Horizontally | `Alt/Option` + Scroll, Trackpad swipe, or Drag | `A` / `D`              |
| Pan Vertically   | `Shift` + Scroll or Drag                       | `Shift+W` / `Shift+S`  |
| Reset Zoom       | —                                              | `Home` or `0`          |

- When zooming, the mouse pointer position is kept on screen (mouse-anchored zoom).
- Trackpad users can swipe left/right for natural horizontal panning.
- Time markers are shown with a ms time value (e.g., 9600.001 ms).

### Frame Selection

Click on any event to **select** and highlight it. Selection enables keyboard navigation through the call stack.

| Action              | Mouse             | Keyboard                     |
| ------------------- | ----------------- | ---------------------------- |
| Select Frame        | Click             | —                            |
| Clear Selection     | Click empty space | `Escape`                     |
| Navigate to Parent  | —                 | `Arrow Down`                 |
| Navigate to Child   | —                 | `Arrow Up`                   |
| Navigate to Sibling | —                 | `Arrow Left` / `Arrow Right` |
| Focus/Zoom to Frame | Double-click      | `Enter` or `Z`               |

:::tip Arrow Key Behavior
When no frame is selected, arrow keys pan the viewport. When a frame is selected, arrow keys navigate the call stack. Hold `Shift` to always pan.
:::

### Go to Call Tree

| Action            | Mouse              | Keyboard |
| ----------------- | ------------------ | -------- |
| Show in Call Tree | `Cmd/Ctrl` + Click | `J`      |
| Show Context Menu | Right-click        | —        |

Use `J` or `Cmd/Ctrl+Click` to navigate to the selected frame in the Call Tree. Right-click opens a context menu with additional actions.

### Context Menu

Right-click on any frame to access:

- **Show in Call Tree** (`J`) — Navigate to the frame in the Call Tree
- **Go to Source** — Jump to the source method in your project (when available)
- **Zoom to Frame** (`Z`) — Zoom and center the selected frame
- **Copy Name** (`Cmd/Ctrl+C`) — Copy the frame name to clipboard
- **Copy Details** — Copy tooltip information
- **Copy Call Stack** — Copy the full call stack

Right-click on empty space shows **Reset Zoom** (`0`).

### Markers

Log issue markers (truncation, errors, etc.) can be selected and navigated:

| Action            | Mouse              | Keyboard                                            |
| ----------------- | ------------------ | --------------------------------------------------- |
| Select Marker     | Click              | —                                                   |
| Navigate Markers  | —                  | `Arrow Left` / `Arrow Right` (when marker selected) |
| Jump to Call Tree | `Cmd/Ctrl` + Click | `J`                                                 |

### Search + Highlight

The timeline supports search functionality that dims non-matching events, making it easier to find specific matches visually.

| Action                | Keyboard                      |
| --------------------- | ----------------------------- |
| Next Match            | `Enter`                       |
| Previous Match        | `Shift+Enter`                 |
| Continuous Navigation | Hold `Enter` or `Shift+Enter` |

### Measurement & Zoom Tools

#### Measure Range

Use `Shift+Drag` to measure the duration between any two points on the timeline. This is useful for precisely measuring the time span of specific operations or groups of events.

| Action              | Mouse/Keyboard                                      |
| ------------------- | --------------------------------------------------- |
| Create Measurement  | `Shift+Drag` on timeline                            |
| Resize Measurement  | Drag the left or right edge of the measurement      |
| Zoom to Measurement | Double-click inside measurement, or click zoom icon |
| Clear Measurement   | `Escape` or click outside the measurement area      |

The measurement overlay displays:

- The time duration of the selected range
- A zoom icon to quickly zoom to fit the measured area

:::tip Resize Handles
Hover near the edges of an existing measurement to see the resize cursor. Drag to adjust the measurement boundaries — edges can be dragged past each other to swap positions.
:::

#### Area Zoom

Use `Alt/Option+Drag` to select a time range and instantly zoom to fit it. This provides a quick way to focus on a specific portion of the timeline.

| Action    | Mouse/Keyboard                |
| --------- | ----------------------------- |
| Area Zoom | `Alt/Option+Drag` on timeline |

Release the mouse button to zoom the viewport to fit the selected area exactly.

## Tooltip

<img
src="https://raw.githubusercontent.com/certinia/debug-log-analyzer/main/lana/assets/v1.18/lana-timeline-tooltip.png"
alt="Tooltip showing detailed event information including event name, description, timestamps, duration, and row counts"
style={{
  width: '50%', height:'auto', maxWidth:'400px'
}}
loading="lazy"/>

Hovering over an element displays detailed information about that event. Use `J` or `Cmd/Ctrl+Click` to navigate to the frame in the Call Tree.

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
