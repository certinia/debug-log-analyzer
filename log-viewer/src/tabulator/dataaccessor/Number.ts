/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import type { ColumnComponent, RowComponent } from 'tabulator-tables';

import { formatNsAsMs } from '../../core/utility/Duration.js';

export default function (
  value: number | null,
  _data: unknown,
  _type: 'data' | 'download' | 'clipboard',
  accessorParams: { precision: number },
  _column?: ColumnComponent,
  _row?: RowComponent,
): string {
  return formatNsAsMs(value, accessorParams.precision || 3);
}
