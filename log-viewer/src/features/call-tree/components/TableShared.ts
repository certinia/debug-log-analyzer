/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */
import { Tabulator, type RowComponent } from 'tabulator-tables';

import * as CommonModules from '../../../tabulator/module/CommonModules.js';
import { Find } from '../../../tabulator/module/Find.js';
import { RowKeyboardNavigation } from '../../../tabulator/module/RowKeyboardNavigation.js';
import { RowNavigation } from '../../../tabulator/module/RowNavigation.js';
import { ScrollAnchor } from '../../../tabulator/module/ScrollAnchor.js';
import type { AggregatedRow, BottomUpRow } from '../utils/Aggregation.js';
import type { TimeOrderRow } from '../utils/TimeOrderTree.js';

export interface TableCallbacks {
  namespaceFilter: (
    selectedNamespaces: string[],
    namespace: string,
    data: TimeOrderRow | AggregatedRow | BottomUpRow,
    filterParams: { filterCache: Map<number, boolean> },
  ) => boolean;
  onFilterCacheClear?: () => void;
  onRenderStarted: () => void;
  rowFormatter?: (row: RowComponent) => void;
}

export function registerTableModules(): void {
  Tabulator.registerModule(Object.values(CommonModules));
  Tabulator.registerModule([RowKeyboardNavigation, RowNavigation, ScrollAnchor, Find]);
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
