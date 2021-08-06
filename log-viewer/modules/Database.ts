/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */

import { RootNode } from "./parsers/TreeParser";
import { LogLine } from "./parsers/LineParser";

class DatabaseEntry {
  count: number = 0;
  rowCount: number = 0;
}

type DatabaseMap = Record<string, DatabaseEntry>;

let dmlMap: DatabaseMap, soqlMap: DatabaseMap;

function updateEntry(map: Record<string, DatabaseEntry>, child: LogLine) {
  let entry = map[child.text];

  if (!entry) {
    entry = map[child.text] = new DatabaseEntry();
  }
  entry.count += 1;
  entry.rowCount += child.rowCount || 0;
}

function findDb(node: LogLine, dmlMap: DatabaseMap, soqlMap: DatabaseMap) {
  const children = node.children;

  if (children) {
    for (let i = 0; i < children.length; ++i) {
      const child = children[i];

      switch (child.type) {
        case "DML_BEGIN":
          updateEntry(dmlMap, child);
          break;
        case "SOQL_EXECUTE_BEGIN":
          updateEntry(soqlMap, child);
          break;
      }

      if (child.displayType === "method") {
        findDb(child, dmlMap, soqlMap);
      }
    }
  }
}

export default async function analyseDb(rootMethod: RootNode) {
  dmlMap = {};
  soqlMap = {};

  findDb(rootMethod, dmlMap, soqlMap);
  return {
    // return value for unit testing
    dmlMap,
    soqlMap,
  };
}

/**
 * entryMap: key => count
 * sort by descending count then ascending key
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
      countNode = document.createElement("span"),
      rowsNode = document.createElement("span"),
      nameNode = document.createElement("span"),
      entry = entryMap[key];

    totalCount += entry.count;
    totalRows += entry.rowCount;
    entryNode.className = "dbEntry";
    countNode.className = "dbCount";
    countNode.innerText = "Count: x" + entry.count;
    rowsNode.className = "dbCount";
    rowsNode.innerText = "Rows: x" + entry.rowCount;
    nameNode.className = "dbName";
    nameNode.innerText = key.substr(key.indexOf(" ") + 1);
    nameNode.title = key;
    entryNode.appendChild(countNode);
    entryNode.appendChild(rowsNode);
    entryNode.appendChild(nameNode);
    block.appendChild(entryNode);
  });

  titleNode.innerText =
    title + " (Count: x" + totalCount + ", Rows: x" + totalRows + ")";
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
