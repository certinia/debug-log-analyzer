/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DetailSource, EventDetail } from '../core/events/EventBus.js';
import type { InspectorEmphasis } from './inspectorEmphasis.js';

/**
 * A view's answer to the inspector pointing at frames: mark what the report
 * names, and where a picked row merges occurrences, move to the first of them.
 *
 * The mark goes on before the move, and the move needs no answer: a row the move
 * renders lights itself from the mark the table now holds.
 *
 * @param source - the tab this view is, so a report for another is left alone
 * @param revealFirstOccurrence - omitted where jumping to one of several merged
 *   occurrences would be arbitrary, which is why the Database grids and the
 *   flame chart only mark. A pick of a single frame arrives as
 *   `inspector:reveal` instead, and every view answers that.
 */
export function inspectorLocateHandler(
  source: DetailSource,
  emphasis: InspectorEmphasis,
  mark: (eventIndexes: readonly number[]) => void,
  revealFirstOccurrence?: (eventIndex: number) => Promise<void>,
): (detail: EventDetail<'inspector:locate'>) => void {
  return (detail) => {
    if (detail.source !== source) {
      return;
    }
    mark(emphasis.report(detail.eventIndexes, detail.sticky));
    if (revealFirstOccurrence && detail.sticky && detail.eventIndexes.length) {
      revealFirstOccurrence(detail.eventIndexes[0]!).catch(() => {
        // The view could not move, and reports that itself. The mark is already
        // on: it says where the frames are, moved to or not.
      });
    }
  };
}
