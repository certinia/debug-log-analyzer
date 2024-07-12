/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Module, type RowComponent, type Tabulator } from 'tabulator-tables';

export class Find extends Module {
  static moduleName = 'FindModule';

  constructor(table: Tabulator) {
    super(table);
    this.registerTableFunction('find', this._find.bind(this));
  }

  initialize() {}

  _find(findArgs: FindArgs) {
    const result = {
      totalMatches: 0,
      matchIndexes: {},
    };

    const tbl = this.table;
    if (!tbl?.element.clientHeight) {
      return;
    }

    const findOptions = findArgs.options;

    const searchString = findOptions.matchCase ? findArgs.text : findArgs.text.toLowerCase();

    let totalMatches = 0;

    const flatten = (row: RowComponent): RowComponent[] => {
      const mergedArray = [row];
      row
        .getTreeChildren()
        .flatMap(flatten)
        .forEach((child) => {
          mergedArray.push(child);
        });
      return mergedArray;
    };

    // Only get the currently visible rows
    const rows = tbl.getRows('active');
    const flattenedRows = rows.flatMap(flatten);

    tbl.blockRedraw();
    const regex = new RegExp(searchString, `g${findArgs.options.matchCase ? 'i' : ''}`);
    const rowsToReformat = [];
    const len = flattenedRows.length;
    for (let i = 0; i < len; i++) {
      const row = flattenedRows[i];
      if (!row) {
        continue;
      }

      let clearHighlight = false;
      const data = row.getData();
      if (data.highlightIndexes?.length) {
        clearHighlight = true;
        rowsToReformat.push(row);
      }

      data.highlightIndexes = [];

      if (!searchString) {
        continue;
      }
      let reformat = false;

      row.getCells().forEach((cell) => {
        const elem = cell.getElement();
        let val = elem?.textContent?.trim() ?? '';
        if (!findArgs.options.matchCase) {
          val = val.toLowerCase();
        }
        if (val.includes(searchString)) {
          const match = val.match(regex);
          const kLen = match?.length ?? 0;
          for (let k = 0; k < kLen; k++) {
            totalMatches++;
            data.highlightIndexes.push(totalMatches);
            result.matchIndexes[totalMatches] = row;
          }
          reformat = true;
        }
      });

      if (reformat && !clearHighlight) {
        rowsToReformat.push(row);
      }
    }
    rowsToReformat.forEach((row) => {
      row?.reformat();
    });
    tbl.restoreRedraw();

    result.totalMatches = totalMatches;
    return result;
  }
}

export function formatter(row: RowComponent, findArgs: FindArgs) {
  if (!findArgs.text || !row.getData()) {
    return;
  }
  const searchText = findArgs.options.matchCase ? findArgs.text : findArgs.text.toLowerCase();
  // escape special charcters
  const searchAsHTML = _escapeHtml(searchText);
  const searchRegex = searchAsHTML.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(searchRegex, `g${findArgs.options.matchCase ? '' : 'i'}`);
  let i = 0;
  const data = row.getData() ?? row.data;
  const matchIndex = findArgs.count;
  row.getCells().forEach((cell) => {
    const cellElem = cell.getElement();
    const val = cellElem.innerHTML ?? '';

    if (
      findArgs.options.matchCase
        ? val.includes(searchAsHTML)
        : val.toLowerCase().includes(searchAsHTML)
    ) {
      const resultString = val.replace(regex, (match) => {
        const highlightIndex = data.highlightIndexes[i++];
        return highlightIndex === matchIndex
          ? `<span style="background-color:#8B8000;border:1px solid lightgrey">${match}</span>`
          : `<span style="background-color:yellow;border:1px solid lightgrey">${match}</span>`;
      });
      cellElem.innerHTML = resultString;
    }
  });
}

function _escapeHtml(unsafe: string) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

type FindArgs = { text: string; count: number; options: { matchCase: boolean } };
