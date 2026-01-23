/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * MeasurementManager
 *
 * Manages measurement state for the timeline Measure Range feature.
 * Allows users to measure time between two points by Shift+dragging.
 *
 * State lifecycle:
 * - start() → isActive=true, sets startTime
 * - update() → updates endTime while dragging
 * - finish() → isActive=false, measurement persists
 * - clear() → removes measurement entirely
 */

/**
 * Measurement state representing a time range measurement.
 */
export interface MeasurementState {
  /** Start time in nanoseconds */
  startTime: number;
  /** End time in nanoseconds */
  endTime: number;
  /** True while user is actively dragging */
  isActive: boolean;
}

export class MeasurementManager {
  private state: MeasurementState | null = null;

  /**
   * Start a new measurement at the given time.
   * Clears any existing measurement.
   *
   * @param timeNs - Start time in nanoseconds
   */
  public start(timeNs: number): void {
    this.state = {
      startTime: timeNs,
      endTime: timeNs,
      isActive: true,
    };
  }

  /**
   * Update the measurement end time while dragging.
   * No-op if no active measurement.
   *
   * @param timeNs - Current time in nanoseconds
   */
  public update(timeNs: number): void {
    if (!this.state || !this.state.isActive) {
      return;
    }
    this.state.endTime = timeNs;
  }

  /**
   * Finish the measurement (mouse released).
   * Measurement persists but is no longer active.
   */
  public finish(): void {
    if (!this.state) {
      return;
    }
    this.state.isActive = false;
  }

  /**
   * Clear the measurement entirely.
   */
  public clear(): void {
    this.state = null;
  }

  /**
   * Get the current measurement state.
   * Returns normalized state where startTime <= endTime.
   *
   * @returns Measurement state or null if no measurement
   */
  public getState(): MeasurementState | null {
    if (!this.state) {
      return null;
    }

    // Normalize: ensure startTime <= endTime (handles right-to-left drag)
    const minTime = Math.min(this.state.startTime, this.state.endTime);
    const maxTime = Math.max(this.state.startTime, this.state.endTime);

    return {
      startTime: minTime,
      endTime: maxTime,
      isActive: this.state.isActive,
    };
  }

  /**
   * Get the raw (non-normalized) measurement state.
   * Useful for checking the original drag direction.
   *
   * @returns Raw measurement state or null if no measurement
   */
  public getRawState(): MeasurementState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * Check if there is an active or finished measurement.
   *
   * @returns true if a measurement exists
   */
  public hasMeasurement(): boolean {
    return this.state !== null;
  }

  /**
   * Check if measurement is currently being dragged.
   *
   * @returns true if actively measuring
   */
  public isActive(): boolean {
    return this.state?.isActive ?? false;
  }

  /**
   * Get the duration of the measurement in nanoseconds.
   *
   * @returns Duration in nanoseconds, or 0 if no measurement
   */
  public getDuration(): number {
    if (!this.state) {
      return 0;
    }
    return Math.abs(this.state.endTime - this.state.startTime);
  }
}
