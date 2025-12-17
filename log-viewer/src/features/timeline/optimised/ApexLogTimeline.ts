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

import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { goToRow } from '../../call-tree/components/CalltreeView.js';
import { getTheme } from '../themes/ThemeSelector.js';
import type {
  EventNode,
  FindEventDetail,
  FindResultsEventDetail,
  TimelineMarker,
  TimelineOptions,
  ViewportState,
} from '../types/flamechart.types.js';
import type { SearchCursor } from '../types/search.types.js';
import { extractMarkers } from '../utils/marker-utils.js';
import { FlameChart } from './FlameChart.js';
import { TimelineTooltipManager } from './TimelineTooltipManager.js';

interface ApexTimelineOptions extends TimelineOptions {
  themeName?: string | null;
}

export class ApexLogTimeline {
  private flamechart: FlameChart;
  private tooltipManager: TimelineTooltipManager | null = null;
  private apexLog: ApexLog | null = null;
  private options: TimelineOptions = {};
  private container: HTMLElement | null = null;
  private events: LogEvent[] = [];
  private searchCursor: SearchCursor<EventNode> | null = null;

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

    // Initialize FlameChart with Apex-specific callbacks
    await this.flamechart.init(
      container,
      this.events,
      markers,
      { ...options, enableSearch: true }, // Enable search via options
      {
        onMouseMove: (screenX, screenY, event, marker) => {
          this.handleMouseMove(screenX, screenY, event, marker);
        },
        onClick: (screenX, screenY, event, marker) => {
          this.handleClick(screenX, screenY, event, marker);
        },
        onViewportChange: (viewport: ViewportState) => {
          if (options.onViewportChange) {
            options.onViewportChange(viewport);
          }
        },
        onSearchNavigate: (event, screenX, screenY, depth) => {
          this.handleSearchNavigate(event, screenX, screenY, depth);
        },
      },
    );

    // Wire up search event listeners
    this.enableSearch();
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
   * Handle click - navigate to Apex log event or marker.
   */
  private handleClick(
    screenX: number,
    screenY: number,
    event: LogEvent | null,
    marker: TimelineMarker | null,
  ): void {
    // Navigate to truncation marker if clicked
    if (marker) {
      goToRow(marker.startTime);
      return;
    }

    // Navigate to event if clicked
    if (event) {
      goToRow(event.timestamp);
    }
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
}
