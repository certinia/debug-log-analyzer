/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { RowComponent } from 'tabulator-tables';

import { reportGridSelection, type GridSelectionEvent } from '../components/gridSelection.js';

interface StatementRow {
  eventIndex?: number;
  soql?: string;
}

/** Only `getData` is read, so the rest of the row component is not built. */
function row(data: StatementRow): RowComponent {
  return { getData: () => data } as unknown as RowComponent;
}

const soqlEventIndex = (data: StatementRow) => (data.soql ? data.eventIndex : undefined);

describe('reportGridSelection', () => {
  let host: HTMLElement;
  let seen: GridSelectionEvent['detail'][];

  beforeEach(() => {
    host = document.createElement('div');
    seen = [];
    host.addEventListener('grid-selection', (event) =>
      seen.push((event as GridSelectionEvent).detail),
    );
  });

  it('reports the picked row with the grid it came from', () => {
    reportGridSelection(host, 'soql', [row({ eventIndex: 7, soql: 'SELECT' })], soqlEventIndex);

    expect(seen).toEqual([{ type: 'soql', eventIndex: 7 }]);
  });

  it('reports a cleared grid', () => {
    reportGridSelection(host, 'soql', [], soqlEventIndex);

    expect(seen).toEqual([{ type: 'soql', eventIndex: null }]);
  });

  it('says nothing for a row that holds no statement', () => {
    reportGridSelection(host, 'soql', [row({ eventIndex: 7 })], soqlEventIndex);

    expect(seen).toEqual([]);
  });

  it('reaches an ancestor, since only the parent view acts on it', () => {
    const parent = document.createElement('div');
    parent.append(host);
    parent.addEventListener('grid-selection', (event) =>
      seen.push((event as GridSelectionEvent).detail),
    );

    reportGridSelection(host, 'dml', [row({ eventIndex: 3, soql: 'SELECT' })], soqlEventIndex);

    expect(seen).toHaveLength(2);
  });
});
