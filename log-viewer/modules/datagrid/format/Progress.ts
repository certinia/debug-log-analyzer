/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { type CellComponent, type EmptyCallback } from 'tabulator-tables';

import './Progress.css';

export function progressFormatter(
  cell: CellComponent,
  formatterParams: Params,
  _onRendered: EmptyCallback,
) {
  const value = (cell.getValue() || 0) / 1000000;

  const roundedValue = `${value.toFixed(formatterParams.precision || 3)}`;

  if (formatterParams.totalValue !== undefined && formatterParams.totalValue !== null) {
    const percentComplete =
      formatterParams.totalValue !== 0 ? (value / (formatterParams.totalValue / 1000000)) * 100 : 0;
    const percentage = `(${percentComplete.toFixed(2)}%)`;

    return `<div class="progress-wrapper">
        <div class="progress-bar" style="width: ${percentComplete}%;"></div>
        <div class="progress-bar__text"><span>${roundedValue}</span><span class="progress-bar__text__percent">${percentage}</span></div>
      </div>`;
  }

  return `${roundedValue}`;
}

export interface Params {
  precision?: number;
  totalValue?: number;
}
