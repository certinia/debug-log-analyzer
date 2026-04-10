/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import {
  Module,
  type CellComponent,
  type ColumnComponent,
  type GroupComponent,
  type RowComponent,
  type Tabulator,
} from 'tabulator-tables';

type FindArgs = { text: string; count: number; options: { matchCase: boolean } };
type GoToRowOptions = { scrollIfVisible: boolean; focusRow: boolean };

export class Find extends Module {
  static moduleName = 'FindModule';

  // Shared across all Find instances — one per highlight type
  static _findHighlight: Highlight | null = null;
  static _currentHighlight: Highlight | null = null;

  // Per-instance range tracking for cleanup without affecting other instances
  _myFindRanges: Range[] = [];
  _myCurrentRanges: Range[] = [];
  _findArgs: FindArgs | null = null;
  _cachedRegex: RegExp | null = null;
  _currentMatchIndex = 0;
  _matchIndexes: { [key: number]: RowComponent } = {};

  // Headless formatter execution: single detached element (never in the document)
  // and a per-row-field text cache keyed by the stable row-data object reference.
  _mockSearchElem: HTMLElement = document.createElement('div');
  _cellTextCache: WeakMap<object, Map<string, string>> = new WeakMap();

  // Reusable mock cell — mutable fields updated before each formatter call.
  _mcData: object = {};
  _mcValue: unknown = undefined;
  _mcField = '';
  _mcColumn: ColumnComponent | null = null;
  _mockCell: CellComponent = this._createMockCell();

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('find', this._find.bind(this));
    this.registerTableFunction('clearFindHighlights', this._clearFindHighlights.bind(this));
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('setCurrentMatch', this._setCurrentMatch.bind(this));
  }

  initialize() {
    // Reset the text cache whenever a new dataset is loaded so stale entries
    // from the previous log never pollute a fresh search.
    this.table.on('tableBuilt', () => {
      this._cellTextCache = new WeakMap();
    });

    this.table.on('tableDestroyed', () => {
      this._clearFindHighlights();
    });

    this.table.on('renderComplete', () => {
      if (this._findArgs?.text) {
        this._applyHighlights();
      }
    });

    // Virtual scroll doesn't fire renderComplete, so listen for scroll events
    // to apply highlights to newly visible rows. Debounced to avoid blocking
    // the main thread during fast scrolling, plus scrollend for instant final update.
    const holder = this.table.element.querySelector('.tabulator-tableholder');
    if (holder) {
      let rafId: number | null = null;
      holder.addEventListener('scroll', () => {
        if (!this._findArgs?.text) {
          return;
        }
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null;
            this._applyHighlights();
          });
        }
      });

      holder.addEventListener('scrollend', () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (this._findArgs?.text) {
          this._applyHighlights();
        }
      });
    }
  }

  async _find(findArgs: FindArgs) {
    const result: { totalMatches: number; matchIndexes: { [key: number]: RowComponent } } = {
      totalMatches: 0,
      matchIndexes: {},
    };

    this._clearInstanceRanges();
    this._currentMatchIndex = 0;
    this._matchIndexes = {};

    // We only do this when groups exist to get row order
    const flattenFromGrps = (row: GroupComponent): RowComponent[] => {
      const mergedArray: RowComponent[] = [];
      Array.prototype.push.apply(mergedArray, row.getRows());
      row
        .getSubGroups()
        .flatMap(flattenFromGrps)
        .forEach((child: RowComponent) => {
          mergedArray.push(child);
        });
      return mergedArray;
    };

    const tbl = this.table;
    const grps = tbl.getGroups().flatMap(flattenFromGrps);
    const flattenedRows: RowComponent[] = grps.length ? grps : this._getRows(tbl.getRows('active'));

    const regex = this._buildRegex(findArgs);

    // Reset highlightIndexes on all rows (no reformat needed with CSS Highlight API)
    for (const row of flattenedRows) {
      const data = row.getData();
      if (!data.highlightIndexes) {
        data.highlightIndexes = [];
      } else {
        data.highlightIndexes.length = 0;
      }
    }

    let totalMatches = 0;
    if (regex) {
      // Avoid row.getCells() — for uninitialized off-screen rows it calls generateCells()
      // which creates a DOM element per cell (document.createElement). For 10k rows that
      // is O(rows × cols) element creation before a single search character is matched.
      // Instead iterate columnsByIndex directly, which is the same array generateCells()
      // would use, avoiding all Cell object and DOM element creation.
      // columnManager.getRealColumns() is internal — returns columnsByIndex, same order as getCells()
      const internalCols: Array<{
        field: string;
        getComponent: () => ColumnComponent;
        getFieldValue: (data: object) => unknown;
        modules?: {
          format?: {
            formatter?: (
              cell: CellComponent,
              params: object,
              onRendered: () => void,
            ) => string | HTMLElement;
            params?: object | ((cell: CellComponent) => object);
          };
        };
      }> = this.table.columnManager?.getRealColumns?.() ?? [];

      const len = flattenedRows.length;
      for (let i = 0; i < len; i++) {
        const row = flattenedRows[i];
        if (!row) {
          continue;
        }

        const data = row.getData();
        data.highlightIndexes = [];

        let rowCache = this._cellTextCache.get(data as object);
        if (!rowCache) {
          rowCache = new Map<string, string>();
          this._cellTextCache.set(data as object, rowCache);
        }

        for (const col of internalCols) {
          const field = col.field;
          if (!field) continue;

          let text = rowCache.get(field);
          if (text === undefined) {
            text = this._runFormatterForColumn(
              data as object,
              field,
              col.getFieldValue(data as object),
              col.getComponent(),
              col.modules?.format,
            );
            rowCache.set(field, text);
          }

          regex.lastIndex = 0;
          const matchCount = text.match(regex)?.length ?? 0;
          if (matchCount) {
            for (let k = 0; k < matchCount; k++) {
              totalMatches++;
              data.highlightIndexes.push(totalMatches);
              result.matchIndexes[totalMatches] = row;
            }
          }
        }
      }
    }

    result.totalMatches = totalMatches;
    this._findArgs = findArgs;
    this._matchIndexes = result.matchIndexes;
    this._applyHighlights();

    return result;
  }

  async _setCurrentMatch(index: number, row?: RowComponent, goToRowOpts?: GoToRowOptions) {
    this._currentMatchIndex = index;
    if (this._findArgs) {
      this._findArgs.count = index;
    }
    this._applyHighlights();

    if (row) {
      try {
        // @ts-expect-error goToRow is a custom function added by RowNavigation module
        await this.table.goToRow(row, goToRowOpts);
      } finally {
        this._applyHighlights();
      }
    }
  }

  _applyHighlights() {
    // Lazy-init static Highlights
    if (!Find._findHighlight) {
      Find._findHighlight = new Highlight();
    }
    if (!Find._currentHighlight) {
      Find._currentHighlight = new Highlight();
    }

    // Detach highlights during modification to prevent per-range style recalc
    CSS.highlights.delete('find-match');
    CSS.highlights.delete('current-find-match');

    // Clear this instance's old ranges from the shared Highlights
    this._clearInstanceRanges();

    if (!this._findArgs?.text) {
      CSS.highlights.set('find-match', Find._findHighlight);
      CSS.highlights.set('current-find-match', Find._currentHighlight);
      return;
    }

    const regex = this._cachedRegex;
    if (!regex) {
      CSS.highlights.set('find-match', Find._findHighlight);
      CSS.highlights.set('current-find-match', Find._currentHighlight);
      return;
    }

    const rows = this._getRenderedRows();
    for (const row of rows) {
      // Skip GroupComponents — they don't have getData
      if (typeof row.getData !== 'function') {
        continue;
      }

      const data = row.getData();

      let matchIdx = 0;
      row.getCells().forEach((cell) => {
        const elem = cell.getElement();
        // Build a flat text-node map so we can create Ranges that span across
        // adjacent elements (e.g. two <span>s whose text forms a single match).
        const { text: fullText, nodes: textNodeMap } = this._buildTextNodeMap(elem);
        if (!fullText) return;

        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(fullText)) !== null) {
          const highlightIndex = data.highlightIndexes?.[matchIdx];
          matchIdx++;

          const range = this._createMatchRange(
            textNodeMap,
            match.index,
            match.index + match[0].length,
          );
          if (!range) continue;

          if (highlightIndex === this._currentMatchIndex) {
            Find._currentHighlight!.add(range);
            this._myCurrentRanges.push(range);
          } else {
            Find._findHighlight!.add(range);
            this._myFindRanges.push(range);
          }
        }
      });
    }

    // Re-attach highlights — browser applies all ranges in a single paint
    CSS.highlights.set('find-match', Find._findHighlight!);
    CSS.highlights.set('current-find-match', Find._currentHighlight!);
  }

  _clearFindHighlights() {
    this._clearInstanceRanges();
    this._findArgs = null;
    this._cachedRegex = null;
    this._currentMatchIndex = 0;
    this._matchIndexes = {};
  }

  _buildRegex(findArgs: FindArgs): RegExp | null {
    if (!findArgs.text) {
      this._cachedRegex = null;
      return null;
    }
    let searchString = findArgs.options.matchCase ? findArgs.text : findArgs.text.toLowerCase();
    searchString = searchString.replaceAll(/[[\]*+?{}.()^$|\\-]/g, '\\$&');
    this._cachedRegex = new RegExp(searchString, `g${findArgs.options.matchCase ? '' : 'i'}`);
    return this._cachedRegex;
  }

  _clearInstanceRanges() {
    for (const range of this._myFindRanges) {
      Find._findHighlight?.delete(range);
    }
    for (const range of this._myCurrentRanges) {
      Find._currentHighlight?.delete(range);
    }
    this._myFindRanges = [];
    this._myCurrentRanges = [];
  }

  _walkTextNodes(node: Node, callback: (textNode: Text) => void) {
    const children =
      //@ts-expect-error renderRoot does not exist on node and we should probably not access it but there is no other option at the moment
      (node.childNodes?.length ? node.childNodes : node.renderRoot?.childNodes) ?? [];
    const len = children.length;
    for (let i = 0; i < len; i++) {
      const cur = children[i];
      if (!cur) {
        continue;
      }
      if (cur.nodeType === 1) {
        this._walkTextNodes(cur, callback);
      } else if (cur.nodeType === 3) {
        callback(cur as Text);
      }
    }
  }

  _getRenderedRows(): RowComponent[] {
    // Returns all rendered rows including buffer (not just viewport).
    // This allows highlights to be applied to off-screen buffer rows,
    // eliminating the "pop in" effect when they scroll into view.
    const renderer = this.table.rowManager?.renderer;
    if (renderer && renderer.vDomTop !== undefined) {
      const displayRows = this.table.rowManager.getDisplayRows();
      return displayRows
        .slice(renderer.vDomTop, renderer.vDomBottom + 1)
        .map((row: { getComponent: () => RowComponent }) => row.getComponent());
    }
    return this.table.getRows('visible');
  }

  _getRows(rows: RowComponent[]): RowComponent[] {
    const isDataTreeEnabled = this.table.modules.dataTree && this.table.options.dataTreeFilter;
    if (!isDataTreeEnabled) {
      return rows;
    }

    const children: RowComponent[] = [];
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

    for (const internalChild of internalChildren) {
      const childComp: RowComponent = internalChild.getComponent();
      output.push(childComp);

      const subChildren = this._getFilteredChildren(childComp);
      subChildren.forEach((sub) => {
        output.push(sub);
      });
    }

    return output;
  }

  // Collects all text nodes under root with their cumulative byte offsets into a
  // flat array, plus the concatenated full text.  Used by _applyHighlights so
  // that a single regex match can span multiple sibling elements.
  _buildTextNodeMap(root: Node): { text: string; nodes: Array<{ node: Text; start: number }> } {
    const nodes: Array<{ node: Text; start: number }> = [];
    let offset = 0;
    this._walkTextNodes(root, (textNode) => {
      nodes.push({ node: textNode, start: offset });
      offset += textNode.textContent?.length ?? 0;
    });
    return { text: nodes.map((n) => n.node.textContent ?? '').join(''), nodes };
  }

  // Creates a Range covering [matchStart, matchEnd) in the text-node map
  // produced by _buildTextNodeMap.  Supports ranges that cross node boundaries.
  _createMatchRange(
    nodes: Array<{ node: Text; start: number }>,
    matchStart: number,
    matchEnd: number,
  ): Range | null {
    const range = new Range();
    let startSet = false;

    for (const { node, start } of nodes) {
      const nodeEnd = start + (node.textContent?.length ?? 0);

      if (!startSet && matchStart < nodeEnd) {
        range.setStart(node, matchStart - start);
        startSet = true;
      }

      if (startSet && matchEnd <= nodeEnd) {
        range.setEnd(node, matchEnd - start);
        return range;
      }
    }

    return null;
  }

  // Runs the column formatter headlessly for a given row data + column, without
  // requiring a CellComponent. This avoids row.getCells(), which triggers
  // generateCells() and DOM element creation for every uninitialized off-screen row.
  // Results are cached by (rowData, field) and reused on repeat searches.
  _createMockCell(): CellComponent {
    const mockElem = this._mockSearchElem;
    return {
      getElement: () => mockElem,
      getData: () => this._mcData,
      getValue: () => this._mcValue,
      getInitialValue: () => this._mcValue,
      getField: () => this._mcField,
      getRow: () => ({ getData: () => this._mcData }) as unknown as RowComponent,
      getColumn: () => this._mcColumn!,
      checkHeight: () => {},
      edit: () => {},
      cancelEdit: () => {},
      isEdited: () => false,
      clearEdited: () => {},
      isValid: () => true,
      clearValidation: () => {},
      validate: () => true,
      popup: () => {},
    } as unknown as CellComponent;
  }

  _runFormatterForColumn(
    data: object,
    field: string,
    value: unknown,
    columnComponent: ColumnComponent,
    fmt:
      | {
          formatter?: (
            cell: CellComponent,
            params: object,
            onRendered: () => void,
          ) => string | HTMLElement;
          params?: object | ((cell: CellComponent) => object);
        }
      | undefined,
  ): string {
    if (!fmt?.formatter) {
      return String(value ?? '');
    }

    this._mcData = data;
    this._mcValue = value;
    this._mcField = field;
    this._mcColumn = columnComponent;

    const mockCell = this._mockCell;
    const resolvedParams =
      typeof fmt.params === 'function' ? fmt.params(mockCell) : (fmt.params ?? {});

    let result: string | HTMLElement | undefined;
    try {
      const ctx: object = this.table.modules?.format ?? { table: this.table };
      result = fmt.formatter.call(ctx, mockCell, resolvedParams, () => {});
    } catch {
      return String(value ?? '');
    }

    if (typeof result === 'string') {
      if (result.includes('<') && result.includes('>')) {
        const mockElem = this._mockSearchElem;
        mockElem.innerHTML = result;
        const text = mockElem.textContent ?? '';
        mockElem.textContent = '';
        return text;
      }

      return result;
    }

    return result?.textContent ?? '';
  }
}
