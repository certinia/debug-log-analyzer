/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DetailSource, EventDetail } from '../core/events/EventBus.js';
import type { InspectorEmphasis } from './inspectorEmphasis.js';

/**
 * A view's answer to the inspector pointing at frames: mark what the report
 * names, and where a picked row merges occurrences, move to the first of them.
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
    const marked = emphasis.report(detail.eventIndexes, detail.sticky);
    if (!revealFirstOccurrence || !detail.sticky || !detail.eventIndexes.length) {
      mark(marked);
      return;
    }
    // Moving re-renders the rows a mark sits on, so the mark goes on after it.
    void (async () => {
      try {
        await revealFirstOccurrence(detail.eventIndexes[0]!);
      } catch {
        // The move failed, and the view reports that itself. The mark still has
        // to go on: it says where the frames are, moved to or not.
      }
      // Read again rather than re-applying the report that started the move: a
      // report arriving while it ran has already replaced that one, and the
      // re-render stripped whatever mark it had put on.
      mark(emphasis.current());
    })();
  };
}
