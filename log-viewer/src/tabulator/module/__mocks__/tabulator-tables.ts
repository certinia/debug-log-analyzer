/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Jest applies this to every log-viewer suite that resolves `tabulator-tables`, whether
 * or not the suite asks. That is why nothing references it and it reads as dead: delete
 * it and the suites subclassing `Module` or `Renderer` fail with
 * `Class extends value undefined`.
 *
 * The real package cannot load at all under jest. Its `require` condition resolves to
 * the UMD build, whose export is the bare `TabulatorFull` class, so `Module`, `Renderer`
 * and `Tabulator` are all undefined. A suite needing more than the two classes below
 * passes its own factory, which overrides this.
 *
 * Keep `Tabulator` out of here. `registerModule` writes a process-wide registry, so
 * stubbing it for every suite would let a module register nothing and say nothing.
 */
export class Module {
  constructor(_table?: unknown) {
    // this.table = table;
  }
  registerTableOption() {}
}

// Minimal stub of tabulator's `Renderer` base class. The real one (in
// tabulator_esm.mjs:23488) reads table.rowManager.element / tableElement
// and stores them as properties; we replicate that shape so tests of a
// concrete renderer subclass can construct without touching real DOM.
interface MockTable {
  rowManager?: { element?: unknown; tableElement?: unknown; getDisplayRows?: () => unknown[] };
  columnManager?: { element?: unknown };
  eventBus?: { dispatch?: (...args: unknown[]) => void };
}
interface MockRowEl {
  getElement: () => { classList?: DOMTokenList };
}
export class Renderer {
  table?: MockTable;
  elementVertical: unknown;
  elementHorizontal: unknown;
  tableElement: unknown;
  verticalFillMode = 'fit';
  constructor(table?: MockTable) {
    this.table = table;
    this.elementVertical = table?.rowManager?.element ?? null;
    this.elementHorizontal = table?.columnManager?.element ?? null;
    this.tableElement = table?.rowManager?.tableElement ?? null;
  }
  // Mirrors real Renderer.styleRow (tabulator_esm.mjs:23582) including its
  // inverted naming quirk (index % 2 → "even" class). Optional-chained so
  // node-env suites with plain-object row elements (no classList) stay safe.
  styleRow(row: MockRowEl, index: number) {
    const rowEl = row.getElement();
    if (index % 2) {
      rowEl.classList?.add('tabulator-row-even');
      rowEl.classList?.remove('tabulator-row-odd');
    } else {
      rowEl.classList?.add('tabulator-row-odd');
      rowEl.classList?.remove('tabulator-row-even');
    }
  }
  rows() {
    return this.table?.rowManager?.getDisplayRows?.() ?? [];
  }
  // Mirrors CoreFeature.dispatch (tabulator_esm.mjs:78) — chains to the
  // table's eventBus so tests can spy on internal events like
  // 'render-virtual-fill'.
  dispatch(...args: unknown[]) {
    this.table?.eventBus?.dispatch?.(...args);
  }
}
