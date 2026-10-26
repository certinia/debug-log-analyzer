/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { customElement } from 'lit/decorators.js';

import type { DMLBeginLine } from '@apexdevtools/apex-log-parser';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import type { GridColumn } from '../../../grid/index.js';
import { DML_VIEWS } from '../../../components/grid/ColumnViews.js';
import { textColumn } from '../../../components/grid/columns.js';
import {
  rowCountColumn,
  StatementGrid,
  statementColumn,
  timeTakenColumn,
  type StatementRow,
} from './StatementGrid.js';

interface DMLRow extends StatementRow {
  dml: string;
  objectType: string | null;
}

function dmlColumns(rows: readonly DMLRow[]): GridColumn<DMLRow>[] {
  return [
    statementColumn({ id: 'dml', title: 'DML', value: (row) => row.dml, dialect: null }),
    textColumn({
      id: 'callerNamespace',
      title: 'Caller Namespace',
      value: (row) => row.callerNamespace,
    }),
    textColumn({
      id: 'objectType',
      title: 'Object',
      value: (row) => row.objectType,
      hidden: true,
      hoverText: true,
      empty: '—',
    }),
    textColumn({
      id: 'namespace',
      title: 'Namespace',
      value: (row) => row.namespace,
      hidden: true,
    }),
    rowCountColumn(rows),
    timeTakenColumn(rows),
  ];
}

@customElement('dml-view')
export class DMLView extends StatementGrid<DMLRow, DMLBeginLine> {
  constructor() {
    super({
      type: 'dml',
      views: DML_VIEWS,
      placeholder: 'No DML statements found',
      facets: [
        { label: 'Caller Namespace', value: (row) => row.callerNamespace },
        { label: 'Object', value: (row) => row.objectType },
      ],
      groups: [
        { label: 'DML', value: (row) => row.dml },
        { label: 'Object', value: (row) => row.objectType ?? '' },
        { label: 'Namespace', value: (row) => row.namespace },
        { label: 'Caller Namespace', value: (row) => row.callerNamespace },
        { label: 'None', value: null },
      ],
      columns: dmlColumns,
    });
  }

  protected toRows(lines: readonly DMLBeginLine[]): DMLRow[] {
    return lines.map((dml) => ({
      eventIndex: dml.eventIndex,
      dml: dml.text,
      objectType: dml.sObjectType,
      namespace: dml.namespace,
      callerNamespace: getCallerNamespace(dml),
      rowCount: dml.dmlRowCount.self,
      timeTaken: dml.duration.total,
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dml-view': DMLView;
  }
}
