/*
 * Copyright (c) 2024 Certinia Inc. All rights reserved.
 */
import { Module, type GroupComponent, type RowComponent, type Tabulator } from 'tabulator-tables';

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
  _currentMatchIndex = 0;
  _matchIndexes: { [key: number]: RowComponent } = {};

  constructor(table: Tabulator) {
    super(table);
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('find', this._find.bind(this));
    this.registerTableFunction('clearFindHighlights', this._clearFindHighlights.bind(this));
    // @ts-expect-error registerTableFunction() needs adding to tabulator types
    this.registerTableFunction('setCurrentMatch', this._setCurrentMatch.bind(this));
  }

  initialize() {
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

    const findOptions = findArgs.options;
    let searchString = findOptions.matchCase ? findArgs.text : findArgs.text.toLowerCase();
    searchString = searchString.replaceAll(/[[\]*+?{}.()^$|\\-]/g, '\\$&');
    const regex = new RegExp(searchString, `g${findArgs.options.matchCase ? '' : 'i'}`);

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
    if (searchString) {
      const len = flattenedRows.length;
      for (let i = 0; i < len; i++) {
        const row = flattenedRows[i];
        if (!row) {
          continue;
        }

        const data = row.getData();
        data.highlightIndexes = [];
        row.getCells().forEach((cell) => {
          const elem = cell.getElement();
          const matchCount = this._countMatches(elem, regex);
          if (matchCount) {
            for (let k = 0; k < matchCount; k++) {
              totalMatches++;
              data.highlightIndexes.push(totalMatches);
              result.matchIndexes[totalMatches] = row;
            }
          }
        });
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

    const findOptions = this._findArgs.options;
    let searchString = findOptions.matchCase
      ? this._findArgs.text
      : this._findArgs.text.toLowerCase();
    searchString = searchString.replaceAll(/[[\]*+?{}.()^$|\\-]/g, '\\$&');
    const regex = new RegExp(searchString, `g${findOptions.matchCase ? '' : 'i'}`);

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
        this._walkTextNodes(elem, (textNode) => {
          const text = textNode.textContent;
          if (!text) {
            return;
          }

          regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(text)) !== null) {
            const highlightIndex = data.highlightIndexes?.[matchIdx];
            matchIdx++;

            const range = new Range();
            range.setStart(textNode, match.index);
            range.setEnd(textNode, match.index + match[0].length);

            if (highlightIndex === this._currentMatchIndex) {
              Find._currentHighlight!.add(range);
              this._myCurrentRanges.push(range);
            } else {
              Find._findHighlight!.add(range);
              this._myFindRanges.push(range);
            }
          }
        });
      });
    }

    // Re-attach highlights — browser applies all ranges in a single paint
    CSS.highlights.set('find-match', Find._findHighlight!);
    CSS.highlights.set('current-find-match', Find._currentHighlight!);
  }

  _clearFindHighlights() {
    this._clearInstanceRanges();
    this._findArgs = null;
    this._currentMatchIndex = 0;
    this._matchIndexes = {};
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

  _countMatches(elem: Node, regex: RegExp): number {
    let count = 0;
    this._walkTextNodes(elem, (textNode) => {
      const text = textNode.textContent;
      if (!text) {
        return;
      }
      const match = text.match(regex);
      count += match?.length ?? 0;
    });
    return count;
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
}
