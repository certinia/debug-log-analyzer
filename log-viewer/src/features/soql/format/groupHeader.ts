/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { formatSOQL } from './formatter.js';

type SoqlishRow = {
  originalData?: { type?: string };
  soql?: string;
};

/**
 * Formats a SOQL/SOSL group key for a group header row.
 *
 * Returns the HTML to use as the first-cell content of a group header row,
 * or an empty string when the group does not look like SOQL/SOSL (so the
 * caller shows the plain key instead).
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
  // visible — see the `.soql-group-header*` rules in components/grid/AppGrid.ts.
  return `<span class="soql-group-header"><span class="soql-group-header__q soql-block soql-inline">${inner}</span><span class="soql-group-header__count">(${count})</span></span>`;
}

/** An lv-grid group cell: the key highlighted when it is a query, else the key and its count. */
export function soqlGroupCell(group: {
  key: string;
  rows: readonly unknown[];
}): TemplateResult | string {
  const query = soqlGroupHeader(group.key, group.rows.length, group.rows);
  return query ? html`${unsafeHTML(query)}` : `${group.key} (${group.rows.length})`;
}
