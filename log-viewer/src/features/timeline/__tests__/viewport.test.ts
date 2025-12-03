/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

/**
 * Unit tests for TimelineViewport
 *
 * Tests viewport calculations including:
 * - Zoom level calculations and constraints
 * - Pan boundary calculations
 * - Coordinate transformations (Y-axis inversion)
 * - Window resize handling
 */

import { TimelineViewport } from '../optimised/TimelineViewport.js';
import { TIMELINE_CONSTANTS } from '../types/flamechart.types.js';

describe('TimelineViewport', () => {
  const DISPLAY_WIDTH = 1000;
  const DISPLAY_HEIGHT = 600;
  const TOTAL_DURATION = 1_000_000; // 1ms in nanoseconds
  const MAX_DEPTH = 10;

  let viewport: TimelineViewport;

  beforeEach(() => {
    viewport = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
  });

  describe('initialization', () => {
    it('should initialize with correct display dimensions', () => {
      const state = viewport.getState();

      expect(state.displayWidth).toBe(DISPLAY_WIDTH);
      expect(state.displayHeight).toBe(DISPLAY_HEIGHT);
    });

    it('should calculate default zoom to fit all events', () => {
      const state = viewport.getState();

      // Default zoom should fit totalDuration in displayWidth
      const expectedZoom = DISPLAY_WIDTH / TOTAL_DURATION;
      expect(state.zoom).toBe(expectedZoom);
    });

    it('should initialize with zero offsets', () => {
      const state = viewport.getState();

      expect(state.offsetX).toBe(0);
      expect(state.offsetY).toBe(0);
    });
  });

  describe('zoom calculations', () => {
    it('should update zoom level correctly', () => {
      const newZoom = 0.002;
      const changed = viewport.setZoom(newZoom);

      expect(changed).toBe(true);
      expect(viewport.getState().zoom).toBeCloseTo(newZoom, 10);
    });

    it('should clamp zoom to minimum (fit all events)', () => {
      const minZoom = DISPLAY_WIDTH / TOTAL_DURATION;
      const tooSmallZoom = minZoom * 0.5;

      viewport.setZoom(tooSmallZoom);

      expect(viewport.getState().zoom).toBeCloseTo(minZoom, 10);
    });

    it('should clamp zoom to maximum (0.001ms precision)', () => {
      const maxZoom = DISPLAY_WIDTH / TIMELINE_CONSTANTS.MAX_ZOOM_NS;
      const tooLargeZoom = maxZoom * 2;

      viewport.setZoom(tooLargeZoom);

      expect(viewport.getState().zoom).toBeCloseTo(maxZoom, 10);
    });

    it('should return false when zoom does not change', () => {
      const currentZoom = viewport.getState().zoom;
      const changed = viewport.setZoom(currentZoom);

      expect(changed).toBe(false);
    });

    it('should anchor zoom at center by default', () => {
      // Zoom in 2x
      const initialZoom = viewport.getState().zoom;
      const newZoom = initialZoom * 2;

      viewport.setZoom(newZoom);

      // Time at center should remain stable
      const state = viewport.getState();
      const centerX = DISPLAY_WIDTH / 2;
      const timeAtCenter = (centerX + state.offsetX) / state.zoom;

      // Should be approximately at the middle of the timeline
      const expectedTime = TOTAL_DURATION / 2;
      expect(timeAtCenter).toBeCloseTo(expectedTime, 0);
    });

    it('should anchor zoom at custom anchor point', () => {
      // Zoom in 2x at left edge
      const initialZoom = viewport.getState().zoom;
      const newZoom = initialZoom * 2;
      const anchorX = 100;

      viewport.setZoom(newZoom, anchorX);

      const state = viewport.getState();
      const timeAtAnchor = (anchorX + state.offsetX) / state.zoom;

      // Time at anchor should remain close to original
      const expectedTime = anchorX / initialZoom;
      expect(timeAtAnchor).toBeCloseTo(expectedTime, 0);
    });
  });

  describe('pan calculations', () => {
    beforeEach(() => {
      // Zoom in to enable panning
      const initialZoom = viewport.getState().zoom;
      viewport.setZoom(initialZoom * 3);
    });

    it('should update pan offsets correctly', () => {
      // Only X offset can be set when zoomed in (Y is clamped based on content height)
      const changed = viewport.setPan(100, 0);

      expect(changed).toBe(true);
      const state = viewport.getState();
      expect(state.offsetX).toBe(100);
      // Y offset stays at 0 if content fits in viewport
      expect(state.offsetY).toBeLessThanOrEqual(0);
    });

    it('should clamp horizontal pan to left boundary', () => {
      viewport.setPan(-100, 0);

      expect(viewport.getState().offsetX).toBe(0);
    });

    it('should clamp horizontal pan to right boundary', () => {
      const state = viewport.getState();
      const maxOffset = state.zoom * TOTAL_DURATION - DISPLAY_WIDTH;
      const tooLargeOffset = maxOffset + 100;

      viewport.setPan(tooLargeOffset, 0);

      expect(viewport.getState().offsetX).toBeCloseTo(maxOffset, 10);
    });

    it('should clamp vertical pan to top boundary', () => {
      viewport.setPan(0, 100);

      expect(viewport.getState().offsetY).toBe(0);
    });

    it('should clamp vertical pan to bottom boundary', () => {
      const realHeight = TIMELINE_CONSTANTS.EVENT_HEIGHT * MAX_DEPTH;
      const maxVertOffset = realHeight - DISPLAY_HEIGHT + DISPLAY_HEIGHT / 4;
      const minOffset = -Math.max(0, maxVertOffset);

      // Try to pan beyond minimum (further up)
      viewport.setPan(0, minOffset - 100);

      // Should clamp to minimum offset
      expect(viewport.getState().offsetY).toBeCloseTo(minOffset, 10);
    });

    it('should return false when pan does not change', () => {
      viewport.setPan(100, 0);
      const changed = viewport.setPan(100, 0);

      expect(changed).toBe(false);
    });

    it('should support relative pan with panBy', () => {
      viewport.setPan(100, 0);
      viewport.panBy(20, 0);

      const state = viewport.getState();
      expect(state.offsetX).toBe(120);
      expect(state.offsetY).toBeLessThanOrEqual(0);
    });
  });

  describe('viewport bounds calculations', () => {
    it('should calculate correct time bounds', () => {
      const bounds = viewport.getBounds();

      expect(bounds.timeStart).toBeCloseTo(0, 5);
      expect(bounds.timeEnd).toBeCloseTo(TOTAL_DURATION, 5);
    });

    it('should calculate correct depth bounds', () => {
      const bounds = viewport.getBounds();

      expect(bounds.depthStart).toBeCloseTo(0, 10);
      const expectedDepthEnd = Math.ceil(DISPLAY_HEIGHT / TIMELINE_CONSTANTS.EVENT_HEIGHT);
      expect(bounds.depthEnd).toBe(expectedDepthEnd);
    });

    it('should update bounds after zoom', () => {
      const initialBounds = viewport.getBounds();

      // Zoom in 2x
      const initialZoom = viewport.getState().zoom;
      viewport.setZoom(initialZoom * 2);

      const newBounds = viewport.getBounds();

      // Time range should be smaller
      const initialRange = initialBounds.timeEnd - initialBounds.timeStart;
      const newRange = newBounds.timeEnd - newBounds.timeStart;
      expect(newRange).toBeLessThan(initialRange);
    });

    it('should update bounds after pan', () => {
      // Zoom in to enable panning
      const initialZoom = viewport.getState().zoom;
      viewport.setZoom(initialZoom * 3);

      const initialBounds = viewport.getBounds();

      // Pan to the right (increase offsetX significantly)
      const state = viewport.getState();
      const maxOffsetX = state.zoom * TOTAL_DURATION - DISPLAY_WIDTH;
      const panAmount = maxOffsetX * 0.7; // Pan 70% to the right
      viewport.setPan(panAmount, 0);

      const newBounds = viewport.getBounds();

      // Time range should shift right
      expect(newBounds.timeStart).toBeGreaterThan(initialBounds.timeStart);
      expect(newBounds.timeEnd).toBeGreaterThan(initialBounds.timeEnd);
    });
  });

  describe('coordinate transformations', () => {
    it('should convert screen Y to depth level', () => {
      const screenY = DISPLAY_HEIGHT / 2;
      const depth = viewport.screenYToDepth(screenY);

      // Should be within reasonable range (may exceed MAX_DEPTH due to display height)
      expect(depth).toBeGreaterThanOrEqual(0);
      // Note: depth can exceed MAX_DEPTH if displayHeight is large
      expect(depth).toBeLessThan(100); // Reasonable upper limit
    });

    it('should convert depth level to screen Y', () => {
      const depth = 5;
      const screenY = viewport.depthToScreenY(depth);

      // Should be within display height
      expect(screenY).toBeGreaterThanOrEqual(0);
      expect(screenY).toBeLessThanOrEqual(DISPLAY_HEIGHT);
    });

    it('should have consistent Y coordinate round-trip conversion', () => {
      const originalDepth = 3;
      const screenY = viewport.depthToScreenY(originalDepth);
      const convertedDepth = viewport.screenYToDepth(screenY);

      expect(convertedDepth).toBe(originalDepth);
    });

    it('should invert Y-axis (depth 0 at bottom)', () => {
      // Depth 0 should be at bottom of screen
      const depth0Y = viewport.depthToScreenY(0);
      const depth1Y = viewport.depthToScreenY(1);

      // Higher depth should have lower Y coordinate (bottom-left origin)
      expect(depth1Y).toBeLessThan(depth0Y);
    });
  });

  describe('window resize handling', () => {
    it('should update display dimensions', () => {
      const newWidth = 1200;
      const newHeight = 800;

      viewport.resize(newWidth, newHeight);

      const state = viewport.getState();
      expect(state.displayWidth).toBe(newWidth);
      expect(state.displayHeight).toBe(newHeight);
    });

    it('should adjust zoom when resizing from minimum zoom', () => {
      // Start at minimum zoom (fit all events)
      const initialZoom = viewport.getState().zoom;

      const newWidth = 800;
      viewport.resize(newWidth, DISPLAY_HEIGHT);

      const newZoom = viewport.getState().zoom;
      const expectedZoom = newWidth / TOTAL_DURATION;

      // Should recalculate to still fit all events
      expect(newZoom).toBeCloseTo(expectedZoom, 10);
      expect(newZoom).not.toBe(initialZoom);
    });

    it('should preserve zoom level when not at minimum', () => {
      // Zoom in significantly (well above minimum)
      const initialZoom = viewport.getState().zoom;
      const targetZoom = initialZoom * 10;
      viewport.setZoom(targetZoom);

      // Resize to larger width
      viewport.resize(1200, DISPLAY_HEIGHT);

      const newZoom = viewport.getState().zoom;

      // Should stay at zoomed level (not reset to fit-all)
      // May be clamped to new valid range but should be close
      expect(newZoom).toBeGreaterThan(initialZoom);
    });

    it('should reclamp offsets after resize', () => {
      // Zoom in and pan to edge
      const initialZoom = viewport.getState().zoom;
      viewport.setZoom(initialZoom * 3);

      const state = viewport.getState();
      const maxOffset = state.zoom * TOTAL_DURATION - DISPLAY_WIDTH;
      viewport.setPan(maxOffset, 0);

      // Resize smaller
      viewport.resize(500, DISPLAY_HEIGHT);

      const newState = viewport.getState();
      const newMaxOffset = newState.zoom * TOTAL_DURATION - 500;

      // Should still be at right edge (clamped)
      expect(newState.offsetX).toBeCloseTo(newMaxOffset, 5);
    });

    it('should not trigger changes if dimensions are the same', () => {
      const stateBefore = viewport.getState();

      viewport.resize(DISPLAY_WIDTH, DISPLAY_HEIGHT);

      const stateAfter = viewport.getState();

      expect(stateAfter.zoom).toBe(stateBefore.zoom);
      expect(stateAfter.offsetX).toBe(stateBefore.offsetX);
      expect(stateAfter.offsetY).toBe(stateBefore.offsetY);
    });
  });

  describe('reset functionality', () => {
    it('should reset to default view', () => {
      // Zoom and pan
      const initialZoom = viewport.getState().zoom;
      viewport.setZoom(initialZoom * 2);
      viewport.setPan(100, 50);

      // Reset
      viewport.reset();

      const state = viewport.getState();
      const expectedZoom = DISPLAY_WIDTH / TOTAL_DURATION;

      expect(state.zoom).toBeCloseTo(expectedZoom, 10);
      expect(state.offsetX).toBe(0);
      expect(state.offsetY).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle zero duration gracefully', () => {
      const vp = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, 0, MAX_DEPTH);
      const state = vp.getState();

      expect(state.zoom).toBeGreaterThan(0);
    });

    it('should handle zero display width gracefully', () => {
      const vp = new TimelineViewport(0, DISPLAY_HEIGHT, TOTAL_DURATION, MAX_DEPTH);
      const state = vp.getState();

      expect(state.zoom).toBeGreaterThan(0);
    });

    it('should handle zero max depth', () => {
      const vp = new TimelineViewport(DISPLAY_WIDTH, DISPLAY_HEIGHT, TOTAL_DURATION, 0);
      const bounds = vp.getBounds();

      expect(bounds.depthStart).toBeCloseTo(0, 10);
      expect(bounds.depthEnd).toBeGreaterThanOrEqual(0);
    });
  });
});
