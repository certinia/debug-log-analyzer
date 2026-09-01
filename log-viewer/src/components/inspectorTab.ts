/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { type DetailSource, eventBus } from '../core/events/EventBus.js';
import type { InspectorEmphasis } from './inspectorEmphasis.js';

/** What a tab's view does when the inspector points into it. */
export interface InspectorTabSync {
  /** Light the frames the inspector names, in whatever the view's rows are. */
  mark: (eventIndexes: readonly number[]) => void;

  /**
   * Move to one frame. A rejection is the view's own to report: it says the view
   * cannot reach the frame, and the mark still says where the frame is.
   *
   * @param signal - aborted once a later move has replaced this one. A view that
   * waits on anything checks it before it scrolls.
   */
  reveal: (eventIndex: number, signal: AbortSignal) => void | Promise<void>;

  /** Drop the view's own selection, for the app-wide Escape. */
  clear: () => void;

  /**
   * True where a picked row that merges occurrences also moves, to the first of
   * them. Omitted where choosing one of several would be arbitrary, which is why
   * the Database grids and the flame chart only mark.
   */
  movesToMergedPick?: boolean;
}

/**
 * Subscribes a tab's view to the inspector, and returns the one unsubscribe.
 *
 * All four tabs answer the same three events for their own source, so this is
 * where that set is named. A view supplies only what it does differently.
 *
 * The mark goes on before any move, and the move needs no answer: a row the move
 * renders lights itself from the mark the table now holds.
 */
export function wireInspectorTab(
  source: DetailSource,
  emphasis: InspectorEmphasis,
  sync: InspectorTabSync,
): () => void {
  let moving: AbortController | null = null;
  const move = (eventIndex: number): void => {
    // A move waits on a render, and a pointer crossing rows asks for several, so
    // the last one asked for is the one that scrolls. Only the move is abandoned:
    // the mark of the move that is dropped went on before it.
    moving?.abort();
    moving = new AbortController();
    // The view reports its own failure; the mark stands either way.
    void Promise.resolve(sync.reveal(eventIndex, moving.signal)).catch(() => {});
  };

  const offs = [
    eventBus.onSource('inspector:reveal', source, (detail) => {
      move(detail.eventIndex);
    }),

    eventBus.onSource('inspector:locate', source, (detail) => {
      sync.mark(emphasis.report(detail.eventIndexes, detail.sticky));
      if (sync.movesToMergedPick && detail.sticky && detail.eventIndexes.length) {
        move(detail.eventIndexes[0]!);
      }
    }),

    // A picked inspector row is no selection of the view's own, so the mark is
    // dropped here rather than by the view reporting its clear.
    eventBus.onSource('selection:clear', source, () => {
      sync.clear();
      sync.mark(emphasis.pick([]));
    }),
  ];

  return () => {
    moving?.abort();
    moving = null;
    for (const off of offs) {
      off();
    }
  };
}
