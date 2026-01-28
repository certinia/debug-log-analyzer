# Timeline Optimised Module

This module implements the high-performance flame chart visualization for Apex debug logs.

## Architecture Overview

The module follows a **pure orchestrator** pattern where FlameChart is a generic coordinator that delegates all feature-specific logic to dedicated classes.

## Dependency Boundaries

**Critical: Files in `timeline/optimised/` must NOT import directly from outside the `timeline/` folder.**

The only exception is `ApexLogTimeline.ts`, which serves as the adapter layer converting Apex-specific types to generic timeline types.

### Import Rules

```typescript
// GOOD: Import from types file (the boundary)
import type { LogEvent } from '../types/flamechart.types.js';

// BAD: Direct import from outside timeline folder
import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
```

The `flamechart.types.ts` file re-exports necessary types from external modules, keeping dependencies contained at the boundary.

## Spatial Queries: Use TemporalSegmentTree

**Always use TemporalSegmentTree (via RectangleManager) for frame queries. Never traverse the event tree directly.**

### Available Query Methods

| Method                                 | Use Case                       | Complexity   |
| -------------------------------------- | ------------------------------ | ------------ |
| `query(viewport)`                      | Viewport culling for rendering | O(k log n)   |
| `queryEventsInRegion(time, depth)`     | Hit testing, spatial lookups   | O(log n + k) |
| `queryBucketStats(timeStart, timeEnd)` | Minimap density computation    | O(log n)     |

### Access Pattern

```typescript
// Via RectangleManager (preferred)
const events = rectangleManager.queryEventsInRegion(timeStart, timeEnd, depthStart, depthEnd);

// Direct tree access (for specialized queries)
const tree = rectangleManager.getSegmentTree();
const stats = tree.queryBucketStats(timeStart, timeEnd);
```

### Why Not TimelineEventIndex?

`TimelineEventIndex.findEventsInRegion()` does O(n) full tree traversal. Use it only as a fallback when TemporalSegmentTree is unavailable.

## Class Responsibilities

### FlameChart (Orchestrator)

- **Pure orchestrator** - delegates all logic to feature classes
- Wires up renderers, handlers, managers
- Coordinates render loop
- **NO business logic** - only delegation and composition

### ApexLogTimeline (Apex Adapter)

- Apex-specific translation layer
- Converts ApexLog to generic EventNode data
- Handles themes, tooltips, markers
- Delegates rendering to FlameChart

### SelectionManager

- Owns selection state (`selectedNode`)
- Tree navigation logic (up/down/left/right)
- Selection lifecycle (select, clear, navigate)
- Maps hit test results to tree nodes

### SearchManager

- Owns search state and cursor
- Tree traversal with predicates
- Match collection and navigation

### Renderers (\*Renderer classes)

- Pure rendering, no business logic
- Receive data, output visuals
- Examples: `SelectionHighlightRenderer`, `SearchHighlightRenderer`, `TextLabelRenderer`

### Handlers (\*Handler classes)

- Input processing only
- Invoke callbacks, don't manage state
- Examples: `KeyboardHandler`, `TimelineInteractionHandler`

### TimelineViewport

- Owns viewport state (zoom, pan, bounds)
- All coordinate transformations and calculations
- Screen-to-world and world-to-screen conversions
- Tooltip positioning calculations (e.g., `calculateVisibleCenterX`)
- FlameChart delegates coordinate math here, never implements it inline

## Coordinate System Note

The main timeline uses an **inverted Y-axis** (`scale.y = -1`) where:

- Y=0 is at the BOTTOM of the screen
- Depth 0 (root frames) render at the BOTTOM
- Higher depths (child frames) render ABOVE

The minimap uses standard screen coordinates but maps depths to match the main timeline's visual orientation:

- Axis is at TOP of minimap (Y=0 to Y=axisHeight)
- Chart area is BELOW axis (Y=axisHeight to Y=minimapHeight)
- Depth 0 maps to BOTTOM of chart area (Y=minimapHeight)
- maxDepth maps to TOP of chart area (Y=axisHeight, just below axis)
- The curtain (dimming overlay) covers ONLY the chart area (Y=axisHeight to Y=minimapHeight)
- The axis area (Y=0 to Y=axisHeight) is NOT dimmed to keep labels crisp and readable

This ensures the minimap's viewport lens correctly shows which depth range is visible - when scrolled to show parent frames (depth 0), the lens highlights the BOTTOM of the chart area.

## Minimap Interactions

The minimap supports intuitive drag interactions for viewport control:

| Interaction              | Action                                 |
| ------------------------ | -------------------------------------- |
| Drag anywhere            | Create new zoom area selection         |
| Drag on lens edge        | Resize viewport (ew-resize cursor)     |
| Shift + drag inside lens | Move existing viewport                 |
| Shift + drag Y direction | Pan depth (vertical scroll)            |
| Wheel vertical           | Zoom at cursor position                |
| Wheel horizontal         | Pan selection                          |
| Double-click             | Reset view (zoom to fit full timeline) |

**Key design decision:** Default drag creates a new selection, even inside the lens. This makes "zoom to area" the primary action. Hold Shift to move/pan the existing viewport instead.

### Minimap Keyboard Shortcuts

When the mouse cursor is over the minimap, keyboard shortcuts are available for viewport control:

| Key         | Action                                           |
| ----------- | ------------------------------------------------ |
| Arrow Left  | Pan viewport lens left (10% of selection width)  |
| Arrow Right | Pan viewport lens right (10% of selection width) |
| Arrow Up    | Pan depth up (show deeper frames)                |
| Arrow Down  | Pan depth down (show shallower frames)           |
| W / + / =   | Zoom selection in (narrow the lens)              |
| S / -       | Zoom selection out (widen the lens)              |
| Home        | Jump to timeline start                           |
| End         | Jump to timeline end                             |
| 0 / Escape  | Reset zoom (fit entire timeline)                 |

**Note:** These shortcuts only activate when the mouse is hovering over the minimap area. When the mouse is over the main timeline, standard timeline shortcuts apply.

## Key Design Patterns

### Computed State Over Tracked State

Prefer computed methods over manual state tracking:

```typescript
// GOOD: Computed from actual state
private getHighlightMode(): 'none' | 'search' | 'selection' {
  if (this.selectionManager?.hasSelection()) return 'selection';
  if (this.searchManager?.getCursor()?.total > 0) return 'search';
  return 'none';
}

// AVOID: Manual tracking that can get out of sync
private highlightMode: 'none' | 'search' | 'selection' = 'none';
```

### Callback Consolidation

Extract repeated callback patterns into helpers:

```typescript
// Helper method
private notifyViewportChange(): void {
  this.requestRender();
  if (this.callbacks.onViewportChange && this.viewport) {
    this.callbacks.onViewportChange(this.viewport.getState());
  }
}
```

## Adding New Features

When adding a new feature:

1. **Create a dedicated Manager class** (e.g., `NewFeatureManager`)
   - Own the feature's state
   - Encapsulate the feature's logic
   - Expose a clean API

2. **Add to FlameChart as a member**
   - Initialize in `init()`
   - Clean up in `destroy()`

3. **FlameChart delegates, doesn't implement**
   - FlameChart calls manager/viewport methods
   - FlameChart doesn't contain feature logic or calculations

   ```typescript
   // GOOD: Delegate to TimelineViewport
   const screenX = this.viewport.calculateVisibleCenterX(timestamp, duration);

   // AVOID: Inline calculations in FlameChart
   const frameCenterX = timestamp * zoom - offsetX;
   const screenX = Math.max(50, Math.min(width - 50, frameCenterX));
   ```

## File Structure

```
optimised/
├── FlameChart.ts              # Main orchestrator
├── CLAUDE.md                  # This documentation
├── interaction/
│   ├── KeyboardHandler.ts     # Keyboard input processing
│   ├── TimelineInteractionHandler.ts  # Mouse/touch input
│   └── HitTestManager.ts      # Hit testing for mouse events
├── selection/
│   ├── SelectionManager.ts    # Selection state and navigation
│   ├── SelectionHighlightRenderer.ts  # Selection visuals
│   └── TreeNavigator.ts       # Tree traversal (internal)
├── search/
│   ├── SearchManager.ts       # Search state and matching
│   ├── SearchHighlightRenderer.ts  # Search visuals
│   └── ...
├── rendering/
│   ├── HighlightRenderer.ts   # Shared highlight rendering
│   └── ...
└── ...
```

## Testing

Each manager class should have its own test file:

- `SelectionManager.test.ts` - Selection logic tests
- `TreeNavigator.test.ts` - Tree navigation tests
- `SearchManager.test.ts` - Search logic tests

Tests should focus on the manager's API, not internal implementation.

## Performance Requirements

**This module handles 50MB+ logs with 500k+ lines. Performance is non-negotiable.**

### Critical Performance Guidelines

1. **Avoid allocations in render loop**
   - Pre-allocate arrays and objects
   - Reuse geometry buffers
   - Never create closures in hot paths

2. **Use spatial data structures**
   - TemporalSegmentTree for time-based queries
   - Pre-computed rectangle maps for O(1) lookup
   - Viewport culling before any iteration

3. **Batch operations**
   - Group draw calls by category/color
   - Use instanced rendering where possible
   - Minimize state changes

4. **Profile before optimizing**
   - Use Chrome DevTools Performance tab
   - Measure frame time, not just "feels fast"
   - Target 60fps (16.6ms frame budget)

5. **Cache computed values**
   - Viewport transforms
   - Color conversions
   - Text measurements

## Naming Conventions

### Class Suffixes

- `*Renderer` - Classes that produce visuals (TextLabelRenderer, SearchHighlightRenderer)
- `*Handler` - Classes that process input (KeyboardHandler, TimelineInteractionHandler)
- `*Cache` / `*Index` - Classes for data lookup and pre-computation
- `*Detector` - Classes that detect or compute values from input

### Avoid

- Generic `*Manager` suffix - too vague, prefer specific role names
- God classes with mixed responsibilities
- Tiny classes that could be functions

### Class Size Guidelines

- Target 100-300 lines per class
- If > 400 lines, consider splitting by concern
- If < 50 lines, consider if it should be a function or merged
