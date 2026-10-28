/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { html } from 'lit';

import { sum, type GridExpansion, type TreeSource } from '../../core/index.js';
import { GridView } from '../../render/index.js';
import {
  fakeHighlights,
  fakeRowBoxes,
  flush,
  type FakeHighlights,
} from '../../render/__tests__/fakes.js';
import type { GridColumn } from '../column.js';
import type { Sight } from '../sight.js';
import '../lv-grid.js';
import type {
  GridColumnResizeDetail,
  GridContextDetail,
  GridErrorDetail,
  GridFindDetail,
  GridHeaderContextDetail,
  GridReshapeDetail,
  GridRowDetail,
  GridSelectDetail,
  LvGrid,
} from '../lv-grid.js';

interface Node {
  key: number;
  name: string;
  time: number;
  kind: string;
  children?: Node[];
}

const ROW = 20;

// jsdom lays nothing out, so what the reader sees is set by hand; `sight.test.ts` covers the real one.
let mockSight: Sight = 'below';
jest.mock('../sight.js', () => ({ sightOf: () => mockSight }));

/** Three roots; `b` holds two children. */
const source = (): TreeSource<Node> => ({
  roots: [
    { key: 1, name: 'a', time: 3, kind: 'x' },
    {
      key: 2,
      name: 'b',
      time: 1,
      kind: 'y',
      children: [
        { key: 21, name: 'b1', time: 5, kind: 'y' },
        { key: 22, name: 'b2', time: 6, kind: 'y' },
      ],
    },
    { key: 3, name: 'c', time: 2, kind: 'x' },
  ],
  children: (row) => row.children,
  key: (row) => row.key,
});

const columns = (): GridColumn<Node>[] => [
  { id: 'name', title: 'Name', cell: (row) => row.name, text: (row) => row.name },
  {
    id: 'time',
    title: 'Time',
    width: 80,
    align: 'end',
    cell: (row) => String(row.time),
    text: (row) => String(row.time),
    sort: { value: (row) => row.time },
    sortFirst: 'desc',
    calc: sum((row) => row.time),
  },
  { id: 'kind', title: 'Kind', cell: (row) => row.kind, sort: { value: (row) => row.kind } },
];

/** jsdom does no layout: every element is ROW high and the scroller has room for all rows. */
function fakeLayout(): void {
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('scroller') ? 10 * ROW : ROW;
  });
  jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('scroller') ? 10 * ROW : 0;
  });
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ height: ROW, width: 500 }) as DOMRect);
}

const detail = <T>(e: Event): T => (e as CustomEvent<T>).detail;

async function settle(grid: LvGrid<Node>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await grid.updateComplete;
    await flush();
  }
}

async function setup(props: Partial<LvGrid<Node>> = {}, layout: () => void = fakeLayout) {
  layout();
  const grid = document.createElement('lv-grid') as LvGrid<Node>;
  Object.assign(grid, { columns: columns(), source: source(), ...props });
  document.body.append(grid);
  await settle(grid);
  const root = grid.renderRoot as ShadowRoot;
  const scroller = root.querySelector<HTMLElement>('.scroller');
  const rows = (): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>('.body > [role="row"]')].filter((el) => !el.hidden);
  const names = (): string[] =>
    rows()
      .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
      .map((el) => el.querySelector('.cell')?.textContent?.trim() ?? '');
  const header = (title: string): HTMLElement | undefined =>
    [...root.querySelectorAll<HTMLElement>('[role="columnheader"]')].find(
      (el) => el.textContent?.trim() === title,
    );
  const rowNamed = (name: string): HTMLElement | undefined =>
    rows().find((el) => el.querySelector('.cell')?.textContent?.trim() === name);
  const key = async (key: string, init: KeyboardEventInit = {}): Promise<void> => {
    scroller?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    await settle(grid);
  };
  return { grid, root, scroller, rows, names, header, rowNamed, key };
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

describe('lv-grid', () => {
  it('paints the top-level rows under a header of the shown columns', async () => {
    const { root, names } = await setup();
    expect(names()).toEqual(['a', 'b', 'c']);
    const titles = [...root.querySelectorAll('[role="columnheader"]')].map((el) =>
      el.textContent?.trim(),
    );
    expect(titles).toEqual(['Name', 'Time', 'Kind']);
  });

  it('names the treegrid by its label, and leaves it unnamed without one', async () => {
    const { grid, scroller } = await setup();
    expect(scroller?.hasAttribute('aria-label')).toBe(false);
    grid.label = 'Call Tree, Time Order';
    await settle(grid);
    expect(scroller?.getAttribute('aria-label')).toBe('Call Tree, Time Order');
  });

  it('leaves a hidden column out of the header and the tracks', async () => {
    const { grid, root } = await setup();
    grid.columns = columns().map((column) =>
      column.id === 'kind' ? { ...column, hidden: true } : column,
    );
    await settle(grid);
    expect(root.querySelectorAll('[role="columnheader"]').length).toBe(2);
    const scroller = root.querySelector<HTMLElement>('.scroller');
    expect(scroller?.style.getPropertyValue('--grid-cols')).toBe('minmax(40px, 1fr) 80px');
  });

  it('shows each calc total in the footer', async () => {
    const { root } = await setup();
    const foot = [...root.querySelectorAll('.foot .cell')].map((el) => el.textContent?.trim());
    // Top-level rows only: 3 + 1 + 2.
    expect(foot).toEqual(['', '6', '']);
  });

  it('sums a hidden column only once it is shown', async () => {
    let runs = 0;
    const count = { of: (rows: readonly Node[]): number => (runs++, rows.length) };
    const withCount = (hidden: boolean): GridColumn<Node>[] =>
      columns().map((column) =>
        column.id === 'kind' ? { ...column, calc: count, hidden } : column,
      );
    const { grid, root } = await setup({ columns: withCount(true) });
    expect(runs).toBe(0);

    grid.columns = withCount(false);
    await settle(grid);
    expect(runs).toBe(1);
    const foot = [...root.querySelectorAll('.foot .cell')].map((el) => el.textContent?.trim());
    expect(foot).toEqual(['', '6', '3']);
  });

  it('cycles a sort from its first direction, to the other, to none', async () => {
    const { grid, header, names } = await setup();
    const reshapes: string[] = [];
    grid.addEventListener('lv-grid-reshape', (e) =>
      reshapes.push(detail<GridReshapeDetail>(e).reason),
    );
    const time = header('Time');

    time?.click();
    await settle(grid);
    expect(time?.getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['a', 'c', 'b']);

    time?.click();
    await settle(grid);
    expect(time?.getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['b', 'c', 'a']);

    time?.click();
    await settle(grid);
    expect(time?.getAttribute('aria-sort')).toBe('none');
    expect(names()).toEqual(['a', 'b', 'c']);
    expect(reshapes).toEqual(['sort', 'sort', 'sort']);
  });

  it('does not sort from a header with no sort', async () => {
    const { grid, header } = await setup();
    const name = header('Name');
    name?.click();
    await settle(grid);
    expect(name?.hasAttribute('aria-sort')).toBe(false);
  });

  it('does not sort again when a column is only hidden', async () => {
    const shown = columns();
    const { grid, header, names } = await setup({ columns: shown });
    header('Time')?.click();
    await settle(grid);
    const sorted = names();
    const reshapes: string[] = [];
    grid.addEventListener('lv-grid-reshape', (e) =>
      reshapes.push(detail<GridReshapeDetail>(e).reason),
    );
    grid.columns = shown.map((column) =>
      column.id === 'kind' ? { ...column, hidden: true } : column,
    );
    await settle(grid);
    expect(reshapes).toEqual(['columns']);
    expect(names()).toEqual(sorted);
  });

  it('selects a clicked row, and clears it on a second click', async () => {
    const { grid, rowNamed } = await setup();
    const selected: GridSelectDetail<Node>[] = [];
    grid.addEventListener('lv-grid-select', (e) =>
      selected.push(detail<GridSelectDetail<Node>>(e)),
    );

    rowNamed('c')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('true');
    expect(selected.at(-1)?.row?.name).toBe('c');

    rowNamed('c')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('false');
    expect(selected.at(-1)?.row).toBeNull();
  });

  it('clears the selection on deselect, and reports nothing when none is selected', async () => {
    const { grid, rowNamed } = await setup();
    const selected: GridSelectDetail<Node>[] = [];
    grid.addEventListener('lv-grid-select', (e) =>
      selected.push(detail<GridSelectDetail<Node>>(e)),
    );
    rowNamed('c')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);

    expect(grid.deselect()).toBe(true);
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('false');
    expect(selected.map((s) => s.row?.name ?? null)).toEqual(['c', null]);

    expect(grid.deselect()).toBe(false);
    expect(selected).toHaveLength(2);
  });

  it('opens a row from its twisty without selecting it', async () => {
    const { grid, rowNamed, names } = await setup();
    rowNamed('b')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    await settle(grid);
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(rowNamed('b')?.ariaSelected).toBe('false');
  });

  it('reports a row the user opens, and not one the user closes', async () => {
    const { grid, rowNamed, key } = await setup();
    const opened: string[] = [];
    grid.addEventListener('lv-grid-expand', (e) => {
      opened.push(detail<GridRowDetail<Node>>(e).row?.name ?? '');
    });
    rowNamed('b')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    await settle(grid);
    rowNamed('b')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    await settle(grid);
    expect(opened).toEqual(['b']);

    rowNamed('b')?.click();
    await key('ArrowRight');
    await key('ArrowLeft');
    expect(opened).toEqual(['b', 'b']);
  });

  it('reports when a level step leaves no row to open, or to close', async () => {
    const { grid } = await setup();
    expect(grid.expansion).toEqual({ canExpand: true, canCollapse: false });
    const sent: GridExpansion[] = [];
    grid.addEventListener('lv-grid-expansion-change', (e) => sent.push(detail<GridExpansion>(e)));
    await grid.expandLevel();
    await settle(grid);
    await grid.collapseLevel();
    await settle(grid);
    await grid.collapseLevel();
    await settle(grid);
    expect(sent).toEqual([
      { canExpand: false, canCollapse: true },
      { canExpand: true, canCollapse: false },
    ]);
  });

  it('selects a row with no children from its twisty', async () => {
    const { grid, rowNamed } = await setup();
    rowNamed('c')?.querySelector<HTMLElement>('.twisty')?.click();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('true');
  });

  it('opens a row from its twisty while text is selected, but selects no row', async () => {
    const { grid, rowNamed, names } = await setup();
    // The second press of a double-click selects a word.
    const text = document.createElement('p');
    text.textContent = 'some text';
    document.body.append(text);
    getSelection()?.selectAllChildren(text);

    rowNamed('b')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    await settle(grid);
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);

    rowNamed('c')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('false');
    text.remove();
  });

  it('keeps a double-click on a twisty from selecting a word, and not on text', async () => {
    const { rowNamed } = await setup();
    const press = (el: Element | null | undefined): boolean =>
      !(
        el?.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            composed: true,
            detail: 2,
          }),
        ) ?? true
      );

    expect(press(rowNamed('b')?.querySelector('[data-toggle]'))).toBe(true);
    expect(press(rowNamed('c')?.querySelector('.cell'))).toBe(false);
  });

  it('moves and opens rows from the keyboard, and points a screen reader at the selected row', async () => {
    const { root, scroller, rowNamed, names, key } = await setup();
    await key('ArrowDown');
    await key('ArrowDown');
    expect(rowNamed('b')?.ariaSelected).toBe('true');
    const active = scroller?.getAttribute('aria-activedescendant') ?? '';
    expect(root.getElementById(active)).toBe(rowNamed('b'));
    await key('ArrowRight');
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    await key(' ');
    expect(names()).toEqual(['a', 'b', 'c']);
    await key('End', { ctrlKey: true });
    expect(rowNamed('c')?.ariaSelected).toBe('true');
  });

  it('keeps the screen reader on the selected row as it moves, and off when none is', async () => {
    const { grid, root, scroller, rowNamed, names, key } = await setup();
    const active = (): Element | null =>
      root.getElementById(scroller?.getAttribute('aria-activedescendant') ?? '');
    await key('Enter');
    await key(' ');
    expect(active()).toBeNull();
    expect(names()).toEqual(['a', 'b', 'c']);

    await key('PageUp');
    expect(active()).toBe(rowNamed('c'));
    await key(' ');
    expect(names()).toEqual(['a', 'b', 'c']);

    grid.sort = { column: 'time', dir: 'desc' };
    await settle(grid);
    expect(names()).toEqual(['a', 'c', 'b']);
    expect(active()).toBe(rowNamed('c'));

    grid.deselect();
    expect(scroller?.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('points a screen reader at the selected row only once it is painted', async () => {
    const many: TreeSource<Node> = {
      roots: Array.from({ length: 100 }, (_, i) => ({ key: i, name: `r${i}`, time: i, kind: 'x' })),
      key: (row) => row.key,
    };
    const { grid, root, scroller, rowNamed, key } = await setup({ source: many });
    let top = 0;
    Object.defineProperty(scroller, 'scrollTop', { get: () => top, configurable: true });
    const active = (): string | null => scroller?.getAttribute('aria-activedescendant') ?? null;
    await key('End', { ctrlKey: true });
    expect(rowNamed('r99')).toBeUndefined();
    expect(active()).toBeNull();

    top = 99 * ROW;
    scroller?.dispatchEvent(new Event('scroll'));
    await settle(grid);
    expect(root.getElementById(active() ?? '')).toBe(rowNamed('r99'));
  });

  it('pages by the rows between the header and the totals that are on screen', async () => {
    const many: TreeSource<Node> = {
      roots: Array.from({ length: 100 }, (_, i) => ({ key: i, name: `r${i}`, time: i, kind: 'x' })),
      key: (row) => row.key,
    };
    const { grid, scroller, key } = await setup({ source: many, rowHeight: ROW });
    const selected: (Node | null)[] = [];
    grid.addEventListener('lv-grid-select', (e) =>
      selected.push(detail<GridSelectDetail<Node>>(e).row),
    );
    let bottom = 10 * ROW;
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this === scroller ? { top: 0, bottom, height: bottom } : { height: ROW }) as DOMRect;
    });
    Object.defineProperty(scroller, 'clientHeight', { get: () => bottom, configurable: true });
    await key('Home');
    // 10 rows high, less the header and the totals, less 1 row kept in view.
    await key('PageDown');
    expect(selected.at(-1)?.name).toBe('r7');

    grid.fitRows = true;
    bottom = 30 * ROW;
    const innerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 10 * ROW, configurable: true });
    try {
      await key('PageDown');
      expect(selected.at(-1)?.name).toBe('r14');
      await key('PageUp');
      expect(selected.at(-1)?.name).toBe('r7');
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    }
  });

  it('pages by the measured heights of wrapped rows, so no row is passed unseen', async () => {
    const many: TreeSource<Node> = {
      roots: Array.from({ length: 100 }, (_, i) => ({ key: i, name: `r${i}`, time: i, kind: 'x' })),
      key: (row) => row.key,
    };
    const { grid, scroller, key } = await setup({ source: many, rowHeight: ROW });
    const selected: (Node | null)[] = [];
    grid.addEventListener('lv-grid-select', (e) =>
      selected.push(detail<GridSelectDetail<Node>>(e).row),
    );
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = this === scroller ? 10 * ROW : this.dataset.index ? 2 * ROW : ROW;
      return { top: 0, bottom: height, height } as DOMRect;
    });
    Object.defineProperty(scroller, 'clientHeight', { get: () => 10 * ROW, configurable: true });
    // A new source paints, and so measures, every row again.
    grid.source = { ...many };
    await settle(grid);
    await key('Home');
    // 8 rows of room between the header and the totals hold r0 to r3.
    await key('PageDown');
    expect(selected.at(-1)?.name).toBe('r3');
    await key('PageUp');
    expect(selected.at(-1)?.name).toBe('r0');
  });

  it('looks for a hidden selected row once, not on every draw and key', async () => {
    const plain = source();
    const key = jest.fn(plain.key);
    const { grid, scroller, key: press } = await setup({ source: { ...plain, key } });
    await press('ArrowDown');
    await press('ArrowDown');
    await press('ArrowRight');
    await press('ArrowDown');
    grid.filters = [{ test: (row: Node) => row.name !== 'b1' }];
    await settle(grid);
    expect(scroller?.getAttribute('aria-activedescendant')).toBeNull();
    key.mockClear();
    await press('ArrowRight');
    await press('ArrowRight');
    scroller?.dispatchEvent(new Event('scroll'));
    await settle(grid);
    expect(key).not.toHaveBeenCalled();
  });

  it('reaches the headers from the keyboard, to sort, resize and open their menu', async () => {
    const { grid, root, scroller, header, rowNamed, key } = await setup();
    const resized: GridColumnResizeDetail[] = [];
    const menus: string[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      resized.push(detail<GridColumnResizeDetail>(e)),
    );
    grid.addEventListener('lv-grid-header-context', (e) =>
      menus.push(detail<GridHeaderContextDetail>(e).column),
    );
    const active = (): string | null | undefined => scroller?.getAttribute('aria-activedescendant');

    await key('ArrowDown');
    await key('ArrowUp');
    expect(active()).toBe(header('Name')?.id);
    await key('ArrowRight');
    expect(active()).toBe(header('Time')?.id);

    await key('Enter');
    expect(grid.sort).toEqual({ column: 'time', dir: 'desc' });
    await key('ArrowRight', { shiftKey: true });
    // fakeLayout makes every element 500px wide.
    expect(resized).toEqual([{ column: 'time', width: 516 }]);
    scroller?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: -1 }));
    expect(menus).toEqual(['time']);

    await key('ArrowDown');
    expect(root.getElementById(active() ?? '')).toBe(rowNamed('a'));
  });

  it('moves along the header row within its ends, and stays on it as columns hide', async () => {
    const { grid, scroller, header, rowNamed, key } = await setup();
    const active = (): string | null | undefined => scroller?.getAttribute('aria-activedescendant');
    grid.filters = [{ test: () => false }];
    await settle(grid);
    await key('ArrowUp');
    await key('ArrowLeft');
    expect(active()).toBe(header('Name')?.id);
    await key('End');
    expect(active()).toBe(header('Kind')?.id);
    await key('ArrowRight');
    expect(active()).toBe(header('Kind')?.id);

    grid.columns = columns().map((column) =>
      column.id === 'kind' ? { ...column, hidden: true } : column,
    );
    await settle(grid);
    expect(active()).toBe(header('Time')?.id);
    await key('Home');
    expect(active()).toBe(header('Name')?.id);

    grid.filters = [];
    await settle(grid);
    await key('ArrowDown');
    expect(rowNamed('a')?.ariaSelected).toBe('true');
  });

  it('opens no menu for a right-click on the grid outside its rows and headers', async () => {
    const { grid, scroller, key } = await setup();
    const menus: unknown[] = [];
    grid.addEventListener('lv-grid-context', (e) => menus.push(e));
    await key('ArrowDown');
    const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    scroller?.dispatchEvent(click);
    expect(menus).toEqual([]);
    expect(click.defaultPrevented).toBe(false);
  });

  it('opens the selected row menu from the keyboard, and leaves the browser menu to a host that shows none', async () => {
    const { grid, scroller, key } = await setup();
    const rows: (Node | null)[] = [];
    let shows = false;
    grid.addEventListener('lv-grid-context', (e) => {
      rows.push(detail<GridContextDetail<Node>>(e).row);
      if (shows) {
        detail<GridContextDetail<Node>>(e).event.preventDefault();
      }
    });
    const menuKey = (): MouseEvent => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: -1 });
      scroller?.dispatchEvent(event);
      return event;
    };
    expect(menuKey().defaultPrevented).toBe(false);
    expect(rows).toEqual([]);

    await key('ArrowDown');
    expect(menuKey().defaultPrevented).toBe(false);
    shows = true;
    expect(menuKey().defaultPrevented).toBe(true);
    expect(rows.map((row) => row?.name)).toEqual(['a', 'a']);
  });

  it('opens the menu of a selected row that is scrolled away, and scrolls it back', async () => {
    const many: TreeSource<Node> = {
      roots: Array.from({ length: 100 }, (_, i) => ({ key: i, name: `r${i}`, time: i, kind: 'x' })),
      key: (row) => row.key,
    };
    const { grid, scroller, rowNamed, key } = await setup({ source: many });
    const rows: (Node | null)[] = [];
    grid.addEventListener('lv-grid-context', (e) =>
      rows.push(detail<GridContextDetail<Node>>(e).row),
    );
    await key('End', { ctrlKey: true });
    expect(rowNamed('r99')).toBeUndefined();
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');
    scroller?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: -1 }));
    expect(rows.map((row) => row?.name)).toEqual(['r99']);
    expect(scroll).toHaveBeenCalledWith(99, 'auto');
  });

  it('steps a column width from the keyboard, and reports only a width that changed', async () => {
    const { grid, key } = await setup();
    const resized: GridColumnResizeDetail[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      resized.push(detail<GridColumnResizeDetail>(e)),
    );
    grid.setColumnWidth('time', 40);
    await key('ArrowDown');
    await key('ArrowUp');
    await key('ArrowRight');
    await key('ArrowLeft', { shiftKey: true });
    expect(resized).toEqual([]);
    await key('ArrowRight', { shiftKey: true });
    await key('ArrowRight', { shiftKey: true });
    expect(resized).toEqual([
      { column: 'time', width: 56 },
      { column: 'time', width: 72 },
    ]);
  });

  it('names the resize keys on a header that resizes', async () => {
    const { header } = await setup({
      columns: columns().map((column) =>
        column.id === 'kind' ? { ...column, resizable: false } : column,
      ),
    });
    expect(header('Time')?.getAttribute('aria-keyshortcuts')).toBe(
      'Shift+ArrowLeft Shift+ArrowRight',
    );
    expect(header('Kind')?.hasAttribute('aria-keyshortcuts')).toBe(false);
  });

  it('reaches the headers from the keyboard when no row shows', async () => {
    const { grid, scroller, header, key } = await setup();
    grid.filters = [{ test: () => false }];
    await settle(grid);
    await key('ArrowUp');
    expect(scroller?.getAttribute('aria-activedescendant')).toBe(header('Name')?.id);
    await key('ArrowDown');
    await key('Home');
    expect(scroller?.getAttribute('aria-activedescendant')).toBe(header('Name')?.id);
  });

  it('follows the link of a row on Enter, and opens a row with none', async () => {
    const clicks: string[] = [];
    const linked = columns().map((column) =>
      column.id === 'name'
        ? {
            ...column,
            cell: (row: Node) =>
              row.name === 'a'
                ? html`<a
                    href="#!"
                    @click=${(e: Event) => {
                      e.preventDefault();
                      clicks.push(row.name);
                    }}
                    >a</a
                  >`
                : row.name,
          }
        : column,
    );
    const { names, rowNamed, key } = await setup({ columns: linked });
    expect(rowNamed('a')?.querySelector('a')?.tabIndex).toBe(-1);
    await key('ArrowDown');
    await key('Enter');
    expect(clicks).toEqual(['a']);
    expect(rowNamed('a')?.ariaSelected).toBe('true');
    await key('ArrowDown');
    await key('Enter');
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
  });

  it('writes exportText tsv to the clipboard on Ctrl+C', async () => {
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { grid, key } = await setup();
    await key('c', { ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith(await grid.exportText({ format: 'tsv' }));
  });

  it('exports a column by its export text where it has one, and by its text where not', async () => {
    const withExport = columns().map((column) =>
      column.id === 'time' ? { ...column, exportText: (row: Node) => `${row.time}.0` } : column,
    );
    const { grid } = await setup({ columns: withExport });
    expect(await grid.exportText({ format: 'tsv', tree: false })).toBe(
      'Name\tTime\na\t3.0\nb\t1.0\nc\t2.0',
    );
  });

  it('reports the hovered row, and none on leave', async () => {
    const { grid, root, rowNamed } = await setup();
    const located: (string | null)[] = [];
    grid.addEventListener('lv-grid-locate', (e) =>
      located.push(detail<GridRowDetail<Node>>(e).row?.name ?? null),
    );
    rowNamed('a')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    rowNamed('a')?.dispatchEvent(new Event('pointerover', { bubbles: true }));
    root.querySelector('.body')?.dispatchEvent(new Event('pointerleave'));
    expect(located).toEqual(['a', null]);
  });

  it('takes keyboard focus on its rows', async () => {
    const { grid, root, scroller } = await setup();
    grid.focus();
    expect(root.activeElement).toBe(scroller);
  });

  it('opens the path to a row, then selects it', async () => {
    const { grid, rowNamed, names } = await setup();
    expect(await grid.goTo([2, 22])).toBe('selected');
    await settle(grid);
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(rowNamed('b2')?.ariaSelected).toBe('true');
  });

  // A caller told only "false" could not tell a hidden row from a selection that won.
  it('says when no row on the path is shown', async () => {
    const { grid } = await setup();

    expect(await grid.goTo([99])).toBe('none-shown');
  });

  it('finds a row of a source set in the same turn', async () => {
    const { grid, rowNamed } = await setup();
    grid.source = {
      roots: [{ key: 9, name: 'z', time: 1, kind: 'x' }],
      key: (row) => row.key,
    };

    expect(await grid.goTo([9])).toBe('selected');
    await settle(grid);
    expect(rowNamed('z')?.ariaSelected).toBe('true');
  });

  it('says which selections the user made', async () => {
    const { grid, rowNamed, key } = await setup();
    const users: boolean[] = [];
    grid.addEventListener('lv-grid-select', (e) =>
      users.push(detail<GridSelectDetail<Node>>(e).user),
    );

    await grid.goTo([3]);
    rowNamed('a')?.querySelector<HTMLElement>('.cell')?.click();
    await key('ArrowDown');
    grid.deselect();

    expect(users).toEqual([false, true, true, false]);
  });

  it.each([
    ['a deselect', (grid: LvGrid<Node>) => void grid.deselect()],
    ['a newer goTo', (grid: LvGrid<Node>) => void grid.goTo([1])],
  ])('gives way to %s made while it opens the path', async (_, other) => {
    const { grid, rowNamed } = await setup();
    rowNamed('c')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);

    const stale = grid.goTo([2, 22]);
    other(grid);

    expect(await stale).toBe('superseded');
    await settle(grid);
    expect(rowNamed('b2')?.ariaSelected).not.toBe('true');
  });

  it('gives way to a click made while it opens the path', async () => {
    const { grid, rowNamed } = await setup();

    const stale = grid.goTo([2, 22]);
    rowNamed('a')?.querySelector<HTMLElement>('.cell')?.click();

    expect(await stale).toBe('superseded');
    await settle(grid);
    expect(rowNamed('a')?.ariaSelected).toBe('true');
  });

  it('keeps the scroll for a row in view whole, when asked to', async () => {
    const { grid } = await setup();
    const last = fakeRowBoxes(ROW, 2);
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');

    await grid.goTo([3], { scrollIfVisible: false });
    expect(scroll).not.toHaveBeenCalled();
    await grid.goTo([3]);
    expect(scroll).toHaveBeenCalledTimes(1);
    last.moveTo(8 * ROW + 1);
    await grid.goTo([3], { scrollIfVisible: false });
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('reports the find total', async () => {
    const { grid } = await setup();
    const totals: number[] = [];
    grid.addEventListener('lv-grid-find-results', (e) =>
      totals.push(detail<GridFindDetail>(e).total),
    );
    await grid.find({ text: 'b' });
    expect(totals).toEqual([3]);
  });

  it('keeps the scroll for a current match in view whole, and centres one out of view', async () => {
    const { grid } = await setup();
    const last = fakeRowBoxes(ROW, 2);
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');

    expect((await grid.find({ text: 'c' }))?.total).toBe(1);
    await grid.setCurrentMatch(0);
    expect(scroll).not.toHaveBeenCalled();
    last.moveTo(8 * ROW + 1);
    await grid.setCurrentMatch(0);
    expect(scroll).toHaveBeenCalledWith(2);
  });

  it('points a screen reader at no row while the alert hides them', async () => {
    const { grid, root, scroller, rowNamed, key } = await setup();
    grid.addEventListener('lv-grid-error', (e) => e.preventDefault());
    const active = (): Element | null =>
      root.getElementById(scroller?.getAttribute('aria-activedescendant') ?? '');
    await key('ArrowDown');
    expect(active()).toBe(rowNamed('a'));
    grid.filters = [
      {
        test: () => {
          throw new Error('boom');
        },
      },
    ];
    await settle(grid);
    expect(scroller?.hasAttribute('aria-activedescendant')).toBe(false);
    grid.filters = [];
    await settle(grid);
    expect(active()).toBe(rowNamed('a'));
  });

  it('shows an alert in place of its rows while a build throws, and reports the error once', async () => {
    const { grid, root, names, key } = await setup();
    const selects: unknown[] = [];
    grid.addEventListener('lv-grid-select', (e) => selects.push(detail<GridSelectDetail<Node>>(e)));
    const errors: GridErrorDetail[] = [];
    grid.addEventListener('lv-grid-error', (e) => {
      e.preventDefault();
      errors.push(detail<GridErrorDetail>(e));
    });
    const boom = new Error('boom');
    // Two steps in one turn: both reject with the same error.
    grid.sort = { column: 'time', dir: 'desc' };
    grid.filters = [
      {
        test: () => {
          throw boom;
        },
      },
    ];
    await settle(grid);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      'The table could not be updated.',
    );
    grid.errorText = 'Clear the filter.';
    await settle(grid);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Clear the filter.');
    expect(root.querySelector<HTMLElement>('.body')?.hidden).toBe(true);
    expect(errors).toEqual([{ error: boom, action: 'build' }]);
    await key('ArrowDown');
    expect(selects).toEqual([]);

    grid.filters = [];
    await settle(grid);
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(names()).toEqual(['a', 'c', 'b']);

    grid.filters = [
      {
        test: () => {
          throw boom;
        },
      },
    ];
    await settle(grid);
    expect(errors).toHaveLength(2);
  });

  it('reports a failed copy, and throws an error no listener cancels', async () => {
    const boom = new Error('denied');
    const writeText = jest.fn<Promise<void>, [string]>().mockRejectedValue(boom);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { grid, key } = await setup();
    const thrown = jest.spyOn(globalThis, 'queueMicrotask').mockImplementation(() => {});
    const errors: GridErrorDetail[] = [];
    grid.addEventListener('lv-grid-error', (e) => errors.push(detail<GridErrorDetail>(e)));
    await key('c', { ctrlKey: true });
    await grid.settled();
    expect(errors).toEqual([{ error: boom, action: 'copy' }]);
    expect(() => thrown.mock.calls[0]?.[0]()).toThrow(boom);
  });

  it('reports a reshape when its shown columns change, and not when they stay the same', async () => {
    const { grid } = await setup();
    const reshapes: string[] = [];
    grid.addEventListener('lv-grid-reshape', (e) =>
      reshapes.push(detail<GridReshapeDetail>(e).reason),
    );
    const hideKind = (): GridColumn<Node>[] =>
      columns().map((column) => (column.id === 'kind' ? { ...column, hidden: true } : column));

    grid.columns = hideKind();
    await settle(grid);
    grid.columns = hideKind();
    await settle(grid);
    grid.columns = columns();
    await settle(grid);
    expect(reshapes).toEqual(['columns', 'columns']);
  });

  it('reports a reshape on new filters and on a refresh', async () => {
    const { grid } = await setup();
    const reshapes: string[] = [];
    grid.addEventListener('lv-grid-reshape', (e) =>
      reshapes.push(detail<GridReshapeDetail>(e).reason),
    );

    await grid.refresh();
    expect(reshapes).toEqual([]);

    grid.filters = [{ test: () => true }];
    await settle(grid);
    await grid.refresh();
    grid.groupBy = (row) => row.kind;
    await settle(grid);
    expect(reshapes).toEqual(['filter', 'filter', 'group']);
  });

  it('reports a reshape on a new source', async () => {
    const { grid } = await setup();
    const reshapes: string[] = [];
    grid.addEventListener('lv-grid-reshape', (e) =>
      reshapes.push(detail<GridReshapeDetail>(e).reason),
    );

    grid.source = source();
    await settle(grid);
    expect(reshapes).toEqual(['source']);
  });

  it('shows group rows that toggle on click and select from the keyboard', async () => {
    const { grid, names, rowNamed, key } = await setup({ groupBy: (row) => row.kind });
    expect(names()).toEqual(['x (2)', 'y (1)']);
    rowNamed('x (2)')?.querySelector<HTMLElement>('.cell')?.click();
    await settle(grid);
    expect(names()).toEqual(['x (2)', 'a', 'c', 'y (1)']);
    await key('ArrowDown');
    expect(rowNamed('x (2)')?.ariaSelected).toBe('true');
  });

  it('adds the classes rowClass gives to each data row, and repaints when it changes', async () => {
    const { grid, rowNamed } = await setup({ rowClass: (row) => `kind-${row.kind}` });
    expect(rowNamed('a')?.classList.contains('kind-x')).toBe(true);
    expect(rowNamed('b')?.classList.contains('kind-y')).toBe(true);
    grid.rowClass = null;
    await settle(grid);
    expect(rowNamed('a')?.className).toBe('row');
  });

  it('shows the filtered text only while no row passes the filters', async () => {
    const { grid, root } = await setup();
    const placeholder = (): string | undefined =>
      root.querySelector('.placeholder')?.textContent?.trim();
    expect(placeholder()).toBeUndefined();

    const none = [{ test: () => false }];
    grid.filters = none;
    await settle(grid);
    expect(placeholder()).toBe('No results match your filters');
    const rowIndexes = [...root.querySelectorAll('.scroller > *')].map((el) => [
      el.getAttribute('role'),
      el.getAttribute('aria-rowindex'),
    ]);
    expect(rowIndexes.filter(([role]) => role !== null)).toEqual([
      ['row', '1'],
      ['row', '2'],
      ['row', '3'],
    ]);
    expect(root.querySelector('.scroller')?.getAttribute('aria-rowcount')).toBe('3');
    expect(root.querySelector('[role="gridcell"] > [role="status"]')?.textContent).toBe(
      'No results match your filters',
    );

    grid.filters = [];
    await settle(grid);
    expect(placeholder()).toBeUndefined();
  });

  it('says the filters hide every row, not that there is no data, when the source has rows', async () => {
    const { grid, root } = await setup({
      placeholder: 'No DML statements found',
      filters: [{ test: () => false }],
    });
    const placeholder = (): string | undefined =>
      root.querySelector('.placeholder')?.textContent?.trim();
    expect(placeholder()).toBe('No results match your filters');

    grid.source = { roots: [], key: (row: Node) => row.key };
    await settle(grid);
    expect(placeholder()).toBe('No DML statements found');
  });

  it('filters and totals again on refresh', async () => {
    let hidden = 'a';
    const { grid, root, names } = await setup({
      filters: [{ test: (row: Node) => row.name !== hidden }],
    });
    expect(names()).toEqual(['b', 'c']);

    hidden = 'c';
    await grid.refresh();
    await settle(grid);
    expect(names()).toEqual(['a', 'b']);
    const foot = [...root.querySelectorAll('.foot .cell')].map((el) => el.textContent?.trim());
    expect(foot).toEqual(['', '4', '']);
  });

  it('shows no placeholder while the first build runs', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let clock = 0;
    const { root, grid } = await setup({
      // The build checks its clock every 256 rows, so it needs more rows than that to yield.
      source: {
        roots: Array.from({ length: 600 }, (_, i) => ({
          key: i,
          name: `n${i}`,
          time: 1,
          kind: 'x',
        })),
        key: (row: Node) => row.key,
      },
      filters: [{ test: () => false, keepAncestors: true }],
      scheduler: { now: () => (clock += 100), yield: () => held },
    });
    expect(root.querySelector('.placeholder')).toBeNull();

    release();
    await settle(grid);
    expect(root.querySelector('.placeholder')?.textContent?.trim()).toBe(
      'No results match your filters',
    );
  });

  it('shows no notice when the text for its case is null', async () => {
    const { grid, root } = await setup({
      filters: [{ test: () => false }],
      filteredPlaceholder: null,
    });
    expect(root.querySelector('.placeholder')).toBeNull();

    grid.source = { roots: [], key: (row: Node) => row.key };
    await settle(grid);
    expect(root.querySelector('.placeholder')).toBeNull();
  });

  it('keeps its events inside the shadow root that holds it', async () => {
    fakeLayout();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const grid = document.createElement('lv-grid') as LvGrid<Node>;
    Object.assign(grid, { columns: columns(), source: source() });
    shadow.append(grid);
    document.body.append(host);
    await settle(grid);
    const inShadow = jest.fn();
    const inDocument = jest.fn();
    shadow.addEventListener('lv-grid-select', inShadow);
    document.addEventListener('lv-grid-select', inDocument);
    grid.renderRoot.querySelector<HTMLElement>('.body [role="row"] .cell')?.click();
    await settle(grid);
    document.removeEventListener('lv-grid-select', inDocument);
    expect(inShadow).toHaveBeenCalledTimes(1);
    expect(inDocument).not.toHaveBeenCalled();
  });
});

describe('lv-grid columns', () => {
  const tracks = async (grid: LvGrid<Node>): Promise<string> => {
    await grid.updateComplete;
    return (
      grid.renderRoot
        .querySelector<HTMLElement>('.scroller')
        ?.style.getPropertyValue('--grid-cols') ?? ''
    );
  };

  const handle = (header: HTMLElement | undefined): HTMLElement | null | undefined =>
    header?.querySelector<HTMLElement>('.resize');

  const pointer = (type: string, clientX: number): MouseEvent =>
    new MouseEvent(type, { clientX, button: 0, bubbles: true });

  it('sets a width no less than the column minimum, and keeps it when columns change', async () => {
    const shown = columns();
    const { grid } = await setup({ columns: shown });
    grid.setColumnWidth('time', 120);
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 120px minmax(40px, 1fr)');
    grid.setColumnWidth('time', 10);
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 40px minmax(40px, 1fr)');
    grid.setColumnWidth('time', 120);
    grid.columns = shown.map((column) =>
      column.id === 'kind' ? { ...column, hidden: true } : column,
    );
    await settle(grid);
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 120px');
  });

  it('keeps its column tracks when the host style is replaced', async () => {
    const { grid } = await setup();
    grid.setColumnWidth('time', 120);
    await grid.updateComplete;
    grid.style.cssText = 'color: red';
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 120px minmax(40px, 1fr)');
  });

  it('resizes a column from a drag on its header edge, then reports the width', async () => {
    HTMLElement.prototype.setPointerCapture = jest.fn();
    const { grid, header } = await setup();
    const widths: GridColumnResizeDetail[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      widths.push(detail<GridColumnResizeDetail>(e)),
    );
    const edge = handle(header('Name'));
    // fakeLayout makes every element 500px wide.
    edge?.dispatchEvent(pointer('pointerdown', 100));
    edge?.dispatchEvent(pointer('pointermove', 120));
    expect(await tracks(grid)).toBe('520px 80px minmax(40px, 1fr)');
    edge?.dispatchEvent(pointer('pointermove', 130));
    edge?.dispatchEvent(pointer('pointerup', 130));
    edge?.dispatchEvent(pointer('pointermove', 400));
    expect(await tracks(grid)).toBe('530px 80px minmax(40px, 1fr)');
    expect(widths).toEqual([{ column: 'name', width: 530 }]);
  });

  it('does not sort from a click on the header edge', async () => {
    const { grid, header } = await setup();
    handle(header('Time'))?.click();
    await settle(grid);
    expect(header('Time')?.getAttribute('aria-sort')).toBe('none');
  });

  /** Text is 10px a character; a twisty is 16px and a sort arrow 10px; other boxes 500px. */
  const fakeText = (): {
    measureText: (text: string) => { width: number };
    layoutReads: number;
    measures: number;
  } => {
    fakeLayout();
    const context = {
      font: '',
      layoutReads: 0,
      measures: 0,
      measureText: (text: string) => {
        context.measures++;
        return { width: text.length * 10 };
      },
    };
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.matches('.scroller')) {
        context.layoutReads++;
      }
      return this.matches('.twisty') ? 16 : 500;
    });
    jest.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      context.layoutReads++;
      return { font: '', paddingInlineStart: '0', paddingInlineEnd: '0' } as CSSStyleDeclaration;
    });
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { height: ROW, width: this.matches('.sorter') ? 10 : 500 } as DOMRect;
    });
    return context;
  };

  const withRoot = (root: Partial<Node>): TreeSource<Node> => ({
    ...source(),
    roots: [...source().roots, { key: 4, name: 'd', time: 0, kind: 'x', ...root }],
  });

  const contentColumns = (): GridColumn<Node>[] =>
    columns().map((column) =>
      column.id === 'name'
        ? column
        : { ...column, title: `Total ${column.title}s`, width: 'content' },
    );

  it('fits a double-clicked column to the widest of its header and painted cells', async () => {
    const { grid, header } = await setup({ source: withRoot({ name: 'abcdefghijkl' }) });
    fakeText();
    const widths: GridColumnResizeDetail[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      widths.push(detail<GridColumnResizeDetail>(e)),
    );
    handle(header('Name'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle(grid);
    // Twelve letters and the twisty.
    expect(widths).toEqual([{ column: 'name', width: 136 }]);
  });

  it('can make a column narrower when it autosizes', async () => {
    const { grid } = await setup();
    fakeText();
    grid.setColumnWidth('time', 300);
    grid.autosizeColumn('time');
    await settle(grid);
    // "Time" and its arrow beat the one- and two-digit cells and total.
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 50px minmax(40px, 1fr)');
  });

  it('sizes a content column to at least its header, on two lines, and its footer total', async () => {
    const { grid } = await setup(
      { columns: contentColumns(), source: withRoot({ time: 123456789 }) },
      fakeText,
    );
    // Times: the 9-digit footer total. Kinds: "Total" over "Kinds" and its arrow, not one line.
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 90px 60px');
  });

  it('measures content once per source, not again on a repaint', async () => {
    let text = fakeText();
    const { grid } = await setup({ columns: contentColumns() }, () => (text = fakeText()));
    grid.source = withRoot({ kind: 'a much longer kind' });
    await settle(grid);
    // Eighteen characters; the headers beat the one- and two-digit times.
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 60px 180px');
    text.measureText = (t: string) => ({ width: t.length * 20 });
    grid.marked = new Set([1]);
    grid.rowClass = () => 'wider';
    await settle(grid);
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 60px 180px');
  });

  it('reads no layout on a repaint once its columns are measured', async () => {
    let text = fakeText();
    const { grid } = await setup({ columns: contentColumns() }, () => (text = fakeText()));
    text.layoutReads = 0;
    grid.marked = new Set([1]);
    await settle(grid);
    expect(text.layoutReads).toBe(0);
  });

  it('measures nothing while hidden, and its content once it shows', async () => {
    let text = fakeText();
    const { grid } = await setup({ columns: contentColumns() }, () => {
      text = fakeText();
      jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(0);
    });
    expect(text.measures).toBe(0);
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(10 * ROW);
    grid.remove();
    document.body.append(grid);
    await settle(grid);
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 60px 60px');
  });

  it('keeps pixel tracks while rows build, so the header and footer line up with them', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let clock = 0;
    const { grid } = await setup(
      {
        columns: contentColumns(),
        // The build checks its clock every 256 rows, so it needs more rows than that to yield.
        source: {
          roots: Array.from({ length: 600 }, (_, i) => ({
            key: i,
            name: `n${i}`,
            time: 1,
            kind: 'x',
          })),
          key: (row: Node) => row.key,
        },
        scheduler: { now: () => (clock += 100), yield: () => held },
      },
      fakeText,
    );
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 40px 40px');
    release();
    await settle(grid);
    // The 3-digit footer total is under "Total" over "Times" and its arrow.
    expect(await tracks(grid)).toBe('minmax(40px, 1fr) 60px 60px');
  });

  it('autosizes every column, the flex one back to filling, and a reset gives back the content widths', async () => {
    const { grid } = await setup({ columns: contentColumns() }, fakeText);
    const content = await tracks(grid);
    grid.setColumnWidth('name', 300);
    grid.setColumnWidth('time', 300);
    grid.setColumnWidth('kind', 300);
    const widths: GridColumnResizeDetail[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      widths.push(detail<GridColumnResizeDetail>(e)),
    );
    grid.autosizeColumns();
    await settle(grid);
    expect(widths.map((w) => w.column).sort()).toEqual(['kind', 'time']);
    // A Name the user fixed would leave the last column stretched over the free room.
    expect(await tracks(grid)).toBe(content);
    grid.setColumnWidth('time', 300);
    grid.resetColumnWidths();
    expect(await tracks(grid)).toBe(content);
  });

  it('has no resize handle on a column that is not resizable', async () => {
    const { header } = await setup({
      columns: columns().map((column) =>
        column.id === 'kind' ? { ...column, resizable: false } : column,
      ),
    });
    expect(handle(header('Kind'))).toBeNull();
    expect(handle(header('Time'))).not.toBeNull();
  });

  it('shows a column description as its header tooltip, else its title', async () => {
    const { header } = await setup({
      columns: columns().map((column) =>
        column.id === 'time' ? { ...column, description: 'Time spent, in ms' } : column,
      ),
    });
    expect(header('Time')?.title).toBe('Time spent, in ms');
    expect(header('Kind')?.title).toBe('Kind');
  });

  it('keeps the twisty out of the wrapping content of a tree cell', async () => {
    const { rowNamed } = await setup();
    const cell = rowNamed('b')?.querySelector('.cell');
    expect(cell?.firstElementChild?.matches('[data-toggle]')).toBe(true);
    expect(cell?.querySelector('.content')?.textContent).toBe('b');
  });

  it('reports a right-click on a header, for the column menu', async () => {
    const { grid, header } = await setup();
    const opened: GridHeaderContextDetail[] = [];
    grid.addEventListener('lv-grid-header-context', (e) =>
      opened.push(detail<GridHeaderContextDetail>(e)),
    );
    header('Time')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect(opened.map((d) => d.column)).toEqual(['time']);
  });

  it('counts the header and footer rows in its ARIA row numbers', async () => {
    const { root, scroller, rows } = await setup();
    expect(scroller?.getAttribute('aria-rowcount')).toBe('5');
    expect(root.querySelector('.head')?.getAttribute('aria-rowindex')).toBe('1');
    const first = rows().find((el) => el.dataset.index === '0');
    expect(first?.ariaRowIndex).toBe('2');
    expect(root.querySelector('.foot')?.getAttribute('aria-rowindex')).toBe('5');
  });

  it('reflects freeze-first, which the styles key the frozen column on', async () => {
    const { grid } = await setup({ freezeFirst: true });
    expect(grid.hasAttribute('freeze-first')).toBe(true);
  });

  it('reflects footer-position, which the styles key the footer place on', async () => {
    const { grid } = await setup();
    expect(grid.getAttribute('footer-position')).toBe('bottom');
    grid.footerPosition = 'rows';
    await settle(grid);
    expect(grid.getAttribute('footer-position')).toBe('rows');
  });

  it('reflects fit-rows, which the styles key the fitted height on', async () => {
    const { grid } = await setup();
    expect(grid.hasAttribute('fit-rows')).toBe(false);
    grid.fitRows = true;
    await settle(grid);
    expect(grid.hasAttribute('fit-rows')).toBe(true);
  });

  it('brings a fitted grid row into the page view, which its own scroller cannot see', async () => {
    const { grid } = await setup();
    const into: Element[] = [];
    // jsdom has no scrollIntoView.
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      into.push(this);
    };

    await grid.goTo([3], { scrollIfVisible: false });
    expect(into).toEqual([]);

    grid.fitRows = true;
    await settle(grid);
    await grid.goTo([3], { scrollIfVisible: false });
    expect(into.map((el) => (el as HTMLElement).dataset.index)).toEqual(['2']);
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it('keeps its rows when moved out and back, and shows what changed while away', async () => {
    const { grid, root, names } = await setup();
    const body = root.querySelector('.body');
    const elements = [...(body?.children ?? [])];
    grid.remove();
    grid.filters = [{ test: (row) => row.name !== 'b' }];
    await settle(grid);
    document.body.append(grid);
    await settle(grid);
    expect(names()).toEqual(['a', 'c']);
    expect([...(body?.children ?? [])]).toEqual(elements);
  });
});

describe('lv-grid nearView', () => {
  // Rows a, b, c in sight order; `b` matches, and so do its folded children b1 and b2.
  it.each([
    ['the first match from the top row in sight, for next', { first: 0, last: 2 }, 'next', 0],
    [
      'the last match up to the bottom row, folded ones too, for prev',
      { first: 2, last: 2 },
      'prev',
      2,
    ],
    ['none below the rows in sight, for next', { first: 2, last: 2 }, 'next', -1],
    ['none above the rows in sight, for prev', { first: 0, last: 0 }, 'prev', -1],
    ['none for next with the grid above the view', 'above', 'next', -1],
    ['the last for prev with the grid above the view', 'above', 'prev', 2],
    ['the first for next with the grid below the view', 'below', 'next', 0],
    ['none for prev with the grid below the view', 'below', 'prev', -1],
    ['the first for next in a folded section', 'folded', 'next', 0],
  ] as const)('gives %s', async (_name, sight, direction, match) => {
    const { grid } = await setup();
    await grid.find({ text: 'b' });
    mockSight = sight;

    expect(grid.nearView(direction)).toBe(match);
  });
});

describe('lv-grid find marks', () => {
  let highlights: FakeHighlights;
  const marks = (): number => highlights.marks().length;

  beforeEach(() => {
    highlights = fakeHighlights();
  });

  afterEach(() => highlights.restore());

  it('marks the matches find counted, and none in the space around a cell', async () => {
    const { grid } = await setup({
      source: { ...source(), roots: [{ key: 1, name: 'a a', time: 3, kind: 'x' }] },
    });
    expect((await grid.find({ text: ' ' }))?.total).toBe(1);
    await grid.setCurrentMatch(0);
    expect(highlights.marks()).toEqual([' ']);
  });

  it('marks no match current at -1, and keeps the other matches', async () => {
    const { grid } = await setup();
    const current = (): number => highlights.marks('lv-grid-current-find-match').length;
    await grid.find({ text: 'b' });
    await grid.setCurrentMatch(0);
    expect(current()).toBe(1);

    await grid.setCurrentMatch(-1);
    expect(current()).toBe(0);
    expect(highlights.marks()).toEqual(['b']);
  });

  it('paints no marks for a find that a clear made stale', async () => {
    const { grid } = await setup();
    const running = grid.find({ text: 'b' });
    grid.clearFind();

    expect(await running).toBeNull();
    expect(highlights.marks()).toEqual([]);
  });

  it('neither scrolls to nor marks a match that a clear made stale while it opened', async () => {
    const { grid } = await setup();
    await grid.find({ text: 'b' });
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');
    const stepping = grid.setCurrentMatch(1);
    grid.clearFind();
    await stepping;

    expect(scroll).not.toHaveBeenCalled();
    expect(highlights.marks()).toEqual([]);
  });

  it('does not scroll to a match that a newer step replaced while it opened', async () => {
    const { grid } = await setup();
    await grid.find({ text: 'b' });
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');
    // b1 must open b first; b is already shown.
    const opening = grid.setCurrentMatch(1);
    await grid.setCurrentMatch(0);
    await opening;

    expect(scroll.mock.calls.map(([index]) => index)).toEqual([1]);
  });

  it("finds and marks a group row's key, not its count", async () => {
    const { grid } = await setup({ groupBy: (row) => row.kind });
    const current = (): string[] => highlights.marks('lv-grid-current-find-match');

    expect((await grid.find({ text: 'x' }))?.total).toBe(1);
    expect((await grid.find({ text: '(' }))?.total).toBe(0);
    await grid.find({ text: 'x' });
    await grid.setCurrentMatch(0);
    await settle(grid);
    expect(current()).toEqual(['x']);

    grid.sort = { column: 'time', dir: 'desc' };
    expect(await grid.find({ text: 'x' })).toEqual({ total: 1, current: 0 });
  });

  describe('a search again', () => {
    const current = (): string[] => highlights.marks('lv-grid-current-find-match');

    it('keeps the current match on its row across a sort, and does not scroll to it', async () => {
      const { grid } = await setup();
      await grid.find({ text: 'b' });
      await grid.setCurrentMatch(1);
      const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');

      grid.sort = { column: 'time', dir: 'desc' };
      // b, then its children by time: b2, b1.
      expect(await grid.find({ text: 'b' })).toEqual({ total: 3, current: 2 });
      await settle(grid);
      expect(scroll).not.toHaveBeenCalled();
      expect(current()).toEqual(['b']);
    });

    it('keeps the match within its row', async () => {
      const { grid } = await setup({
        source: {
          ...source(),
          roots: [
            { key: 1, name: 'bb', time: 1, kind: 'x' },
            { key: 2, name: 'b', time: 2, kind: 'x' },
          ],
        },
      });
      await grid.find({ text: 'b' });
      await grid.setCurrentMatch(1);

      grid.sort = { column: 'time', dir: 'desc' };
      expect(await grid.find({ text: 'b' })).toEqual({ total: 3, current: 2 });
    });

    it('holds no current match when its row is filtered out', async () => {
      const { grid } = await setup();
      await grid.find({ text: 'b' });
      await grid.setCurrentMatch(1);

      grid.filters = [{ test: (row: Node) => row.name !== 'b1' }];
      expect(await grid.find({ text: 'b' })).toEqual({ total: 2, current: -1 });
      await settle(grid);
      expect(current()).toEqual([]);
      expect(highlights.marks().length).toBe(2);
    });

    it('keeps the current match on its row across a group by', async () => {
      const { grid } = await setup();
      await grid.find({ text: 'b' });
      await grid.setCurrentMatch(1);

      grid.groupBy = (row) => row.kind;
      expect(await grid.find({ text: 'b' })).toEqual({ total: 3, current: 1 });
    });

    it("moves to the row's first match when a hidden column takes the one it was on", async () => {
      const { grid } = await setup({
        source: { ...source(), roots: [{ key: 1, name: 'a1', time: 1, kind: 'x' }] },
      });
      await grid.find({ text: '1' });
      await grid.setCurrentMatch(1);

      grid.columns = columns().map((column) =>
        column.id === 'name' ? { ...column, hidden: true } : column,
      );
      expect(await grid.find({ text: '1' })).toEqual({ total: 1, current: 0 });
    });

    it('keeps no current match for a new query', async () => {
      const { grid } = await setup();
      await grid.find({ text: 'b' });
      await grid.setCurrentMatch(1);

      expect(await grid.find({ text: 'b1' })).toEqual({ total: 1, current: -1 });
    });
  });

  it('lets go of its marks when removed, and marks again when put back', async () => {
    const { grid, names } = await setup();
    await grid.find({ text: 'b' });
    expect(marks()).toBe(1);

    grid.remove();
    expect(marks()).toBe(0);
    await grid.find({ text: 'b' });
    expect(marks()).toBe(0);

    document.body.append(grid);
    await settle(grid);
    expect(marks()).toBe(1);
    expect(names()).toEqual(['a', 'b', 'c']);
  });
});
