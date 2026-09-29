/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import type { CellComponent, EmptyCallback } from 'tabulator-tables';

import { nsToMs } from '../../core/utility/Duration.js';
import './Progress.css';
import { progressComponent } from './ProgressComponent.js';

export function progressFormatterMS(
  cell: CellComponent,
  formatterParams: ProgressParams,
  _onRendered: EmptyCallback,
): string | HTMLElement {
  const value = nsToMs(cell.getValue());
  const totalValAsMs = nsToMs(formatterParams.totalValue);

  return progressComponent(value, totalValAsMs, formatterParams);
}

export interface ProgressParams {
  precision?: number;
  totalValue?: number;
  showPercentageText?: boolean;
}
