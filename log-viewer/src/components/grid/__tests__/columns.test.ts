/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { render } from 'lit';

import { formatSOQLToText } from '../../../features/soql/format/formatter.js';
import { msBar } from '../cells.js';
import { countColumn, inlineQueryColumn, textColumn, timeColumn } from '../columns.js';

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
    countColumn<Row>({ id: 'n', title: 'N', value: (row) => row.n, summed });

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

describe('timeColumn', () => {
  it('reads a total given as a getter at each paint', () => {
    let totalNs = 100;
    const column = timeColumn<{ ns: number }>({
      id: 't',
      title: 'T',
      value: (row) => row.ns,
      totalNs: () => totalNs,
    });

    totalNs = 200;

    expect(column.cell({ ns: 50 })).toEqual(msBar(50, 200));
    expect(column.total?.(50)).toEqual(msBar(50, 200));
  });
});

describe('inlineQueryColumn', () => {
  interface QueryRow {
    text: string;
    dialect: 'soql' | null;
  }
  const column = inlineQueryColumn<QueryRow>({
    id: 'q',
    title: 'Q',
    value: (row) => row.text,
    dialect: (row) => row.dialect,
  });
  const query: QueryRow = { text: 'select id from account', dialect: 'soql' };
  const frame: QueryRow = { text: 'Account.load()', dialect: null };

  it('shows a query highlighted, finds it as it shows it, and copies and hovers it raw', () => {
    const cell = document.createElement('div');
    render(column.cell(query), cell);

    expect(cell.querySelector('.soql-block.soql-inline')?.textContent).toBe(column.text?.(query));
    expect(column.text?.(query)).toBe(
      formatSOQLToText(query.text, { mode: 'inline', dialect: 'soql' }),
    );
    expect(column.exportText?.(query)).toBe(query.text);
    expect(column.tooltip?.(query)).toBe(query.text);
  });

  it('shows, finds and copies a row that is no query as it is', () => {
    expect(column.cell(frame)).toBe(frame.text);
    expect(column.text?.(frame)).toBe(frame.text);
    expect(column.exportText?.(frame)).toBe(frame.text);
  });
});
