/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * ViewportAnimator
 *
 * Provides smooth animation for viewport transitions.
 * Uses requestAnimationFrame for 60fps animation with easing.
 */

import type { TimelineViewport } from './TimelineViewport.js';

/**
 * Easing functions for smooth viewport transitions.
 */
export const easing = {
  /** Fast deceleration - good for snapping to position */
  easeOutQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  /** Medium deceleration - balanced feel */
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
};

/**
 * Animate viewport from current state to target.
 */
export class ViewportAnimator {
  private animationId: number | null = null;

  // Chase animation state (for keyboard pan)
  private targetOffsetX: number = 0;
  private targetOffsetY: number = 0;
  private isChasingPan: boolean = false;

  // Chase animation state (for keyboard zoom)
  private targetZoom: number = 0;
  private isChasingZoom: boolean = false;

  /** How quickly to approach target (0-1). Higher = faster approach. */
  private readonly lerpFactor: number = 0.15;

  /**
   * Animate viewport offset to target position.
   *
   * @param viewport - TimelineViewport to animate
   * @param targetOffsetX - Target horizontal offset
   * @param targetOffsetY - Target vertical offset
   * @param duration - Animation duration in milliseconds (default: 300)
   * @param onFrame - Callback invoked each animation frame for re-rendering
   */
  public animate(
    viewport: TimelineViewport,
    targetOffsetX: number,
    targetOffsetY: number,
    duration: number = 300,
    onFrame: () => void,
  ): void {
    // Cancel any existing animation (including chase)
    this.cancel();

    const startState = viewport.getState();
    const startOffsetX = startState.offsetX;
    const startOffsetY = startState.offsetY;
    const startTime = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const easedT = easing.easeOutCubic(t);

      // Interpolate offsets
      const currentX = startOffsetX + (targetOffsetX - startOffsetX) * easedT;
      const currentY = startOffsetY + (targetOffsetY - startOffsetY) * easedT;

      viewport.setOffset(currentX, currentY);
      onFrame();

      if (t < 1) {
        this.animationId = requestAnimationFrame(tick);
      } else {
        this.animationId = null;
      }
    };

    this.animationId = requestAnimationFrame(tick);
  }

  /**
   * Add to current target offset for continuous chase animation.
   * Used for keyboard pan where rapid keypresses update the target.
   *
   * When not already chasing, starts from the current viewport position.
   * When already chasing, adds to the existing target (accumulates input).
   *
   * @param viewport - TimelineViewport to animate
   * @param deltaX - Horizontal offset to add
   * @param deltaY - Vertical offset to add
   * @param onFrame - Callback invoked each animation frame for re-rendering
   */
  public addToTarget(
    viewport: TimelineViewport,
    deltaX: number,
    deltaY: number,
    onFrame: () => void,
  ): void {
    if (this.isChasingPan) {
      // Add to existing target
      this.targetOffsetX += deltaX;
      this.targetOffsetY += deltaY;

      // Clamp target to viewport bounds
      const clamped = viewport.clampOffset(this.targetOffsetX, this.targetOffsetY);
      this.targetOffsetX = clamped.x;
      this.targetOffsetY = clamped.y;
    } else {
      // Start fresh from current position
      const current = viewport.getState();
      this.targetOffsetX = current.offsetX + deltaX;
      this.targetOffsetY = current.offsetY + deltaY;

      // Clamp target to viewport bounds
      const clamped = viewport.clampOffset(this.targetOffsetX, this.targetOffsetY);
      this.targetOffsetX = clamped.x;
      this.targetOffsetY = clamped.y;

      // Cancel any timed animation and start pan chase
      this.cancel();
      this.startPanChase(viewport, onFrame);
    }
  }

  /**
   * Multiply zoom by factor for continuous chase animation.
   * Used for keyboard zoom where rapid keypresses accumulate.
   *
   * When not already chasing, starts from the current zoom level.
   * When already chasing, multiplies the existing target (accumulates input).
   *
   * @param viewport - TimelineViewport to animate
   * @param factor - Zoom factor to multiply (>1 zooms in, <1 zooms out)
   * @param onFrame - Callback invoked each animation frame for re-rendering
   */
  public multiplyZoomTarget(viewport: TimelineViewport, factor: number, onFrame: () => void): void {
    if (this.isChasingZoom) {
      // Multiply existing target
      this.targetZoom *= factor;

      // Clamp to valid zoom range
      this.targetZoom = viewport.clampZoom(this.targetZoom);
    } else {
      // Start fresh from current zoom
      const current = viewport.getState();
      this.targetZoom = current.zoom * factor;

      // Clamp to valid zoom range
      this.targetZoom = viewport.clampZoom(this.targetZoom);

      // Cancel any timed animation and start zoom chase
      this.cancel();
      this.startZoomChase(viewport, onFrame);
    }
  }

  /**
   * Start the pan chase animation loop.
   * Continuously lerps toward target offset until close enough.
   */
  private startPanChase(viewport: TimelineViewport, onFrame: () => void): void {
    this.isChasingPan = true;

    const tick = (): void => {
      const current = viewport.getState();
      const dx = this.targetOffsetX - current.offsetX;
      const dy = this.targetOffsetY - current.offsetY;

      // Stop if close enough (sub-pixel threshold)
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        viewport.setOffset(this.targetOffsetX, this.targetOffsetY);
        onFrame();
        this.isChasingPan = false;
        this.animationId = null;
        return;
      }

      // Lerp toward target
      viewport.setOffset(
        current.offsetX + dx * this.lerpFactor,
        current.offsetY + dy * this.lerpFactor,
      );
      onFrame();

      this.animationId = requestAnimationFrame(tick);
    };

    this.animationId = requestAnimationFrame(tick);
  }

  /**
   * Start the zoom chase animation loop.
   * Continuously lerps toward target zoom until close enough.
   * Uses log-space interpolation for perceptually uniform zoom speed.
   */
  private startZoomChase(viewport: TimelineViewport, onFrame: () => void): void {
    this.isChasingZoom = true;

    const tick = (): void => {
      const current = viewport.getState();

      // Use log-space for perceptually uniform zoom
      const logCurrent = Math.log(current.zoom);
      const logTarget = Math.log(this.targetZoom);
      const logDiff = logTarget - logCurrent;

      // Stop if close enough (less than 0.5% zoom difference)
      if (Math.abs(logDiff) < 0.005) {
        viewport.setZoom(this.targetZoom);
        onFrame();
        this.isChasingZoom = false;
        this.animationId = null;
        return;
      }

      // Lerp in log space and convert back
      const newLogZoom = logCurrent + logDiff * this.lerpFactor;
      const newZoom = Math.exp(newLogZoom);

      viewport.setZoom(newZoom);
      onFrame();

      this.animationId = requestAnimationFrame(tick);
    };

    this.animationId = requestAnimationFrame(tick);
  }

  /**
   * Cancel any in-progress animation (timed, pan chase, or zoom chase).
   */
  public cancel(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.isChasingPan = false;
    this.isChasingZoom = false;
  }

  /**
   * Check if an animation is currently running.
   */
  public isAnimating(): boolean {
    return this.animationId !== null;
  }
}
