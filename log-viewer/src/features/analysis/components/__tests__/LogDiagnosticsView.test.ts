/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { LogDiagnostics } from '../../services/LogDiagnostics.js';

jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

let result: LogDiagnostics = {
  diagnostics: [],
  queryPlansKnown: true,
  lintedQueries: { linted: 0, distinct: 0 },
  logNs: 1_000_000_000,
};

/** Which findings the stubbed scoping call keeps, and what it was asked about. */
let keep = (_id: string) => true;
let askedAbout: readonly number[] = [];

jest.mock('../../services/LogDiagnostics.js', () => ({
  computeLogDiagnostics: () => Promise.resolve(result),
  scopeDiagnostics: (all: LogDiagnostics, instances: readonly number[]) => {
    askedAbout = instances;
    return { ...all, diagnostics: all.diagnostics.filter((d) => keep(d.id)) };
  },
}));

import { eventBus } from '../../../../core/events/EventBus.js';
import '../LogDiagnosticsView.js';

const view = async (scope?: { instances: number[] }) => {
  const element = document.createElement('log-diagnostics');
  if (scope) {
    element.instances = scope.instances;
  }
  document.body.append(element);
  await element.updateComplete;
  // One more turn: the findings arrive from an async call in connectedCallback.
  await element.updateComplete;
  return element;
};

/**
 * A finding renders its detail only while it is open, so a test that reads the
 * detail opens every row first. jsdom does not run the disclosure's own toggle,
 * so it is set and announced here.
 */
const openAll = async (element: HTMLElementTagNameMap['log-diagnostics']) => {
  for (const details of element.shadowRoot!.querySelectorAll('details')) {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  }
  await element.updateComplete;
};

const text = (element: HTMLElement, selector: string) =>
  [...element.shadowRoot!.querySelectorAll(selector)].map((node) => node.textContent?.trim());

describe('log-diagnostics', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    result = {
      diagnostics: [],
      queryPlansKnown: true,
      lintedQueries: { linted: 0, distinct: 0 },
      logNs: 1_000_000_000,
    };
    keep = () => true;
    askedAbout = [];
  });

  it('says nothing is wrong, rather than showing an empty list', async () => {
    const element = await view();
    expect(text(element, '.ok')).toEqual(["No findings — you're good to go."]);
  });

  it('shows each finding, with a count only where it grouped', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Error',
        summary: 'Not selective.',
        message: 'why',
        count: 3,
        eventIndex: 1,
      },
      {
        id: 'b',
        severity: 'Info',
        summary: '50 debug statements ran.',
        message: 'why',
        count: 1,
        eventIndex: 2,
      },
    ];
    const element = await view();

    expect(text(element, '.title')).toEqual(['Not selective.', '50 debug statements ran.']);
    expect(text(element, '.count')).toEqual(['3']);
    // Closed, a finding costs nothing to render; the detail arrives with the row.
    expect(text(element, '.detail')).toEqual([]);
    await openAll(element);
    expect(text(element, '.detail')).toEqual(['why', 'why']);
  });

  it('keeps the evidence in the expanded row, not in the summary', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Error',
        summary: 'System.LimitException: Apex CPU time limit exceeded',
        message: 'why',
        count: 2,
        eventIndex: 1,
        evidence: [{ text: 'Class.A.run: line 31, column 1', eventIndex: 1 }],
      },
    ];
    const element = await view();

    expect(text(element, '.title')).toEqual([
      'System.LimitException: Apex CPU time limit exceeded',
    ]);
    expect(text(element, '.evidence')).toEqual([]);
    await openAll(element);
    expect(text(element, '.evidence')).toEqual(['Class.A.run: line 31, column 1']);
  });

  it('lists a line per statement when the finding names several', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Warning',
        summary: '23 Contact queries, one row at a time.',
        message: 'why',
        count: 23,
        eventIndex: 4,
        evidence: [
          { text: "SELECT Id FROM Contact WHERE Id = '003a'", eventIndex: 4 },
          { text: "SELECT Id FROM Contact WHERE Id = '003b'", eventIndex: 9 },
        ],
      },
    ];
    const element = await view();
    await openAll(element);
    const seen: number[] = [];
    element.addEventListener('inspector-reveal', (e) => {
      seen.push((e as CustomEvent<{ eventIndex: number }>).detail.eventIndex);
    });

    // Each statement is its own way back into the grid.
    expect(text(element, '.evidence')).toEqual([
      "SELECT Id FROM Contact WHERE Id = '003a'",
      "SELECT Id FROM Contact WHERE Id = '003b'",
    ]);
    element.shadowRoot!.querySelectorAll<HTMLButtonElement>('.evidence--link')[1]?.click();
    expect(seen).toEqual([9]);
  });

  it('heads a listed set with how many statements there are, and counts each line', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Warning',
        summary: '23 Contact queries, one row at a time.',
        message: 'why',
        count: 23,
        eventIndex: 4,
        evidence: [
          { text: "SELECT Id FROM Contact WHERE Id = '003a'", eventIndex: 4, count: 3 },
          { text: "SELECT Id FROM Contact WHERE Id = '003b'", eventIndex: 9, count: 1 },
        ],
      },
    ];
    const element = await view();
    await openAll(element);

    expect(text(element, '.evidence__head')).toEqual(['2 statements, most repeated first.']);
    // One run is the norm here, so only a repeat is worth a figure.
    expect(text(element, '.evidence__count')).toEqual(['3×']);
  });

  it('states the cause as figures, not as prose', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Error',
        summary: 'CPU limit exceeded.',
        message: 'The governor stopped the transaction here.',
        count: 1,
        eventIndex: 1,
        cause: { label: 'Most time in', name: 'Slow.run()', value: '11.3 s (46%)' },
      },
    ];
    const element = await view();
    await openAll(element);

    expect(text(element, '.cause__label')).toEqual(['Most time in']);
    expect(text(element, '.cause__name')).toEqual(['Slow.run()']);
    expect(text(element, '.cause__value')).toEqual(['11.3 s (46%)']);
  });

  it('asks the inspector to reveal the event the evidence names', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Warning',
        summary: 'SOQL is unbounded.',
        message: 'why',
        count: 1,
        eventIndex: 7,
        evidence: [{ text: 'SELECT Id FROM Account', eventIndex: 7 }],
      },
    ];
    const element = await view();
    await openAll(element);
    const seen: number[] = [];
    element.addEventListener('inspector-reveal', (e) => {
      seen.push((e as CustomEvent<{ eventIndex: number }>).detail.eventIndex);
    });

    element.shadowRoot!.querySelector<HTMLButtonElement>('.evidence--link')?.click();

    expect(seen).toEqual([7]);
  });

  it('leaves a log-wide finding unclickable, since it names no one event', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Info',
        summary: '50 debug statements ran.',
        message: 'why',
        count: 1,
        eventIndex: -1,
        evidence: [{ text: 'System.debug', eventIndex: -1 }],
      },
    ];
    const element = await view();
    await openAll(element);

    expect(element.shadowRoot!.querySelector('.evidence--link')).toBeNull();
    expect(text(element, '.evidence')).toEqual(['System.debug']);
  });

  it('gives the truncated summary a hover of its own', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Info',
        summary: 'A long finding.',
        message: 'why',
        count: 1,
        eventIndex: 1,
      },
    ];
    const element = await view();
    expect(element.shadowRoot!.querySelector('.title')?.getAttribute('title')).toBe(
      'A long finding.',
    );
  });

  it('reports absent query plans rather than leaving the queries looking clean', async () => {
    result.queryPlansKnown = false;
    const element = await view();
    expect(text(element, '.note').join(' ')).toContain('Database log level at FINEST');
  });

  it('reports how much of the log the SOQL rules covered when they were capped', async () => {
    result.lintedQueries = { linted: 250, distinct: 900 };
    const element = await view();
    expect(text(element, '.note').join(' ')).toContain('250 most repeated of 900');
  });

  it('re-analyses when a log is loaded', async () => {
    const element = await view();
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Warning',
        summary: 'Later finding.',
        message: 'why',
        count: 1,
        eventIndex: 1,
      },
    ];
    eventBus.emit('log:loaded', {});
    await element.updateComplete;
    await element.updateComplete;
    expect(text(element, '.title')).toEqual(['Later finding.']);
  });

  it('times a finding the log times, and leaves the rest without a figure', async () => {
    result.diagnostics = [
      { id: 'a', severity: 'Warning', summary: 'Untimed.', message: '', count: 1, eventIndex: 1 },
      {
        id: 'b',
        severity: 'Warning',
        summary: 'Timed.',
        message: '',
        count: 1,
        eventIndex: 2,
        timeNs: 250_000_000,
      },
    ];
    const element = await view();
    expect(text(element, '.share')).toEqual(['250ms (25%)']);
  });

  it('reads a measured but tiny share as under a percent, never as none', async () => {
    result.diagnostics = [
      {
        id: 'a',
        severity: 'Warning',
        summary: 'Barely there.',
        message: '',
        count: 1,
        eventIndex: 1,
        timeNs: 1_000_000,
      },
    ];
    const element = await view();
    expect(text(element, '.share')).toEqual(['1ms (<1%)']);
  });

  it('holds the list to any set of severities the roll-up has pressed', async () => {
    result.diagnostics = [
      { id: 'a', severity: 'Error', summary: 'Stopped.', message: '', count: 1, eventIndex: 1 },
      { id: 'b', severity: 'Warning', summary: 'Slow.', message: '', count: 1, eventIndex: 2 },
      { id: 'c', severity: 'Info', summary: 'Noted.', message: '', count: 1, eventIndex: 3 },
    ];
    const element = await view();
    const bands = () => [
      ...element.shadowRoot!.querySelectorAll<HTMLButtonElement>('.rollup__seg'),
    ];
    expect(text(element, '.rollup__seg')).toEqual(['1', '1', '1']);

    bands()[0]!.click();
    await element.updateComplete;
    expect(text(element, '.title')).toEqual(['Stopped.']);

    // A second severity adds to the list rather than replacing what is held.
    bands()[1]!.click();
    await element.updateComplete;
    expect(text(element, '.title')).toEqual(['Stopped.', 'Slow.']);

    // The same band again is the way back: a filter nothing releases traps the list.
    bands()[0]!.click();
    await element.updateComplete;
    expect(text(element, '.title')).toEqual(['Slow.']);

    bands()[1]!.click();
    await element.updateComplete;
    expect(text(element, '.title')).toEqual(['Stopped.', 'Slow.', 'Noted.']);
  });

  it('leaves the roll-up out when one severity is the whole list', async () => {
    result.diagnostics = [
      { id: 'a', severity: 'Info', summary: 'Noted.', message: '', count: 1, eventIndex: 1 },
    ];
    const element = await view();
    expect(element.shadowRoot!.querySelector('.rollup')).toBeNull();
  });

  it('scopes the findings to the selection', async () => {
    result.diagnostics = [
      { id: 'a', severity: 'Error', summary: 'Mine.', message: '', count: 1, eventIndex: 1 },
      { id: 'b', severity: 'Error', summary: 'Elsewhere.', message: '', count: 1, eventIndex: 9 },
    ];
    keep = (id) => id === 'a';
    const element = await view({ instances: [1, 4] });

    expect(askedAbout).toEqual([1, 4]);
    expect(text(element, '.title')).toEqual(['Mine.']);
    // The list itself says what applies, so no count restates it.
    expect(text(element, '.note')).toEqual([]);
  });

  it('says nothing is wrong for a selection the findings pass over', async () => {
    result.diagnostics = [
      { id: 'a', severity: 'Error', summary: 'Elsewhere.', message: '', count: 1, eventIndex: 9 },
    ];
    keep = () => false;
    const element = await view({ instances: [1] });
    expect(text(element, '.ok')).toEqual(["No findings — you're good to go."]);
  });

  it('keeps a whole-log caveat out of the scoped list, which it does not describe', async () => {
    result.queryPlansKnown = false;
    const element = await view({ instances: [1] });
    expect(text(element, '.note').join(' ')).not.toContain('Database log level at FINEST');
  });
});
