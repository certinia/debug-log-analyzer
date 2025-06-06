/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { type CellComponent, type EmptyCallback } from 'tabulator-tables';
import './Progress.css';
import { progressComponent } from './ProgressComponent.js';

export function progressFormatterMS(
  cell: CellComponent,
  formatterParams: ProgressParams,
  _onRendered: EmptyCallback,
) {
  const value = (cell.getValue() || 0) / 1000000;
  const totalVal = formatterParams.totalValue ?? 0;
  const totalValAsMs = totalVal > 0 ? totalVal / 1000000 : 0;

  return progressComponent(value, totalValAsMs, {
    showPercentageText: formatterParams.showPercentageText,
    precision: formatterParams.precision,
  });
}

export interface ProgressParams {
  precision?: number;
  totalValue?: number;
  showPercentageText?: boolean;
}
