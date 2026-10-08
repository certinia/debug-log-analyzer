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

/** The scroller's height; 0 is a hidden tab. */
let viewport = VIEWPORT;

/**
 * jsdom does no layout: rows are ROW high, the scroller `viewport` high, and it scrolls.
 * Returns a move with no scroll event yet, as a script's scrollTop write in a frame is.
 */
function fakeLayout(scroller: HTMLElement): (top: number) => void {
  let top = 0;
  Object.defineProperties(scroller, {
    offsetHeight: { get: () => viewport },
    offsetWidth: { get: () => 500 },
    clientHeight: { get: () => viewport },
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
  return (value) => {
    top = value;
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * jsdom has no ResizeObserver. Returns a resize that gives the new height to each observer
 * of the element it is given.
 */
function fakeResizeObserver(): (target: Element, height: number) => void {
  const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];
  globalThis.ResizeObserver = class {
    private readonly targets = new Set<Element>();
    constructor(callback: ResizeObserverCallback) {
      observers.push({ callback, targets: this.targets });
    }
    observe(target: Element): void {
      this.targets.add(target);
    }
    unobserve(target: Element): void {
      this.targets.delete(target);
    }
    disconnect(): void {
      this.targets.clear();
    }
  } as unknown as typeof ResizeObserver;
  return (target, height) => {
    const entry = {
      target,
      contentRect: { height, width: 500 },
      borderBoxSize: [{ blockSize: height, inlineSize: 500 }],
    } as unknown as ResizeObserverEntry;
    for (const { callback, targets } of observers) {
      if (targets.has(target)) {
        callback([entry], {} as ResizeObserver);
      }
    }
  };
}

async function setup(count = 1000) {
  const scroller = document.createElement('div');
  const body = document.createElement('div');
  scroller.append(body);
  document.body.append(scroller);
  const moveQuietly = fakeLayout(scroller);
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
  return { scroller, body, store, view, painted, shown, moveQuietly };
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
  viewport = VIEWPORT;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
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

  it('keeps a scroll the virtualizer has not heard of when a row above the fold grows', async () => {
    const resize = fakeResizeObserver();
    const { scroller, body, moveQuietly } = await setup();
    scroller.scrollTop = 300 * ROW;
    await flush();
    moveQuietly(600 * ROW);
    // Row 298 is in the overscan above the fold, and grows to twice its height.
    const row = body.querySelector('[data-index="298"]');
    expect(row).not.toBeNull();
    resize(row as Element, 2 * ROW);
    expect(scroller.scrollTop).toBe(600 * ROW + ROW);
  });

  it('measures a row element again after the pool gives it to another row', async () => {
    const resize = fakeResizeObserver();
    const { scroller, body, shown } = await setup();
    // Each jump hands the elements to other rows.
    for (const top of [300, 0, 300]) {
      scroller.scrollTop = top * ROW;
      await flush();
    }
    const before = Number.parseFloat(body.style.height);
    const rows = shown();
    for (const row of rows) {
      resize(row, 2 * ROW);
    }
    await flush();
    expect(Number.parseFloat(body.style.height)).toBe(before + rows.length * ROW);
  });

  it('keeps the height of a row whose element is hidden as a spare', async () => {
    const resize = fakeResizeObserver();
    const { scroller, body } = await setup();
    scroller.scrollTop = 300 * ROW;
    await flush();
    // The top of the list has no overscan above it, so the pool has spares.
    scroller.scrollTop = 0;
    await flush();
    const spare = [...body.children].find((el) => (el as HTMLElement).hidden);
    expect(spare).toBeDefined();
    const before = body.style.height;
    resize(spare as Element, 0);
    await flush();
    expect(body.style.height).toBe(before);
  });

  it('paints nothing while hidden, and on show puts the user back where they were', async () => {
    const resize = fakeResizeObserver();
    const { scroller, store, view, painted, shown } = await setup();
    scroller.scrollTop = 300 * ROW;
    await flush();
    viewport = 0;
    resize(scroller, 0);
    // The browser drops the scroll position with the box.
    scroller.scrollTop = 0;
    const before = painted.length;

    // Row 10 opens above row 300, which moves to index 350.
    await store.toggle(10);
    view.setRows(store.snapshot().rows);
    view.repaint();
    await flush();
    expect(painted.length).toBe(before);

    viewport = VIEWPORT;
    resize(scroller, VIEWPORT);
    await flush();
    expect(scroller.scrollTop).toBe(350 * ROW);
    expect(shown().map((el) => el.textContent)).toContain('row 300');
  });

  it('goes to a row asked for while hidden, once shown', async () => {
    const resize = fakeResizeObserver();
    const { scroller, view, shown } = await setup();
    viewport = 0;
    resize(scroller, 0);
    view.scrollToIndex(500);
    expect(scroller.scrollTop).toBe(0);

    viewport = VIEWPORT;
    resize(scroller, VIEWPORT);
    await flush();
    expect(shown().map((el) => el.textContent)).toContain('row 500');
  });

  it('leaves the body empty when destroyed, so a new view on it paints the only rows', async () => {
    const { scroller, body, store, view } = await setup();
    view.repaint();
    view.destroy();
    await flush();
    expect(body.childElementCount).toBe(0);

    const next = new GridView<Node>({
      scroller,
      body,
      rowHeight: ROW,
      overscan: 2,
      painter: { paint: () => {} },
    });
    next.setRows(store.snapshot().rows);
    await flush();
    expect(body.childElementCount).toBe(7);
  });
});
