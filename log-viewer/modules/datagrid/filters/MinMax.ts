import { FilterModule, Module, Tabulator } from 'tabulator-tables';

const deepFilterCache = new Map<number, boolean>();

export class MinMaxFilterModule extends Module {
  constructor(table: Tabulator) {
    super(table);
  }

  initialize() {
    // @ts-expect-error Types file for Modules need fixing
    this.table.on('dataFiltered', this.filtered.bind(this));
  }

  filtered() {
    deepFilterCache.clear();
  }
}

Tabulator.registerModule(FilterModule);

export default function (
  filterVal: any,
  rowVal: any,
  rowData: any,
  filterParams: { columnName: string }
): boolean {
  if (!('start' in filterVal) || !('end' in filterVal)) {
    console.warn(
      'Filter Error - filter value is not an object with end and start properties:',
      filterVal
    );
    return false;
  }

  return deepFilter(filterVal, rowVal, rowData, filterParams);
}

function deepFilter(
  headerValue: { start: number | null; end: number | null },
  rowValue: number,
  rowData: any,
  filterParams: { columnName: string }
): boolean {
  const cachedMatch = deepFilterCache.get(rowData.id);
  if (cachedMatch != null) {
    return cachedMatch;
  }

  const columnName = filterParams.columnName;
  let childMatch = false;
  for (const childRow of rowData._children || []) {
    const match = deepFilter(headerValue, childRow[columnName], childRow, filterParams);

    if (match) {
      childMatch = true;
      break;
    }
  }

  deepFilterCache.set(rowData.id, childMatch);
  if (childMatch) {
    return true;
  }

  const rowVal = +(rowValue / 1000000).toFixed(3);
  const min = headerValue.start;
  const max = headerValue.end;
  if (min) {
    if (max) {
      return rowVal >= min && rowVal <= max;
    } else {
      return rowVal >= min;
    }
  } else if (max) {
    return rowVal <= max;
  }

  return true;
}
