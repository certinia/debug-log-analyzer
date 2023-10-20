/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { type CellComponent, type EmptyCallback } from 'tabulator-tables';

export default function (
  cell: CellComponent,
  formatterParams: NumberParams,
  _onRendered: EmptyCallback,
) {
  const value = (cell.getValue() || 0) / 1000000;
  return value.toFixed(formatterParams.precision || 3);
}

export interface NumberParams {
  precision?: number;
}
