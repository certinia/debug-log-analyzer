/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import { type CellComponent, type EmptyCallback } from 'tabulator-tables';

export default function (cell: CellComponent, formatterParams: Params, _onRendered: EmptyCallback) {
  const value = (cell.getValue() || 0) / 1000000;

  const percentage = formatterParams.totalValue
    ? ' (' + ((value / (formatterParams.totalValue / 1000000)) * 100).toFixed(2) + '%)'
    : '';
  return `${value.toFixed(formatterParams.precision || 3)}` + percentage;
}

export interface Params {
  precision?: number;
  totalValue?: number;
}
