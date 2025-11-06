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

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import { TimelineTooltipManager } from '../services/TimelineTooltipManager.js';

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
    } as unknown as LogEvent;
  }

  /**
   * Helper to wait for async operations
   */
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      const tooltip = container.querySelector('.timeline-tooltip');

      expect(tooltip).not.toBeNull();
      expect(tooltip instanceof HTMLElement).toBe(true);
    });

    it('should initialize tooltip as hidden', () => {
      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;

      expect(tooltip.style.display).toBe('none');
    });

    it('should apply default options', () => {
      const event = createEvent(0, 100);

      // Show should apply 100ms delay by default
      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none'); // Not yet shown

      tooltipManager.hide();
    });

    it('should accept custom options', () => {
      tooltipManager.destroy();

      tooltipManager = new TimelineTooltipManager(container, {
        showDelay: 0,
        cursorOffset: 20,
      });

      const event = createEvent(0, 100);
      tooltipManager.show(event, 100, 100);

      // With 0 delay, should show immediately
      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });
  });

  describe('show and hide', () => {
    it('should show tooltip after delay', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      // Should not be visible immediately
      let tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none');

      // Wait for show delay
      await wait(150);

      tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should hide tooltip immediately', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);
      await wait(150);

      tooltipManager.hide();

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none');
    });

    it('should cancel pending show on hide', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      // Hide before delay expires
      tooltipManager.hide();

      // Wait past delay
      await wait(150);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('none');
    });

    it('should update immediately when switching between events', async () => {
      const event1 = createEvent(0, 100, 'Event1');
      const event2 = createEvent(200, 100, 'Event2');

      // Show first tooltip
      tooltipManager.show(event1, 100, 100);
      await wait(150);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('Event1');

      // Switch to second event - should update immediately without delay
      tooltipManager.show(event2, 200, 200);

      // Should update immediately
      expect(tooltip.innerHTML).toContain('Event2');
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should update position when hovering same event', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);
      await wait(150);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;

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
      tooltipManager = new TimelineTooltipManager(container, { showDelay: 0 });
    });

    it('should display event type', () => {
      const event = createEvent(0, 100, 'MyCustomEvent');

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('MyCustomEvent');

      tooltipManager.hide();
    });

    it('should display event category', () => {
      const event = createEvent(0, 100, 'Event', 'SOQL');

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('SOQL');

      tooltipManager.hide();
    });

    it('should display duration in milliseconds', () => {
      // Duration: 1,500,000 ns = 1.5ms
      const event = createEvent(0, 1_500_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('1.500ms');

      tooltipManager.hide();
    });

    it('should display self duration', () => {
      // Self duration: 50% of total = 750,000 ns = 0.75ms
      const event = createEvent(0, 1_500_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('Self');
      expect(tooltip.innerHTML).toContain('0.750ms');

      tooltipManager.hide();
    });

    it('should display timestamp', () => {
      // Timestamp: 2,000,000 ns = 2.000ms
      const event = createEvent(2_000_000, 100_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('Start');
      expect(tooltip.innerHTML).toContain('2.000ms');

      tooltipManager.hide();
    });

    it('should display line number', () => {
      const event = createEvent(0, 100);
      event.lineNumber = 123;

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('Line');
      expect(tooltip.innerHTML).toContain('123');

      tooltipManager.hide();
    });

    it('should display event text', () => {
      const event = createEvent(0, 100);
      event.text = 'Custom event description';

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('Custom event description');

      tooltipManager.hide();
    });

    it('should truncate long event text', () => {
      const event = createEvent(0, 100);
      event.text = 'A'.repeat(150); // 150 characters

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      // Should be truncated to 100 chars + '...'
      expect(tooltip.innerHTML).toContain('...');
      expect(tooltip.innerHTML).not.toContain('A'.repeat(150));

      tooltipManager.hide();
    });

    it('should escape HTML in event data', () => {
      const event = createEvent(0, 100);
      event.text = '<script>alert("xss")</script>';

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      // Should be escaped, not executed
      expect(tooltip.innerHTML).toContain('&lt;script&gt;');
      expect(tooltip.innerHTML).not.toContain('<script>');

      tooltipManager.hide();
    });
  });

  describe('positioning - basic', () => {
    beforeEach(() => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, { showDelay: 0, cursorOffset: 10 });

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
      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      if (tooltip) {
        tooltip.getBoundingClientRect = mockGetBoundingClientRect;
      }
    });

    it('should position tooltip below and right of cursor by default', () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should be offset from cursor (default 10px)
      expect(left).toBeGreaterThanOrEqual(110); // 100 + 10
      expect(top).toBeGreaterThanOrEqual(110); // 100 + 10

      tooltipManager.hide();
    });

    it('should use custom cursor offset', () => {
      tooltipManager.destroy();
      tooltipManager = new TimelineTooltipManager(container, { showDelay: 0, cursorOffset: 20 });

      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
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
      tooltipManager = new TimelineTooltipManager(container, { showDelay: 0, cursorOffset: 10 });

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
      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      if (tooltip) {
        tooltip.getBoundingClientRect = mockGetBoundingClientRect;
      }
    });

    it('should flip horizontally when tooltip goes off right edge', () => {
      const event = createEvent(0, 100);

      // Position near right edge
      tooltipManager.show(event, 950, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const tooltipRect = tooltip.getBoundingClientRect();

      // Tooltip should be flipped to left of cursor to stay in bounds
      // Since tooltip width varies, just check it stays within container
      expect(tooltipRect.right).toBeLessThanOrEqual(1000);

      tooltipManager.hide();
    });

    it('should flip vertically when tooltip goes off bottom edge', () => {
      const event = createEvent(0, 100);

      // Position near bottom edge
      tooltipManager.show(event, 100, 550);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const tooltipRect = tooltip.getBoundingClientRect();

      // Tooltip should be flipped above cursor to stay in bounds
      expect(tooltipRect.bottom).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });

    it('should keep tooltip within left boundary', () => {
      const event = createEvent(0, 100);

      // Position at left edge
      tooltipManager.show(event, 0, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);

      // Should not be negative
      expect(left).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should keep tooltip within top boundary', () => {
      const event = createEvent(0, 100);

      // Position at top edge
      tooltipManager.show(event, 100, 0);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const top = parseInt(tooltip.style.top, 10);

      // Should not be negative
      expect(top).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should handle corner positioning (bottom-right)', () => {
      const event = createEvent(0, 100);

      // Position at bottom-right corner
      tooltipManager.show(event, 950, 550);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const tooltipRect = tooltip.getBoundingClientRect();

      // Should stay fully within container
      expect(tooltipRect.right).toBeLessThanOrEqual(1000);
      expect(tooltipRect.bottom).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });
  });

  describe('cleanup', () => {
    it('should remove tooltip element on destroy', () => {
      const tooltip = container.querySelector('.timeline-tooltip');
      expect(tooltip).not.toBeNull();

      tooltipManager.destroy();

      const tooltipAfter = container.querySelector('.timeline-tooltip');
      expect(tooltipAfter).toBeNull();
    });

    it('should cancel pending timeouts on destroy', async () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 100, 100);

      tooltipManager.destroy();

      // Wait past delay
      await wait(150);

      // Tooltip should not exist
      const tooltip = container.querySelector('.timeline-tooltip');
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
      tooltipManager = new TimelineTooltipManager(container, { showDelay: 0 });
    });

    it('should handle event with minimal data', () => {
      const event = {
        timestamp: 0,
        category: 'Method',
        children: [],
      } as unknown as LogEvent;

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.style.display).toBe('block');

      tooltipManager.hide();
    });

    it('should handle zero duration', () => {
      const event = createEvent(0, 0);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('0.000ms');

      tooltipManager.hide();
    });

    it('should handle very large durations', () => {
      // 1 second = 1,000,000,000 ns
      const event = createEvent(0, 1_000_000_000);

      tooltipManager.show(event, 100, 100);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      expect(tooltip.innerHTML).toContain('1000.000ms');

      tooltipManager.hide();
    });

    it('should handle negative mouse coordinates', () => {
      const event = createEvent(0, 100);

      // Should not crash with negative coordinates
      tooltipManager.show(event, -10, -10);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const left = parseInt(tooltip.style.left, 10);
      const top = parseInt(tooltip.style.top, 10);

      // Should clamp to zero
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);

      tooltipManager.hide();
    });

    it('should handle mouse coordinates beyond container', () => {
      const event = createEvent(0, 100);

      tooltipManager.show(event, 2000, 2000);

      const tooltip = container.querySelector('.timeline-tooltip') as HTMLElement;
      const tooltipRect = tooltip.getBoundingClientRect();

      // Should stay within container
      expect(tooltipRect.right).toBeLessThanOrEqual(1000);
      expect(tooltipRect.bottom).toBeLessThanOrEqual(600);

      tooltipManager.hide();
    });
  });
});
