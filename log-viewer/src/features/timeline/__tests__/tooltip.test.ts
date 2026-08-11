/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for FrameTooltipRenderer
 *
 * Tests tooltip timing, anchoring and content generation including:
 * - Show delay, instant swap and hide grace
 * - Placement against the hovered frame, and the cursor fallback
 * - Content generation from event data, with clamped query previews
 * - The on/off switch
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';

import { FrameTooltipRenderer, type TooltipAnchor } from '../optimised/FrameTooltipRenderer.js';

/** Delay before the first tooltip appears; mirrors SHOW_DELAY_MS. */
const SHOW_DELAY_MS = 150;
/** Grace period before hiding; mirrors HIDE_GRACE_MS. */
const HIDE_GRACE_MS = 80;

describe('FrameTooltipRenderer', () => {
  let container: HTMLElement;
  let frameTooltipRenderer: FrameTooltipRenderer;

  /**
   * Helper to create a mock LogEvent
   */
  function createEvent(
    timestamp: number,
    duration: number,
    type: string = 'TestEvent',
    category: string = 'Apex',
  ): LogEvent {
    return {
      timestamp,
      exitStamp: timestamp + duration,
      duration: {
        total: duration,
        exclusive: duration,
        self: duration * 0.5,
      },
      type,
      category,
      text: `Event at ${timestamp}`,
      lineNumber: 42,
      children: [],
      isParent: true, // Required for tooltip to show
      dmlCount: { total: 0, self: 0 },
      dmlRowCount: { total: 0, self: 0 },
      soqlCount: { total: 0, self: 0 },
      soqlRowCount: { total: 0, self: 0 },
      soslCount: { total: 0, self: 0 },
      soslRowCount: { total: 0, self: 0 },
      thrownCount: { total: 0, self: 0 },
      heapAllocated: { total: 0, self: 0 },
    } as unknown as LogEvent;
  }

  /** An anchor with no frame rect, so the tooltip falls back to cursor placement. */
  function cursorAnchor(cursorX: number, cursorY: number): TooltipAnchor {
    return { rect: null, chartTopY: 0, cursorX, cursorY };
  }

  /** An anchor on a frame. The cursor sits at the frame's left edge unless given. */
  function frameAnchor(
    rect: { x: number; y: number; width: number; height: number },
    chartTopY = 0,
    cursorX = rect.x,
  ): TooltipAnchor {
    return { rect, chartTopY, cursorX, cursorY: rect.y };
  }

  function tooltipEl(): HTMLElement {
    return container.querySelector('#timeline-tooltip') as HTMLElement;
  }

  /** jsdom lays nothing out, so the panel's size has to be declared. */
  function sizeTooltip(width: number, height: number): void {
    const element = tooltipEl();
    Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true });
    Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
  }

  /** Show and let the delay expire, which is what a settled hover looks like. */
  function showSettled(event: LogEvent, anchor: TooltipAnchor): void {
    frameTooltipRenderer.show(event, anchor);
    jest.advanceTimersByTime(SHOW_DELAY_MS);
  }

  beforeEach(() => {
    jest.useFakeTimers();

    // Create container element
    container = document.createElement('div');
    container.style.cssText = 'width: 1000px; height: 600px; position: relative;';
    document.body.appendChild(container);

    // Mock container getBoundingClientRect for jsdom
    container.getBoundingClientRect = () =>
      ({
        width: 1000,
        height: 600,
        top: 0,
        left: 0,
        right: 1000,
        bottom: 600,
      }) as DOMRect;

    frameTooltipRenderer = new FrameTooltipRenderer(container);
  });

  afterEach(() => {
    frameTooltipRenderer.destroy();
    document.body.removeChild(container);
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should create tooltip element in container', () => {
      const tooltip = tooltipEl();

      expect(tooltip).not.toBeNull();
      expect(tooltip instanceof HTMLElement).toBe(true);
    });

    it('should initialize tooltip as hidden', () => {
      expect(tooltipEl().dataset.visible).toBeUndefined();
    });

    it('should apply default options', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should accept custom options', () => {
      frameTooltipRenderer.destroy();

      frameTooltipRenderer = new FrameTooltipRenderer(container, {
        categoryColors: { Apex: '#88ae58' },
        cursorOffset: 20,
      });

      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().dataset.visible).toBe('true');
    });
  });

  describe('show and hide timing', () => {
    it('should not show the tooltip before the delay expires', () => {
      frameTooltipRenderer.show(createEvent(0, 100), cursorAnchor(100, 100));

      jest.advanceTimersByTime(SHOW_DELAY_MS - 1);
      expect(tooltipEl().dataset.visible).toBeUndefined();

      jest.advanceTimersByTime(1);
      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should never show when the pointer leaves before the delay expires', () => {
      frameTooltipRenderer.show(createEvent(0, 100), cursorAnchor(100, 100));

      jest.advanceTimersByTime(SHOW_DELAY_MS - 50);
      frameTooltipRenderer.hide();
      jest.advanceTimersByTime(SHOW_DELAY_MS);

      expect(tooltipEl().dataset.visible).toBeUndefined();
    });

    it('should swap content with no delay when moving to another frame', () => {
      const event1 = createEvent(0, 100, 'Event1');
      event1.text = 'Event1';
      const event2 = createEvent(200, 100, 'Event2');
      event2.text = 'Event2';

      showSettled(event1, cursorAnchor(100, 100));
      expect(tooltipEl().textContent).toContain('Event1');

      frameTooltipRenderer.show(event2, cursorAnchor(200, 200));

      expect(tooltipEl().textContent).toContain('Event2');
      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should hide only after the grace period', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      frameTooltipRenderer.hide();
      jest.advanceTimersByTime(HIDE_GRACE_MS - 1);
      expect(tooltipEl().dataset.visible).toBe('true');

      jest.advanceTimersByTime(1);
      expect(tooltipEl().dataset.visible).toBe('false');
    });

    it('should stay visible when a show lands inside the grace period', () => {
      const event = createEvent(0, 100);
      showSettled(event, cursorAnchor(100, 100));

      frameTooltipRenderer.hide();
      jest.advanceTimersByTime(HIDE_GRACE_MS - 20);
      frameTooltipRenderer.show(event, cursorAnchor(110, 100));
      jest.advanceTimersByTime(HIDE_GRACE_MS);

      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should hide with no grace period on hideImmediate', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      frameTooltipRenderer.hideImmediate();

      expect(tooltipEl().dataset.visible).toBe('false');
    });

    it('should re-anchor when the frame moves under a held pointer', () => {
      const event = createEvent(0, 100);
      sizeTooltip(200, 100);

      showSettled(event, frameAnchor({ x: 300, y: 400, width: 100, height: 20 }));
      const initialLeft = tooltipEl().style.left;

      // Same frame, panned left.
      frameTooltipRenderer.show(event, frameAnchor({ x: 100, y: 400, width: 100, height: 20 }));

      expect(tooltipEl().style.left).not.toBe(initialLeft);
    });

    it('should hold its place while the context menu is open', () => {
      const event = createEvent(0, 100);
      const anchor = frameAnchor({ x: 300, y: 400, width: 400, height: 20 });
      sizeTooltip(200, 100);

      showSettled(event, anchor);
      const initialLeft = tooltipEl().style.left;

      frameTooltipRenderer.show(event, { ...anchor, cursorX: 600 }, { keepPosition: true });

      expect(tooltipEl().style.left).toBe(initialLeft);
    });
  });

  describe('enable and disable', () => {
    it('should not show a tooltip while disabled', () => {
      frameTooltipRenderer.setEnabled(false);

      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().dataset.visible).not.toBe('true');
    });

    it('should hide a visible tooltip at once when disabled', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      frameTooltipRenderer.setEnabled(false);

      expect(tooltipEl().dataset.visible).toBe('false');
    });

    it('should show again once re-enabled', () => {
      frameTooltipRenderer.setEnabled(false);
      frameTooltipRenderer.setEnabled(true);

      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().dataset.visible).toBe('true');
    });
  });

  describe('content generation', () => {
    it('should display event type', () => {
      showSettled(createEvent(0, 100, 'MyCustomEvent'), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('MyCustomEvent');
    });

    it('should display event text', () => {
      const event = createEvent(0, 100, 'Event', 'SOQL');
      event.text = 'SOQL query execution';

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('SOQL query execution');
    });

    it('should display duration in milliseconds', () => {
      // Duration: 1,500,000 ns = 1.5ms
      showSettled(createEvent(0, 1_500_000), cursorAnchor(100, 100));

      // Duration is formatted by formatDuration helper
      expect(tooltipEl().textContent).toContain('ms');
    });

    it('should display self duration', () => {
      // Self duration: 50% of total = 750,000 ns = 0.75ms
      showSettled(createEvent(0, 1_500_000), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('self');
      expect(tooltipEl().textContent).toContain('0.75');
    });

    it('should display total duration', () => {
      // Timestamp: 2,000,000 ns = 2.000ms, duration: 100,000 ns = 0.1ms
      showSettled(createEvent(2_000_000, 100_000), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('total');
      // Check for some duration value (format may vary)
      expect(tooltipEl().textContent).toContain('ms');
    });

    it('should display a Throws row with the total (no self) when exceptions were thrown', () => {
      const event = createEvent(0, 1_500_000);
      event.thrownCount = { total: 3, self: 1 };

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('Throws:');
      expect(tooltipEl().textContent).toContain('3');
      // self is intentionally omitted for throws (always 0 on a method).
      expect(tooltipEl().textContent).not.toContain('self 1');
    });

    it('should not display a Throws row when no exceptions were thrown', () => {
      const event = createEvent(0, 1_500_000);
      event.thrownCount = { total: 0, self: 0 };

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).not.toContain('Throws:');
    });

    it('should display a lowercase net heap row as total (self N), thousand-separated', () => {
      const event = createEvent(0, 1_500_000);
      event.heapAllocated = { self: 1_572_864, total: 4_000_000 };

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('heap:');
      // Net subtree total (with the byte unit) and the method's own net in parens.
      expect(tooltipEl().textContent).toContain('4,000,000 bytes (self 1,572,864)');
    });

    it('should not display a heap row when net heap is 0 (allocated then freed)', () => {
      const event = createEvent(0, 1_500_000);
      event.heapAllocated = { self: 0, total: 0 };

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).not.toContain('heap:');
    });

    it('should display custom event text', () => {
      const event = createEvent(0, 100);
      event.text = 'Custom event description';

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('Custom event description');
    });

    it('should handle long event text', () => {
      const event = createEvent(0, 100);
      event.text = 'A'.repeat(150); // 150 characters

      showSettled(event, cursorAnchor(100, 100));

      // The text is clamped by CSS, so all of it stays in the DOM.
      expect(tooltipEl().dataset.visible).toBe('true');
      expect(tooltipEl().textContent).toContain('A');
    });

    it('should escape HTML in event data', () => {
      const event = createEvent(0, 100);
      event.text = '<script>alert("xss")</script>';

      showSettled(event, cursorAnchor(100, 100));

      // textContent shows text without HTML tags - script tags won't execute
      expect(tooltipEl().textContent).toContain('alert("xss")');
      // Check that no actual script element was created
      expect(tooltipEl().querySelector('script')).toBeNull();
    });

    it('should display a category row with a swatch in the category color', () => {
      frameTooltipRenderer.destroy();
      frameTooltipRenderer = new FrameTooltipRenderer(container, {
        categoryColors: { Apex: '#88ae58' },
        cursorOffset: 10,
      });

      showSettled(createEvent(0, 100, 'Event', 'Apex'), cursorAnchor(100, 100));

      const swatch = container.querySelector('.tooltip-swatch') as HTMLElement;
      expect(swatch).not.toBeNull();
      expect(swatch.style.backgroundColor).toBe('rgb(136, 174, 88)');
      expect(swatch.parentElement?.textContent).toContain('Apex');
    });

    it('should not display a category row for an uncategorised event', () => {
      showSettled(createEvent(0, 100, 'Event', ''), cursorAnchor(100, 100));

      expect(container.querySelector('.tooltip-swatch')).toBeNull();
    });

    it('should display wall-clock time row when apexLog has startTime', () => {
      frameTooltipRenderer.destroy();
      const mockApexLog = {
        startTime: 37764600, // 10:29:24.600
        timestamp: 6329577, // first event nanosecond offset
        governorLimits: {
          dmlStatements: { limit: 150 },
          dmlRows: { limit: 10000 },
          soqlQueries: { limit: 100 },
          queryRows: { limit: 50000 },
          soslQueries: { limit: 20 },
        },
      };

      frameTooltipRenderer = new FrameTooltipRenderer(container, {
        categoryColors: {},
        cursorOffset: 10,
        apexLog: mockApexLog as never,
      });

      // Event at timestamp 6329577ns with duration 1,000,000ns
      showSettled(createEvent(6329577, 1_000_000), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).toContain('time:');
      expect(tooltipEl().textContent).toContain('10:29:24.600');
      // End time should be ~1ms later
      expect(tooltipEl().textContent).toContain('10:29:24.601');
      expect(tooltipEl().textContent).toContain('→');
    });

    it('should not display wall-clock time row when apexLog has no startTime', () => {
      frameTooltipRenderer.destroy();
      frameTooltipRenderer = new FrameTooltipRenderer(container, {
        categoryColors: {},
        cursorOffset: 10,
        apexLog: { startTime: null, timestamp: 0 } as never,
      });

      showSettled(createEvent(0, 1_000_000), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).not.toContain('time:');
    });

    it('should not display wall-clock time row when no apexLog', () => {
      showSettled(createEvent(0, 1_000_000), cursorAnchor(100, 100));

      expect(tooltipEl().textContent).not.toContain('time:');
    });
  });

  describe('query preview', () => {
    /** A query with one clause per AND, so it pretty-prints to many lines. */
    function longQuery(conditions: number): string {
      const where = Array.from(
        { length: conditions },
        (_unused, index) => `Name = 'v${index}'`,
      ).join(' AND ');
      return `SELECT Id FROM Account WHERE ${where}`;
    }

    function soqlEvent(text: string): LogEvent {
      const event = createEvent(0, 100, 'SOQL_EXECUTE_BEGIN', 'SOQL');
      event.text = text;
      return event;
    }

    it('should fit a long query to the budget and count the conditions it left out', () => {
      showSettled(soqlEvent(longQuery(40)), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      expect(preview).not.toBeNull();

      const lines = preview.textContent?.split('\n') ?? [];
      expect(lines.length).toBeLessThanOrEqual(6);
      expect(lines[0]).toBe('SELECT Id');
      expect(lines[1]).toBe('FROM Account');
      expect(lines[lines.length - 1]).toMatch(/… \+\d+ conditions$/);
    });

    it('should leave a query that fits on one line whole', () => {
      showSettled(soqlEvent('SELECT Id FROM Account'), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      expect(preview.textContent).toBe('SELECT Id FROM Account');
      expect(container.querySelector('.tooltip-status-info')?.textContent).toBe('');
    });

    it('should keep the WHERE clause however long the field list is', () => {
      const fields = Array.from({ length: 60 }, (_unused, index) => `Field${index}__c`).join(', ');
      showSettled(
        soqlEvent(`SELECT ${fields} FROM Account WHERE Name = 'x'`),
        cursorAnchor(100, 100),
      );

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      const lines = preview.textContent?.split('\n') ?? [];
      expect(lines[0]).toMatch(/^SELECT .*\+\d+ fields$/);
      expect(lines).toContain(`WHERE Name = 'x'`);
    });

    it('should show a single ellipsised line for a query too large to format', () => {
      const huge = `SELECT Id FROM Account WHERE Id IN ('${'0'.repeat(5000)}')`;

      showSettled(soqlEvent(huge), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      expect(preview.classList.contains('is-clamped')).toBe(true);
      expect(preview.textContent).not.toContain('\n');
      expect(preview.textContent?.length).toBe(160);

      const info = container.querySelector('.tooltip-status-info') as HTMLElement;
      expect(info.textContent).toBe('query too large to format');
    });

    it('should point at the inspector for the full detail', () => {
      showSettled(soqlEvent(longQuery(40)), cursorAnchor(100, 100));

      const action = container.querySelector('.tooltip-status-action') as HTMLElement;
      expect(action.textContent).toBe('Click to view in Inspector');
    });

    it('should highlight the query with soql token classes', () => {
      showSettled(soqlEvent('SELECT Id FROM Account'), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      expect(preview.querySelector('span[class^="soql-tok"]')).not.toBeNull();
    });

    it('should build the preview once per event', () => {
      const event = soqlEvent('SELECT Id FROM Account');

      showSettled(event, cursorAnchor(100, 100));
      frameTooltipRenderer.hideImmediate();

      // A rebuild would pick this up; the memoised block does not.
      event.text = 'SELECT Name FROM Contact';
      showSettled(event, cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-header.soql-block') as HTMLElement;
      expect(preview.textContent).toContain('Account');
    });
  });

  describe('anchoring', () => {
    beforeEach(() => {
      sizeTooltip(200, 100);
    });

    it('should pin the panel above the frame band', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 500, width: 100, height: 20 }));

      const tooltip = tooltipEl();
      // The frame is narrower than the panel, so the panel sits at the frame's left edge.
      expect(tooltip.style.left).toBe('300px');
      // Above the frame, with the 8px gap: 500 - 8 - 100.
      expect(tooltip.style.top).toBe('392px');
    });

    it('should flip below the frame when there is no room above', () => {
      // Only 50px between the chart top and the frame, so the panel cannot fit above.
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 90, width: 100, height: 20 }, 40));

      // Below the frame, with the 8px gap: 90 + 20 + 8.
      expect(tooltipEl().style.top).toBe('118px');
    });

    it('should keep the side it flipped to while the pointer moves along the frame', () => {
      const event = createEvent(0, 100);
      // Room above is 8px short of the panel, so the first placement flips below.
      const rect = { x: 300, y: 100, width: 400, height: 20 };

      showSettled(event, frameAnchor(rect, 0));
      expect(tooltipEl().style.top).toBe('128px');

      // Moving right does not change the vertical fit, so the panel must not flip back.
      frameTooltipRenderer.show(event, frameAnchor(rect, 0, 650));

      expect(tooltipEl().style.top).toBe('128px');
    });

    it('should follow the cursor along a frame wider than the panel', () => {
      const event = createEvent(0, 100);
      const rect = { x: 100, y: 500, width: 600, height: 20 };

      showSettled(event, frameAnchor(rect, 0, 400));

      // Centred on the cursor: 400 - 100.
      expect(tooltipEl().style.left).toBe('300px');

      frameTooltipRenderer.show(event, frameAnchor(rect, 0, 500));

      expect(tooltipEl().style.left).toBe('400px');
    });

    it('should keep the panel over the frame it belongs to', () => {
      const rect = { x: 100, y: 500, width: 600, height: 20 };

      // Cursor at the frame's right edge: the panel stops at the edge, not past it.
      showSettled(createEvent(0, 100), frameAnchor(rect, 0, 700));

      expect(tooltipEl().style.left).toBe('500px');
    });

    it('should place a frame the same way however far the last one was', () => {
      const element = tooltipEl();
      // An absolutely positioned panel is capped at `containerWidth - left`, so a stale `left`
      // would make it measure narrower and wrap taller. Stand in for that here.
      Object.defineProperty(element, 'offsetHeight', {
        configurable: true,
        get: () => (parseInt(element.style.left, 10) > 0 ? 300 : 100),
      });
      const rect = { x: 20, y: 500, width: 4, height: 20 };

      showSettled(createEvent(0, 100), frameAnchor(rect));
      const settledTop = element.style.top;

      // Step to a frame at the far right, then back to the first one.
      frameTooltipRenderer.show(createEvent(200, 100), frameAnchor({ ...rect, x: 900 }));
      frameTooltipRenderer.show(createEvent(0, 100), frameAnchor(rect));

      expect(element.style.top).toBe(settledTop);
    });

    it('should never place the panel over the minimap or metric strip', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 60, width: 100, height: 20 }, 40));

      expect(parseInt(tooltipEl().style.top, 10)).toBeGreaterThanOrEqual(40);
    });

    it('should keep the panel inside the container', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 960, y: 500, width: 40, height: 20 }));

      const left = parseInt(tooltipEl().style.left, 10);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 200).toBeLessThanOrEqual(1000);
    });

    it('should place below and right of the cursor when there is no frame rect', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().style.left).toBe('110px');
      expect(tooltipEl().style.top).toBe('110px');
    });

    it('should use a custom cursor offset', () => {
      frameTooltipRenderer.destroy();
      frameTooltipRenderer = new FrameTooltipRenderer(container, {
        categoryColors: {},
        cursorOffset: 20,
      });
      sizeTooltip(200, 100);

      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().style.left).toBe('120px');
      expect(tooltipEl().style.top).toBe('120px');
    });

    it('should flip to the other side of the cursor near the right and bottom edges', () => {
      showSettled(createEvent(0, 100), cursorAnchor(950, 550));

      // Flipped: 950 - 200 - 10, and 550 - 100 - 10.
      expect(tooltipEl().style.left).toBe('740px');
      expect(tooltipEl().style.top).toBe('440px');
    });

    it('should clamp negative cursor coordinates to the container', () => {
      showSettled(createEvent(0, 100), cursorAnchor(-100, -100));

      expect(parseInt(tooltipEl().style.left, 10)).toBeGreaterThanOrEqual(0);
      expect(parseInt(tooltipEl().style.top, 10)).toBeGreaterThanOrEqual(0);
    });

    it('should clamp cursor coordinates beyond the container', () => {
      showSettled(createEvent(0, 100), cursorAnchor(2000, 2000));

      expect(parseInt(tooltipEl().style.left, 10)).toBeLessThanOrEqual(800);
      expect(parseInt(tooltipEl().style.top, 10)).toBeLessThanOrEqual(500);
    });
  });

  describe('cleanup', () => {
    it('should remove tooltip element on destroy', () => {
      expect(tooltipEl()).not.toBeNull();

      frameTooltipRenderer.destroy();

      expect(container.querySelector('#timeline-tooltip')).toBeNull();
    });

    it('should handle destroy after show', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      frameTooltipRenderer.destroy();

      expect(container.querySelector('#timeline-tooltip')).toBeNull();
    });

    it('should drop a pending show on destroy', () => {
      frameTooltipRenderer.show(createEvent(0, 100), cursorAnchor(100, 100));

      frameTooltipRenderer.destroy();

      expect(() => jest.advanceTimersByTime(SHOW_DELAY_MS)).not.toThrow();
    });

    it('should handle multiple destroy calls safely', () => {
      frameTooltipRenderer.destroy();

      expect(() => frameTooltipRenderer.destroy()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle event with minimal data', () => {
      const event = {
        timestamp: 0,
        category: 'Apex',
        children: [],
        isParent: true,
        text: 'Minimal event',
        duration: { total: 100, self: 100 },
        exitStamp: 100,
        dmlCount: { total: 0, self: 0 },
        dmlRowCount: { total: 0, self: 0 },
        soqlCount: { total: 0, self: 0 },
        soqlRowCount: { total: 0, self: 0 },
        soslCount: { total: 0, self: 0 },
        soslRowCount: { total: 0, self: 0 },
        thrownCount: { total: 0, self: 0 },
        heapAllocated: { total: 0, self: 0 },
      } as unknown as LogEvent;

      showSettled(event, cursorAnchor(100, 100));

      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should handle zero duration', () => {
      showSettled(createEvent(0, 0), cursorAnchor(100, 100));

      // Just check the tooltip displays - no duration shown for 0
      expect(tooltipEl().dataset.visible).toBe('true');
    });

    it('should handle very large durations', () => {
      // 1 second = 1,000,000,000 ns
      showSettled(createEvent(0, 1_000_000_000), cursorAnchor(100, 100));

      // Should show duration in seconds or milliseconds
      expect(tooltipEl().textContent).toMatch(/\d+\s*(s|ms)/);
    });
  });
});
