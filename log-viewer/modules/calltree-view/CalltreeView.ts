// todo: add breakcrumbs back? - I will do this but in a later PR + better
//
//todo: ** future **
//todo: show total and self as percentage of total? + do the same on the analysis view?
//todo: add class to locate current tree for current log
//todo: add filter on line type
//todo: add filter on log level (fine, finer etc)
import { RowComponent, TabulatorFull as Tabulator } from 'tabulator-tables';

import { rootMethod } from '../Main';
import MinMaxEditor from '../datagrid/editors/MinMax';
import MinMaxFilter from '../datagrid/filters/MinMax';
import NumberFormat from '../datagrid/format/Number';
import { RowKeyboardNavigation } from '../datagrid/module/RowKeyboardNavigation';
import { RowNavigation } from '../datagrid/module/RowNavigation';
import { LogLine, RootNode, TimedNode } from '../parsers/TreeParser';
import { hostService } from '../services/VSCodeService';
import './TreeView.scss';

let calltreeTable: Tabulator;

export function initCalltree(rootMethod: RootNode) {
  const callTreeView = document.getElementById('call-tree-view');
  if (callTreeView) {
    const analysisObserver = new IntersectionObserver((entries, observer) => {
      const visible = entries[0].isIntersecting;
      if (visible) {
        renderCallTree(rootMethod);
        observer.disconnect();
      }
    });
    analysisObserver.observe(callTreeView);
  }
}

export async function renderCallTree(rootMethod: RootNode): Promise<void> {
  if (calltreeTable) {
    await new Promise((resolve, reject) => {
      const visibilityObserver = new IntersectionObserver((entries, observer) => {
        const visible = entries[0].isIntersecting && entries[0].intersectionRatio > 0;
        if (visible) {
          resolve(true);
          observer.disconnect();
        } else {
          reject();
        }
      });

      visibilityObserver.observe(calltreeTable.element);
    });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    Tabulator.registerModule([RowKeyboardNavigation, RowNavigation]);

    const selfTimeFilterCache = new Map<string, boolean>();
    const totalTimeFilterCache = new Map<string, boolean>();
    calltreeTable = new Tabulator('#call-tree-table', {
      data: toCallTree(rootMethod.children),
      layout: 'fitColumns',
      placeholder: 'No Call Tree Available',
      columnCalcs: 'both',
      height: '100%',
      maxHeight: '100%',
      dataTree: true,
      // @ts-expect-error: needs to be added to type definition.
      dataTreeChildColumnCalcs: true,
      dataTreeBranchElement: '<span/>',
      selectable: 1,
      rowKeyboardNavigation: true,
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
          bottomCalc: () => {
            return 'Total';
          },
          formatter: (cell, _formatterParams, _onRendered) => {
            const cellElem = cell.getElement();
            cellElem.classList.add('datagrid-textarea');

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
          title: 'Rows',
          field: 'rows',
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
          formatter: NumberFormat,
          formatterParams: {
            thousand: false,
            precision: 3,
          },
          bottomCalcFormatter: NumberFormat,
          bottomCalc: 'sum',
          bottomCalcParams: { precision: 3 },
          headerFilter: MinMaxEditor,
          headerFilterFunc: MinMaxFilter,
          headerFilterFuncParams: { columnName: 'duration', filterCache: totalTimeFilterCache },
          headerFilterLiveFilter: false,
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
          bottomCalcFormatter: NumberFormat,
          formatter: NumberFormat,
          formatterParams: {
            thousand: false,
            precision: 3,
          },
          headerFilter: MinMaxEditor,
          headerFilterFunc: MinMaxFilter,
          headerFilterFuncParams: { columnName: 'selfTime', filterCache: selfTimeFilterCache },
          headerFilterLiveFilter: false,
        },
      ],
    });

    calltreeTable.on('dataFiltered', () => {
      totalTimeFilterCache.clear();
      selfTimeFilterCache.clear();
    });

    document.getElementById('calltree-show-details')?.addEventListener('change', (event) => {
      const showDetails = event.target as HTMLInputElement;
      calltreeTable.setFilter((data, _filterParams) => {
        return showDetails.checked || data.originalData.duration || data.originalData.discontinuity;
      });
    });

    document.getElementById('call-tree-expand-btn')?.addEventListener('click', () => {
      calltreeTable.blockRedraw();
      expandAll(calltreeTable.getRows());
      calltreeTable.restoreRedraw();
    });

    document.getElementById('call-tree-collapse-btn')?.addEventListener('click', () => {
      calltreeTable.blockRedraw();
      collapseAll(calltreeTable.getRows());
      calltreeTable.restoreRedraw();
    });

    calltreeTable.on('tableBuilt', () => {
      resolve();
      calltreeTable.setFilter((data, _filterParams) => {
        return data.originalData.duration || data.originalData.discontinuity;
      });
    });
  });
}

function expandAll(rows: RowComponent[]) {
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    row.treeExpand();

    expandAll(row.getTreeChildren());
  }
}

function collapseAll(rows: RowComponent[]) {
  const len = rows.length;
  for (let i = 0; i < len; i++) {
    const row = rows[i];
    row.treeCollapse();

    collapseAll(row.getTreeChildren());
  }
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
      id: node.timestamp,
      text: node.text,
      duration: node.duration,
      selfTime: node.selfTime,
      _children: children,
      totalDmlCount: node.totalDmlCount,
      totalSoqlCount: node.totalSoqlCount,
      totalThrownCount: node.totalThrownCount,
      rows: node.totalRowCount || 0,
      originalData: node,
    };

    results.push(data);
  }
  return results;
}

export async function goToRow(timestamp: number) {
  document.dispatchEvent(new CustomEvent('show-tab', { detail: { tabid: 'tree-tab' } }));
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
  //@ts-expect-error This is a custom function added in by RowNavigation custom module
  calltreeTable.goToRow(treeRow);
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
  id: number;
  originalData: LogLine;
  text: string;
  duration: number;
  selfTime: number;
  _children: CalltreeRow[] | undefined | null;
  totalDmlCount: number;
  totalSoqlCount: number;
  totalThrownCount: number;
  rows: number;
}
