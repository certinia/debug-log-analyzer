/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import {
  Module,
  type CellComponent,
  type GroupComponent,
  type RowComponent,
  type Tabulator,
} from 'tabulator-tables';

export class Find extends Module {
  static moduleName = 'FindModule';

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('find', this._find.bind(this));
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('clearFindHighlights', this._clearFindHighlights.bind(this));
  }

  initialize() {}

  _find(findArgs: FindArgs) {
    const result: { totalMatches: number; matchIndexes: { [key: number]: RowComponent } } = {
      totalMatches: 0,
      matchIndexes: {},
    };

    this._clearMatches();

    const flattenFromGrps = (row: GroupComponent): RowComponent[] => {
      const mergedArray: RowComponent[] = [];
      Array.prototype.push.apply(mergedArray, row.getRows());
      row
        .getSubGroups()
        .flatMap(flattenFromGrps)
        .forEach((child) => {
          mergedArray.push(child);
        });
      return mergedArray;
    };

    const tbl = this.table;
    const grps = tbl.getGroups().flatMap(flattenFromGrps);
    const flattenedRows = grps.length ? grps : this._getRows(tbl.getRows('active'));

    const findOptions = findArgs.options;
    let searchString = findOptions.matchCase ? findArgs.text : findArgs.text.toLowerCase();
    searchString = searchString.replaceAll(/[[\]*+?{}.()^$|\\-]/g, '\\$&');
    const regex = new RegExp(searchString, `g${findArgs.options.matchCase ? '' : 'i'}`);

    tbl.blockRedraw();
    let totalMatches = 0;
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

      row.getCells().forEach((cell: CellComponent) => {
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

  _clearFindHighlights(rows: RowComponent[]) {
    this.table.blockRedraw();
    for (const row of rows) {
      const data = row.getData();
      data.highlightIndexes = [];
      row.reformat();
    }
    this.table.restoreRedraw();
  }

  _countMatches(elem: Node, findArgs: FindArgs, regex: RegExp) {
    let count = 0;

    const children =
      //@ts-expect-error renderRoot does not exist on node and we should probably not access it but there is no other option at the moment
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

  _getRows(rows: RowComponent[]) {
    const isDataTreeEnabled = this.table.modules.dataTree && this.table.options.dataTreeFilter;
    if (!isDataTreeEnabled) {
      return rows;
    }

    const children = [];
    for (const row of rows) {
      children.push(row);
      for (const child of this._getFilteredChildren(row)) {
        children.push(child);
      }
    }
    return children;
  }

  _getFilteredChildren(row: RowComponent): RowComponent[] {
    const output: RowComponent[] = [];

    const filtering = this.table.modules.filter;
    const sorting = this.table.options.dataTreeSort ? this.table.modules.sort : null;
    let internalChildren = [];
    for (const child of row.getTreeChildren()) {
      //@ts-expect-error This is private to tabulator, but we have no other choice atm.
      internalChildren.push(child._getSelf());
    }
    internalChildren = filtering.filter(internalChildren);
    if (sorting) {
      sorting.sort(internalChildren, true);
    }

    const filteredChildren = [];
    for (const internalChild of internalChildren) {
      const childComp: RowComponent = internalChild.getComponent();
      filteredChildren.push(childComp);
      output.push(childComp);

      const subChildren = this._getFilteredChildren(childComp);
      subChildren.forEach((sub) => {
        output.push(sub);
      });
    }

    return output;
  }

  _clearMatches() {
    const matches = this.table.element.querySelectorAll('.currentFindMatch, .findMatch');
    for (const elm of matches) {
      const previous = elm.previousSibling;
      const next = elm.nextSibling;
      if (previous) {
        const newText = (previous.textContent ?? '') + elm.textContent;
        previous.textContent = newText;

        if (next) {
          const newText = (previous.textContent ?? '') + next.textContent;
          previous.textContent = newText;
        }
        elm.remove();
      } else {
        if (next) {
          const newText = (elm.textContent ?? '') + next.textContent;
          elm.textContent = newText;
          next.remove();
        }
        elm.classList.remove('currentFindMatch', 'findMatch');
      }
    }
  }
}

export function formatter(row: RowComponent, findArgs: FindArgs) {
  const { text, count } = findArgs;
  if (!text || !count || !row.getData() || !row.getData().highlightIndexes?.length) {
    return;
  }

  const data = row.getData();
  const highlights = {
    indexes: data.highlightIndexes,
    currentMatch: 0,
  };

  row.getCells().forEach((cell) => {
    const cellElem = cell.getElement();
    _highlightText(cellElem, findArgs, highlights);
  });
}

function _highlightText(
  elem: Node,
  findArgs: FindArgs,
  highlights: { indexes: number[]; currentMatch: number },
) {
  const searchText = findArgs.options.matchCase ? findArgs.text : findArgs.text.toLowerCase();
  const matchHighlightIndex = findArgs.count;

  //@ts-expect-error renderRoot does not exist on node and we should probably not access it but there is no other option at the moment
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
        highlightSpan.className =
          hightlightIndex === matchHighlightIndex ? 'currentFindMatch' : 'findMatch';
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
