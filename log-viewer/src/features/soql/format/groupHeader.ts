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
 * An lv-grid group cell: the key highlighted when the group's rows are SOQL or
 * SOSL, else the key and its count.
 *
 * Detection precedence:
 *  - `rows[0].originalData.type === 'SOQL_EXECUTE_BEGIN'` → soql
 *  - `rows[0].originalData.type === 'SOSL_EXECUTE_BEGIN'` → sosl
 *  - `rows[0].soql === key`                               → soql (SOQLView rows)
 */
export function soqlGroupCell(group: {
  key: string;
  rows: readonly unknown[];
}): TemplateResult | string {
  const { key, rows } = group;
  const first = rows[0] as SoqlishRow | undefined;
  const type = first?.originalData?.type;
  let dialect: 'soql' | 'sosl' | null = null;
  if (type === 'SOQL_EXECUTE_BEGIN') {
    dialect = 'soql';
  } else if (type === 'SOSL_EXECUTE_BEGIN') {
    dialect = 'sosl';
  } else if (first?.soql === key) {
    dialect = 'soql';
  }
  if (!key || !dialect) {
    return `${key} (${rows.length})`;
  }
  // Query truncates (single-line ellipsis) but the count is pinned so it stays
  // visible — see the `.soql-group-header*` rules in components/grid/AppGrid.ts.
  return html`<span class="soql-group-header"
    ><span class="soql-group-header__q soql-block soql-inline"
      >${unsafeHTML(formatSOQL(key, { mode: 'inline', dialect }))}</span
    ><span class="soql-group-header__count">(${rows.length})</span></span
  >`;
}
