/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore, type RowView, type TreeSource } from '../../core/index.js';
import { GridView } from '../view.js';

interface Node {
  key: number;
  children?: Node[];
}

const ROW = 20;
const VIEWPORT = 100;

/** `count` roots; root 10 holds 50 children. */
const source = (count: number): TreeSource<Node> => ({
  roots: Array.from({ length: count }, (_, key) => ({
    key,
    children: key === 10 ? Array.from({ length: 50 }, (_, i) => ({ key: 10_000 + i })) : undefined,
  })),
  children: (row) => row.children,
  key: (row) => row.key,
});

/** jsdom does no layout: rows are ROW high, the scroller VIEWPORT high, and it scrolls. */
function fakeLayout(scroller: HTMLElement): void {
  let top = 0;
  Object.defineProperties(scroller, {
    offsetHeight: { get: () => VIEWPORT },
    offsetWidth: { get: () => 500 },
    clientHeight: { get: () => VIEWPORT },
    scrollHeight: {
      get: () =>
        Number.parseFloat(
          scroller.firstElementChild?.getAttribute('style')?.match(/height: ([\d.]+)px/)?.[1] ??
            '0',
        ),
    },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = value;
        scroller.dispatchEvent(new Event('scroll'));
      },
    },
  });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scroller.scrollTop = options.top ?? top;
  }) as typeof scroller.scrollTo;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ height: ROW, width: 500 }) as DOMRect);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(count = 1000) {
  const scroller = document.createElement('div');
  const body = document.createElement('div');
  scroller.append(body);
  document.body.append(scroller);
  fakeLayout(scroller);
  const store = new GridStore(source(count));
  await store.settled();
  const painted: number[] = [];
  const view = new GridView<Node>({
    scroller,
    body,
    rowHeight: ROW,
    overscan: 2,
    painter: {
      paint: (el: HTMLElement, index: number, rows: RowView<Node>) => {
        painted.push(index);
        el.textContent = `row ${rows.keyAt(index)}`;
      },
    },
  });
  view.setRows(store.snapshot().rows);
  await flush();
  const shown = (): HTMLElement[] =>
    [...body.children].filter((el): el is HTMLElement => !(el as HTMLElement).hidden);
  return { scroller, body, store, view, painted, shown };
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

describe('GridView', () => {
  it('paints only the rows in view, with their ARIA', async () => {
    const { shown } = await setup();
    const rows = shown();
    // Five in view, plus two of overscan below.
    expect(rows.length).toBe(7);
    expect(rows[0]?.ariaRowIndex).toBe('1');
    expect(rows[0]?.ariaLevel).toBe('1');
    expect(rows[0]?.ariaExpanded).toBeNull();
  });

  it('marks a parent row with whether it is open', async () => {
    const { scroller, shown } = await setup();
    scroller.scrollTop = 10 * ROW;
    await flush();
    const parent = shown().find((el) => el.textContent === 'row 10');
    expect(parent?.ariaExpanded).toBe('false');
  });

  it('reuses its row elements as the window moves', async () => {
    const { scroller, body, shown } = await setup();
    scroller.scrollTop = 300 * ROW;
    await flush();
    // Mid-list the window has overscan above too, so the pool grows once.
    const elements = body.childElementCount;
    scroller.scrollTop = 500 * ROW;
    await flush();
    expect(body.childElementCount).toBe(elements);
    expect(shown().map((el) => el.textContent)).toContain('row 500');
  });

  it('paints a row again only when the rows change or a repaint asks', async () => {
    const { view, painted } = await setup();
    const first = painted.length;
    view.remeasure();
    await flush();
    expect(painted.length).toBe(first);
    view.repaint();
    expect(painted.length).toBe(first * 2);
  });

  it('keeps a toggled row where it was on screen', async () => {
    const { scroller, store, view } = await setup();
    scroller.scrollTop = 8 * ROW;
    await flush();
    // Row 10 sits 40px down the viewport.
    await store.toggle(10);
    view.setRows(store.snapshot().rows, 10);
    await flush();
    expect(10 * ROW - scroller.scrollTop).toBe(40);
  });
});
