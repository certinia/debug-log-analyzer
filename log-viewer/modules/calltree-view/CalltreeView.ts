import '../../resources/css/DatabaseView.scss';
import '../../resources/css/TreeView.css';

import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { LogLine, RootNode, TimedNode } from '../parsers/TreeParser';

export async function renderCallTree(rootMethod: RootNode) {
  new Tabulator('#calltreeTable', {
    data: toCallTree(rootMethod.children),
    layout: 'fitColumns',
    placeholder: 'No Calltree Available',
    columnCalcs: 'both',
    height: '100%',
    maxHeight: '100%',
    dataTree: true,
    dataTreeBranchElement: '<span/>',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
    },
    columns: [
      {
        title: 'Name',
        field: 'text',
        // variableHeight: true,
        headerSortTristate: true,
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        widthGrow: 5,
      },
      {
        title: 'DML Count',
        field: 'totalDmlCount',
        sorter: 'number',
        width: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'SOQL Count',
        field: 'totalSoqlCount',
        sorter: 'number',
        width: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Throws Count',
        field: 'totalThrownCount',
        sorter: 'number',
        width: 60,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Total Time (ms)',
        field: 'duration',
        sorter: 'number',
        headerSortTristate: true,
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: (cell, _formatterParams, _onRendered) => {
          return '' + Math.round(((cell.getValue() || 0) / 1000000) * 1000) / 1000;
        },
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        bottomCalcFormatter: (cell, _formatterParams, _onRendered) => {
          return '' + Math.round(((cell.getValue() || 0) / 1000000) * 1000) / 1000;
        },
        bottomCalc: 'sum',
        bottomCalcParams: { precision: 3 },
      },
      {
        title: 'Self Time (ms)',
        field: 'selfTime',
        sorter: 'number',
        headerSortTristate: true,
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
        bottomCalcParams: { precision: 3 },
        bottomCalcFormatter: (cell, _formatterParams, _onRendered) => {
          return '' + Math.round(((cell.getValue() || 0) / 1000000) * 1000) / 1000;
        },
        formatter: (cell, _formatterParams, _onRendered) => {
          return '' + Math.round(((cell.getValue() || 0) / 1000000) * 1000) / 1000;
        },
        formatterParams: {
          thousand: false,
          precision: 3,
        },
      },
    ],
  });
}

function toCallTree(nodes: LogLine[]): CalltreeRow[] | undefined {
  const len = nodes.length;
  if (!len) {
    return undefined;
  }

  const results: CalltreeRow[] = [];
  for (let i = 0; i < len; i++) {
    const node = nodes[i];
    const isTimedNode = node instanceof TimedNode;
    const children = isTimedNode ? toCallTree(node.children) : null;
    const data: CalltreeRow = {
      text: node.text,
      duration: node.duration,
      selfTime: node.selfTime,
      _children: children,
      totalDmlCount: 0,
      totalSoqlCount: 0,
      totalThrownCount: 0,
      originalData: node,
    };

    if (isTimedNode) {
      data.totalDmlCount = node.totalDmlCount;
      data.totalSoqlCount = node.totalSoqlCount;
      data.totalThrownCount = node.totalThrownCount;
    }

    results.push(data);
  }
  return results;
}

interface CalltreeRow {
  originalData: LogLine;
  text: string;
  duration: number;
  selfTime: number;
  _children: CalltreeRow[] | undefined | null;
  totalDmlCount: number;
  totalSoqlCount: number;
  totalThrownCount: number;
}
