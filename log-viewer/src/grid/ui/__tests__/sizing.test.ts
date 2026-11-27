/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { GridColumn } from '../column.js';
import { columnTracks } from '../sizing.js';

const column = (
  id: string,
  width: GridColumn<object>['width'],
  minWidth = 50,
): GridColumn<object> => ({
  id,
  title: id,
  width,
  minWidth,
  cell: () => '',
});

const NAME = column('name', 'flex', 200);
const COUNT = column('count', 80);
const TIME = column('time', 120);

const tracks = (
  columns: GridColumn<object>[],
  user: Record<string, number> = {},
  measured: Record<string, number> = {},
  measuring: string[] = [],
): string =>
  columnTracks(
    columns,
    new Map(Object.entries(user)),
    new Map(Object.entries(measured)),
    new Set(measuring),
  )['--grid-cols'] ?? '';

describe('columnTracks', () => {
  it('leaves the free room to a shown flex column, not the last one', () => {
    expect(tracks([NAME, COUNT, TIME])).toBe('minmax(200px, 1fr) 80px 120px');
  });

  it('gives the free room to the last column when no flex column is shown', () => {
    expect(tracks([COUNT, TIME])).toBe('80px minmax(120px, 1fr)');
  });

  it('fixes a flex column the user resized, and the last column fills', () => {
    expect(tracks([NAME, COUNT, TIME], { name: 300 })).toBe('300px 80px minmax(120px, 1fr)');
  });

  it('keeps the stored width as the filler floor, so a narrower grid goes back to it', () => {
    expect(tracks([NAME, COUNT, TIME], { name: 300, time: 150 })).toContain('minmax(150px, 1fr)');
  });

  it('holds a content column at its minimum until it is measured, then at its measure', () => {
    const content = column('ns', 'content', 60);
    expect(tracks([NAME, content])).toBe('minmax(200px, 1fr) 60px');
    expect(tracks([NAME, content], {}, { ns: 90 })).toBe('minmax(200px, 1fr) 90px');
    expect(tracks([NAME, content], {}, { ns: 10 })).toBe('minmax(200px, 1fr) 60px');
  });

  it('fits a column being measured to its content, over any width it has', () => {
    expect(tracks([NAME, COUNT], { name: 300 }, {}, ['name'])).toBe(
      'max-content minmax(80px, 1fr)',
    );
  });

  it('sets the scroll width to the sum of the widths, a flex column at its minimum', () => {
    const { '--grid-min-width': minWidth } = columnTracks(
      [NAME, COUNT, TIME],
      new Map([['count', 100]]),
    );
    expect(minWidth).toBe('420px');
  });
});
