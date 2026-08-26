/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { SelectionView } from '../core/events/EventBus.js';
import type { ViewModeOption } from './ViewModeSwitch.js';

// The switch options are the source of the union, so the guard below can't drift.
export const VIEW_MODES = [
  { value: 'time-order', label: 'Time Order' },
  { value: 'aggregated', label: 'Aggregated' },
  { value: 'bottom-up', label: 'Bottom-Up' },
] as const satisfies readonly ViewModeOption[];

export type ViewMode = (typeof VIEW_MODES)[number]['value'];

export function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.some((option) => option.value === value);
}

/** Bottom-Up reads a call tree from its leaves upwards, so it shows callers. The
 *  other two read it downwards. */
export function directionOf(mode: ViewMode): SelectionView {
  return mode === 'bottom-up' ? 'callers' : 'callees';
}

/**
 * The mode the inspector's call tree opens a selection on when the user has not
 * picked one. A tab showing callees is answered by where the time went; anything
 * else by the top-down view that fits the selection, Aggregated for a merged one
 * and Time Order for a single frame. The two return the same rows for a merged
 * selection, so Time Order would name it wrongly.
 */
export function defaultViewMode(
  sourceView: SelectionView | undefined,
  isAggregate: boolean,
): ViewMode {
  if (sourceView === 'callees') {
    return 'bottom-up';
  }
  return isAggregate ? 'aggregated' : 'time-order';
}
