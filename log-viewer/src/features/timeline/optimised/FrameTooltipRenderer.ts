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
import { selfLabel } from '../../../core/metrics/eventMetrics.js';
import { formatSOQL, type Dialect, type SoqlBudget } from '../../soql/format/formatter.js';
import { markerColorCss, type TimelineMarker } from '../types/flamechart.types.js';
import { frameCard, markerCard, type CardRow, type TooltipCard } from './frameTooltipCard.js';

/** Delay before a tooltip first appears, so sweeping across frames does not strobe. */
const SHOW_DELAY_MS = 60;
/** Grace period before hiding, so crossing the gap between adjacent frames does not blink. */
const HIDE_GRACE_MS = 30;
/** Gap between the tooltip and the frame it is anchored to. */
const ANCHOR_GAP = 3;
/** Above this raw length a query is shown as a single ellipsised line, never pretty-printed. */
const SOQL_FORMAT_MAX_CHARS = 2000;
/** Single-line fallback length for queries too large to pretty-print. */
const SOQL_INLINE_MAX_CHARS = 160;
/** Plain descriptions clamp to three lines, so no card can read more than this. */
const PLAIN_TEXT_MAX_CHARS = 512;
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
  node: HTMLElement;
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
  /**
   * Sizes the placement needs, measured on the first placement after a content swap or a resize.
   * A pointer move is then style writes alone, with no layout read to force a reflow.
   */
  private panelWidth: number | null = null;
  private panelHeight: number | null = null;
  private containerWidth: number | null = null;
  private containerHeight: number | null = null;
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
      // The panel's width is a share of the container, so both it and the bounds it clamps
      // against have moved.
      this.containerWidth = null;
      this.containerHeight = null;
      this.panelWidth = null;
      this.panelHeight = null;
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

    if (content) {
      this.tooltipElement.replaceChildren(content);
    } else {
      this.tooltipElement.replaceChildren();
    }

    this.tooltipElement.dataset.visible = 'true';
    // New content is a new height; the width is fixed by the stylesheet, so it still holds.
    this.panelHeight = null;
    // A new frame picks its side afresh; only movement within one frame is sticky.
    this.anchorBelow = false;
    this.currentAnchor = anchor;
    this.anchorTooltip(anchor);
  }

  /** The card for a truncation or exception marker. */
  private generateTruncationTooltipContent(marker: TimelineMarker): HTMLDivElement | null {
    return this.createTooltip(markerCard(marker, markerColorCss(marker.type)), {
      node: descriptionNode(marker.metadata ?? ''),
      more: null,
    });
  }

  private generateTooltipContent(event: LogEvent): HTMLDivElement | null {
    if (!event?.isParent) {
      return null;
    }
    return this.createTooltip(
      frameCard(event, this.options.categoryColors[event.category] ?? '', this.options.apexLog),
      this.getDescription(event),
    );
  }

  /**
   * Build (or reuse) the description block for an event. Queries are pretty-printed and clamped;
   * anything else reads as the frame's own text.
   *
   * The text is joined only where it is used: a cache hit needs none of it, and a query can run
   * to kilobytes.
   */
  private getDescription(event: LogEvent): DescriptionBlock {
    const isSosl = event.type === 'SOSL_EXECUTE_BEGIN';
    if (event.type !== 'SOQL_EXECUTE_BEGIN' && !isSosl) {
      return { node: descriptionNode(event.text + (event.suffix ?? '')), more: null };
    }

    let block = this.descriptionCache.get(event);
    if (!block) {
      block = this.buildQueryPreview(event.text + (event.suffix ?? ''), isSosl ? 'sosl' : 'soql');
      this.descriptionCache.set(event, block);
    }
    return { node: block.node.cloneNode(true) as HTMLElement, more: block.more };
  }

  /**
   * Render a query as classed spans, fitted to the panel. Each clause keeps one line and says
   * how much it left out, so the `WHERE` survives however long the field list is.
   */
  private buildQueryPreview(text: string, dialect: Dialect): DescriptionBlock {
    const node = document.createElement('div');
    node.className = 'tooltip-description soql-block';

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
    line.className = 'tooltip-description soql-block';

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

  /** Renders a {@link TooltipCard}, with the description block the caller built. */
  private createTooltip(card: TooltipCard, description: DescriptionBlock): HTMLDivElement {
    const body = document.createElement('div');
    body.className = 'timeline-tooltip';
    if (card.rail) {
      body.style.borderColor = card.rail;
    }

    if (card.title) {
      body.appendChild(element('div', 'tooltip-title', card.title));
    }
    if (description.node.firstChild) {
      body.appendChild(description.node);
    }
    if (card.identity?.length) {
      body.appendChild(element('div', 'tooltip-identity', card.identity.join(' · ')));
    }
    const ruled = !!card.identity?.length;
    card.groups.forEach((group, index) => {
      const box = document.createElement('div');
      // The rule parts what the frame is from what it measured, so only the first group
      // takes it, and only where there is an identity above it to part from — a marker
      // card has none. Sibling divs give CSS no "first group" selector to do it with.
      box.className = !index && ruled ? 'tooltip-group tooltip-group--ruled' : 'tooltip-group';
      group.forEach((row) => box.appendChild(rowElement(row)));
      body.appendChild(box);
    });

    // Only what was left out, and only when something was: a footer that always says
    // the same thing is a row spent on every card to tell you what one click teaches.
    const cut = [description.more, card.hidden ? `+${card.hidden} more` : null].filter(Boolean);
    if (cut.length) {
      body.appendChild(element('div', 'tooltip-status', cut.join(' · ')));
    }

    return body;
  }

  /**
   * Place the tooltip against the hovered frame, inside the container.
   *
   * X follows the cursor and Y is pinned to the frame band — above it, or below it when there is
   * no room above — so the panel rides along the frame it describes. The cursor is inside that
   * frame, so a panel centred on the cursor always overlaps it, and the clamp that keeps the panel
   * in the container is the only thing that stops it. With no frame rect — the frame is off
   * screen, so `getFrameRect` returned null — fall back to placing both axes off the cursor.
   */
  private anchorTooltip(anchor: TooltipAnchor): void {
    const element = this.tooltipElement;
    if (!element) {
      return;
    }

    // A hidden chart measures 0, which is not a size to hold on to: cache only real values, so
    // the next placement after the reveal measures again.
    if (!this.containerWidth || !this.containerHeight) {
      const containerRect = this.container.getBoundingClientRect();
      this.containerWidth = containerRect.width || null;
      this.containerHeight = containerRect.height || null;
    }
    this.panelWidth ||= element.offsetWidth || null;
    this.panelHeight ||= element.offsetHeight || null;

    const containerWidth = this.containerWidth ?? 0;
    const containerHeight = this.containerHeight ?? 0;
    const width = this.panelWidth ?? 0;
    const height = this.panelHeight ?? 0;
    const rect = anchor.rect;

    let x: number;
    let y: number;
    if (rect) {
      // Centred on the cursor. The clamp below sticks the panel to the container edge, so the
      // last half-panel-width at each end trades tracking for staying on screen.
      x = anchor.cursorX - width / 2;

      const above = rect.y - ANCHOR_GAP - height;
      const below = rect.y + rect.height + ANCHOR_GAP;
      const fitsAbove = above >= anchor.chartTopY;
      const fitsBelow = below + height <= containerHeight;
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
      if (x + width > containerWidth) {
        x = anchor.cursorX - width - offset;
      }
      if (y + height > containerHeight) {
        y = anchor.cursorY - height - offset;
      }
    }

    // Keep the panel inside the chart area, never over the minimap or metric strip. The top limit
    // wins over the bottom one, so a panel taller than the chart overflows down rather than up.
    const topLimit = rect ? anchor.chartTopY : 0;
    // Moved with a transform, not with `left`/`top`: following the cursor re-places on every
    // pointer move, and only a transform keeps that off the layout path. Whole pixels, so the
    // monospace text does not land on a subpixel boundary and blur.
    const left = Math.round(Math.max(0, Math.min(x, containerWidth - width)));
    const top = Math.round(Math.max(topLimit, Math.min(y, containerHeight - height)));
    element.style.transform = `translate(${left}px, ${top}px)`;
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

/** A classed element with text, the shape every row in the card takes. */
function element(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** A plain-text description, cut to what the stylesheet's clamp can show. */
function descriptionNode(text: string): HTMLElement {
  return element('div', 'tooltip-description', text.slice(0, PLAIN_TEXT_MAX_CHARS));
}

/**
 * One row of the card: what it is, the reading against the log's own figure, and the
 * frame's own figure. All text — a hover card is read as text, and a bar here has no
 * room for the track and axis that would let it be read as a quantity rather than as
 * a highlighted row.
 *
 * The figure columns hold a floor on every row and on every card, so they keep their
 * place as the pointer moves from frame to frame.
 */
function rowElement(row: CardRow): HTMLElement {
  const line = document.createElement('div');
  line.className = 'tooltip-row';
  if (row.wide) {
    line.classList.add('tooltip-row--wide');
  }
  if (row.lead) {
    line.classList.add('tooltip-row--lead');
  }

  line.appendChild(element('span', 'tooltip-label', row.label));
  line.appendChild(element('span', 'tooltip-value', row.value));
  if (!row.wide) {
    line.appendChild(element('span', 'tooltip-self', row.self ? selfLabel(row.self) : ''));
  }
  return line;
}
