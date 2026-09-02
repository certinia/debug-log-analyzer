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
import type { ApexLog, LogEvent } from 'apex-log-parser';

import {
  FrameTooltipRenderer,
  type TooltipAnchor,
  type TooltipOptions,
} from '../optimised/FrameTooltipRenderer.js';
import type { TimelineMarker } from '../types/flamechart.types.js';

/** Delay before the first tooltip appears; mirrors SHOW_DELAY_MS. */
const SHOW_DELAY_MS = 60;
/** Grace period before hiding; mirrors HIDE_GRACE_MS. */
const HIDE_GRACE_MS = 30;

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
      heapGross: { total: 0, self: 0 },
      heapPeak: 0,
      namespace: '',
    } as unknown as LogEvent;
  }

  /** A log for the branch shares to divide by. */
  function logOf(over: Record<string, unknown> = {}): ApexLog {
    return {
      startTime: null,
      timestamp: 0,
      duration: { total: 15_000_000, self: 0 },
      soqlCount: { total: 0, self: 0 },
      soqlRowCount: { total: 0, self: 0 },
      dmlCount: { total: 0, self: 0 },
      dmlRowCount: { total: 0, self: 0 },
      soslCount: { total: 0, self: 0 },
      soslRowCount: { total: 0, self: 0 },
      thrownCount: { total: 0, self: 0 },
      heapAllocated: { total: 0, self: 0 },
      heapGross: { total: 0, self: 0 },
      heapPeak: 0,
      ...over,
    } as unknown as ApexLog;
  }

  /** Replaces the renderer, so a test can state only the option it cares about. */
  function rebuild(options: Partial<TooltipOptions> = {}): void {
    frameTooltipRenderer.destroy();
    frameTooltipRenderer = new FrameTooltipRenderer(container, {
      categoryColors: {},
      cursorOffset: 10,
      ...options,
    });
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

  /** The reading in the row with this label, or undefined when there is no such row. */
  function rowValue(label: string): string | undefined {
    return row(label)?.querySelector('.tooltip-value')?.textContent ?? undefined;
  }

  /** The frame's own reading in the row with this label. */
  function rowSelf(label: string): string | undefined {
    return row(label)?.querySelector('.tooltip-self')?.textContent ?? undefined;
  }

  function row(label: string): Element | undefined {
    return [...container.querySelectorAll('.tooltip-row')].find(
      (candidate) => candidate.querySelector('.tooltip-label')?.textContent === label,
    );
  }

  /** The `·`-joined identity line. */
  function identity(): string | undefined {
    return container.querySelector('.tooltip-identity')?.textContent ?? undefined;
  }

  function tooltipEl(): HTMLElement {
    return container.querySelector('#timeline-tooltip') as HTMLElement;
  }

  /** Where the panel sits, read back from the transform that moves it. */
  function placement(): { left: number; top: number } {
    const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(tooltipEl().style.transform);
    return { left: Number(match?.[1]), top: Number(match?.[2]) };
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

      jest.advanceTimersByTime(SHOW_DELAY_MS - 20);
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
      jest.advanceTimersByTime(HIDE_GRACE_MS - 10);
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
      const initialLeft = placement().left;

      // Same frame, panned left.
      frameTooltipRenderer.show(event, frameAnchor({ x: 100, y: 400, width: 100, height: 20 }));

      expect(placement().left).not.toBe(initialLeft);
    });

    it('should hold its place while the context menu is open', () => {
      const event = createEvent(0, 100);
      const anchor = frameAnchor({ x: 300, y: 400, width: 400, height: 20 });
      sizeTooltip(200, 100);

      showSettled(event, anchor);
      const initialLeft = placement().left;

      frameTooltipRenderer.show(event, { ...anchor, cursorX: 600 }, { keepPosition: true });

      expect(placement().left).toBe(initialLeft);
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

    it("should lead with the duration and the frame's own share of it", () => {
      // Timestamp: 2,000,000 ns = 2.000ms, duration: 100,000 ns = 0.1ms, self 50%.
      showSettled(createEvent(2_000_000, 100_000), cursorAnchor(100, 100));

      expect(rowValue('Time')).toBe('0.1 ms');
      expect(rowSelf('Time')).toBe('self 0.05 ms');
    });

    it('should display a Throws row with the total (no self) when exceptions were thrown', () => {
      const event = createEvent(0, 1_500_000);
      event.thrownCount = { total: 3, self: 1 };

      showSettled(event, cursorAnchor(100, 100));

      expect(rowValue('Throws')).toBe('3');
      // self is intentionally omitted for throws (always 0 on a method).
      expect(tooltipEl().textContent).not.toContain('self 1');
    });

    it('should not display a Throws row when no exceptions were thrown', () => {
      const event = createEvent(0, 1_500_000);
      event.thrownCount = { total: 0, self: 0 };

      showSettled(event, cursorAnchor(100, 100));

      expect(rowValue('Throws')).toBeUndefined();
    });

    /**
     * The card measures a branch against the log, never against a governor limit: a
     * denominator here would be the transaction's fact rather than the frame's, and it
     * would read as governor pressure when it is not.
     */
    it("should read the branch against the log's own figure, not a governor limit", () => {
      rebuild({ apexLog: logOf({ soslRowCount: { total: 1000, self: 1000 } }) });
      const event = createEvent(0, 1_500_000, 'SOSL_EXECUTE_BEGIN');
      event.soslRowCount = { total: 500, self: 500 };

      showSettled(event, cursorAnchor(100, 100));

      expect(rowValue('SOSL Rows')).toBe('500 of 1,000');
      expect(rowSelf('SOSL Rows')).toBe('self 500');
    });

    /** Spelled on every row: with no header line the figure has to name itself. */
    it('should name the self reading on every row', () => {
      const event = createEvent(0, 1_500_000);
      event.soqlCount = { total: 3, self: 1 };
      event.dmlCount = { total: 2, self: 0 };

      showSettled(event, cursorAnchor(100, 100));

      expect(rowSelf('SOQL')).toBe('self 1');
      expect(rowSelf('DML')).toBe('self 0');
    });

    it("should read net heap compactly, with the method's own share", () => {
      const event = createEvent(0, 1_500_000);
      event.heapAllocated = { self: 1_572_864, total: 4_000_000 };

      showSettled(event, cursorAnchor(100, 100));

      // Net subtree total and the method's own net. The card is width-bound, so bytes
      // read compactly here where the inspector separates thousands.
      expect(rowValue('Heap net')).toBe('4 MB');
      expect(rowSelf('Heap net')).toBe('self 1.6 MB');
    });

    it('should not display a heap row when net heap is 0 (allocated then freed)', () => {
      const event = createEvent(0, 1_500_000);
      event.heapAllocated = { self: 0, total: 0 };

      showSettled(event, cursorAnchor(100, 100));

      expect(rowValue('Heap net')).toBeUndefined();
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

    it('should name the category on the identity line and paint the rail with it', () => {
      rebuild({ categoryColors: { Apex: '#88ae58' } });

      showSettled(createEvent(0, 100, 'Event', 'Apex'), cursorAnchor(100, 100));

      expect(identity()).toBe('Apex · Event · from line 42');
      const body = container.querySelector<HTMLElement>('.timeline-tooltip');
      expect(body?.style.borderColor).toBe('rgb(136, 174, 88)');
    });

    it('should leave the category off the identity line for an uncategorised event', () => {
      showSettled(createEvent(0, 100, 'Event', ''), cursorAnchor(100, 100));

      expect(identity()).toBe('Event · from line 42');
    });

    it('should name the namespace only where it is not the default', () => {
      const event = createEvent(0, 100, 'Event', 'Apex');
      event.namespace = 'acme';

      showSettled(event, cursorAnchor(100, 100));

      expect(identity()).toBe('Apex · Event · acme · from line 42');
    });

    it('should display wall-clock time row when apexLog has startTime', () => {
      // 10:29:24.600 at the first event, whose nanosecond offset is 6329577.
      rebuild({ apexLog: logOf({ startTime: 37_764_600, timestamp: 6_329_577 }) });

      // Event at timestamp 6329577ns with duration 1,000,000ns
      showSettled(createEvent(6329577, 1_000_000), cursorAnchor(100, 100));

      expect(rowValue('Wall clock')).toBe('10:29:24.600 → 10:29:24.601');
      // A clock range is wider than the figure columns, so a row inside them would run
      // off the panel's edge.
      const clock = row('Wall clock');
      expect(clock?.classList.contains('tooltip-row--wide')).toBe(true);
      expect(clock?.querySelector('.tooltip-self')).toBeNull();
    });

    it('should not display wall-clock time row when apexLog has no startTime', () => {
      rebuild({ apexLog: logOf() });

      showSettled(createEvent(0, 1_000_000), cursorAnchor(100, 100));

      expect(rowValue('Wall clock')).toBeUndefined();
    });

    it('should not display wall-clock time row when no apexLog', () => {
      showSettled(createEvent(0, 1_000_000), cursorAnchor(100, 100));

      expect(rowValue('Wall clock')).toBeUndefined();
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

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      expect(preview).not.toBeNull();

      const lines = preview.textContent?.split('\n') ?? [];
      expect(lines.length).toBeLessThanOrEqual(6);
      expect(lines[0]).toBe('SELECT Id');
      expect(lines[1]).toBe('FROM Account');
      expect(lines[lines.length - 1]).toMatch(/… \+\d+ conditions$/);
    });

    it('should leave a query that fits on one line whole', () => {
      showSettled(soqlEvent('SELECT Id FROM Account'), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      expect(preview.textContent).toBe('SELECT Id FROM Account');
      // Nothing was cut, so the card says nothing at its foot.
      expect(container.querySelector('.tooltip-status')).toBeNull();
    });

    it('should keep the WHERE clause however long the field list is', () => {
      const fields = Array.from({ length: 60 }, (_unused, index) => `Field${index}__c`).join(', ');
      showSettled(
        soqlEvent(`SELECT ${fields} FROM Account WHERE Name = 'x'`),
        cursorAnchor(100, 100),
      );

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      const lines = preview.textContent?.split('\n') ?? [];
      expect(lines[0]).toMatch(/^SELECT .*\+\d+ fields$/);
      expect(lines).toContain(`WHERE Name = 'x'`);
    });

    it('should show a single ellipsised line for a query too large to format', () => {
      const huge = `SELECT Id FROM Account WHERE Id IN ('${'0'.repeat(5000)}')`;

      showSettled(soqlEvent(huge), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      expect(preview.classList.contains('is-clamped')).toBe(true);
      expect(preview.textContent).not.toContain('\n');
      expect(preview.textContent?.length).toBe(160);

      expect(container.querySelector('.tooltip-status')?.textContent).toBe(
        'query too large to format',
      );
    });

    it('should highlight the query with soql token classes', () => {
      showSettled(soqlEvent('SELECT Id FROM Account'), cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      expect(preview.querySelector('span[class^="soql-tok"]')).not.toBeNull();
    });

    it('should build the preview once per event', () => {
      const event = soqlEvent('SELECT Id FROM Account');

      showSettled(event, cursorAnchor(100, 100));
      frameTooltipRenderer.hideImmediate();

      // A rebuild would pick this up; the memoised block does not.
      event.text = 'SELECT Name FROM Contact';
      showSettled(event, cursorAnchor(100, 100));

      const preview = container.querySelector('.tooltip-description.soql-block') as HTMLElement;
      expect(preview.textContent).toContain('Account');
    });
  });

  describe('anchoring', () => {
    beforeEach(() => {
      sizeTooltip(200, 100);
    });

    it('should pin the panel above the frame band', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 500, width: 100, height: 20 }));

      // Centred on the cursor, which sits at the frame's left edge here: 300 - 200 / 2.
      expect(placement().left).toBe(200);
      // Above the frame, with the 3px gap: 500 - 3 - 100.
      expect(placement().top).toBe(397);
    });

    it('should flip below the frame when there is no room above', () => {
      // Only 50px between the chart top and the frame, so the panel cannot fit above.
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 90, width: 100, height: 20 }, 40));

      // Below the frame, with the 3px gap: 90 + 20 + 3.
      expect(placement().top).toBe(113);
    });

    it('should keep the side it flipped to while the frame moves under the pointer', () => {
      const event = createEvent(0, 100);
      // Room above is 3px short of the panel, so the first placement flips below.
      const rect = { x: 300, y: 100, width: 400, height: 20 };

      showSettled(event, frameAnchor(rect, 0));
      expect(placement().top).toBe(123);

      // A pan moves the frame sideways, which does not change the vertical fit, so the panel
      // must not flip back.
      frameTooltipRenderer.show(event, frameAnchor({ ...rect, x: 200 }, 0));

      expect(placement().top).toBe(123);
    });

    it('should centre on the cursor rather than on the frame', () => {
      showSettled(
        createEvent(0, 100),
        frameAnchor({ x: 100, y: 500, width: 600, height: 20 }, 0, 400),
      );

      // Centred on the cursor: 400 - 200 / 2.
      expect(placement().left).toBe(300);
    });

    it('should follow the pointer as it moves within one frame', () => {
      const event = createEvent(0, 100);
      const rect = { x: 100, y: 500, width: 600, height: 20 };

      showSettled(event, frameAnchor(rect, 0, 200));
      expect(placement().left).toBe(100);

      frameTooltipRenderer.show(event, frameAnchor(rect, 0, 650));

      expect(placement().left).toBe(550);
    });

    it('should not measure the panel again for a pointer move within one frame', () => {
      const element = tooltipEl();
      const event = createEvent(0, 100);
      const rect = { x: 100, y: 500, width: 600, height: 20 };
      showSettled(event, frameAnchor(rect, 0, 200));

      const measured = jest.fn(() => 100);
      Object.defineProperty(element, 'offsetHeight', { configurable: true, get: measured });

      // Same content: the panel re-places to follow the cursor, but its size still holds.
      frameTooltipRenderer.show(event, frameAnchor(rect, 0, 650));
      expect(measured).not.toHaveBeenCalled();

      // New content is a new height, so the panel is measured again.
      frameTooltipRenderer.show(createEvent(200, 100), frameAnchor(rect, 0, 650));
      expect(measured).toHaveBeenCalled();
    });

    it('should never place the panel over the minimap or metric strip', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 300, y: 60, width: 100, height: 20 }, 40));

      expect(placement().top).toBeGreaterThanOrEqual(40);
    });

    it('should keep the panel inside the container', () => {
      showSettled(createEvent(0, 100), frameAnchor({ x: 960, y: 500, width: 40, height: 20 }));

      const left = placement().left;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 200).toBeLessThanOrEqual(1000);
    });

    it('should keep the panel inside a container narrower than itself', () => {
      container.getBoundingClientRect = () =>
        ({ width: 150, height: 600, top: 0, left: 0, right: 150, bottom: 600 }) as DOMRect;

      showSettled(createEvent(0, 100), frameAnchor({ x: 20, y: 500, width: 40, height: 20 }));

      expect(placement().left).toBe(0);
    });

    it('should place below and right of the cursor when there is no frame rect', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(placement()).toEqual({ left: 110, top: 110 });
    });

    it('should use a custom cursor offset', () => {
      rebuild({ cursorOffset: 20 });
      sizeTooltip(200, 100);

      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(placement()).toEqual({ left: 120, top: 120 });
    });

    it('should flip to the other side of the cursor near the right and bottom edges', () => {
      showSettled(createEvent(0, 100), cursorAnchor(950, 550));

      // Flipped: 950 - 200 - 10, and 550 - 100 - 10.
      expect(placement()).toEqual({ left: 740, top: 440 });
    });

    it('should clamp negative cursor coordinates to the container', () => {
      showSettled(createEvent(0, 100), cursorAnchor(-100, -100));

      expect(placement().left).toBeGreaterThanOrEqual(0);
      expect(placement().top).toBeGreaterThanOrEqual(0);
    });

    it('should clamp cursor coordinates beyond the container', () => {
      showSettled(createEvent(0, 100), cursorAnchor(2000, 2000));

      expect(placement().left).toBeLessThanOrEqual(800);
      expect(placement().top).toBeLessThanOrEqual(500);
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
        isParent: true,
        timestamp: 0,
        text: 'Minimal event',
        duration: { total: 0, self: 0 },
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
  describe('the group rule', () => {
    it('rules the first group, parting the identity from the readings', () => {
      showSettled(createEvent(0, 100), cursorAnchor(100, 100));

      expect(tooltipEl().querySelectorAll('.tooltip-group--ruled')).toHaveLength(1);
    });

    // A marker card has no identity line, so the rule would part nothing.
    it('leaves a marker card unruled, though it still groups', () => {
      frameTooltipRenderer.showTruncation(
        {
          id: 'm1',
          type: 'exception',
          summary: 'System.NullPointerException',
          startTime: 1_000_000,
          endTime: 3_000_000,
        } as TimelineMarker,
        cursorAnchor(100, 100),
      );
      jest.advanceTimersByTime(SHOW_DELAY_MS);

      const panel = tooltipEl();
      expect(panel.querySelectorAll('.tooltip-group')).toHaveLength(1);
      expect(panel.querySelectorAll('.tooltip-group--ruled')).toHaveLength(0);
    });
  });
});
