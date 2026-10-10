/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { countColumn, textColumn } from '../columns.js';

interface Row {
  n: number | null;
  s: string | null;
}

const ROWS: Row[] = [
  { n: 2, s: 'a' },
  { n: null, s: null },
];

describe('countColumn', () => {
  const column = (summed?: boolean) =>
    countColumn<Row>({ id: 'n', title: 'N', value: (row) => row.n, width: 80, summed });

  it('shows a row with no value as empty', () => {
    expect(ROWS.map((row) => column().text?.(row))).toEqual(['2', '']);
  });

  it('sums by default, counting a missing value as nothing', () => {
    const totals = column().calc?.of(ROWS);
    // Two rows end the generator before its first yield.
    expect(typeof totals === 'number' ? totals : totals?.next().value).toBe(2);
  });

  it('has no footer total when not summed', () => {
    expect(column(false).calc).toBeUndefined();
  });
});

describe('textColumn', () => {
  const column = (hoverText?: boolean) =>
    textColumn<Row>({
      id: 's',
      title: 'S',
      value: (row) => row.s,
      width: 80,
      empty: '—',
      hoverText,
    });

  it('shows the empty mark, but finds and copies nothing, where the row has no value', () => {
    expect(column().cell(ROWS[1] as Row)).toBe('—');
    expect(column().text?.(ROWS[1] as Row)).toBe('');
  });

  it('shows the value on hover only when asked', () => {
    expect(column().tooltip).toBeUndefined();
    expect(column(true).tooltip?.(ROWS[0] as Row)).toBe('a');
  });
});
