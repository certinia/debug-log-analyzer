/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import { rowDetailSelection, rowFrames } from '../../../components/locatedRow.js';
import { eventBus, type DetailSource, type SelectionView } from '../../../core/events/EventBus.js';
import type { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import type { GridRowDetail, GridSelectDetail } from '../../../grid/index.js';

/** What {@link inspectorRowEvents} reads a grid's rows and the inspector by. */
export interface InspectorRowEventsOptions<R> {
  source: DetailSource;
  root: () => ApexLog | null;
  /** The direction the grid's rows read in. */
  view: () => SelectionView;
  /** The Tabulator row shape the inspector reads a row by. */
  standIn: (row: R) => RowComponent;
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
      const selection = rowDetailSelection(row ? opts.standIn(row) : undefined, opts.root(), view);
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
        eventIndexes: row ? rowFrames(opts.standIn(row), opts.root(), opts.view()) : [],
      });
    },
  };
}
