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
  styleRow() {}
  rows() {
    return this.table?.rowManager?.getDisplayRows?.() ?? [];
  }
}
