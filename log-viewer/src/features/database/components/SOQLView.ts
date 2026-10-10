/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';

import type { SOQLExecuteBeginLine } from '@apexdevtools/apex-log-parser';
import { countColumn, textColumn } from '../../../components/grid/columns.js';
import { getCallerNamespace } from '../../../core/utility/CallerNamespace.js';
import type { GridColumn } from '../../../grid/index.js';
import { SOQL_VIEWS } from '../../../tabulator/ColumnViews.js';
import { NAMESPACE_WIDTH } from '../../../tabulator/ColumnWidths.js';
import { deriveSoqlObject } from '../services/sobjectClassification.js';
import {
  rowCountColumn,
  StatementGrid,
  statementColumn,
  timeTakenColumn,
  type StatementRow,
} from './StatementGrid.js';

// Both cardinality columns: the title wrapped to two lines is the constraint.
const CARDINALITY_WIDTH = 113;

interface SOQLRow extends StatementRow {
  soql: string;
  isSelective: boolean | null;
  relativeCost: number | null;
  aggregations: number;
  objectType: string | null;
  leadingOperationType: string | null;
  sObjectType: string | null;
  cardinality: number | null;
  sObjectCardinality: number | null;
  fields: string | null;
}

function selectiveColumn(): GridColumn<SOQLRow> {
  return {
    id: 'isSelective',
    title: 'Selective',
    width: 99,
    cell: ({ isSelective }) =>
      isSelective === null ? '' : html`<span class="${isSelective ? 'tick' : 'cross'}"></span>`,
    exportText: (row) => String(row.relativeCost ?? ''),
    tooltip: ({ isSelective, relativeCost }) => {
      const title =
        isSelective === null
          ? 'Selectivity could not be determined.'
          : isSelective
            ? 'Query is selective.'
            : 'Query is not selective.';
      return relativeCost ? `${title}\nRelative cost: ${relativeCost}` : title;
    },
    // A query with no plan sorts last either way.
    sort: { value: (row) => (row.isSelective === null ? null : (row.relativeCost ?? 0)) },
    sortFirst: 'desc',
  };
}

function soqlColumns(rows: readonly SOQLRow[]): GridColumn<SOQLRow>[] {
  return [
    statementColumn({
      id: 'soql',
      title: 'SOQL',
      value: (row) => row.soql,
      dialect: 'soql',
      sortFirst: 'asc',
    }),
    selectiveColumn(),
    textColumn({
      id: 'objectType',
      title: 'Object',
      value: (row) => row.objectType,
      width: 110,
      hidden: true,
      hoverText: true,
      empty: '—',
    }),
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
    countColumn({
      id: 'aggregations',
      title: 'Aggregations',
      value: (row) => row.aggregations,
      width: 121,
    }),
    countColumn({
      id: 'relativeCost',
      title: 'Relative Cost',
      value: (row) => row.relativeCost,
      width: 92,
      hidden: true,
      summed: false,
    }),
    textColumn({
      id: 'leadingOperationType',
      title: 'Leading Operation',
      value: (row) => row.leadingOperationType,
      width: 140,
      hidden: true,
      hoverText: true,
    }),
    textColumn({
      id: 'sObjectType',
      title: 'SObject Type',
      value: (row) => row.sObjectType,
      width: 130,
      hidden: true,
      hoverText: true,
    }),
    countColumn({
      id: 'cardinality',
      title: 'Cardinality',
      value: (row) => row.cardinality,
      width: CARDINALITY_WIDTH,
      hidden: true,
      summed: false,
    }),
    countColumn({
      id: 'sObjectCardinality',
      title: 'SObject Cardinality',
      value: (row) => row.sObjectCardinality,
      width: CARDINALITY_WIDTH,
      hidden: true,
      summed: false,
    }),
    textColumn({
      id: 'fields',
      title: 'Indexed Fields',
      value: (row) => row.fields,
      width: 140,
      hidden: true,
      hoverText: true,
    }),
    // Time sits at the far right.
    timeTakenColumn(rows),
  ];
}

@customElement('soql-view')
export class SOQLView extends StatementGrid<SOQLRow, SOQLExecuteBeginLine> {
  constructor() {
    super({
      type: 'soql',
      views: SOQL_VIEWS,
      placeholder: 'No SOQL queries found',
      facets: [
        { label: 'Object', value: (row) => row.objectType },
        { label: 'Namespace', value: (row) => row.namespace },
      ],
      groups: [
        { label: 'SOQL', value: (row) => row.soql },
        { label: 'Object', value: (row) => row.objectType ?? '' },
        { label: 'Namespace', value: (row) => row.namespace },
        { label: 'Caller Namespace', value: (row) => row.callerNamespace },
        { label: 'None', value: null },
      ],
      columns: soqlColumns,
    });
  }

  protected toRows(lines: readonly SOQLExecuteBeginLine[]): SOQLRow[] {
    return lines.map((soql) => {
      const plan = soql.children[0];
      return {
        eventIndex: soql.eventIndex,
        soql: soql.text,
        isSelective: plan?.relativeCost ? plan.relativeCost <= 1 : null,
        relativeCost: plan?.relativeCost ?? null,
        namespace: soql.namespace,
        callerNamespace: getCallerNamespace(soql),
        rowCount: soql.soqlRowCount.self,
        timeTaken: soql.duration.total,
        aggregations: soql.aggregations,
        objectType: deriveSoqlObject(soql),
        leadingOperationType: plan?.leadingOperationType ?? null,
        sObjectType: plan?.sObjectType ?? null,
        cardinality: plan?.cardinality ?? null,
        sObjectCardinality: plan?.sObjectCardinality ?? null,
        fields: plan?.fields?.join(', ') ?? null,
      };
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'soql-view': SOQLView;
  }
}
