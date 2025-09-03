import { Module, type GroupComponent, type Tabulator } from 'tabulator-tables';

export class GroupCalcs extends Module {
  static moduleName = 'groupCalcs';

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption('groupCalcs', false);
  }

  initialize() {
    // @ts-expect-error groupCalcs
    if (this.table.options.groupCalcs && !this.table.options.groupHeader) {
      this.table.options.groupHeader = this.groupHeader;
    }
  }

  groupHeader(value: unknown, count: number, data: unknown, group: GroupComponent) {
    // @ts-expect-error private function to the raw group instead of wrapper component
    const rawGroup = group._getSelf();
    const columnCalcs = group.getTable().modules.columnCalcs;

    const row = columnCalcs.generateBottomRow(rawGroup.rows);
    row.data[columnCalcs.botCalcs[0].field] = group.getKey() + ` (${count})`;
    row.generateCells();

    const arrowClone = rawGroup.arrowElement.cloneNode(true);
    rawGroup.arrowElement = document.createElement('span');

    const firstCell = row.cells[0].getElement();
    firstCell.insertBefore(arrowClone, firstCell.firstChild);

    const rowFrag = document.createDocumentFragment();
    row.cells.forEach((cell: { getElement(): HTMLElement }) => {
      rowFrag.appendChild(cell.getElement());
    });
    row.element.appendChild(rowFrag);

    // row.cells.forEach((cell) => {
    //   cell.cellRendered();
    // });
    return row.element;
  }
}
