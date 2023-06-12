import '../../resources/css/DatabaseView.scss';
import { TabulatorFull as Tabulator } from 'tabulator-tables';
import { RootNode, TimedNode } from '../parsers/TreeParser';

// todo: Group on type
// todo: Prettify type e.g "System Method" instead of "SYSTEM_METHOD_ENTRY"
export async function renderAnalysis(rootMethod: RootNode) {
  const methodMap: Map<string, Metric> = new Map();

  addNodeToMap(methodMap, rootMethod);
  const metricList = [...methodMap.values()];

  new Tabulator('#analysisTable', {
    //set initial table data
    data: metricList,
    layout: 'fitColumns',
    placeholder: 'No Analysis Available',
    columnCalcs: 'both',
    height: '100%',
    columnDefaults: {
      title: 'default',
      resizable: true,
      headerSortStartingDir: 'desc',
      headerTooltip: true,
    },
    initialSort: [{ column: 'selfTime', dir: 'desc' }],
    renderVerticalBuffer: 1500,
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
        sorter: 'string',
        tooltip: true,
      },
      { title: 'Count', field: 'count', sorter: 'number', width: 110, bottomCalc: 'sum' },
      {
        title: 'Total Time (ms)',
        field: 'totalTime',
        sorter: 'number',
        // width: 110,
        bottomCalc: 'max',
        bottomCalcParams: { precision: 2 },
      },
      {
        title: 'Self Time (ms)',
        field: 'selfTime',
        sorter: 'number',
        // width: 110,
        bottomCalc: 'sum',
        bottomCalcParams: { precision: 2 },
      },
    ],
  });
}

export class Metric {
  name: string;
  type: string;
  count: number;
  totalTime: number;
  selfTime: number;

  constructor(name: string, count: number, totalTime: number, selfTime: number, node: TimedNode) {
    this.name = name;
    this.count = count;
    this.totalTime = totalTime;
    this.selfTime = selfTime;
    this.type = node.type;
  }
}

function addNodeToMap(map: Map<string, Metric>, node: TimedNode, key?: string) {
  const children = node.children;

  if (key) {
    const totalTime = node.duration / 1000000;
    const selfTime = node.selfTime / 1000000;
    const metric = map.get(key);
    if (metric) {
      ++metric.count;
      if (totalTime) {
        metric.totalTime = Math.round((metric.totalTime + totalTime) * 100) / 100;
        metric.selfTime = Math.round((metric.selfTime + selfTime) * 100) / 100;
      }
    } else {
      map.set(
        key,
        new Metric(
          key,
          1,
          Math.round(totalTime * 100) / 100,
          Math.round(selfTime * 100) / 100,
          node
        )
      );
    }
  }

  children.forEach(function (child) {
    if (child instanceof TimedNode) {
      addNodeToMap(map, child, child.text);
    }
  });
}
