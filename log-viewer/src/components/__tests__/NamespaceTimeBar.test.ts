/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { ApexLog } from 'apex-log-parser';

let apexLog: ApexLog | null = null;

import type { LogStore } from '../../core/log/LogStore.js';
import type { NamespaceTimeBar } from '../NamespaceTimeBar.js';
import { DEFAULT_MAX_SEGMENTS } from '../StackedTimeBar.js';
import '../NamespaceTimeBar.js';
import { logNamespacePalette } from '../namespacePalette.js';
import { ev, eventByIndex, log, resetEvents, type FakeEvent } from './fixtures/logEvents.js';

const logOf = (children: FakeEvent[], namespaces: string[]) => {
  apexLog = log(children, namespaces);
};

async function mount(props: Partial<Pick<NamespaceTimeBar, 'eventIndex' | 'instances'>> = {}) {
  const element = document.createElement('namespace-time-bar');
  // No provider in the test, so the consumed store is assigned straight on.
  const store =
    apexLog &&
    ({
      log: apexLog,
      eventByIndex: (index: number) => eventByIndex(index),
    } as unknown as LogStore);
  Object.assign(element, { logStore: store }, props);
  document.body.append(element);
  // The first render only starts the walk; the result lands a task later.
  for (let settle = 0; settle < 5; settle++) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
  }
  return element;
}

const bar = (element: NamespaceTimeBar) =>
  element.shadowRoot?.querySelector('stacked-time-bar') ?? null;

const segments = (element: NamespaceTimeBar) => bar(element)?.segments ?? [];

describe('namespace-time-bar', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    resetEvents();
    apexLog = null;
  });

  it('splits the whole log by namespace, largest first', async () => {
    logOf([ev('default', 100, [ev('pkg', 500)])], ['pkg']);

    expect(segments(await mount()).map(({ label, value }) => ({ label, value }))).toEqual([
      { label: 'pkg', value: 500 },
      { label: 'default', value: 100 },
    ]);
  });

  it('scopes to the selected frame and everything below it', async () => {
    const frame = ev('pkg', 40, [ev('other', 10)]);
    logOf([ev('default', 100, [frame])], ['pkg', 'other']);

    const element = await mount({ eventIndex: frame.eventIndex });

    expect(segments(element).map(({ label }) => label)).toEqual(['pkg', 'other']);
    // The log's palette, not the scope's order: `other` keeps its log colour even
    // though it is second here and third in the log.
    expect(segments(element)[1]?.color).toBe(logNamespacePalette(apexLog!)('other'));
  });

  it('sums every occurrence of an aggregate, counting a nested one once', async () => {
    const inner = ev('pkg', 20);
    const outer = ev('pkg', 30, [inner]);
    logOf([outer], ['pkg']);

    const element = await mount({ instances: [outer.eventIndex, inner.eventIndex] });

    expect(segments(element)[0]).toMatchObject({ label: 'pkg', value: 50 });
  });

  it('gathers the namespaces past the cap into one tail segment', async () => {
    const namespaces = Array.from(
      { length: DEFAULT_MAX_SEGMENTS },
      (_, index) => `ns${index}`,
    ).concat('nsA', 'nsB');
    // Descending self time, so the two smallest fall past the palette.
    logOf(
      namespaces.map((namespace, index) => ev(namespace, (namespaces.length - index) * 10)),
      namespaces,
    );

    const shown = segments(await mount());

    expect(shown).toHaveLength(DEFAULT_MAX_SEGMENTS + 1);
    // nsA at 20 and nsB at 10.
    expect(shown.at(-1)).toMatchObject({ label: '2 others', value: 30 });
  });

  it('notes a scope with no recorded time', async () => {
    logOf([ev('pkg', 0)], ['pkg']);

    const element = await mount();

    expect(bar(element)).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('No time');
  });

  it('notes a frame the log does not hold, rather than waiting on a walk', async () => {
    logOf([ev('pkg', 100)], ['pkg']);

    const element = await mount({ eventIndex: 99 });

    expect(bar(element)).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('No time');
  });

  it('notes the lack of a log, rather than waiting on a walk', async () => {
    const element = await mount();

    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('No time');
  });
});
