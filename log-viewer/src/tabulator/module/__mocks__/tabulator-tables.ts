// __mocks__/tabulator-tables.ts
export class Module {
  constructor(table?: any) {
    // this.table = table;
  }
  registerTableOption() {}
}

// Minimal stub of tabulator's `Renderer` base class. The real one (in
// tabulator_esm.mjs:23488) reads table.rowManager.element / tableElement
// and stores them as properties; we replicate that shape so tests of a
// concrete renderer subclass can construct without touching real DOM.
export class Renderer {
  table: any;
  elementVertical: any;
  elementHorizontal: any;
  tableElement: any;
  verticalFillMode = 'fit';
  constructor(table?: any) {
    this.table = table;
    this.elementVertical = table?.rowManager?.element ?? null;
    this.elementHorizontal = table?.columnManager?.element ?? null;
    this.tableElement = table?.rowManager?.tableElement ?? null;
  }
  // Mirrors real Renderer.styleRow (tabulator_esm.mjs:23582) including its
  // inverted naming quirk (index % 2 → "even" class). Optional-chained so
  // node-env suites with plain-object row elements (no classList) stay safe.
  styleRow(row: any, index: number) {
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
