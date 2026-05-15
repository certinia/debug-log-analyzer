import { Module, type GroupComponent, type Tabulator } from 'tabulator-tables';

type GroupHeaderFn = (
  value: unknown,
  count: number,
  data: unknown,
  group: GroupComponent,
) => string | HTMLElement | null | undefined;

export class GroupCalcs extends Module {
  static moduleName = 'groupCalcs';

  private userGroupHeader?: GroupHeaderFn;

  constructor(table: Tabulator) {
    super(table);
    this.registerTableOption('groupCalcs', false);
  }

  initialize() {
    // @ts-expect-error groupCalcs is a custom option registered above
    if (!this.table.options.groupCalcs) {
      return;
    }
    const existing = this.table.options.groupHeader;
    if (typeof existing === 'function') {
      this.userGroupHeader = existing as GroupHeaderFn;
    }
    this.table.options.groupHeader = this.groupHeader.bind(this);
  }

  groupHeader(value: unknown, count: number, data: unknown, group: GroupComponent) {
    // @ts-expect-error private function to the raw group instead of wrapper component
    const rawGroup = group._getSelf();
    const columnCalcs = group.getTable().modules.columnCalcs;

    const row = columnCalcs.generateBottomRow(rawGroup.rows);
    const firstField = columnCalcs.botCalcs[0].field;
    row.data[firstField] = group.getKey() + ` (${count})`;
    row.generateCells();

    const arrowClone = rawGroup.arrowElement.cloneNode(true);
    rawGroup.arrowElement = document.createElement('span');

    const firstCell = row.cells[0].getElement();
    if (this.userGroupHeader) {
      const provided = this.userGroupHeader(value, count, data, group);
      if (typeof provided === 'string' && provided.length > 0) {
        firstCell.innerHTML = provided;
      } else if (provided instanceof HTMLElement) {
        firstCell.replaceChildren(provided);
      }
    }
    firstCell.insertBefore(arrowClone, firstCell.firstChild);

    const rowFrag = document.createDocumentFragment();
    row.cells.forEach((cell: { getElement(): HTMLElement }) => {
      rowFrag.appendChild(cell.getElement());
    });
    row.element.appendChild(rowFrag);

    return row.element;
  }
}
