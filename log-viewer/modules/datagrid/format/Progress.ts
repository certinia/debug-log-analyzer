/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { type CellComponent, type EmptyCallback } from 'tabulator-tables';

import './Progress.css';

export function progressFormatter(
  cell: CellComponent,
  formatterParams: ProgressParams,
  _onRendered: EmptyCallback,
) {
  const value = (cell.getValue() || 0) / 1000000;
  const roundedValue = `${value.toFixed(formatterParams.precision || 3)}`;

  if (formatterParams.totalValue !== undefined && formatterParams.totalValue !== null) {
    const totalValAsMs =
      formatterParams.totalValue !== 0 ? formatterParams.totalValue / 1000000 : 0;
    const percentComplete =
      totalValAsMs !== 0 ? (Math.round((value / totalValAsMs) * 100) / 100) * 100 : 0;
    const percentageText = `(${percentComplete.toFixed(2)}%)`;

    return `<div class="progress-wrapper">
        ${percentComplete ? `<div class="progress-bar" style="width: ${percentComplete}%;"></div>` : ''}
        <div class="progress-bar__text"><span>${roundedValue}</span><span class="progress-bar__text__percent">${percentageText}</span></div>
      </div>`;
  }

  return `${roundedValue}`;
}

export interface ProgressParams {
  precision?: number;
  totalValue?: number;
}
