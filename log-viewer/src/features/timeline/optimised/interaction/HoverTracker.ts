/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * HoverTracker - owns what the pointer is over
 *
 * Two facts, kept together because they only make sense together: the frame under the
 * pointer, and where the pointer is. A pan or a zoom moves the frames without moving the
 * pointer, so the second is what lets the first be worked out again.
 */

import type { HoveredFrame } from '../../types/flamechart.types.js';

/** What tells one hovered frame from another: its log event, or the node when it has none. */
function frameKey(frame: HoveredFrame | null): unknown {
  if (!frame) {
    return null;
  }
  return frame.node.original ?? frame.node;
}

export class HoverTracker {
  private hovered: HoveredFrame | null = null;
  private pointer: { x: number; y: number } | null = null;
  private staleHit = false;

  /** The frame under the pointer, or null. */
  public getHovered(): HoveredFrame | null {
    return this.hovered;
  }

  /**
   * Record the frame under the pointer.
   *
   * @param hovered - The frame and its depth, or null for none
   * @returns Whether it changed, and so needs drawing again
   */
  public setHovered(hovered: HoveredFrame | null): boolean {
    // By the log event, not the node: the hit test builds a fresh EventNode every time, and
    // its id is only a timestamp and a depth, which two zero-duration siblings share. A node
    // with no log event falls back to itself, which reads as changed - the safe answer.
    if (frameKey(hovered) === frameKey(this.hovered)) {
      return false;
    }
    this.hovered = hovered;
    return true;
  }

  /**
   * Record where the pointer is.
   *
   * @param x - Canvas X
   * @param y - Canvas Y
   */
  public setPointer(x: number, y: number): void {
    this.pointer = { x, y };
  }

  /** The pointer left the chart: nothing is hovered and nothing is worth asking about. */
  public clearPointer(): void {
    this.pointer = null;
    this.staleHit = false;
    this.hovered = null;
  }

  /** The frames moved under the pointer, so what it is over has changed. */
  public invalidateHit(): void {
    this.staleHit = this.pointer !== null;
  }

  /**
   * The position to ask the hit test about, once and once only.
   *
   * @returns The pointer position, or null when the last answer still stands
   */
  public takeStaleHit(): { x: number; y: number } | null {
    if (!this.staleHit || !this.pointer) {
      return null;
    }
    this.staleHit = false;
    return this.pointer;
  }
}
