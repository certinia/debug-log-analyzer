/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import type { RowComponent } from 'tabulator-tables';

import { LOCATED_ROW_CLASS, LocatedRowMarker, rowIndexStamper } from '../locatedRow.js';

const stamp = rowIndexStamper('eventIndex');

function rowComponent(element: HTMLElement, data: Record<string, unknown>): RowComponent {
  return { getElement: () => element, getData: () => data } as unknown as RowComponent;
}

/** A table host holding a rendered row element per index, as the stamp leaves them. */
function host(...indexes: number[]): HTMLElement {
  const element = document.createElement('div');
  for (const index of indexes) {
    const row = document.createElement('div');
    row.classList.add('tabulator-row');
    stamp(rowComponent(row, { eventIndex: index }));
    element.append(row);
  }
  return element;
}

function rowFor(container: HTMLElement, index: number): HTMLElement {
  return container.children[index] as HTMLElement;
}

describe('rowIndexStamper', () => {
  it('leaves a row with no index alone, as a calc row is', () => {
    const element = document.createElement('div');

    stamp(rowComponent(element, { 'duration.total': 12 }));

    expect(element.attributes).toHaveLength(0);
  });
});

describe('LocatedRowMarker', () => {
  it('marks the rendered row for the event', () => {
    const container = host(1, 2);
    const marker = new LocatedRowMarker();

    marker.mark(container, 2);

    expect(rowFor(container, 1).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('moves the mark, so only one row carries it', () => {
    const container = host(1, 2);
    const marker = new LocatedRowMarker();

    marker.mark(container, 1);
    marker.mark(container, 2);

    expect(rowFor(container, 0).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
    expect(rowFor(container, 1).classList.contains(LOCATED_ROW_CLASS)).toBe(true);
  });

  it('drops the mark on null, on clear, and when there is no host', () => {
    const container = host(1);
    const row = rowFor(container, 0);
    const marker = new LocatedRowMarker();

    marker.mark(container, 1);
    marker.mark(container, null);
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    marker.mark(container, 1);
    marker.clear();
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);

    marker.mark(container, 1);
    marker.mark(null, 1);
    expect(row.classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });

  it('leaves a row the table has not rendered alone', () => {
    const container = host(1);
    const marker = new LocatedRowMarker();

    marker.mark(container, 7);

    expect(rowFor(container, 0).classList.contains(LOCATED_ROW_CLASS)).toBe(false);
  });
});
