# Timeline Optimised Module

This module implements the high-performance flame chart visualization for Apex debug logs.

## Architecture Overview

The module follows a **pure orchestrator** pattern where FlameChart is a generic coordinator that delegates all feature-specific logic to dedicated classes.

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
