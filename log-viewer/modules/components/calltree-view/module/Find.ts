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
    const regex = new RegExp(searchString, `g${findArgs.options.matchCase ? '' : 'i'}`);
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
        const matchCount = this._countMatches(elem, findArgs, regex);
        if (matchCount) {
          const kLen = matchCount;
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

  _countMatches(elem: Node, findArgs: FindArgs, regex: RegExp) {
    let count = 0;
    const children =
      (elem.childNodes?.length ? elem.childNodes : elem.renderRoot?.childNodes) ?? [];
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const cur = children[i];
      if (!cur) {
        continue;
      }

      if (cur.nodeType === 1) {
        count += this._countMatches(cur, findArgs, regex);
      } else if (cur.nodeType === 3) {
        const originalText = cur.textContent;
        if (!originalText) {
          continue;
        }
        const match = originalText.match(regex);
        count += match?.length ?? 0;
      }
    }
    return count;
  }
}

export function formatter(row: RowComponent, findArgs: FindArgs) {
  if (!findArgs.text || !row.getData()) {
    return;
  }
  // escape special charcters
  const data = row.getData() ?? row.data;
  row.getCells().forEach((cell) => {
    const cellElem = cell.getElement();
    _highlightText(cellElem, findArgs, { indexes: data.highlightIndexes, currentMatch: 0 });
  });

  if (row._getSelf().type !== 'calc') {
    row.normalizeHeight();
  }
}

function _highlightText(
  elem: Node,
  findArgs: FindArgs,
  highlights: { indexes: number[]; currentMatch: number },
) {
  const searchText = findArgs.options.matchCase ? findArgs.text : findArgs.text.toLowerCase();
  const matchHighlightIndex = findArgs.count;

  const children = (elem.childNodes?.length ? elem.childNodes : elem.renderRoot?.childNodes) ?? [];
  const len = children.length;
  for (let i = 0; i < len; i++) {
    const cur = children[i];
    if (!cur) {
      continue;
    }

    if (cur.nodeType === 1) {
      _highlightText(cur, findArgs, highlights);
    } else if (cur.nodeType === 3) {
      const parentNode = cur.parentNode;
      let originalText = cur.textContent;
      if (!originalText) {
        continue;
      }

      let matchIndex = (
        findArgs.options.matchCase ? originalText : originalText?.toLowerCase()
      )?.indexOf(searchText);
      while (matchIndex > -1) {
        const hightlightIndex = highlights.indexes[highlights.currentMatch++];

        const endOfMatchIndex = matchIndex + searchText.length;
        const matchingText = originalText.substring(matchIndex, endOfMatchIndex);

        const highlightSpan = document.createElement('span');
        highlightSpan.style.backgroundColor =
          hightlightIndex === matchHighlightIndex ? '#8B8000' : 'yellow';
        highlightSpan.textContent = matchingText;
        if (parentNode.isEqualNode(highlightSpan)) {
          break;
        }

        if (matchIndex > 0) {
          const beforeText = originalText.substring(0, matchIndex);
          const beforeTextElem = document.createElement('text');
          beforeTextElem.textContent = beforeText;
          parentNode?.insertBefore(beforeTextElem, cur);
        }
        parentNode?.insertBefore(highlightSpan, cur);

        const endText = originalText.substring(endOfMatchIndex, originalText.length);
        if (!endText.length) {
          parentNode?.removeChild(cur);
          break;
        }
        cur.textContent = endText;
        originalText = endText;
        matchIndex = (
          findArgs.options.matchCase ? originalText : originalText?.toLowerCase()
        )?.indexOf(searchText);
      }
    }
  }
}

type FindArgs = { text: string; count: number; options: { matchCase: boolean } };
