/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { customElement } from 'lit/decorators.js';

import type { SOSLExecuteBeginLine } from '@apexdevtools/apex-log-parser';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import type { GridColumn } from '../../../grid/index.js';
import { SOSL_VIEWS } from '../../../tabulator/ColumnViews.js';
import { NAMESPACE_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { textColumn } from '../../../components/grid/columns.js';
import {
  rowCountColumn,
  StatementGrid,
  statementColumn,
  timeTakenColumn,
  type StatementRow,
} from './StatementGrid.js';

interface SOSLRow extends StatementRow {
  sosl: string;
}

function soslColumns(rows: readonly SOSLRow[]): GridColumn<SOSLRow>[] {
  return [
    statementColumn({ id: 'sosl', title: 'SOSL', value: (row) => row.sosl, dialect: 'sosl' }),
    textColumn({
      id: 'namespace',
      title: 'Namespace',
      value: (row) => row.namespace,
      width: NAMESPACE_WIDTH,
    }),
    textColumn({
      id: 'callerNamespace',
      title: 'Caller Namespace',
      value: (row) => row.callerNamespace,
      width: NAMESPACE_WIDTH,
      hidden: true,
    }),
    rowCountColumn(rows),
    timeTakenColumn(rows),
  ];
}

@customElement('sosl-view')
export class SOSLView extends StatementGrid<SOSLRow, SOSLExecuteBeginLine> {
  constructor() {
    super({
      type: 'sosl',
      views: SOSL_VIEWS,
      placeholder: 'No SOSL queries found',
      facets: [{ label: 'Namespace', value: (row) => row.namespace }],
      groups: [
        { label: 'SOSL', value: (row) => row.sosl },
        { label: 'Namespace', value: (row) => row.namespace },
        { label: 'Caller Namespace', value: (row) => row.callerNamespace },
        { label: 'None', value: null },
      ],
      columns: soslColumns,
    });
  }

  protected toRows(lines: readonly SOSLExecuteBeginLine[]): SOSLRow[] {
    return lines.map((sosl) => ({
      eventIndex: sosl.eventIndex,
      sosl: sosl.text,
      namespace: sosl.namespace,
      callerNamespace: getCallerNamespace(sosl),
      rowCount: sosl.soslRowCount.self,
      timeTaken: sosl.duration.total,
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sosl-view': SOSLView;
  }
}
