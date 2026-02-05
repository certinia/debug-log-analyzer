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

import type { ApexLog, GovernorSnapshot, Limits, LogEvent } from 'apex-log-parser';
import { ContextMenu, type ContextMenuItem } from '../../../components/ContextMenu.js';
import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { formatDuration } from '../../../core/utility/Util.js';
import { goToRow } from '../../call-tree/components/CalltreeView.js';
import { getTheme } from '../themes/ThemeSelector.js';
import type {
  EventNode,
  FindEventDetail,
  FindResultsEventDetail,
  HeatStripMetric,
  HeatStripTimeSeries,
  ModifierKeys,
  TimelineMarker,
  TimelineOptions,
  ViewportState,
} from '../types/flamechart.types.js';
import type { SearchCursor } from '../types/search.types.js';
import { extractMarkers } from '../utils/marker-utils.js';
import { logEventToTreeNode } from '../utils/tree-converter.js';
import { FlameChart } from './FlameChart.js';
import { TimelineTooltipManager } from './TimelineTooltipManager.js';

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

interface ApexTimelineOptions extends TimelineOptions {
  themeName?: string | null;
}

export class ApexLogTimeline {
  private flamechart: FlameChart;
  private tooltipManager: TimelineTooltipManager | null = null;
  private contextMenu: ContextMenu | null = null;
  private apexLog: ApexLog | null = null;
  private options: TimelineOptions = {};
  private container: HTMLElement | null = null;
  private events: LogEvent[] = [];
  private searchCursor: SearchCursor<EventNode> | null = null;
  private selectedEventForContextMenu: EventNode | null = null;
  private selectedMarkerForContextMenu: TimelineMarker | null = null;

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
    this.tooltipManager = new TimelineTooltipManager(container, {
      enableFlip: true,
      cursorOffset: 10,
      categoryColors: colorMap,
      apexLog: apexLog,
    });

    const markers = extractMarkers(this.apexLog);
    this.events = this.extractEvents();

    // Convert LogEvent to TreeNode structure for search and navigation
    // This is Apex-specific: filters out 0-duration events that are invisible
    // Also builds navigation maps during traversal to avoid duplicate O(n) work
    const { treeNodes, maps } = logEventToTreeNode(this.events);

    // Initialize FlameChart with Apex-specific callbacks
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

    // Transform and set heat strip time series data for visualization
    if (apexLog.governorLimits.snapshots.length > 0) {
      const heatStripSeries = this.transformGovernorToHeatStrip(apexLog.governorLimits.snapshots);
      this.flamechart.setHeatStripTimeSeries(heatStripSeries);
    } else {
      this.flamechart.setHeatStripTimeSeries(null);
    }
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
    // Remove event listeners from document
    document.removeEventListener('lv-find', this.handleFind);
    document.removeEventListener('lv-find-match', this.handleFindMatch);
    document.removeEventListener('lv-find-close', this.handleFindClose);

    this.flamechart.destroy();
    if (this.tooltipManager) {
      this.tooltipManager.destroy();
      this.tooltipManager = null;
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
    if (this.tooltipManager) {
      this.tooltipManager.updateCategoryColors(colorMap);
    }
  }

  private themeToColors(themeName: string) {
    const theme = getTheme(themeName);
    // Convert TimelineColors keys to the format expected by FlameChart
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
      'Code Unit': theme.codeUnit,
      Workflow: theme.workflow,
      Method: theme.method,
      Flow: theme.flow,
      DML: theme.dml,
      SOQL: theme.soql,
      'System Method': theme.system,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
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
    event: LogEvent | null,
    marker: TimelineMarker | null,
  ): void {
    if (!this.tooltipManager) {
      return;
    }

    // Don't update tooltip while context menu is open
    if (this.contextMenu?.isVisible()) {
      return;
    }

    // Priority: Events take precedence over truncation markers
    if (event) {
      this.tooltipManager.show(event, screenX, screenY);

      // Call external callback if provided
      if (this.options.onEventHover) {
        this.options.onEventHover(event);
      }
    } else if (marker) {
      this.tooltipManager.showTruncation(marker, screenX, screenY);
    } else {
      this.tooltipManager.hide();

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
    event: LogEvent | null,
    marker: TimelineMarker | null,
    modifiers?: ModifierKeys,
  ): void {
    // Cmd/Ctrl+Click on a frame navigates directly to call tree
    // Note: Only works on individual frames, not buckets (buckets are aggregated)
    if (event && (modifiers?.metaKey || modifiers?.ctrlKey)) {
      goToRow(event.timestamp);
      return;
    }

    // Cmd/Ctrl+Click on a marker navigates directly to call tree
    if (marker && (modifiers?.metaKey || modifiers?.ctrlKey)) {
      goToRow(marker.startTime);
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
      if (this.tooltipManager) {
        this.tooltipManager.hide();
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
    goToRow(eventNode.timestamp);
  }

  /**
   * Handle J key "Jump to Call Tree" action for markers.
   * Navigates call tree to the marker's start time.
   */
  private handleJumpToCallTreeForMarker(marker: TimelineMarker): void {
    goToRow(marker.startTime);
  }

  /**
   * Handle marker selection change from FlameChart.
   */
  private handleMarkerSelect(marker: TimelineMarker | null): void {
    if (!marker) {
      // Marker selection cleared - hide tooltip
      if (this.tooltipManager) {
        this.tooltipManager.hide();
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
    if (!this.tooltipManager) {
      return;
    }

    const eventWithOriginal = event as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;
    if (logEvent) {
      this.tooltipManager.show(logEvent, screenX, screenY);
    }
  }

  /**
   * Handle keyboard navigation to a marker.
   * Shows tooltip for the navigated-to marker.
   */
  private handleMarkerNavigate(marker: TimelineMarker, screenX: number, screenY: number): void {
    if (!this.tooltipManager) {
      return;
    }
    this.tooltipManager.showTruncation(marker, screenX, screenY);
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
    if (this.tooltipManager && logEvent) {
      this.tooltipManager.show(logEvent, screenX, screenY, { keepPosition: true });
    }

    // Build menu items
    const items: ContextMenuItem[] = [
      { id: 'show-in-call-tree', label: 'Show in Call Tree', shortcut: 'J' },
    ];

    // Add "Go to Source" only when hasValidSymbols is true
    if (logEvent?.hasValidSymbols) {
      items.push({ id: 'go-to-source', label: 'Go to Source' });
    }

    items.push(
      { id: 'zoom-to-frame', label: 'Zoom to Frame', shortcut: 'Z' },
      { id: 'separator-1', label: '', separator: true },
      { id: 'copy-name', label: 'Copy Name', shortcut: this.getCopyShortcut() },
      { id: 'copy-details', label: 'Copy Details' },
      { id: 'copy-call-stack', label: 'Copy Call Stack' },
    );

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(items, clientX, clientY);
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
    if (this.tooltipManager) {
      this.tooltipManager.showTruncation(marker, screenX, screenY);
    }

    // Build menu items for markers
    const items: ContextMenuItem[] = [
      { id: 'show-in-call-tree', label: 'Show in Call Tree', shortcut: 'J' },
      { id: 'zoom-to-marker', label: 'Zoom to Marker', shortcut: 'Z' },
      { id: 'separator-1', label: '', separator: true },
      { id: 'copy-summary', label: 'Copy Summary', shortcut: this.getCopyShortcut() },
      { id: 'copy-marker-details', label: 'Copy Details' },
    ];

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(items, clientX, clientY);
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
    if (this.tooltipManager) {
      this.tooltipManager.hide();
    }

    // Build menu items for empty space
    const items: ContextMenuItem[] = [{ id: 'reset-zoom', label: 'Reset Zoom', shortcut: '0' }];

    // Use client coords for context menu (positioned in viewport)
    this.contextMenu.show(items, clientX, clientY);
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
   * Get platform-specific copy shortcut.
   */
  private getCopyShortcut(): string {
    // Use userAgent as fallback since navigator.platform is deprecated
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
    return isMac ? '\u2318C' : 'Ctrl+C';
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
    if (!this.tooltipManager) {
      return;
    }

    // EventNode may have original LogEvent stored from tree conversion
    const eventWithOriginal = eventNode as EventNode & { original?: LogEvent };
    const logEvent = eventWithOriginal.original;

    if (logEvent) {
      this.tooltipManager.show(logEvent, screenX, screenY);
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
   * Transform Apex-specific governor snapshots to generic HeatStripTimeSeries.
   * This converts Apex governor limits data to the generic format expected by
   * the heat strip visualization components.
   *
   * @param snapshots - Apex governor limit snapshots
   * @returns Generic heat strip time series
   */
  private transformGovernorToHeatStrip(snapshots: GovernorSnapshot[]): HeatStripTimeSeries {
    // Convert APEX_METRICS to string-keyed Map for the generic interface
    const metrics = new Map<string, HeatStripMetric>();
    for (const [key, metric] of APEX_METRICS) {
      metrics.set(key, metric);
    }

    // Transform snapshots to events
    const events = snapshots.map((snapshot) => {
      const values = new Map<string, { used: number; limit: number }>();
      for (const [key, value] of Object.entries(snapshot.limits) as [
        keyof Limits,
        { used: number; limit: number },
      ][]) {
        values.set(key, { used: value.used, limit: value.limit });
      }
      return {
        timestamp: snapshot.timestamp,
        namespace: snapshot.namespace,
        values,
      };
    });

    return { metrics, events };
  }
}
