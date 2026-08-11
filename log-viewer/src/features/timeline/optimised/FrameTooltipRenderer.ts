/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * FrameTooltipRenderer
 *
 * Manages HTML tooltip display for event hover interactions.
 * Handles tooltip positioning, content generation, and visibility.
 */

import type { ApexLog, LogEvent } from 'apex-log-parser';
import {
  computeWallClockMs,
  formatDuration,
  formatWallClockTime,
} from '../../../core/utility/Util.js';
import { formatSOQL, type Dialect, type SoqlBudget } from '../../soql/format/formatter.js';
import type { TimelineMarker } from '../types/flamechart.types.js';
import { formatNumber } from './rendering/tooltip-utils.js';

/** Delay before a tooltip first appears, so sweeping across frames does not strobe. */
const SHOW_DELAY_MS = 150;
/** Grace period before hiding, so crossing the gap between adjacent frames does not blink. */
const HIDE_GRACE_MS = 80;
/** Gap between the tooltip and the frame it is anchored to. */
const ANCHOR_GAP = 8;
/** Above this raw length a query is shown as a single ellipsised line, never pretty-printed. */
const SOQL_FORMAT_MAX_CHARS = 2000;
/** Single-line fallback length for queries too large to pretty-print. */
const SOQL_INLINE_MAX_CHARS = 160;
/** Share of the panel's height a query may take. The rest holds the metric rows and the footer. */
const QUERY_HEIGHT_SHARE = 0.45;
const MIN_QUERY_LINES = 4;
const MAX_QUERY_LINES = 16;
/** Used when the panel has no layout yet, so a query still gets a sane shape. */
const FALLBACK_BUDGET: SoqlBudget = { lines: 6, columns: 48 };
/** The string the query line width is measured with. */
const PROBE_TEXT = 'M'.repeat(50);

/** Screen-space anchor for the tooltip, in container coordinates. */
export interface TooltipAnchor {
  /** The hovered frame's rectangle, or null to fall back to cursor placement. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** Screen Y of the top of the chart area. Above it sit the minimap and metric strip. */
  chartTopY: number;
  /** Cursor position. X drives the panel along the frame; Y is used when `rect` is null. */
  cursorX: number;
  cursorY: number;
}

/**
 * Configuration options for tooltip behavior.
 */
export interface TooltipOptions {
  /** Offset from cursor in pixels. Default: 10px */
  cursorOffset: number;

  categoryColors: Record<string, string>;

  apexLog?: ApexLog | null;
}

/** A tooltip waiting for the show delay to expire. */
type PendingTooltip =
  | { kind: 'event'; event: LogEvent; anchor: TooltipAnchor }
  | { kind: 'marker'; marker: TimelineMarker; anchor: TooltipAnchor };

/** A built description block, plus the footer that says what was cut. */
interface DescriptionBlock {
  node: HTMLDivElement;
  more: string | null;
}

export class FrameTooltipRenderer {
  private container: HTMLElement;
  private tooltipElement: HTMLElement | null = null;
  private options: TooltipOptions;
  private currentEvent: LogEvent | null = null;
  private currentTruncationMarker: TimelineMarker | null = null;
  private currentAnchor: TooltipAnchor | null = null;
  private enabled = true;
  /** Which side of the frame band the panel is on. Sticky, so it does not flip as X moves. */
  private anchorBelow = false;
  private pending: PendingTooltip | null = null;
  private showTimer: number | null = null;
  private hideTimer: number | null = null;
  /** Built descriptions, keyed by event: re-hovering a frame costs a clone, not a re-parse. */
  private descriptionCache = new WeakMap<LogEvent, DescriptionBlock>();
  /** How much query the panel holds. Measured from the panel, and only when its size changes. */
  private queryBudget: SoqlBudget | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** The panel's own state: `data-visible` is what the stylesheet fades on. */
  private get visible(): boolean {
    return this.tooltipElement?.dataset.visible === 'true';
  }

  constructor(
    container: HTMLElement,
    options: TooltipOptions = {
      categoryColors: {},
      cursorOffset: 10,
    },
  ) {
    this.container = container;
    this.options = { ...options };

    this.createTooltipElement();
    this.observeResize();
  }

  /**
   * The panel's size follows the window, so re-measure the query budget when the container
   * resizes — never per hover. Built descriptions go with it, since they were cut to the old size.
   */
  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.queryBudget = null;
      this.descriptionCache = new WeakMap();
      this.refresh();
    });
    this.resizeObserver.observe(this.container);
  }

  /** Rebuild a panel that is on screen, so a resize does not leave a query cut to the old size. */
  private refresh(): void {
    const anchor = this.currentAnchor;
    if (!this.visible || !anchor) {
      return;
    }

    if (this.currentEvent) {
      this.displayContent(this.generateTooltipContent(this.currentEvent), anchor);
    } else if (this.currentTruncationMarker) {
      this.displayContent(
        this.generateTruncationTooltipContent(this.currentTruncationMarker),
        anchor,
      );
    }
  }

  /**
   * Create tooltip HTML element and append to container.
   */
  private createTooltipElement(): void {
    this.tooltipElement = document.createElement('div');
    this.tooltipElement.id = 'timeline-tooltip';
    this.container.appendChild(this.tooltipElement);
  }

  /**
   * Show the tooltip for an event, anchored to the frame it belongs to.
   *
   * The first tooltip appears after {@link SHOW_DELAY_MS}; once one is visible, moving to another
   * frame swaps the content with no delay.
   * @param event - Event to display tooltip for
   * @param anchor - Frame rectangle and cursor position, in container coordinates
   * @param options - Optional settings
   * @param options.keepPosition - Leave a visible tooltip where it is, and never open a new one.
   *   The context menu uses this: it must not move the panel, nor make one appear behind itself.
   */
  public show(event: LogEvent, anchor: TooltipAnchor, options?: { keepPosition?: boolean }): void {
    if (!this.enabled || (options?.keepPosition && !this.visible)) {
      return;
    }
    this.clearHideTimer();

    if (this.visible) {
      if (this.currentEvent !== event || this.currentTruncationMarker) {
        this.currentEvent = event;
        this.currentTruncationMarker = null;
        this.displayContent(this.generateTooltipContent(event), anchor);
      } else if (!options?.keepPosition && this.anchorMoved(anchor)) {
        this.currentAnchor = anchor;
        this.anchorTooltip(anchor);
      }
      return;
    }

    this.currentEvent = event;
    this.currentTruncationMarker = null;
    this.scheduleShow({ kind: 'event', event, anchor });
  }

  /**
   * Show the tooltip for a truncation marker.
   * @param marker - Truncation marker to display tooltip for
   * @param anchor - Frame rectangle and cursor position, in container coordinates
   */
  public showTruncation(marker: TimelineMarker, anchor: TooltipAnchor): void {
    if (!this.enabled) {
      return;
    }
    this.clearHideTimer();

    if (this.visible) {
      if (this.currentTruncationMarker !== marker || this.currentEvent) {
        this.currentEvent = null;
        this.currentTruncationMarker = marker;
        this.displayContent(this.generateTruncationTooltipContent(marker), anchor);
      } else if (this.anchorMoved(anchor)) {
        this.currentAnchor = anchor;
        this.anchorTooltip(anchor);
      }
      return;
    }

    this.currentEvent = null;
    this.currentTruncationMarker = marker;
    this.scheduleShow({ kind: 'marker', marker, anchor });
  }

  /**
   * Hide the tooltip after a short grace period, so crossing the gap between two adjacent
   * frames does not blink. A `show` inside the grace window cancels the hide.
   */
  public hide(): void {
    this.clearShowTimer();

    if (!this.visible) {
      this.currentEvent = null;
      this.currentTruncationMarker = null;
      return;
    }

    if (this.hideTimer === null) {
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = null;
        this.hideImmediate();
      }, HIDE_GRACE_MS);
    }
  }

  /**
   * Hide the tooltip with no grace period. Use on teardown, log change, or when hover
   * tooltips are turned off.
   */
  public hideImmediate(): void {
    this.clearShowTimer();
    this.clearHideTimer();

    if (this.tooltipElement) {
      this.tooltipElement.dataset.visible = 'false';
    }

    this.currentEvent = null;
    this.currentTruncationMarker = null;
    this.currentAnchor = null;
  }

  /**
   * Turn hover and selection tooltips on or off. Turning them off hides any tooltip at once and
   * makes every later `show` a no-op, so one gate covers every caller.
   * @param enabled - Whether tooltips may appear
   */
  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    if (!enabled) {
      this.hideImmediate();
    }
  }

  /** Queue a first appearance. A later call replaces what is queued; the timer keeps running. */
  private scheduleShow(pending: PendingTooltip): void {
    this.pending = pending;
    if (this.showTimer !== null) {
      return;
    }

    this.showTimer = window.setTimeout(() => {
      this.showTimer = null;
      const next = this.pending;
      this.pending = null;
      if (!next) {
        return;
      }
      if (next.kind === 'event') {
        this.displayContent(this.generateTooltipContent(next.event), next.anchor);
      } else {
        this.displayContent(this.generateTruncationTooltipContent(next.marker), next.anchor);
      }
    }, SHOW_DELAY_MS);
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      window.clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    this.pending = null;
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** True when the anchor has moved enough to need a re-place (cursor, pan, zoom, or no rect). */
  private anchorMoved(anchor: TooltipAnchor): boolean {
    const previous = this.currentAnchor;
    if (!previous || !previous.rect || !anchor.rect) {
      return true;
    }

    return (
      previous.cursorX !== anchor.cursorX ||
      previous.rect.x !== anchor.rect.x ||
      previous.rect.y !== anchor.rect.y ||
      previous.rect.width !== anchor.rect.width ||
      previous.rect.height !== anchor.rect.height ||
      previous.chartTopY !== anchor.chartTopY
    );
  }

  /**
   * Update category colors (used when theme changes).
   */
  public updateCategoryColors(colors: Record<string, string>): void {
    this.options.categoryColors = colors;
  }

  /** Swap the panel content, make it visible, and place it. */
  private displayContent(content: HTMLDivElement | null, anchor: TooltipAnchor): void {
    if (!this.tooltipElement) {
      return;
    }

    while (this.tooltipElement.firstChild) {
      this.tooltipElement.removeChild(this.tooltipElement.firstChild);
    }
    if (content) {
      this.tooltipElement.appendChild(content);
    }

    this.tooltipElement.dataset.visible = 'true';
    // A new frame picks its side afresh; only movement within one frame is sticky.
    this.anchorBelow = false;
    this.currentAnchor = anchor;
    this.anchorTooltip(anchor);
  }

  /**
   * Generate tooltip content for truncation marker.
   */
  private generateTruncationTooltipContent(marker: TimelineMarker): HTMLDivElement | null {
    const rows: { label: string; value: string }[] = [];
    const color = this.getTruncationColor(marker.type);
    return this.createTooltip(marker.summary, marker.metadata, rows, color);
  }

  /**
   * Get human-readable label for truncation type.
   */
  private getTruncationTypeLabel(type: string): string {
    switch (type) {
      case 'error':
        return 'Error';
      case 'skip':
        return 'Skipped Lines';
      case 'unexpected':
        return 'Unexpected Truncation';
      default:
        return type;
    }
  }

  /**
   * Format nanoseconds as milliseconds for display.
   */
  private formatNanoseconds(ns: number): string {
    const ms = ns / 1_000_000;
    return `${ms.toFixed(2)}ms`;
  }

  /**
   * T017: Get CSS color string for truncation type tooltip borders.
   * Converts PixiJS numeric colors (0xRRGGBB) to CSS hex strings (#RRGGBB).
   */
  private getTruncationColor(type: string): string {
    // Map marker types to CSS colors matching MARKER_COLORS
    switch (type) {
      case 'exception':
        return '#e5484d'; // saturated red - discrete failure
      case 'error':
        return '#ff808033'; // rgba(255, 128, 128, 0.2)
      case 'skip':
        return '#1e80ff33'; // rgba(30, 128, 255, 0.2)
      case 'unexpected':
        return '#8080ff33'; // rgba(128, 128, 255, 0.2)
      default:
        return '#999999'; // Gray fallback
    }
  }

  private generateTooltipContent(event: LogEvent): HTMLDivElement | null {
    if (event?.isParent) {
      const rows = [];
      if (event.type) {
        rows.push({ label: 'type:', value: event.type.toString() });
      }

      if (event.exitStamp) {
        if (event.duration.total) {
          let val = formatDuration(event.duration.total);
          if (event.cpuType === 'free') {
            val += ' (free)';
          } else if (event.duration.self) {
            val += ` (self ${formatDuration(event.duration.self)})`;
          }

          rows.push({ label: 'total:', value: val });
        }

        // Wall-clock time row (only if startTime is available)
        const apexLog = this.options.apexLog;
        if (apexLog?.startTime !== null && apexLog?.timestamp !== undefined) {
          const startWallClock = computeWallClockMs(
            apexLog.startTime,
            apexLog.timestamp,
            event.timestamp,
          );
          let timeVal = formatWallClockTime(startWallClock);
          if (event.exitStamp) {
            const endWallClock = computeWallClockMs(
              apexLog.startTime,
              apexLog.timestamp,
              event.exitStamp,
            );
            timeVal += ` → ${formatWallClockTime(endWallClock)}`;
          }
          rows.push({ label: 'time:', value: timeVal });
        }

        const govLimits = this.options.apexLog?.governorLimits;
        if (event.dmlCount.total) {
          rows.push({
            label: 'DML:',
            value: this.formatLimit(
              event.dmlCount.total,
              event.dmlCount.self,
              govLimits?.dmlStatements.limit,
            ),
          });
        }

        if (event.dmlRowCount.total) {
          rows.push({
            label: 'DML rows:',
            value: this.formatLimit(
              event.dmlRowCount.total,
              event.dmlRowCount.self,
              govLimits?.dmlRows.limit,
            ),
          });
        }

        if (event.soqlCount.total) {
          rows.push({
            label: 'SOQL:',
            value: this.formatLimit(
              event.soqlCount.total,
              event.soqlCount.self,
              govLimits?.soqlQueries.limit,
            ),
          });
        }

        if (event.soqlRowCount.total) {
          rows.push({
            label: 'SOQL rows:',
            value: this.formatLimit(
              event.soqlRowCount.total,
              event.soqlRowCount.self,
              govLimits?.queryRows.limit,
            ),
          });
        }

        if (event.soslCount.total) {
          rows.push({
            label: 'SOSL:',
            value: this.formatLimit(
              event.soslCount.total,
              event.soslCount.self,
              govLimits?.soslQueries.limit,
            ),
          });
        }

        if (event.soslRowCount.total) {
          rows.push({
            label: 'SOSL rows:',
            value: this.formatLimit(
              event.soslRowCount.total,
              event.soslRowCount.self,
              govLimits?.soslQueries.limit,
            ),
          });
        }

        if (event.thrownCount.total) {
          // No `self`: on a method (the only hoverable frame) self is always 0 because the
          // throw is a child leaf, so it would only ever read "(self 0)".
          rows.push({ label: 'Throws:', value: `${event.thrownCount.total}` });
        }

        if (event.heapAllocated.total || event.heapAllocated.self) {
          // Net heap retained (alloc − free): total for the subtree, self for this method's
          // own body. ~0 net (allocated then freed) shows no row. Gross/peak live in the grid.
          rows.push({
            label: 'heap:',
            value: `${formatNumber(event.heapAllocated.total)} bytes (self ${formatNumber(
              event.heapAllocated.self,
            )})`,
          });
        }
      }

      const descriptionText = event.text + (event.suffix ?? '');
      return this.createTooltip(
        '',
        descriptionText,
        rows,
        this.options.categoryColors[event.category] || '',
        this.getDescription(event, descriptionText),
        event.category,
        true,
      );
    }

    return null;
  }

  /**
   * Build (or reuse) the description block for an event. Queries are pretty-printed and clamped;
   * anything else falls back to the plain text the caller already has.
   */
  private getDescription(event: LogEvent, text: string): DescriptionBlock | undefined {
    const isSosl = event.type === 'SOSL_EXECUTE_BEGIN';
    if (event.type !== 'SOQL_EXECUTE_BEGIN' && !isSosl) {
      return undefined;
    }

    let block = this.descriptionCache.get(event);
    if (!block) {
      block = this.buildQueryPreview(text, isSosl ? 'sosl' : 'soql');
      this.descriptionCache.set(event, block);
    }
    return { node: block.node.cloneNode(true) as HTMLDivElement, more: block.more };
  }

  /**
   * Render a query as classed spans, fitted to the panel. Each clause keeps one line and says
   * how much it left out, so the `WHERE` survives however long the field list is.
   */
  private buildQueryPreview(text: string, dialect: Dialect): DescriptionBlock {
    const node = document.createElement('div');
    node.className = 'tooltip-header soql-block';

    // Pretty-printing a multi-kilobyte query on every hover is too slow to be worth it, and the
    // result is clamped away anyway.
    if (text.length > SOQL_FORMAT_MAX_CHARS) {
      node.classList.add('is-clamped');
      node.textContent = text.slice(0, SOQL_INLINE_MAX_CHARS);
      return { node, more: 'query too large to format' };
    }

    node.innerHTML = formatSOQL(text, { mode: 'pretty', dialect, budget: this.getQueryBudget() });
    return { node, more: null };
  }

  /** The panel's own size, in query lines and characters. Measured once per panel size. */
  private getQueryBudget(): SoqlBudget {
    this.queryBudget ??= this.measureQueryBudget();
    return this.queryBudget;
  }

  /**
   * Measure the panel with a probe in the query's own font, so a wider window shows more of a
   * query. Falls back to a fixed shape where the panel has no layout.
   */
  private measureQueryBudget(): SoqlBudget {
    const element = this.tooltipElement;
    if (!element) {
      return FALLBACK_BUDGET;
    }

    // Measure inside the panel's own body, so the probe carries the query's font and the width
    // is the text's, not the panel's border box.
    const body = document.createElement('div');
    body.className = 'timeline-tooltip';
    // Pinned to both edges: an absolute box with `width: auto` shrinks to its content, which
    // would measure the probe rather than the panel.
    body.style.position = 'absolute';
    body.style.left = '0';
    body.style.right = '0';
    body.style.visibility = 'hidden';

    const line = document.createElement('div');
    line.className = 'tooltip-header soql-block';

    const probe = document.createElement('span');
    probe.style.whiteSpace = 'pre';
    probe.textContent = PROBE_TEXT;

    line.appendChild(probe);
    body.appendChild(line);
    element.appendChild(body);

    const charWidth = probe.offsetWidth / PROBE_TEXT.length;
    const style = window.getComputedStyle(line);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    const panelWidth = line.clientWidth;
    const panelHeight = parseFloat(window.getComputedStyle(element).maxHeight);
    element.removeChild(body);

    if (!charWidth || !lineHeight || !panelWidth || !panelHeight) {
      return FALLBACK_BUDGET;
    }

    return {
      columns: Math.max(20, Math.floor(panelWidth / charWidth)),
      lines: Math.min(
        MAX_QUERY_LINES,
        Math.max(MIN_QUERY_LINES, Math.floor((panelHeight * QUERY_HEIGHT_SHARE) / lineHeight)),
      ),
    };
  }

  private formatLimit(val: number, self: number, total = 0) {
    const outOf = total > 0 ? `/${total}` : '';
    return `${val}${outOf} (self ${self})`;
  }

  private createTooltip(
    title: string,
    description = '',
    rows: { label: string; value: string }[],
    color: string,
    descriptionBlock?: DescriptionBlock,
    /** Category label for the swatch row; `color` fills the swatch. */
    categoryName?: string,
    /** True when a click selects the frame, which the inspector then shows in full. */
    inspectable = false,
  ) {
    const tooltipBody = document.createElement('div');
    tooltipBody.className = 'timeline-tooltip';

    if (color) {
      tooltipBody.style.borderColor = color;
    }

    if (title) {
      const header = document.createElement('div');
      header.className = 'tooltip-header';
      header.textContent = title;
      tooltipBody.appendChild(header);
    }

    if (descriptionBlock) {
      tooltipBody.appendChild(descriptionBlock.node);
    } else {
      const descriptionDiv = document.createElement('div');
      descriptionDiv.className = 'tooltip-header';
      descriptionDiv.textContent = description;
      tooltipBody.appendChild(descriptionDiv);
    }

    if (categoryName && color) {
      const categoryRow = document.createElement('div');
      categoryRow.className = 'tooltip-category';

      const swatch = document.createElement('span');
      swatch.className = 'tooltip-swatch';
      swatch.style.backgroundColor = color;

      const name = document.createElement('span');
      name.textContent = categoryName;

      categoryRow.appendChild(swatch);
      categoryRow.appendChild(name);
      tooltipBody.appendChild(categoryRow);
    }

    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'tooltip-row';

      const labelDiv = document.createElement('div');
      labelDiv.className = 'tooltip-label';
      labelDiv.textContent = label;

      const valueDiv = document.createElement('div');
      valueDiv.className = 'tooltip-value';
      valueDiv.textContent = value;

      row.appendChild(labelDiv);
      row.appendChild(valueDiv);
      tooltipBody.appendChild(row);
    });

    if (inspectable) {
      // One fixed row at the foot, so what was cut and where to see it in full always read in
      // the same place instead of interrupting the description.
      const status = document.createElement('div');
      status.className = 'tooltip-status';

      const info = document.createElement('span');
      info.className = 'tooltip-status-info';
      info.textContent = descriptionBlock?.more ?? '';

      const action = document.createElement('span');
      action.className = 'tooltip-status-action';
      action.textContent = 'Click to view in Inspector';

      status.appendChild(info);
      status.appendChild(action);
      tooltipBody.appendChild(status);
    }

    return tooltipBody;
  }

  /**
   * Place the tooltip against the hovered frame, inside the container.
   *
   * Y is pinned to the frame band — above it, or below it when there is no room above — so the
   * panel reads as belonging to the frame. X follows the cursor along the frame's visible span,
   * so a wide frame keeps the panel near the pointer. With no frame rect, fall back to the cursor.
   *
   * Measure from the container's top-left, never from the last placement: an absolutely positioned
   * box is capped at `containerWidth - left`, so a panel parked on the right measures narrower,
   * wraps taller, and Y would then be pinned against that wrong height.
   */
  private anchorTooltip(anchor: TooltipAnchor): void {
    const element = this.tooltipElement;
    if (!element) {
      return;
    }

    element.style.left = '0px';
    element.style.top = '0px';

    const containerRect = this.container.getBoundingClientRect();
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const rect = anchor.rect;

    let x: number;
    let y: number;
    if (rect) {
      // Follow the cursor, but stay over the frame so the panel never floats free of it.
      x = Math.min(
        Math.max(anchor.cursorX - width / 2, rect.x),
        Math.max(rect.x, rect.x + rect.width - width),
      );

      const above = rect.y - ANCHOR_GAP - height;
      const below = rect.y + rect.height + ANCHOR_GAP;
      const fitsAbove = above >= anchor.chartTopY;
      const fitsBelow = below + height <= containerRect.height;
      // Hysteresis: keep the side already in use while it still fits, so a frame that sits on the
      // boundary does not flip back and forth as the pointer moves along it.
      if (this.anchorBelow ? !fitsBelow && fitsAbove : !fitsAbove) {
        this.anchorBelow = !this.anchorBelow;
      }
      y = this.anchorBelow ? below : above;
    } else {
      const offset = this.options.cursorOffset;
      x = anchor.cursorX + offset;
      y = anchor.cursorY + offset;
      if (x + width > containerRect.width) {
        x = anchor.cursorX - width - offset;
      }
      if (y + height > containerRect.height) {
        y = anchor.cursorY - height - offset;
      }
    }

    // Keep the panel inside the chart area, never over the minimap or metric strip. The top limit
    // wins over the bottom one, so a panel taller than the chart overflows down rather than up.
    const topLimit = rect ? anchor.chartTopY : 0;
    element.style.left = `${Math.max(0, Math.min(x, containerRect.width - width))}px`;
    element.style.top = `${Math.max(topLimit, Math.min(y, containerRect.height - height))}px`;
  }

  /**
   * Clean up tooltip element.
   */
  public destroy(): void {
    this.clearShowTimer();
    this.clearHideTimer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.tooltipElement && this.tooltipElement.parentNode) {
      this.tooltipElement.parentNode.removeChild(this.tooltipElement);
    }

    this.tooltipElement = null;
    this.currentEvent = null;
    this.currentTruncationMarker = null;
    this.currentAnchor = null;
    this.descriptionCache = new WeakMap();
  }
}
