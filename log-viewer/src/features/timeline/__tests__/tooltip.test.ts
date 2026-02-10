/**
 * @jest-environment jsdom
 */

/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TimelineTooltipManager
 *
 * Tests tooltip positioning and content generation including:
 * - Boundary detection and auto-positioning
 * - Tooltip flip logic when near edges
 * - Content generation from event data
 * - Show/hide timing and debouncing
 */

import type { LogEvent } from 'apex-log-parser';
import { TimelineTooltipManager } from '../optimised/TimelineTooltipManager.js';

describe('TimelineTooltipManager', () => {
  let container: HTMLElement;
  let tooltipManager: TimelineTooltipManager;

  /**
   * Helper to create a mock LogEvent
   */
  function createEvent(
    timestamp: number,
    duration: number,
    type: string = 'TestEvent',
    subCategory: string = 'Method',
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
      subCategory,
      text: `Event at ${timestamp}`,
      lineNumber: 42,
      category: 'Method',
      children: [],
      isParent: true, // Required for tooltip to show
      dmlCount: { total: 0, self: 0 },
      dmlRowCount: { total: 0, self: 0 },
      soqlCount: { total: 0, self: 0 },
      soqlRowCount: { total: 0, self: 0 },
      soslCount: { total: 0, self: 0 },
      soslRowCount: { total: 0, self: 0 },
    } as unknown as LogEvent;
  }

  beforeEach(() => {
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

    tooltipManager = new TimelineTooltipManager(container);
  });

  afterEach(() => {
    tooltipManager.destroy();
    document.body.removeChild(container);
  });

  describe('initialization', () => {
    it('should create tooltip element in container', () => {
      const tooltip = container.querySelector('#timeline-tooltip');

      expect(tooltip).not.toBeNull();
      expect(tooltip instanceof HTMLElement).toBe(true);
    });

    it('should initialize tooltip as hidden', () => {
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;

      expect(tooltip.style.display).toBe('');
    });

    it('should apply default options', () => {
      const event = createEvent(0, 100);

      // Show immediately with new implementation
      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block'); // Shown immediately

      tooltipManager.hide();
    });

    it('should accept custom options', () => {
      tooltipManager.destroy();

      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: { Method: '#88ae58' },
        cursorOffset: 20,
        enableFlip: true,
      });

      const event = createEvent(0, 100);
      tooltipManager.show(event, 100, 100);

      // With 0 delay, should show immediately
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });
  });

  describe('show and hide', () => {
    it('should show tooltip immediately', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      // Should be visible immediately with new implementation
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should hide tooltip immediately', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      tooltipManager.hide();

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none');
    });

    it('should update immediately when switching between events', async () => {
      const event1 = createEvent(0, 100, 'Event1');
      event1.text = 'Event1';
      const event2 = createEvent(200, 100, 'Event2');
      event2.text = 'Event2';

      // Show first tooltip
      tooltipManager.show(event1, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('Event1');

      // Switch to second event - should update immediately without delay
      tooltipManager.show(event2, 200, 200);

      // Should update immediately
      expect(tooltip.textContent).toContain('Event2');
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should update position when hovering same event', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;

      // Mock getBoundingClientRect to provide realistic dimensions in jsdom
      tooltip.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: 0,
          right: 200,
          bottom: 100,
        }) as DOMRect;

      const initialLeft = tooltip.style.left;

      // Move mouse while on same event
      tooltipManager.show(event, 200, 100);

      const newLeft = tooltip.style.left;
      expect(newLeft).not.toBe(initialLeft);

      tooltipManager.hide();
    });
  });

  describe('content generation', () => {
    beforeEach(() => {
      tooltipManager.destroy();
      // Use zero delay for content tests
      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: {},
        cursorOffset: 10,
        enableFlip: true,
      });
    });

    it('should display event type', () => {
      const event = createEvent(0, 100, 'MyCustomEvent');

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('MyCustomEvent');

      tooltipManager.hide();
    });

    it('should display event text', () => {
      const event = createEvent(0, 100, 'Event', 'SOQL');
      event.text = 'SOQL query execution';

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('SOQL query execution');

      tooltipManager.hide();
    });

    it('should display duration in milliseconds', () => {
      // Duration: 1,500,000 ns = 1.5ms
      const event = createEvent(0, 1_500_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // Duration is formatted by formatDuration helper
      expect(tooltip.textContent).toContain('ms');

      tooltipManager.hide();
    });

    it('should display self duration', () => {
      // Self duration: 50% of total = 750,000 ns = 0.75ms
      const event = createEvent(0, 1_500_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('self');
      expect(tooltip.textContent).toContain('0.75');

      tooltipManager.hide();
    });

    it('should display total duration', () => {
      // Timestamp: 2,000,000 ns = 2.000ms, duration: 100,000 ns = 0.1ms
      const event = createEvent(2_000_000, 100_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('total');
      // Check for some duration value (format may vary)
      expect(tooltip.textContent).toContain('ms');

      tooltipManager.hide();
    });

    it('should display event text', () => {
      const event = createEvent(0, 100);
      event.text = 'Custom event description';

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.textContent).toContain('Custom event description');

      tooltipManager.hide();
    });

    it('should handle long event text', () => {
      const event = createEvent(0, 100);
      event.text = 'A'.repeat(150); // 150 characters

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // Just check that tooltip shows - text handling may or may not truncate
      expect(tooltip.style.display).toBe('block');
      expect(tooltip.textContent).toContain('A');

      tooltipManager.hide();
    });

    it('should escape HTML in event data', () => {
      const event = createEvent(0, 100);
      event.text = '<script>alert("xss")</script>';

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // textContent shows text without HTML tags - script tags won't execute
      expect(tooltip.textContent).toContain('alert("xss")');
      // Check that no actual script element was created
      expect(tooltip.querySelector('script')).toBeNull();

      tooltipManager.hide();
    });
  });

  describe('positioning - basic', () => {
    beforeEach(() => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: {},
        cursorOffset: 10,
        enableFlip: true,
      });

      // Mock getBoundingClientRect to provide realistic dimensions in jsdom
      const mockGetBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: 0,
          right: 200,
          bottom: 100,
        }) as DOMRect;

      // Apply mock to tooltip element after it's created
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      if (tooltip) {
        tooltip.getBoundingClientRect = mockGetBoundingClientRect;
      }
    });

    it('should position tooltip below and right of cursor by default', () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should be offset from cursor (default 10px)
      expect(left).toBeGreaterThanOrEqual(110); // 100 + 10
      expect(top).toBeGreaterThanOrEqual(110); // 100 + 10

      tooltipManager.hide();
    });

    it('should use custom cursor offset', () => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: {},
        cursorOffset: 20,
        enableFlip: true,
      });

      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      expect(left).toBeGreaterThanOrEqual(120); // 100 + 20
      expect(top).toBeGreaterThanOrEqual(120); // 100 + 20

      tooltipManager.hide();
    });
  });

  describe('positioning - boundary detection', () => {
    beforeEach(() => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: {},
        cursorOffset: 10,
        enableFlip: true,
      });

      // Mock getBoundingClientRect to provide realistic dimensions in jsdom
      const mockGetBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: 0,
          right: 200,
          bottom: 100,
        }) as DOMRect;

      // Apply mock to tooltip element after it's created
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      if (tooltip) {
        tooltip.getBoundingClientRect = mockGetBoundingClientRect;
      }
    });

    it('should flip horizontally when tooltip goes off right edge', () => {
      const event = createEvent(0, 100);

      // Position near right edge
      tooltipManager.show(event, 950, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // Mock the tooltip dimensions
      tooltip.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: parseInt(tooltip.style.left || '0', 10),
          right: parseInt(tooltip.style.left || '0', 10) + 200,
          bottom: 100,
        }) as DOMRect;

      const left = parseInt(tooltip.style.left, 10);
      // Tooltip should be positioned to stay within container
      expect(left + 200).toBeLessThanOrEqual(1000);

      tooltipManager.hide();
    });

    it('should flip vertically when tooltip goes off bottom edge', () => {
      const event = createEvent(0, 100);

      // Position near bottom edge
      tooltipManager.show(event, 100, 550);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      tooltip.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: parseInt(tooltip.style.top || '0', 10),
          left: 0,
          right: 200,
          bottom: parseInt(tooltip.style.top || '0', 10) + 100,
        }) as DOMRect;

      const top = parseInt(tooltip.style.top, 10);
      // Tooltip should be positioned to stay within container
      expect(top + 100).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });

    it('should keep tooltip within left boundary', () => {
      const event = createEvent(0, 100);

      // Position at left edge
      tooltipManager.show(event, 0, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);

      // Should not be negative
      expect(left).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should keep tooltip within top boundary', () => {
      const event = createEvent(0, 100);

      // Position at top edge
      tooltipManager.show(event, 100, 0);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      const top = parseInt(tooltip.style.top, 10);

      // Should not be negative
      expect(top).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should handle corner positioning (bottom-right)', () => {
      const event = createEvent(0, 100);

      // Position at bottom-right corner
      tooltipManager.show(event, 950, 550);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      tooltip.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: parseInt(tooltip.style.top || '0', 10),
          left: parseInt(tooltip.style.left || '0', 10),
          right: parseInt(tooltip.style.left || '0', 10) + 200,
          bottom: parseInt(tooltip.style.top || '0', 10) + 100,
        }) as DOMRect;

      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should stay fully within container
      expect(left + 200).toBeLessThanOrEqual(1000);
      expect(top + 100).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });
  });

  describe('cleanup', () => {
    it('should remove tooltip element on destroy', () => {
      const tooltip = container.querySelector('#timeline-tooltip');
      expect(tooltip).not.toBeNull();

      tooltipManager.destroy();

      const tooltipAfter = container.querySelector('#timeline-tooltip');
      expect(tooltipAfter).toBeNull();
    });

    it('should handle destroy after show', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      tooltipManager.destroy();

      // Tooltip should not exist
      const tooltip = container.querySelector('#timeline-tooltip');
      expect(tooltip).toBeNull();
    });

    it('should handle multiple destroy calls safely', () => {
      tooltipManager.destroy();
      tooltipManager.destroy(); // Should not throw

      expect(true).toBe(true); // If we get here, no error was thrown
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, {
        categoryColors: {},
        cursorOffset: 10,
        enableFlip: true,
      });
    });

    it('should handle event with minimal data', () => {
      const event = {
        timestamp: 0,
        category: 'Method',
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
      } as unknown as LogEvent;

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should handle zero duration', () => {
      const event = createEvent(0, 0);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // Just check the tooltip displays - no duration shown for 0
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should handle very large durations', () => {
      // 1 second = 1,000,000,000 ns
      const event = createEvent(0, 1_000_000_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      // Should show duration in seconds or milliseconds
      expect(tooltip.textContent).toMatch(/\d+\s*(s|ms)/);

      tooltipManager.hide();
    });

    it('should handle negative mouse coordinates', () => {
      const event = createEvent(0, 100);

      // Should not crash with negative coordinates
      tooltipManager.show(event, -10, -10);

      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should clamp to zero
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should handle mouse coordinates beyond container', () => {
      const event = createEvent(0, 100);

      // Get tooltip and mock before showing
      const tooltip = container.querySelector('#timeline-tooltip') as HTMLElement;
      tooltip.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: 0,
          right: 200,
          bottom: 100,
        }) as DOMRect;

      tooltipManager.show(event, 2000, 2000);

      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should clamp to stay within container
      expect(left).toBeLessThanOrEqual(1000);
      expect(top).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });
  });
});
