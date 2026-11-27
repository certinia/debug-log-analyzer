/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { rowDetailSelection, rowFrames, type RowReader } from '../../../components/locatedRow.js';
import { eventBus, type DetailSource, type SelectionView } from '#core/events/EventBus.js';
import type { SelectionEchoGuard } from '#core/events/SelectionEchoGuard.js';
import type { LogStore } from '#core/log/LogStore.js';
import type { GridRowDetail, GridSelectDetail } from '../../../grid/index.js';

/** What {@link inspectorRowEvents} reads a grid's rows and the inspector by. */
export interface InspectorRowEventsOptions<R> extends RowReader<R> {
  source: DetailSource;
  /** The store the grid's rows were built from. */
  store: () => LogStore | null;
  /** The direction the grid's rows read in. */
  view: () => SelectionView;
  echoGuard: SelectionEchoGuard;
  /** Drops the mark a picked inspector row left in the grid. */
  dropPick: () => void;
}

/** The `lv-grid-select` and `lv-grid-locate` handlers that tell the inspector what a call-tree row stands for. */
export function inspectorRowEvents<R>(opts: InspectorRowEventsOptions<R>): {
  select: (e: Event) => void;
  locate: (e: Event) => void;
} {
  return {
    select: (e) => {
      if (opts.echoGuard.suppressed) {
        return;
      }
      const { row } = (e as CustomEvent<GridSelectDetail<R>>).detail;
      const view = opts.view();
      const selection = rowDetailSelection(row, opts, opts.store(), view);
      if (!selection) {
        // The selection went with it, and so does a mark a picked inspector row
        // left here — it was never a selection of this grid.
        opts.dropPick();
      }
      eventBus.emit('detail:select', { source: opts.source, selection, view });
    },
    locate: (e) => {
      const { row } = (e as CustomEvent<GridRowDetail<R>>).detail;
      eventBus.emit('detail:locate', {
        source: opts.source,
        eventIds: row ? rowFrames(row, opts, opts.store(), opts.view()) : [],
      });
    },
  };
}
