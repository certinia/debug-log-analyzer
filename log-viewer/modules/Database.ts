/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { html, render } from "lit";
import { RootNode } from "./parsers/TreeParser";
import { LogLine } from "./parsers/LineParser";
import { showTab, showTreeNode } from "./Util";
class DatabaseEntry {
  count: number = 0;
  rowCount: number = 0;
  callers: LogLine[] = [];
}

type DatabaseMap = Record<string, DatabaseEntry>;

let dmlMap: DatabaseMap, soqlMap: DatabaseMap;

function updateEntry(
  map: Record<string, DatabaseEntry>,
  child: LogLine,
  stack: LogLine[]
) {
  let entry = map[child.text];

  if (!entry) {
    entry = map[child.text] = new DatabaseEntry();
  }
  entry.count += 1;
  entry.rowCount += child.rowCount || 0;
  entry.callers.push(stack[stack.length - 1]);
}

function findDb(
  node: LogLine,
  dmlMap: DatabaseMap,
  soqlMap: DatabaseMap,
  stack: LogLine[]
) {
  const children = node.children;

  if (children) {
    for (let i = 0; i < children.length; ++i) {
      const child = children[i];
      switch (child.type) {
        case "DML_BEGIN":
          updateEntry(dmlMap, child, stack);
          break;
        case "SOQL_EXECUTE_BEGIN":
          updateEntry(soqlMap, child, stack);
          break;
      }

      if (child.displayType === "method") {
        stack.push(child);
        findDb(child, dmlMap, soqlMap, stack);
        stack.pop();
      }
    }
  }
}

export default async function analyseDb(rootMethod: RootNode) {
  dmlMap = {};
  soqlMap = {};

  findDb(rootMethod, dmlMap, soqlMap, []);
  return {
    // return value for unit testing
    dmlMap,
    soqlMap,
  };
}

/**
 * entryMap: key => count
 * sort by descending count or rowCount then ascending key
 */
function getKeyList(entryMap: DatabaseMap) {
  const keyList = Object.keys(entryMap);
  keyList.sort((k1, k2) => {
    const countDiff = entryMap[k2].count - entryMap[k1].count;
    if (countDiff !== 0) {
      return countDiff;
    }
    const rowDiff = entryMap[k2].rowCount - entryMap[k1].rowCount;
    if (rowDiff !== 0) {
      return rowDiff;
    }
    return k1.localeCompare(k2);
  });
  return keyList;
}

const rowTemplate = (key: string, entry: DatabaseEntry) =>
  html`<query-row count=${entry.count} rowCount=${entry.rowCount} query=${key.substr(key.indexOf(" ") + 1)}/>`;

const callerTemplate = (node: LogLine) =>
  html`<div
    @click=${onCallerClick}
    class="stackEntry"
  >
    <a data-timestamp="${node.timestamp}">${node.text}</a>
  </div>`;

function onCallerClick(evt: any) {
  const target = evt.target as HTMLElement;
  const dataTimestamp = target.getAttribute("data-timestamp");
  if (dataTimestamp) {
    showTreeNode(parseInt(dataTimestamp));
  }
}

function renderSummary(title: string, entryMap: DatabaseMap) {
  const mainNode = document.createElement("div"),
    titleNode = document.createElement("div"),
    block = document.createElement("div"),
    keyList = getKeyList(entryMap);

  block.className = "dbBlock";
  let totalCount = 0,
    totalRows = 0;
  keyList.forEach((key) => {
    const entryNode = document.createElement("div"),
      entry = entryMap[key];
    render(rowTemplate(key, entry), entryNode);
    block.appendChild(entryNode);
    totalCount += entry.count;
    totalRows += entry.rowCount;
  });

  titleNode.innerText =
    title + " (Count: " + totalCount + ", Rows: " + totalRows + ")";
  titleNode.className = "dbTitle";

  mainNode.className = "dbSection";
  mainNode.appendChild(titleNode);
  mainNode.appendChild(block);

  return mainNode;
}

export async function renderDb() {
  const dbContainer = document.getElementById("dbContent");

  if (dbContainer) {
    dbContainer.innerHTML = "";
    dbContainer.appendChild(renderSummary("DML Statements", dmlMap));
    dbContainer.appendChild(renderSummary("SOQL Statements", soqlMap));
  }
}
