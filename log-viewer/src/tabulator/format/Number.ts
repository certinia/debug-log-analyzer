/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import type { CellComponent, EmptyCallback } from 'tabulator-tables';

import { formatNsAsMs } from '../../core/utility/Duration.js';

export default function (
  cell: CellComponent,
  formatterParams: NumberParams,
  _onRendered: EmptyCallback,
) {
  return formatNsAsMs(cell.getValue(), formatterParams.precision || 3);
}

export interface NumberParams {
  precision?: number;
}
