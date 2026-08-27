/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { RowComponent } from 'tabulator-tables';

import { withCodeDrivenExpand } from '../../../tabulator/module/expandOrigin.js';

export function expandCollapseAll(rows: RowComponent[], expand: boolean): void {
  withCodeDrivenExpand(() => {
    for (const row of rows) {
      const children = row.getTreeChildren();
      if (!children || children.length === 0) {
        continue;
      }

      if (expand) {
        row.treeExpand();
      } else {
        row.treeCollapse();
      }
      expandCollapseAll(children, expand);
    }
  });
}
