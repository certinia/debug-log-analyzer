/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, { highlightText } from "./Util";
import { totalDuration } from "./parsers/LineParser";
import { RootNode } from "./parsers/TreeParser";
import { LogLine } from "./parsers/LineParser";

const nestedSort: Record<string, string[]> = {
  count: ["count", "duration", "name"],
  duration: ["duration", "count", "name"],
  netDuration: ["netDuration", "count", "name"],
  name: ["name", "count", "duration"],
};

let metricList: Metric[];

export class Metric {
  name: string;
  count: number;
  duration: number;
  netDuration: number;

  constructor(
    name: string,
    count: number,
    duration: number,
    netDuration: number
  ) {
    this.name = name;
    this.count = count;
    this.duration = duration;
    this.netDuration = netDuration;
  }
}

function addNodeToMap(
  map: Record<string, Metric>,
  node: LogLine,
  key?: string
) {
  const children = node.children;

  if (key) {
    let metric = map[key];
    if (metric) {
      ++metric.count;
      if (node.duration) {
        metric.duration += node.duration;
        metric.netDuration += node.netDuration || 0;
      }
    } else {
      map[key] = new Metric(key, 1, node.duration || 0, node.netDuration || 0);
    }
  }

  if (children) {
    children.forEach(function (child) {
      addNodeToMap(map, child, child.group || child.text);
    });
  }
}

export default async function analyseMethods(rootMethod: RootNode) {
  const methodMap = {};

  addNodeToMap(methodMap, rootMethod);
  metricList = Object.values(methodMap);
  return metricList; // return value for unit testing
}

function entrySort(
  sortField: string,
  sortAscending: boolean,
  a: Metric,
  b: Metric
) {
  let result;
  let x: any, y: any;

  switch (sortField) {
    case "count":
      x = a.count;
      y = b.count;
      break;
    case "duration":
      x = a.duration;
      y = b.duration;
      break;
    case "netDuration":
      x = a.netDuration;
      y = b.netDuration;
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

function nestedSorter(
  type: string,
  sortAscending: boolean,
  a: Metric,
  b: Metric
) {
  const sortOrder = nestedSort[type];

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
  netDuration: string,
  isBold: boolean = false
) {
  const analysisRow = document.createElement("div"),
    nameText = highlightText(name, isBold),
    nameCell = document.createElement("span"),
    countText = highlightText(count, isBold),
    countCell = document.createElement("span"),
    durationText = highlightText(duration, isBold),
    durationCell = document.createElement("span"),
    netDurationText = highlightText(netDuration, isBold),
    netDurationCell = document.createElement("span");

  nameCell.className = "name";
  nameCell.innerHTML = nameText;
  nameCell.title = nameText;
  countCell.className = "count";
  countCell.innerHTML = countText;
  durationCell.className = "duration";
  durationCell.innerHTML = durationText;
  netDurationCell.className = "netDuration";
  netDurationCell.innerHTML = netDurationText;

  analysisRow.className = isBold ? "row" : "row data";
  analysisRow.appendChild(nameCell);
  analysisRow.appendChild(countCell);
  analysisRow.appendChild(durationCell);
  analysisRow.appendChild(netDurationCell);
  return analysisRow;
}

export async function renderAnalysis() {
  const sortFieldElm = document.getElementById(
      "sortField"
    ) as HTMLSelectElement,
    sortField = sortFieldElm?.value,
    sortAscendingElm = document.getElementById(
      "sortAscending"
    ) as HTMLInputElement,
    sortAscending = sortAscendingElm?.checked,
    analysisHeader = document.getElementById("analysisHeader"),
    analysisHolder = document.getElementById("analysis"),
    analysisFooter = document.getElementById("analysisFooter");

  metricList.sort(function (a, b) {
    return nestedSorter(sortField, sortAscending, a, b);
  });

  if (analysisHeader && analysisFooter && analysisHolder) {
    analysisHeader.innerHTML = "";
    analysisHeader.appendChild(
      renderAnalysisLine(
        "Method Name",
        "Count",
        "Total Duration",
        "Net duration",
        true
      )
    );

    analysisHolder.innerHTML = "";
    let totalCount = 0,
      totalNetDuration = 0;
    metricList.forEach(function (metric) {
      var duration = metric.duration ? formatDuration(metric.duration) : "-",
        netDuration = metric.netDuration
          ? formatDuration(metric.netDuration)
          : "-";

      analysisHolder.appendChild(
        renderAnalysisLine(
          metric.name,
          "" + metric.count,
          duration,
          netDuration
        )
      );
      totalCount += metric.count;
      totalNetDuration += metric.netDuration;
    });

    if (totalDuration) {
      analysisFooter.innerHTML = "";
      analysisFooter.appendChild(
        renderAnalysisLine(
          "Total",
          "" + totalCount,
          formatDuration(totalDuration),
          formatDuration(totalNetDuration),
          true
        )
      );
    }
  }
}

function onSortChange(evt: Event) {
  renderAnalysis();
}

function onInitAnalysis(evt: Event) {
  const sortField = document.getElementById("sortField"),
    sortAscending = document.getElementById("sortAscending");

  sortField?.addEventListener("change", onSortChange);
  sortAscending?.addEventListener("change", onSortChange);
}

window.addEventListener("DOMContentLoaded", onInitAnalysis);
