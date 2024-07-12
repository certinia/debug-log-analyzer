/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import {
  CellComponent,
  FormatModule,
  Module,
  type ColumnComponent,
  type RowComponent,
  type Tabulator,
} from 'tabulator-tables';

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
    const cols = tbl.getColumns();
    const len = flattenedRows.length;

    const searchRegex = searchString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(searchRegex, `g${findArgs.options.matchCase ? 'i' : ''}`);

    const rowsToReformat = [];

    const columnFormatters = this._columnsToValFinder(cols);
    const colFormattersLen = columnFormatters.length;
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
      for (let j = 0; j < colFormattersLen; j++) {
        const colFormatter = columnFormatters[j];
        if (!colFormatter) {
          continue;
        }

        colFormatter.data = data;
        colFormatter.row = row;
        colFormatter.value = data[colFormatter.columnComponent.getField()];

        let val = colFormatter.getFormattedValue();
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
      }

      if (reformat && !clearHighlight) {
        // data.highlightIndexs = ++highlightIndex;
        // row.update({ isHighlighted: true });
        rowsToReformat.push(row);
        // row.normalizeHeight();
      }
    }
    rowsToReformat.forEach((row) => {
      row?.reformat();
    });
    tbl.restoreRedraw();

    result.totalMatches = totalMatches;
    return result;
  }

  _getCellValue(component: CellComponent) {
    const rawCell = component._getSelf();
    const val = rawCell.chain('cell-format', rawCell, null, () => {
      return rawCell.value;
    });

    if (val instanceof Node) {
      return val.textContent?.trim();
    }

    return val?.toString();
  }

  _columnsToValFinder(cols: ColumnComponent[]) {
    const valFinders: FakeCell[] = [];

    const formatterDiv = document.createElement('div');
    const formatModule = new FormatModule(this.table);
    cols.forEach((col) => {
      const sCell = new FakeCell();
      sCell.element = formatterDiv;
      sCell.setColumn(col);
      sCell.formatter = sCell.format.formatter.bind(formatModule);
      valFinders.push(sCell);
    });
    return valFinders;
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
  const data = row.getData();
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

class FakeCell {
  row;
  element;
  value;
  data;
  column;
  columnComponent;
  format;
  formatter;

  static regexForHTML = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*>(.*?)<\/\1>/;

  getRow() {
    return this.row;
  }
  getElement() {
    return this.element;
  }

  getValue() {
    return this.value;
  }

  getData() {
    return this.data;
  }

  getComponent() {
    return this;
  }

  getFormattedValue(): string {
    const params =
      typeof this.format.params === 'function' ? this.format.params(this) : this.format.params;

    let val = this.formatter(this, params);
    if (val instanceof Node) {
      val = val.textContent?.trim();
    } else {
      // val = val.toString();

      val = val
        .toString()
        .replace(/<[^>]+>/g, '')
        .trim();
    }
    return val;
  }

  setColumn(col: ColumnComponent) {
    this.columnComponent = col;
    this.column = col._getSelf();
    this.format = this.column.modules.format;
  }

  // getTable(){

  // }
}
