/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { type ColumnComponent, type RowComponent } from 'tabulator-tables';

export default function (
  value: number | null,
  _data: unknown,
  _type: 'data' | 'download' | 'clipboard',
  accessorParams: { precision: number },
  _column?: ColumnComponent,
  _row?: RowComponent,
): string {
  const returnValue = (value || 0) / 1000000;
  return returnValue.toFixed(accessorParams.precision || 3);
}
