/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { customElement } from 'lit/decorators.js';

import type { SoslEvent } from '#core/log/statements.js';
import type { GridColumn } from '../../../grid/index.js';
import { SOSL_VIEWS } from '../../../components/grid/ColumnViews.js';
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
    }),
    textColumn({
      id: 'callerNamespace',
      title: 'Caller Namespace',
      value: (row) => row.callerNamespace,
      hidden: true,
    }),
    rowCountColumn(rows),
    timeTakenColumn(rows),
  ];
}

@customElement('sosl-view')
export class SOSLView extends StatementGrid<SOSLRow, SoslEvent> {
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

  protected toRows(lines: readonly SoslEvent[], callerOf: (id: number) => string): SOSLRow[] {
    return lines.map((sosl) => ({
      eventId: sosl.id,
      sosl: sosl.text ?? '',
      namespace: sosl.namespace,
      callerNamespace: callerOf(sosl.id),
      rowCount: sosl.soslRowCount?.self ?? 0,
      timeTaken: sosl.duration.total,
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sosl-view': SOSLView;
  }
}
