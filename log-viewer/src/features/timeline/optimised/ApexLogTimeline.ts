/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * ApexLogTimeline - Apex-specific orchestrator for FlameChart
 *
 * Handles all Apex-specific logic:
 * - ApexLog data structures
 * - Tooltip generation for LogEvents
 * - Navigation to source (goToRow)
 * - External callbacks
 */

import type { ApexLog, LogEvent } from '../../../core/log-parser/LogEvents.js';
import { goToRow } from '../../call-tree/components/CalltreeView.js';
import type { TimelineMarker, TimelineOptions, ViewportState } from '../types/timeline.types.js';
import { extractMarkers } from '../utils/marker-utils.js';
import { FlameChart } from './FlameChart.js';
import { TimelineTooltipManager } from './TimelineTooltipManager.js';

export class ApexLogTimeline {
  private flamechart: FlameChart;
  private tooltipManager: TimelineTooltipManager | null = null;
  private apexLog: ApexLog | null = null;
  private options: TimelineOptions = {};

  constructor() {
    this.flamechart = new FlameChart();
  }

  /**
   * Initialize Apex log timeline visualization.
   */
  public async init(
    container: HTMLElement,
    apexLog: ApexLog,
    options: TimelineOptions = {},
  ): Promise<void> {
    this.apexLog = apexLog;
    this.options = options;

    // Create tooltip manager for Apex-specific tooltips
    this.tooltipManager = new TimelineTooltipManager(container, {
      enableFlip: true,
      cursorOffset: 10,
      categoryColors: {
        ...options.colors,
      },
      apexLog: apexLog,
    });

    const markers = extractMarkers(this.apexLog);
    const frames = this.extractEvents();

    // Initialize FlameChart with Apex-specific callbacks
    await this.flamechart.init(container, frames, markers, options, {
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
    });
  }

  /**
   * Clean up resources.
   */
  public destroy(): void {
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

  // ============================================================================
  // APEX-SPECIFIC HANDLERS
  // ============================================================================

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
}
