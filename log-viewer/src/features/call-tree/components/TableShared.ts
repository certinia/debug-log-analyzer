/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Tabulator } from 'tabulator-tables';

import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { MiddleRowFocus } from '../../../tabulator/module/MiddleRowFocus.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import type { MergedCalltreeRow } from '../utils/MergeAdjacent.js';

export interface TableCallbacks {
  namespaceFilter: (
    selectedNamespaces: string[],
    namespace: string,
    data: MergedCalltreeRow | AggregatedRow | BottomUpRow,
    filterParams: { filterCache: Map<string, boolean> },
  ) => boolean;
  onFilterCacheClear: () => void;
  onRenderStarted: () => void;
}

export function registerTableModules(): void {
  Tabulator.registerModule(Object.values(CommonModules));
  Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, MiddleRowFocus, Find]);
}

export function headerSortElement(_column: unknown, dir: string): string {
  switch (dir) {
    case 'asc':
      return "<div class='sort-by--top'></div>";
    case 'desc':
      return "<div class='sort-by--bottom'></div>";
    default:
      return "<div class='sort-by'><div class='sort-by--top'></div><div class='sort-by--bottom'></div></div>";
  }
}

export const commonColumnDefaults = {
  title: 'default',
  resizable: true,
  headerSortStartingDir: 'desc' as const,
  headerTooltip: true,
  headerWordWrap: true,
};
