/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { ColumnComponent, RowComponent } from 'tabulator-tables';

export default function (
  value: any,
  _data: any,
  _type: 'data' | 'download' | 'clipboard',
  accessorParams: any,
  _column?: ColumnComponent,
  _row?: RowComponent
): any {
  const returnValue = (value || 0) / 1000000;
  return returnValue.toFixed(accessorParams.precision || 3);
}
