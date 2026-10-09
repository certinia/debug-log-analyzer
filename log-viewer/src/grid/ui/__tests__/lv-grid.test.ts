/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { GridStore, sum, type TreeSource } from '../../core/index.js';
import { GridView } from '../../render/index.js';
import type { GridColumn } from '../column.js';
import '../lv-grid.js';
import type {
  GridColumnResizeDetail,
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
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(10 * ROW);
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(500);
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => ({ height: ROW, width: 500 }) as DOMRect);
}

const detail = <T>(e: Event): T => (e as CustomEvent<T>).detail;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(grid: LvGrid<Node>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await grid.updateComplete;
    await flush();
  }
}

async function setup(props: Partial<LvGrid<Node>> = {}) {
  fakeLayout();
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

const globals = globalThis as { Highlight?: unknown; CSS?: unknown };
const realHighlights = { Highlight: globals.Highlight, CSS: globals.CSS };

/** Stands in for the CSS Highlight API, which jsdom lacks. Lists the text of each mark. */
function fakeHighlights(): () => string[] {
  const registry = new Map<string, Set<Range>>();
  globals.Highlight = class extends Set<Range> {
    priority = 0;
  };
  globals.CSS = { highlights: registry };
  return () => [...new Set([...registry.values()].flatMap((marks) => [...marks]))].map(String);
}

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
  Object.assign(globals, realHighlights);
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
    const { grid, header } = await setup({ columns: shown });
    header('Time')?.click();
    await settle(grid);
    const setSort = jest.spyOn(GridStore.prototype, 'setSort');
    grid.columns = shown.map((column) =>
      column.id === 'kind' ? { ...column, hidden: true } : column,
    );
    await settle(grid);
    expect(setSort).not.toHaveBeenCalled();
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

    grid.deselect();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('false');
    expect(selected.map((s) => s.row?.name ?? null)).toEqual(['c', null]);

    grid.deselect();
    expect(selected).toHaveLength(2);
  });

  it('opens a row from its twisty without selecting it', async () => {
    const { grid, rowNamed, names } = await setup();
    rowNamed('b')?.querySelector<HTMLElement>('[data-toggle]')?.click();
    await settle(grid);
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(rowNamed('b')?.ariaSelected).toBe('false');
  });

  it('selects a row with no children from its twisty, and keeps no toggle for later rows', async () => {
    const { grid, rowNamed } = await setup();
    const setRows = jest.spyOn(GridView.prototype, 'setRows');
    rowNamed('c')?.querySelector<HTMLElement>('.twisty')?.click();
    await settle(grid);
    expect(rowNamed('c')?.ariaSelected).toBe('true');

    await grid.expandAll();
    await settle(grid);
    expect(setRows).toHaveBeenLastCalledWith(expect.anything(), undefined);
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

  it('moves, opens and closes rows from the keyboard', async () => {
    const { rowNamed, names, key } = await setup();
    await key('ArrowDown');
    expect(rowNamed('a')?.ariaSelected).toBe('true');
    await key('ArrowDown');
    expect(rowNamed('b')?.ariaSelected).toBe('true');
    await key('ArrowRight');
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    await key('ArrowRight');
    expect(rowNamed('b1')?.ariaSelected).toBe('true');
    await key('ArrowLeft');
    expect(rowNamed('b')?.ariaSelected).toBe('true');
    await key('ArrowLeft');
    expect(names()).toEqual(['a', 'b', 'c']);
    await key('End');
    expect(rowNamed('c')?.ariaSelected).toBe('true');
  });

  it('copies every row that passes the filters, closed or not, on Ctrl+C', async () => {
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { key } = await setup();
    await key('c', { ctrlKey: true });
    expect(writeText).toHaveBeenCalledWith(
      'Level\tName\tTime\n1\ta\t3\n1\tb\t1\n2\tb1\t5\n2\tb2\t6\n1\tc\t2',
    );
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
    expect(await grid.goTo([2, 22])).toBe(true);
    await settle(grid);
    expect(names()).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(rowNamed('b2')?.ariaSelected).toBe('true');
  });

  it('keeps the scroll for a row in view whole, when asked to', async () => {
    const { grid } = await setup();
    let lastTop = 2 * ROW;
    // Header to 20, totals from 180; row `index` from 20 + index * 20, the last from `lastTop`.
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const at = (top: number, height = ROW): DOMRect =>
        ({ top, bottom: top + height, height, width: 500 }) as DOMRect;
      const index = Number(this.dataset.index ?? Number.NaN);
      return this.classList.contains('foot')
        ? at(9 * ROW)
        : this.classList.contains('scroller')
          ? at(0, 10 * ROW)
          : index === 2
            ? at(ROW + lastTop)
            : at(Number.isNaN(index) ? 0 : ROW + index * ROW);
    });
    const scroll = jest.spyOn(GridView.prototype, 'scrollToIndex');

    await grid.goTo([3], { scrollIfVisible: false });
    expect(scroll).not.toHaveBeenCalled();
    await grid.goTo([3]);
    expect(scroll).toHaveBeenCalledTimes(1);
    lastTop = 8 * ROW + 1;
    await grid.goTo([3], { scrollIfVisible: false });
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('counts find matches in closed rows too', async () => {
    const { grid } = await setup();
    const totals: number[] = [];
    grid.addEventListener('lv-grid-find-results', (e) =>
      totals.push(detail<GridFindDetail>(e).total),
    );
    expect(await grid.find({ text: 'b' })).toBe(3);
    expect(totals).toEqual([3]);
  });

  it('marks the matches find counted, and none in the space around a cell', async () => {
    const marked = fakeHighlights();
    const { grid } = await setup({
      source: { ...source(), roots: [{ key: 1, name: 'a a', time: 3, kind: 'x' }] },
    });
    expect(await grid.find({ text: ' ' })).toBe(1);
    await grid.setCurrentMatch(0);
    expect(marked()).toEqual([' ']);
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

  it('fits a column to the widest of its header and painted cells on a double-click', async () => {
    const context = { font: '', measureText: (text: string) => ({ width: text.length * 10 }) };
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation((() => context) as unknown as HTMLCanvasElement['getContext']);
    const long: TreeSource<Node> = {
      ...source(),
      roots: [...source().roots, { key: 4, name: 'abcdefghijkl', time: 0, kind: 'x' }],
    };
    const { grid, header } = await setup({ source: long });
    jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.matches('.twisty') ? 16 : 500;
    });
    const widths: GridColumnResizeDetail[] = [];
    grid.addEventListener('lv-grid-column-resize', (e) =>
      widths.push(detail<GridColumnResizeDetail>(e)),
    );
    handle(header('Name'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    // Twelve letters and the twisty.
    expect(widths).toEqual([{ column: 'name', width: 136 }]);
    handle(header('Kind'))?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    // The header is wider than any cell; 40 is also the minimum.
    expect(widths.at(-1)).toEqual({ column: 'kind', width: 40 });
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

describe('lv-grid find marks', () => {
  // jsdom has no CSS Highlight API.
  const registry = new Map<string, Set<Range>>();
  const globals = globalThis as { Highlight?: unknown; CSS?: unknown };
  const real = { Highlight: globals.Highlight, CSS: globals.CSS };
  const marks = (): number => [...registry.values()].reduce((count, set) => count + set.size, 0);

  beforeAll(() => {
    globals.Highlight = class extends Set<Range> {
      priority = 0;
    };
    globals.CSS = { highlights: registry };
  });

  afterAll(() => {
    globals.Highlight = real.Highlight;
    globals.CSS = real.CSS;
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
