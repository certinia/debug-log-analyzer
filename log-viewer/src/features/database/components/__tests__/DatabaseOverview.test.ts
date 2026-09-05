/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';
import type { LitElement } from 'lit';

import type { StackedTimeBar } from '../../../../components/StackedTimeBar.js';
import type { LogStore } from '../../../../core/log/LogStore.js';
import type {
  DatabaseBreakdown,
  DatabaseCallNode,
  DatabaseOverview,
  DatabaseStatement,
} from '../../services/databaseOverview.js';

// The namespaces the fixtures use: the bars colour from the log's list, not their own order.
const apexLog = { namespaces: ['pkg', 'trigPkg'] } as unknown as ApexLog;
let overview: DatabaseOverview | null = null;

// jsdom has no stylesheet for the icon element to adopt, so it is left unregistered.
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
// The tabulator ESM build and its module registrations don't load under jest; the
// tree's grid is never built here, only its row mapper is exercised.
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  Renderer: class {},
}));
// Only the figures are stubbed: `concentration` is a pure sum over the fixture,
// so the sections are tested against the same figures they ship with.
jest.mock('../../services/databaseOverview.js', () => ({
  ...jest.requireActual('../../services/databaseOverview.js'),
  databaseOverview: () => overview,
}));

import { databaseTreeRows, ownCodeTotal, type DatabaseTreeRow } from '../DatabaseTimeTree.js';
import '../DatabaseOverview.js';

const emptyOverview = (): DatabaseOverview => ({
  time: {
    timeNs: 0,
    logNs: 1_000_000_000,
    percentOfLog: 0,
    soql: { timeNs: 0, statements: 0 },
    dml: { timeNs: 0, statements: 0 },
    sosl: { timeNs: 0, statements: 0 },
  },
  ranked: [],
  tree: [],
  askedBy: [],
  burnedIn: [],
});

// The DML fires a trigger that holds a query, so its net time is 50ms short of
// its total and its self time shorter still; the three net times sum to the 300ms
// database total.
const statements = (): DatabaseStatement[] => [
  {
    eventIndex: 11,
    eventIndexes: [11],
    kind: 'SOQL',
    label: 'SELECT Id FROM Account',
    sObject: 'Account',
    timeNs: 150_000_000,
    netNs: 150_000_000,
    selfNs: 150_000_000,
    rows: 200,
    maxRows: 200,
    repeats: 1,
  },
  {
    eventIndex: 22,
    eventIndexes: [22, 23, 24],
    kind: 'DML',
    label: 'Update Case',
    sObject: 'Case',
    timeNs: 150_000_000,
    netNs: 100_000_000,
    selfNs: 30_000_000,
    rows: 40,
    maxRows: 20,
    repeats: 3,
  },
  {
    eventIndex: 33,
    eventIndexes: [33],
    kind: 'SOQL',
    label: 'SELECT Name FROM Contact',
    sObject: 'Contact',
    timeNs: 50_000_000,
    netNs: 50_000_000,
    selfNs: 50_000_000,
    rows: 100,
    maxRows: 100,
    repeats: 1,
  },
];

const node = (part: Partial<DatabaseCallNode> & { label: string }): DatabaseCallNode => ({
  kind: null,
  timeNs: 0,
  selfNs: 0,
  count: 1,
  eventIndexes: [],
  children: [],
  ...part,
});

const tree = (): DatabaseCallNode[] => [
  node({
    label: 'apex://pkg.Entry',
    timeNs: 300_000_000,
    // A frame's self time is its own code, every child excluded.
    selfNs: 20_000_000,
    eventIndexes: [2],
    children: [
      node({
        label: 'TaskService.run()',
        timeNs: 300_000_000,
        selfNs: 30_000_000,
        eventIndexes: [5, 6],
        count: 2,
        children: [
          node({
            label: 'SELECT Id FROM Account',
            kind: 'SOQL',
            timeNs: 150_000_000,
            selfNs: 150_000_000,
            eventIndexes: [11],
          }),
          node({
            label: 'Update Case',
            kind: 'DML',
            timeNs: 150_000_000,
            selfNs: 100_000_000,
            eventIndexes: [22],
            children: [
              node({
                label: 'SELECT Name FROM Contact',
                kind: 'SOQL',
                timeNs: 50_000_000,
                selfNs: 50_000_000,
                eventIndexes: [33],
              }),
            ],
          }),
        ],
      }),
    ],
  }),
];

const fullOverview = (): DatabaseOverview => ({
  time: {
    timeNs: 300_000_000,
    logNs: 1_000_000_000,
    percentOfLog: 30,
    soql: { timeNs: 200_000_000, statements: 2 },
    dml: { timeNs: 100_000_000, statements: 1 },
    sosl: { timeNs: 0, statements: 0 },
  },
  ranked: statements(),
  tree: tree(),
  askedBy: namespaceSplit(),
  // The same split by default, so the section shows one bar; a test overrides it
  // to check the second.
  burnedIn: namespaceSplit(),
});

const namespaceSplit = (): DatabaseBreakdown[] => [
  {
    key: 'pkg',
    timeNs: 250_000_000,
    soqlTimeNs: 200_000_000,
    dmlTimeNs: 50_000_000,
    soslTimeNs: 0,
    statements: 3,
    rowsRead: 300,
    rowsWritten: 20,
  },
  {
    key: 'default',
    timeNs: 50_000_000,
    soqlTimeNs: 0,
    dmlTimeNs: 50_000_000,
    soslTimeNs: 0,
    statements: 1,
    rowsRead: 0,
    rowsWritten: 20,
  },
];

async function mount<K extends keyof HTMLElementTagNameMap>(
  tag: K,
): Promise<HTMLElementTagNameMap[K] & LitElement> {
  const element = document.createElement(tag);
  // No provider in the test, so the consumed store is assigned straight on.
  (element as unknown as { logStore: LogStore }).logStore = {
    log: apexLog,
  } as unknown as LogStore;
  document.body.append(element);
  await (element as LitElement).updateComplete;
  return element as HTMLElementTagNameMap[K] & LitElement;
}

const texts = (element: Element, selector: string) =>
  [...(element.shadowRoot?.querySelectorAll(selector) ?? [])].map((node) =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

const note = (element: Element) => element.shadowRoot?.querySelector('.note')?.textContent ?? '';

describe('databaseTreeRows', () => {
  /** Every row, in the order the grid holds them. */
  const flatten = (rows: readonly DatabaseTreeRow[]): DatabaseTreeRow[] =>
    rows.flatMap((row) => [row, ...flatten(row._children ?? [])]);

  it('numbers the rows depth first, so a nested statement follows its parent', () => {
    const rows = flatten(databaseTreeRows(tree()));

    expect(rows.map((row) => [row.id, row.label])).toEqual([
      [0, 'apex://pkg.Entry'],
      [1, 'TaskService.run()'],
      [2, 'SELECT Id FROM Account'],
      [3, 'Update Case'],
      [4, 'SELECT Name FROM Contact'],
    ]);
  });

  it('carries both times, the kind and every occurrence', () => {
    const rows = flatten(databaseTreeRows(tree()));

    // The DML's total holds the query beneath it; its self time does not.
    expect(rows[3]).toMatchObject({
      kind: 'DML',
      timeNs: 150_000_000,
      selfNs: 100_000_000,
      count: 1,
      eventIndexes: [22],
    });
    // A frame has no kind, carries its own code as self time, and merges its calls.
    expect(rows[1]).toMatchObject({
      kind: null,
      timeNs: 300_000_000,
      selfNs: 30_000_000,
      count: 2,
      eventIndexes: [5, 6],
    });
  });

  it('sums the own code of every row, since a tree footer sums only the roots', () => {
    // 20ms + 30ms of frame code, and the statements' own 300ms.
    expect(ownCodeTotal(databaseTreeRows(tree()))).toBe(350_000_000);
  });

  it('leaves a leaf with no children, so the grid draws no twistie', () => {
    const rows = databaseTreeRows(tree());

    expect(rows[0]?._children).toHaveLength(1);
    expect(flatten(rows)[2]?._children).toBeNull();
  });
});

describe('database-concentration', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    overview = null;
  });

  it('heads the section with how few statements hold the time, in one line', async () => {
    overview = fullOverview();
    const shown = texts(await mount('database-concentration'), '.headline');

    // 150ms then 100ms of self time in 300ms crosses 75%.
    expect(shown).toEqual(['2 statements hold 83.3% of DB time · 30.0% of log']);
  });

  it('gives each row its total, its share, its cost per row and its repeats', async () => {
    overview = fullOverview();
    const element = await mount('database-concentration');
    const shown = texts(element, '.reveal-row');

    expect(shown[0]).toContain('SELECT Id FROM Account');
    expect(shown[0]).toContain('50.0% · 0.75 ms/row');
    // A statement that ran more than once says so; one that ran once does not.
    // A statement with descendants splits its duration: 30ms its own, 120ms below,
    // and 50ms of that 120ms is the nested statement the database itself ran.
    expect(shown[1]).toContain('33.3% · 30 ms self · 120 ms desc · 2.5 ms/row · ran 3× · 50 ms db');
    // A statement with nothing inside it names neither, since self is the total.
    expect(shown[0]).not.toContain('self');
    // The parts a narrow dock hides are the least telling ones, and the title
    // keeps the whole reading whatever is on screen.
    const rows = [...(element.shadowRoot?.querySelectorAll('.reveal-row') ?? [])];
    expect(rows[1]?.querySelector('.sub__database')?.textContent).toContain('50 ms db');
    expect(rows[1]?.getAttribute('title')).toContain('50 ms of the descendant time');
    expect(rows[0]?.getAttribute('title')).toBe('Show this statement in the grid');
    expect(shown[2]).toContain('16.7% · 0.50 ms/row');
    // The figure is the total, so it matches the grid beside it.
    expect(texts(element, '.reveal-row__value--primary')).toEqual(['150 ms', '150 ms', '50 ms']);
    // The meter is the statement's whole share of database time, so the DML's
    // runs to the 50% its total holds while its figure reads its own 33.3%.
    const meters = [...(element.shadowRoot?.querySelectorAll('.reveal-row__meter-fill') ?? [])];
    expect(meters.map((meter) => meter.getAttribute('style'))).toEqual([
      'width:50%;',
      'width:50%;',
      expect.stringContaining('width:16.6'),
    ]);
  });

  it('says a statement returned no rows rather than divide by a row it never had', async () => {
    const none = fullOverview();
    none.ranked = statements().map((statement) => ({ ...statement, rows: 0 }));
    overview = none;
    const shown = texts(await mount('database-concentration'), '.reveal-row');

    expect(shown[0]).toContain('50.0% · no rows');
  });

  it('marks every occurrence of a statement on hover', async () => {
    overview = fullOverview();
    const element = await mount('database-concentration');
    const located: number[][] = [];
    document.addEventListener('inspector-locate', (event) => {
      located.push((event as CustomEvent<{ eventIndexes: number[] }>).detail.eventIndexes);
    });

    element.shadowRoot
      ?.querySelectorAll('.reveal-row')[1]
      ?.dispatchEvent(new Event('pointerenter'));

    expect(located).toEqual([[22, 23, 24]]);
  });

  it('accounts for the statements past the rows it shows', async () => {
    const many = fullOverview();
    many.ranked = Array.from({ length: 10 }, (_ignored, index) => ({
      eventIndex: index,
      eventIndexes: [index],
      kind: 'SOQL' as const,
      label: `SELECT Id FROM Object${index}`,
      sObject: `Object${index}`,
      timeNs: 30_000_000,
      netNs: 30_000_000,
      selfNs: 30_000_000,
      rows: 0,
      maxRows: 0,
      repeats: 1,
    }));
    overview = many;
    const element = await mount('database-concentration');

    expect(texts(element, '.reveal-row')).toHaveLength(5);
    expect(texts(element, '.tail')[0]).toBe('the other 5 statements 50.0%');
  });

  it('renders a query as highlighted SOQL, and a DML as its own text', async () => {
    overview = fullOverview();
    const element = await mount('database-concentration');
    const names = [...(element.shadowRoot?.querySelectorAll('.reveal-row__name') ?? [])];

    expect(names[0]?.querySelector('.soql-block')).not.toBeNull();
    expect(names[1]?.querySelector('.soql-block')).toBeNull();
    expect(names[1]?.textContent).toContain('Update Case');
  });

  it('reveals the statement behind a row', async () => {
    overview = fullOverview();
    const element = await mount('database-concentration');
    const revealed: number[] = [];
    document.addEventListener('inspector-reveal', (event) => {
      revealed.push((event as CustomEvent<{ eventIndex: number }>).detail.eventIndex);
    });

    element.shadowRoot?.querySelector<HTMLButtonElement>('.reveal-row')?.click();

    expect(revealed).toEqual([11]);
  });

  it('says so when the log records no statements', async () => {
    overview = emptyOverview();
    expect(note(await mount('database-concentration'))).toContain('no database statements');
  });
});

describe('database-namespaces', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    overview = null;
  });

  const bar = (element: Element) =>
    element.shadowRoot?.querySelector('stacked-time-bar') as StackedTimeBar;
  const bars = (element: Element) =>
    [...(element.shadowRoot?.querySelectorAll('stacked-time-bar') ?? [])] as StackedTimeBar[];

  it('splits the bar by namespace, longest first', async () => {
    overview = fullOverview();
    const chart = bar(await mount('database-namespaces'));

    expect(chart.segments.map((segment) => [segment.label, segment.value])).toEqual([
      ['pkg', 250_000_000],
      ['default', 50_000_000],
    ]);
    // No `total`, so the bar is the split of database time itself.
    expect(chart.total).toBe(0);
    expect(chart.legend).toBe(true);
  });

  it('names the kinds a namespace spent its time in, zero kinds left out', async () => {
    overview = fullOverview();
    const chart = bar(await mount('database-namespaces'));

    expect(chart.segments.map((segment) => segment.detail)).toEqual([
      'SOQL 200 ms · DML 50 ms',
      'DML 50 ms',
    ]);
  });

  it('gives every namespace a colour of its own', async () => {
    overview = fullOverview();
    const chart = bar(await mount('database-namespaces'));
    const colors = chart.segments.map((segment) => segment.color);

    expect(new Set(colors).size).toBe(colors.length);
  });

  it('keeps a namespace on one colour across both bars', async () => {
    const split = fullOverview();
    const [asked, other] = namespaceSplit();
    // The burned-in bar leads with the namespace the asked-for bar puts second.
    split.burnedIn = [
      { ...other!, key: 'default', timeNs: 180_000_000 },
      { ...asked!, key: 'pkg', timeNs: 120_000_000 },
    ];
    overview = split;
    const [askedBar, burnedBar] = bars(await mount('database-namespaces'));

    const colorOf = (chart: StackedTimeBar, key: string) =>
      chart.segments.find((segment) => segment.label === key)?.color;
    expect(colorOf(burnedBar!, 'pkg')).toBe(colorOf(askedBar!, 'pkg'));
    expect(colorOf(burnedBar!, 'default')).toBe(colorOf(askedBar!, 'default'));
  });

  it('shows one bar when nothing runs inside the statements', async () => {
    overview = fullOverview();
    const shown = bars(await mount('database-namespaces'));

    // `askedBy` and `burnedIn` agree, so a second bar would say nothing new.
    expect(shown).toHaveLength(1);
    expect(shown[0]?.getAttribute('label')).toContain('Called from namespace');
  });

  it('adds the burned-in bar when code beneath the statements holds time', async () => {
    const split = fullOverview();
    const [asked, other] = namespaceSplit();
    split.burnedIn = [
      { ...asked!, key: 'pkg', timeNs: 180_000_000 },
      { ...other!, key: 'trigPkg', timeNs: 120_000_000 },
    ];
    overview = split;
    const shown = bars(await mount('database-namespaces'));

    expect(shown).toHaveLength(2);
    expect(shown[1]?.getAttribute('label')).toContain('Ran in namespace');
    expect(shown[1]?.segments.map((segment) => segment.label)).toEqual(['pkg', 'trigPkg']);
  });

  it('gathers the namespaces past the sixth into one tail that carries them', async () => {
    const many = fullOverview();
    many.askedBy = Array.from({ length: 10 }, (_ignored, index) => ({
      key: `ns${index}`,
      timeNs: (10 - index) * 10_000_000,
      soqlTimeNs: (10 - index) * 10_000_000,
      dmlTimeNs: 0,
      soslTimeNs: 0,
      statements: 1,
      rowsRead: 1,
      rowsWritten: 0,
    }));
    overview = many;
    const chart = bar(await mount('database-namespaces'));

    expect(chart.segments).toHaveLength(7);
    const tail = chart.segments[6]!;
    expect(tail.label).toBe('4 others');
    expect(tail.value).toBe(100_000_000);
    expect(tail.parts?.map((part) => part.label)).toEqual(['ns6', 'ns7', 'ns8', 'ns9']);
  });

  it('says so when the log records no statements', async () => {
    overview = emptyOverview();
    expect(note(await mount('database-namespaces'))).toContain('no database statements');
  });
});
