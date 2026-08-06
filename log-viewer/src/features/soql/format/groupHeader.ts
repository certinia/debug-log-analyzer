/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { formatSOQL } from './formatter.js';

type SoqlishRow = {
  originalData?: { type?: string };
  soql?: string;
};

/**
 * Tabulator `groupHeader` renderer that formats SOQL/SOSL group keys.
 *
 * Returns the HTML to use as the first-cell content of a group header row,
 * or an empty string when the group does not look like SOQL/SOSL (so the host's
 * default header rendering is used instead — `GroupCalcs` treats empty as a
 * no-op).
 *
 * Detection precedence:
 *  - `data[0].originalData.type === 'SOQL_EXECUTE_BEGIN'` → soql
 *  - `data[0].originalData.type === 'SOSL_EXECUTE_BEGIN'` → sosl
 *  - `data[0].soql === value`                            → soql (SOQLView rows)
 */
export function soqlGroupHeader(value: unknown, count: number, data: unknown): string {
  if (typeof value !== 'string' || !value) {
    return '';
  }
  const first = Array.isArray(data) ? (data[0] as SoqlishRow | undefined) : undefined;
  const type = first?.originalData?.type;
  let dialect: 'soql' | 'sosl' | null = null;
  if (type === 'SOQL_EXECUTE_BEGIN') {
    dialect = 'soql';
  } else if (type === 'SOSL_EXECUTE_BEGIN') {
    dialect = 'sosl';
  } else if (typeof first?.soql === 'string' && first.soql === value) {
    dialect = 'soql';
  }
  if (!dialect) {
    return '';
  }
  const inner = formatSOQL(value, { mode: 'inline', dialect });
  // Query truncates (single-line ellipsis) but the count is pinned so it stays
  // visible — see the `.soql-group-header*` rules in DataGrid.scss.
  return `<span class="soql-group-header"><span class="soql-group-header__q soql-block soql-inline">${inner}</span><span class="soql-group-header__count">(${count})</span></span>`;
}
