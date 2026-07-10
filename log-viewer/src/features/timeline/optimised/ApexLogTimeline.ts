/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * ApexLogTimeline - Apex-specific orchestrator for FlameChart
 *
 * Handles all Apex-specific logic:
 * - ApexLog data structures
 * - Tooltip generation for LogEvents
 * - Navigation to source (goToRow)
 * - External callbacks
 *
 * It should only be responsible for managing calls to FlameChart and wiring.
 * It should NOT contain any rendering, rectangle computation, or search logic (all in FlameChart).
 * FlameChart should remain agnostic of Apex-specifics e.g LogEvent structure and tooltips.
 * LogEvent should only be referenced here in ApexLogTimeline to convert to generic EventNode for FlameChart and not in FlameChart or its dependencies.
 */

import type { ApexLog, HeapAllocateLine, Limits, LimitUsageLine, LogEvent } from 'apex-log-parser';
import { ContextMenu } from '../../../components/ContextMenu.js';
import { ContextMenuBuilder } from '../../../components/ContextMenuBuilder.js';
import { eventBus } from '../../../core/events/EventBus.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { findEventByEventIndex, findEventByTimestamp } from '../../../core/utility/EventSearch.js';
import { formatDuration } from '../../../core/utility/Util.js';
import { goToRow } from '../../call-tree/components/CalltreeView.js';
import { getTheme } from '../themes/ThemeSelector.js';
import {
  BUCKET_CONSTANTS,
  type EventNode,
  type FindEventDetail,
  type FindResultsEventDetail,
  type HeatStripMetric,
  type HeatStripTimeSeries,
  type ModifierKeys,
  type TimelineMarker,
  type TimelineOptions,
  type ViewportState,
} from '../types/flamechart.types.js';
import type { SearchCursor } from '../types/search.types.js';
import { extractMarkers } from '../utils/marker-utils.js';
import { logEventToTreeAndRects } from '../utils/tree-converter.js';
import { FlameChart } from './FlameChart.js';
import { FrameTooltipRenderer } from './FrameTooltipRenderer.js';
import {
  buildGovernorTimeSeries,
  type LimitObservation as GranularObservation,
} from './metric-strip/governor-timeline.js';

/**
 * Apex-specific metric definitions for heat strip visualization.
 * "Big 4" limits (CPU, SOQL, DML, Heap) have priority < 4 and are always shown.
 * Other limits have priority >= 4 and are only shown when > 0%.
 */
const APEX_METRICS: Map<keyof Limits, HeatStripMetric> = new Map([
  ['cpuTime', { id: 'cpuTime', displayName: 'CPU Time', unit: 'ms', priority: 0 }],
  ['soqlQueries', { id: 'soqlQueries', displayName: 'SOQL Queries', unit: '', priority: 1 }],
  ['dmlStatements', { id: 'dmlStatements', displayName: 'DML Statements', unit: '', priority: 2 }],
  ['heapSize', { id: 'heapSize', displayName: 'Heap Size', unit: 'bytes', priority: 3 }],
  ['queryRows', { id: 'queryRows', displayName: 'Query Rows', unit: '', priority: 4 }],
  ['soslQueries', { id: 'soslQueries', displayName: 'SOSL Queries', unit: '', priority: 5 }],
  ['dmlRows', { id: 'dmlRows', displayName: 'DML Rows', unit: '', priority: 6 }],
  [
    'publishImmediateDml',
    { id: 'publishImmediateDml', displayName: 'Publish Immediate DML', unit: '', priority: 7 },
  ],
  ['callouts', { id: 'callouts', displayName: 'Callouts', unit: '', priority: 8 }],
  [
    'emailInvocations',
    { id: 'emailInvocations', displayName: 'Email Invocations', unit: '', priority: 9 },
  ],
  ['futureCalls', { id: 'futureCalls', displayName: 'Future Calls', unit: '', priority: 10 }],
  [
    'queueableJobsAddedToQueue',
    { id: 'queueableJobsAddedToQueue', displayName: 'Queueable Jobs', unit: '', priority: 11 },
  ],
  [
    'mobileApexPushCalls',
    { id: 'mobileApexPushCalls', displayName: 'Mobile Push Calls', unit: '', priority: 12 },
  ],
]);

/**
 * Standard synchronous Apex governor limits, used as a fallback so a metric can render from
 * granular usage alone when the log has no cumulative limit event. Any limit reported by the log
 * (LIMIT_USAGE_FOR_NS / LIMIT_USAGE / flow) overrides these.
 */
const DEFAULT_LIMITS = new Map<string, number>([
  ['soqlQueries', 100],
  ['queryRows', 50000],
  ['soslQueries', 20],
  ['dmlStatements', 150],
  ['publishImmediateDml', 150],
  ['dmlRows', 10000],
  ['cpuTime', 10000],
  ['heapSize', 6000000],
  ['callouts', 100],
  ['emailInvocations', 10],
  ['futureCalls', 50],
  ['queueableJobsAddedToQueue', 50],
  ['mobileApexPushCalls', 10],
]);

interface ApexTimelineOptions extends TimelineOptions {
  themeName?: string | null;
}

export class ApexLogTimeline {
  private flamechart: FlameChart;
  private tooltipRenderer: FrameTooltipRenderer | null = null;
  private contextMenu: ContextMenu | null = null;
  private apexLog: ApexLog | null = null;
  private options: TimelineOptions = {};
  private container: HTMLElement | null = null;
  private events: LogEvent[] = [];
  private searchCursor: SearchCursor<EventNode> | null = null;
  private selectedEventForContextMenu: EventNode | null = null;
  private selectedMarkerForContextMenu: TimelineMarker | null = null;
  private eventBusUnsubscribe: (() => void) | null = null;

  constructor() {
    this.flamechart = new FlameChart();
  }

  /**
   * Initialize Apex log timeline visualization.
   */
  public async init(
    container: HTMLElement,
    apexLog: ApexLog,
    options: ApexTimelineOptions = {},
  ): Promise<void> {
    this.apexLog = apexLog;
    this.options = options;
    this.container = container;

    const colorMap = this.themeToColors(options.themeName ?? '');
    options.colors = colorMap;

    // Create tooltip manager for Apex-specific tooltips
    this.tooltipRenderer = new FrameTooltipRenderer(container, {
      enableFlip: true,
      cursorOffset: 10,
      categoryColors: colorMap,
      apexLog: apexLog,
    });

    const markers = extractMarkers(this.apexLog);
    this.events = this.extractEvents();

    // Derive categories from shared constant (ensures compile-time sync with color map)
    const categories = new Set<string>(BUCKET_CONSTANTS.CATEGORY_PRIORITY);

    // Single-pass unified conversion: builds TreeNodes, navigation maps,
    // PrecomputedRects, maxDepth, and totalDuration in one O(n) traversal.
    // This eliminates redundant traversals previously done by:
    // - logEventToTreeNode (tree + maps)
    // - TimelineEventIndex.calculateMaxDepth
    // - TimelineEventIndex.calculateTotalDuration
    // - RectangleCache.flattenEvents
    const {
      treeNodes,
      maps,
      rectsByCategory,
      rectsByDepth,
      rectMap,
      maxDepth,
      totalDuration,
      preSorted,
    } = logEventToTreeAndRects(this.events, categories);

    // Initialize FlameChart with Apex-specific callbacks and precomputed data
    await this.flamechart.init(
      container,
      this.events,
      treeNodes,
      maps,
      markers,
      { ...options, enableSearch: true }, // Enable search via options
      {
        onMouseMove: (screenX, screenY, event, marker) => {
          this.handleMouseMove(screenX, screenY, event, marker);
        },
        onClick: (screenX, screenY, event, marker, modifiers) => {
          this.handleClick(screenX, screenY, event, marker, modifiers);
        },
        onViewportChange: (viewport: ViewportState) => {
          if (options.onViewportChange) {
            options.onViewportChange(viewport);
          }
        },
        onSearchNavigate: (event, screenX, screenY, depth) => {
          this.handleSearchNavigate(event, screenX, screenY, depth);
        },
        onFrameNavigate: (event, screenX, screenY, _depth) => {
          this.handleFrameNavigate(event, screenX, screenY);
        },
        onMarkerNavigate: (marker, screenX, screenY) => {
          this.handleMarkerNavigate(marker, screenX, screenY);
        },
        onSelect: (eventNode) => {
          this.handleSelect(eventNode);
        },
        onMarkerSelect: (marker) => {
          this.handleMarkerSelect(marker);
        },
        onJumpToCallTree: (eventNode) => {
          this.handleJumpToCallTree(eventNode);
        },
        onJumpToCallTreeForMarker: (marker) => {
          this.handleJumpToCallTreeForMarker(marker);
        },
        onContextMenu: (target, screenX, screenY, clientX, clientY) => {
          this.handleContextMenu(target, screenX, screenY, clientX, clientY);
        },
        onCopy: (eventNode) => {
          this.copyToClipboard(eventNode.text);
        },
        onCopyMarker: (marker) => {
          this.copyToClipboard(marker.summary);
        },
      },
      // Pass precomputed data to skip redundant O(n) traversals
      { maxDepth, totalDuration, rectsByCategory, rectsByDepth, rectMap, preSorted },
    );

    // Create context menu Lit element (using constructor ensures custom element is registered)
    this.contextMenu = new ContextMenu();
    container.appendChild(this.contextMenu);

    // Listen for context menu events
    this.contextMenu.addEventListener('menu-select', ((e: CustomEvent) => {
      this.handleContextMenuSelect(e.detail.itemId);
    }) as EventListener);
    this.contextMenu.addEventListener('menu-close', () => {
      this.selectedEventForContextMenu = null;
      this.selectedMarkerForContextMenu = null;
    });

    // Wire up search event listeners
    this.enableSearch();

    // Build the dense governor-limit series (cumulative snapshots + granular events).
    const heatStripSeries = this.buildLimitTimeSeries();
    this.flamechart.setHeatStripTimeSeries(
      heatStripSeries.events.length > 0 ? heatStripSeries : null,
    );

    // Subscribe to EventBus for timeline navigation requests (from CalltreeView and raw-log entry).
    this.eventBusUnsubscribe = eventBus.on('timeline:navigate-to', (detail) => {
      if (detail.eventIndex !== undefined) {
        this.navigateToEventIndex(detail.eventIndex);
      } else {
        this.navigateToTimestamp(detail.timestamp);
      }
    });
  }

  /**
   * Navigate to a specific event using parser-assigned eventIndex.
   */
  public navigateToEventIndex(eventIndex: number): void {
    if (!this.apexLog) {
      return;
    }

    const result = findEventByEventIndex(this.apexLog, eventIndex);
    this._navigateToSearchResult(result);
  }

  /**
   * Navigate to a specific timestamp in the timeline.
   * Called via EventBus 'timeline:navigate-to' event from CalltreeView,
   * or directly from TimelineFlameChart after initialization.
   * Centers the viewport AND selects the event for visual highlighting.
   */
  public navigateToTimestamp(timestamp: number): void {
    if (!this.events) {
      return;
    }
    // Find event by timestamp (binary search - events sorted by time)
    const result = findEventByTimestamp(this.events, timestamp);
    this._navigateToSearchResult(result);
  }

  private _navigateToSearchResult(result: { event: LogEvent; depth: number } | null): void {
    if (!result) {
      return;
    }

    const eventNode: EventNode = {
      id: `${result.event.eventIndex}-${result.depth}`,
      timestamp: result.event.timestamp,
      duration: result.event.duration.total,
      type: result.event.type ?? result.event.category ?? 'UNKNOWN',
      text: result.event.text,
      original: result.event,
    };

    this.flamechart.selectByEventNode(eventNode);
    const viewport = this.flamechart.getViewportManager();
    viewport?.focusOnEvent(result.event.timestamp, result.event.duration.total, result.depth);
    this.flamechart.requestRender();
  }

  /**
   * Set time display mode (elapsed vs wall-clock) for axis labels.
   * Only has effect when apexLog has a valid startTime.
   */
  public setTimeDisplayMode(mode: 'elapsed' | 'wallClock'): void {
    if (!this.apexLog) {
      return;
    }

    const startTime = this.apexLog.startTime ?? 0;
    const firstTimestamp = this.apexLog.timestamp;
    this.flamechart.setTimeDisplayMode(mode, startTime, firstTimestamp);
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    // Remove event listeners from document
    document.removeEventListener('lv-find', this.handleFind);
    document.removeEventListener('lv-find-match', this.handleFindMatch);
    document.removeEventListener('lv-find-close', this.handleFindClose);

    // Unsubscribe from EventBus
    if (this.eventBusUnsubscribe) {
      this.eventBusUnsubscribe();
      this.eventBusUnsubscribe = null;
    }

    this.flamechart.destroy();
    if (this.tooltipRenderer) {
      this.tooltipRenderer.destroy();
      this.tooltipRenderer = null;
    }
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  /**
   * Get current viewport state.
   */
  public getViewport(): ViewportState | null {
    return this.flamechart.getViewport();
  }

  /**
   * Request a re-render.
   */
  public requestRender(): void {
    this.flamechart.requestRender();
  }

  /**
   * Handle window resize.
   */
  public resize(newWidth: number, newHeight: number): void {
    this.flamechart.resize(newWidth, newHeight);
  }

  /**
   * Set timeline theme by name and apply colors.
   * Retrieves theme colors from ThemeSelector and updates FlameChart.
   */
  public setTheme(themeName: string): void {
    const colorMap = this.themeToColors(themeName);

    // Update FlameChart colors (handles re-render)
    this.flamechart.setColors(colorMap);

    // Update TooltipManager colors if available
    if (this.tooltipRenderer) {
      this.tooltipRenderer.updateCategoryColors(colorMap);
    }
  }

  private themeToColors(themeName: string) {
    const theme = getTheme(themeName);
    // Convert TimelineColors keys to the format expected by FlameChart

    return {
      Apex: theme.apex,
      'Code Unit': theme.codeUnit,
      System: theme.system,
      Automation: theme.automation,
      DML: theme.dml,
      SOQL: theme.soql,
      Callout: theme.callout,
      Validation: theme.validation,
    };
  }

  // ============================================================================
  // APEX-SPECIFIC HANDLERS
  // ============================================================================}

  /**
   * Handle mouse move - show Apex-specific tooltips.
   */
  private handleMouseMove(
    screenX: number,
    screenY: number,
    eventNode: EventNode | null,
    marker: TimelineMarker | null,
  ): void {
    if (!this.tooltipRenderer) {
      return;
    }

    // Don't update tooltip while context menu is open
    if (this.contextMenu?.isVisible()) {
      return;
    }

    // Priority: Events take precedence over truncation markers
    if (eventNode) {
      // Extract LogEvent from EventNode.original for tooltip display
      const logEvent = eventNode.original as LogEvent | undefined;
      if (logEvent) {
        this.tooltipRenderer.show(logEvent, screenX, screenY);

        // Call external callback if provided
        if (this.options.onEventHover) {
          this.options.onEventHover(logEvent);
        }
      }
    } else if (marker) {
      this.tooltipRenderer.showTruncation(marker, screenX, screenY);
    } else {
      this.tooltipRenderer.hide();

      // Call external callback with null
      if (this.options.onEventHover) {
        this.options.onEventHover(null);
      }
    }
  }

  /**
   * Handle click - select frame or marker (but don't navigate).
   * Click on frame/marker selects it only. Use J key to navigate to call tree.
   * Cmd/Ctrl+Click on frame navigates directly to call tree.
   */
  private handleClick(
    _screenX: number,
    _screenY: number,
    eventNode: EventNode | null,
    marker: TimelineMarker | null,
    modifiers?: ModifierKeys,
  ): void {
    // Cmd/Ctrl+Click on a frame navigates directly to call tree
    // Note: Only works on individual frames, not buckets (buckets are aggregated)
    if (eventNode && (modifiers?.metaKey || modifiers?.ctrlKey)) {
      const originalEvent = (eventNode as EventNode & { original?: LogEvent }).original;
      if (originalEvent?.eventIndex !== undefined) {
        goToRow({ eventIndex: originalEvent.eventIndex });
      }
      return;
    }

    // Cmd/Ctrl+Click on a marker navigates directly to call tree
    if (marker && (modifiers?.metaKey || modifiers?.ctrlKey)) {
      if (marker.eventIndex !== undefined) {
        goToRow({ eventIndex: marker.eventIndex });
      }
      return;
    }

    // Frame and marker clicks are handled by FlameChart's selection system
    // (via onSelect and onMarkerSelect callbacks)
    // No longer auto-navigate to call tree on click - use J key for explicit navigation
  }

  /**
   * Handle selection change from FlameChart.
   * Selection only updates visual state, does not navigate call tree.
   * Use J key for explicit "jump to call tree" action.
   */
  private handleSelect(eventNode: EventNode | null): void {
    if (!eventNode) {
      // Selection cleared - hide tooltip
      if (this.tooltipRenderer) {
        this.tooltipRenderer.hide();
      }
      return;
    }

    // Selection only - no auto-navigation to call tree
    // User can press J to explicitly jump to call tree
  }

  /**
   * Handle J key "Jump to Call Tree" action.
   * Navigates call tree to the selected frame.
   */
  private handleJumpToCallTree(eventNode: EventNode): void {
    const originalEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    if (originalEvent?.eventIndex !== undefined) {
      goToRow({ eventIndex: originalEvent.eventIndex });
    }
  }

  /**
   * Handle J key "Jump to Call Tree" action for markers.
   * Navigates call tree to the marker's start time.
   */
  private handleJumpToCallTreeForMarker(marker: TimelineMarker): void {
    if (marker.eventIndex !== undefined) {
      goToRow({ eventIndex: marker.eventIndex });
    }
  }

  /**
   * Handle marker selection change from FlameChart.
   */
  private handleMarkerSelect(marker: TimelineMarker | null): void {
    if (!marker) {
      // Marker selection cleared - hide tooltip
      if (this.tooltipRenderer) {
        this.tooltipRenderer.hide();
      }
      return;
    }

    // Marker selection only - no auto-navigation to call tree
    // User can press J to explicitly jump to call tree
  }

  /**
   * Handle keyboard navigation to a frame.
   * Shows tooltip for the navigated-to frame.
   */
  private handleFrameNavigate(event: EventNode, screenX: number, screenY: number): void {
    if (!this.tooltipRenderer) {
      return;
    }

    const eventWithOriginal = event as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;
    if (logEvent) {
      this.tooltipRenderer.show(logEvent, screenX, screenY);
    }
  }

  /**
   * Handle keyboard navigation to a marker.
   * Shows tooltip for the navigated-to marker.
   */
  private handleMarkerNavigate(marker: TimelineMarker, screenX: number, screenY: number): void {
    if (!this.tooltipRenderer) {
      return;
    }
    this.tooltipRenderer.showTruncation(marker, screenX, screenY);
  }

  /**
   * Type guard to check if target is a TimelineMarker.
   */
  private isTimelineMarker(target: EventNode | TimelineMarker): target is TimelineMarker {
    // TimelineMarker has 'type' as 'error' | 'skip' | 'unexpected'
    // EventNode has 'type' as a string like 'METHOD_ENTRY', etc.
    // TimelineMarker has 'summary', EventNode has 'text'
    return 'summary' in target && 'startTime' in target && !('duration' in target);
  }

  /**
   * Handle right-click context menu request.
   *
   * @param target - The event node or marker that was right-clicked, or null for empty space
   * @param screenX - Canvas-relative X coordinate (for tooltip positioning, same as hover)
   * @param screenY - Canvas-relative Y coordinate (for tooltip positioning, same as hover)
   * @param clientX - Window X coordinate (for context menu positioning)
   * @param clientY - Window Y coordinate (for context menu positioning)
   */
  private handleContextMenu(
    target: EventNode | TimelineMarker | null,
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.contextMenu) {
      return;
    }

    if (!target) {
      // Empty space context menu
      this.showEmptySpaceContextMenu(clientX, clientY);
      return;
    }

    if (this.isTimelineMarker(target)) {
      // Marker context menu
      this.showMarkerContextMenu(target, screenX, screenY, clientX, clientY);
    } else {
      // Frame context menu
      this.showFrameContextMenu(target, screenX, screenY, clientX, clientY);
    }
  }

  /**
   * Show context menu for a frame (event node).
   */
  private showFrameContextMenu(
    eventNode: EventNode,
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.contextMenu) {
      return;
    }

    // Store selected event for menu actions
    this.selectedEventForContextMenu = eventNode;

    // Show tooltip for the right-clicked frame using screen coords (same as hover)
    const eventWithOriginal = eventNode as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;
    if (this.tooltipRenderer && logEvent) {
      this.tooltipRenderer.show(logEvent, screenX, screenY, { keepPosition: true });
    }

    // Build menu using ContextMenuBuilder
    const builder = new ContextMenuBuilder();

    // Group 1: View actions (stay here)
    builder.addGroup([{ id: 'zoom-to-frame', label: 'Zoom to Frame', shortcut: 'Z' }]);

    // Group 2: Navigation actions (go elsewhere)
    const navActions: { id: string; label: string; shortcut?: string }[] = [
      { id: 'show-in-call-tree', label: 'Show in Call Tree', shortcut: 'J' },
    ];

    if (logEvent?.hasValidSymbols) {
      navActions.push({ id: 'go-to-source', label: 'Go to Source' });
    }

    if (logEvent?.timestamp) {
      navActions.push({ id: 'show-in-log', label: 'Show in Log File' });
    }

    builder.addGroup(navActions);

    // Group 3: Copy actions
    builder.addGroup([
      { id: 'copy-name', label: 'Copy Name', shortcut: ContextMenuBuilder.copyShortcut() },
      { id: 'copy-details', label: 'Copy Details' },
      { id: 'copy-call-stack', label: 'Copy Call Stack' },
    ]);

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(builder.build(), clientX, clientY);
  }

  /**
   * Show context menu for a marker.
   */
  private showMarkerContextMenu(
    marker: TimelineMarker,
    screenX: number,
    screenY: number,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.contextMenu) {
      return;
    }

    // Store selected marker for menu actions
    this.selectedMarkerForContextMenu = marker;
    this.selectedEventForContextMenu = null;

    // Show tooltip for the right-clicked marker using screen coords
    if (this.tooltipRenderer) {
      this.tooltipRenderer.showTruncation(marker, screenX, screenY);
    }

    // Build menu using ContextMenuBuilder
    const builder = new ContextMenuBuilder();

    // Group 1: View actions
    builder.addGroup([{ id: 'zoom-to-marker', label: 'Zoom to Marker', shortcut: 'Z' }]);

    // Group 2: Navigation actions
    builder.addGroup([{ id: 'show-in-call-tree', label: 'Show in Call Tree', shortcut: 'J' }]);

    // Group 3: Copy actions
    builder.addGroup([
      { id: 'copy-summary', label: 'Copy Summary', shortcut: ContextMenuBuilder.copyShortcut() },
      { id: 'copy-marker-details', label: 'Copy Details' },
    ]);

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(builder.build(), clientX, clientY);
  }

  /**
   * Show context menu for empty space (viewport actions).
   */
  private showEmptySpaceContextMenu(clientX: number, clientY: number): void {
    if (!this.contextMenu) {
      return;
    }

    // Clear any stored references
    this.selectedEventForContextMenu = null;
    this.selectedMarkerForContextMenu = null;

    // Hide tooltip since we're not over a frame or marker
    if (this.tooltipRenderer) {
      this.tooltipRenderer.hide();
    }

    // Build menu using ContextMenuBuilder
    const builder = new ContextMenuBuilder();

    // Group 1: View actions
    builder.addGroup([{ id: 'reset-zoom', label: 'Reset Zoom', shortcut: '0' }]);

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(builder.build(), clientX, clientY);
  }

  /**
   * Handle context menu item selection.
   */
  private handleContextMenuSelect(itemId: string): void {
    // Handle viewport-level actions (don't require a selected event or marker)
    if (itemId === 'reset-zoom') {
      this.flamechart.resetZoom();
      return;
    }

    // Handle marker-level actions (require a selected marker)
    const marker = this.selectedMarkerForContextMenu;
    if (marker) {
      switch (itemId) {
        case 'show-in-call-tree':
          this.handleJumpToCallTreeForMarker(marker);
          break;
        case 'zoom-to-marker':
          this.flamechart.focusOnSelectedMarker();
          break;
        case 'copy-summary':
          this.copyToClipboard(marker.summary);
          break;
        case 'copy-marker-details':
          this.copyToClipboard(this.formatMarkerDetails(marker));
          break;
      }
      return;
    }

    // Handle frame-level actions (require a selected event)
    const event = this.selectedEventForContextMenu;
    if (!event) {
      return;
    }

    switch (itemId) {
      case 'show-in-call-tree':
        this.handleJumpToCallTree(event);
        break;
      case 'go-to-source':
        this.handleGoToSource(event);
        break;
      case 'zoom-to-frame':
        this.flamechart.focusOnSelectedFrame();
        break;
      case 'copy-name':
        this.copyToClipboard(event.text);
        break;
      case 'copy-details':
        this.copyToClipboard(this.formatEventDetails(event));
        break;
      case 'copy-call-stack':
        this.copyToClipboard(this.formatCallStack(event));
        break;
      case 'show-in-log':
        this.handleShowInLog(event);
        break;
    }
  }

  /**
   * Handle "Show in Log" action.
   * Navigates to the raw log file at the event's timestamp.
   */
  private handleShowInLog(eventNode: EventNode): void {
    const eventWithOriginal = eventNode as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;
    if (logEvent?.timestamp) {
      vscodeMessenger.send('goToLogLine', { timestamp: logEvent.timestamp });
    }
  }

  /**
   * Handle "Go to Source Code" action.
   * Opens the source file in VS Code for methods with valid symbols.
   */
  private handleGoToSource(eventNode: EventNode): void {
    const eventWithOriginal = eventNode as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;
    if (logEvent?.hasValidSymbols) {
      vscodeMessenger.send<string>('openType', logEvent.text);
    }
  }

  /**
   * Copy text to clipboard.
   */
  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).catch(() => {
      // Silently fail - clipboard API may not be available in all contexts
    });
  }

  /**
   * Format event details for clipboard (similar to tooltip content).
   */
  private formatEventDetails(eventNode: EventNode): string {
    // Access original LogEvent for full details
    const logEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    if (!logEvent) {
      // Fallback for nodes without original
      return `Name: ${eventNode.text}\nType: ${eventNode.type}`;
    }

    const lines: string[] = [];
    lines.push(`Name: ${logEvent.text}${logEvent.suffix ?? ''}`);

    if (logEvent.type) {
      lines.push(`Type: ${logEvent.type}`);
    }

    if (logEvent.exitStamp && logEvent.duration.total) {
      let durationStr = formatDuration(logEvent.duration.total);
      if (logEvent.cpuType === 'free') {
        durationStr += ' (free)';
      } else if (logEvent.duration.self) {
        durationStr += ` (self ${formatDuration(logEvent.duration.self)})`;
      }
      lines.push(`Duration: ${durationStr}`);
    }

    // Add metrics (only if non-zero)
    const govLimits = this.apexLog?.governorLimits;

    if (logEvent.dmlCount.total) {
      lines.push(`DML: ${this.formatLimit(logEvent.dmlCount, govLimits?.dmlStatements.limit)}`);
    }
    if (logEvent.dmlRowCount.total) {
      lines.push(`DML Rows: ${this.formatLimit(logEvent.dmlRowCount, govLimits?.dmlRows.limit)}`);
    }
    if (logEvent.soqlCount.total) {
      lines.push(`SOQL: ${this.formatLimit(logEvent.soqlCount, govLimits?.soqlQueries.limit)}`);
    }
    if (logEvent.soqlRowCount.total) {
      lines.push(
        `SOQL Rows: ${this.formatLimit(logEvent.soqlRowCount, govLimits?.queryRows.limit)}`,
      );
    }
    if (logEvent.soslCount.total) {
      lines.push(`SOSL: ${this.formatLimit(logEvent.soslCount, govLimits?.soslQueries.limit)}`);
    }
    if (logEvent.soslRowCount.total) {
      lines.push(
        `SOSL Rows: ${this.formatLimit(logEvent.soslRowCount, govLimits?.soslQueries.limit)}`,
      );
    }

    return lines.join('\n');
  }

  /**
   * Format a metric with limit for clipboard.
   */
  private formatLimit(metric: { total: number; self: number }, limit?: number): string {
    const outOf = limit ? `/${limit}` : '';
    return `${metric.total}${outOf} (self ${metric.self})`;
  }

  /**
   * Format call stack for clipboard.
   * Builds the parent chain from root to the selected event.
   */
  private formatCallStack(eventNode: EventNode): string {
    const logEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    if (!logEvent) {
      return eventNode.text;
    }

    // Build call stack by traversing up parent chain
    const stack: LogEvent[] = [];
    let current: LogEvent | null = logEvent;
    while (current?.type) {
      stack.unshift(current); // Prepend to get root-first order
      current = current.parent;
    }

    // Format as call stack (one entry per line)
    return stack.map((event) => event.text + (event.suffix ?? '')).join('\n');
  }

  /**
   * Format marker details for clipboard.
   * Includes summary, type, and optional metadata.
   */
  private formatMarkerDetails(marker: TimelineMarker): string {
    const lines: string[] = [];

    lines.push(`Summary: ${marker.summary}`);
    lines.push(`Type: ${marker.type}`);

    if (marker.metadata) {
      lines.push(`Details: ${marker.metadata}`);
    }

    return lines.join('\n');
  }

  /**
   * Extract events array from rootLog.
   * Handles the conversion from ApexLog structure to LogEvent array.
   */
  private extractEvents(): LogEvent[] {
    if (!this.apexLog) {
      return [];
    }

    // ApexLog extends LogEvent, which has a children property
    // containing the hierarchical event structure
    return this.apexLog.children || [];
  }

  // ============================================================================
  // SEARCH FUNCTIONALITY
  // ============================================================================

  /**
   * Wire up search event listeners.
   * Search is enabled via FlameChart options.
   */
  private enableSearch(): void {
    // Wire up event listeners on document (FindWidget dispatches on document)
    document.addEventListener('lv-find', this.handleFind);
    document.addEventListener('lv-find-match', this.handleFindMatch);
    document.addEventListener('lv-find-close', this.handleFindClose);
  }

  /**
   * Handle lv-find event (new search initiated).
   * Thin facade: converts search text to predicate function.
   */
  private handleFind = (event: Event): void => {
    // Only process if this timeline instance is active
    if (!this.container || !this.container.isConnected || !this.container.clientHeight) {
      return;
    }

    const customEvent = event as CustomEvent<FindEventDetail>;
    const { text, options } = customEvent.detail;
    if (!text) {
      this.handleFindClose();
      return;
    }

    // Convert search text to predicate function (thin facade)
    const caseSensitive = options.matchCase;
    const searchText = caseSensitive ? text : text.toLowerCase();
    const predicate = (eventNode: EventNode) => {
      const eventText = caseSensitive ? eventNode.text : eventNode.text.toLowerCase();
      const eventType = caseSensitive ? eventNode.type : eventNode.type.toLowerCase();
      return eventText.includes(searchText) || eventType.includes(searchText);
    };

    // Perform search using new API (map matchCase to caseSensitive)
    this.searchCursor = this.flamechart.search(predicate, { caseSensitive });

    if (!this.searchCursor) {
      return;
    }

    // Dispatch results
    this.dispatchFindResults(this.searchCursor.total);

    // Navigate to first match (cursor handles centering, tooltip, and render)
    if (this.searchCursor.total > 0) {
      this.searchCursor.first();
    }
  };

  /**
   * Handle lv-find-match event (navigate to specific match).
   */
  private handleFindMatch = (event: Event): void => {
    // Only process if this timeline instance is active
    if (!this.container || !this.container.isConnected) {
      return;
    }

    const customEvent = event as CustomEvent<FindEventDetail>;
    const { count } = customEvent.detail;

    // count is 1-based, convert to 0-based index
    const index = count - 1;

    // Cursor handles centering, tooltip, and render
    this.searchCursor?.seek(index);
  };

  /**
   * Handle lv-find-close event (clear search).
   */
  private handleFindClose = (): void => {
    // Only process if this timeline instance is active
    if (!this.container || !this.container.isConnected) {
      return;
    }

    // Clear search cursor reference
    this.searchCursor = null;

    // Clear search state (FlameChart handles render)
    this.flamechart.clearSearch();

    document.dispatchEvent(new CustomEvent('lv-find-results', { detail: { totalMatches: 0 } }));
  };

  /**
   * Handle search navigation callback from FlameChart.
   * Shows tooltip for the current search match.
   */
  private handleSearchNavigate(
    eventNode: EventNode,
    screenX: number,
    screenY: number,
    _depth: number,
  ): void {
    if (!this.tooltipRenderer) {
      return;
    }

    // EventNode may have original LogEvent stored from tree conversion
    const eventWithOriginal = eventNode as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;

    if (logEvent) {
      this.tooltipRenderer.show(logEvent, screenX, screenY);
    }
  }

  /**
   * Dispatch lv-find-results event with match count.
   */
  private dispatchFindResults(totalMatches: number): void {
    const detail: FindResultsEventDetail = { totalMatches };
    const event = new CustomEvent('lv-find-results', {
      detail,
      bubbles: true,
      composed: true,
    });

    document.dispatchEvent(event);
  }

  // ============================================================================
  // APEX-SPECIFIC DATA TRANSFORMATION
  // ============================================================================

  /**
   * Build the dense governor-limit time series for the metric strip.
   *
   * Combines two sources into one stream of observations and folds them (see
   * governor-timeline.ts): cumulative `LIMIT_USAGE_FOR_NS` snapshots act as multi-metric
   * correctives, while detailed log events (SOQL/DML/SOSL/callout/heap and the single-line
   * `LIMIT_USAGE` / flow `*_LIMIT_USAGE` reports) add intermediate data points so the line
   * rises as usage happens rather than only at code-unit boundaries.
   */
  private buildLimitTimeSeries(): HeatStripTimeSeries {
    const metrics = new Map<string, HeatStripMetric>();
    for (const [key, metric] of APEX_METRICS) {
      metrics.set(key, metric);
    }

    const apexLog = this.apexLog;
    if (!apexLog) {
      return { metrics, events: [] };
    }

    const observations: GranularObservation[] = [];

    // Authoritative limit per metric = max limit reported by any cumulative snapshot, else the
    // default. Fixed for the whole series so the "out of" total never flips (e.g. heap 6MB→12MB).
    const metricLimits = new Map<string, number>(DEFAULT_LIMITS);

    // Cumulative snapshots — authoritative multi-metric correctives (transaction usage).
    for (const snapshot of apexLog.governorLimits.snapshots) {
      for (const [metric, value] of Object.entries(snapshot.limits) as [
        keyof Limits,
        { used: number; limit: number },
      ][]) {
        observations.push({
          kind: 'absolute',
          timestamp: snapshot.timestamp,
          namespace: snapshot.namespace,
          metric,
          used: value.used,
        });
        if (value.limit > 0) {
          metricLimits.set(metric, Math.max(metricLimits.get(metric) ?? 0, value.limit));
        }
      }
    }

    const pushDelta = (
      timestamp: number,
      namespace: string,
      metric: keyof Limits,
      delta: number,
    ): void => {
      if (delta) {
        observations.push({ kind: 'delta', timestamp, namespace, metric, delta });
      }
    };

    // Detailed events — granular deltas and finer-grained absolute reports. Walk the FULL tree:
    // this.events holds only top-level nodes, but SOQL/DML/heap events live deep in the call tree.
    // Iterative DFS avoids stack overflow on large logs. Counts are read from the parser's per-event
    // counters, each from its canonical owner event to avoid double-counting.
    const stack: LogEvent[] = [...this.events];
    while (stack.length > 0) {
      const event = stack.pop()!;
      const children = event.children;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          stack.push(children[i]!);
        }
      }

      const timestamp = event.timestamp;
      const namespace = event.namespace || 'default';
      switch (event.type) {
        case 'SOQL_EXECUTE_BEGIN':
          // Row count is copied onto the begin line by its onEnd, so read both here (not on END).
          pushDelta(timestamp, namespace, 'soqlQueries', event.soqlCount.self);
          pushDelta(timestamp, namespace, 'queryRows', event.soqlRowCount.self);
          break;
        case 'SOSL_EXECUTE_BEGIN':
          pushDelta(timestamp, namespace, 'soslQueries', event.soslCount.self);
          break;
        case 'DML_BEGIN':
          pushDelta(timestamp, namespace, 'dmlStatements', event.dmlCount.self);
          pushDelta(timestamp, namespace, 'dmlRows', event.dmlRowCount.self);
          break;
        case 'CALLOUT_REQUEST':
          pushDelta(timestamp, namespace, 'callouts', 1);
          break;
        case 'HEAP_ALLOCATE':
        case 'BULK_HEAP_ALLOCATE':
          // Allocation bytes can be negative in the log, so add as-is (a negative lowers heap).
          pushDelta(timestamp, namespace, 'heapSize', (event as HeapAllocateLine).bytes);
          break;
        case 'HEAP_DEALLOCATE':
          // Deallocation always takes away.
          pushDelta(timestamp, namespace, 'heapSize', -Math.abs((event as HeapAllocateLine).bytes));
          break;
        case 'LIMIT_USAGE':
        case 'FLOW_START_INTERVIEW_LIMIT_USAGE':
        case 'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE':
        case 'FLOW_ELEMENT_LIMIT_USAGE':
        case 'FLOW_BULK_ELEMENT_LIMIT_USAGE': {
          const usage = (event as LimitUsageLine).limitUsage;
          // Flow CPU time is flow-scoped with a different limit (15000 vs the 10000 apex limit),
          // so skip it here — CPU stays sourced from LIMIT_USAGE_FOR_NS to keep percentages consistent.
          if (usage && !(event.type !== 'LIMIT_USAGE' && usage.metric === 'cpuTime')) {
            observations.push({
              kind: 'absolute',
              timestamp,
              namespace,
              metric: usage.metric,
              used: usage.used,
            });
          }
          break;
        }
        default:
          break;
      }
    }

    return buildGovernorTimeSeries(observations, metrics, metricLimits);
  }
}
