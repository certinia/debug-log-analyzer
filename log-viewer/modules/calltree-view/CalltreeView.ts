import '../../resources/css/DatabaseView.scss';
import '../../resources/css/TreeView.css';

import { RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';
import { LogLine, RootNode, TimedNode } from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import { showTab } from '../Util';
import { rootMethod } from '../Main';

let calltreeTable: Tabulator;

export async function renderCallTree(rootMethod: RootNode): Promise<void> {
  if (calltreeTable) {
    return Promise.resolve();
  }

  calltreeTable = new Tabulator('#calltreeTable', {
    data: toCallTree(rootMethod.children),
    layout: 'fitColumns',
    placeholder: 'No Calltree Available',
    columnCalcs: 'both',
    height: '100%',
    maxHeight: '100%',
    dataTree: true,
    dataTreeBranchElement: '<span/>',
    selectable: 1,
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
        headerSortTristate: true,
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        formatter: (cell, _formatterParams, _onRendered) => {
          const cellElem = cell.getElement();
          cellElem.classList.add('data-grid-textarea');

          const row = cell.getRow();
          // @ts-expect-error: _row is private. This is temporary and I will patch the text wrap behaviour in the library.
          const treeLevel = row._row.modules.dataTree.index;
          const indent = row.getTable().options.dataTreeChildIndent || 0;
          const levelIndent = treeLevel * indent;
          cellElem.style.paddingLeft = `${levelIndent + 4}px`;
          cellElem.style.textIndent = `-${levelIndent}px`;

          const node = (cell.getData() as CalltreeRow).originalData;
          const text = node.text + (node.lineNumber ? `:${node.lineNumber}` : '');
          if (node.hasValidSymbols) {
            const logLineBody = document.createElement('a');
            logLineBody.href = '#';
            logLineBody.textContent = text;
            return logLineBody;
          }

          const textWrapper = document.createElement('span');
          textWrapper.appendChild(document.createTextNode(text));
          return textWrapper;
        },
        variableHeight: true,
        cellClick: (e, cell) => {
          if (!(e.target as HTMLElement).matches('a')) {
            return;
          }
          const node = (cell.getData() as CalltreeRow).originalData;
          if (node.hasValidSymbols) {
            const text = node.text;
            const lineNumber = node.lineNumber ? '-' + node.lineNumber : '';
            const bracketIndex = text.indexOf('(');
            const qname = bracketIndex > -1 ? text.substring(0, bracketIndex) : text;

            let typeName;
            if (node.type === 'METHOD_ENTRY') {
              const lastDot = qname.lastIndexOf('.');
              typeName = text.substring(0, lastDot) + lineNumber;
            } else {
              typeName = qname + lineNumber;
            }

            const fileOpenInfo = {
              typeName: typeName,
              text: text,
            };
            hostService().openType(fileOpenInfo);
          }
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

  return new Promise((resolve) => {
    calltreeTable.on('tableBuilt', () => {
      resolve();
    });
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

export async function goToRow(timestamp: number) {
  showTab('treeTab');
  await renderCallTree(rootMethod);

  let treeRow: RowComponent | null = null;

  const rows = calltreeTable.getRows();
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    treeRow = findByTime(row, timestamp);
    if (treeRow) {
      break;
    }
  }

  if (treeRow) {
    const rowsToExpand = [];
    let parent = treeRow.getTreeParent();
    while (parent && !parent.isTreeExpanded()) {
      rowsToExpand.push(parent);
      parent = parent.getTreeParent();
    }

    calltreeTable.blockRedraw();
    if (rowsToExpand.length) {
      const len = rowsToExpand.length;
      for (let i = 0; i < len; i++) {
        const row = rowsToExpand[i];
        row.treeExpand();
      }
    }

    calltreeTable.getSelectedRows().map((row) => {
      row.deselect();
    });

    treeRow.select();
    calltreeTable.restoreRedraw();
    calltreeTable.scrollToRow(treeRow, 'center');
  }
}

function findByTime(row: RowComponent, timeStamp: number): RowComponent | null {
  if (timeStamp) {
    const node = (row.getData() as CalltreeRow).originalData;
    if (node.timestamp === timeStamp) {
      return row;
    }
    if (node instanceof TimedNode) {
      // do not search children is the timestamp is outside of the parents timeframe
      if (node.exitStamp && !(timeStamp >= node.timestamp && timeStamp <= node.exitStamp)) {
        return null;
      }

      const treeChildren = row.getTreeChildren();
      const len = treeChildren.length;
      for (let i = 0; i < len; ++i) {
        const child = treeChildren[i];

        const target = findByTime(child, timeStamp);
        if (target) {
          return target;
        }
      }
    }
  }
  return null;
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
