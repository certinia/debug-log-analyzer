/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

import { MeasurementManager } from '../optimised/measurement/MeasurementManager.js';

describe('MeasurementManager', () => {
  let manager: MeasurementManager;

  beforeEach(() => {
    manager = new MeasurementManager();
  });

  describe('initial state', () => {
    it('should have no measurement initially', () => {
      expect(manager.hasMeasurement()).toBe(false);
      expect(manager.getState()).toBeNull();
      expect(manager.isActive()).toBe(false);
      expect(manager.getDuration()).toBe(0);
    });
  });

  describe('start()', () => {
    it('should create an active measurement with matching start and end times', () => {
      manager.start(1000);

      expect(manager.hasMeasurement()).toBe(true);
      expect(manager.isActive()).toBe(true);

      const state = manager.getState();
      expect(state).not.toBeNull();
      expect(state!.startTime).toBe(1000);
      expect(state!.endTime).toBe(1000);
      expect(state!.isActive).toBe(true);
    });

    it('should clear previous measurement when starting a new one', () => {
      manager.start(1000);
      manager.update(2000);
      manager.finish();

      manager.start(5000);

      const state = manager.getState();
      expect(state!.startTime).toBe(5000);
      expect(state!.endTime).toBe(5000);
      expect(state!.isActive).toBe(true);
    });
  });

  describe('update()', () => {
    it('should update the end time during active measurement', () => {
      manager.start(1000);
      manager.update(3000);

      const state = manager.getState();
      expect(state!.startTime).toBe(1000);
      expect(state!.endTime).toBe(3000);
    });

    it('should no-op if no active measurement', () => {
      manager.update(5000);

      expect(manager.hasMeasurement()).toBe(false);
      expect(manager.getState()).toBeNull();
    });

    it('should no-op if measurement is finished (not active)', () => {
      manager.start(1000);
      manager.update(2000);
      manager.finish();

      manager.update(5000);

      const state = manager.getState();
      expect(state!.endTime).toBe(2000); // Not updated
    });
  });

  describe('finish()', () => {
    it('should mark measurement as inactive but preserve state', () => {
      manager.start(1000);
      manager.update(3000);
      manager.finish();

      expect(manager.hasMeasurement()).toBe(true);
      expect(manager.isActive()).toBe(false);

      const state = manager.getState();
      expect(state!.startTime).toBe(1000);
      expect(state!.endTime).toBe(3000);
      expect(state!.isActive).toBe(false);
    });

    it('should no-op if no measurement', () => {
      manager.finish();

      expect(manager.hasMeasurement()).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should remove measurement entirely', () => {
      manager.start(1000);
      manager.update(3000);
      manager.clear();

      expect(manager.hasMeasurement()).toBe(false);
      expect(manager.getState()).toBeNull();
      expect(manager.isActive()).toBe(false);
    });

    it('should clear finished measurement', () => {
      manager.start(1000);
      manager.update(3000);
      manager.finish();
      manager.clear();

      expect(manager.hasMeasurement()).toBe(false);
    });
  });

  describe('getState() normalization', () => {
    it('should normalize right-to-left drag (ensure startTime <= endTime)', () => {
      manager.start(5000);
      manager.update(2000); // End time is before start time

      const state = manager.getState();
      expect(state!.startTime).toBe(2000); // Normalized: smaller value
      expect(state!.endTime).toBe(5000); // Normalized: larger value
    });

    it('should preserve left-to-right drag', () => {
      manager.start(2000);
      manager.update(5000);

      const state = manager.getState();
      expect(state!.startTime).toBe(2000);
      expect(state!.endTime).toBe(5000);
    });
  });

  describe('getRawState()', () => {
    it('should return non-normalized state', () => {
      manager.start(5000);
      manager.update(2000);

      const rawState = manager.getRawState();
      expect(rawState!.startTime).toBe(5000); // Original order
      expect(rawState!.endTime).toBe(2000);
    });

    it('should return null if no measurement', () => {
      expect(manager.getRawState()).toBeNull();
    });

    it('should return a copy (not reference)', () => {
      manager.start(1000);
      const rawState = manager.getRawState();

      rawState!.startTime = 9999;

      expect(manager.getRawState()!.startTime).toBe(1000); // Original unchanged
    });
  });

  describe('getDuration()', () => {
    it('should return duration as absolute value', () => {
      manager.start(1000);
      manager.update(3500);

      expect(manager.getDuration()).toBe(2500);
    });

    it('should return absolute duration for right-to-left drag', () => {
      manager.start(5000);
      manager.update(2000);

      expect(manager.getDuration()).toBe(3000);
    });

    it('should return 0 if no measurement', () => {
      expect(manager.getDuration()).toBe(0);
    });
  });

  describe('hasMeasurement()', () => {
    it('should return true during active measurement', () => {
      manager.start(1000);
      expect(manager.hasMeasurement()).toBe(true);
    });

    it('should return true for finished measurement', () => {
      manager.start(1000);
      manager.finish();
      expect(manager.hasMeasurement()).toBe(true);
    });

    it('should return false after clear', () => {
      manager.start(1000);
      manager.clear();
      expect(manager.hasMeasurement()).toBe(false);
    });
  });

  describe('isActive()', () => {
    it('should return true during active measurement', () => {
      manager.start(1000);
      expect(manager.isActive()).toBe(true);
    });

    it('should return false for finished measurement', () => {
      manager.start(1000);
      manager.finish();
      expect(manager.isActive()).toBe(false);
    });

    it('should return false after clear', () => {
      manager.start(1000);
      manager.clear();
      expect(manager.isActive()).toBe(false);
    });
  });
});
