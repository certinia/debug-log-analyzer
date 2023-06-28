import '../../resources/css/DatabaseView.scss';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { RootNode, TimedNode } from '../parsers/TreeParser';
import Number from '../datagrid/format/Number';

export async function renderAnalysis(rootMethod: RootNode) {
  const methodMap: Map<string, Metric> = new Map();

  addNodeToMap(methodMap, rootMethod);
  const metricList = [...methodMap.values()];

  const analysisTable = new Tabulator('#analysisTable', {
    data: metricList,
    layout: 'fitColumns',
    placeholder: 'No Analysis Available',
    columnCalcs: 'both',
    height: '100%',
    groupClosedShowCalcs: true,
    groupStartOpen: false,
    groupToggleElement: 'header',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
    },
    initialSort: [{ column: 'selfTime', dir: 'desc' }],
    columns: [
      {
        title: 'Name',
        field: 'name',
        headerSortStartingDir: 'asc',
        sorter: 'string',
        tooltip: true,
        bottomCalc: () => {
          return 'Total';
        },
        widthGrow: 5,
      },
      {
        title: 'Type',
        field: 'type',
        headerSortStartingDir: 'asc',
        width: 150,
        sorter: 'string',
        tooltip: true,
      },
      {
        title: 'Count',
        field: 'count',
        sorter: 'number',
        width: 65,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
      },
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        bottomCalcFormatter: Number,
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
      },
      {
        title: 'Self Time (ms)',
        field: 'selfTime',
        sorter: 'number',
        width: 100,
        hozAlign: 'right',
        headerHozAlign: 'right',
        bottomCalc: 'sum',
        bottomCalcFormatterParams: { precision: 3 },
        formatter: Number,
        formatterParams: {
          thousand: false,
          precision: 3,
        },
        bottomCalcFormatter: Number,
      },
    ],
  });

  document.getElementById('analysis-groupBy')?.addEventListener('change', (event) => {
    const checkBox = event.target as HTMLInputElement;
    analysisTable.setGroupBy(checkBox.checked ? 'type' : '');
  });
}

export class Metric {
  name: string;
  type: string;
  count = 0;
  totalTime = 0;
  selfTime = 0;

  constructor(name: string, node: TimedNode) {
    this.name = name;
    this.type = node.type;
  }
}

function addNodeToMap(map: Map<string, Metric>, node: TimedNode, key?: string) {
  const children = node.children;

  if (key) {
    const totalTime = node.duration;
    const selfTime = node.selfTime;
    let metric = map.get(key);
    if (!metric) {
      metric = new Metric(key, node);
      map.set(key, metric);
    }

    ++metric.count;
    metric.totalTime += totalTime;
    metric.selfTime += selfTime;
  }

  children.forEach(function (child) {
    if (child instanceof TimedNode) {
      addNodeToMap(map, child, child.text);
    }
  });
}
