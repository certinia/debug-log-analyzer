/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import formatDuration from './Util';
import { RootNode, TimedNode } from './parsers/TreeParser';

type SortKey = 'count' | 'duration' | 'selfTime' | 'name';

const nestedSort: Map<SortKey, SortKey[]> = new Map([
  ['count', ['count', 'duration', 'name']],
  ['duration', ['duration', 'count', 'name']],
  ['selfTime', ['selfTime', 'count', 'name']],
  ['name', ['name', 'count', 'duration']],
]);
const div = document.createElement('div');
const span = document.createElement('span');
const boldElem = document.createElement('b');
let totalDuration = 0;

let metricList: Metric[];

export class Metric {
  name: string;
  count: number;
  duration: number;
  selfTime: number;

  constructor(name: string, count: number, duration: number, selfTime: number) {
    this.name = name;
    this.count = count;
    this.duration = duration;
    this.selfTime = selfTime;
  }
}

function addNodeToMap(map: Map<string, Metric>, node: TimedNode, key?: string) {
  const children = node.children;

  if (key) {
    const metric = map.get(key);
    if (metric) {
      ++metric.count;
      if (node.duration) {
        metric.duration += node.duration;
        metric.selfTime += node.selfTime;
      }
    } else {
      map.set(key, new Metric(key, 1, node.duration, node.selfTime));
    }
  }

  children.forEach(function (child) {
    if (child instanceof TimedNode) {
      addNodeToMap(map, child, child.group || child.text);
    }
  });
}

export default function analyseMethods(rootMethod: RootNode) {
  const methodMap: Map<string, Metric> = new Map();

  totalDuration = rootMethod.executionEndTime - rootMethod.timestamp;
  addNodeToMap(methodMap, rootMethod);
  metricList = [...methodMap.values()];
  return metricList; // return value for unit testing
}

function entrySort(sortField: SortKey, sortAscending: boolean, a: Metric, b: Metric) {
  let result;
  let x: number | string, y: number | string;

  switch (sortField) {
    case 'count':
      x = a.count;
      y = b.count;
      break;
    case 'duration':
      x = a.duration;
      y = b.duration;
      break;
    case 'selfTime':
      x = a.selfTime;
      y = b.selfTime;
      break;
    default:
      x = a.name;
      y = b.name;
      break;
  }
  // compare with undefined handling (we get undefined durations when the log is truncated - so treat as high)
  if (x === y) {
    result = 0;
  } else if (x === undefined) {
    result = 1;
  } else if (y === undefined) {
    result = -1;
  } else if (x < y) {
    result = -1;
  } else {
    result = 1;
  }
  return sortAscending ? result : -result;
}

function nestedSorter(type: SortKey, sortAscending: boolean, a: Metric, b: Metric) {
  const sortOrder = nestedSort.get(type) || [];

  const len = sortOrder.length;
  for (let i = 0; i < len; ++i) {
    const result = entrySort(sortOrder[i], sortAscending, a, b);
    if (result !== 0) {
      return result;
    }
  }

  return 0;
}

function renderAnalysisLine(
  name: string,
  count: string,
  duration: string,
  selfTime: string,
  isBold = false
) {
  const nameCell = highlightTextNode(name, isBold) as HTMLElement;
  nameCell.className = 'name';
  nameCell.title = name;

  const countCell = highlightTextNode(count, isBold) as HTMLElement;
  countCell.className = 'count';

  const durationCell = highlightTextNode(duration, isBold) as HTMLElement;
  durationCell.className = 'duration';

  const selfTimeCell = highlightTextNode(selfTime, isBold) as HTMLElement;
  selfTimeCell.className = 'selfTime';

  const analysisRow = div.cloneNode() as HTMLDivElement;
  analysisRow.className = isBold ? 'row' : 'row data';
  analysisRow.appendChild(nameCell);
  analysisRow.appendChild(countCell);
  analysisRow.appendChild(durationCell);
  analysisRow.appendChild(selfTimeCell);
  return analysisRow;
}

function highlightTextNode(text: string, isBold: boolean) {
  const highlightNode = isBold ? boldElem.cloneNode() : span.cloneNode();
  highlightNode.textContent = text;
  return highlightNode;
}

export async function renderAnalysis() {
  const sortFieldElm = document.getElementById('sortField') as HTMLSelectElement,
    sortField = sortFieldElm.value as SortKey,
    sortAscendingElm = document.getElementById('sortAscending') as HTMLInputElement,
    sortAscending = sortAscendingElm?.checked,
    analysisHeader = document.getElementById('analysisHeader'),
    analysisHolder = document.getElementById('analysis'),
    analysisFooter = document.getElementById('analysisFooter');

  metricList.sort(function (a, b) {
    return nestedSorter(sortField, sortAscending, a, b);
  });

  if (analysisHeader && analysisFooter && analysisHolder) {
    analysisHeader.innerHTML = '';
    analysisHeader.appendChild(
      renderAnalysisLine('Method Name', 'Count', 'Total Time', 'Self Time', true)
    );

    analysisHolder.innerHTML = '';
    let totalCount = 0,
      totalSelfTime = 0;
    metricList.forEach(function (metric) {
      const duration = metric.duration ? formatDuration(metric.duration) : '-',
        selfTime = metric.selfTime ? formatDuration(metric.selfTime) : '-';

      analysisHolder.appendChild(
        renderAnalysisLine(metric.name, '' + metric.count, duration, selfTime)
      );
      totalCount += metric.count;
      totalSelfTime += metric.selfTime;
    });

    if (totalDuration) {
      analysisFooter.innerHTML = '';
      analysisFooter.appendChild(
        renderAnalysisLine(
          'Total',
          '' + totalCount,
          formatDuration(totalDuration),
          formatDuration(totalSelfTime),
          true
        )
      );
    }
  }
}

function onSortChange(): void {
  renderAnalysis();
}

function onInitAnalysis(): void {
  const sortField = document.getElementById('sortField'),
    sortAscending = document.getElementById('sortAscending');

  sortField?.addEventListener('change', onSortChange);
  sortAscending?.addEventListener('change', onSortChange);
}

window.addEventListener('DOMContentLoaded', onInitAnalysis);
