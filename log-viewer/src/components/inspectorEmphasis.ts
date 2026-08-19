/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The frames a view emphasises for the inspector, and how long each holds.
 *
 * Two reports feed it. The pointer over an inspector row is momentary: it wins
 * while it lasts and is dropped when the pointer leaves. A pick is sticky: it
 * holds while the pointer is anywhere else, so a clicked row stays lit — as the
 * Chrome DevTools performance panel keeps a selected group's instances lit.
 *
 * A pick supersedes any hover, so the two never fight; the pointer re-reports
 * itself as soon as it moves.
 */
export class InspectorEmphasis {
  private hovered: readonly number[] = [];
  private picked: readonly number[] = [];

  /**
   * Record an inspector report and return what to emphasise now.
   *
   * @param eventIndexes - Frames the report names, empty to drop it
   * @param sticky - True for a pick, false for the pointer
   */
  public report(eventIndexes: readonly number[], sticky: boolean): readonly number[] {
    if (sticky) {
      return this.pick(eventIndexes);
    }
    this.hovered = eventIndexes;
    return this.current();
  }

  /** Set the pick from the view's own selection, and return what to emphasise. */
  public pick(eventIndexes: readonly number[]): readonly number[] {
    this.picked = eventIndexes;
    this.hovered = [];
    return this.current();
  }

  /** The frames to emphasise: the pointer's while it is over a row, else the pick's. */
  public current(): readonly number[] {
    return this.hovered.length ? this.hovered : this.picked;
  }
}
