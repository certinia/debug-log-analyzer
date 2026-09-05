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

import type { ApexLog, LogEvent } from 'apex-log-parser';
import { ContextMenu } from '../../../components/ContextMenu.js';
import { ContextMenuBuilder } from '../../../components/ContextMenuBuilder.js';
import { eventBus, type TimelineNavigateMode } from '../../../core/events/EventBus.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { copyToClipboard } from '../../../core/utility/Clipboard.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { findEventByEventIndex, findEventByTimestamp } from '../../../core/utility/EventSearch.js';
import { goToRow } from '../../call-tree/navigation.js';
import { formatCallStack, formatEventDetails } from '../../call-tree/utils/eventText.js';
import { getTheme } from '../themes/ThemeSelector.js';
import {
  BUCKET_CONSTANTS,
  type EditorColors,
  type EventNode,
  type FindEventDetail,
  type FindResultsEventDetail,
  type ModifierKeys,
  type TimelineMarker,
  type TimelineOptions,
  type ViewportState,
} from '../types/flamechart.types.js';
import type { SearchCursor } from '../types/search.types.js';
import { InspectorEmphasis } from '../../../components/inspectorEmphasis.js';
import { wireInspectorTab } from '../../../components/inspectorTab.js';
import { isFrameOffscreen, toDetailSelection } from '../utils/detail-selection-sync.js';
import { extractExceptionMarkers, extractMarkers, noDataSpans } from '../utils/marker-utils.js';
import { seekWindow } from '../utils/navigate-window.js';
import { logEventToTreeAndRects } from '../utils/tree-converter.js';
import { FlameChart } from './FlameChart.js';
import { FrameTooltipRenderer, type TooltipAnchor } from './FrameTooltipRenderer.js';
import { apexLimitTimeSeries } from './apex-limit-series.js';

interface ApexTimelineOptions extends TimelineOptions {
  themeName?: string | null;
}

/** The flame chart already draws the subtree top down, so the inspector answers
 *  a selection with where its time went. */
const TIMELINE_VIEW = 'callees' as const;

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
  private inspectorUnsubscribe: (() => void) | null = null;
  /** Guards the programmatic select made on the inspector's behalf. */
  private echoGuard = new SelectionEchoGuard();
  /** Frame last reported to the inspector as under the pointer. */
  private locatedEventIndex: number | null = null;
  /** The frames kept in colour while the rest of the chart is dimmed. */
  private emphasis = new InspectorEmphasis();

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
      cursorOffset: 10,
      categoryColors: colorMap,
      apexLog: apexLog,
    });

    const markers = extractMarkers(this.apexLog).concat(extractExceptionMarkers(this.apexLog));
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
    // `exitStamp`, not `executionEndTime`: a trailing zero-duration event, such as the
    // FATAL_ERROR closing a truncated log, still ends the log.
    const logEndTime = this.apexLog.exitStamp;
    const {
      treeNodes,
      maps,
      rectsByCategory,
      rectsByDepth,
      rectMap,
      maxDepth,
      totalDuration,
      preSorted,
    } = logEventToTreeAndRects(this.events, categories, logEndTime);

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
          copyToClipboard(eventNode.text);
        },
        onCopyMarker: (marker) => {
          copyToClipboard(marker.summary);
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

    // The dense governor-limit series (cumulative snapshots + granular events),
    // memoised per log and shared with the inspector's governor trend charts.
    const heatStripSeries = apexLimitTimeSeries(this.apexLog);
    this.flamechart.setHeatStripTimeSeries(
      heatStripSeries.events.length > 0 ? { ...heatStripSeries, gaps: noDataSpans(markers) } : null,
    );

    // Subscribe to EventBus for timeline navigation requests (from CalltreeView and raw-log entry).
    this.eventBusUnsubscribe = eventBus.on('timeline:navigate-to', (detail) => {
      if (detail.eventIndex !== undefined) {
        this.navigateToEventIndex(detail.eventIndex);
      } else {
        this.navigateToTimestamp(detail.timestamp, detail.mode);
      }
    });

    this.inspectorUnsubscribe = wireInspectorTab('timeline', this.emphasis, {
      mark: (eventIndexes) => this.applyEmphasis(eventIndexes),
      reveal: (eventIndex) => this.selectFrameByEventIndex(eventIndex),
      clear: () => {
        // The chart reports the clear itself. Its own Escape, with the container
        // focused, consumes the key before this.
        this.flamechart.clearSelection();
      },
    });
  }

  /**
   * Select the frame for `eventIndex` and pan to it when it is off-screen.
   * Passive sync, so it never zooms - a full focus would be too disruptive.
   */
  private selectFrameByEventIndex(eventIndex: number): void {
    if (!this.apexLog) {
      return;
    }

    const result = findEventByEventIndex(this.apexLog, eventIndex);
    if (!result) {
      return;
    }

    const selected = this.echoGuard.run(() =>
      this.flamechart.selectByEventNode(this.toEventNode(result)),
    );
    if (!selected) {
      return;
    }

    // The inspector asked for this frame, so its mark is what dims the rest. Set after the
    // run: the select inside it clears the mark, as any chart select does.
    this.pickEmphasis(eventIndex);

    const bounds = this.flamechart.getViewportManager()?.getBounds();
    if (
      bounds &&
      isFrameOffscreen(bounds, result.event.timestamp, result.event.duration.total, result.depth)
    ) {
      this.flamechart.centerOnSelectedFrame();
    }
  }

  /**
   * Keep `eventIndexes` in colour and dim the rest of the chart, or drop the
   * emphasis when there are none. A grouped inspector row names every occurrence
   * it merges, so all of them light at once. Never selects, never pans.
   */
  private applyEmphasis(eventIndexes: readonly number[]): void {
    const apexLog = this.apexLog;
    if (!eventIndexes.length || !apexLog) {
      this.flamechart.locateByEventNodes([]);
      return;
    }

    const nodes: EventNode[] = [];
    for (const eventIndex of eventIndexes) {
      const result = findEventByEventIndex(apexLog, eventIndex);
      if (result) {
        nodes.push(this.toEventNode(result));
      }
    }
    this.flamechart.locateByEventNodes(nodes);
  }

  /** Rest the emphasis on one frame, until something else picks or clears it. */
  private pickEmphasis(eventIndex: number): void {
    this.applyEmphasis(this.emphasis.pick([eventIndex]));
  }

  /** Drop the resting emphasis, so nothing dims. */
  private clearEmphasis(): void {
    this.applyEmphasis(this.emphasis.pick([]));
  }

  /**
   * Navigate to a specific event using parser-assigned eventIndex.
   */
  public navigateToEventIndex(eventIndex: number): void {
    if (!this.apexLog) {
      return;
    }

    this._reveal(findEventByEventIndex(this.apexLog, eventIndex));
  }

  /**
   * Navigate to a specific timestamp in the timeline.
   * Called via EventBus 'timeline:navigate-to' event from CalltreeView,
   * or directly from TimelineFlameChart after initialization.
   * 'reveal' selects the frame at the timestamp and zooms to it; 'seek' zooms to
   * a window of the log around the instant and selects nothing.
   */
  public navigateToTimestamp(timestamp: number, mode: TimelineNavigateMode = 'reveal'): void {
    if (!this.events) {
      return;
    }
    // Find event by timestamp (binary search - events sorted by time)
    const result = findEventByTimestamp(this.events, timestamp);
    if (mode === 'reveal') {
      this._reveal(result);
      return;
    }
    // The frame only gives the depth to centre on; the window is the log's, and
    // padding 0 keeps the width asked for.
    const { start, width } = seekWindow(timestamp, this.apexLog?.duration.total ?? 0);
    this.flamechart.getViewportManager()?.focusOnEvent(start, width, result?.depth ?? 0, 0);
    this.flamechart.requestRender();
  }

  private _reveal(result: { event: LogEvent; depth: number } | null): void {
    if (!result) {
      return;
    }

    this.flamechart.selectByEventNode(this.toEventNode(result));
    const { timestamp, duration } = result.event;
    this.flamechart.getViewportManager()?.focusOnEvent(timestamp, duration.total, result.depth);
    this.flamechart.requestRender();
  }

  private toEventNode(result: { event: LogEvent; depth: number }): EventNode {
    return {
      id: `${result.event.eventIndex}-${result.depth}`,
      timestamp: result.event.timestamp,
      duration: result.event.duration.total,
      type: result.event.type ?? result.event.category ?? 'UNKNOWN',
      text: result.event.text,
      original: result.event,
    };
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
   * Show or hide the frame details panel on hover and on selection.
   * @param enabled - Whether the panel may appear
   */
  public setTooltipEnabled(enabled: boolean): void {
    this.tooltipRenderer?.setEnabled(enabled);
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
    if (this.inspectorUnsubscribe) {
      this.inspectorUnsubscribe();
      this.inspectorUnsubscribe = null;
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

  /**
   * Apply editor colors read from CSS after a host theme change.
   * The category palette is separate — see {@link setTheme}.
   */
  public setEditorColors(colors: EditorColors): void {
    this.flamechart.setEditorColors(colors);
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

    this.reportLocatedFrame(eventNode);

    // Priority: Events take precedence over truncation markers
    if (eventNode) {
      // Extract LogEvent from EventNode.original for tooltip display
      const logEvent = eventNode.original as LogEvent | undefined;
      if (logEvent) {
        this.tooltipRenderer.show(logEvent, this.buildAnchor(eventNode, screenX, screenY));

        // Call external callback if provided
        if (this.options.onEventHover) {
          this.options.onEventHover(logEvent);
        }
      }
    } else if (marker) {
      this.tooltipRenderer.showTruncation(marker, this.buildAnchor(marker, screenX, screenY));
    } else {
      this.tooltipRenderer.hide();

      // Call external callback with null
      if (this.options.onEventHover) {
        this.options.onEventHover(null);
      }
    }
  }

  /**
   * Tell the inspector which frame the pointer is over, so it can mark the row
   * that stands for it. Mouse moves land per pixel, so only a change is reported.
   */
  private reportLocatedFrame(eventNode: EventNode | null): void {
    const logEvent = eventNode?.original as LogEvent | undefined;
    const eventIndex = logEvent?.eventIndex ?? null;
    if (eventIndex === this.locatedEventIndex) {
      return;
    }
    this.locatedEventIndex = eventIndex;
    eventBus.emit('detail:locate', {
      source: 'timeline',
      eventIndexes: eventIndex === null ? [] : [eventIndex],
    });
  }

  /**
   * Build the tooltip anchor for a frame or marker.
   *
   * The depth comes from the screen Y the chart reported, so the same call works for hover,
   * keyboard navigation, search navigation and the context menu.
   *
   * @param target - Frame or marker the tooltip belongs to, or null for cursor placement
   * @param screenX - Container-relative X
   * @param screenY - Container-relative Y
   */
  private buildAnchor(
    target: EventNode | TimelineMarker | null,
    screenX: number,
    screenY: number,
  ): TooltipAnchor {
    let rect: TooltipAnchor['rect'] = null;
    if (target) {
      const depth = this.flamechart.containerYToDepth(screenY);
      rect = this.isTimelineMarker(target)
        ? this.flamechart.getFrameRect(target.startTime, 0, depth)
        : this.flamechart.getFrameRect(target.timestamp, target.duration, depth);
    }

    return {
      rect,
      chartTopY: this.flamechart.getChartTopY(),
      cursorX: screenX,
      cursorY: screenY,
    };
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

    // A click on empty space drops a mark left by a picked inspector row, which
    // the chart's own clear says nothing about when it held no selection.
    if (!eventNode && !marker) {
      this.clearEmphasis();
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
    // A select says what to look at, so nothing dims and any mark a picked inspector row
    // left behind is dropped. Chrome dims for a search, never for a select. The inspector
    // re-marks its own frame after the select it asked for.
    this.clearEmphasis();

    if (this.echoGuard.suppressed) {
      return;
    }

    if (!eventNode) {
      // Selection cleared - hide tooltip
      if (this.tooltipRenderer) {
        this.tooltipRenderer.hide();
      }
      eventBus.emit('detail:select', { source: 'timeline', selection: null, view: TIMELINE_VIEW });
      return;
    }

    // Selection only - no auto-navigation to call tree
    // User can press J to explicitly jump to call tree
    // The inspector shows the selected frame's detail.
    const originalEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    const selection = toDetailSelection(originalEvent?.eventIndex);
    if (selection) {
      eventBus.emit('detail:select', { source: 'timeline', selection, view: TIMELINE_VIEW });
    }
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
    this.clearEmphasis();

    if (!marker) {
      // Marker selection cleared - hide tooltip
      if (this.tooltipRenderer) {
        this.tooltipRenderer.hide();
      }
      eventBus.emit('detail:select', { source: 'timeline', selection: null, view: TIMELINE_VIEW });
      return;
    }

    // Marker selection only - no auto-navigation to call tree
    // User can press J to explicitly jump to call tree
    // Markers only carry an eventIndex when they map to a log event.
    const selection = toDetailSelection(marker.eventIndex);
    if (selection) {
      eventBus.emit('detail:select', { source: 'timeline', selection, view: TIMELINE_VIEW });
    }
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
      this.tooltipRenderer.show(logEvent, this.buildAnchor(event, screenX, screenY));
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
    this.tooltipRenderer.showTruncation(marker, this.buildAnchor(marker, screenX, screenY));
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
      this.tooltipRenderer.show(logEvent, this.buildAnchor(eventNode, screenX, screenY), {
        keepPosition: true,
      });
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
      this.tooltipRenderer.showTruncation(marker, this.buildAnchor(marker, screenX, screenY));
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
      this.tooltipRenderer.hideImmediate();
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
          copyToClipboard(marker.summary);
          break;
        case 'copy-marker-details':
          copyToClipboard(this.formatMarkerDetails(marker));
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
        copyToClipboard(event.text);
        break;
      case 'copy-details':
        copyToClipboard(this.formatEventDetails(event));
        break;
      case 'copy-call-stack':
        copyToClipboard(this.formatCallStack(event));
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
   * Format event details for clipboard (similar to tooltip content).
   */
  private formatEventDetails(eventNode: EventNode): string {
    // Access original LogEvent for full details
    const logEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    if (!logEvent) {
      // Fallback for nodes without original
      return `Name: ${eventNode.text}\nType: ${eventNode.type}`;
    }
    return formatEventDetails(logEvent, this.apexLog?.governorLimits);
  }

  /**
   * Format call stack for clipboard.
   * Builds the parent chain from root to the selected event.
   */
  private formatCallStack(eventNode: EventNode): string {
    const logEvent = (eventNode as EventNode & { original?: LogEvent }).original;
    return logEvent ? formatCallStack(logEvent) : eventNode.text;
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
      this.tooltipRenderer.show(logEvent, this.buildAnchor(eventNode, screenX, screenY));
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
}
